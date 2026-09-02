import { useState, useCallback, useEffect } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Calendar, momentLocalizer, Views } from 'react-big-calendar';
import moment from 'moment';
import 'moment/locale/pt-br'; // Import Portuguese (Brazil) locale
import 'react-big-calendar/lib/css/react-big-calendar.css';
import './appointment-calendar.css';
import { CalendarEvent } from '@/types';
import AppointmentModal from './AppointmentModal';

// Setup the localizer for react-big-calendar with Portuguese (Brazil) locale
moment.locale('pt-br');
const localizer = momentLocalizer(moment);

// Customize calendar messages for Portuguese (Brazil)
const messages = {
  allDay: 'Dia inteiro',
  previous: 'Anterior',
  next: 'Próximo',
  today: 'Hoje',
  month: 'Mês',
  week: 'Semana',
  day: 'Dia',
  agenda: 'Agenda',
  date: 'Data',
  time: 'Hora',
  event: 'Evento',
  noEventsInRange: 'Não há eventos neste período',
  showMore: total => `+ ${total} evento(s)`
};

// Format dates in Brazilian format (DD/MM/YYYY)
const formats = {
  dateFormat: 'DD/MM/YYYY',
  dayFormat: 'DD ddd',
  monthHeaderFormat: 'MMMM YYYY',
  dayHeaderFormat: 'dddd, DD [de] MMMM [de] YYYY',
  dayRangeHeaderFormat: ({
    start,
    end
  }) => `${moment(start).format('DD MMM')} — ${moment(end).format('DD MMM YYYY')}`
};
interface AppointmentCalendarProps {
  events: CalendarEvent[];
  onEventClick?: (event: CalendarEvent) => void;
}
const AppointmentCalendar = ({
  events
}: AppointmentCalendarProps) => {
  const isMobile = useIsMobile();
  const [view, setView] = useState(Views.WEEK);
  const [date, setDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  // Switch to a readable view when on small screens
  useEffect(() => {
    setView(isMobile ? Views.DAY : Views.WEEK);
  }, [isMobile]);

  const handleEventClick = useCallback((event: CalendarEvent) => {
    setSelectedEvent(event);
  }, []);
  const closeModal = useCallback(() => {
    setSelectedEvent(null);
  }, []);
  const eventStyleGetter = useCallback(() => {
    return {
      className: 'bg-kendrah-purple',
      style: {
        borderRadius: '4px',
        opacity: 0.9,
        color: 'white',
        border: '0',
        fontSize: '0.9em',
        padding: '1px 5px'
      }
    };
  }, []);
  return <div className="calendar-container rounded-lg shadow border border-kendrah-gray/40 h-[520px] sm:h-[620px] lg:h-[700px] flex flex-col bg-transparent overflow-x-auto">
      <Calendar localizer={localizer} events={events} startAccessor="start" endAccessor="end" style={{
      height: '100%',
      minWidth: isMobile ? '320px' : undefined
    }} views={isMobile ? ['day', 'week'] : ['month', 'week', 'day']} defaultView={Views.WEEK} onView={setView} view={view} date={date} onNavigate={setDate} onSelectEvent={handleEventClick} eventPropGetter={eventStyleGetter} tooltipAccessor={event => `${event.title}`} popup messages={messages} formats={formats} />
      
      {selectedEvent && <AppointmentModal appointment={selectedEvent.resource} isOpen={Boolean(selectedEvent)} onClose={closeModal} />}
    </div>;
};
export default AppointmentCalendar;
