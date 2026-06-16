import React, { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import { resolveStatementTemplate } from '@/utils/statementTemplate';
import {
  Mail,
  Send,
  AlertCircle,
  FileText,
  CalendarDays,
  Clock3,
  Search,
  Users,
  Repeat,
  Trash2,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { format } from 'date-fns';

export default function EmailManagement() {
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [sendType, setSendType] = useState('one-time'); // "one-time" or "scheduled"
  const [attachInvoice, setAttachInvoice] = useState(false);
  const [isBodyCentered, setIsBodyCentered] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendLog, setSendLog] = useState([]);
  const [sendRecipientSearch, setSendRecipientSearch] = useState('');
  const [scheduleDay, setScheduleDay] = useState(1);
  const [scheduleFrequency, setScheduleFrequency] = useState('monthly'); // "monthly" or "weekly"
  const [scheduleWeekday, setScheduleWeekday] = useState(1); // 0=Sun ... 6=Sat
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [scheduleTimezone, setScheduleTimezone] = useState('America/New_York');
  const [scheduleRecipientMode, setScheduleRecipientMode] = useState('all');
  const [scheduleRecipientSearch, setScheduleRecipientSearch] = useState('');
  const [selectedRecipientIds, setSelectedRecipientIds] = useState([]);
  const [scheduleMessage, setScheduleMessage] = useState(null);
  const [scheduleId, setScheduleId] = useState(null);
  const [scheduleName, setScheduleName] = useState('');
  const [isCreatingSchedule, setIsCreatingSchedule] = useState(false);

  // One-time send recipient selection
  const [sendRecipientMode, setSendRecipientMode] = useState('all'); // "all" or "selected"
  const [sendSelectedRecipientIds, setSendSelectedRecipientIds] = useState([]);
  const LEGACY_DEFAULT_EMAIL_BODY_VARIANTS = React.useMemo(
    () => [
      `Dear {member_name},

This is a reminder that you have an outstanding balance of {balance} as of the end of this month.

Please remit payment at your earliest convenience.

Thank you for your continued support.

Best regards,
Synagogue Administration`,
      'Dear {member_name}, This is a reminder that you have an outstanding balance of {balance} as of the end of this month. Please remit payment at your earliest convenience. Thank you for your continued support. Best regards, Synagogue Administration',
    ],
    []
  );

  const queryClient = useQueryClient();

  const { data: members = [] } = useQuery({
    queryKey: ['members'],
    queryFn: () => base44.entities.Member.list('-full_name', 1000),
  });

  const { data: guests = [] } = useQuery({
    queryKey: ['guests'],
    queryFn: () => base44.entities.Guest.list('-full_name', 1000),
  });

  const { data: statementTemplates = [] } = useQuery({
    queryKey: ['statementTemplates'],
    queryFn: () => base44.entities.StatementTemplate.list('-created_date', 1),
  });

  const { data: schedules = [] } = useQuery({
    queryKey: ['emailSchedule'],
    queryFn: () => base44.entities.EmailSchedule.list('-created_date', 50),
  });

  useEffect(() => {
    if (!scheduleId && schedules.length > 0 && !isCreatingSchedule) {
      setScheduleId(schedules[0].id);
    }
  }, [scheduleId, schedules, isCreatingSchedule]);

  const schedule = schedules.find((item) => item.id === scheduleId) || null;


  const normalizeLegacyBodyForCompare = (value) =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const isLegacyDefaultBody = useCallback(
    (value) => {
      const normalized = normalizeLegacyBodyForCompare(value);
      if (!normalized) return false;
      return LEGACY_DEFAULT_EMAIL_BODY_VARIANTS.some(
        (candidate) => normalizeLegacyBodyForCompare(candidate) === normalized
      );
    },
    [LEGACY_DEFAULT_EMAIL_BODY_VARIANTS]
  );
  useEffect(() => {
    if (!schedule) return;
    const frequency = schedule.frequency === 'weekly' ? 'weekly' : 'monthly';
    setScheduleDay(Number(schedule.day_of_month ?? 1));
    setScheduleFrequency(frequency);
    setScheduleWeekday(Number(schedule.day_of_week ?? 1));
    const hour = Number(schedule.hour ?? 9);
    const minute = Number(schedule.minute ?? 0);
    setScheduleTime(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
    setScheduleTimezone(schedule.time_zone || 'America/New_York');
    setScheduleRecipientMode(schedule.send_to === 'selected' ? 'selected' : 'all');
    setScheduleName(schedule.name || (frequency === 'weekly' ? 'Weekly Schedule' : 'Monthly Schedule'));
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
    const loadedBody = String(schedule.body ?? '');
    setEmailBody(isLegacyDefaultBody(loadedBody) ? '' : loadedBody);
    if (typeof schedule.attach_invoice === 'boolean') setAttachInvoice(schedule.attach_invoice);
    if (typeof schedule.center_body === 'boolean') setIsBodyCentered(schedule.center_body);
  }, [schedule, members, guests, isLegacyDefaultBody]);

  const resetScheduleForm = () => {
    setScheduleId(null);
    setIsCreatingSchedule(true);
    setScheduleName('');
    setEmailBody('');
    setScheduleFrequency('monthly');
    setScheduleDay(1);
    setScheduleWeekday(1);
    setScheduleTime('09:00');
    setScheduleTimezone('America/New_York');
    setScheduleRecipientMode('all');
    setScheduleRecipientSearch('');
    setSelectedRecipientIds([]);
    setIsBodyCentered(false);
    setScheduleMessage(null);
  };

  const allRecipients = [
    ...members.map((m) => ({
      kind: 'member',
      id: m.id,
      key: `member:${m.id}`,
      name: m.full_name || m.english_name || m.hebrew_name || 'Member',
      email: m.email,
      balance: m.total_owed || 0,
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

  const recipientByKey = React.useMemo(() => {
    const map = new Map();
    for (const rec of allRecipients) {
      map.set(rec.key, rec);
    }
    return map;
  }, [allRecipients]);

  const resolveRecipientKey = useCallback(
    (rawId) => {
      if (!rawId && rawId !== 0) return null;
      if (typeof rawId === 'string' && rawId.includes(':')) return rawId;
      const rawStr = String(rawId);
      const member = members.find(
        (m) => String(m.id) === rawStr || String(m.member_id) === rawStr
      );
      if (member) return `member:${member.id}`;
      const guest = guests.find(
        (g) => String(g.id) === rawStr || String(g.guest_id) === rawStr
      );
      if (guest) return `guest:${guest.id}`;
      return null;
    },
    [members, guests]
  );

  const scheduleRecipients = React.useMemo(() => {
    if (!schedule || schedule.send_to !== 'selected') return [];
    const rawIds = Array.isArray(schedule.selected_member_ids)
      ? schedule.selected_member_ids
      : [];
    const uniqueKeys = new Set();
    for (const rawId of rawIds) {
      const key = resolveRecipientKey(rawId);
      if (key) uniqueKeys.add(key);
    }
    return Array.from(uniqueKeys)
      .map((key) => recipientByKey.get(key))
      .filter(Boolean);
  }, [schedule, recipientByKey, resolveRecipientKey]);

  const scheduleDisplay = React.useMemo(() => {
    if (!schedule) return null;
    const frequency = schedule.frequency === 'weekly' ? 'weekly' : 'monthly';
    const hour = Number(schedule.hour ?? 9);
    const minute = Number(schedule.minute ?? 0);
    const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const weekday = Number(schedule.day_of_week ?? 1);
    const weekDayLabels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const cadenceLabel =
      frequency === 'weekly'
        ? `Weekly on ${weekDayLabels[weekday] || 'Monday'}`
        : `Monthly on day ${Number(schedule.day_of_month ?? 1)}`;
    return {
      name: schedule.name || 'Current schedule',
      frequency,
      day: Number(schedule.day_of_month ?? 1),
      weekday,
      cadenceLabel,
      time,
      timeZone: schedule.time_zone || 'America/New_York',
      sendTo: schedule.send_to === 'selected' ? 'selected' : 'all',
      attachInvoice: Boolean(schedule.attach_invoice),
      centerBody: Boolean(schedule.center_body),
      subject: schedule.subject || emailSubject,
    };
  }, [schedule, emailSubject]);

  const containsHtml = (value) => /<\/?[a-z][\s\S]*>/i.test(String(value || ''));

  const escapeHtml = (value) =>
    String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const htmlFromBody = (value) => {
    if (containsHtml(value)) return String(value || '');
    return escapeHtml(value).replace(/\n/g, '<br/>');
  };

  const normalizeQuillHtmlForEmail = (value) => {
    const html = String(value || '');
    if (!html) return '';
    if (!containsHtml(html)) return html;
    if (typeof DOMParser === 'undefined') return html;

    const classStyleMap = {
      'ql-align-center': 'text-align:center;',
      'ql-align-right': 'text-align:right;',
      'ql-align-justify': 'text-align:justify;',
      'ql-direction-rtl': 'direction:rtl;text-align:right;',
      'ql-size-small': 'font-size:0.75em;',
      'ql-size-large': 'font-size:1.5em;',
      'ql-size-huge': 'font-size:2.5em;',
      'ql-font-serif': 'font-family:Georgia, Times New Roman, serif;',
      'ql-font-monospace': 'font-family:Monaco, Menlo, Consolas, monospace;',
      'ql-indent-1': 'padding-left:3em;',
      'ql-indent-2': 'padding-left:6em;',
      'ql-indent-3': 'padding-left:9em;',
      'ql-indent-4': 'padding-left:12em;',
      'ql-indent-5': 'padding-left:15em;',
      'ql-indent-6': 'padding-left:18em;',
      'ql-indent-7': 'padding-left:21em;',
      'ql-indent-8': 'padding-left:24em;',
    };

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return html;

    root.querySelectorAll('span.ql-ui').forEach((node) => node.remove());

    root.querySelectorAll('[class]').forEach((element) => {
      const classes = Array.from(element.classList);
      const styles = [];
      const keep = [];

      for (const cls of classes) {
        const mapped = classStyleMap[cls];
        if (mapped) {
          styles.push(mapped);
        } else if (!cls.startsWith('ql-')) {
          keep.push(cls);
        }
      }

      if (styles.length > 0) {
        const existing = String(element.getAttribute('style') || '').trim();
        element.setAttribute('style', `${existing} ${styles.join(' ')}`.trim());
      }

      if (keep.length > 0) {
        element.setAttribute('class', keep.join(' '));
      } else {
        element.removeAttribute('class');
      }
    });

    return root.innerHTML;
  };

  const stripHtml = (value) =>
    String(value || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();

  const hasSavedTemplate = statementTemplates.length > 0;
  const resolvedTemplate = React.useMemo(
    () => resolveStatementTemplate(statementTemplates[0]),
    [statementTemplates]
  );

  const saveScheduleMutation = useMutation({
    mutationFn: async ({ payload, forceCreate }) => {
      if (!forceCreate && scheduleId) {
        return base44.entities.EmailSchedule.update(scheduleId, payload);
      }
      return base44.entities.EmailSchedule.create(payload);
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['emailSchedule'] });
      setScheduleMessage({ type: 'success', text: 'Schedule saved.' });
      if (saved?.id) {
        setScheduleId(saved.id);
        setIsCreatingSchedule(false);
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
      setScheduleMessage({ type: 'success', text: 'Schedule deleted.' });
      resetScheduleForm();
    },
    onError: (error) => {
      setScheduleMessage({ type: 'error', text: error?.message || 'Failed to delete schedule.' });
    },
  });

  const handleSaveSchedule = (forceCreate = false) => {
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
      forceCreate: forceCreate || isCreatingSchedule || !scheduleId,
      payload: {
        name: scheduleName || (scheduleFrequency === 'weekly' ? 'Weekly Schedule' : 'Monthly Schedule'),
        enabled: true,
        frequency: scheduleFrequency,
        day_of_month: scheduleFrequency === 'monthly' ? scheduleDay : 1,
        day_of_week: scheduleFrequency === 'weekly' ? scheduleWeekday : null,
        hour,
        minute,
        time_zone: scheduleTimezone,
        send_to: scheduleRecipientMode,
        selected_member_ids: scheduleRecipientMode === 'selected' ? selectedRecipientIds : [],
        subject: emailSubject,
        body: emailBody,
        attach_invoice: attachInvoice,
        center_body: isBodyCentered,
      },
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

        const htmlBody = normalizeQuillHtmlForEmail(htmlFromBody(personalizedBody));
        const centeredHtml = isBodyCentered
          ? `<div style="text-align:center; white-space:pre-wrap;">${htmlBody}</div>`
          : htmlBody;
        const textBody = stripHtml(htmlBody);

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
          body: textBody || personalizedBody,
          html: centeredHtml,
          pdf: pdfPayload,
        });

        log.push({
          member: rec.name,
          status: 'sent',
          email: rec.email,
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

  const weekdayOptions = [
    { value: 0, label: 'Sunday' },
    { value: 1, label: 'Monday' },
    { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' },
    { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' },
  ];

  const timezoneOptions = [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'UTC',
  ];

  const filteredSendRecipients = React.useMemo(() => {
    const query = sendRecipientSearch.trim().toLowerCase();
    if (!query) return allRecipients;
    return allRecipients.filter((rec) => {
      const haystack = `${rec.name} ${rec.email || ''} ${rec.kind}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [allRecipients, sendRecipientSearch]);

  const filteredScheduleRecipients = React.useMemo(() => {
    const query = scheduleRecipientSearch.trim().toLowerCase();
    if (!query) return allRecipients;
    return allRecipients.filter((rec) => {
      const haystack = `${rec.name} ${rec.email || ''} ${rec.kind}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [allRecipients, scheduleRecipientSearch]);

  const oneTimeRecipients =
    sendRecipientMode === 'selected'
      ? allRecipients.filter((r) => sendSelectedRecipientIds.includes(r.key))
      : allRecipients;
  const oneTimeEmailCount = oneTimeRecipients.filter((r) => r.email).length;

  const scheduledRecipients =
    scheduleRecipientMode === 'selected'
      ? allRecipients.filter((r) => selectedRecipientIds.includes(r.key))
      : allRecipients;
  const scheduledEmailCount = scheduledRecipients.filter((r) => r.email).length;

  const toggleSelection = (selectedIds, setSelectedIds, key, checked) => {
    if (checked) {
      if (!selectedIds.includes(key)) {
        setSelectedIds([...selectedIds, key]);
      }
      return;
    }
    setSelectedIds(selectedIds.filter((id) => id !== key));
  };

  const renderRecipientSelector = ({
    mode,
    setMode,
    selectedIds,
    setSelectedIds,
    search,
    setSearch,
    filteredRecipients,
  }) => (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <button
          type="button"
          onClick={() => setMode('all')}
          className={`rounded-xl border-2 p-3 text-left transition ${
            mode === 'all'
              ? 'border-blue-600 bg-blue-50 text-blue-800'
              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4" />
            All Recipients
          </div>
          <p className="mt-1 text-xs text-slate-500">Send to everyone with an email.</p>
        </button>
        <button
          type="button"
          onClick={() => setMode('selected')}
          className={`rounded-xl border-2 p-3 text-left transition ${
            mode === 'selected'
              ? 'border-blue-600 bg-blue-50 text-blue-800'
              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            <AlertCircle className="h-4 w-4" />
            Selected Recipients
          </div>
          <p className="mt-1 text-xs text-slate-500">Choose specific members and guests.</p>
        </button>
      </div>

      {mode === 'selected' && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search recipients"
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const addKeys = filteredRecipients.map((r) => r.key);
                  setSelectedIds(Array.from(new Set([...selectedIds, ...addKeys])));
                }}
              >
                Select Filtered
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedIds([])}
              >
                Clear
              </Button>
            </div>
          </div>

          <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
            {filteredRecipients.map((rec) => (
              <label
                key={rec.key}
                className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(rec.key)}
                  onChange={(e) =>
                    toggleSelection(selectedIds, setSelectedIds, rec.key, e.target.checked)
                  }
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">{rec.name}</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 uppercase tracking-wide">
                      {rec.kind}
                    </span>
                    <span className="truncate">{rec.email || 'No email'}</span>
                  </div>
                </div>
                <span className="text-xs font-semibold text-amber-700">${rec.balance.toFixed(2)}</span>
              </label>
            ))}
            {filteredRecipients.length === 0 && (
              <div className="px-2 py-6 text-center text-sm text-slate-500">No matches found.</div>
            )}
          </div>
          <div className="text-xs text-slate-500">Selected: {selectedIds.length} recipients</div>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_0%_0%,rgba(30,64,175,0.12),transparent_32%),radial-gradient(circle_at_100%_0%,rgba(2,132,199,0.16),transparent_28%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_50%,#f8fafc_100%)]">
      <style>{`
        .email-quill-center .ql-editor {
          text-align: center;
        }
        .email-quill-tall .ql-editor {
          min-height: 220px;
        }
        .email-quill-tall .ql-toolbar {
          border-top-left-radius: 12px;
          border-top-right-radius: 12px;
        }
        .email-quill-tall .ql-container {
          border-bottom-left-radius: 12px;
          border-bottom-right-radius: 12px;
        }
      `}</style>
      <div className="mx-auto max-w-[1440px] px-4 py-6 lg:px-8">
        <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
          <Card className="border-slate-200/90 bg-white/95 shadow-[0_18px_45px_rgba(15,23,42,0.09)] backdrop-blur">
            <CardHeader className="border-b border-slate-200/80 bg-slate-50/70">
              <CardTitle className="flex items-center gap-2 text-slate-900">
                <FileText className="h-5 w-5 text-blue-700" />
                Message Composer
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 p-5">
              <div className="space-y-2">
                <Label htmlFor="subject" className="text-slate-700">
                  Subject Line
                </Label>
                <Input
                  id="subject"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Monthly Statement Update"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="body" className="text-slate-700">
                  Email Body
                </Label>
                <div
                  className={`email-quill-tall rounded-xl border border-slate-300 bg-white ${
                    isBodyCentered ? 'email-quill-center' : ''
                  }`}
                >
                  <ReactQuill
                    theme="snow"
                    value={emailBody}
                    onChange={setEmailBody}
                    modules={{
                      toolbar: [
                        [{ header: [1, 2, 3, false] }],
                        ['bold', 'italic', 'underline', 'strike'],
                        [{ color: [] }, { background: [] }],
                        [{ list: 'ordered' }, { list: 'bullet' }],
                        [{ align: [] }],
                        ['link', 'clean'],
                      ],
                    }}
                    formats={[
                      'header',
                      'bold',
                      'italic',
                      'underline',
                      'strike',
                      'color',
                      'background',
                      'list',
                      'bullet',
                      'align',
                      'link',
                    ]}
                  />
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5">{'{member_name}'}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5">{'{hebrew_name}'}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5">{'{balance}'}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5">{'{id}'}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5">{'{save_card_url}'}</span>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label
                  htmlFor="attachInvoice"
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                    attachInvoice
                      ? 'border-blue-300 bg-blue-50/80'
                      : 'border-slate-200 bg-slate-50/70 hover:border-slate-300'
                  } ${!hasSavedTemplate ? 'opacity-75' : ''}`}
                >
                  <input
                    type="checkbox"
                    id="attachInvoice"
                    checked={attachInvoice}
                    onChange={(e) => setAttachInvoice(e.target.checked)}
                    disabled={!hasSavedTemplate}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                  <div>
                    <div className="font-semibold text-slate-900">Attach PDF Statement</div>
                    <p className="text-xs text-slate-600">
                      Include invoice PDF with each email
                      {!hasSavedTemplate && ' (enable by saving template in Settings)'}
                    </p>
                  </div>
                </label>

                <label
                  htmlFor="centerBody"
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                    isBodyCentered
                      ? 'border-blue-300 bg-blue-50/80'
                      : 'border-slate-200 bg-slate-50/70 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    id="centerBody"
                    checked={isBodyCentered}
                    onChange={(e) => setIsBodyCentered(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                  <div>
                    <div className="font-semibold text-slate-900">Center Message Body</div>
                    <p className="text-xs text-slate-600">Apply centered alignment in editor and email HTML</p>
                  </div>
                </label>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/90 bg-white/95 shadow-[0_18px_45px_rgba(15,23,42,0.09)] backdrop-blur">
            <CardHeader className="border-b border-slate-200/80 bg-slate-50/70">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="flex items-center gap-2 text-slate-900">
                  <Send className="h-5 w-5 text-blue-700" />
                  Delivery Setup
                </CardTitle>
                <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
                  <button
                    type="button"
                    onClick={() => setSendType('one-time')}
                    className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                      sendType === 'one-time'
                        ? 'bg-blue-700 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    One-Time Send
                  </button>
                  <button
                    type="button"
                    onClick={() => setSendType('scheduled')}
                    className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                      sendType === 'scheduled'
                        ? 'bg-blue-700 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Scheduled
                  </button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-5 p-5">
              {sendType === 'one-time' ? (
                <>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                        <Mail className="h-4 w-4 text-blue-700" />
                        One-time delivery
                      </div>
                      <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800">
                        {oneTimeEmailCount} deliverable
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      Current scope: {oneTimeRecipients.length} selected · {oneTimeEmailCount} with email
                    </p>
                  </div>

                  {renderRecipientSelector({
                    mode: sendRecipientMode,
                    setMode: setSendRecipientMode,
                    selectedIds: sendSelectedRecipientIds,
                    setSelectedIds: setSendSelectedRecipientIds,
                    search: sendRecipientSearch,
                    setSearch: setSendRecipientSearch,
                    filteredRecipients: filteredSendRecipients,
                  })}

                  <Button
                    onClick={handleSendNow}
                    disabled={sending || oneTimeEmailCount === 0}
                    className="h-11 w-full bg-blue-700 hover:bg-blue-600"
                  >
                    <Send className="mr-2 h-5 w-5" />
                    {sending ? 'Sending...' : `Send to ${oneTimeEmailCount} Recipients`}
                  </Button>
                </>
              ) : (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-slate-700">Schedule</Label>
                      <Select
                        value={scheduleId || 'new'}
                        onValueChange={(value) => {
                          if (value === 'new') {
                            resetScheduleForm();
                          } else {
                            setScheduleId(value);
                            setScheduleMessage(null);
                            setIsCreatingSchedule(false);
                          }
                        }}
                      >
                        <SelectTrigger>
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
                      <Label htmlFor="scheduleName" className="text-slate-700">
                        Schedule Name
                      </Label>
                      <Input
                        id="scheduleName"
                        value={scheduleName}
                        onChange={(e) => setScheduleName(e.target.value)}
                        placeholder={scheduleFrequency === 'weekly' ? 'Weekly Reminder' : 'Monthly Statement'}
                      />
                    </div>
                  </div>

                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label className="text-slate-700">Cadence</Label>
                        <div className="inline-flex w-full rounded-xl border border-slate-200 bg-slate-100 p-1">
                          <button
                            type="button"
                            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                              scheduleFrequency === 'monthly'
                                ? 'bg-white text-slate-900 shadow-sm'
                                : 'text-slate-600'
                            }`}
                            onClick={() => setScheduleFrequency('monthly')}
                          >
                            Monthly
                          </button>
                          <button
                            type="button"
                            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                              scheduleFrequency === 'weekly'
                                ? 'bg-white text-slate-900 shadow-sm'
                                : 'text-slate-600'
                            }`}
                            onClick={() => setScheduleFrequency('weekly')}
                          >
                            Weekly
                          </button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-slate-700">
                          {scheduleFrequency === 'monthly' ? 'Day of Month' : 'Day of Week'}
                        </Label>
                        {scheduleFrequency === 'monthly' ? (
                          <Select
                            value={String(scheduleDay)}
                            onValueChange={(value) => setScheduleDay(Number(value))}
                          >
                            <SelectTrigger>
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
                        ) : (
                          <Select
                            value={String(scheduleWeekday)}
                            onValueChange={(value) => setScheduleWeekday(Number(value))}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {weekdayOptions.map((day) => (
                                <SelectItem key={day.value} value={String(day.value)}>
                                  {day.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="scheduleTime" className="text-slate-700">
                          <span className="inline-flex items-center gap-1.5">
                            <Clock3 className="h-3.5 w-3.5" />
                            Send Time
                          </span>
                        </Label>
                        <input
                          id="scheduleTime"
                          type="time"
                          value={scheduleTime}
                          onChange={(e) => setScheduleTime(e.target.value)}
                          className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-slate-700">Timezone</Label>
                        <Select value={scheduleTimezone} onValueChange={setScheduleTimezone}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {timezoneOptions.map((zone) => (
                              <SelectItem key={zone} value={zone}>
                                {zone}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="text-xs text-slate-500">
                      {scheduleFrequency === 'monthly'
                        ? 'Monthly schedules run on the selected day. Short months run on the last available day.'
                        : 'Weekly schedules run every selected weekday at the chosen time.'}
                    </div>
                  </div>

                  {renderRecipientSelector({
                    mode: scheduleRecipientMode,
                    setMode: setScheduleRecipientMode,
                    selectedIds: selectedRecipientIds,
                    setSelectedIds: setSelectedRecipientIds,
                    search: scheduleRecipientSearch,
                    setSearch: setScheduleRecipientSearch,
                    filteredRecipients: filteredScheduleRecipients,
                  })}

                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-600">
                    <div className="flex items-center gap-2 font-semibold text-slate-800">
                      <Repeat className="h-4 w-4 text-blue-700" />
                      Schedule Preview
                    </div>
                    {scheduleDisplay ? (
                      <div className="mt-2 space-y-1">
                        <div>
                          <span className="font-semibold">{scheduleDisplay.name}</span> ·{' '}
                          {scheduleDisplay.cadenceLabel}
                        </div>
                        <div>
                          Runs at {scheduleDisplay.time} ({scheduleDisplay.timeZone})
                        </div>
                        <div>
                          Recipients: {scheduleDisplay.sendTo === 'all' ? 'All' : 'Selected'} ·
                          {' '}
                          {scheduledRecipients.length} selected · {scheduledEmailCount} with email
                        </div>
                        <div>
                          Attach invoice: {scheduleDisplay.attachInvoice ? 'Yes' : 'No'} · Body alignment:{' '}
                          {scheduleDisplay.centerBody ? 'Centered' : 'Left'}
                        </div>
                        {scheduleDisplay.sendTo === 'selected' && scheduleRecipients.length > 0 && (
                          <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2 text-xs">
                            {scheduleRecipients.slice(0, 5).map((rec) => (
                              <div key={rec.key} className="flex items-center justify-between gap-2">
                                <span className="truncate font-medium text-slate-700">{rec.name}</span>
                                <span className="truncate text-slate-500">{rec.email || 'No email'}</span>
                              </div>
                            ))}
                            {scheduleRecipients.length > 5 && (
                              <div className="mt-1 text-slate-500">
                                +{scheduleRecipients.length - 5} more recipients
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-2">No schedule selected yet.</div>
                    )}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      onClick={() => handleSaveSchedule(false)}
                      disabled={savingSchedule}
                      className="h-11 bg-blue-700 hover:bg-blue-600"
                    >
                      {savingSchedule
                        ? 'Saving...'
                        : isCreatingSchedule || !scheduleId
                          ? 'Create Schedule'
                          : 'Update Schedule'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11"
                      onClick={resetScheduleForm}
                    >
                      New Schedule
                    </Button>
                  </div>

                  {scheduleId && !isCreatingSchedule && (
                    <Button
                      variant="outline"
                      className="w-full border-blue-300 text-blue-700 hover:bg-blue-50"
                      onClick={() => handleSaveSchedule(true)}
                      disabled={savingSchedule}
                    >
                      Save as New Schedule
                    </Button>
                  )}

                  {schedule && (
                    <Button
                      variant="outline"
                      className="w-full border-red-300 text-red-700 hover:bg-red-50"
                      disabled={deleteScheduleMutation.isPending}
                      onClick={() => {
                        if (confirm('Delete this email schedule?')) {
                          deleteScheduleMutation.mutate();
                        }
                      }}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {deleteScheduleMutation.isPending ? 'Deleting...' : 'Delete Schedule'}
                    </Button>
                  )}

                  {scheduleMessage && (
                    <p
                      className={`text-center text-sm ${
                        scheduleMessage.type === 'error' ? 'text-red-600' : 'text-green-700'
                      }`}
                    >
                      {scheduleMessage.text}
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="mt-6 border-slate-200 bg-white/95 shadow-[0_14px_35px_rgba(15,23,42,0.08)]">
          <CardHeader className="border-b border-slate-200 bg-slate-50/70">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-slate-900">
                <CalendarDays className="h-4 w-4 text-blue-700" />
                All Schedules
              </CardTitle>
              <div className="flex items-center gap-3">
                {sendType !== 'scheduled' && (
                  <span className="text-xs text-slate-500">Click a schedule to edit</span>
                )}
                <span className="text-xs text-slate-500">{schedules.length} total</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            {schedules.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                No schedules yet. Open Scheduled mode above to create one.
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {schedules.map((item) => {
                  const frequency = item.frequency === 'weekly' ? 'weekly' : 'monthly';
                  const hour = Number(item.hour ?? 9);
                  const minute = Number(item.minute ?? 0);
                  const scheduleTimeLabel = `${String(hour).padStart(2, '0')}:${String(
                    minute
                  ).padStart(2, '0')}`;
                  const weekdayValue = Number(item.day_of_week ?? 1);
                  const weekdayLabel =
                    weekdayOptions.find((entry) => entry.value === weekdayValue)?.label || 'Monday';
                  const cadence =
                    frequency === 'weekly'
                      ? `Weekly · ${weekdayLabel}`
                      : `Monthly · Day ${Number(item.day_of_month ?? 1)}`;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSendType('scheduled');
                        setScheduleId(item.id);
                        setScheduleMessage(null);
                        setIsCreatingSchedule(false);
                      }}
                      className={`w-full rounded-xl border p-3 text-left transition ${
                        scheduleId === item.id && !isCreatingSchedule
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900">
                          {item.name || `Schedule ${item.id.slice(0, 6)}`}
                        </span>
                        <span className="text-xs text-slate-500">{cadence}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {scheduleTimeLabel} ({item.time_zone || 'America/New_York'})
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {sendLog.length > 0 && (
          <Card className="mt-6 border-slate-200 bg-white/95 shadow-[0_14px_35px_rgba(15,23,42,0.08)]">
            <CardHeader className="border-b border-slate-200 bg-slate-50/70">
              <CardTitle className="text-slate-900">Send Log</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-slate-200 bg-slate-50/80">
                    <tr>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-slate-700">Recipient</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-slate-700">Status</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-slate-700">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sendLog.map((log, idx) => (
                      <tr key={idx}>
                        <td className="px-6 py-4 font-medium text-slate-900">{log.member || '-'}</td>
                        <td className="px-6 py-4">
                          <span
                            className={`rounded px-2 py-1 text-xs font-semibold ${
                              log.status === 'sent'
                                ? 'bg-green-100 text-green-800'
                                : log.status === 'failed'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {log.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-600">{log.email || log.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
