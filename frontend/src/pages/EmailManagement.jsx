import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Mail, Send, AlertCircle, FileText, Clock, Zap, Printer, Calendar as CalendarIcon } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, startOfMonth, endOfMonth } from "date-fns";

export default function EmailManagement() {
  const [emailSubject, setEmailSubject] = useState("Monthly Balance Statement");
  const [emailBody, setEmailBody] = useState(
    `Dear {member_name},\n\nThis is a reminder that you have an outstanding balance of ${"{balance}"} as of the end of this month.\n\nPlease remit payment at your earliest convenience.\n\nThank you for your continued support.\n\nBest regards,\nSynagogue Administration`
  );
  const [sendType, setSendType] = useState("now"); // "now" or "monthly"
  const [viewMode, setViewMode] = useState("send"); // "send" or "monthly"
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [attachInvoice, setAttachInvoice] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendLog, setSendLog] = useState([]);
  const [scheduleDay, setScheduleDay] = useState(1);
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [scheduleTimezone, setScheduleTimezone] = useState("America/New_York");
  const [scheduleRecipientMode, setScheduleRecipientMode] = useState("all");
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  const [scheduleMessage, setScheduleMessage] = useState(null);

  const queryClient = useQueryClient();

  const { data: members = [] } = useQuery({
    queryKey: ['members'],
    queryFn: () => base44.entities.Member.list('-full_name', 1000),
  });

  const { data: allTransactions = [] } = useQuery({
    queryKey: ['allTransactions'],
    queryFn: () => base44.entities.Transaction.list('-date', 10000),
  });

  const { data: schedules = [] } = useQuery({
    queryKey: ['emailSchedule'],
    queryFn: () => base44.entities.EmailSchedule.list('-created_date', 1),
  });

  const schedule = schedules[0];

  useEffect(() => {
    if (!schedule) return;
    setScheduleDay(Number(schedule.day_of_month ?? 1));
    const hour = Number(schedule.hour ?? 9);
    const minute = Number(schedule.minute ?? 0);
    setScheduleTime(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    setScheduleTimezone(schedule.time_zone || "America/New_York");
    setScheduleRecipientMode(schedule.send_to === "selected" ? "selected" : "all");
    setSelectedMemberIds(Array.isArray(schedule.selected_member_ids) ? schedule.selected_member_ids : []);
    if (schedule.subject) setEmailSubject(schedule.subject);
    if (schedule.body) setEmailBody(schedule.body);
    if (typeof schedule.attach_invoice === "boolean") setAttachInvoice(schedule.attach_invoice);
  }, [schedule]);

  const membersWithBalance = members.filter(m => (m.total_owed || 0) > 0);

  // Generate list of last 12 months
  const generateMonthOptions = () => {
    const months = [];
    const today = new Date();
    for (let i = 0; i < 12; i++) {
      const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
      months.push({
        value: format(date, 'yyyy-MM'),
        label: format(date, 'MMMM yyyy')
      });
    }
    return months;
  };

  const monthOptions = generateMonthOptions();

  // Get transactions for selected month
  const getMonthlyTransactions = (memberId) => {
    const monthStart = startOfMonth(new Date(selectedMonth));
    const monthEnd = endOfMonth(new Date(selectedMonth));
    
    return allTransactions.filter(t => {
      if (t.member_id !== memberId) return false;
      if (!t.date) return false;
      const transDate = new Date(t.date);
      return transDate >= monthStart && transDate <= monthEnd;
    });
  };

  const getMemberMonthlyData = (member) => {
    const transactions = getMonthlyTransactions(member.id);
    const charges = transactions.filter(t => t.type === 'charge').reduce((sum, t) => sum + (t.amount || 0), 0);
    const payments = transactions.filter(t => t.type === 'payment').reduce((sum, t) => sum + (t.amount || 0), 0);
    return { transactions, charges, payments, balance: charges - payments };
  };

  const saveScheduleMutation = useMutation({
    mutationFn: async (payload) => {
      if (schedule?.id) {
        return base44.entities.EmailSchedule.update(schedule.id, payload);
      }
      return base44.entities.EmailSchedule.create({ id: "default", ...payload });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailSchedule'] });
      setScheduleMessage({ type: "success", text: "Monthly schedule saved." });
    },
    onError: (error) => {
      setScheduleMessage({ type: "error", text: error?.message || "Failed to save schedule." });
    },
  });

  const handleSaveSchedule = () => {
    setScheduleMessage(null);
    const [hourStr, minuteStr] = String(scheduleTime || "09:00").split(":");
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    if (Number.isNaN(hour) || Number.isNaN(minute)) {
      setScheduleMessage({ type: "error", text: "Please choose a valid time." });
      return;
    }
    if (scheduleRecipientMode === "selected" && selectedMemberIds.length === 0) {
      setScheduleMessage({ type: "error", text: "Select at least one member." });
      return;
    }
    saveScheduleMutation.mutate({
      enabled: true,
      day_of_month: scheduleDay,
      hour,
      minute,
      time_zone: scheduleTimezone,
      send_to: scheduleRecipientMode,
      selected_member_ids: scheduleRecipientMode === "selected" ? selectedMemberIds : [],
      subject: emailSubject,
      body: emailBody,
      attach_invoice: attachInvoice,
    });
  };

  const handleSendNow = async () => {
    setSending(true);
    setSendLog([]);
    const log = [];

    for (const member of membersWithBalance) {
      if (!member.email) {
        log.push({ member: member.full_name, status: "skipped", reason: "No email" });
        continue;
      }

      try {
        let personalizedBody = emailBody
          .replace(/{member_name}/g, member.full_name)
          .replace(/{balance}/g, `$${(member.total_owed || 0).toFixed(2)}`)
          .replace(/{id}/g, member.member_id || 'N/A');

        // Add invoice attachment note if enabled
        if (attachInvoice) {
          personalizedBody += "\n\n[PDF Invoice will be attached - Feature coming soon]";
        }

        await base44.integrations.Core.SendEmail({
          to: member.email,
          subject: emailSubject,
          body: personalizedBody
        });

        log.push({ 
          member: member.full_name, 
          status: "sent", 
          email: member.email,
          type: sendType 
        });
      } catch (error) {
        log.push({ member: member.full_name, status: "failed", reason: error.message });
      }
    }

    setSendLog(log);
    setSending(false);
  };

  const savingSchedule = saveScheduleMutation.isPending;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-4xl font-bold text-slate-900 mb-2">Email Management</h1>
              <p className="text-slate-600">Send monthly balance reminders to members</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setViewMode("send")}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  viewMode === "send"
                    ? "bg-blue-900 text-white"
                    : "bg-white text-slate-600 border border-slate-200 hover:border-slate-300"
                }`}
              >
                <Send className="w-4 h-4 inline mr-2" />
                Send Emails
              </button>
              <button
                onClick={() => setViewMode("monthly")}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  viewMode === "monthly"
                    ? "bg-blue-900 text-white"
                    : "bg-white text-slate-600 border border-slate-200 hover:border-slate-300"
                }`}
              >
                <CalendarIcon className="w-4 h-4 inline mr-2" />
                Monthly Statements
              </button>
            </div>
          </div>
        </div>

        {viewMode === "send" && (
          <>
        {/* Stats Card */}
        <Card className="mb-6 border-slate-200 shadow-lg">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="flex items-center gap-4">
                <Mail className="w-8 h-8 text-blue-900" />
                <div>
                  <div className="text-sm text-slate-600">Total Members</div>
                  <div className="text-2xl font-bold text-slate-900">{members.length}</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <AlertCircle className="w-8 h-8 text-amber-600" />
                <div>
                  <div className="text-sm text-slate-600">Members with Balance</div>
                  <div className="text-2xl font-bold text-amber-600">{membersWithBalance.length}</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <Mail className="w-8 h-8 text-green-600" />
                <div>
                  <div className="text-sm text-slate-600">Members with Email</div>
                  <div className="text-2xl font-bold text-green-600">
                    {membersWithBalance.filter(m => m.email).length}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Email Template */}
        <Card className="mb-6 border-slate-200 shadow-lg">
          <CardHeader className="border-b border-slate-200 bg-slate-50">
            <CardTitle>Email Template</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <div className="space-y-2">
              <Label>Send Schedule</Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setSendType("now")}
                  className={`flex items-center justify-center gap-2 p-4 rounded-lg border-2 transition-all ${
                    sendType === "now"
                      ? "border-blue-900 bg-blue-50 text-blue-900"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  <Zap className="w-5 h-5" />
                  <div className="text-left">
                    <div className="font-semibold">Send Now</div>
                    <div className="text-xs">One-time send</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setSendType("monthly")}
                  className={`flex items-center justify-center gap-2 p-4 rounded-lg border-2 transition-all ${
                    sendType === "monthly"
                      ? "border-blue-900 bg-blue-50 text-blue-900"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  <Clock className="w-5 h-5" />
                  <div className="text-left">
                    <div className="font-semibold">Monthly</div>
                    <div className="text-xs">Auto-recurring</div>
                  </div>
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <input
                id="subject"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="body">Email Body</Label>
              <Textarea
                id="body"
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                rows={10}
                className="font-mono text-sm"
              />
              <p className="text-xs text-slate-500">
                Available variables: {"{member_name}"}, {"{balance}"}, {"{id}"}
              </p>
            </div>

            <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-lg border border-slate-200">
              <input
                type="checkbox"
                id="attachInvoice"
                checked={attachInvoice}
                onChange={(e) => setAttachInvoice(e.target.checked)}
                className="w-5 h-5 text-blue-900 rounded border-slate-300 focus:ring-blue-900"
              />
              <label htmlFor="attachInvoice" className="flex items-center gap-2 cursor-pointer">
                <FileText className="w-5 h-5 text-blue-900" />
                <div>
                  <div className="font-semibold text-slate-900">Attach PDF Invoice</div>
                  <div className="text-sm text-slate-600">Include member statement as PDF attachment</div>
                </div>
              </label>
            </div>

            {sendType === "monthly" && (
              <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Day of Month</Label>
                    <Select value={String(scheduleDay)} onValueChange={(value) => setScheduleDay(Number(value))}>
                      <SelectTrigger className="h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                          <SelectItem key={day} value={String(day)}>
                            {day}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-slate-500">Short months send on the last day.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="scheduleTime">Time</Label>
                    <input
                      id="scheduleTime"
                      type="time"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg h-10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Timezone</Label>
                    <Select value={scheduleTimezone} onValueChange={setScheduleTimezone}>
                      <SelectTrigger className="h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="America/New_York">America/New_York</SelectItem>
                        <SelectItem value="America/Chicago">America/Chicago</SelectItem>
                        <SelectItem value="America/Denver">America/Denver</SelectItem>
                        <SelectItem value="America/Los_Angeles">America/Los_Angeles</SelectItem>
                        <SelectItem value="UTC">UTC</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Recipients</Label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setScheduleRecipientMode("all")}
                      className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                        scheduleRecipientMode === "all"
                          ? "border-blue-900 bg-blue-50 text-blue-900"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                      }`}
                    >
                      <Mail className="w-4 h-4" />
                      <div className="text-left">
                        <div className="font-semibold">All Members</div>
                        <div className="text-xs">Send to everyone with email</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setScheduleRecipientMode("selected")}
                      className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                        scheduleRecipientMode === "selected"
                          ? "border-blue-900 bg-blue-50 text-blue-900"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                      }`}
                    >
                      <AlertCircle className="w-4 h-4" />
                      <div className="text-left">
                        <div className="font-semibold">Selected Members</div>
                        <div className="text-xs">Pick specific recipients</div>
                      </div>
                    </button>
                  </div>
                  {scheduleRecipientMode === "selected" && (
                    <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg p-2">
                      {members.map((member) => {
                        const name = member.english_name || member.full_name || member.hebrew_name || "Member";
                        return (
                          <label
                            key={member.id}
                            className="flex items-center gap-3 px-2 py-2 rounded hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              checked={selectedMemberIds.includes(member.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedMemberIds([...selectedMemberIds, member.id]);
                                } else {
                                  setSelectedMemberIds(selectedMemberIds.filter((id) => id !== member.id));
                                }
                              }}
                              className="w-4 h-4 text-blue-900 rounded border-slate-300"
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-slate-900">{name}</div>
                              <div className="text-xs text-slate-500">{member.email || "No email"}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            <Button
              onClick={sendType === "monthly" ? handleSaveSchedule : handleSendNow}
              disabled={sendType === "monthly" ? savingSchedule : sending || membersWithBalance.length === 0}
              className="w-full h-12 bg-blue-900 hover:bg-blue-800"
            >
              <Send className="w-5 h-5 mr-2" />
              {sendType === "monthly"
                ? savingSchedule
                  ? "Saving..."
                  : "Save Monthly Schedule"
                : sending
                  ? "Sending..."
                  : `Send to ${membersWithBalance.filter(m => m.email).length} Members`}
            </Button>

            {sendType === "monthly" && (
              <>
                <p className="text-sm text-amber-600 text-center">
                  Emails send on day {scheduleDay} at {scheduleTime} ({scheduleTimezone})
                </p>
                {scheduleMessage && (
                  <p
                    className={`text-sm text-center ${
                      scheduleMessage.type === "error" ? "text-red-600" : "text-green-700"
                    }`}
                  >
                    {scheduleMessage.text}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Members Preview */}
        <Card className="mb-6 border-slate-200 shadow-lg">
          <CardHeader className="border-b border-slate-200 bg-slate-50">
            <CardTitle>Members with Balance</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {membersWithBalance.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                No members with outstanding balance
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">Member</th>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">Email</th>
                      <th className="text-right py-4 px-6 text-sm font-semibold text-slate-700">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {membersWithBalance.map((member) => (
                      <tr key={member.id} className="hover:bg-blue-50/30 transition-colors">
                        <td className="py-4 px-6">
                          <div className="font-semibold text-slate-900">{member.full_name}</div>
                        </td>
                        <td className="py-4 px-6">
                          {member.email ? (
                            <div className="text-sm text-slate-600">{member.email}</div>
                          ) : (
                            <div className="text-sm text-red-600">No email</div>
                          )}
                        </td>
                        <td className="py-4 px-6 text-right">
                          <span className="text-lg font-bold text-amber-600">
                            ${(member.total_owed || 0).toFixed(2)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Send Log */}
        {sendLog.length > 0 && (
          <Card className="border-slate-200 shadow-lg">
            <CardHeader className="border-b border-slate-200 bg-slate-50">
              <CardTitle>Send Log</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">Member</th>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">Status</th>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sendLog.map((log, idx) => (
                      <tr key={idx}>
                        <td className="py-4 px-6 font-medium">{log.member}</td>
                        <td className="py-4 px-6">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            log.status === "sent" ? "bg-green-100 text-green-800" :
                            log.status === "failed" ? "bg-red-100 text-red-800" :
                            "bg-slate-100 text-slate-800"
                          }`}>
                            {log.status}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-sm text-slate-600">
                          {log.email || log.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
        </>
        )}

        {viewMode === "monthly" && (
          <>
            {/* Month Selection */}
            <Card className="mb-6 border-slate-200 shadow-lg">
              <CardHeader className="border-b border-slate-200 bg-slate-50">
                <CardTitle>Select Month</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <Label className="text-sm font-semibold text-slate-700">Month:</Label>
                  <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                    <SelectTrigger className="w-64 h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {monthOptions.map((month) => (
                        <SelectItem key={month.value} value={month.value}>
                          {month.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Monthly Statements Table */}
            <Card className="border-slate-200 shadow-lg">
              <CardHeader className="border-b border-slate-200 bg-slate-50">
                <div className="flex items-center justify-between">
                  <CardTitle>Monthly Statements - {monthOptions.find(m => m.value === selectedMonth)?.label}</CardTitle>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => window.print()}
                      variant="outline"
                      className="h-9"
                    >
                      <Printer className="w-4 h-4 mr-2" />
                      Print All
                    </Button>
                    <Button
                      onClick={async () => {
                        setSending(true);
                        setSendLog([]);
                        const log = [];
                        
                        for (const member of members) {
                          const monthlyData = getMemberMonthlyData(member);
                          if (monthlyData.transactions.length === 0) continue;
                          if (!member.email) {
                            log.push({ member: member.full_name, status: "skipped", reason: "No email" });
                            continue;
                          }

                          try {
                            const body = `Dear ${member.full_name},\n\nHere is your statement for ${monthOptions.find(m => m.value === selectedMonth)?.label}:\n\nCharges: $${monthlyData.charges.toFixed(2)}\nPayments: $${monthlyData.payments.toFixed(2)}\nNet for Month: $${monthlyData.balance.toFixed(2)}\n\nTransactions: ${monthlyData.transactions.length}\n\nThank you,\nSynagogue Administration`;
                            
                            await base44.integrations.Core.SendEmail({
                              to: member.email,
                              subject: `Monthly Statement - ${monthOptions.find(m => m.value === selectedMonth)?.label}`,
                              body: body
                            });

                            log.push({ member: member.full_name, status: "sent", email: member.email });
                          } catch (error) {
                            log.push({ member: member.full_name, status: "failed", reason: error.message });
                          }
                        }

                        setSendLog(log);
                        setSending(false);
                      }}
                      disabled={sending}
                      className="bg-blue-900 hover:bg-blue-800 h-9"
                    >
                      <Mail className="w-4 h-4 mr-2" />
                      {sending ? "Sending..." : "Email All"}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">Member</th>
                        <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">Email</th>
                        <th className="text-right py-4 px-6 text-sm font-semibold text-slate-700">Charges</th>
                        <th className="text-right py-4 px-6 text-sm font-semibold text-slate-700">Payments</th>
                        <th className="text-right py-4 px-6 text-sm font-semibold text-slate-700">Net</th>
                        <th className="text-center py-4 px-6 text-sm font-semibold text-slate-700">Transactions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {members.map((member) => {
                        const monthlyData = getMemberMonthlyData(member);
                        if (monthlyData.transactions.length === 0) return null;
                        
                        return (
                          <tr key={member.id} className="hover:bg-blue-50/30 transition-colors">
                            <td className="py-4 px-6">
                              <div className="font-semibold text-slate-900">{member.full_name}</div>
                            </td>
                            <td className="py-4 px-6">
                              {member.email ? (
                                <div className="text-sm text-slate-600">{member.email}</div>
                              ) : (
                                <div className="text-sm text-red-600">No email</div>
                              )}
                            </td>
                            <td className="py-4 px-6 text-right">
                              <span className="font-semibold text-amber-600">
                                ${monthlyData.charges.toFixed(2)}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-right">
                              <span className="font-semibold text-green-600">
                                ${monthlyData.payments.toFixed(2)}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-right">
                              <span className={`text-lg font-bold ${
                                monthlyData.balance > 0 ? 'text-amber-600' : monthlyData.balance < 0 ? 'text-green-600' : 'text-slate-600'
                              }`}>
                                ${monthlyData.balance.toFixed(2)}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-center text-slate-600">
                              {monthlyData.transactions.length}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Send Log for Monthly */}
            {sendLog.length > 0 && (
              <Card className="mt-6 border-slate-200 shadow-lg">
                <CardHeader className="border-b border-slate-200 bg-slate-50">
                  <CardTitle>Send Log</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">Member</th>
                          <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">Status</th>
                          <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sendLog.map((log, idx) => (
                          <tr key={idx}>
                            <td className="py-4 px-6 font-medium">{log.member}</td>
                            <td className="py-4 px-6">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${
                                log.status === "sent" ? "bg-green-100 text-green-800" :
                                log.status === "failed" ? "bg-red-100 text-red-800" :
                                "bg-slate-100 text-slate-800"
                              }`}>
                                {log.status}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-sm text-slate-600">
                              {log.email || log.reason}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
