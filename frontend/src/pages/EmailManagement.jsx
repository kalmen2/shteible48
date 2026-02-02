import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import { resolveStatementTemplate } from '@/utils/statementTemplate';
import {
  Mail,
  Send,
  AlertCircle,
  FileText,
  Clock,
  Zap,
  Printer,
  Calendar as CalendarIcon,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { toLocalDate, toLocalMonthDate } from '@/utils/dates';

export default function EmailManagement() {
  const [emailSubject, setEmailSubject] = useState('Monthly Balance Statement');
  const [emailBody, setEmailBody] = useState(
    `Dear {member_name},\n\nThis is a reminder that you have an outstanding balance of ${'{balance}'} as of the end of this month.\n\nPlease remit payment at your earliest convenience.\n\nThank you for your continued support.\n\nBest regards,\nSynagogue Administration`
  );
  const [sendType, setSendType] = useState('now'); // "now" or "monthly"
  const [viewMode, setViewMode] = useState('send'); // "send" or "monthly"
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [attachInvoice, setAttachInvoice] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendLog, setSendLog] = useState([]);
  const [scheduleDay, setScheduleDay] = useState(1);
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [scheduleTimezone, setScheduleTimezone] = useState('America/New_York');
  const [scheduleRecipientMode, setScheduleRecipientMode] = useState('all');
  const [selectedRecipientIds, setSelectedRecipientIds] = useState([]);
  const [scheduleMessage, setScheduleMessage] = useState(null);
  const [scheduleId, setScheduleId] = useState(null);
  const [scheduleName, setScheduleName] = useState('');

  // One-time send recipient selection
  const [sendRecipientMode, setSendRecipientMode] = useState('all'); // "all" or "selected"
  const [sendSelectedRecipientIds, setSendSelectedRecipientIds] = useState([]);
  const [printFilter, setPrintFilter] = useState('all');

  const queryClient = useQueryClient();

  const { data: members = [] } = useQuery({
    queryKey: ['members'],
    queryFn: () => base44.entities.Member.list('-full_name', 1000),
  });

  const { data: guests = [] } = useQuery({
    queryKey: ['guests'],
    queryFn: () => base44.entities.Guest.list('-full_name', 1000),
  });

  const { data: plans = [] } = useQuery({
    queryKey: ['membershipPlans'],
    queryFn: () => base44.entities.MembershipPlan.list('-created_date', 1),
  });

  const { data: membershipCharges = [] } = useQuery({
    queryKey: ['membershipCharges'],
    queryFn: () => base44.entities.MembershipCharge.listAll('-created_date'),
  });

  const { data: statementTemplates = [] } = useQuery({
    queryKey: ['statementTemplates'],
    queryFn: () => base44.entities.StatementTemplate.list('-created_date', 1),
  });

  const { data: recurringPayments = [] } = useQuery({
    queryKey: ['recurringPayments'],
    queryFn: () => base44.entities.RecurringPayment.filter({ is_active: true }),
  });

  const { data: allTransactions = [] } = useQuery({
    queryKey: ['allTransactions'],
    queryFn: () => base44.entities.Transaction.listAll('-date'),
  });

  const { data: allGuestTransactions = [] } = useQuery({
    queryKey: ['allGuestTransactions'],
    queryFn: () => base44.entities.GuestTransaction.listAll('-date'),
  });

  const { data: schedules = [] } = useQuery({
    queryKey: ['emailSchedule'],
    queryFn: () => base44.entities.EmailSchedule.list('-created_date', 50),
  });

  useEffect(() => {
    if (!scheduleId && schedules.length > 0) {
      setScheduleId(schedules[0].id);
    }
  }, [scheduleId, schedules]);

  const schedule = schedules.find((item) => item.id === scheduleId) || null;
  const currentPlan = plans[0];


  useEffect(() => {
    const handleAfterPrint = () => setPrintFilter('all');
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, []);

  const getMemberCharges = (memberId) =>
    membershipCharges.filter((c) => c.member_id === memberId && c.is_active);
  const getMemberRecurringPayments = (memberId) =>
    recurringPayments.filter((p) => p.member_id === memberId && p.is_active);
  const getMemberTotalMonthly = (member) => {
    const standardAmount = Number(currentPlan?.standard_amount || 0);
    if (!member) return standardAmount;
    const chargesTotal = getMemberCharges(member.id).reduce(
      (sum, c) => sum + Number(c.amount || 0),
      0
    );
    const recurringTotal = getMemberRecurringPayments(member.id)
      .filter((p) => p.payment_type !== 'membership')
      .reduce((sum, p) => sum + Number(p.amount_per_month || 0), 0);
    return (
      standardAmount +
      (Number.isFinite(chargesTotal) ? chargesTotal : 0) +
      (Number.isFinite(recurringTotal) ? recurringTotal : 0)
    );
  };

  useEffect(() => {
    if (!schedule) return;
    setScheduleDay(Number(schedule.day_of_month ?? 1));
    const hour = Number(schedule.hour ?? 9);
    const minute = Number(schedule.minute ?? 0);
    setScheduleTime(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
    setScheduleTimezone(schedule.time_zone || 'America/New_York');
    setScheduleRecipientMode(schedule.send_to === 'selected' ? 'selected' : 'all');
    setScheduleName(schedule.name || 'Monthly Schedule');
    const normalizedSelected = Array.isArray(schedule.selected_member_ids)
      ? schedule.selected_member_ids.map((id) => {
          if (typeof id === 'string' && id.includes(':')) return id;
          const matchMember = members.find((m) => String(m.id) === String(id));
          if (matchMember) return `member:${matchMember.id}`;
          const matchGuest = guests.find((g) => String(g.id) === String(id));
          if (matchGuest) return `guest:${matchGuest.id}`;
          return String(id);
        })
      : [];
    setSelectedRecipientIds(normalizedSelected);
    if (schedule.subject) setEmailSubject(schedule.subject);
    if (schedule.body) setEmailBody(schedule.body);
    if (typeof schedule.attach_invoice === 'boolean') setAttachInvoice(schedule.attach_invoice);
  }, [schedule, members, guests]);

  const resetScheduleForm = () => {
    setScheduleId(null);
    setScheduleName('');
    setScheduleDay(1);
    setScheduleTime('09:00');
    setScheduleTimezone('America/New_York');
    setScheduleRecipientMode('all');
    setSelectedRecipientIds([]);
    setScheduleMessage(null);
  };

  const allRecipients = [
    ...members.map((m) => ({
      kind: 'member',
      id: m.id,
      key: `member:${m.id}`,
      name: m.full_name || m.english_name || m.hebrew_name || 'Member',
      email: m.email,
      balance: (m.total_owed || 0) + getMemberTotalMonthly(m),
      ref: m,
    })),
    ...guests.map((g) => ({
      kind: 'guest',
      id: g.id,
      key: `guest:${g.id}`,
      name: g.full_name || g.english_name || g.hebrew_name || 'Guest',
      email: g.email,
      balance: g.total_owed || 0,
      ref: g,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const recipientsWithBalance = allRecipients.filter((r) => (r.balance || 0) > 0);

  const allStatementTransactions = React.useMemo(
    () => [...(allTransactions || []), ...(allGuestTransactions || [])],
    [allTransactions, allGuestTransactions]
  );

  const monthOptions = React.useMemo(() => {
    const monthMap = new Map();
    for (const tx of allStatementTransactions || []) {
      const date = toLocalDate(tx.date);
      if (!date) continue;
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const key = format(monthStart, 'yyyy-MM');
      if (!monthMap.has(key)) {
        monthMap.set(key, monthStart);
      }
    }
    return Array.from(monthMap.entries())
      .map(([value, date]) => ({
        value,
        date,
        label: format(date, 'MMMM yyyy'),
      }))
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [allStatementTransactions]);

  useEffect(() => {
    if (!monthOptions.length) return;
    const exists = monthOptions.some((m) => m.value === selectedMonth);
    if (!exists) {
      setSelectedMonth(monthOptions[0].value);
    }
  }, [monthOptions, selectedMonth]);

  const hasSavedTemplate = statementTemplates.length > 0;
  const resolvedTemplate = React.useMemo(
    () => resolveStatementTemplate(statementTemplates[0]),
    [statementTemplates]
  );

  // Get transactions for selected month
  const getMonthlyTransactions = (transactions, id, idField) => {
    const baseMonth = toLocalMonthDate(selectedMonth);
    if (!baseMonth) return [];
    const monthStart = startOfMonth(baseMonth);
    const monthEnd = endOfMonth(baseMonth);

    return transactions.filter((t) => {
      if (t[idField] !== id) return false;
      if (!t.date) return false;
      const transDate = toLocalDate(t.date);
      if (!transDate) return false;
      return transDate >= monthStart && transDate <= monthEnd;
    });
  };

  const getRecipientMonthlyData = (recipient) => {
    const isGuest = recipient.kind === 'guest';
    const list = isGuest ? allGuestTransactions : allTransactions;
    const idField = isGuest ? 'guest_id' : 'member_id';
    const transactions = getMonthlyTransactions(list, recipient.id, idField);
    const charges = transactions
      .filter((t) => t.type === 'charge')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    const payments = transactions
      .filter((t) => t.type === 'payment')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    return { transactions, charges, payments, balance: charges - payments };
  };

  const recipientsMissingEmailForMonth = React.useMemo(() => {
    return allRecipients.filter((rec) => !String(rec.email || '').trim());
  }, [allRecipients]);

  const handlePrint = (mode) => {
    if (!hasSavedTemplate) {
      toast({
        title: 'Save a statement template first',
        description: 'Create and save a template in Settings before printing statements.',
        variant: 'destructive',
      });
      return;
    }
    setPrintFilter(mode);
    setTimeout(() => window.print(), 0);
  };

  const saveScheduleMutation = useMutation({
    mutationFn: async (payload) => {
      if (scheduleId) {
        return base44.entities.EmailSchedule.update(scheduleId, payload);
      }
      return base44.entities.EmailSchedule.create(payload);
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['emailSchedule'] });
      setScheduleMessage({ type: 'success', text: 'Monthly schedule saved.' });
      if (saved?.id) {
        setScheduleId(saved.id);
      }
    },
    onError: (error) => {
      setScheduleMessage({ type: 'error', text: error?.message || 'Failed to save schedule.' });
    },
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: async () => {
      if (!scheduleId) return;
      return base44.entities.EmailSchedule.delete(scheduleId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailSchedule'] });
      setScheduleMessage({ type: 'success', text: 'Monthly schedule deleted.' });
      resetScheduleForm();
    },
    onError: (error) => {
      setScheduleMessage({ type: 'error', text: error?.message || 'Failed to delete schedule.' });
    },
  });

  const handleSaveSchedule = () => {
    setScheduleMessage(null);
    const [hourStr, minuteStr] = String(scheduleTime || '09:00').split(':');
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    if (Number.isNaN(hour) || Number.isNaN(minute)) {
      setScheduleMessage({ type: 'error', text: 'Please choose a valid time.' });
      return;
    }
    if (scheduleRecipientMode === 'selected' && selectedRecipientIds.length === 0) {
      setScheduleMessage({ type: 'error', text: 'Select at least one recipient.' });
      return;
    }
    if (attachInvoice && !hasSavedTemplate) {
      setScheduleMessage({ type: 'error', text: 'Save a statement template in Settings before attaching invoices.' });
      return;
    }
    saveScheduleMutation.mutate({
      name: scheduleName || 'Monthly Schedule',
      enabled: true,
      day_of_month: scheduleDay,
      hour,
      minute,
      time_zone: scheduleTimezone,
      send_to: scheduleRecipientMode,
      selected_member_ids: scheduleRecipientMode === 'selected' ? selectedRecipientIds : [],
      subject: emailSubject,
      body: emailBody,
      attach_invoice: attachInvoice,
    });
  };

  const handleSendNow = async () => {
    if (attachInvoice && !hasSavedTemplate) {
      toast({
        title: 'Save a statement template first',
        description: 'Save your statement template in Settings before attaching invoices.',
        variant: 'destructive',
      });
      return;
    }
    setSending(true);
    setSendLog([]);
    const log = [];

    const recipients =
      sendRecipientMode === 'selected'
        ? allRecipients.filter((r) => sendSelectedRecipientIds.includes(r.key))
        : allRecipients;

    if (recipients.length === 0) {
      setSendLog([{ member: '', status: 'skipped', reason: 'No recipients selected' }]);
      setSending(false);
      return;
    }

    for (const rec of recipients) {
      if (!rec.email) {
        log.push({ member: rec.name, status: 'skipped', reason: 'No email' });
        continue;
      }

      try {
        let saveCardUrl = '';
        try {
          const linkResp = await base44.payments.generateSaveCardLink({
            memberId: rec.kind === 'member' ? rec.id : undefined,
            guestId: rec.kind === 'guest' ? rec.id : undefined,
          });
          saveCardUrl = linkResp?.url || '';
        } catch {
          // Non-fatal; continue without save-card link
          saveCardUrl = '';
        }

        const personalizedBody = emailBody
          .replace(/{member_name}/g, rec.name)
          .replace(/{balance}/g, `$${(rec.balance || 0).toFixed(2)}`)
          .replace(/{hebrew_name}/g, rec.ref?.hebrew_name || '')
          .replace(/{id}/g, rec.ref?.member_id || rec.ref?.guest_id || rec.id || 'N/A')
          .replace(/{save_card_url}/g, saveCardUrl);

        const pdfPayload = attachInvoice
          ? {
              memberName: rec.name,
              memberId: rec.ref?.member_id || rec.ref?.guest_id || rec.id,
              balance: rec.balance || 0,
              statementDate: format(new Date(), 'yyyy-MM-dd'),
              note: 'Please remit payment at your earliest convenience.',
              template: resolvedTemplate,
            }
          : undefined;

        await base44.integrations.Core.SendEmail({
          to: rec.email,
          subject: emailSubject,
          body: personalizedBody,
          pdf: pdfPayload,
        });

        log.push({
          member: rec.name,
          status: 'sent',
          email: rec.email,
          type: sendType,
          kind: rec.kind,
        });
      } catch (error) {
        log.push({ member: rec.name, status: 'failed', reason: error.message });
      }
    }

    setSendLog(log);
    setSending(false);
    const sentCount = log.filter((item) => item.status === 'sent').length;
    const failedCount = log.filter((item) => item.status === 'failed').length;
    toast({
      title: failedCount ? 'Emails sent with issues' : 'Emails sent',
      description: `Sent ${sentCount} of ${recipients.length} emails.`,
      variant: failedCount ? 'destructive' : 'default',
    });
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
            <div className="flex items-center gap-3 flex-wrap justify-end">
              <button
                onClick={() => setViewMode('send')}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  viewMode === 'send'
                    ? 'bg-blue-900 text-white'
                    : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'
                }`}
              >
                <Send className="w-4 h-4 inline mr-2" />
                Send Emails
              </button>
              <button
                onClick={() => setViewMode('monthly')}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  viewMode === 'monthly'
                    ? 'bg-blue-900 text-white'
                    : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'
                }`}
              >
                <CalendarIcon className="w-4 h-4 inline mr-2" />
                Monthly Statements
              </button>
            </div>
          </div>
        </div>

        {viewMode === 'send' && (
          <>
            {/* Stats Card */}
            <Card className="mb-6 border-slate-200 shadow-lg">
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="flex items-center gap-4">
                    <Mail className="w-8 h-8 text-blue-900" />
                    <div>
                      <div className="text-sm text-slate-600">Total Members & Guests</div>
                      <div className="text-2xl font-bold text-slate-900">
                        {allRecipients.length}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <AlertCircle className="w-8 h-8 text-amber-600" />
                    <div>
                      <div className="text-sm text-slate-600">With Balance</div>
                      <div className="text-2xl font-bold text-amber-600">
                        {recipientsWithBalance.length}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <Mail className="w-8 h-8 text-green-600" />
                    <div>
                      <div className="text-sm text-slate-600">With Email</div>
                      <div className="text-2xl font-bold text-green-600">
                        {allRecipients.filter((r) => r.email).length}
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
                      onClick={() => setSendType('now')}
                      className={`flex items-center justify-center gap-2 p-4 rounded-lg border-2 transition-all ${
                        sendType === 'now'
                          ? 'border-blue-900 bg-blue-50 text-blue-900'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
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
                      onClick={() => setSendType('monthly')}
                      className={`flex items-center justify-center gap-2 p-4 rounded-lg border-2 transition-all ${
                        sendType === 'monthly'
                          ? 'border-blue-900 bg-blue-50 text-blue-900'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
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
                    Available variables: {'{member_name}'}, {'{hebrew_name}'}, {'{balance}'},{' '}
                    {'{id}'}, {'{save_card_url}'}
                  </p>
                </div>

                <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <input
                    type="checkbox"
                    id="attachInvoice"
                    checked={attachInvoice}
                    onChange={(e) => setAttachInvoice(e.target.checked)}
                    disabled={!hasSavedTemplate}
                    className="w-5 h-5 text-blue-900 rounded border-slate-300 focus:ring-blue-900"
                  />
                  <label htmlFor="attachInvoice" className="flex items-center gap-2 cursor-pointer">
                    <FileText className="w-5 h-5 text-blue-900" />
                    <div>
                      <div className="font-semibold text-slate-900">Attach PDF Invoice</div>
                      <div className="text-sm text-slate-600">
                        Include member statement as PDF attachment
                        {!hasSavedTemplate && ' (save a template to enable)'}
                      </div>
                    </div>
                  </label>
                </div>

                {sendType === 'now' && (
                  <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
                    <Label>Recipients (one-time send)</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setSendRecipientMode('all')}
                        className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                          sendRecipientMode === 'all'
                            ? 'border-blue-900 bg-blue-50 text-blue-900'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        <Mail className="w-4 h-4" />
                        <div className="text-left">
                          <div className="font-semibold">All Recipients</div>
                          <div className="text-xs">
                            Send to every member & guest (skips missing email)
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSendRecipientMode('selected')}
                        className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                          sendRecipientMode === 'selected'
                            ? 'border-blue-900 bg-blue-50 text-blue-900'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        <AlertCircle className="w-4 h-4" />
                        <div className="text-left">
                          <div className="font-semibold">Selected Recipients</div>
                          <div className="text-xs">Pick specific members or guests</div>
                        </div>
                      </button>
                    </div>
                    {sendRecipientMode === 'selected' && (
                      <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg p-2">
                        {allRecipients.map((rec) => (
                          <label
                            key={`${rec.kind}-${rec.id}`}
                            className="flex items-center gap-3 px-2 py-2 rounded hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              checked={sendSelectedRecipientIds.includes(rec.key)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSendSelectedRecipientIds([
                                    ...sendSelectedRecipientIds,
                                    rec.key,
                                  ]);
                                } else {
                                  setSendSelectedRecipientIds(
                                    sendSelectedRecipientIds.filter((id) => id !== rec.key)
                                  );
                                }
                              }}
                              className="w-4 h-4 text-blue-900 rounded border-slate-300"
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-slate-900">{rec.name}</div>
                              <div className="text-xs text-slate-500 flex items-center gap-2">
                                <span className="inline-block px-2 py-0.5 rounded-full text-[10px] bg-slate-100 text-slate-700 uppercase">
                                  {rec.kind}
                                </span>
                                <span>{rec.email || 'No email'}</span>
                              </div>
                            </div>
                            <div className="text-sm font-semibold text-amber-600">
                              ${rec.balance.toFixed(2)}
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {sendType === 'monthly' && (
                  <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Schedule</Label>
                        <Select
                          value={scheduleId || 'new'}
                          onValueChange={(value) => {
                            if (value === 'new') {
                              resetScheduleForm();
                            } else {
                              setScheduleId(value);
                              setScheduleMessage(null);
                            }
                          }}
                        >
                          <SelectTrigger className="h-10">
                            <SelectValue placeholder="Select schedule" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="new">New schedule</SelectItem>
                            {schedules.map((item) => (
                              <SelectItem key={item.id} value={item.id}>
                                {item.name || `Schedule ${item.id.slice(0, 6)}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="scheduleName">Schedule Name</Label>
                        <Input
                          id="scheduleName"
                          value={scheduleName}
                          onChange={(e) => setScheduleName(e.target.value)}
                          placeholder="Monthly Schedule"
                        />
                      </div>
                      <div className="flex items-end">
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          onClick={resetScheduleForm}
                        >
                          New Schedule
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Day of Month</Label>
                        <Select
                          value={String(scheduleDay)}
                          onValueChange={(value) => setScheduleDay(Number(value))}
                        >
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
                          onClick={() => setScheduleRecipientMode('all')}
                          className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                            scheduleRecipientMode === 'all'
                              ? 'border-blue-900 bg-blue-50 text-blue-900'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <Mail className="w-4 h-4" />
                          <div className="text-left">
                            <div className="font-semibold">All Recipients</div>
                            <div className="text-xs">
                              Send to every member or guest (skips missing email)
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setScheduleRecipientMode('selected')}
                          className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                            scheduleRecipientMode === 'selected'
                              ? 'border-blue-900 bg-blue-50 text-blue-900'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <AlertCircle className="w-4 h-4" />
                          <div className="text-left">
                            <div className="font-semibold">Selected Recipients</div>
                            <div className="text-xs">Pick specific members or guests</div>
                          </div>
                        </button>
                      </div>
                      {scheduleRecipientMode === 'selected' && (
                        <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg p-2">
                          {allRecipients.map((person) => {
                            return (
                              <label
                                key={person.key}
                                className="flex items-center gap-3 px-2 py-2 rounded hover:bg-slate-50"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedRecipientIds.includes(person.key)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedRecipientIds([
                                        ...selectedRecipientIds,
                                        person.key,
                                      ]);
                                    } else {
                                      setSelectedRecipientIds(
                                        selectedRecipientIds.filter((id) => id !== person.key)
                                      );
                                    }
                                  }}
                                  className="w-4 h-4 text-blue-900 rounded border-slate-300"
                                />
                                <div className="flex-1">
                                  <div className="text-sm font-medium text-slate-900">
                                    {person.name}
                                  </div>
                                  <div className="text-xs text-slate-500">
                                    {person.email || 'No email'}
                                  </div>
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
                  onClick={sendType === 'monthly' ? handleSaveSchedule : handleSendNow}
                  disabled={
                    sendType === 'monthly'
                      ? savingSchedule
                      : sending || recipientsWithBalance.length === 0
                  }
                  className="w-full h-12 bg-blue-900 hover:bg-blue-800"
                >
                  <Send className="w-5 h-5 mr-2" />
                  {sendType === 'monthly'
                    ? savingSchedule
                      ? 'Saving...'
                      : 'Save Monthly Schedule'
                    : (() => {
                        if (sending) return 'Sending...';
                        const baseList =
                          sendRecipientMode === 'selected'
                            ? allRecipients.filter((r) => sendSelectedRecipientIds.includes(r.key))
                            : allRecipients;
                        const count = baseList.filter((r) => r.email).length;
                        return `Send to ${count} Recipients`;
                      })()}
                </Button>

                {sendType === 'monthly' && (
                  <>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      {schedule ? (
                        <div className="flex flex-col gap-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold text-slate-700">
                              {schedule.name || 'Current schedule'}
                            </span>
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                              Enabled
                            </span>
                          </div>
                          <div>
                            Emails send on day {scheduleDay} at {scheduleTime} ({scheduleTimezone})
                          </div>
                          <div className="text-xs text-slate-500">
                            Recipients: {scheduleRecipientMode === 'all' ? 'All' : 'Selected'} ·
                            Attach invoice: {attachInvoice ? 'Yes' : 'No'}
                          </div>
                        </div>
                      ) : (
                        <div>No monthly schedule yet. Save to create one.</div>
                      )}
                    </div>
                    {scheduleMessage && (
                      <p
                        className={`text-sm text-center ${
                          scheduleMessage.type === 'error' ? 'text-red-600' : 'text-green-700'
                        }`}
                      >
                        {scheduleMessage.text}
                      </p>
                    )}
                    {schedule && (
                      <Button
                        variant="outline"
                        className="w-full border-red-200 text-red-600 hover:bg-red-50"
                        disabled={deleteScheduleMutation.isPending}
                        onClick={() => {
                          if (confirm('Delete the monthly email schedule?')) {
                            deleteScheduleMutation.mutate();
                          }
                        }}
                      >
                        {deleteScheduleMutation.isPending ? 'Deleting...' : 'Delete Schedule'}
                      </Button>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Members/Guests Preview */}
            <Card className="mb-6 border-slate-200 shadow-lg">
              <CardHeader className="border-b border-slate-200 bg-slate-50">
                <CardTitle>Members & Guests (balance shown)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {allRecipients.length === 0 ? (
                  <div className="p-12 text-center text-slate-500">No members or guests</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">
                            Name
                          </th>
                          <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">
                            Type
                          </th>
                          <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">
                            Email
                          </th>
                          <th className="text-right py-4 px-6 text-sm font-semibold text-slate-700">
                            Balance
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {allRecipients.map((rec) => (
                          <tr
                            key={`${rec.kind}-${rec.id}`}
                            className="hover:bg-blue-50/30 transition-colors"
                          >
                            <td className="py-4 px-6">
                              <div className="font-semibold text-slate-900">{rec.name}</div>
                            </td>
                            <td className="py-4 px-6">
                              <span className="inline-block px-2 py-1 rounded-full text-[11px] bg-slate-100 text-slate-700 uppercase font-semibold">
                                {rec.kind}
                              </span>
                            </td>
                            <td className="py-4 px-6">
                              {rec.email ? (
                                <div className="text-sm text-slate-600">{rec.email}</div>
                              ) : (
                                <div className="text-sm text-red-600">No email</div>
                              )}
                            </td>
                            <td className="py-4 px-6 text-right">
                              <span className="text-lg font-bold text-amber-600">
                                ${(rec.balance || 0).toFixed(2)}
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
                          <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">
                            Member
                          </th>
                          <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">
                            Status
                          </th>
                          <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">
                            Details
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sendLog.map((log, idx) => (
                          <tr key={idx}>
                            <td className="py-4 px-6 font-medium">{log.member}</td>
                            <td className="py-4 px-6">
                              <span
                                className={`px-2 py-1 rounded text-xs font-medium ${
                                  log.status === 'sent'
                                    ? 'bg-green-100 text-green-800'
                                    : log.status === 'failed'
                                      ? 'bg-red-100 text-red-800'
                                      : 'bg-slate-100 text-slate-800'
                                }`}
                              >
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

        {viewMode === 'monthly' && (
          <>
            {/* Month Selection */}
            <Card className="mb-6 border-slate-200 shadow-lg">
              <CardHeader className="border-b border-slate-200 bg-slate-50">
                <CardTitle>Select Month</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                {monthOptions.length === 0 ? (
                  <div className="text-sm text-slate-500">No transaction months available yet.</div>
                ) : (
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
                )}
              </CardContent>
            </Card>

            {/* Monthly Statements Table */}
            <Card className="border-slate-200 shadow-lg">
              <CardHeader className="border-b border-slate-200 bg-slate-50">
                <div className="flex items-center justify-between">
                  <CardTitle>
                    Monthly Statements -{' '}
                    {monthOptions.find((m) => m.value === selectedMonth)?.label || 'No Data'}
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handlePrint('all')}
                      variant="outline"
                      className="h-9"
                      disabled={monthOptions.length === 0 || !hasSavedTemplate}
                    >
                      <Printer className="w-4 h-4 mr-2" />
                      Print All
                    </Button>
                    <Button
                      onClick={() => handlePrint('missing-email')}
                      variant="outline"
                      className="h-9"
                      disabled={
                        monthOptions.length === 0 ||
                        recipientsMissingEmailForMonth.length === 0 ||
                        !hasSavedTemplate
                      }
                    >
                      <Printer className="w-4 h-4 mr-2" />
                      Print Missing Email
                    </Button>
                    <Button
                      onClick={async () => {
                        if (attachInvoice && !hasSavedTemplate) {
                          toast({
                            title: 'Save a statement template first',
                            description: 'Save your statement template in Settings before attaching invoices.',
                            variant: 'destructive',
                          });
                          return;
                        }
                        setSending(true);
                        setSendLog([]);
                        const log = [];

                        for (const recipient of allRecipients) {
                          const monthlyData = getRecipientMonthlyData(recipient);
                          if (!recipient.email) {
                            log.push({
                              member: recipient.name,
                              status: 'skipped',
                              reason: 'No email',
                            });
                            continue;
                          }

                          try {
                            const body = `Dear ${recipient.name},\n\nHere is your statement for ${monthOptions.find((m) => m.value === selectedMonth)?.label}:\n\nCharges: $${monthlyData.charges.toFixed(2)}\nPayments: $${monthlyData.payments.toFixed(2)}\nNet for Month: $${monthlyData.balance.toFixed(2)}\n\nTransactions: ${monthlyData.transactions.length}\n\nThank you,\nSynagogue Administration`;

                            await base44.integrations.Core.SendEmail({
                              to: recipient.email,
                              subject: `Monthly Statement - ${monthOptions.find((m) => m.value === selectedMonth)?.label}`,
                              body: body,
                              pdf: attachInvoice
                                ? {
                                    memberName: recipient.name || 'Member',
                                    memberId:
                                      recipient.ref?.member_id ||
                                      recipient.ref?.guest_id ||
                                      recipient.id,
                                    balance: monthlyData.balance,
                                    statementDate: selectedMonth,
                                    note: 'This statement reflects your monthly activity.',
                                    template: resolvedTemplate,
                                  }
                                : undefined,
                            });

                            log.push({
                              member: recipient.name,
                              status: 'sent',
                              email: recipient.email,
                            });
                          } catch (error) {
                            log.push({
                              member: recipient.name,
                              status: 'failed',
                              reason: error.message,
                            });
                          }
                        }

                        setSendLog(log);
                        setSending(false);
                        const sentCount = log.filter((item) => item.status === 'sent').length;
                        const failedCount = log.filter((item) => item.status === 'failed').length;
                        toast({
                          title: failedCount ? 'Emails sent with issues' : 'Emails sent',
                          description: `Sent ${sentCount} of ${log.length} emails.`,
                          variant: failedCount ? 'destructive' : 'default',
                        });
                      }}
                      disabled={sending || monthOptions.length === 0}
                      className="bg-blue-900 hover:bg-blue-800 h-9"
                    >
                      <Mail className="w-4 h-4 mr-2" />
                      {sending ? 'Sending...' : 'Email All'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto print-overflow">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">
                          Member/Guest
                        </th>
                        <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">
                          Email
                        </th>
                        <th className="text-right py-4 px-6 text-sm font-semibold text-slate-700">
                          Charges
                        </th>
                        <th className="text-right py-4 px-6 text-sm font-semibold text-slate-700">
                          Payments
                        </th>
                        <th className="text-right py-4 px-6 text-sm font-semibold text-slate-700">
                          Net
                        </th>
                        <th className="text-center py-4 px-6 text-sm font-semibold text-slate-700">
                          Transactions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {allRecipients.map((recipient) => {
                        const monthlyData = getRecipientMonthlyData(recipient);
                        const hasEmail = Boolean(String(recipient.email || '').trim());
                        if (printFilter === 'missing-email' && hasEmail) return null;
                        return (
                          <tr key={recipient.key} className="hover:bg-blue-50/30 transition-colors">
                            <td className="py-4 px-6">
                              <div className="font-semibold text-slate-900">{recipient.name}</div>
                            </td>
                            <td className="py-4 px-6">
                              {recipient.email ? (
                                <div className="text-sm text-slate-600">{recipient.email}</div>
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
                              <span
                                className={`text-lg font-bold ${
                                  monthlyData.balance > 0
                                    ? 'text-amber-600'
                                    : monthlyData.balance < 0
                                      ? 'text-green-600'
                                      : 'text-slate-600'
                                }`}
                              >
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
                  <div className="overflow-x-auto print-overflow">
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">
                            Member
                          </th>
                          <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">
                            Status
                          </th>
                          <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">
                            Details
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sendLog.map((log, idx) => (
                          <tr key={idx}>
                            <td className="py-4 px-6 font-medium">{log.member}</td>
                            <td className="py-4 px-6">
                              <span
                                className={`px-2 py-1 rounded text-xs font-medium ${
                                  log.status === 'sent'
                                    ? 'bg-green-100 text-green-800'
                                    : log.status === 'failed'
                                      ? 'bg-red-100 text-red-800'
                                      : 'bg-slate-100 text-slate-800'
                                }`}
                              >
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
