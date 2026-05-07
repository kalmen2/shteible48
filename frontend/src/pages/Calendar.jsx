import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Plus, Trash2, Check, Pencil, ChevronsUpDown } from 'lucide-react';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
} from 'date-fns';
import { toLocalDate } from '@/utils/dates';
import {
  getHebrewDate,
  isShabbat,
  isErevShabbat,
  getParsha,
  getParshaMapByDate,
  hebrewDateToGregorian,
  getHebrewMonthsList,
  getHolidaysByDate,
} from '../components/calendar/hebrewDateConverter';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

const createDefaultRole = () => ({ role_name: '', payment_type: 'flexible', fixed_amount: 0 });

const createDefaultEventHonors = () => [
  {
    name: '',
    roles: [createDefaultRole()],
  },
];

const normalizeEventHonors = (honors = []) => {
  if (!Array.isArray(honors) || honors.length === 0) {
    return createDefaultEventHonors();
  }

  return honors.map((honor) => {
    const roles = Array.isArray(honor?.roles) ? honor.roles : [];
    return {
      name: honor?.name || '',
      roles:
        roles.length > 0
          ? roles.map((role) => ({
              role_name: role?.role_name || '',
              payment_type: role?.payment_type === 'fixed' ? 'fixed' : 'flexible',
              fixed_amount: Number(role?.fixed_amount) || 0,
            }))
          : [createDefaultRole()],
    };
  });
};

export default function Calendar() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [calendarMode, setCalendarMode] = useState('english'); // "english" or "hebrew"
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState('');
  const [honorData, setHonorData] = useState({});
  const [activeAssigneePicker, setActiveAssigneePicker] = useState(null);
  const [newEventDialogOpen, setNewEventDialogOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState(null);
  const [newEventName, setNewEventName] = useState('');
  const [newEventHonors, setNewEventHonors] = useState(createDefaultEventHonors());

  const queryClient = useQueryClient();

  const { data: members = [] } = useQuery({
    queryKey: ['members'],
    queryFn: () => base44.entities.Member.list('-full_name', 1000),
  });

  const { data: guests = [] } = useQuery({
    queryKey: ['guests'],
    queryFn: () => base44.entities.Guest.list('full_name', 1000),
  });

  const { data: customEvents = [] } = useQuery({
    queryKey: ['inputTypes'],
    queryFn: () => base44.entities.InputType.list('name', 1000),
  });

  const { data: allTransactions = [] } = useQuery({
    queryKey: ['allTransactions'],
    queryFn: () => base44.entities.Transaction.listAll('-date'),
  });

  const { data: allGuestTransactions = [] } = useQuery({
    queryKey: ['guestTransactions'],
    queryFn: () => base44.entities.GuestTransaction.listAll('-date'),
  });

  const peopleOptions = [
    ...members.map((member) => ({
      key: `member:${member.id}`,
      id: member.id,
      type: 'member',
      displayName:
        member.full_name ||
        member.english_name ||
        member.hebrew_name ||
        member.member_id ||
        'Unnamed member',
      searchText: [
        member.full_name,
        member.english_name,
        member.hebrew_name,
        member.email,
        member.member_id,
      ]
        .filter(Boolean)
        .join(' '),
    })),
    ...guests.map((guest) => ({
      key: `guest:${guest.id}`,
      id: guest.id,
      type: 'guest',
      displayName: guest.full_name || guest.email || guest.phone || 'Unnamed guest',
      searchText: [guest.full_name, guest.email, guest.phone].filter(Boolean).join(' '),
    })),
  ].sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));

  const peopleByKey = peopleOptions.reduce((acc, person) => {
    acc[person.key] = person;
    return acc;
  }, {});

  const memberOptions = peopleOptions.filter((person) => person.type === 'member');
  const guestOptions = peopleOptions.filter((person) => person.type === 'guest');

  const transactionsForSelectedDate = selectedDate
    ? [
        ...allTransactions.filter((transaction) => transaction.date === selectedDate),
        ...allGuestTransactions.filter((transaction) => transaction.date === selectedDate),
      ]
    : [];

  const transactionCountByDate = useMemo(() => {
    const counts = {};
    for (const transaction of allTransactions) {
      if (!transaction?.date) continue;
      counts[transaction.date] = (counts[transaction.date] || 0) + 1;
    }
    for (const transaction of allGuestTransactions) {
      if (!transaction?.date) continue;
      counts[transaction.date] = (counts[transaction.date] || 0) + 1;
    }
    return counts;
  }, [allTransactions, allGuestTransactions]);

  const currentYear = currentMonth.getFullYear();
  const currentMonthNum = currentMonth.getMonth();

  const years = Array.from({ length: 10 }, (_, i) => currentYear - 2 + i);
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const englishWeekdays = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  const hebrewWeekdays = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'];

  // Hebrew calendar navigation
  const currentHebrewDate = getHebrewDate(currentMonth);
  const hebrewYears = Array.from({ length: 10 }, (_, i) => currentHebrewDate.year - 2 + i);
  const hebrewMonthsList = getHebrewMonthsList(currentHebrewDate.year);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);

  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const [holidayMap, setHolidayMap] = useState({});
  const [parshaMap, setParshaMap] = useState({});

  useEffect(() => {
    const start = startOfWeek(startOfMonth(currentMonth));
    const end = endOfWeek(endOfMonth(currentMonth));
    const map = getHolidaysByDate(start, end);
    setHolidayMap(map);
  }, [currentMonth]);

  useEffect(() => {
    const start = startOfWeek(startOfMonth(currentMonth));
    const end = endOfWeek(endOfMonth(currentMonth));
    const map = getParshaMapByDate(start, end, { locale: 'he-x-NoNikud' });
    setParshaMap(map);
  }, [currentMonth]);

  const handleDateClick = (date) => {
    setSelectedDate(format(date, 'yyyy-MM-dd'));
    setTransactionDialogOpen(true);
    setSelectedEvent('');
    setHonorData({});
  };

  const handleHonorChange = (honorName, roleIndex, field, value) => {
    setHonorData((prev) => ({
      ...prev,
      [honorName]: {
        ...prev[honorName],
        [roleIndex]: {
          ...prev[honorName]?.[roleIndex],
          [field]: value,
        },
      },
    }));
  };

  const handleSubmitTransactions = () => {
    const transactions = [];
    Object.entries(honorData).forEach(([honorName, rolesData]) => {
      Object.entries(rolesData).forEach(([roleIndex, data]) => {
        const honor = currentHonors.find((h) => h.name === honorName);
        const role = honor?.roles[roleIndex];
        const rawAmount = data.amount ?? (role?.payment_type === 'fixed' ? role.fixed_amount : '');
        const amount = Number(rawAmount);
        const assigneeKey = data.assigneeKey || data.memberId || '';
        const assignee = peopleByKey[assigneeKey];
        if (assignee && Number.isFinite(amount) && amount > 0) {
          transactions.push({
            honor: honorName,
            role: role?.role_name || '',
            assigneeType: assignee.type,
            assigneeId: assignee.id,
            assigneeName: assignee.displayName,
            amount,
          });
        }
      });
    });

    if (transactions.length > 0) {
      saveTransactionsMutation.mutate(transactions);
    }
  };

  const resetEventForm = () => {
    setEditingEventId(null);
    setNewEventName('');
    setNewEventHonors(createDefaultEventHonors());
  };

  const openCreateEventDialog = () => {
    resetEventForm();
    setNewEventDialogOpen(true);
  };

  const handleEventDialogOpenChange = (open) => {
    setNewEventDialogOpen(open);
    if (!open) {
      resetEventForm();
    }
  };

  const handleSubmitEvent = (e) => {
    e.preventDefault();
    const filteredHonors = newEventHonors
      .filter((h) => h.name.trim() !== '' && h.roles.some((r) => r.role_name.trim() !== ''))
      .map((h) => ({
        ...h,
        roles: h.roles.filter((r) => r.role_name.trim() !== ''),
      }));

    const trimmedName = newEventName.trim();
    if (!trimmedName || filteredHonors.length === 0) {
      return;
    }

    const payload = {
      name: trimmedName,
      honors: filteredHonors,
      is_custom: true,
    };

    if (editingEventId) {
      updateEventMutation.mutate({ eventId: editingEventId, eventData: payload });
      return;
    }

    createEventMutation.mutate(payload);
  };

  const selectedEventData = selectedEvent
    ? customEvents.find((e) => e.name === selectedEvent)
    : null;
  const currentHonors = selectedEventData?.honors || [];

  const createEventMutation = useMutation({
    mutationFn: (eventData) => base44.entities.InputType.create(eventData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inputTypes'] });
      setNewEventDialogOpen(false);
      resetEventForm();
    },
    onError: (error) => {
      alert(error?.message || 'Failed to create event. Please try again.');
    },
  });

  const updateEventMutation = useMutation({
    mutationFn: ({ eventId, eventData }) => base44.entities.InputType.update(eventId, eventData),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['inputTypes'] });
      setSelectedEvent(variables.eventData.name);
      setHonorData({});
      setNewEventDialogOpen(false);
      resetEventForm();
    },
    onError: (error) => {
      alert(error?.message || 'Failed to update event. Please try again.');
    },
  });

  const deleteEventMutation = useMutation({
    mutationFn: (eventId) => base44.entities.InputType.delete(eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inputTypes'] });
      setSelectedEvent('');
      setHonorData({});
    },
    onError: (error) => {
      console.error('deleteEventMutation failed', error);
      queryClient.invalidateQueries({ queryKey: ['inputTypes'] });
      alert(error?.message || 'Failed to delete event. Please try again.');
    },
  });

  const isSavingEvent = createEventMutation.isPending || updateEventMutation.isPending;

  const saveTransactionsMutation = useMutation({
    mutationFn: async (transactions) => {
      for (const transaction of transactions) {
        const description = `${selectedEvent} - ${transaction.honor}${transaction.role ? ` (${transaction.role})` : ''}`;
        const amount = parseFloat(transaction.amount);

        if (transaction.assigneeType === 'guest') {
          await base44.entities.GuestTransaction.create({
            guest_id: transaction.assigneeId,
            guest_name: transaction.assigneeName,
            type: 'charge',
            description,
            amount,
            date: selectedDate,
            category: selectedEvent,
          });
          continue;
        }

        await base44.entities.Transaction.create({
          member_id: transaction.assigneeId,
          member_name: transaction.assigneeName,
          type: 'charge',
          description,
          amount,
          date: selectedDate,
          category: selectedEvent,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members'] });
      queryClient.invalidateQueries({ queryKey: ['guests'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['allTransactions'] });
      queryClient.invalidateQueries({ queryKey: ['guestTransactions'] });
      setHonorData({});
      setSelectedEvent('');
      setActiveAssigneePicker(null);
    },
  });

  const getWeekParsha = (date) => {
    return getParsha(date);
  };

  const selectedDateObj = toLocalDate(selectedDate);
  const selectedWeekParsha = selectedDateObj ? getWeekParsha(selectedDateObj) : null;
  const weekdayLabels = calendarMode === 'hebrew' ? hebrewWeekdays : englishWeekdays;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_15%_15%,rgba(125,211,252,0.22),transparent_35%),radial-gradient(circle_at_85%_5%,rgba(56,189,248,0.18),transparent_30%),linear-gradient(135deg,#f8fafc_0%,#eef2ff_48%,#e2e8f0_100%)]">
      <div className="mx-auto max-w-7xl px-4 py-4 md:px-6 md:py-5">
        <Card className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white/80 shadow-[0_22px_56px_rgba(15,23,42,0.14)] backdrop-blur-md">
          <CardHeader className="relative overflow-hidden border-b border-sky-200/30 bg-gradient-to-br from-slate-950 via-blue-900 to-cyan-800 p-4 text-white md:p-5">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute -top-24 right-12 h-52 w-52 rounded-full bg-cyan-300/25 blur-3xl" />
              <div className="absolute bottom-[-120px] left-[-40px] h-64 w-64 rounded-full bg-blue-300/20 blur-3xl" />
            </div>

            <div className="relative z-10">
              <div className="mb-3 flex justify-center">
                <div className="inline-flex rounded-2xl border border-white/20 bg-white/10 p-1 backdrop-blur">
                <button
                  onClick={() => setCalendarMode('english')}
                  className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all md:text-sm ${
                    calendarMode === 'english'
                      ? 'bg-white text-blue-950 shadow-sm'
                      : 'text-blue-100/90 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  English Calendar
                </button>
                <button
                  onClick={() => setCalendarMode('hebrew')}
                  className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all md:text-sm ${
                    calendarMode === 'hebrew'
                      ? 'bg-white text-blue-950 shadow-sm'
                      : 'text-blue-100/90 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  Hebrew Calendar
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 flex-shrink-0 rounded-xl border border-white/20 bg-white/10 text-white hover:bg-white/20"
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              {calendarMode === 'english' ? (
                <div className="flex flex-1 items-center justify-center gap-2.5">
                  <select
                    value={currentMonthNum}
                    onChange={(e) =>
                      setCurrentMonth(new Date(currentYear, parseInt(e.target.value), 1))
                    }
                    className="cursor-pointer rounded-xl border border-white/25 bg-white/15 px-3 py-1.5 text-sm font-medium text-white backdrop-blur hover:bg-white/20"
                  >
                    {months.map((month, idx) => (
                      <option key={idx} value={idx} className="bg-blue-900">
                        {month}
                      </option>
                    ))}
                  </select>

                  <select
                    value={currentYear}
                    onChange={(e) =>
                      setCurrentMonth(new Date(parseInt(e.target.value), currentMonthNum, 1))
                    }
                    className="cursor-pointer rounded-xl border border-white/25 bg-white/15 px-3 py-1.5 text-sm font-medium text-white backdrop-blur hover:bg-white/20"
                  >
                    {years.map((year) => (
                      <option key={year} value={year} className="bg-blue-900">
                        {year}
                      </option>
                    ))}
                  </select>

                  <div className="ml-1 text-xs text-blue-100/90 md:text-sm">
                    ({currentHebrewDate.month} {currentHebrewDate.year})
                  </div>
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center gap-2.5">
                  <select
                    value={currentHebrewDate.monthNum}
                    onChange={(e) => {
                      const newDate = hebrewDateToGregorian(
                        currentHebrewDate.year,
                        parseInt(e.target.value),
                        1
                      );
                      setCurrentMonth(newDate);
                    }}
                    className="cursor-pointer rounded-xl border border-white/25 bg-white/15 px-3 py-1.5 text-sm font-medium text-white backdrop-blur hover:bg-white/20"
                  >
                    {hebrewMonthsList.map((month, idx) => (
                      <option key={idx} value={idx + 1} className="bg-blue-900">
                        {month}
                      </option>
                    ))}
                  </select>

                  <select
                    value={currentHebrewDate.year}
                    onChange={(e) => {
                      const newDate = hebrewDateToGregorian(
                        parseInt(e.target.value),
                        currentHebrewDate.monthNum,
                        1
                      );
                      setCurrentMonth(newDate);
                    }}
                    className="cursor-pointer rounded-xl border border-white/25 bg-white/15 px-3 py-1.5 text-sm font-medium text-white backdrop-blur hover:bg-white/20"
                  >
                    {hebrewYears.map((year) => (
                      <option key={year} value={year} className="bg-blue-900">
                        {year}
                      </option>
                    ))}
                  </select>

                  <div className="ml-1 text-xs text-blue-100/90 md:text-sm">
                    ({format(currentMonth, 'MMM yyyy')})
                  </div>
                </div>
              )}

              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 flex-shrink-0 rounded-xl border border-white/20 bg-white/10 text-white hover:bg-white/20"
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            </div>
          </CardHeader>
          <CardContent className="p-5 md:p-6">
            <>
              <div className="mb-3 grid grid-cols-7 gap-1.5">
                {weekdayLabels.map((day, i) => (
                  <div
                    key={i}
                    className={`rounded-lg py-2.5 text-center text-xs font-semibold tracking-wide ${i === 6 ? 'bg-blue-100 text-blue-900' : 'bg-slate-100/80 text-slate-700'}`}
                  >
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1.5">
                {days.map((day, i) => {
                  const isCurrentMonth = isSameMonth(day, currentMonth);
                  const isToday = isSameDay(day, new Date());
                  const isSaturday = isShabbat(day);
                  const isFriday = isErevShabbat(day);
                  const isSelected = selectedDateObj ? isSameDay(day, selectedDateObj) : false;
                  const hebrewDay = getHebrewDate(day);
                  const dateKey = format(day, 'yyyy-MM-dd');
                  const parsha = isSaturday ? parshaMap[dateKey] : null;
                  const holidayNames = holidayMap[dateKey];
                  const dayTransactionCount = transactionCountByDate[dateKey] || 0;

                  return (
                    <button
                      key={i}
                      onClick={() => handleDateClick(day)}
                      disabled={!isCurrentMonth}
                      className={`
                        min-h-[96px] rounded-xl border p-3 transition-all duration-200 md:min-h-[104px]
                        flex flex-col items-start justify-between
                        ${!isCurrentMonth ? 'cursor-not-allowed border-slate-200/60 bg-slate-100/70 opacity-35' : 'cursor-pointer border-slate-200 bg-white/90 shadow-sm'}
                        ${isCurrentMonth ? 'hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-lg hover:shadow-blue-100/70' : ''}
                        ${isSelected ? 'border-blue-600 bg-gradient-to-b from-blue-50 to-cyan-50 shadow-lg shadow-blue-100/60' : ''}
                        ${isToday && !isSelected ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-400/80' : ''}
                        ${isSaturday && isCurrentMonth ? 'border-blue-300 bg-blue-50/85' : ''}
                        ${isFriday && isCurrentMonth ? 'bg-sky-50/80' : ''}
                      `}
                    >
                      <div className="flex flex-col items-start w-full">
                        <span
                          className={`text-lg font-bold ${
                            isToday
                              ? 'text-amber-700'
                              : isSaturday
                                ? 'text-blue-900'
                                : 'text-slate-900'
                          }`}
                        >
                          {format(day, 'd')}
                        </span>
                        <span className="mt-1 text-xs text-slate-500">
                          {hebrewDay.dayHebrew || hebrewDay.day} {hebrewDay.month}
                        </span>
                        {isCurrentMonth && dayTransactionCount > 0 && (
                          <span className="mt-1 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800">
                            {dayTransactionCount} tx
                          </span>
                        )}
                      </div>
                      {isSaturday && isCurrentMonth && parsha && (
                        <div className="flex flex-col items-start">
                          <span className="text-xs font-semibold text-blue-700">{parsha}</span>
                        </div>
                      )}
                      {isCurrentMonth && holidayNames?.length ? (
                        <div className="mt-1.5 rounded-md bg-amber-50/80 px-1.5 py-0.5 text-left text-[10px] font-semibold text-amber-700 line-clamp-2">
                          {holidayNames.join(', ')}
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </>
          </CardContent>
        </Card>


        {/* Transaction Dialog */}
        <Dialog open={transactionDialogOpen} onOpenChange={setTransactionDialogOpen} modal={false}>
          <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto rounded-3xl border border-slate-200/80 bg-white/95 shadow-2xl shadow-slate-300/30">
            <DialogHeader className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
              <DialogTitle className="text-xl font-bold text-slate-900">Add Transactions</DialogTitle>
              {selectedDateObj && (
                <DialogDescription className="text-slate-600">
                  {format(selectedDateObj, 'MMMM d, yyyy')} • {format(selectedDateObj, 'EEEE')}
                  {selectedWeekParsha ? ` - ${selectedWeekParsha}` : ''}
                </DialogDescription>
              )}
            </DialogHeader>
            <div>
              <div className="mb-6" aria-hidden>
                {/* spacing retained */}
              </div>

              {/* Event Selection */}
              <div className="mb-6 space-y-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <Label className="text-lg font-semibold">Event Selection</Label>
                  <div className="flex items-center gap-2">
                    {selectedEventData && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingEventId(selectedEventData.id);
                            setNewEventName(selectedEventData.name || '');
                            setNewEventHonors(normalizeEventHonors(selectedEventData.honors));
                            setNewEventDialogOpen(true);
                          }}
                          disabled={deleteEventMutation.isPending || isSavingEvent}
                        >
                          <Pencil className="w-4 h-4 mr-2" />
                          Edit Event
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const ok = window.confirm(
                              `Delete the event "${selectedEventData.name}"?`
                            );
                            if (!ok) return;
                            deleteEventMutation.mutate(selectedEventData.id);
                          }}
                          className="text-red-600 hover:text-red-700"
                          disabled={deleteEventMutation.isPending || isSavingEvent}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          {deleteEventMutation.isPending ? 'Deleting...' : 'Delete Event'}
                        </Button>
                      </>
                    )}
                    <Dialog open={newEventDialogOpen} onOpenChange={handleEventDialogOpenChange}>
                      <Button
                        onClick={openCreateEventDialog}
                        className="bg-blue-900 hover:bg-blue-800"
                        size="sm"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Event Type
                      </Button>
                      <DialogContent className="max-w-2xl">
                        <div style={{maxHeight: '70vh', overflowY: 'auto'}}>
                        <DialogHeader>
                          <DialogTitle>
                            {editingEventId ? 'Edit Event Type' : 'Create New Event Type'}
                          </DialogTitle>
                          <DialogDescription>
                            {editingEventId
                              ? 'Update the event name and its honors/roles.'
                              : 'Define an event name and its honors/roles.'}
                          </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleSubmitEvent} className="space-y-6">
                          <div className="space-y-2">
                            <Label htmlFor="eventName">Event Name *</Label>
                            <Input
                              id="eventName"
                              value={newEventName}
                              onChange={(e) => setNewEventName(e.target.value)}
                              placeholder="e.g., Chanukah, Bar Mitzvah, etc."
                              required
                              className="h-11"
                            />
                          </div>
                          <div className="space-y-3">
                            <Label>Honor Options and Roles *</Label>
                            {newEventHonors.map((honor, honorIndex) => (
                              <div
                                key={honorIndex}
                                className="border border-slate-200 rounded-lg p-4 space-y-3"
                              >
                                <div className="flex gap-2">
                                  <Input
                                    value={honor.name}
                                    onChange={(e) => {
                                      const updated = [...newEventHonors];
                                      updated[honorIndex].name = e.target.value;
                                      setNewEventHonors(updated);
                                    }}
                                    placeholder={`Honor ${honorIndex + 1}`}
                                    className="h-11 flex-1"
                                  />
                                  {newEventHonors.length > 1 && (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="icon"
                                      onClick={() =>
                                        setNewEventHonors(
                                          newEventHonors.filter((_, i) => i !== honorIndex)
                                        )
                                      }
                                      className="h-11 w-11"
                                    >
                                      <Trash2 className="w-4 h-4 text-red-600" />
                                    </Button>
                                  )}
                                </div>

                                <div className="space-y-2 pl-4 border-l-2 border-blue-200">
                                  <Label className="text-sm text-slate-600">Roles</Label>
                                  {honor.roles.map((role, roleIndex) => (
                                    <div key={roleIndex} className="flex gap-2 items-end">
                                      <div className="flex-1">
                                        <Input
                                          value={role.role_name}
                                          onChange={(e) => {
                                            const updated = [...newEventHonors];
                                            updated[honorIndex].roles[roleIndex].role_name =
                                              e.target.value;
                                            setNewEventHonors(updated);
                                          }}
                                          placeholder="Role (e.g., Buyer, Recipient)"
                                          className="h-10"
                                        />
                                      </div>
                                      <Select
                                        value={role.payment_type}
                                        onValueChange={(value) => {
                                          const updated = [...newEventHonors];
                                          updated[honorIndex].roles[roleIndex].payment_type = value;
                                          setNewEventHonors(updated);
                                        }}
                                      >
                                        <SelectTrigger className="h-10 w-32">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="flexible">Flexible</SelectItem>
                                          <SelectItem value="fixed">Fixed</SelectItem>
                                        </SelectContent>
                                      </Select>
                                      {role.payment_type === 'fixed' && (
                                        <Input
                                          type="number"
                                          step="0.01"
                                          value={role.fixed_amount || ''}
                                          onChange={(e) => {
                                            const updated = [...newEventHonors];
                                            updated[honorIndex].roles[roleIndex].fixed_amount =
                                              parseFloat(e.target.value) || 0;
                                            setNewEventHonors(updated);
                                          }}
                                          placeholder="Amount"
                                          className="h-10 w-24"
                                        />
                                      )}
                                      {honor.roles.length > 1 && (
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          onClick={() => {
                                            const updated = [...newEventHonors];
                                            updated[honorIndex].roles = updated[
                                              honorIndex
                                            ].roles.filter((_, i) => i !== roleIndex);
                                            setNewEventHonors(updated);
                                          }}
                                          className="h-10 w-10"
                                        >
                                          <Trash2 className="w-4 h-4 text-red-600" />
                                        </Button>
                                      )}
                                    </div>
                                  ))}
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      const updated = [...newEventHonors];
                                      updated[honorIndex].roles.push({
                                        role_name: '',
                                        payment_type: 'flexible',
                                        fixed_amount: 0,
                                      });
                                      setNewEventHonors(updated);
                                    }}
                                    className="w-full border-dashed"
                                  >
                                    <Plus className="w-3 h-3 mr-2" />
                                    Add Role
                                  </Button>
                                </div>
                              </div>
                            ))}
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() =>
                                setNewEventHonors([
                                  ...newEventHonors,
                                  {
                                    name: '',
                                    roles: [
                                      { role_name: '', payment_type: 'flexible', fixed_amount: 0 },
                                    ],
                                  },
                                ])
                              }
                              className="w-full border-dashed"
                            >
                              <Plus className="w-4 h-4 mr-2" />
                              Add Another Honor
                            </Button>
                          </div>
                          <div className="flex justify-end gap-3">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => handleEventDialogOpenChange(false)}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="submit"
                              className="bg-blue-900 hover:bg-blue-800"
                              disabled={isSavingEvent}
                            >
                              {isSavingEvent
                                ? 'Saving...'
                                : editingEventId
                                  ? 'Save Changes'
                                  : 'Create Event'}
                            </Button>
                          </div>
                        </form>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>

                <Select
                  value={selectedEvent}
                  onValueChange={(value) => {
                    setSelectedEvent(value);
                    setHonorData({});
                  }}
                >
                  <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white shadow-sm">
                    <SelectValue placeholder="Choose an event..." />
                  </SelectTrigger>
                  <SelectContent>
                    {customEvents.length === 0 ? (
                      <div className="px-4 py-8 text-center text-sm text-slate-500">
                        No events yet. Create your first event to get started.
                      </div>
                    ) : (
                      customEvents.map((event) => (
                        <SelectItem key={event.id} value={event.name}>
                          {event.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Honors Table */}
              {selectedEvent && currentHonors.length > 0 && (
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-3">
                    <h3 className="font-semibold text-slate-900">{selectedEvent} - Honors</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="border-b border-slate-200 bg-slate-50/80">
                        <tr>
                          <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                            Honor
                          </th>
                          <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                            Role
                          </th>
                          <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                            Person
                          </th>
                          <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100/90">
                        {currentHonors.map((honor) =>
                          honor.roles.map((role, roleIndex) => {
                            const rowKey = `${honor.name}-${roleIndex}`;
                            const selectedAssigneeKey =
                              honorData[honor.name]?.[roleIndex]?.assigneeKey ||
                              honorData[honor.name]?.[roleIndex]?.memberId ||
                              '';
                            const selectedAssignee = peopleByKey[selectedAssigneeKey];

                            return (
                              <tr key={rowKey}>
                              {roleIndex === 0 && (
                                <td
                                  className="py-3 px-4 font-medium text-slate-900"
                                  rowSpan={honor.roles.length}
                                >
                                  {honor.name}
                                </td>
                              )}
                              <td className="py-3 px-4 text-slate-700">
                                <div className="flex items-center gap-2">
                                  <span>{role.role_name}</span>
                                  {role.payment_type === 'fixed' && (
                                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                                      Fixed: ${role.fixed_amount}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <Popover
                                  open={activeAssigneePicker === rowKey}
                                  onOpenChange={(open) =>
                                    setActiveAssigneePicker(open ? rowKey : null)
                                  }
                                >
                                  <PopoverTrigger asChild>
                                    <Button
                                      variant="outline"
                                      role="combobox"
                                      aria-expanded={activeAssigneePicker === rowKey}
                                      className="h-10 w-full justify-between font-normal"
                                    >
                                      <span className="truncate">
                                        {selectedAssignee ? selectedAssignee.displayName : 'Select person...'}
                                      </span>
                                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] rounded-xl border-slate-200 p-0 shadow-lg" align="start">
                                    <Command>
                                      <CommandInput placeholder="Type a name..." />
                                      <CommandList>
                                        <CommandEmpty>No person found.</CommandEmpty>
                                        {memberOptions.length > 0 && (
                                          <CommandGroup heading="Members">
                                            {memberOptions.map((person) => (
                                              <CommandItem
                                                key={person.key}
                                                value={`${person.displayName} ${person.searchText} member`}
                                                onSelect={() => {
                                                  handleHonorChange(
                                                    honor.name,
                                                    roleIndex,
                                                    'assigneeKey',
                                                    person.key
                                                  );
                                                  setActiveAssigneePicker(null);
                                                }}
                                              >
                                                <Check
                                                  className={cn(
                                                    'mr-2 h-4 w-4',
                                                    selectedAssigneeKey === person.key
                                                      ? 'opacity-100'
                                                      : 'opacity-0'
                                                  )}
                                                />
                                                <span className="truncate">{person.displayName}</span>
                                              </CommandItem>
                                            ))}
                                          </CommandGroup>
                                        )}
                                        {guestOptions.length > 0 && (
                                          <CommandGroup heading="Guests">
                                            {guestOptions.map((person) => (
                                              <CommandItem
                                                key={person.key}
                                                value={`${person.displayName} ${person.searchText} guest`}
                                                onSelect={() => {
                                                  handleHonorChange(
                                                    honor.name,
                                                    roleIndex,
                                                    'assigneeKey',
                                                    person.key
                                                  );
                                                  setActiveAssigneePicker(null);
                                                }}
                                              >
                                                <Check
                                                  className={cn(
                                                    'mr-2 h-4 w-4',
                                                    selectedAssigneeKey === person.key
                                                      ? 'opacity-100'
                                                      : 'opacity-0'
                                                  )}
                                                />
                                                <span className="truncate">{person.displayName}</span>
                                              </CommandItem>
                                            ))}
                                          </CommandGroup>
                                        )}
                                      </CommandList>
                                    </Command>
                                  </PopoverContent>
                                </Popover>
                              </td>
                              <td className="py-3 px-4">
                                <Input
                                  type="number"
                                  step="0.01"
                                  placeholder={
                                    role.payment_type === 'fixed'
                                      ? role.fixed_amount.toString()
                                      : '0.00'
                                  }
                                  value={
                                    honorData[honor.name]?.[roleIndex]?.amount ||
                                    (role.payment_type === 'fixed' ? role.fixed_amount : '')
                                  }
                                  onChange={(e) =>
                                    handleHonorChange(
                                      honor.name,
                                      roleIndex,
                                      'amount',
                                      e.target.value
                                    )
                                  }
                                  className="h-10"
                                  readOnly={role.payment_type === 'fixed'}
                                />
                              </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="p-4 bg-slate-50 border-t border-slate-200">
                    <Button
                      onClick={handleSubmitTransactions}
                      disabled={
                        Object.keys(honorData).length === 0 || saveTransactionsMutation.isPending
                      }
                      className="h-11 w-full rounded-xl bg-blue-900 hover:bg-blue-800"
                    >
                      <Check className="w-5 h-5 mr-2" />
                      {saveTransactionsMutation.isPending ? 'Saving...' : 'Save All Transactions'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Existing Transactions for Selected Date */}
              {selectedDate && (
                <div className="mt-6 pt-6 border-t border-slate-200">
                  <h3 className="text-lg font-semibold text-slate-900 mb-3">
                    Transactions on this date
                  </h3>
                  {transactionsForSelectedDate.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-center text-slate-500">
                      No transactions recorded for this date yet.
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                      <table className="w-full">
                        <thead className="border-b border-slate-200 bg-slate-50/80">
                          <tr>
                            <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                              Event/Honor
                            </th>
                            <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                              Person
                            </th>
                            <th className="text-right py-3 px-4 text-sm font-semibold text-slate-700">
                              Amount
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {transactionsForSelectedDate
                            .map((transaction) => (
                              <tr key={transaction.id} className="hover:bg-slate-50">
                                <td className="py-3 px-4">
                                  <div className="font-medium text-slate-900">
                                    {transaction.description}
                                  </div>
                                  {transaction.category && (
                                    <div className="text-xs text-blue-600">
                                      {transaction.category}
                                    </div>
                                  )}
                                </td>
                                <td className="py-3 px-4 text-slate-700">
                                  {transaction.member_name || transaction.guest_name || '-'}
                                </td>
                                <td className="py-3 px-4 text-right">
                                  <span
                                    className={`font-semibold ${transaction.type === 'charge' ? 'text-amber-600' : 'text-green-600'}`}
                                  >
                                    ${transaction.amount?.toFixed(2)}
                                  </span>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {!selectedEvent && (
                <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 py-8 text-center text-slate-500">
                  <p>Select an event above to add new transactions</p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
