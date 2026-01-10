import React, { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ArrowLeft, Printer, Plus, DollarSign, Calendar, Receipt, CreditCard, Repeat, Trash2, ChevronDown, Pencil } from "lucide-react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { toLocalDate, todayISO } from "@/utils/dates";
import InvoiceTemplate from "../components/member/InvoiceTemplate";
import { getParsha, isShabbat, getHolidaysByDate, getHebrewDate } from "../components/calendar/hebrewDateConverter";
import MiniCalendarPopup from "../components/guests/MiniCalendarPopup";

const createPageUrl = (page) => {
  const [pageName, queryString] = page.split('?');
  return queryString ? `/${pageName}?${queryString}` : `/${pageName}`;
};

export default function MemberDetail() {
  const urlParams = new URLSearchParams(window.location.search);
  const memberId = urlParams.get('id');
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [recurringDialogOpen, setRecurringDialogOpen] = useState(false);
  const [payoffDialogOpen, setPayoffDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [chargeDialogOpen, setChargeDialogOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDescription, setPaymentDescription] = useState("");
  const [monthlyAmount, setMonthlyAmount] = useState("");
  const [payoffAmount, setPayoffAmount] = useState("");
  const [donationDialogOpen, setDonationDialogOpen] = useState(false);
  const [donationAmount, setDonationAmount] = useState("");
  const [donationDescription, setDonationDescription] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeDescription, setChargeDescription] = useState("");
  const [chargeDate, setChargeDate] = useState(todayISO());
  const [editMember, setEditMember] = useState({
    english_name: "",
    hebrew_name: "",
    email: "",
    phone: "",
    address: "",
  });
  const invoiceRef = useRef();

  const queryClient = useQueryClient();

  const { data: member, isLoading: memberLoading } = useQuery({
    queryKey: ['member', memberId],
    queryFn: async () => {
      const members = await base44.entities.Member.filter({ id: memberId });
      return members[0];
    },
    enabled: !!memberId,
  });

  const { data: transactions = [], isLoading: transactionsLoading } = useQuery({
    queryKey: ['transactions', memberId],
    queryFn: () => base44.entities.Transaction.filter({ member_id: memberId }, '-date', 1000),
    enabled: !!memberId,
  });

  const sortedTransactions = React.useMemo(() => {
    const dateValue = (tx) => {
      const d = toLocalDate(tx?.date);
      if (d) return d.getTime();
      if (tx?.created_date) {
        const c = new Date(tx.created_date);
        if (!Number.isNaN(c.getTime())) return c.getTime();
      }
      return 0;
    };

    return [...transactions].sort((a, b) => dateValue(b) - dateValue(a));
  }, [transactions]);

  const { data: recurringPayments = [] } = useQuery({
    queryKey: ['recurringPayments', memberId],
    queryFn: () => base44.entities.RecurringPayment.filter({ member_id: memberId, is_active: true }),
    enabled: !!memberId,
  });

  const addPaymentMutation = useMutation({
    mutationFn: async (paymentData) => {
      return await base44.entities.Transaction.create(paymentData);
    },
    onError: (error) => {
      console.error("addPaymentMutation failed", error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['member', memberId] });
      queryClient.invalidateQueries({ queryKey: ['transactions', memberId] });
      queryClient.invalidateQueries({ queryKey: ['members'] });
      setPaymentDialogOpen(false);
      setPaymentAmount("");
      setPaymentDescription("");
    },
  });

  const addChargeMutation = useMutation({
    mutationFn: async (chargeData) => {
      return await base44.entities.Transaction.create(chargeData);
    },
    onError: (error) => {
      console.error("addChargeMutation failed", error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['member', memberId] });
      queryClient.invalidateQueries({ queryKey: ['transactions', memberId] });
      queryClient.invalidateQueries({ queryKey: ['members'] });
      setChargeDialogOpen(false);
      setChargeAmount("");
      setChargeDescription("");
      setChargeDate(todayISO());
    },
  });

  const addDonationMutation = useMutation({
    mutationFn: async (donationData) => {
      return await base44.entities.Transaction.create(donationData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions', memberId] });
      setDonationDialogOpen(false);
      setDonationAmount("");
      setDonationDescription("");
    },
  });

  const deleteTransactionMutation = useMutation({
    mutationFn: async (transaction) => {
      await base44.entities.Transaction.delete(transaction.id);
    },
    onError: (error) => {
      console.error("deleteMemberTransaction failed", error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['member', memberId] });
      queryClient.invalidateQueries({ queryKey: ['transactions', memberId] });
      queryClient.invalidateQueries({ queryKey: ['members'] });
    },
  });

  const createRecurringPaymentMutation = useMutation({
    mutationFn: async (data) => {
      return await base44.entities.RecurringPayment.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurringPayments', memberId] });
      setRecurringDialogOpen(false);
      setPayoffDialogOpen(false);
      setMonthlyAmount("");
      setPayoffAmount("");
      setCardNumber("");
      setExpiryDate("");
      setCvv("");
      setCardName("");
    },
  });

  const cancelRecurringPaymentMutation = useMutation({
    mutationFn: async (id) => {
      return await base44.entities.RecurringPayment.update(id, { is_active: false });
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['recurringPayments', memberId] });
      const previous = queryClient.getQueryData(['recurringPayments', memberId]);
      queryClient.setQueryData(['recurringPayments', memberId], (old = []) =>
        old.filter((payment) => payment.id !== id)
      );
      return { previous };
    },
    onError: (error, _id, context) => {
      console.error("cancelRecurringPayment failed", error);
      if (context?.previous) {
        queryClient.setQueryData(['recurringPayments', memberId], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['recurringPayments', memberId] });
    },
  });

  const updateMemberMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Member.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member', memberId] });
      queryClient.invalidateQueries({ queryKey: ['members'] });
      setEditDialogOpen(false);
    },
  });

  const handlePaymentSubmit = (e) => {
    e.preventDefault();
    addPaymentMutation.mutate({
      member_id: memberId,
      member_name: member.full_name,
      type: "payment",
      description: paymentDescription || "Payment received",
      amount: parseFloat(paymentAmount),
      date: new Date().toISOString().split('T')[0]
    });
  };

  const handleDonationSubmit = (e) => {
    e.preventDefault();
    const amount = parseFloat(donationAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    addDonationMutation.mutate({
      member_id: memberId,
      member_name: member.full_name,
      type: "donation",
      description: donationDescription || "Donation",
      amount,
      date: new Date().toISOString().split('T')[0],
    });
  };

  const handleChargeSubmit = (e) => {
    e.preventDefault();
    const amount = parseFloat(chargeAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    addChargeMutation.mutate({
      member_id: memberId,
      member_name: member.full_name,
      type: "charge",
      description: chargeDescription || "Manual charge",
      amount,
      date: chargeDate,
    });
  };

  const handleEventSelected = (eventData) => {
    addChargeMutation.mutate({
      member_id: memberId,
      member_name: member.full_name,
      type: "charge",
      description: eventData.description,
      amount: parseFloat(eventData.amount),
      date: eventData.date,
      category: eventData.category,
    });
    setCalendarOpen(false);
  };

  const handleStripePayment = async (e) => {
    e.preventDefault();
    const amount = parseFloat(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const out = await base44.payments.createCheckout({
      memberId,
      amount,
      description: paymentDescription || `Payment - ${member.full_name}`,
      successPath: `/MemberDetail?id=${encodeURIComponent(memberId)}`,
      cancelPath: `/MemberDetail?id=${encodeURIComponent(memberId)}`,
    });
    if (out?.url) window.location.href = out.url;
  };

  const handleSaveCard = async (e) => {
    e.preventDefault();
    const out = await base44.payments.createSaveCardCheckout({
      memberId,
      successPath: `/MemberDetail?id=${encodeURIComponent(memberId)}`,
      cancelPath: `/MemberDetail?id=${encodeURIComponent(memberId)}`,
    });
    if (out?.url) window.location.href = out.url;
  };

  const handleRecurringPaymentSubmit = (e) => {
    e.preventDefault();
    const amountPerMonth = parseFloat(monthlyAmount);
    if (!Number.isFinite(amountPerMonth) || amountPerMonth <= 0) return;
    base44.payments
      .createSubscriptionCheckout({
        memberId,
        paymentType: "additional_monthly",
        amountPerMonth,
        successPath: `/MemberDetail?id=${encodeURIComponent(memberId)}`,
        cancelPath: `/MemberDetail?id=${encodeURIComponent(memberId)}`,
      })
      .then((out) => {
        if (out?.url) window.location.href = out.url;
      });
  };

  const handlePayoffSubmit = (e) => {
    e.preventDefault();
    const amountPerMonth = parseFloat(payoffAmount);
    if (!Number.isFinite(amountPerMonth) || amountPerMonth <= 0) return;
    base44.payments
      .createSubscriptionCheckout({
        memberId,
        paymentType: "balance_payoff",
        amountPerMonth,
        payoffTotal: member.total_owed || 0,
        successPath: `/MemberDetail?id=${encodeURIComponent(memberId)}`,
        cancelPath: `/MemberDetail?id=${encodeURIComponent(memberId)}`,
      })
      .then((out) => {
        if (out?.url) window.location.href = out.url;
      });
  };

  const openEditDialog = () => {
    setEditMember({
      english_name: member?.english_name || "",
      hebrew_name: member?.hebrew_name || "",
      email: member?.email || "",
      phone: member?.phone || "",
      address: member?.address || "",
    });
    setEditDialogOpen(true);
  };

  const handleSaveEdit = (e) => {
    e.preventDefault();
    const englishName = editMember.english_name.trim();
    const hebrewName = editMember.hebrew_name.trim();
    const full_name = englishName || hebrewName || member.full_name || "";
    updateMemberMutation.mutate({
      id: memberId,
      data: {
        full_name,
        english_name: englishName || undefined,
        hebrew_name: hebrewName || undefined,
        email: editMember.email.trim() || undefined,
        phone: editMember.phone.trim() || undefined,
        address: editMember.address.trim() || undefined,
      },
    });
  };

  const handlePrint = () => {
    const printContent = invoiceRef.current;
    const printWindow = window.open('', '', 'height=800,width=800');
    printWindow.document.write('<html><head><title>Invoice</title>');
    printWindow.document.write('<style>body{font-family:Arial,sans-serif;padding:40px;} table{width:100%;border-collapse:collapse;margin:20px 0;} th,td{padding:12px;text-align:left;border-bottom:1px solid #ddd;} th{background:#f8f9fa;font-weight:600;} .header{margin-bottom:30px;} .total{font-size:1.2em;font-weight:bold;margin-top:20px;}</style>');
    printWindow.document.write('</head><body>');
    printWindow.document.write(printContent.innerHTML);
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    printWindow.print();
  };

  const holidayMap = React.useMemo(() => {
    if (!transactions.length) return {};
    const dates = transactions.map((t) => toLocalDate(t.date)).filter(Boolean);
    if (dates.length === 0) return {};
    const min = new Date(Math.min(...dates.map((d) => d.getTime())));
    const max = new Date(Math.max(...dates.map((d) => d.getTime())));
    return getHolidaysByDate(min, max);
  }, [transactions]);

  const getSpecialDayLabel = (date) => {
    if (!date) return "";
    const key = format(date, "yyyy-MM-dd");
    const holidays = holidayMap[key];
    if (holidays && holidays.length > 0) {
      return holidays.join(", ");
    }
    if (isShabbat(date)) {
      const parsha = getParsha(date);
      return parsha ? `Shabbat - ${parsha}` : "Shabbat";
    }
    return "";
  };

  const getHebrewDateLabel = (date) => {
    if (!date) return "";
    const hebrew = getHebrewDate(date);
    if (!hebrew) return "";
    const dayLabel = hebrew.dayHebrew || hebrew.day;
    return `${dayLabel} ${hebrew.month}`;
  };

  if (memberLoading || !member) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 flex items-center justify-center">
        <div className="text-slate-600 text-lg">Loading member details...</div>
      </div>
    );
  }

  const charges = transactions.filter(t => t.type === 'charge');
  const payments = transactions.filter(t => t.type === 'payment');
  const totalCharges = charges.reduce((sum, t) => sum + (t.amount || 0), 0);
  const totalPayments = payments.reduce((sum, t) => sum + (t.amount || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Back Button */}
        <Link to={createPageUrl('Members')} className="inline-flex items-center text-blue-900 hover:text-blue-700 mb-6 font-medium">
          <ArrowLeft className="w-5 h-5 mr-2" />
          Back to Members
        </Link>

        {/* Member Header */}
        <Card className="mb-6 border-slate-200 shadow-lg">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div className="flex-1">
                <h1 className="text-3xl font-bold text-slate-900 mb-1">{member.full_name}</h1>
                {member.member_id && <div className="text-sm text-slate-500 font-mono mb-3">Member ID: {member.member_id}</div>}
                <div className="space-y-2 text-slate-600">
                  {member.email && <div className="flex items-center gap-2"><span className="font-medium">Email:</span> {member.email}</div>}
                  {member.phone && <div className="flex items-center gap-2"><span className="font-medium">Phone:</span> {member.phone}</div>}
                  {member.address && <div className="flex items-center gap-2"><span className="font-medium">Address:</span> {member.address}</div>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-3">
                <div className="text-right">
                  <div className="text-sm text-slate-600 mb-1">Current Balance</div>
                  <div className={`text-4xl font-bold ${
                    (member.total_owed || 0) > 0 ? 'text-amber-600' : 'text-green-600'
                  }`}>
                    ${(member.total_owed || 0).toFixed(2)}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button className="bg-amber-600 hover:bg-amber-700">
                        <Plus className="w-4 h-4 mr-2" />
                        Charges
                        <ChevronDown className="w-4 h-4 ml-2" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onSelect={() => setChargeDialogOpen(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        Add Charge
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setCalendarOpen(true)}>
                        <Calendar className="w-4 h-4 mr-2" />
                        Add from Event
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Dialog open={chargeDialogOpen} onOpenChange={setChargeDialogOpen}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add Charge</DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handleChargeSubmit} className="space-y-4 mt-4">
                        <div className="space-y-2">
                          <Label htmlFor="chargeAmount">Amount *</Label>
                          <Input
                            id="chargeAmount"
                            type="number"
                            step="0.01"
                            value={chargeAmount}
                            onChange={(e) => setChargeAmount(e.target.value)}
                            required
                            placeholder="0.00"
                            className="h-11"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="chargeDescription">Description</Label>
                          <Input
                            id="chargeDescription"
                            value={chargeDescription}
                            onChange={(e) => setChargeDescription(e.target.value)}
                            placeholder="Enter description..."
                            className="h-11"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="chargeDate">Date</Label>
                          <Input
                            id="chargeDate"
                            type="date"
                            value={chargeDate}
                            onChange={(e) => setChargeDate(e.target.value)}
                            className="h-11"
                          />
                        </div>
                        <div className="flex justify-end gap-3 pt-4">
                          <Button type="button" variant="outline" onClick={() => setChargeDialogOpen(false)}>
                            Cancel
                          </Button>
                          <Button type="submit" className="bg-amber-600 hover:bg-amber-700" disabled={addChargeMutation.isPending}>
                            {addChargeMutation.isPending ? "Saving..." : "Add Charge"}
                          </Button>
                        </div>
                      </form>
                    </DialogContent>
                  </Dialog>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button className="bg-green-600 hover:bg-green-700">
                        <Plus className="w-4 h-4 mr-2" />
                        Payment
                        <ChevronDown className="w-4 h-4 ml-2" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onSelect={() => setPaymentDialogOpen(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        Record Payment
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setDonationDialogOpen(true)}>
                        <DollarSign className="w-4 h-4 mr-2" />
                        Donation
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Record Payment</DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handlePaymentSubmit} className="space-y-4 mt-4">
                        <div className="space-y-2">
                          <Label htmlFor="amount">Amount *</Label>
                          <Input
                            id="amount"
                            type="number"
                            step="0.01"
                            value={paymentAmount}
                            onChange={(e) => setPaymentAmount(e.target.value)}
                            required
                            placeholder="0.00"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="description">Description</Label>
                          <Input
                            id="description"
                            value={paymentDescription}
                            onChange={(e) => setPaymentDescription(e.target.value)}
                            placeholder="Check #123, Cash, etc."
                          />
                        </div>
                        <div className="flex justify-end gap-3 pt-4">
                          <Button type="button" variant="outline" onClick={() => setPaymentDialogOpen(false)}>
                            Cancel
                          </Button>
                          <Button type="submit" className="bg-green-600 hover:bg-green-700">
                            Record Payment
                          </Button>
                          <Button type="button" className="bg-blue-900 hover:bg-blue-800" onClick={handleStripePayment}>
                            Pay with Card (Stripe)
                          </Button>
                        </div>
                      </form>
                    </DialogContent>
                  </Dialog>
                  <Dialog open={donationDialogOpen} onOpenChange={setDonationDialogOpen}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Record Donation</DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handleDonationSubmit} className="space-y-4 mt-4">
                        <div className="space-y-2">
                          <Label htmlFor="donationAmount">Amount *</Label>
                          <Input
                            id="donationAmount"
                            type="number"
                            step="0.01"
                            value={donationAmount}
                            onChange={(e) => setDonationAmount(e.target.value)}
                            required
                            placeholder="0.00"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="donationDescription">Description</Label>
                          <Input
                            id="donationDescription"
                            value={donationDescription}
                            onChange={(e) => setDonationDescription(e.target.value)}
                            placeholder="Donation note (optional)"
                          />
                        </div>
                        <div className="flex justify-end gap-3 pt-4">
                          <Button type="button" variant="outline" onClick={() => setDonationDialogOpen(false)}>
                            Cancel
                          </Button>
                          <Button type="submit" className="bg-green-600 hover:bg-green-700" disabled={addDonationMutation.isPending}>
                            {addDonationMutation.isPending ? "Saving..." : "Record Donation"}
                          </Button>
                        </div>
                      </form>
                    </DialogContent>
                  </Dialog>
                  
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="border-blue-900 text-blue-900 hover:bg-blue-50">
                        <Repeat className="w-4 h-4 mr-2" />
                        Monthly
                        <ChevronDown className="w-4 h-4 ml-2" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setRecurringDialogOpen(true)}>
                        <Repeat className="w-4 h-4 mr-2" />
                        Add Monthly Payment
                      </DropdownMenuItem>
                      {(member.total_owed || 0) > 0 && (
                        <DropdownMenuItem onSelect={() => setPayoffDialogOpen(true)}>
                          <CreditCard className="w-4 h-4 mr-2" />
                          Pay Balance Over Time
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="border-slate-300 text-slate-700 hover:bg-slate-50">
                        Actions
                        <ChevronDown className="w-4 h-4 ml-2" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={handleSaveCard}>
                        <CreditCard className="w-4 h-4 mr-2" />
                        Save Card on File
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={openEditDialog}>
                        <Pencil className="w-4 h-4 mr-2" />
                        Edit Member
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={handlePrint}>
                        <Printer className="w-4 h-4 mr-2" />
                        Print Invoice
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Dialog open={recurringDialogOpen} onOpenChange={setRecurringDialogOpen}>
                    <DialogContent className="max-w-md">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <Repeat className="w-5 h-5" />
                          Add Monthly Recurring Payment
                        </DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handleRecurringPaymentSubmit} className="space-y-4 mt-4">
                        <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                          <div className="text-sm text-slate-600">
                            Set up an additional monthly payment that will be automatically charged to the member's card.
                          </div>
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor="monthlyAmount">Monthly Amount *</Label>
                          <Input
                            id="monthlyAmount"
                            type="number"
                            step="0.01"
                            value={monthlyAmount}
                            onChange={(e) => setMonthlyAmount(e.target.value)}
                            placeholder="0.00"
                            required
                            className="h-11"
                          />
                        </div>
                        
                        <div className="text-sm text-slate-600">
                          You’ll enter card details securely in Stripe Checkout.
                        </div>
                        
                        <div className="flex justify-end gap-3 pt-4">
                          <Button type="button" variant="outline" onClick={() => setRecurringDialogOpen(false)}>
                            Cancel
                          </Button>
                          <Button type="submit" className="bg-blue-900 hover:bg-blue-800">
                            Set Up Payment
                          </Button>
                        </div>
                      </form>
                    </DialogContent>
                  </Dialog>
                  
                  <Dialog open={payoffDialogOpen} onOpenChange={setPayoffDialogOpen}>
                    <DialogContent className="max-w-md">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <CreditCard className="w-5 h-5" />
                          Set Up Balance Payoff Plan
                        </DialogTitle>
                      </DialogHeader>
                        <form onSubmit={handlePayoffSubmit} className="space-y-4 mt-4">
                          <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                            <div className="text-sm font-semibold text-slate-900 mb-1">
                              Current Balance: ${(member.total_owed || 0).toFixed(2)}
                            </div>
                            <div className="text-sm text-slate-600">
                              Set a monthly amount to automatically charge. The final month will charge the remaining balance.
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <Label htmlFor="payoffAmount">Monthly Payment Amount *</Label>
                            <Input
                              id="payoffAmount"
                              type="number"
                              step="0.01"
                              value={payoffAmount}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                setPayoffAmount(e.target.value);
                              }}
                              placeholder="0.00"
                              required
                              className="h-11"
                            />
                            {payoffAmount && (
                              <div className="text-xs text-slate-600">
                                Estimated months: {Math.ceil((member.total_owed || 0) / parseFloat(payoffAmount))}
                              </div>
                            )}
                          </div>
                          
                          <div className="text-sm text-slate-600">
                            You’ll enter card details securely in Stripe Checkout.
                          </div>
                          
                          <div className="flex justify-end gap-3 pt-4">
                            <Button type="button" variant="outline" onClick={() => setPayoffDialogOpen(false)}>
                              Cancel
                            </Button>
                            <Button type="submit" className="bg-amber-600 hover:bg-amber-700">
                              Set Up Payment Plan
                          </Button>
                        </div>
                      </form>
                    </DialogContent>
                  </Dialog>

                  <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                    <DialogContent className="max-w-lg">
                      <DialogHeader>
                        <DialogTitle>Edit Member Details</DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handleSaveEdit} className="space-y-4 mt-4">
                        <div className="space-y-2">
                          <Label htmlFor="editEnglishName">English Name</Label>
                          <Input
                            id="editEnglishName"
                            value={editMember.english_name}
                            onChange={(e) => setEditMember({ ...editMember, english_name: e.target.value })}
                            placeholder="English name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="editHebrewName">Hebrew Name</Label>
                          <Input
                            id="editHebrewName"
                            value={editMember.hebrew_name}
                            onChange={(e) => setEditMember({ ...editMember, hebrew_name: e.target.value })}
                            placeholder="Hebrew name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="editEmail">Email</Label>
                          <Input
                            id="editEmail"
                            type="email"
                            value={editMember.email}
                            onChange={(e) => setEditMember({ ...editMember, email: e.target.value })}
                            placeholder="email@example.com"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="editPhone">Phone</Label>
                          <Input
                            id="editPhone"
                            value={editMember.phone}
                            onChange={(e) => setEditMember({ ...editMember, phone: e.target.value })}
                            placeholder="(555) 555-5555"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="editAddress">Address</Label>
                          <Input
                            id="editAddress"
                            value={editMember.address}
                            onChange={(e) => setEditMember({ ...editMember, address: e.target.value })}
                            placeholder="123 Main St"
                          />
                        </div>
                        <div className="flex justify-end gap-3 pt-2">
                          <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>
                            Cancel
                          </Button>
                          <Button type="submit" className="bg-blue-900 hover:bg-blue-800" disabled={updateMemberMutation.isPending}>
                            {updateMemberMutation.isPending ? "Saving..." : "Save Changes"}
                          </Button>
                        </div>
                      </form>
                    </DialogContent>
                  </Dialog>
                  
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Active Recurring Payments */}
        {recurringPayments.length > 0 && (
          <Card className="mb-6 border-blue-200 bg-blue-50 shadow-lg">
            <CardHeader className="border-b border-blue-200">
              <CardTitle className="text-lg flex items-center gap-2">
                <Repeat className="w-5 h-5" />
                Active Recurring Payments
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="space-y-3">
                {recurringPayments.map((payment) => (
                  <div key={payment.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-200">
                    <div>
                      <div className="font-semibold text-slate-900">
                        {payment.payment_type === "additional_monthly" ? "Additional Monthly Payment" : "Balance Payoff Plan"}
                      </div>
                      <div className="text-sm text-slate-600">
                        ${payment.amount_per_month.toFixed(2)}/month • Stripe
                      </div>
                      {payment.payment_type === "balance_payoff" && payment.remaining_amount && (
                        <div className="text-xs text-amber-600 mt-1">
                          Remaining: ${payment.remaining_amount.toFixed(2)}
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => cancelRecurringPaymentMutation.mutate(payment.id)}
                    >
                      Cancel
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <Card className="border-slate-200 shadow-md">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-600 mb-1">Total Charges</div>
                  <div className="text-2xl font-bold text-slate-900">${totalCharges.toFixed(2)}</div>
                </div>
                <Receipt className="w-8 h-8 text-amber-600" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-slate-200 shadow-md">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-600 mb-1">Total Payments</div>
                  <div className="text-2xl font-bold text-slate-900">${totalPayments.toFixed(2)}</div>
                </div>
                <DollarSign className="w-8 h-8 text-green-600" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-slate-200 shadow-md">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-600 mb-1">Transactions</div>
                  <div className="text-2xl font-bold text-slate-900">{transactions.length}</div>
                </div>
                <Calendar className="w-8 h-8 text-blue-900" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Transaction History */}
        <Card className="border-slate-200 shadow-lg">
          <CardHeader className="border-b border-slate-200 bg-slate-50">
            <CardTitle className="text-xl">Transaction History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {transactionsLoading ? (
              <div className="p-12 text-center text-slate-500">Loading transactions...</div>
            ) : transactions.length === 0 ? (
              <div className="p-12 text-center text-slate-500">No transactions yet</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">Date</th>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">Description</th>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">Type</th>
                      <th className="text-right py-4 px-6 text-sm font-semibold text-slate-700">Amount</th>
                      <th className="text-center py-4 px-6 text-sm font-semibold text-slate-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sortedTransactions.map((transaction) => (
                      <tr key={transaction.id} className="hover:bg-blue-50/50 transition-colors">
                        <td className="py-4 px-6 text-slate-600">
                          {(() => {
                            const txDate = toLocalDate(transaction.date);
                            return (
                              <>
                                <div>{txDate ? format(txDate, 'MMM d, yyyy') : 'N/A'}</div>
                                {txDate && (
                                  <div className="text-xs text-slate-500 mt-1">{getHebrewDateLabel(txDate)}</div>
                                )}
                              </>
                            );
                          })()}
                        </td>
                        <td className="py-4 px-6">
                          <div className="font-medium text-slate-900">{transaction.description}</div>
                          {(() => {
                            const txDate = toLocalDate(transaction.date);
                            const label = getSpecialDayLabel(txDate);
                            return label ? <div className="text-sm text-slate-500 mt-1">{label}</div> : null;
                          })()}
                        </td>
                        <td className="py-4 px-6">
                          <span
                            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                              transaction.type === 'charge'
                                ? 'bg-amber-100 text-amber-800'
                                : transaction.type === 'donation'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-green-100 text-green-800'
                            }`}
                          >
                            {transaction.type === 'charge'
                              ? 'Charge'
                              : transaction.type === 'donation'
                                ? 'Donation'
                                : 'Payment'}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <span
                            className={`text-lg font-bold ${
                              transaction.type === 'charge'
                                ? 'text-amber-600'
                                : transaction.type === 'donation'
                                  ? 'text-blue-600'
                                  : 'text-green-600'
                            }`}
                          >
                            {transaction.type === 'charge' ? '+' : transaction.type === 'donation' ? '+' : '-'}$
                            {transaction.amount.toFixed(2)}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-center">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => {
                              const needsBalanceChange = transaction.type === 'charge' || transaction.type === 'payment';
                              const message = needsBalanceChange
                                ? 'Delete this transaction? This will adjust the member balance.'
                                : 'Delete this donation?';
                              if (confirm(message)) {
                                deleteTransactionMutation.mutate(transaction);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Hidden Invoice Template for Printing */}
        <div style={{ display: 'none' }}>
          <InvoiceTemplate
            ref={invoiceRef}
            member={member}
            charges={charges}
            payments={payments}
            totalCharges={totalCharges}
            totalPayments={totalPayments}
          />
        </div>
        <MiniCalendarPopup
          open={calendarOpen}
          onClose={() => setCalendarOpen(false)}
          onEventSelected={handleEventSelected}
        />
      </div>
    </div>
  );
}
