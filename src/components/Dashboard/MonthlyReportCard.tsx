import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Download, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { monthLabel } from "@/lib/exportAppointments";

interface ReportSettings {
  enabled: boolean;
  recipient_email: string;
  include_csv: boolean;
  include_pdf: boolean;
}

const defaultSettings: ReportSettings = {
  enabled: true,
  recipient_email: "",
  include_csv: true,
  include_pdf: true,
};

const MonthlyReportCard = () => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ReportSettings>(defaultSettings);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ["reportSettings"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from("report_settings")
        .select("enabled, recipient_email, include_csv, include_pdf")
        .eq("user_id", user.id)
        .maybeSingle();
      return {
        enabled: data?.enabled ?? true,
        recipient_email: data?.recipient_email ?? DEFAULT_RECIPIENT,
        include_csv: data?.include_csv ?? true,
        include_pdf: data?.include_pdf ?? true,
      } satisfies ReportSettings;
    },
  });

  const { data: reports } = useQuery({
    queryKey: ["monthlyReports"],
    queryFn: async () => {
      const { data } = await supabase
        .from("monthly_reports")
        .select("id, period, appointments_count, csv_path, pdf_path, created_at")
        .order("period", { ascending: false })
        .limit(12);
      return data ?? [];
    },
  });

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sessão expirada.");
      const { error } = await supabase.from("report_settings").upsert(
        {
          user_id: user.id,
          enabled: form.enabled,
          recipient_email: form.recipient_email.trim() || null,
          include_csv: form.include_csv,
          include_pdf: form.include_pdf,
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
      toast.success("Preferências do relatório salvas.");
      queryClient.invalidateQueries({ queryKey: ["reportSettings"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateNow = async () => {
    setGenerating(true);
    try {
      const { error } = await supabase.functions.invoke("monthly-report", {
        body: { source: "manual" },
      });
      if (error) throw error;
      toast.success("Relatório do mês anterior gerado.");
      queryClient.invalidateQueries({ queryKey: ["monthlyReports"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao gerar o relatório.");
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = async (path: string) => {
    const { data, error } = await supabase.storage.from("reports").createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      toast.error("Não foi possível abrir o arquivo.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock size={18} /> Relatório mensal automático
        </CardTitle>
        <CardDescription>
          Todo dia 1º, às 8h, geramos o relatório de agendamentos do mês anterior e guardamos aqui no
          histórico.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Envio automático</p>
            <p className="text-xs text-muted-foreground">Ativa a geração mensal do relatório.</p>
          </div>
          <Switch
            checked={form.enabled}
            onCheckedChange={(checked) => setForm((prev) => ({ ...prev, enabled: checked }))}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="report-email">E-mail para receber</Label>
            <Input
              id="report-email"
              type="email"
              placeholder="voce@exemplo.com"
              value={form.recipient_email}
              onChange={(e) => setForm((prev) => ({ ...prev, recipient_email: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Formatos</Label>
            <div className="flex items-center gap-6 pt-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.include_csv}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({ ...prev, include_csv: checked === true }))
                  }
                />
                Planilha (CSV)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.include_pdf}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({ ...prev, include_pdf: checked === true }))
                  }
                />
                PDF
              </label>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 size={16} className="mr-2 animate-spin" />} Salvar preferências
          </Button>
          <Button variant="outline" onClick={handleGenerateNow} disabled={generating}>
            {generating ? (
              <Loader2 size={16} className="mr-2 animate-spin" />
            ) : (
              <RefreshCw size={16} className="mr-2" />
            )}
            Gerar mês anterior agora
          </Button>
        </div>

        {reports && reports.length > 0 && (
          <div className="rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Mês</th>
                  <th className="px-4 py-2 text-left font-medium">Agendamentos</th>
                  <th className="px-4 py-2 text-right font-medium">Arquivos</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.id} className="border-t">
                    <td className="px-4 py-2">{monthLabel(report.period)}</td>
                    <td className="px-4 py-2">{report.appointments_count}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        {report.csv_path && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDownload(report.csv_path!)}
                          >
                            <Download size={14} className="mr-1" /> CSV
                          </Button>
                        )}
                        {report.pdf_path && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDownload(report.pdf_path!)}
                          >
                            <Download size={14} className="mr-1" /> PDF
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MonthlyReportCard;
