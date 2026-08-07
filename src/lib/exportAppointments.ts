import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Appointment } from "@/types";

export const statusLabels: Record<Appointment["status"], string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  completed: "Concluído",
};

export const statusLabel = (status: Appointment["status"]) => statusLabels[status] ?? status;

export const monthLabel = (monthKey: string) => {
  if (monthKey === "all") return "Todos os meses";
  const [year, month] = monthKey.split("-").map(Number);
  return format(new Date(year, month - 1, 1), "MMMM 'de' yyyy", { locale: ptBR });
};

const rows = (appointments: Appointment[]) =>
  appointments
    .slice()
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    .map((a) => [
      format(new Date(a.start_time), "dd/MM/yyyy", { locale: ptBR }),
      format(new Date(a.start_time), "HH:mm", { locale: ptBR }),
      a.customer_name,
      a.customer_phone || "-",
      a.customer_email || "-",
      a.service_name,
      statusLabels[a.status] ?? a.status,
    ]);

const headers = ["Data", "Hora", "Cliente", "Telefone", "E-mail", "Serviço", "Status"];

const download = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const fileSuffix = (monthKey: string) =>
  monthKey === "all" ? "todos-os-meses" : monthKey;

export const exportAppointmentsCsv = (appointments: Appointment[], monthKey: string) => {
  const escape = (value: string) => `"${String(value).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows(appointments)]
    .map((row) => row.map(escape).join(";"))
    .join("\r\n");

  download(
    new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }),
    `agendamentos-${fileSuffix(monthKey)}.csv`
  );
};

export const exportAppointmentsPdf = (appointments: Appointment[], monthKey: string) => {
  const doc = new jsPDF({ orientation: "landscape" });

  doc.setFontSize(16);
  doc.text("Relatório de Agendamentos", 14, 16);
  doc.setFontSize(10);
  doc.text(`Período: ${monthLabel(monthKey)}`, 14, 23);
  doc.text(`Total de agendamentos: ${appointments.length}`, 14, 29);
  doc.text(
    `Gerado em ${format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`,
    14,
    35
  );

  autoTable(doc, {
    startY: 41,
    head: [headers],
    body: rows(appointments),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [124, 58, 237] },
  });

  doc.save(`agendamentos-${fileSuffix(monthKey)}.pdf`);
};
