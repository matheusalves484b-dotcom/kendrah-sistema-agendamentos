import { useMemo, useState } from "react";
import { User, Mail, Phone, Search, CalendarDays, FileDown, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import DashboardLayout from "@/components/Dashboard/DashboardLayout";
import DashboardHeader from "@/components/Dashboard/DashboardHeader";
import NewAppointmentDialog from "@/components/Dashboard/Calendar/NewAppointmentDialog";
import { useAppointments } from "@/hooks/useAppointments";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import {
  exportAppointmentsCsv,
  exportAppointmentsPdf,
  monthLabel,
} from "@/lib/exportAppointments";


interface DerivedClient {
  key: string;
  name: string;
  email: string;
  phone: string;
  totalAppointments: number;
  lastAppointment: Date;
}

const ClientsPage = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { appointments, loading } = useAppointments();

  const clients = useMemo<DerivedClient[]>(() => {
    const map = new Map<string, DerivedClient>();

    appointments.forEach((appointment) => {
      const key = (appointment.customer_email || appointment.customer_phone).toLowerCase();
      const start = new Date(appointment.start_time);
      const existing = map.get(key);

      if (existing) {
        existing.totalAppointments += 1;
        if (start > existing.lastAppointment) {
          existing.lastAppointment = start;
          existing.name = appointment.customer_name;
          existing.phone = appointment.customer_phone;
        }
      } else {
        map.set(key, {
          key,
          name: appointment.customer_name,
          email: appointment.customer_email,
          phone: appointment.customer_phone,
          totalAppointments: 1,
          lastAppointment: start,
        });
      }
    });

    return Array.from(map.values()).sort(
      (a, b) => b.lastAppointment.getTime() - a.lastAppointment.getTime()
    );
  }, [appointments]);

  const filteredClients = clients.filter((client) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      client.name.toLowerCase().includes(term) ||
      client.email.toLowerCase().includes(term) ||
      client.phone.includes(searchTerm)
    );
  });

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-6 sm:py-8">
        <DashboardHeader
          title="Clientes"
          subtitle="Todos os clientes que já agendaram com você"
          actionLabel="Novo Agendamento"
          actionPath="#"
          onActionClick={() => setDialogOpen(true)}
        />

        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
          <Input
            className="pl-10"
            placeholder="Buscar cliente por nome, email ou telefone"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-40">
            <p>Carregando clientes...</p>
          </div>
        ) : filteredClients.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center">
              {searchTerm ? (
                <p className="text-muted-foreground">
                  Nenhum cliente encontrado para "{searchTerm}".
                  <Button variant="link" onClick={() => setSearchTerm("")}>Limpar busca</Button>
                </p>
              ) : (
                <div className="py-8">
                  <User className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">Nenhum cliente ainda</h3>
                  <p className="text-muted-foreground mb-4">
                    Assim que alguém agendar pelo seu link — ou você criar um agendamento — o cliente aparece aqui.
                  </p>
                  <Button
                    className="bg-kendrah-purple hover:bg-kendrah-purple/90"
                    onClick={() => setDialogOpen(true)}
                  >
                    Novo Agendamento
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="py-3 px-4 text-left font-medium">Nome</th>
                  <th className="py-3 px-4 text-left font-medium">Contato</th>
                  <th className="py-3 px-4 text-left font-medium">Agendamentos</th>
                  <th className="py-3 px-4 text-left font-medium">Último atendimento</th>
                </tr>
              </thead>
              <tbody>
                {filteredClients.map((client) => (
                  <tr key={client.key} className="border-t hover:bg-muted/50">
                    <td className="py-3 px-4 font-medium">{client.name}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Mail size={14} /> {client.email}
                      </div>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Phone size={14} /> {client.phone}
                      </div>
                    </td>
                    <td className="py-3 px-4">{client.totalAppointments}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1">
                        <CalendarDays size={14} className="text-muted-foreground" />
                        {format(client.lastAppointment, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <NewAppointmentDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </div>
    </DashboardLayout>
  );
};

export default ClientsPage;
