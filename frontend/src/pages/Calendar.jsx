import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Plus, Trash2, Check } from 'lucide-react';
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
import {
  getHebrewDate,
  isShabbat,
  isErevShabbat,
  getParsha,
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
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export default function Calendar() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [calendarMode, setCalendarMode] = useState('english'); // "english" or "hebrew"
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState('');
  const [honorData, setHonorData] = useState({});
  const [newEventDialogOpen, setNewEventDialogOpen] = useState(false);
  const [newEventName, setNewEventName] = useState('');
  const [newEventHonors, setNewEventHonors] = useState([
    { name: '', roles: [{ role_name: '', payment_type: 'flexible', fixed_amount: 0 }] },
  ]);

  const queryClient = useQueryClient();

  const { data: members = [] } = useQuery({
    queryKey: ['members'],
    queryFn: () => base44.entities.Member.list('-full_name', 1000),
  });

  const { data: customEvents = [] } = useQuery({
    queryKey: ['inputTypes'],
    queryFn: () => base44.entities.InputType.list('name', 1000),
  });

  const { data: allTransactions = [] } = useQuery({
    queryKey: ['allTransactions'],
    queryFn: () => base44.entities.Transaction.listAll('-date'),
  });

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

  useEffect(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    const map = getHolidaysByDate(start, end);
    setHolidayMap(map);
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
        if (data.memberId && Number.isFinite(amount) && amount > 0) {
          const member = members.find((m) => m.id === data.memberId);
          transactions.push({
            honor: honorName,
            role: role?.role_name || '',
            memberId: data.memberId,
            memberName: member?.full_name || '',
            amount,
          });
        }
      });
    });

    if (transactions.length > 0) {
      saveTransactionsMutation.mutate(transactions);
    }
  };

  const handleCreateEvent = (e) => {
    e.preventDefault();
    const filteredHonors = newEventHonors
      .filter((h) => h.name.trim() !== '' && h.roles.some((r) => r.role_name.trim() !== ''))
      .map((h) => ({
        ...h,
        roles: h.roles.filter((r) => r.role_name.trim() !== ''),
      }));

    if (newEventName.trim() && filteredHonors.length > 0) {
      createEventMutation.mutate({
        name: newEventName.trim(),
        honors: filteredHonors,
        is_custom: true,
      });
    }
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
      setNewEventName('');
      setNewEventHonors([
        { name: '', roles: [{ role_name: '', payment_type: 'flexible', fixed_amount: 0 }] },
      ]);
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

  const saveTransactionsMutation = useMutation({
    mutationFn: async (transactions) => {
      for (const transaction of transactions) {
        await base44.entities.Transaction.create({
          member_id: transaction.memberId,
          member_name: transaction.memberName,
          type: 'charge',
          description: `${selectedEvent} - ${transaction.honor}${transaction.role ? ` (${transaction.role})` : ''}`,
          amount: parseFloat(transaction.amount),
          date: selectedDate,
          category: selectedEvent,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['allTransactions'] });
      setHonorData({});
      setSelectedEvent('');
    },
  });

  const getWeekParsha = (date) => {
    // Find the Shabbat of this week
    const dayOfWeek = date.getDay();
    const daysUntilShabbat = (6 - dayOfWeek + 7) % 7;
    const shabbat = new Date(date);
    shabbat.setDate(date.getDate() + daysUntilShabbat);
    return getParsha(shabbat);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <Card className="border-slate-200 shadow-lg">
          <CardHeader className="border-b border-slate-200 bg-gradient-to-r from-blue-900 to-blue-800 text-white">
            <div className="mb-4 flex justify-center">
              <div className="inline-flex rounded-lg bg-blue-800 p-1">
                <button
                  onClick={() => setCalendarMode('english')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    calendarMode === 'english'
                      ? 'bg-white text-blue-900 shadow-sm'
                      : 'text-blue-100 hover:text-white'
                  }`}
                >
                  English Calendar
                </button>
                <button
                  onClick={() => setCalendarMode('hebrew')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    calendarMode === 'hebrew'
                      ? 'bg-white text-blue-900 shadow-sm'
                      : 'text-blue-100 hover:text-white'
                  }`}
                >
                  Hebrew Calendar
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 text-white hover:bg-blue-800 flex-shrink-0"
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>

              {calendarMode === 'english' ? (
                <div className="flex items-center gap-3 flex-1 justify-center">
                  <select
                    value={currentMonthNum}
                    onChange={(e) =>
                      setCurrentMonth(new Date(currentYear, parseInt(e.target.value), 1))
                    }
                    className="px-4 py-2 border border-blue-700 rounded-lg font-medium bg-blue-800 text-white hover:bg-blue-700 cursor-pointer"
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
                    className="px-4 py-2 border border-blue-700 rounded-lg font-medium bg-blue-800 text-white hover:bg-blue-700 cursor-pointer"
                  >
                    {years.map((year) => (
                      <option key={year} value={year} className="bg-blue-900">
                        {year}
                      </option>
                    ))}
                  </select>

                  <div className="text-blue-100 text-sm ml-2">
                    ({currentHebrewDate.month} {currentHebrewDate.year})
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 flex-1 justify-center">
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
                    className="px-4 py-2 border border-blue-700 rounded-lg font-medium bg-blue-800 text-white hover:bg-blue-700 cursor-pointer"
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
                    className="px-4 py-2 border border-blue-700 rounded-lg font-medium bg-blue-800 text-white hover:bg-blue-700 cursor-pointer"
                  >
                    {hebrewYears.map((year) => (
                      <option key={year} value={year} className="bg-blue-900">
                        {year}
                      </option>
                    ))}
                  </select>

                  <div className="text-blue-100 text-sm ml-2">
                    ({format(currentMonth, 'MMM yyyy')})
                  </div>
                </div>
              )}

              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 text-white hover:bg-blue-800 flex-shrink-0"
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            {/* Day Headers */}
            <div className="grid grid-cols-7 gap-2 mb-4">
              {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Shabbat'].map(
                (day, i) => (
                  <div
                    key={i}
                    className={`text-center font-semibold py-3 ${
                      i === 6 ? 'text-blue-900' : 'text-slate-700'
                    }`}
                  >
                    {day}
                  </div>
                )
              )}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-2">
              {days.map((day, i) => {
                const isCurrentMonth = isSameMonth(day, currentMonth);
                const isToday = isSameDay(day, new Date());
                const isSaturday = isShabbat(day);
                const isFriday = isErevShabbat(day);
                const hebrewDay = getHebrewDate(day);
                const parsha = isSaturday ? getParsha(day) : null;
                const holidayNames = holidayMap[format(day, 'yyyy-MM-dd')];

                return (
                  <button
                    key={i}
                    onClick={() => handleDateClick(day)}
                    disabled={!isCurrentMonth}
                    className={`
                      min-h-[100px] p-3 rounded-lg border-2 transition-all
                      flex flex-col items-start justify-between
                      ${!isCurrentMonth ? 'bg-slate-50 border-slate-100 opacity-40 cursor-not-allowed' : 'bg-white border-slate-200'}
                      ${isCurrentMonth ? 'hover:border-blue-500 hover:shadow-md cursor-pointer' : ''}
                      ${isToday ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-500' : ''}
                      ${isSaturday && isCurrentMonth ? 'bg-blue-50 border-blue-300' : ''}
                      ${isFriday && isCurrentMonth ? 'bg-blue-50/50' : ''}
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
                      <span className="text-xs text-slate-500 mt-1">
                        {hebrewDay.dayHebrew || hebrewDay.day} {hebrewDay.month}
                      </span>
                    </div>
                    {isSaturday && isCurrentMonth && parsha && (
                      <div className="flex flex-col items-start">
                        <span className="text-xs font-semibold text-blue-700">{parsha}</span>
                      </div>
                    )}
                    {isCurrentMonth && holidayNames?.length ? (
                      <div className="mt-2 text-[10px] text-amber-700 font-semibold line-clamp-2 text-left">
                        {holidayNames.join(', ')}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="mt-6 pt-6 border-t border-slate-200">
              <div className="flex flex-wrap gap-6 text-sm">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded border-2 border-amber-500 bg-amber-50"></div>
                  <span className="text-slate-700">Today</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded border-2 border-blue-300 bg-blue-50"></div>
                  <span className="text-slate-700">Shabbat</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded border-2 border-blue-300 bg-blue-50/50"></div>
                  <span className="text-slate-700">Erev Shabbat (Friday)</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 text-center text-sm text-slate-500">
          Click any date to add transactions for that day
        </div>

        {/* Transaction Dialog */}
        <Dialog open={transactionDialogOpen} onOpenChange={setTransactionDialogOpen}>
          <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Transactions</DialogTitle>
              {selectedDate && (
                <DialogDescription>
                  {format(new Date(selectedDate), 'MMMM d, yyyy')} •{' '}
                  {format(new Date(selectedDate), 'EEEE')} - {getWeekParsha(new Date(selectedDate))}
                </DialogDescription>
              )}
            </DialogHeader>
            <div>
              <div className="mb-6" aria-hidden>
                {/* spacing retained */}
              </div>

              {/* Event Selection */}
              <div className="mb-6 space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-lg font-semibold">Select Event</Label>
                  <div className="flex items-center gap-2">
                    {selectedEventData && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const ok = window.confirm(`Delete "${selectedEventData.name}" event?`);
                          if (!ok) return;
                          deleteEventMutation.mutate(selectedEventData.id);
                        }}
                        className="text-red-600 hover:text-red-700"
                        disabled={deleteEventMutation.isPending}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        {deleteEventMutation.isPending ? 'Deleting...' : 'Delete Event'}
                      </Button>
                    )}
                    <Dialog open={newEventDialogOpen} onOpenChange={setNewEventDialogOpen}>
                      <Button
                        onClick={() => setNewEventDialogOpen(true)}
                        className="bg-blue-900 hover:bg-blue-800"
                        size="sm"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Add New Event
                      </Button>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>Create New Event</DialogTitle>
                          <DialogDescription>
                            Set an event name and its honors/roles.
                          </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleCreateEvent} className="space-y-6">
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
                            <Label>Honors & Roles *</Label>
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
                                    placeholder={`Honor Name ${honorIndex + 1}`}
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
                              onClick={() => setNewEventDialogOpen(false)}
                            >
                              Cancel
                            </Button>
                            <Button type="submit" className="bg-blue-900 hover:bg-blue-800">
                              Create Event
                            </Button>
                          </div>
                        </form>
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
                  <SelectTrigger className="h-11">
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
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                    <h3 className="font-semibold text-slate-900">{selectedEvent} - Honors</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                            Honor
                          </th>
                          <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                            Role
                          </th>
                          <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                            Member
                          </th>
                          <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {currentHonors.map((honor) =>
                          honor.roles.map((role, roleIndex) => (
                            <tr key={`${honor.name}-${roleIndex}`}>
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
                                <Select
                                  value={honorData[honor.name]?.[roleIndex]?.memberId || ''}
                                  onValueChange={(value) =>
                                    handleHonorChange(honor.name, roleIndex, 'memberId', value)
                                  }
                                >
                                  <SelectTrigger className="h-10">
                                    <SelectValue placeholder="Select member..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {members.map((member) => (
                                      <SelectItem key={member.id} value={member.id}>
                                        {member.full_name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
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
                          ))
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
                      className="w-full h-11 bg-blue-900 hover:bg-blue-800"
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
                  {allTransactions.filter((t) => t.date === selectedDate).length === 0 ? (
                    <div className="p-4 bg-slate-50 rounded-lg text-slate-500 text-center">
                      No transactions recorded for this date yet
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <table className="w-full">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                              Event/Honor
                            </th>
                            <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                              Member
                            </th>
                            <th className="text-right py-3 px-4 text-sm font-semibold text-slate-700">
                              Amount
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {allTransactions
                            .filter((t) => t.date === selectedDate)
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
                                  {transaction.member_name}
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
                <div className="py-8 text-center text-slate-500 border-t border-slate-200 mt-4">
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
