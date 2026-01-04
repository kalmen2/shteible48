import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Check, Calendar as CalendarIcon } from "lucide-react";
import { getParsha, isShabbat } from "../components/calendar/hebrewDateConverter";
import { toLocalDate } from "@/utils/dates";

const createPageUrl = (page) => {
  const [pageName, queryString] = page.split('?');
  return queryString ? `/${pageName}?${queryString}` : `/${pageName}`;
};

export default function Transactions() {
  const urlParams = new URLSearchParams(window.location.search);
  const dateFromUrl = urlParams.get('date');
  
  const [selectedEvent, setSelectedEvent] = useState("");
  const [eventDate, setEventDate] = useState(dateFromUrl || new Date().toISOString().split('T')[0]);
  const [honorData, setHonorData] = useState({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newEventName, setNewEventName] = useState("");
  const [newEventHonors, setNewEventHonors] = useState([""]);

  const queryClient = useQueryClient();

  const { data: members = [] } = useQuery({
    queryKey: ['members'],
    queryFn: () => base44.entities.Member.list('-full_name', 1000),
  });

  const { data: customEvents = [] } = useQuery({
    queryKey: ['inputTypes'],
    queryFn: () => base44.entities.InputType.list('name', 1000),
  });

  const createEventMutation = useMutation({
    mutationFn: (eventData) => base44.entities.InputType.create(eventData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inputTypes'] });
      setDialogOpen(false);
      setNewEventName("");
      setNewEventHonors([""]);
    },
  });

  const deleteEventMutation = useMutation({
    mutationFn: (id) => base44.entities.InputType.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inputTypes'] });
      if (selectedEvent && customEvents.find(e => e.name === selectedEvent)) {
        setSelectedEvent("");
      }
    },
  });

  const saveTransactionsMutation = useMutation({
    mutationFn: async (transactions) => {
      for (const transaction of transactions) {
        await base44.entities.Transaction.create({
          member_id: transaction.memberId,
          member_name: transaction.memberName,
          type: "charge",
          description: `${selectedEvent} - ${transaction.honor}`,
          amount: parseFloat(transaction.amount),
          date: eventDate,
          category: selectedEvent
        });
        
        const member = members.find(m => m.id === transaction.memberId);
        const newBalance = (member.total_owed || 0) + parseFloat(transaction.amount);
        await base44.entities.Member.update(transaction.memberId, { total_owed: newBalance });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      setHonorData({});
      setSelectedEvent("");
    },
  });

  const allEvents = customEvents.reduce((acc, event) => {
    acc[event.name] = event.options;
    return acc;
  }, {});

  const currentHonors = selectedEvent ? allEvents[selectedEvent] || [] : [];

  const handleHonorChange = (honor, field, value) => {
    setHonorData(prev => ({
      ...prev,
      [honor]: {
        ...prev[honor],
        [field]: value
      }
    }));
  };

  const handleSubmitTransactions = () => {
    const transactions = Object.entries(honorData)
      .filter(([honor, data]) => data.memberId && data.amount)
      .map(([honor, data]) => {
        const member = members.find(m => m.id === data.memberId);
        return {
          honor,
          memberId: data.memberId,
          memberName: member.full_name,
          amount: data.amount
        };
      });

    if (transactions.length > 0) {
      saveTransactionsMutation.mutate(transactions);
    }
  };

  const handleCreateEvent = (e) => {
    e.preventDefault();
    const filteredHonors = newEventHonors.filter(h => h.trim() !== "");
    if (newEventName.trim() && filteredHonors.length > 0) {
      createEventMutation.mutate({
        name: newEventName.trim(),
        options: filteredHonors,
        is_custom: true
      });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Transactions</h1>
          <p className="text-slate-600">Record aliyahs, honors, and pledges for events</p>
        </div>

        {/* Event Selection */}
        <Card className="mb-6 border-slate-200 shadow-lg">
          <CardHeader className="border-b border-slate-200 bg-slate-50">
            <div className="flex items-center justify-between">
              <CardTitle>Select Event</CardTitle>
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-blue-900 hover:bg-blue-800">
                    <Plus className="w-4 h-4 mr-2" />
                    Add New Event
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle className="text-2xl">Create New Event</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleCreateEvent} className="space-y-6 mt-4">
                    <div className="space-y-2">
                      <Label htmlFor="eventName" className="text-base">Event Name *</Label>
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
                      <Label className="text-base">Honor Options *</Label>
                      {newEventHonors.map((honor, index) => (
                        <div key={index} className="flex gap-2">
                          <Input
                            value={honor}
                            onChange={(e) => {
                              const updated = [...newEventHonors];
                              updated[index] = e.target.value;
                              setNewEventHonors(updated);
                            }}
                            placeholder={`Honor ${index + 1}`}
                            className="h-11"
                          />
                          {newEventHonors.length > 1 && (
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={() => setNewEventHonors(newEventHonors.filter((_, i) => i !== index))}
                              className="h-11 w-11"
                            >
                              <Trash2 className="w-4 h-4 text-red-600" />
                            </Button>
                          )}
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setNewEventHonors([...newEventHonors, ""])}
                        className="w-full border-dashed"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Another Honor
                      </Button>
                    </div>
                    <div className="flex justify-end gap-3 pt-4">
                      <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
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
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="event">Event Type *</Label>
                <Select value={selectedEvent} onValueChange={(value) => {
                  setSelectedEvent(value);
                  setHonorData({});
                }}>
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
                        <SelectItem key={event.id} value={event.name}>{event.name}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="date">Date *</Label>
                <Input
                  id="date"
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="h-11"
                />
                {(() => {
                  const d = toLocalDate(eventDate);
                  return d && isShabbat(d);
                })() && (
                  <div className="text-xs text-blue-700 font-medium mt-1">
                    {(() => {
                      const d = toLocalDate(eventDate);
                      return d ? `Shabbat - ${getParsha(d)}` : "";
                    })()}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Honors List */}
        {selectedEvent && currentHonors.length > 0 && (
          <Card className="border-slate-200 shadow-lg">
            <CardHeader className="border-b border-slate-200 bg-slate-50">
              <div className="flex items-center justify-between">
                <CardTitle>{selectedEvent} - Honors</CardTitle>
                {customEvents.find(e => e.name === selectedEvent) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const event = customEvents.find(e => e.name === selectedEvent);
                      if (confirm(`Delete "${selectedEvent}" event?`)) {
                        deleteEventMutation.mutate(event.id);
                      }
                    }}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Event
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700 w-1/4">Honor</th>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700 w-1/2">Member</th>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700 w-1/4">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {currentHonors.map((honor) => (
                      <tr key={honor} className="hover:bg-blue-50/30 transition-colors">
                        <td className="py-4 px-6">
                          <div className="font-medium text-slate-900">{honor}</div>
                        </td>
                        <td className="py-4 px-6">
                          <Select
                            value={honorData[honor]?.memberId || ""}
                            onValueChange={(value) => handleHonorChange(honor, 'memberId', value)}
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
                        <td className="py-4 px-6">
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={honorData[honor]?.amount || ""}
                            onChange={(e) => handleHonorChange(honor, 'amount', e.target.value)}
                            className="h-10"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-6 bg-slate-50 border-t border-slate-200">
                <Button
                  onClick={handleSubmitTransactions}
                  disabled={Object.keys(honorData).length === 0 || saveTransactionsMutation.isPending}
                  className="w-full h-12 bg-blue-900 hover:bg-blue-800 text-base"
                >
                  <Check className="w-5 h-5 mr-2" />
                  {saveTransactionsMutation.isPending ? 'Saving...' : 'Save All Transactions'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {!selectedEvent && (
          <Card className="border-slate-200 shadow-lg">
            <CardContent className="py-12">
              <div className="text-center text-slate-500">
                <CalendarIcon className="w-16 h-16 mx-auto mb-4 text-slate-300" />
                <p className="text-lg">Select an event to begin recording transactions</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}