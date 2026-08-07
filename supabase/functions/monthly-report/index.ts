import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { buildTablePdf } from "./pdf.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TZ = "America/Sao_Paulo";

// E-mail que recebe os relatórios quando a prestadora não definiu outro destinatário.
const DEFAULT_RECIPIENT = "agendamentoskendrah@gmail.com";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  completed: "Concluído",
};

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** Período (YYYY-MM) do mês anterior no fuso de São Paulo. */
function previousPeriod(): string {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month = now.getMonth() === 0 ? 12 : now.getMonth();
  return `${year}-${String(month).padStart(2, "0")}`;
}

function periodLabel(period: string) {
  const [year, month] = period.split("-").map(Number);
  return `${MONTHS[month - 1]} de ${year}`;
}

/** Intervalo UTC correspondente ao mês no fuso de São Paulo (UTC-3). */
function periodRange(period: string) {
  const [year, month] = period.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1, 3, 0, 0));
  const end = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1, 3, 0, 0));
  return { start: start.toISOString(), end: end.toISOString() };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: TZ });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
}

const HEADERS = ["Data", "Hora", "Cliente", "Telefone", "E-mail", "Serviço", "Status"];

interface AppointmentRow {
  start_time: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  service_name: string;
  status: string;
}

function toRows(appointments: AppointmentRow[]) {
  return appointments.map((a) => [
    formatDate(a.start_time),
    formatTime(a.start_time),
    a.customer_name,
    a.customer_phone || "-",
    a.customer_email || "-",
    a.service_name,
    STATUS_LABELS[a.status] ?? a.status,
  ]);
}

function buildCsv(rows: string[][]) {
  const escape = (value: string) => `"${String(value).replace(/"/g, '""')}"`;
  const csv = [HEADERS, ...rows].map((row) => row.map(escape).join(";")).join("\r\n");
  return new TextEncoder().encode("\uFEFF" + csv);
}

async function generateForUser(userId: string, period: string) {
  const { start, end } = periodRange(period);

  const [{ data: settings }, { data: profile }, { data: appointments, error }] = await Promise.all([
    admin.from("report_settings").select("*").eq("user_id", userId).maybeSingle(),
    admin.from("profiles").select("business_name").eq("id", userId).maybeSingle(),
    admin
      .from("appointments")
      .select("start_time, customer_name, customer_phone, customer_email, service_name, status")
      .eq("user_id", userId)
      .gte("start_time", start)
      .lt("start_time", end)
      .order("start_time", { ascending: true }),
  ]);

  if (error) throw error;

  const rows = toRows((appointments ?? []) as AppointmentRow[]);
  const includeCsv = settings?.include_csv ?? true;
  const includePdf = settings?.include_pdf ?? true;
  const businessName = profile?.business_name ?? "Agendamentos";

  let csvPath: string | null = null;
  let pdfPath: string | null = null;

  if (includeCsv) {
    csvPath = `${userId}/agendamentos-${period}.csv`;
    const { error: uploadError } = await admin.storage
      .from("reports")
      .upload(csvPath, buildCsv(rows), { contentType: "text/csv; charset=utf-8", upsert: true });
    if (uploadError) throw uploadError;
  }

  if (includePdf) {
    pdfPath = `${userId}/agendamentos-${period}.pdf`;
    const pdf = buildTablePdf({
      title: `Agendamentos — ${periodLabel(period)}`,
      subtitle: `${businessName} · ${rows.length} agendamento(s)`,
      headers: HEADERS,
      rows,
      columnWidths: [8, 6, 18, 14, 22, 18, 10],
    });
    const { error: uploadError } = await admin.storage
      .from("reports")
      .upload(pdfPath, pdf, { contentType: "application/pdf", upsert: true });
    if (uploadError) throw uploadError;
  }

  const recipient = settings?.recipient_email ?? DEFAULT_RECIPIENT;
  const emailStatus = recipient ? "pending" : "no_recipient";

  const { error: upsertError } = await admin
    .from("monthly_reports")
    .upsert(
      {
        user_id: userId,
        period,
        appointments_count: rows.length,
        csv_path: csvPath,
        pdf_path: pdfPath,
        email_status: emailStatus,
        email_error: null,
      },
      { onConflict: "user_id,period" },
    );
  if (upsertError) throw upsertError;

  return { userId, period, count: rows.length, csvPath, pdfPath, emailStatus };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status,
    });

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const source = typeof body.source === "string" ? body.source : "manual";
    const requestedPeriod = typeof body.period === "string" && /^\d{4}-\d{2}$/.test(body.period)
      ? body.period
      : previousPeriod();

    // Execução manual: exige usuário autenticado e gera apenas o próprio relatório.
    if (source !== "cron") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

      const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const token = authHeader.replace("Bearer ", "");
      const { data: claims, error: claimsError } = await anon.auth.getClaims(token);
      if (claimsError || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);

      const result = await generateForUser(claims.claims.sub as string, requestedPeriod);
      return json({ ok: true, results: [result] });
    }

    // Execução agendada: todos os usuários com envio automático ligado.
    const { data: settingsList, error: settingsError } = await admin
      .from("report_settings")
      .select("user_id")
      .eq("enabled", true);
    if (settingsError) throw settingsError;

    const results: unknown[] = [];
    for (const row of settingsList ?? []) {
      try {
        results.push(await generateForUser(row.user_id as string, requestedPeriod));
      } catch (err) {
        console.error("Falha ao gerar relatório", row.user_id, err);
        results.push({
          userId: row.user_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return json({ ok: true, period: requestedPeriod, processed: results.length, results });
  } catch (err) {
    console.error("Erro no monthly-report:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
