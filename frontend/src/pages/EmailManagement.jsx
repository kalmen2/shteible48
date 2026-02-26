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
  const [sendType, setSendType] = useState('now'); // "now" or "monthly"
  const [attachInvoice, setAttachInvoice] = useState(false);
  const [isBodyCentered, setIsBodyCentered] = useState(false);
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
    setScheduleDay(1);
    setScheduleTime('09:00');
    setScheduleTimezone('America/New_York');
    setScheduleRecipientMode('all');
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
    const hour = Number(schedule.hour ?? 9);
    const minute = Number(schedule.minute ?? 0);
    const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    return {
      name: schedule.name || 'Current schedule',
      day: Number(schedule.day_of_month ?? 1),
      time,
      timeZone: schedule.time_zone || 'America/New_York',
      sendTo: schedule.send_to === 'selected' ? 'selected' : 'all',
      attachInvoice: Boolean(schedule.attach_invoice),
      centerBody: Boolean(schedule.center_body),
      subject: schedule.subject || emailSubject,
    };
  }, [schedule, emailSubject]);

  const recipientsWithBalance = allRecipients.filter((r) => (r.balance || 0) > 0);

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
      setScheduleMessage({ type: 'success', text: 'Monthly schedule saved.' });
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
      setScheduleMessage({ type: 'success', text: 'Monthly schedule deleted.' });
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
    <div className="min-h-screen bg-slate-50">
      <style>{`
        .email-quill-center .ql-editor {
          text-align: center;
        }
        .email-quill-tall .ql-editor {
          min-height: 180px;
        }
      `}</style>
      <div className="mx-auto max-w-7xl px-4 py-8 lg:px-8">

        {/* Email Template */}
            <Card className="mb-6 border-slate-200 bg-white shadow-sm">
              <CardHeader className="border-b border-slate-200 bg-slate-50">
                <CardTitle className="text-slate-900">Email Management</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <div className="space-y-2">
                  <Label className="text-slate-700">Send Mode</Label>
                  <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => setSendType('now')}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                        sendType === 'now'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Send Now
                    </button>
                    <button
                      type="button"
                      onClick={() => setSendType('monthly')}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                        sendType === 'monthly'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Monthly
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="subject" className="text-slate-700">Subject</Label>
                  <input
                    id="subject"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="body" className="text-slate-700">Email Body</Label>
                  <div
                    className={`email-quill-tall rounded-lg border border-slate-300 ${
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
                  <p className="text-xs text-slate-500">
                    Available variables: {'{member_name}'}, {'{hebrew_name}'}, {'{balance}'},{' '}
                    {'{id}'}, {'{save_card_url}'}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <input
                      type="checkbox"
                      id="attachInvoice"
                      checked={attachInvoice}
                      onChange={(e) => setAttachInvoice(e.target.checked)}
                      disabled={!hasSavedTemplate}
                      className="h-5 w-5 rounded border-slate-300 text-blue-600"
                    />
                    <label htmlFor="attachInvoice" className="flex items-center gap-2 cursor-pointer">
                      <FileText className="h-5 w-5 text-blue-700" />
                      <div>
                        <div className="font-semibold text-slate-900">Attach PDF Invoice</div>
                        <div className="text-sm text-slate-600">
                          Include member statement as PDF attachment
                          {!hasSavedTemplate && ' (save a template to enable)'}
                        </div>
                      </div>
                    </label>
                  </div>

                  <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <input
                      type="checkbox"
                      id="centerBody"
                      checked={isBodyCentered}
                      onChange={(e) => setIsBodyCentered(e.target.checked)}
                      className="h-5 w-5 rounded border-slate-300 text-blue-600"
                    />
                    <label htmlFor="centerBody" className="flex items-center gap-2 cursor-pointer">
                      <span className="font-semibold text-slate-900">Center email body</span>
                      <span className="text-sm text-slate-600">
                        Centers the email text in the UI and the sent email.
                      </span>
                    </label>
                  </div>
                </div>

                {sendType === 'now' && (
                  <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
                    <Label className="text-slate-700">Recipients (one-time send)</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setSendRecipientMode('all')}
                        className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                          sendRecipientMode === 'all'
                            ? 'border-blue-600 bg-blue-50 text-blue-700'
                            : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
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
                            ? 'border-blue-600 bg-blue-50 text-blue-700'
                            : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
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
                      <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200 p-2">
                        {allRecipients.map((rec) => (
                          <label
                            key={`${rec.kind}-${rec.id}`}
                            className="flex items-center gap-3 rounded px-2 py-2 hover:bg-slate-50"
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
                              className="h-4 w-4 rounded border-slate-300 text-blue-600"
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-slate-900">{rec.name}</div>
                              <div className="text-xs text-slate-500 flex items-center gap-2">
                                <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] uppercase text-slate-700">
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
                  <div className="space-y-4">
                    <Card className="border-slate-200 bg-white shadow-sm">
                      <CardHeader className="border-b border-slate-200 bg-slate-50">
                        <CardTitle className="text-base text-slate-900">Saved Schedules</CardTitle>
                      </CardHeader>
                      <CardContent className="p-4">
                        {schedules.length === 0 ? (
                          <div className="text-sm text-slate-500">
                            No schedules yet. Create one below.
                          </div>
                        ) : (
                          <div className="grid gap-3">
                            {schedules.map((item) => {
                              const isSelected = scheduleId === item.id;
                              const recipientCount =
                                item.send_to === 'selected'
                                  ? Array.isArray(item.selected_member_ids)
                                    ? item.selected_member_ids.length
                                    : 0
                                  : allRecipients.length;
                              const emailCount =
                                item.send_to === 'selected'
                                  ? Array.isArray(item.selected_member_ids)
                                    ? item.selected_member_ids
                                        .map((id) => resolveRecipientKey(id))
                                        .filter((key) => {
                                          if (!key) return false;
                                          const rec = recipientByKey.get(key);
                                          return Boolean(rec?.email);
                                        }).length
                                    : 0
                                  : allRecipients.filter((r) => r.email).length;
                              const hour = Number(item.hour ?? 9);
                              const minute = Number(item.minute ?? 0);
                              const time = `${String(hour).padStart(2, '0')}:${String(
                                minute
                              ).padStart(2, '0')}`;

                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => {
                                    setScheduleId(item.id);
                                    setScheduleMessage(null);
                                    setIsCreatingSchedule(false);
                                  }}
                                  className={`w-full rounded-lg border px-4 py-3 text-left transition ${
                                    isSelected
                                      ? 'border-blue-600 bg-blue-50'
                                      : 'border-slate-300 bg-white hover:border-slate-400'
                                  }`}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="font-semibold text-slate-900">
                                      {item.name || `Schedule ${item.id.slice(0, 6)}`}
                                    </div>
                                    <span
                                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                        item.enabled
                                          ? 'bg-green-100 text-green-700'
                                          : 'bg-slate-100 text-slate-500'
                                      }`}
                                    >
                                      {item.enabled ? 'Enabled' : 'Disabled'}
                                    </span>
                                  </div>
                                  <div className="text-xs text-slate-500 mt-1">
                                    Day {item.day_of_month ?? 1} at {time} (
                                    {item.time_zone || 'America/New_York'})
                                  </div>
                                  <div className="text-xs text-slate-500 mt-1">
                                    Recipients:{' '}
                                    {item.send_to === 'selected' ? 'Selected' : 'All'} · {recipientCount}{' '}
                                    total · {emailCount} with email
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                        <Label htmlFor="scheduleName" className="text-slate-700">Schedule Name</Label>
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
                        <Label className="text-slate-700">Day of Month</Label>
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
                        <Label htmlFor="scheduleTime" className="text-slate-700">Time</Label>
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
                      <Label className="text-slate-700">Recipients</Label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => setScheduleRecipientMode('all')}
                          className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                            scheduleRecipientMode === 'all'
                              ? 'border-blue-600 bg-blue-50 text-blue-700'
                              : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
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
                              ? 'border-blue-600 bg-blue-50 text-blue-700'
                              : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
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
                        <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200 p-2">
                          {allRecipients.map((person) => {
                            return (
                              <label
                                key={person.key}
                                className="flex items-center gap-3 rounded px-2 py-2 hover:bg-slate-50"
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
                                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
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
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  <Button
                    onClick={sendType === 'monthly' ? () => handleSaveSchedule(false) : handleSendNow}
                    disabled={
                      sendType === 'monthly'
                        ? savingSchedule
                        : sending || recipientsWithBalance.length === 0
                    }
                    className="h-11 w-full bg-blue-700 hover:bg-blue-600"
                  >
                    <Send className="w-5 h-5 mr-2" />
                    {sendType === 'monthly'
                      ? savingSchedule
                        ? 'Saving...'
                        : isCreatingSchedule || !scheduleId
                          ? 'Create Monthly Schedule'
                          : 'Update Monthly Schedule'
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
                  {sendType === 'monthly' && scheduleId && !isCreatingSchedule && (
                    <Button
                      variant="outline"
                      className="w-full border-blue-300 text-blue-700 hover:bg-blue-50"
                      onClick={() => handleSaveSchedule(true)}
                      disabled={savingSchedule}
                    >
                      Save as New Schedule
                    </Button>
                  )}
                </div>

                {sendType === 'monthly' && (
                  <>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      {schedule && scheduleDisplay ? (
                        <div className="flex flex-col gap-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold text-slate-700">
                              {scheduleDisplay.name}
                            </span>
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                              Enabled
                            </span>
                          </div>
                          <div>
                            Emails send on day {scheduleDisplay.day} at {scheduleDisplay.time} (
                            {scheduleDisplay.timeZone})
                          </div>
                          <div className="text-xs text-slate-500">
                            Recipients: {scheduleDisplay.sendTo === 'all' ? 'All' : 'Selected'} ·
                            Attach invoice: {scheduleDisplay.attachInvoice ? 'Yes' : 'No'}
                          </div>
                          <div className="text-xs text-slate-500">
                            Subject: {scheduleDisplay.subject || 'Monthly Statement'}
                          </div>
                          <div className="text-xs text-slate-500">
                            Body alignment: {scheduleDisplay.centerBody ? 'Centered' : 'Left'}
                          </div>
                          {scheduleDisplay.sendTo === 'all' && (
                            <div className="text-xs text-slate-500">
                              All recipients: {allRecipients.length} · With email:{' '}
                              {allRecipients.filter((r) => r.email).length}
                            </div>
                          )}
                          {scheduleDisplay.sendTo === 'selected' && (
                            <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
                              <div className="mb-2 font-semibold text-slate-700">
                                Assigned recipients ({scheduleRecipients.length})
                              </div>
                              {scheduleRecipients.length === 0 ? (
                                <div className="text-slate-500">No recipients saved.</div>
                              ) : (
                                <div className="max-h-32 space-y-1 overflow-y-auto">
                                  {scheduleRecipients.map((rec) => (
                                    <div
                                      key={rec.key}
                                      className="flex items-center justify-between gap-2"
                                    >
                                      <span className="truncate font-medium">{rec.name}</span>
                                      <span className="truncate text-slate-500">
                                        {rec.email || 'No email'}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
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
                        className="w-full border-red-500/40 text-red-300 hover:bg-red-500/10"
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

            {/* Send Log */}
            {sendLog.length > 0 && (
              <Card className="border-slate-200 bg-white shadow-sm">
                <CardHeader className="border-b border-slate-200 bg-slate-50">
                  <CardTitle className="text-slate-900">Send Log</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="border-b border-slate-200 bg-slate-50">
                        <tr>
                          <th className="px-6 py-4 text-left text-sm font-semibold text-slate-700">
                            Member
                          </th>
                          <th className="px-6 py-4 text-left text-sm font-semibold text-slate-700">
                            Status
                          </th>
                          <th className="px-6 py-4 text-left text-sm font-semibold text-slate-700">
                            Details
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sendLog.map((log, idx) => (
                          <tr key={idx}>
                            <td className="px-6 py-4 font-medium text-slate-900">{log.member}</td>
                            <td className="py-4 px-6">
                              <span
                                className={`px-2 py-1 rounded text-xs font-medium ${
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
                            <td className="px-6 py-4 text-sm text-slate-600">
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
      </div>
    </div>
  );
}
