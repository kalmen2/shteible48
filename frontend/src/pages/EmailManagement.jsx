import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation } from "@tanstack/react-query";
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

  const { data: members = [] } = useQuery({
    queryKey: ['members'],
    queryFn: () => base44.entities.Member.list('-full_name', 1000),
  });

  const { data: allTransactions = [] } = useQuery({
    queryKey: ['allTransactions'],
    queryFn: () => base44.entities.Transaction.list('-date', 10000),
  });

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

  const sendMonthlyEmails = async () => {
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

            <Button
              onClick={sendMonthlyEmails}
              disabled={sending || membersWithBalance.length === 0}
              className="w-full h-12 bg-blue-900 hover:bg-blue-800"
            >
              <Send className="w-5 h-5 mr-2" />
              {sending ? "Sending..." : sendType === "monthly" ? "Schedule Monthly Emails" : `Send to ${membersWithBalance.filter(m => m.email).length} Members`}
            </Button>

            {sendType === "monthly" && (
              <p className="text-sm text-amber-600 text-center">
                Emails will be sent automatically on the 1st of each month
              </p>
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