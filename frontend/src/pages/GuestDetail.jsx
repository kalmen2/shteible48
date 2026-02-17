import { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ArrowLeft,
  Printer,
  Plus,
  DollarSign,
  Calendar,
  Receipt,
  Trash2,
  CreditCard,
  Repeat,
  ChevronDown,
  Pencil,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { toLocalDate, todayISO } from '@/utils/dates';
import { getUser } from '@/lib/auth';
import GuestInvoiceTemplate from '../components/guests/GuestInvoiceTemplate';
import MiniCalendarPopup from '../components/guests/MiniCalendarPopup';

const createPageUrl = (page) => {
  const [pageName, queryString] = page.split('?');
  return queryString ? `/${pageName}?${queryString}` : `/${pageName}`;
};

export default function GuestDetail() {
  const urlParams = new URLSearchParams(window.location.search);
  const guestId = urlParams.get('id');
  const role = String(getUser()?.role || '').toLowerCase();
  const isScopedUser = role === 'member' || role === 'guest';
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentMode, setPaymentMode] = useState('payment');
  const [chargeDialogOpen, setChargeDialogOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [donationDialogOpen, setDonationDialogOpen] = useState(false);
  const [payoffDialogOpen, setPayoffDialogOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDescription, setPaymentDescription] = useState('');
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeDescription, setChargeDescription] = useState('');
  const [chargeDate, setChargeDate] = useState(todayISO());
  const [donationAmount, setDonationAmount] = useState('');
  const [payoffAmount, setPayoffAmount] = useState('');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editGuest, setEditGuest] = useState({
    full_name: '',
    email: '',
    phone: '',
    address: '',
  });
  const invoiceRef = useRef();

  const queryClient = useQueryClient();

  const { data: guest, isLoading: guestLoading } = useQuery({
    queryKey: ['guest', guestId],
    queryFn: async () => {
      const guests = await base44.entities.Guest.filter({ id: guestId });
      return guests[0];
    },
    enabled: !!guestId,
  });

  const { data: transactions = [], isLoading: transactionsLoading } = useQuery({
    queryKey: ['guestTransactions', guestId],
    queryFn: () => base44.entities.GuestTransaction.filter({ guest_id: guestId }, '-date', 1000),
    enabled: !!guestId,
  });

  const addPaymentMutation = useMutation({
    mutationFn: async (paymentData) => {
      return await base44.entities.GuestTransaction.create(paymentData);
    },
    onError: (error) => {
      console.error('addGuestPaymentMutation failed', error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['guest', guestId] });
      queryClient.invalidateQueries({ queryKey: ['guestTransactions', guestId] });
      queryClient.invalidateQueries({ queryKey: ['guests'] });
      setPaymentDialogOpen(false);
      setPaymentAmount('');
      setPaymentDescription('');
    },
  });

  const addChargeMutation = useMutation({
    mutationFn: async (chargeData) => {
      return await base44.entities.GuestTransaction.create(chargeData);
    },
    onError: (error) => {
      console.error('addGuestChargeMutation failed', error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['guest', guestId] });
      queryClient.invalidateQueries({ queryKey: ['guestTransactions', guestId] });
      queryClient.invalidateQueries({ queryKey: ['guests'] });
      setChargeDialogOpen(false);
      setChargeAmount('');
      setChargeDescription('');
      setChargeDate(todayISO());
    },
  });

  const deleteTransactionMutation = useMutation({
    mutationFn: async (transaction) => {
      await base44.entities.GuestTransaction.delete(transaction.id);
    },
    onError: (error) => {
      console.error('deleteGuestTransaction failed', error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['guest', guestId] });
      queryClient.invalidateQueries({ queryKey: ['guestTransactions', guestId] });
      queryClient.invalidateQueries({ queryKey: ['guests'] });
    },
  });

  const updateGuestMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Guest.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guest', guestId] });
      queryClient.invalidateQueries({ queryKey: ['guests'] });
      setEditDialogOpen(false);
    },
  });

  const handlePaymentSubmit = (e) => {
    e.preventDefault();
    if (isScopedUser) return;
    addPaymentMutation.mutate({
      guest_id: guestId,
      guest_name: guest.full_name,
      type: 'payment',
      description: paymentDescription || 'Payment received',
      amount: parseFloat(paymentAmount),
      date: todayISO(),
    });
  };

  const handleStripePayment = async (e) => {
    e.preventDefault();
    const amount = parseFloat(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const paymentType =
      paymentMode === 'donation'
        ? 'donation'
        : paymentMode === 'payoff'
          ? 'balance_payoff'
          : 'payment';
    const defaultDesc =
      paymentMode === 'donation'
        ? `Donation - ${guest.full_name}`
        : paymentMode === 'payoff'
          ? `Balance Payoff - ${guest.full_name}`
          : `Payment - ${guest.full_name}`;
    const out = await base44.payments.createGuestCheckout({
      guestId,
      amount,
      paymentType,
      description: paymentDescription || defaultDesc,
      successPath: `/GuestDetail?id=${encodeURIComponent(guestId)}`,
      cancelPath: `/GuestDetail?id=${encodeURIComponent(guestId)}`,
    });
    if (out?.url) window.location.href = out.url;
  };

  const openPaymentDialog = (mode) => {
    setPaymentMode(mode);
    setPaymentDialogOpen(true);
  };

  const handleMonthlyDonationSubmit = (e) => {
    e.preventDefault();
    const amountPerMonth = parseFloat(donationAmount);
    if (!Number.isFinite(amountPerMonth) || amountPerMonth <= 0) return;
    base44.payments
      .createGuestSubscriptionCheckout({
        guestId,
        paymentType: 'guest_monthly_donation',
        amountPerMonth,
        successPath: `/GuestDetail?id=${encodeURIComponent(guestId)}`,
        cancelPath: `/GuestDetail?id=${encodeURIComponent(guestId)}`,
      })
      .then((out) => {
        if (out?.url) window.location.href = out.url;
      });
  };

  const handleMonthlyPayoffSubmit = (e) => {
    e.preventDefault();
    const amountPerMonth = parseFloat(payoffAmount);
    if (!Number.isFinite(amountPerMonth) || amountPerMonth <= 0) return;
    base44.payments
      .createGuestSubscriptionCheckout({
        guestId,
        paymentType: 'guest_balance_payoff',
        amountPerMonth,
        payoffTotal: guest.total_owed || 0,
        successPath: `/GuestDetail?id=${encodeURIComponent(guestId)}`,
        cancelPath: `/GuestDetail?id=${encodeURIComponent(guestId)}`,
      })
      .then((out) => {
        if (out?.url) window.location.href = out.url;
      });
  };

  const handleChargeSubmit = (e) => {
    e.preventDefault();
    if (isScopedUser) return;
    addChargeMutation.mutate({
      guest_id: guestId,
      guest_name: guest.full_name,
      type: 'charge',
      description: chargeDescription || 'Manual charge',
      amount: parseFloat(chargeAmount),
      date: chargeDate,
    });
  };

  const handleEventSelected = (eventData) => {
    if (isScopedUser) return;
    addChargeMutation.mutate({
      guest_id: guestId,
      guest_name: guest.full_name,
      type: 'charge',
      description: eventData.description,
      amount: parseFloat(eventData.amount),
      date: eventData.date,
      category: eventData.category,
    });
    setCalendarOpen(false);
  };

  const handlePrint = () => {
    const printContent = invoiceRef.current;
    const printWindow = window.open('', '', 'height=800,width=800');
    printWindow.document.write('<html><head><title>Invoice - ' + guest.full_name + '</title>');
    printWindow.document.write('</head><body>');
    printWindow.document.write(printContent.innerHTML);
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    printWindow.print();
  };

  const openEditDialog = () => {
    setEditGuest({
      full_name: String(guest?.full_name || ''),
      email: String(guest?.email || ''),
      phone: String(guest?.phone || ''),
      address: String(guest?.address || ''),
    });
    setEditDialogOpen(true);
  };

  const handleSaveEdit = (e) => {
    e.preventDefault();
    const full_name = String(editGuest.full_name || '').trim();
    const email = String(editGuest.email || '').trim();
    const phone = String(editGuest.phone || '').trim();
    const address = String(editGuest.address || '').trim();
    updateGuestMutation.mutate({
      id: guestId,
      data: {
        full_name: full_name || undefined,
        phone: phone || undefined,
        address: address || undefined,
        ...(!isScopedUser ? { email: email || undefined } : {}),
      },
    });
  };

  const paymentDialogTitle =
    paymentMode === 'donation'
      ? 'Donation'
      : paymentMode === 'payoff'
        ? 'Payoff Balance'
        : isScopedUser
          ? 'Payment'
          : 'Record Payment';

  const paymentDescriptionPlaceholder =
    paymentMode === 'donation'
      ? 'Donation note (optional)'
      : paymentMode === 'payoff'
        ? 'Balance payoff'
        : 'Check #123, Cash, etc.';

  const stripeButtonLabel =
    paymentMode === 'donation'
      ? 'Donate with Card'
      : paymentMode === 'payoff'
        ? 'Payoff with Card'
        : 'Pay with Card';

  if (guestLoading || !guest) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 flex items-center justify-center">
        <div className="text-slate-600 text-lg">Loading guest details...</div>
      </div>
    );
  }

  const charges = transactions.filter((t) => t.type === 'charge');
  const payments = transactions.filter((t) => t.type === 'payment');
  const totalCharges = charges.reduce((sum, t) => sum + (t.amount || 0), 0);
  const totalPayments = payments.reduce((sum, t) => sum + (t.amount || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Back Button */}
        <Link
          to={createPageUrl('Guests')}
          className="inline-flex items-center text-blue-900 hover:text-blue-700 mb-6 font-medium"
        >
          <ArrowLeft className="w-5 h-5 mr-2" />
          Back to Guests
        </Link>

        {/* Guest Header */}
        <Card className="mb-6 border-slate-200 shadow-lg">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div className="flex-1">
                <h1 className="text-3xl font-bold text-slate-900 mb-3">{guest.full_name}</h1>
                <div className="space-y-2 text-slate-600">
                  {guest.email && (
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Email:</span> {guest.email}
                    </div>
                  )}
                  {guest.phone && (
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Phone:</span> {guest.phone}
                    </div>
                  )}
                  {guest.address && (
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Address:</span> {guest.address}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-3">
                <div className="text-right">
                  <div className="text-sm text-slate-600 mb-1">Current Balance</div>
                  <div
                    className={`text-4xl font-bold ${
                      (guest.total_owed || 0) > 0 ? 'text-amber-600' : 'text-green-600'
                    }`}
                  >
                    ${(guest.total_owed || 0).toFixed(2)}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {!isScopedUser && (
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
                  )}

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
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setChargeDialogOpen(false)}
                          >
                            Cancel
                          </Button>
                          <Button type="submit" className="bg-amber-600 hover:bg-amber-700">
                            Add Charge
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
                      {!isScopedUser && (
                        <DropdownMenuItem onSelect={() => openPaymentDialog('payment')}>
                          <Plus className="w-4 h-4 mr-2" />
                          Record Payment
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => openPaymentDialog('donation')}>
                        <DollarSign className="w-4 h-4 mr-2" />
                        Donation
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => openPaymentDialog('payoff')}>
                        <CreditCard className="w-4 h-4 mr-2" />
                        Payoff Balance
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Dialog
                    open={paymentDialogOpen}
                    onOpenChange={(open) => {
                      setPaymentDialogOpen(open);
                      if (!open) {
                        setPaymentMode('payment');
                        setPaymentAmount('');
                        setPaymentDescription('');
                      }
                    }}
                  >
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{paymentDialogTitle}</DialogTitle>
                      </DialogHeader>
                      <form
                        onSubmit={
                          !isScopedUser && paymentMode === 'payment'
                            ? handlePaymentSubmit
                            : handleStripePayment
                        }
                        className="space-y-4 mt-4"
                      >
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
                            className="h-11"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="description">Description</Label>
                          <Input
                            id="description"
                            value={paymentDescription}
                            onChange={(e) => setPaymentDescription(e.target.value)}
                            placeholder={paymentDescriptionPlaceholder}
                            className="h-11"
                          />
                        </div>
                        <div className="flex justify-end gap-3 pt-4">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setPaymentDialogOpen(false)}
                          >
                            Cancel
                          </Button>
                          {!isScopedUser && paymentMode === 'payment' && (
                            <Button type="submit" className="bg-green-600 hover:bg-green-700">
                              Record Payment
                            </Button>
                          )}
                          <Button
                            type="button"
                            className="bg-blue-900 hover:bg-blue-800"
                            onClick={handleStripePayment}
                          >
                            {stripeButtonLabel}
                          </Button>
                        </div>
                      </form>
                    </DialogContent>
                  </Dialog>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="border-green-200 text-green-700 hover:bg-green-50"
                      >
                        <Repeat className="w-4 h-4 mr-2" />
                        Monthly
                        <ChevronDown className="w-4 h-4 ml-2" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setDonationDialogOpen(true)}>
                        <Repeat className="w-4 h-4 mr-2" />
                        Monthly Donation
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setPayoffDialogOpen(true)}>
                        <CreditCard className="w-4 h-4 mr-2" />
                        Pay Off Monthly
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Dialog open={donationDialogOpen} onOpenChange={setDonationDialogOpen}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Set Monthly Donation</DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handleMonthlyDonationSubmit} className="space-y-4 mt-4">
                        <div className="space-y-2">
                          <Label htmlFor="donationAmount">Monthly Amount *</Label>
                          <Input
                            id="donationAmount"
                            type="number"
                            step="0.01"
                            value={donationAmount}
                            onChange={(e) => setDonationAmount(e.target.value)}
                            required
                            placeholder="50.00"
                            className="h-11"
                          />
                        </div>
                        <p className="text-sm text-slate-500">
                          Guests can donate monthly with no base charge.
                        </p>
                        <div className="flex justify-end gap-3 pt-4">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setDonationDialogOpen(false)}
                          >
                            Cancel
                          </Button>
                          <Button type="submit" className="bg-green-600 hover:bg-green-700">
                            Start Monthly Donation
                          </Button>
                        </div>
                      </form>
                    </DialogContent>
                  </Dialog>

                  <Dialog open={payoffDialogOpen} onOpenChange={setPayoffDialogOpen}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Monthly Payoff Plan</DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handleMonthlyPayoffSubmit} className="space-y-4 mt-4">
                        <div className="space-y-2">
                          <Label htmlFor="payoffAmount">Monthly Amount *</Label>
                          <Input
                            id="payoffAmount"
                            type="number"
                            step="0.01"
                            value={payoffAmount}
                            onChange={(e) => setPayoffAmount(e.target.value)}
                            required
                            placeholder={guest.total_owed ? guest.total_owed.toFixed(2) : '100.00'}
                            className="h-11"
                          />
                        </div>
                        <p className="text-sm text-slate-500">
                          We will only charge the monthly amount you set until the balance is paid.
                          No base charge is applied.
                        </p>
                        <div className="flex justify-end gap-3 pt-4">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setPayoffDialogOpen(false)}
                          >
                            Cancel
                          </Button>
                          <Button type="submit" className="bg-amber-600 hover:bg-amber-700">
                            Start Payoff Plan
                          </Button>
                        </div>
                      </form>
                    </DialogContent>
                  </Dialog>

                  <Button
                    onClick={handlePrint}
                    variant="outline"
                    className="border-slate-300 text-slate-700 hover:bg-slate-50"
                  >
                    <Printer className="w-4 h-4 mr-2" />
                    Print Invoice
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="border-slate-300 text-slate-700 hover:bg-slate-50"
                      >
                        Actions
                        <ChevronDown className="w-4 h-4 ml-2" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={openEditDialog}>
                        <Pencil className="w-4 h-4 mr-2" />
                        Edit Details
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Edit Guest Details</DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handleSaveEdit} className="space-y-4 mt-4">
                        <div className="space-y-2">
                          <Label htmlFor="edit_full_name">Full Name *</Label>
                          <Input
                            id="edit_full_name"
                            value={editGuest.full_name}
                            onChange={(e) => setEditGuest({ ...editGuest, full_name: e.target.value })}
                            placeholder="Full name"
                            required
                          />
                        </div>
                        {!isScopedUser && (
                          <div className="space-y-2">
                            <Label htmlFor="edit_email">Email</Label>
                            <Input
                              id="edit_email"
                              type="email"
                              value={editGuest.email}
                              onChange={(e) => setEditGuest({ ...editGuest, email: e.target.value })}
                              placeholder="email@example.com"
                            />
                          </div>
                        )}
                        <div className="space-y-2">
                          <Label htmlFor="edit_phone">Phone</Label>
                          <Input
                            id="edit_phone"
                            value={editGuest.phone}
                            onChange={(e) => setEditGuest({ ...editGuest, phone: e.target.value })}
                            placeholder="Phone number"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="edit_address">Address</Label>
                          <Input
                            id="edit_address"
                            value={editGuest.address}
                            onChange={(e) => setEditGuest({ ...editGuest, address: e.target.value })}
                            placeholder="Address"
                          />
                        </div>
                        <div className="flex justify-end gap-3 pt-4">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setEditDialogOpen(false)}
                          >
                            Cancel
                          </Button>
                          <Button type="submit" className="bg-blue-900 hover:bg-blue-800">
                            Save Changes
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

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <Card className="border-slate-200 shadow-md">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-600 mb-1">Total Charges</div>
                  <div className="text-2xl font-bold text-slate-900">
                    ${totalCharges.toFixed(2)}
                  </div>
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
                  <div className="text-2xl font-bold text-slate-900">
                    ${totalPayments.toFixed(2)}
                  </div>
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
                      <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">
                        Date
                      </th>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">
                        Description
                      </th>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">
                        Type
                      </th>
                      <th className="text-right py-4 px-6 text-sm font-semibold text-slate-700">
                        Amount
                      </th>
                      <th className="text-center py-4 px-6 text-sm font-semibold text-slate-700">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {transactions.map((transaction) => (
                      <tr key={transaction.id} className="hover:bg-blue-50/50 transition-colors">
                        <td className="py-4 px-6 text-slate-600">
                          {(() => {
                            const txDate = toLocalDate(transaction.date);
                            return txDate ? format(txDate, 'MMM d, yyyy') : 'N/A';
                          })()}
                        </td>
                        <td className="py-4 px-6">
                          <div className="font-medium text-slate-900">
                            {transaction.description}
                          </div>
                          {transaction.category && (
                            <div className="text-sm text-slate-500 mt-1">
                              {transaction.category}
                            </div>
                          )}
                        </td>
                        <td className="py-4 px-6">
                          <span
                            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                              transaction.type === 'charge'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-green-100 text-green-800'
                            }`}
                          >
                            {transaction.type === 'charge' ? 'Charge' : 'Payment'}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <span
                            className={`text-lg font-bold ${
                              transaction.type === 'charge' ? 'text-amber-600' : 'text-green-600'
                            }`}
                          >
                            {transaction.type === 'charge' ? '+' : '-'}$
                            {transaction.amount?.toFixed(2)}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-center">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => {
                              if (
                                confirm(
                                  'Delete this transaction? This will adjust the guest balance.'
                                )
                              ) {
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
          <GuestInvoiceTemplate
            ref={invoiceRef}
            guest={guest}
            transactions={transactions}
            totalCharges={totalCharges}
            totalPayments={totalPayments}
          />
        </div>
      </div>

      {/* Mini Calendar Popup */}
      <MiniCalendarPopup
        open={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        onEventSelected={handleEventSelected}
      />
    </div>
  );
}
