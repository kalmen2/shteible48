import React, { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Printer, ChevronRight, Users, UserPlus, Mail, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { format, startOfMonth, endOfMonth } from "date-fns";

// Parse YYYY-MM-DD as a local date (midnight local) to avoid timezone shifts
const toLocalDate = (dateStr) => {
  if (!dateStr) return null;
  const parts = String(dateStr).split("-").map(Number);
  if (parts.length < 3) return null;
  const [y, m, d] = parts;
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, m - 1, d);
};

// Parse YYYY-MM as a local month (not UTC) to avoid shifting into prior/next month on some browsers (e.g., Safari, chrome and some users in other timezones)
const toLocalMonthDate = (monthStr) => {
  if (!monthStr) return null;
  const parts = String(monthStr).split("-").map(Number);
  if (parts.length < 2) return null;
  const [y, m] = parts;
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  return new Date(y, m - 1, 1);
};

export default function Months() {
  const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState(null);
  const printRef = useRef();

  const { data: members = [] } = useQuery({
    queryKey: ['members'],
    queryFn: () => base44.entities.Member.list('-full_name', 1000),
  });

  const { data: guests = [] } = useQuery({
    queryKey: ['guests'],
    queryFn: () => base44.entities.Guest.list('full_name', 1000),
  });

  const { data: memberTransactions = [] } = useQuery({
    queryKey: ['allTransactions'],
    queryFn: () => base44.entities.Transaction.list('-date', 10000),
  });

  const { data: guestTransactions = [] } = useQuery({
    queryKey: ['guestTransactions'],
    queryFn: () => base44.entities.GuestTransaction.list('-date', 10000),
  });

  const { data: plans = [] } = useQuery({
    queryKey: ['membershipPlans'],
    queryFn: () => base44.entities.MembershipPlan.list('-created_date', 1),
  });

  const { data: membershipCharges = [] } = useQuery({
    queryKey: ['membershipCharges'],
    queryFn: () => base44.entities.MembershipCharge.list('-created_date', 10000),
  });

  const { data: recurringPayments = [] } = useQuery({
    queryKey: ['recurringPayments'],
    queryFn: () => base44.entities.RecurringPayment.filter({ is_active: true }),
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['statementTemplates'],
    queryFn: () => base44.entities.StatementTemplate.list('-created_date', 1),
  });

  const template = templates[0] || {
    header_title: "Shtiebel 48",
    header_subtitle: "Manager",
    header_font_size: 32,
    header_color: "#1e3a8a",
    show_member_id: true,
    show_email: true,
    show_charges_section: true,
    show_payments_section: true,
    charges_color: "#d97706",
    payments_color: "#16a34a",
    balance_color: "#dc2626",
    body_font_size: 14,
    footer_text: "Thank you for your support",
    show_footer: true
  };

  const currentPlan = plans[0];

  // Generate 12 months for selected year
  const generateMonthsForYear = (year) => {
    const months = [];
    for (let i = 0; i < 12; i++) {
      const date = new Date(year, i, 1);
      months.push({
        value: format(date, 'yyyy-MM'),
        label: format(date, 'MMMM'),
        date: date
      });
    }
    return months;
  };

  const parsedYear = Number(selectedYear);
  const validYear = Number.isFinite(parsedYear);
  const monthsForYear = validYear ? generateMonthsForYear(parsedYear) : [];

  // Get transactions for a specific month
  const getMonthlyTransactions = (monthValue, entityTransactions, idField) => {
    const baseMonth = toLocalMonthDate(monthValue);
    if (!baseMonth) return [];
    const monthStart = startOfMonth(baseMonth);
    const monthEnd = endOfMonth(baseMonth);
    
    return entityTransactions.filter(t => {
      if (!t.date) return false;
      const transDate = toLocalDate(t.date);
      if (!transDate) return false;
      return transDate >= monthStart && transDate <= monthEnd;
    });
  };

  // Check if month has any activity
  const hasMonthActivity = (monthValue) => {
    const memberTrans = getMonthlyTransactions(monthValue, memberTransactions, 'member_id');
    const guestTrans = getMonthlyTransactions(monthValue, guestTransactions, 'guest_id');
    return memberTrans.length > 0 || guestTrans.length > 0;
  };

  const now = new Date();
  const currentMonthIndex = now.getMonth();
  const currentYear = now.getFullYear();
  const monthsWithActivity =
    validYear && parsedYear === currentYear
      ? monthsForYear.filter(
          (month) =>
            month.date.getMonth() === currentMonthIndex ||
            (month.date.getMonth() < currentMonthIndex && hasMonthActivity(month.value))
        )
      : monthsForYear.filter((month) => hasMonthActivity(month.value));

  const getMemberCharges = (memberId) => {
    return membershipCharges.filter(c => c.member_id === memberId && c.is_active);
  };

  const getMemberRecurringPayments = (memberId) => {
    return recurringPayments.filter(p => p.member_id === memberId && p.is_active);
  };

  const getMemberTotalMonthly = (memberId) => {
    const standardAmount = Number(currentPlan?.standard_amount || 0);
    const memberCharges = getMemberCharges(memberId);
    const memberRecurring = getMemberRecurringPayments(memberId);

    const chargesTotal = memberCharges.reduce((sum, c) => sum + (c.amount || 0), 0);
    const recurringTotal = memberRecurring.reduce((sum, p) => sum + (p.amount_per_month || 0), 0);

    return standardAmount + chargesTotal + recurringTotal;
  };

  const isMonthlyChargeDescription = (description) => {
    const value = String(description || "").toLowerCase();
    return (
      value.includes("monthly membership") ||
      value.includes("additional monthly payment") ||
      value.includes("balance payoff plan")
    );
  };

  // Get member data for selected month
  const getMemberMonthlyData = (member, monthValue) => {
    const baseMonth = toLocalMonthDate(monthValue);
    if (!baseMonth) return { transactions: [], charges: 0, payments: 0, balanceAsOfEndOfMonth: 0 };
    const monthStart = startOfMonth(baseMonth);
    const monthEnd = endOfMonth(baseMonth);
    
    const transactions = memberTransactions.filter(t => {
      if (t.member_id !== member.id) return false;
      if (!t.date) return false;
      const transDate = toLocalDate(t.date);
      if (!transDate) return false;
      return transDate >= monthStart && transDate <= monthEnd;
    });
    
    const charges = transactions.filter(t => t.type === 'charge').reduce((sum, t) => sum + (t.amount || 0), 0);
    const payments = transactions.filter(t => t.type === 'payment').reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalMonthly = getMemberTotalMonthly(member.id);
    const monthlyChargesThisMonth = transactions
      .filter(t => t.type === 'charge' && isMonthlyChargeDescription(t.description))
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    
    // Calculate balance as of end of month
    const allTransactionsUpToMonth = memberTransactions.filter(t => {
      if (t.member_id !== member.id) return false;
      if (!t.date) return false;
      const transDate = toLocalDate(t.date);
      if (!transDate) return false;
      return transDate <= monthEnd;
    });
    
    const totalCharges = allTransactionsUpToMonth.filter(t => t.type === 'charge').reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalPayments = allTransactionsUpToMonth.filter(t => t.type === 'payment').reduce((sum, t) => sum + (t.amount || 0), 0);
    const missingMonthly = Math.max(0, totalMonthly - monthlyChargesThisMonth);
    const balanceAsOfEndOfMonth = totalCharges - totalPayments + missingMonthly;
    
    return { transactions, charges, payments, balanceAsOfEndOfMonth };
  };

  // Get guest data for selected month
  const getGuestMonthlyData = (guest, monthValue) => {
    const baseMonth = toLocalMonthDate(monthValue);
    if (!baseMonth) return { transactions: [], charges: 0, payments: 0, balanceAsOfEndOfMonth: 0 };
    const monthStart = startOfMonth(baseMonth);
    const monthEnd = endOfMonth(baseMonth);
    
    const transactions = guestTransactions.filter(t => {
      if (t.guest_id !== guest.id) return false;
      if (!t.date) return false;
      const transDate = toLocalDate(t.date);
      if (!transDate) return false;
      return transDate >= monthStart && transDate <= monthEnd;
    });
    
    const charges = transactions.filter(t => t.type === 'charge').reduce((sum, t) => sum + (t.amount || 0), 0);
    const payments = transactions.filter(t => t.type === 'payment').reduce((sum, t) => sum + (t.amount || 0), 0);
    
    // Calculate balance as of end of month
    const allTransactionsUpToMonth = guestTransactions.filter(t => {
      if (t.guest_id !== guest.id) return false;
      if (!t.date) return false;
      const transDate = toLocalDate(t.date);
      if (!transDate) return false;
      return transDate <= monthEnd;
    });
    
    const totalCharges = allTransactionsUpToMonth.filter(t => t.type === 'charge').reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalPayments = allTransactionsUpToMonth.filter(t => t.type === 'payment').reduce((sum, t) => sum + (t.amount || 0), 0);
    const balanceAsOfEndOfMonth = totalCharges - totalPayments;
    
    return { transactions, charges, payments, balanceAsOfEndOfMonth };
  };

  const handlePrintAll = (onlyNoEmail = false) => {
    let membersToPrint = membersWithActivity;
    let guestsToPrint = guestsWithActivity;
    
    if (onlyNoEmail) {
      membersToPrint = membersWithActivity.filter(m => !m.email);
      guestsToPrint = guestsWithActivity.filter(g => !g.email);
    }
    
    if (membersToPrint.length === 0 && guestsToPrint.length === 0) {
      alert(onlyNoEmail ? 'No members or guests without email addresses' : 'No statements to print');
      return;
    }
    
    const printWindow = window.open('', '', 'height=800,width=800');
    printWindow.document.write('<html><head><title>Monthly Statements</title>');
    printWindow.document.write('<style>@media print { @page { margin: 0.5in; } } body { font-family: Arial, sans-serif; }</style>');
    printWindow.document.write('</head><body>');
    
    // Print members
    membersToPrint.forEach((member) => {
      const data = getMemberMonthlyData(member, selectedMonth);
      const charges = data.transactions.filter(t => t.type === 'charge');
      const payments = data.transactions.filter(t => t.type === 'payment');
      
      printWindow.document.write(`
        <div style="page-break-after: always; padding: 40px;">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 40px;">
            <div>
              <h1 style="margin: 0; font-size: ${template.header_font_size}px; font-weight: bold; color: ${template.header_color};">${template.header_title}</h1>
              <p style="margin: 5px 0 0 0; color: #64748b; font-size: ${Math.round(template.header_font_size * 0.4)}px;">${template.header_subtitle}</p>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 20px; font-weight: bold; margin-bottom: 5px;">${member.full_name}</div>
              ${template.show_member_id && member.member_id ? `<div style="font-size: 12px; color: #64748b;">ID: ${member.member_id}</div>` : ''}
              ${template.show_email && member.email ? `<div style="font-size: 12px; color: #64748b;">${member.email}</div>` : ''}
            </div>
          </div>
          <div style="margin-bottom: 30px; padding: 15px; background-color: #f8fafc; border-left: 4px solid ${template.header_color};">
            <div style="font-size: ${template.body_font_size}px; color: #64748b;">Statement Period</div>
            <div style="font-size: ${Math.round(template.body_font_size * 1.3)}px; font-weight: bold; color: ${template.header_color};">${monthsForYear.find(m => m.value === selectedMonth)?.label} ${selectedYear}</div>
          </div>
          ${template.show_charges_section && charges.length > 0 ? `
          <div style="margin-bottom: 30px;">
            <h3 style="font-size: ${template.body_font_size + 2}px; font-weight: bold; margin-bottom: 15px; border-bottom: 2px solid ${template.header_color}; padding-bottom: 8px;">Charges</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="background-color: #f8fafc;">
                  <th style="text-align: left; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Date</th>
                  <th style="text-align: left; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Description</th>
                  <th style="text-align: right; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${charges.map(charge => `
                  <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">${charge.date ? format(new Date(charge.date), 'MMM d, yyyy') : 'N/A'}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">${charge.description}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px; text-align: right; color: ${template.charges_color};">$${charge.amount.toFixed(2)}</td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot>
                <tr style="background-color: #fef3c7;">
                  <td colspan="2" style="padding: 10px; font-weight: bold; font-size: ${template.body_font_size}px;">Total Charges</td>
                  <td style="padding: 10px; text-align: right; font-weight: bold; font-size: ${template.body_font_size}px; color: ${template.charges_color};">$${data.charges.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          ` : ''}
          ${template.show_payments_section && payments.length > 0 ? `
          <div style="margin-bottom: 30px;">
            <h3 style="font-size: ${template.body_font_size + 2}px; font-weight: bold; margin-bottom: 15px; border-bottom: 2px solid ${template.header_color}; padding-bottom: 8px;">Payments</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="background-color: #f8fafc;">
                  <th style="text-align: left; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Date</th>
                  <th style="text-align: left; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Description</th>
                  <th style="text-align: right; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${payments.map(payment => `
                  <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">${payment.date ? format(new Date(payment.date), 'MMM d, yyyy') : 'N/A'}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">${payment.description}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px; text-align: right; color: ${template.payments_color};">$${payment.amount.toFixed(2)}</td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot>
                <tr style="background-color: #dcfce7;">
                  <td colspan="2" style="padding: 10px; font-weight: bold; font-size: ${template.body_font_size}px;">Total Payments</td>
                  <td style="padding: 10px; text-align: right; font-weight: bold; font-size: ${template.body_font_size}px; color: ${template.payments_color};">$${data.payments.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          ` : ''}
          <div style="margin-top: 30px; padding: 20px; background-color: ${data.balanceAsOfEndOfMonth > 0 ? '#fef3c7' : '#dcfce7'}; border-radius: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: ${template.body_font_size + 2}px; font-weight: bold;">Balance Owed</span>
              <span style="font-size: ${Math.round(template.body_font_size * 1.7)}px; font-weight: bold; color: ${data.balanceAsOfEndOfMonth > 0 ? template.balance_color : template.payments_color};">$${data.balanceAsOfEndOfMonth.toFixed(2)}</span>
            </div>
          </div>
          ${template.show_footer ? `
          <div style="margin-top: 40px; text-align: center; color: #94a3b8; font-size: ${Math.round(template.body_font_size * 0.9)}px;">
            <p>${template.footer_text}</p>
          </div>
          ` : ''}
        </div>
      `);
    });
    
    // Print guests
    guestsToPrint.forEach((guest) => {
      const data = getGuestMonthlyData(guest, selectedMonth);
      const charges = data.transactions.filter(t => t.type === 'charge');
      const payments = data.transactions.filter(t => t.type === 'payment');
      
      printWindow.document.write(`
        <div style="page-break-after: always; padding: 40px;">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 40px;">
            <div>
              <h1 style="margin: 0; font-size: ${template.header_font_size}px; font-weight: bold; color: ${template.header_color};">${template.header_title}</h1>
              <p style="margin: 5px 0 0 0; color: #64748b; font-size: ${Math.round(template.header_font_size * 0.4)}px;">${template.header_subtitle}</p>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 20px; font-weight: bold; margin-bottom: 5px;">${guest.full_name}</div>
              ${template.show_email && guest.email ? `<div style="font-size: 12px; color: #64748b;">${guest.email}</div>` : ''}
            </div>
          </div>
          <div style="margin-bottom: 30px; padding: 15px; background-color: #f8fafc; border-left: 4px solid ${template.header_color};">
            <div style="font-size: ${template.body_font_size}px; color: #64748b;">Statement Period</div>
            <div style="font-size: ${Math.round(template.body_font_size * 1.3)}px; font-weight: bold; color: ${template.header_color};">${monthsForYear.find(m => m.value === selectedMonth)?.label} ${selectedYear}</div>
          </div>
          ${template.show_charges_section && charges.length > 0 ? `
          <div style="margin-bottom: 30px;">
            <h3 style="font-size: ${template.body_font_size + 2}px; font-weight: bold; margin-bottom: 15px; border-bottom: 2px solid ${template.header_color}; padding-bottom: 8px;">Charges</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="background-color: #f8fafc;">
                  <th style="text-align: left; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Date</th>
                  <th style="text-align: left; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Description</th>
                  <th style="text-align: right; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${charges.map(charge => `
                  <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">${charge.date ? format(new Date(charge.date), 'MMM d, yyyy') : 'N/A'}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">${charge.description}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px; text-align: right; color: ${template.charges_color};">$${charge.amount.toFixed(2)}</td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot>
                <tr style="background-color: #fef3c7;">
                  <td colspan="2" style="padding: 10px; font-weight: bold; font-size: ${template.body_font_size}px;">Total Charges</td>
                  <td style="padding: 10px; text-align: right; font-weight: bold; font-size: ${template.body_font_size}px; color: ${template.charges_color};">$${data.charges.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          ` : ''}
          ${template.show_payments_section && payments.length > 0 ? `
          <div style="margin-bottom: 30px;">
            <h3 style="font-size: ${template.body_font_size + 2}px; font-weight: bold; margin-bottom: 15px; border-bottom: 2px solid ${template.header_color}; padding-bottom: 8px;">Payments</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="background-color: #f8fafc;">
                  <th style="text-align: left; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Date</th>
                  <th style="text-align: left; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Description</th>
                  <th style="text-align: right; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${payments.map(payment => `
                  <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">${payment.date ? format(new Date(payment.date), 'MMM d, yyyy') : 'N/A'}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">${payment.description}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px; text-align: right; color: ${template.payments_color};">$${payment.amount.toFixed(2)}</td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot>
                <tr style="background-color: #dcfce7;">
                  <td colspan="2" style="padding: 10px; font-weight: bold; font-size: ${template.body_font_size}px;">Total Payments</td>
                  <td style="padding: 10px; text-align: right; font-weight: bold; font-size: ${template.body_font_size}px; color: ${template.payments_color};">$${data.payments.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          ` : ''}
          <div style="margin-top: 30px; padding: 20px; background-color: ${data.balanceAsOfEndOfMonth > 0 ? '#fef3c7' : '#dcfce7'}; border-radius: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: ${template.body_font_size + 2}px; font-weight: bold;">Balance Owed</span>
              <span style="font-size: ${Math.round(template.body_font_size * 1.7)}px; font-weight: bold; color: ${data.balanceAsOfEndOfMonth > 0 ? template.balance_color : template.payments_color};">$${data.balanceAsOfEndOfMonth.toFixed(2)}</span>
            </div>
          </div>
          ${template.show_footer ? `
          <div style="margin-top: 40px; text-align: center; color: #94a3b8; font-size: ${Math.round(template.body_font_size * 0.9)}px;">
            <p>${template.footer_text}</p>
          </div>
          ` : ''}
        </div>
      `);
    });
    
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    printWindow.print();
    setTimeout(() => {
      printWindow.close();
    }, 1000);
  };

  const handlePrintSingle = (person, isGuest = false) => {
    const data = isGuest ? getGuestMonthlyData(person, selectedMonth) : getMemberMonthlyData(person, selectedMonth);
    const charges = data.transactions.filter(t => t.type === 'charge');
    const payments = data.transactions.filter(t => t.type === 'payment');
    
    const printWindow = window.open('', '', 'height=800,width=800');
    printWindow.document.write('<html><head><title>Statement - ' + person.full_name + '</title>');
    printWindow.document.write('<style>@media print { @page { margin: 0.5in; } } body { font-family: Arial, sans-serif; }</style>');
    printWindow.document.write('</head><body>');
    printWindow.document.write(`
      <div style="padding: 40px;">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 40px;">
          <div>
            <h1 style="margin: 0; font-size: ${template.header_font_size}px; font-weight: bold; color: ${template.header_color};">${template.header_title}</h1>
            <p style="margin: 5px 0 0 0; color: #64748b; font-size: ${Math.round(template.header_font_size * 0.4)}px;">${template.header_subtitle}</p>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 20px; font-weight: bold; margin-bottom: 5px;">${person.full_name}</div>
            ${template.show_member_id && person.member_id ? `<div style="font-size: 12px; color: #64748b;">ID: ${person.member_id}</div>` : ''}
            ${template.show_email && person.email ? `<div style="font-size: 12px; color: #64748b;">${person.email}</div>` : ''}
          </div>
        </div>
        <div style="margin-bottom: 30px; padding: 15px; background-color: #f8fafc; border-left: 4px solid ${template.header_color};">
          <div style="font-size: ${template.body_font_size}px; color: #64748b;">Statement Period</div>
          <div style="font-size: ${Math.round(template.body_font_size * 1.3)}px; font-weight: bold; color: ${template.header_color};">${monthsForYear.find(m => m.value === selectedMonth)?.label} ${selectedYear}</div>
        </div>
    `);

    if (template.show_charges_section && charges.length > 0) {
      printWindow.document.write(`
        <div style="margin-bottom: 30px;">
          <h3 style="font-size: ${template.body_font_size + 2}px; font-weight: bold; margin-bottom: 15px; border-bottom: 2px solid ${template.header_color}; padding-bottom: 8px;">Charges</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background-color: #f8fafc;">
                <th style="text-align: left; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Date</th>
                <th style="text-align: left; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Description</th>
                <th style="text-align: right; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Amount</th>
              </tr>
            </thead>
            <tbody>
      `);
      charges.forEach(charge => {
        printWindow.document.write(`
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">${charge.date ? format(new Date(charge.date), 'MMM d, yyyy') : 'N/A'}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">${charge.description}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px; text-align: right; color: ${template.charges_color};">$${charge.amount.toFixed(2)}</td>
          </tr>
        `);
      });
      printWindow.document.write(`
            </tbody>
            <tfoot>
              <tr style="background-color: #fef3c7;">
                <td colspan="2" style="padding: 10px; font-weight: bold; font-size: ${template.body_font_size}px;">Total Charges</td>
                <td style="padding: 10px; text-align: right; font-weight: bold; font-size: ${template.body_font_size}px; color: ${template.charges_color};">$${data.charges.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      `);
    }

    if (template.show_payments_section && payments.length > 0) {
      printWindow.document.write(`
        <div style="margin-bottom: 30px;">
          <h3 style="font-size: ${template.body_font_size + 2}px; font-weight: bold; margin-bottom: 15px; border-bottom: 2px solid ${template.header_color}; padding-bottom: 8px;">Payments</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background-color: #f8fafc;">
                <th style="text-align: left; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Date</th>
                <th style="text-align: left; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Description</th>
                <th style="text-align: right; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">Amount</th>
              </tr>
            </thead>
            <tbody>
      `);
      payments.forEach(payment => {
        printWindow.document.write(`
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">${payment.date ? format(new Date(payment.date), 'MMM d, yyyy') : 'N/A'}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px;">${payment.description}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: ${template.body_font_size}px; text-align: right; color: ${template.payments_color};">$${payment.amount.toFixed(2)}</td>
          </tr>
        `);
      });
      printWindow.document.write(`
            </tbody>
            <tfoot>
              <tr style="background-color: #dcfce7;">
                <td colspan="2" style="padding: 10px; font-weight: bold; font-size: ${template.body_font_size}px;">Total Payments</td>
                <td style="padding: 10px; text-align: right; font-weight: bold; font-size: ${template.body_font_size}px; color: ${template.payments_color};">$${data.payments.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      `);
    }

    printWindow.document.write(`
        <div style="margin-top: 30px; padding: 20px; background-color: ${data.balanceAsOfEndOfMonth > 0 ? '#fef3c7' : '#dcfce7'}; border-radius: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: ${template.body_font_size + 2}px; font-weight: bold;">Balance Owed (as of end of month)</span>
            <span style="font-size: ${Math.round(template.body_font_size * 1.7)}px; font-weight: bold; color: ${data.balanceAsOfEndOfMonth > 0 ? template.balance_color : template.payments_color};">$${data.balanceAsOfEndOfMonth.toFixed(2)}</span>
          </div>
        </div>
        ${template.show_footer ? `
        <div style="margin-top: 40px; text-align: center; color: #94a3b8; font-size: ${Math.round(template.body_font_size * 0.9)}px;">
          <p>${template.footer_text}</p>
        </div>
        ` : ''}
      </div>
    `);
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    printWindow.print();
    setTimeout(() => {
      printWindow.close();
    }, 1000);
  };

  if (!selectedMonth) {
    // Show month list view
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold text-slate-900 mb-2">Monthly Statements</h1>
              <p className="text-slate-600">Select a month to view statements</p>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm font-semibold text-slate-700">Year:</label>
              <Input
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="YYYY"
                value={selectedYear}
                onChange={(e) => {
                  setSelectedYear(e.target.value);
                  setSelectedMonth(null);
                }}
                className="w-32 h-11"
              />
            </div>
          </div>

          <Card className="border-slate-200 shadow-lg">
            <CardHeader className="border-b border-slate-200 bg-slate-50">
              <CardTitle>{selectedYear} - Select Month</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!validYear && (
                <div className="p-6 text-sm text-amber-700 bg-amber-50">Enter a year to see months.</div>
              )}
              {validYear && monthsWithActivity.length === 0 && (
                <div className="p-6 text-sm text-slate-500">No months with activity for {selectedYear}.</div>
              )}
              {validYear && monthsWithActivity.length > 0 && (
                <div className="divide-y divide-slate-100">
                  {monthsWithActivity.map((month) => (
                    <button
                      key={month.value}
                      onClick={() => setSelectedMonth(month.value)}
                      className="w-full px-6 py-5 flex items-center justify-between transition-all hover:bg-blue-50 cursor-pointer"
                    >
                      <div className="flex items-center gap-4">
                        <div className="text-lg font-bold text-slate-900">{month.label}</div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-400" />
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Show selected month detail view
  const membersWithActivity = members;
  const guestsWithActivity = guests;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <Button
              variant="ghost"
              onClick={() => setSelectedMonth(null)}
              className="mb-2 -ml-2"
            >
              ← Back to Months
            </Button>
            <h1 className="text-4xl font-bold text-slate-900 mb-2">
              {monthsForYear.find(m => m.value === selectedMonth)?.label} {selectedYear}
            </h1>
            <p className="text-slate-600">Monthly statements for all members and guests</p>
          </div>
          <div className="flex items-center gap-3">
            <Button className="bg-green-600 hover:bg-green-700">
              <Mail className="w-4 h-4 mr-2" />
              Email
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="bg-blue-900 hover:bg-blue-800">
                  <Printer className="w-4 h-4 mr-2" />
                  Print
                  <ChevronDown className="w-4 h-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handlePrintAll(false)}>
                  <Printer className="w-4 h-4 mr-2" />
                  Print All Statements
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handlePrintAll(true)}>
                  <Printer className="w-4 h-4 mr-2" />
                  Print Only (No Email)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Hidden Print Templates */}
        <div ref={printRef} style={{ display: 'none' }}>
          {membersWithActivity.map((member) => {
            const data = getMemberMonthlyData(member, selectedMonth);
            const charges = data.transactions.filter(t => t.type === 'charge');
            const payments = data.transactions.filter(t => t.type === 'payment');
            return (
              <div key={member.id} style={{ pageBreakAfter: 'always', padding: '40px', fontFamily: 'Arial, sans-serif' }}>
                <h1 style={{ fontSize: '32px', fontWeight: 'bold', color: '#1e3a8a', marginBottom: '30px' }}>Shtiebel 48</h1>
                <div style={{ marginBottom: '20px', fontSize: '18px', fontWeight: 'bold' }}>
                  Statement for {member.full_name}
                </div>
                <div style={{ marginBottom: '30px', fontSize: '16px', color: '#64748b' }}>
                  Period: {monthsForYear.find(m => m.value === selectedMonth)?.label} {selectedYear}
                </div>

                {/* Charges Section */}
                {charges.length > 0 && (
                  <div style={{ marginBottom: '30px' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '15px', borderBottom: '2px solid #1e3a8a', paddingBottom: '8px' }}>
                      Charges
                    </h3>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f8fafc' }}>
                          <th style={{ textAlign: 'left', padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px' }}>Date</th>
                          <th style={{ textAlign: 'left', padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px' }}>Description</th>
                          <th style={{ textAlign: 'right', padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px' }}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {charges.map((charge, idx) => (
                          <tr key={idx}>
                            <td style={{ padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px' }}>
                              {charge.date ? format(new Date(charge.date), 'MMM d, yyyy') : 'N/A'}
                            </td>
                            <td style={{ padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px' }}>
                              {charge.description}
                            </td>
                            <td style={{ padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px', textAlign: 'right', color: '#d97706' }}>
                              ${charge.amount.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ backgroundColor: '#fef3c7' }}>
                          <td colSpan="2" style={{ padding: '10px', fontWeight: 'bold', fontSize: '14px' }}>Total Charges</td>
                          <td style={{ padding: '10px', textAlign: 'right', fontWeight: 'bold', fontSize: '14px', color: '#d97706' }}>
                            ${data.charges.toFixed(2)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {/* Payments Section */}
                {payments.length > 0 && (
                  <div style={{ marginBottom: '30px' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '15px', borderBottom: '2px solid #1e3a8a', paddingBottom: '8px' }}>
                      Payments
                    </h3>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f8fafc' }}>
                          <th style={{ textAlign: 'left', padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px' }}>Date</th>
                          <th style={{ textAlign: 'left', padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px' }}>Description</th>
                          <th style={{ textAlign: 'right', padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px' }}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map((payment, idx) => (
                          <tr key={idx}>
                            <td style={{ padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px' }}>
                              {payment.date ? format(new Date(payment.date), 'MMM d, yyyy') : 'N/A'}
                            </td>
                            <td style={{ padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px' }}>
                              {payment.description}
                            </td>
                            <td style={{ padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px', textAlign: 'right', color: '#16a34a' }}>
                              ${payment.amount.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ backgroundColor: '#dcfce7' }}>
                          <td colSpan="2" style={{ padding: '10px', fontWeight: 'bold', fontSize: '14px' }}>Total Payments</td>
                          <td style={{ padding: '10px', textAlign: 'right', fontWeight: 'bold', fontSize: '14px', color: '#16a34a' }}>
                            ${data.payments.toFixed(2)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {/* Balance Summary */}
                <div style={{ marginTop: '30px', padding: '20px', backgroundColor: data.balanceAsOfEndOfMonth > 0 ? '#fef3c7' : '#dcfce7', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '16px', fontWeight: 'bold' }}>Balance Owed (as of end of month)</span>
                    <span style={{ fontSize: '24px', fontWeight: 'bold', color: data.balanceAsOfEndOfMonth > 0 ? '#d97706' : '#16a34a' }}>
                      ${data.balanceAsOfEndOfMonth.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          {guestsWithActivity.map((guest) => {
            const data = getGuestMonthlyData(guest, selectedMonth);
            const charges = data.transactions.filter(t => t.type === 'charge');
            const payments = data.transactions.filter(t => t.type === 'payment');
            return (
              <div key={guest.id} style={{ pageBreakAfter: 'always', padding: '40px', fontFamily: 'Arial, sans-serif' }}>
                <h1 style={{ fontSize: '32px', fontWeight: 'bold', color: '#1e3a8a', marginBottom: '30px' }}>Shtiebel 48</h1>
                <div style={{ marginBottom: '20px', fontSize: '18px', fontWeight: 'bold' }}>
                  Statement for {guest.full_name}
                </div>
                <div style={{ marginBottom: '30px', fontSize: '16px', color: '#64748b' }}>
                  Period: {monthsForYear.find(m => m.value === selectedMonth)?.label} {selectedYear}
                </div>

                {/* Charges Section */}
                {charges.length > 0 && (
                  <div style={{ marginBottom: '30px' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '15px', borderBottom: '2px solid #1e3a8a', paddingBottom: '8px' }}>
                      Charges
                    </h3>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f8fafc' }}>
                          <th style={{ textAlign: 'left', padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px' }}>Date</th>
                          <th style={{ textAlign: 'left', padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px' }}>Description</th>
                          <th style={{ textAlign: 'right', padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px' }}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {charges.map((charge, idx) => (
                          <tr key={idx}>
                            <td style={{ padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px' }}>
                              {charge.date ? format(new Date(charge.date), 'MMM d, yyyy') : 'N/A'}
                            </td>
                            <td style={{ padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px' }}>
                              {charge.description}
                            </td>
                            <td style={{ padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px', textAlign: 'right', color: '#d97706' }}>
                              ${charge.amount.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ backgroundColor: '#fef3c7' }}>
                          <td colSpan="2" style={{ padding: '10px', fontWeight: 'bold', fontSize: '14px' }}>Total Charges</td>
                          <td style={{ padding: '10px', textAlign: 'right', fontWeight: 'bold', fontSize: '14px', color: '#d97706' }}>
                            ${data.charges.toFixed(2)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {/* Payments Section */}
                {payments.length > 0 && (
                  <div style={{ marginBottom: '30px' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '15px', borderBottom: '2px solid #1e3a8a', paddingBottom: '8px' }}>
                      Payments
                    </h3>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f8fafc' }}>
                          <th style={{ textAlign: 'left', padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px' }}>Date</th>
                          <th style={{ textAlign: 'left', padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px' }}>Description</th>
                          <th style={{ textAlign: 'right', padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px' }}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map((payment, idx) => (
                          <tr key={idx}>
                            <td style={{ padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px' }}>
                              {payment.date ? format(new Date(payment.date), 'MMM d, yyyy') : 'N/A'}
                            </td>
                            <td style={{ padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px' }}>
                              {payment.description}
                            </td>
                            <td style={{ padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '14px', textAlign: 'right', color: '#16a34a' }}>
                              ${payment.amount.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ backgroundColor: '#dcfce7' }}>
                          <td colSpan="2" style={{ padding: '10px', fontWeight: 'bold', fontSize: '14px' }}>Total Payments</td>
                          <td style={{ padding: '10px', textAlign: 'right', fontWeight: 'bold', fontSize: '14px', color: '#16a34a' }}>
                            ${data.payments.toFixed(2)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {/* Balance Summary */}
                <div style={{ marginTop: '30px', padding: '20px', backgroundColor: data.balanceAsOfEndOfMonth > 0 ? '#fef3c7' : '#dcfce7', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '16px', fontWeight: 'bold' }}>Balance Owed (as of end of month)</span>
                    <span style={{ fontSize: '24px', fontWeight: 'bold', color: data.balanceAsOfEndOfMonth > 0 ? '#d97706' : '#16a34a' }}>
                      ${data.balanceAsOfEndOfMonth.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Members Table */}
        <Card className="mb-6 border-slate-200 shadow-lg">
          <CardHeader className="border-b border-slate-200 bg-slate-50">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-900" />
              <CardTitle>Members</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {members.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                No members yet
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">Member</th>
                      <th className="text-right py-4 px-6 text-sm font-semibold text-slate-700">Payments This Month</th>
                      <th className="text-right py-4 px-6 text-sm font-semibold text-slate-700">Balance (End of Month)</th>
                      <th className="text-center py-4 px-6 text-sm font-semibold text-slate-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {membersWithActivity.map((member) => {
                      const data = getMemberMonthlyData(member, selectedMonth);
                      return (
                        <tr key={member.id} className="hover:bg-blue-50/30 transition-colors">
                          <td className="py-4 px-6">
                            <div className="font-semibold text-slate-900">{member.full_name}</div>
                          </td>
                          <td className="py-4 px-6 text-right">
                            <span className="font-semibold text-green-600">
                              ${data.payments.toFixed(2)}
                            </span>
                          </td>
                          <td className="py-4 px-6 text-right">
                            <span className={`text-lg font-bold ${
                              data.balanceAsOfEndOfMonth > 0 ? 'text-amber-600' : 'text-green-600'
                            }`}>
                              ${data.balanceAsOfEndOfMonth.toFixed(2)}
                            </span>
                          </td>
                          <td className="py-4 px-6 text-center">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handlePrintSingle(member, false)}
                              className="h-8"
                            >
                              <Printer className="w-3 h-3 mr-1" />
                              Print
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Guests Table */}
        <Card className="border-slate-200 shadow-lg">
          <CardHeader className="border-b border-slate-200 bg-slate-50">
            <div className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-blue-900" />
              <CardTitle>Guests / Old</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {guests.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                No guests yet
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">Guest</th>
                      <th className="text-right py-4 px-6 text-sm font-semibold text-slate-700">Payments This Month</th>
                      <th className="text-right py-4 px-6 text-sm font-semibold text-slate-700">Balance (End of Month)</th>
                      <th className="text-center py-4 px-6 text-sm font-semibold text-slate-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {guestsWithActivity.map((guest) => {
                      const data = getGuestMonthlyData(guest, selectedMonth);
                      return (
                        <tr key={guest.id} className="hover:bg-blue-50/30 transition-colors">
                          <td className="py-4 px-6">
                            <div className="font-semibold text-slate-900">{guest.full_name}</div>
                          </td>
                          <td className="py-4 px-6 text-right">
                            <span className="font-semibold text-green-600">
                              ${data.payments.toFixed(2)}
                            </span>
                          </td>
                          <td className="py-4 px-6 text-right">
                            <span className={`text-lg font-bold ${
                              data.balanceAsOfEndOfMonth > 0 ? 'text-amber-600' : 'text-green-600'
                            }`}>
                              ${data.balanceAsOfEndOfMonth.toFixed(2)}
                            </span>
                          </td>
                          <td className="py-4 px-6 text-center">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handlePrintSingle(guest, true)}
                              className="h-8"
                            >
                              <Printer className="w-3 h-3 mr-1" />
                              Print
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
