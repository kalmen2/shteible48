import React, { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek } from "date-fns";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { getHebrewDate, isShabbat, getParsha, hebrewDateToGregorian, getHebrewMonthsList } from "../calendar/hebrewDateConverter";

export default function MiniCalendarPopup({ open, onClose, onEventSelected }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [calendarMode, setCalendarMode] = useState("english");
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState("");
  const [selectedHonor, setSelectedHonor] = useState("");
  const [manualAmount, setManualAmount] = useState("");

  const { data: customEvents = [] } = useQuery({
    queryKey: ['inputTypes'],
    queryFn: () => base44.entities.InputType.list('name', 1000),
  });

  const currentYear = currentMonth.getFullYear();
  const currentMonthNum = currentMonth.getMonth();
  
  const years = Array.from({ length: 10 }, (_, i) => currentYear - 2 + i);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  
  const currentHebrewDate = getHebrewDate(currentMonth);
  const hebrewYears = Array.from({ length: 10 }, (_, i) => currentHebrewDate.year - 2 + i);
  const hebrewMonthsList = getHebrewMonthsList(currentHebrewDate.year);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const selectedEventData = selectedEvent ? customEvents.find(e => e.name === selectedEvent) : null;
  const currentHonors = selectedEventData?.honors || [];
  
  // Get selected honor data for fixed amount
  const selectedHonorData = selectedHonor ? currentHonors.find(h => h.name === selectedHonor) : null;
  const hasFixedAmount = selectedHonorData?.roles?.some(r => r.payment_type === "fixed");
  const fixedAmount = selectedHonorData?.roles?.find(r => r.payment_type === "fixed")?.fixed_amount;

  const handleDateClick = (date) => {
    setSelectedDate(format(date, 'yyyy-MM-dd'));
    setSelectedEvent("");
    setSelectedHonor("");
    setManualAmount("");
  };

  const handleConfirm = () => {
    if (!selectedDate || !selectedEvent) return;

    const amount = hasFixedAmount ? fixedAmount : manualAmount;
    if (!amount || parseFloat(amount) <= 0) return;

    const description = selectedHonor 
      ? `${selectedEvent} - ${selectedHonor}` 
      : selectedEvent;

    onEventSelected({
      date: selectedDate,
      amount: amount.toString(),
      description: description,
      category: selectedEvent
    });
    
    handleClose();
  };

  const handleClose = () => {
    setSelectedDate(null);
    setSelectedEvent("");
    setSelectedHonor("");
    setManualAmount("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold text-slate-900 mb-4">Select Date & Event</h2>
        
        {/* Calendar Mode Toggle */}
        <div className="mb-4 flex justify-center">
          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            <button
              onClick={() => setCalendarMode("english")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                calendarMode === "english" 
                  ? "bg-blue-900 text-white shadow-sm" 
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              English Calendar
            </button>
            <button
              onClick={() => setCalendarMode("hebrew")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                calendarMode === "hebrew" 
                  ? "bg-blue-900 text-white shadow-sm" 
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Hebrew Calendar
            </button>
          </div>
        </div>

        {/* Calendar Navigation */}
        <div className="border border-slate-200 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            
            {calendarMode === "english" ? (
              <div className="flex items-center gap-2">
                <select
                  value={currentMonthNum}
                  onChange={(e) => setCurrentMonth(new Date(currentYear, parseInt(e.target.value), 1))}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg font-medium bg-white cursor-pointer"
                >
                  {months.map((month, idx) => (
                    <option key={idx} value={idx}>{month}</option>
                  ))}
                </select>
                <select
                  value={currentYear}
                  onChange={(e) => setCurrentMonth(new Date(parseInt(e.target.value), currentMonthNum, 1))}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg font-medium bg-white cursor-pointer"
                >
                  {years.map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
                <span className="text-slate-500 text-sm ml-2">
                  ({currentHebrewDate.month} {currentHebrewDate.year})
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <select
                  value={currentHebrewDate.monthNum}
                  onChange={(e) => {
                    const newDate = hebrewDateToGregorian(currentHebrewDate.year, parseInt(e.target.value), 1);
                    setCurrentMonth(newDate);
                  }}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg font-medium bg-white cursor-pointer"
                >
                  {hebrewMonthsList.map((month, idx) => (
                    <option key={idx} value={idx + 1}>{month}</option>
                  ))}
                </select>
                <select
                  value={currentHebrewDate.year}
                  onChange={(e) => {
                    const newDate = hebrewDateToGregorian(parseInt(e.target.value), currentHebrewDate.monthNum, 1);
                    setCurrentMonth(newDate);
                  }}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg font-medium bg-white cursor-pointer"
                >
                  {hebrewYears.map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
                <span className="text-slate-500 text-sm ml-2">
                  ({format(currentMonth, 'MMM yyyy')})
                </span>
              </div>
            )}
            
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>

          {/* Day Headers */}
          <div className="grid grid-cols-7 gap-2 mb-2">
            {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Shabbat'].map((day, i) => (
              <div key={i} className={`text-center text-xs font-semibold py-2 ${i === 6 ? 'text-blue-900' : 'text-slate-600'}`}>
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-2">
            {days.map((day, i) => {
              const isCurrentMonth = isSameMonth(day, currentMonth);
              const isToday = isSameDay(day, new Date());
              const isSelected = selectedDate === format(day, 'yyyy-MM-dd');
              const isSaturday = isShabbat(day);
              const hebrewDay = getHebrewDate(day);
              const parsha = isSaturday ? getParsha(day) : null;
              
              return (
                <button
                  key={i}
                  onClick={() => isCurrentMonth && handleDateClick(day)}
                  disabled={!isCurrentMonth}
                  className={`
                    min-h-[70px] p-2 rounded-lg border transition-all text-left flex flex-col justify-between
                    ${!isCurrentMonth ? 'bg-slate-50 border-slate-100 opacity-40 cursor-not-allowed' : 'border-slate-200 hover:border-blue-500 hover:shadow cursor-pointer'}
                    ${isSelected ? 'bg-blue-600 text-white border-blue-600' : ''}
                    ${isToday && !isSelected ? 'ring-2 ring-amber-500' : ''}
                    ${isSaturday && isCurrentMonth && !isSelected ? 'bg-blue-50 border-blue-200' : ''}
                  `}
                >
                  <div className="flex flex-col">
                    <span className={`text-sm font-bold ${isSelected ? 'text-white' : isSaturday ? 'text-blue-900' : 'text-slate-900'}`}>
                      {format(day, 'd')}
                    </span>
                    <span className={`text-xs ${isSelected ? 'text-blue-100' : 'text-slate-500'}`}>
                      {(hebrewDay.dayHebrew || hebrewDay.day)} {hebrewDay.month}
                    </span>
                  </div>
                  {isSaturday && isCurrentMonth && parsha && (
                    <span className={`text-[10px] font-medium ${isSelected ? 'text-blue-100' : 'text-blue-700'}`}>
                      {parsha}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Event Selection */}
        {selectedDate && (
          <div className="space-y-4 border-t border-slate-200 pt-4">
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
              <div className="font-semibold text-slate-900">
                {format(new Date(selectedDate), 'EEEE, MMMM d, yyyy')}
              </div>
              <div className="text-sm text-slate-600">
                {(() => {
                  const hebrew = getHebrewDate(new Date(selectedDate));
                  return `${hebrew.dayHebrew || hebrew.day} ${hebrew.month} ${hebrew.year}`;
                })()}
              </div>
              {isShabbat(new Date(selectedDate)) && (
                <div className="text-sm text-blue-700 font-medium">
                  Shabbat - {getParsha(new Date(selectedDate))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="font-semibold">Select Event *</Label>
              <Select value={selectedEvent} onValueChange={(v) => {
                setSelectedEvent(v);
                setSelectedHonor("");
                setManualAmount("");
              }}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Choose an event..." />
                </SelectTrigger>
                <SelectContent>
                  {customEvents.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-slate-500">
                      No events created yet. Add events in the Transactions page.
                    </div>
                  ) : (
                    customEvents.map((event) => (
                      <SelectItem key={event.id} value={event.name}>{event.name}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Honor Selection */}
            {selectedEvent && currentHonors.length > 0 && (
              <div className="space-y-2">
                <Label className="font-semibold">Select Honor (Optional)</Label>
                <Select value={selectedHonor} onValueChange={(v) => {
                  setSelectedHonor(v);
                  setManualAmount("");
                }}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Choose an honor..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>No specific honor</SelectItem>
                    {currentHonors.map((honor, idx) => (
                      <SelectItem key={idx} value={honor.name}>
                        {honor.name}
                        {honor.roles?.some(r => r.payment_type === "fixed") && 
                          ` (Fixed: $${honor.roles.find(r => r.payment_type === "fixed")?.fixed_amount})`
                        }
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Amount Input */}
            {selectedEvent && (
              <div className="space-y-2">
                <Label className="font-semibold">Amount *</Label>
                {hasFixedAmount ? (
                  <div className="h-11 px-3 flex items-center bg-slate-100 rounded-md border border-slate-200">
                    <span className="font-semibold text-slate-900">${fixedAmount} (Fixed)</span>
                  </div>
                ) : (
                  <Input
                    type="number"
                    step="0.01"
                    value={manualAmount}
                    onChange={(e) => setManualAmount(e.target.value)}
                    placeholder="Enter amount..."
                    className="h-11"
                  />
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={!selectedEvent || (!hasFixedAmount && (!manualAmount || parseFloat(manualAmount) <= 0))}
                className="bg-blue-900 hover:bg-blue-800"
              >
                <Check className="w-4 h-4 mr-2" />
                Confirm Selection
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
