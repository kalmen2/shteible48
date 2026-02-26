import { useState } from 'react';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus,
  CreditCard,
  AlertCircle,
  Upload,
  Download,
  UserPlus,
  ChevronDown,
  FileSpreadsheet,
  Search,
  Pencil,
  Trash2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from '@/components/ui/use-toast';

const generateUniqueMemberId = (existingIds = new Set()) => {
  let attempt = 0;
  while (attempt < 10000) {
    const candidate = Math.floor(1000 + Math.random() * 9000).toString();
    if (!existingIds.has(candidate)) return candidate;
    attempt += 1;
  }
  // Fallback to timestamp-based if extremely dense
  return `${Date.now()}`.slice(-4);
};

const createPageUrl = (page) => {
  const [pageName, queryString] = page.split('?');
  return queryString ? `/${pageName}?${queryString}` : `/${pageName}`;
};

export default function Members() {
  const [chargeDialogOpen, setChargeDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false);
  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);
  const [editMemberDialogOpen, setEditMemberDialogOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [newMember, setNewMember] = useState({
    english_name: '',
    hebrew_name: '',
    full_name: '',
    email: '',
    phone: '',
    address: '',
  });
  const [uploading, setUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [selectedMember, setSelectedMember] = useState(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeType, setChargeType] = useState('standard_donation');
  // Stripe Checkout handles secure card entry.
  const [processing, setProcessing] = useState(false);
  // New: Payment month choice for activation
  const [paymentMonthChoice, setPaymentMonthChoice] = useState('this'); // 'this' or 'next'
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('alpha'); // "alpha" or "balance"

  const queryClient = useQueryClient();

  const { data: members = [] } = useQuery({
    queryKey: ['members'],
    queryFn: () => base44.entities.Member.list('-full_name', 1000),
  });

  const filteredMembers = members
    .filter(
      (m) =>
        m.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.english_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.hebrew_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.member_id?.includes(searchQuery)
    )
    .sort((a, b) => {
      if (sortBy === 'balance') {
        return (b.total_owed || 0) - (a.total_owed || 0);
      }
      const nameA = a.english_name || a.full_name || a.hebrew_name || '';
      const nameB = b.english_name || b.full_name || b.hebrew_name || '';
      return nameA.localeCompare(nameB);
    });

  const { data: plans = [] } = useQuery({
    queryKey: ['membershipPlans'],
    queryFn: () => base44.entities.MembershipPlan.list('-created_date', 1),
  });

  const { data: charges = [] } = useQuery({
    queryKey: ['membershipCharges'],
    queryFn: () => base44.entities.MembershipCharge.list('-created_date', 1000),
  });

  const { data: recurringPayments = [] } = useQuery({
    queryKey: ['recurringPayments'],
    queryFn: () => base44.entities.RecurringPayment.filter({ is_active: true }),
  });

  const currentPlan = plans[0];

  const createMemberMutation = useMutation({
    mutationFn: (memberData) => base44.entities.Member.create(memberData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members'] });
      setAddMemberDialogOpen(false);
      setNewMember({
        english_name: '',
        hebrew_name: '',
        full_name: '',
        email: '',
        phone: '',
        address: '',
      });
    },
  });

  const updateMemberMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Member.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members'] });
      setEditMemberDialogOpen(false);
      setSelectedMember(null);
      toast({
        title: 'פרטי החבר עודכנו',
        description: 'השינויים נשמרו בהצלחה.',
      });
    },
    onError: async (error, variables) => {
      try {
        const refreshed = await base44.entities.Member.filter({ id: variables.id });
        let current = refreshed?.[0];
        if (!current) {
          const byMemberId = await base44.entities.Member.filter({
            member_id: String(variables.id),
          });
          current = byMemberId?.[0];
        }
        if (current) {
          const matches = Object.entries(variables.data || {}).every(([key, value]) => {
            if (value === undefined) return true;
            return String(current[key] ?? '') === String(value);
          });
          if (matches) {
            queryClient.setQueryData(['members'], (prev = []) =>
              Array.isArray(prev)
                ? prev.map((m) => (m.id === current.id ? { ...m, ...current } : m))
                : prev
            );
            setEditMemberDialogOpen(false);
            setSelectedMember(null);
            toast({
              title: 'פרטי החבר עודכנו',
              description: 'השינויים נשמרו בהצלחה.',
            });
            return;
          }
        }
      } catch {
        // fall through to error toast
      }
      toast({
        title: 'העדכון נכשל',
        description: error?.message || 'לא ניתן לשמור את שינויי החבר.',
        variant: 'destructive',
      });
    },
  });

  const deleteMembersMutation = useMutation({
    mutationFn: async (ids) => {
      for (const id of ids) {
        // Cancel any active membership subscription first
        const membershipSub = recurringPayments.find(
          (p) => p.member_id === id && p.payment_type === 'membership' && p.is_active
        );
        if (membershipSub) {
          await base44.payments.cancelSubscription({ recurringPaymentId: membershipSub.id });
        }
        await base44.entities.Member.delete(id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members'] });
      queryClient.invalidateQueries({ queryKey: ['recurringPayments'] });
      setSelectedMemberIds([]);
    },
  });

  const deleteMemberMutation = useMutation({
    mutationFn: async (id) => {
      const membershipSub = recurringPayments.find(
        (p) => p.member_id === id && p.payment_type === 'membership' && p.is_active
      );
      if (membershipSub) {
        await base44.payments.cancelSubscription({ recurringPaymentId: membershipSub.id });
      }
      return base44.entities.Member.delete(id);
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['members'] });
      queryClient.invalidateQueries({ queryKey: ['recurringPayments'] });
      setSelectedMemberIds((prev) => prev.filter((memberId) => memberId !== id));
    },
  });

  const createChargeMutation = useMutation({
    mutationFn: (chargeData) => base44.entities.MembershipCharge.create(chargeData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['membershipCharges'] });
      queryClient.invalidateQueries({ queryKey: ['members'] });
      setChargeDialogOpen(false);
      setSelectedMember(null);
      setChargeAmount('');
      setChargeType('standard_donation');
    },
  });

  const updateChargeMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.MembershipCharge.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['membershipCharges'] });
      queryClient.invalidateQueries({ queryKey: ['members'] });
    },
  });

  const cancelPayoffMutation = useMutation({
    mutationFn: ({ id }) =>
      base44.entities.RecurringPayment.update(id, {
        is_active: false,
        amount_per_month: 0,
        ended_date: new Date().toISOString().split('T')[0],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurringPayments'] });
      queryClient.invalidateQueries({ queryKey: ['members'] });
    },
  });

  const handleAddMember = (e) => {
    e.preventDefault();
    const existingIds = new Set((members || []).map((m) => m.member_id).filter(Boolean));
    const member_id = generateUniqueMemberId(existingIds);
    const full_name =
      newMember.english_name?.trim() ||
      newMember.hebrew_name?.trim() ||
      newMember.full_name?.trim();
    createMemberMutation.mutate({
      ...newMember,
      full_name,
      member_id,
    });
  };

  const handleDownloadTemplate = () => {
    const csvContent =
      'english_name,hebrew_name,email,phone,address\nHarav Moshe Fogel,הרב משה פוגל,john@example.com,123-456-7890,123 Main St';
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'member_template.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleActivateSelected = async () => {
    if (!currentPlan?.standard_amount) {
      alert('אנא הגדירו קודם סכום חודשי סטנדרטי בהגדרות.');
      return;
    }
    const selectedMembers = members.filter((m) => selectedMemberIds.includes(m.id));
    const inactiveMembers = selectedMembers.filter((m) => !m.membership_active);
    if (inactiveMembers.length === 0) {
      alert('לא נבחרו חברים לא פעילים.');
      return;
    }
    if (inactiveMembers.length > 1) {
      alert('הפעלה מרובה הוסרה. יש להפעיל חבר אחד בכל פעם.');
      return;
    }

    const target = inactiveMembers[0];
    const targetName = target.english_name || target.full_name || target.hebrew_name || 'חבר';
    const ok = window.confirm(`לפתוח את Stripe Checkout להפעלת חברות עבור ${targetName}?`);
    if (!ok) return;

    setSelectedMember(target);
    setPaymentDialogOpen(true);
  };

  const toggleMemberSelection = (id) => {
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const toggleAllMembers = (checked) => {
    if (!checked) {
      setSelectedMemberIds([]);
      return;
    }
    setSelectedMemberIds(filteredMembers.map((m) => m.id));
  };

  const handleDeleteSelected = () => {
    if (selectedMemberIds.length === 0) return;
    const ok = window.confirm(
      `למחוק ${selectedMemberIds.length} חברים? לא ניתן לבטל פעולה זו.`
    );
    if (!ok) return;
    deleteMembersMutation.mutate(selectedMemberIds);
  };

  const handleDeleteMember = (member) => {
    const name = member.english_name || member.full_name || member.hebrew_name || 'חבר זה';
    const ok = window.confirm(`למחוק את ${name}? לא ניתן לבטל פעולה זו.`);
    if (!ok) return;
    deleteMemberMutation.mutate(member.id);
  };

  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!uploadFile) return;

    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file: uploadFile });

      const result = await base44.integrations.Core.ExtractDataFromUploadedFile({
        file_url,
        json_schema: {
          type: 'object',
          properties: {
            members: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  english_name: { type: ['string', 'null'] },
                  hebrew_name: { type: ['string', 'null'] },
                  full_name: { type: ['string', 'null'] },
                  email: { type: ['string', 'null'] },
                  phone: { type: ['string', 'null'] },
                  address: { type: ['string', 'null'] },
                },
              },
            },
          },
        },
      });

      if (result?.status !== 'success' || !result?.output) {
        throw new Error(result?.message || 'לא ניתן היה לחלץ חברים מהקובץ');
      }

      const raw = result.output.members || result.output;
      const arr = Array.isArray(raw) ? raw : [raw];
      const cleaned = arr
        .map((m) => {
          const english_name = m?.english_name ? String(m.english_name).trim() : '';
          const hebrew_name = m?.hebrew_name ? String(m.hebrew_name).trim() : '';
          const full_name = m?.full_name ? String(m.full_name).trim() : english_name || hebrew_name;
          return {
            english_name,
            hebrew_name,
            full_name,
            email: m?.email ? String(m.email).trim() : undefined,
            phone: m?.phone ? String(m.phone).trim() : undefined,
            address: m?.address ? String(m.address).trim() : undefined,
          };
        })
        .filter((m) => m.full_name || m.english_name || m.hebrew_name);

      if (cleaned.length === 0) {
        throw new Error('לא נמצאו שורות חברים. ודאו שיש עמודות של שם באנגלית או בעברית.');
      }

      const existingIds = new Set((members || []).map((m) => m.member_id).filter(Boolean));
      const withIds = cleaned.map((m) => {
        const member_id = generateUniqueMemberId(existingIds);
        existingIds.add(member_id);
        return { ...m, member_id };
      });

      await base44.entities.Member.bulkCreate(withIds);
      queryClient.invalidateQueries({ queryKey: ['members'] });
      setUploadDialogOpen(false);
      setUploadFile(null);
    } catch (error) {
      alert('ההעלאה נכשלה: ' + (error?.message || error));
    }
    setUploading(false);
  };

  const handleAddCharge = (e) => {
    e.preventDefault();
    if (selectedMember) {
      createChargeMutation.mutate({
        member_id: selectedMember.id,
        member_name: selectedMember.full_name,
        charge_type: chargeType,
        amount: parseFloat(chargeAmount),
        is_active: true,
      });
    }
  };

  const activateMembership = async (e) => {
    e.preventDefault();
    if (!selectedMember || !currentPlan?.standard_amount) return;
    setProcessing(true);
    try {
      const applyMonth = paymentMonthChoice === 'next' ? 'next_month' : 'this_month';
      const out = await base44.payments.createSubscriptionCheckout({
        memberId: selectedMember.id,
        paymentType: 'membership',
        amountPerMonth: currentPlan.standard_amount,
        applyMonth,
        successPath: `/Members`,
        cancelPath: `/Members`,
      });
      if (out?.url) window.location.href = out.url;
    } finally {
      setProcessing(false);
    }
  };

  const deactivateMembership = async (member) => {
    setDeactivateDialogOpen(false);
    try {
      const membershipSub = recurringPayments.find(
        (p) => p.member_id === member.id && p.payment_type === 'membership' && p.is_active
      );

      if (membershipSub) {
        await base44.payments.cancelSubscription({ recurringPaymentId: membershipSub.id });
      }

      await updateMemberMutation.mutateAsync({
        id: member.id,
        data: { membership_active: false },
      });

      queryClient.invalidateQueries({ queryKey: ['recurringPayments'] });
      queryClient.invalidateQueries({ queryKey: ['members'] });
    } catch (err) {
      toast({
        title: 'כיבוי החברות נכשל',
        description: err?.message || 'לא ניתן לכבות חברות כרגע.',
        variant: 'destructive',
      });
    }
  };

  const openPaymentDialog = (member) => {
    setSelectedMember(member);
    setPaymentDialogOpen(true);
  };

  const openDeactivateDialog = (member) => {
    setSelectedMember(member);
    setDeactivateDialogOpen(true);
  };

  const handleEditMember = (member) => {
    setSelectedMember({ ...member });
    setEditMemberDialogOpen(true);
  };

  const handleSaveEdit = (e) => {
    e.preventDefault();
    const englishName = selectedMember.english_name?.trim() || '';
    const hebrewName = selectedMember.hebrew_name?.trim() || '';
    const full_name = englishName || hebrewName || selectedMember.full_name || '';
    const targetId = selectedMember.id || selectedMember.member_id;
    updateMemberMutation.mutate({
      id: targetId,
      data: {
        full_name,
        english_name: englishName || undefined,
        hebrew_name: hebrewName || undefined,
        email: selectedMember.email || undefined,
        phone: selectedMember.phone || undefined,
        address: selectedMember.address || undefined,
      },
    });
  };

  const getMemberCharges = (memberId) => {
    return charges.filter(
      (c) =>
        c.member_id === memberId &&
        c.is_active &&
        (c.charge_type === 'standard_donation' || c.charge_type === 'payoff')
    );
  };

  const getMemberRecurringPayments = (memberId) => {
    return recurringPayments.filter(
      (p) =>
        p.member_id === memberId &&
        p.is_active &&
        (p.payment_type === 'balance_payoff' || p.payment_type === 'additional_monthly')
    );
  };

  const getMemberTotalMonthly = (member) => {
    const standardAmount = Number(currentPlan?.standard_amount || 0);
    if (!member) return standardAmount;

    const memberCharges = getMemberCharges(member.id);
    const memberRecurring = getMemberRecurringPayments(member.id);
    const chargesTotal = memberCharges.reduce((sum, c) => sum + Number(c.amount || 0), 0);
    const payoffRecurring = memberRecurring
      .filter((p) => p.payment_type === 'balance_payoff')
      .reduce((sum, p) => sum + Number(p.amount_per_month || 0), 0);

    return (
      standardAmount +
      (Number.isFinite(chargesTotal) ? chargesTotal : 0) +
      (Number.isFinite(payoffRecurring) ? payoffRecurring : 0)
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h1 className="text-3xl font-bold text-slate-900">Members</h1>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search members..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-10 w-64"
              />
            </div>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-44 h-10">
                <SelectValue placeholder="Sort by..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alpha">A-Z (Name)</SelectItem>
                <SelectItem value="balance">Highest Balance</SelectItem>
              </SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Import/Export
                  <ChevronDown className="w-4 h-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleDownloadTemplate}>
                  <Download className="w-4 h-4 mr-2" />
                  Download Template
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setUploadDialogOpen(true)}>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload from Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {selectedMemberIds.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    Actions for Selected ({selectedMemberIds.length})
                    <ChevronDown className="w-4 h-4 ml-2" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={deleteMembersMutation.isPending}
                    onClick={handleDeleteSelected}
                  >
                    {deleteMembersMutation.isPending ? 'Deleting...' : 'Delete Selected'}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleActivateSelected}>
                    Activate Selected
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Upload Members from Excel</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleFileUpload} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="file">Select Excel/CSV File *</Label>
                    <input
                      id="file"
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={(e) => setUploadFile(e.target.files[0])}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                      required
                    />
                    <p className="text-xs text-slate-500">
                      Upload a CSV or Excel file with columns: english_name, hebrew_name, email, phone, address. Member IDs will be generated automatically.
                    </p>
                  </div>
                  <div className="flex justify-end gap-3 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setUploadDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      className="bg-blue-900 hover:bg-blue-800"
                      disabled={uploading}
                    >
                      {uploading ? 'Uploading...' : 'Upload Members'}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
            <Dialog open={addMemberDialogOpen} onOpenChange={setAddMemberDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-blue-900 hover:bg-blue-800">
                  <UserPlus className="w-4 h-4 mr-2" />
                  Add Member
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Member</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleAddMember} className="space-y-4 mt-4">
                  <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-sm text-slate-600">
                    Unique 4-digit Member ID will be generated automatically.
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="english_name">English Name</Label>
                    <Input
                      id="english_name"
                      value={newMember.english_name}
                      onChange={(e) => setNewMember({ ...newMember, english_name: e.target.value })}
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hebrew_name">Hebrew Name</Label>
                    <Input
                      id="hebrew_name"
                      value={newMember.hebrew_name}
                      onChange={(e) => setNewMember({ ...newMember, hebrew_name: e.target.value })}
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={newMember.email}
                      onChange={(e) => setNewMember({ ...newMember, email: e.target.value })}
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      value={newMember.phone}
                      onChange={(e) => setNewMember({ ...newMember, phone: e.target.value })}
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="address">Address</Label>
                    <Input
                      id="address"
                      value={newMember.address}
                      onChange={(e) => setNewMember({ ...newMember, address: e.target.value })}
                      className="h-11"
                    />
                  </div>
                  <div className="flex justify-end gap-3 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setAddMemberDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" className="bg-blue-900 hover:bg-blue-800">
                      Add Member
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Members List */}
        <Card className="border-slate-200 shadow-lg">
          <CardHeader className="border-b border-slate-200 bg-slate-50">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <CardTitle>Members & Charges</CardTitle>
              <div className="text-sm font-medium text-slate-700">
                Standard Monthly Amount:{' '}
                <span className="font-bold text-slate-900">
                  {currentPlan ? `$${currentPlan.standard_amount.toFixed(2)}` : 'No plan defined'}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {filteredMembers.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                {members.length === 0 ? 'עדיין אין חברים' : 'לא נמצאו חברים לפי החיפוש'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={
                            filteredMembers.length > 0 &&
                            selectedMemberIds.length === filteredMembers.length
                          }
                          onChange={(e) => toggleAllMembers(e.target.checked)}
                          className="w-4 h-4 text-blue-900 rounded border-slate-300"
                        />
                      </th>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">
                        ID
                      </th>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">
                        Full Name
                      </th>
                      <th className="text-center py-4 px-6 text-sm font-semibold text-slate-700">
                        Status
                      </th>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">
                        Additional Charges
                      </th>
                      <th className="text-right py-4 px-6 text-sm font-semibold text-slate-700">
                        Total Monthly
                      </th>
                      <th className="text-right py-4 px-6 text-sm font-semibold text-slate-700">
                        Balance Due
                      </th>
                      <th className="text-center py-4 px-6 text-sm font-semibold text-slate-700">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredMembers.map((member) => {
                      const memberCharges = getMemberCharges(member.id);
                      const memberRecurring = getMemberRecurringPayments(member.id);
                      const totalMonthly = getMemberTotalMonthly(member);
                      const displayBalance = member.total_owed || 0;
                      const primaryName =
                        member.english_name || member.full_name || member.hebrew_name || 'ללא שם';
                      const secondaryName =
                        member.hebrew_name && member.hebrew_name !== primaryName
                          ? member.hebrew_name
                          : null;
                      return (
                        <tr key={member.id} className="hover:bg-blue-50/30 transition-colors">
                          <td className="py-4 px-6 align-top">
                            <input
                              type="checkbox"
                              checked={selectedMemberIds.includes(member.id)}
                              onChange={() => toggleMemberSelection(member.id)}
                              className="w-4 h-4 text-blue-900 rounded border-slate-300"
                            />
                          </td>
                          <td className="py-4 px-6 text-sm font-mono text-slate-700 align-top">
                            {member.member_id || '—'}
                          </td>
                          <td className="py-4 px-6 align-top">
                            <Link
                              to={createPageUrl(`MemberDetail?id=${member.id}`)}
                              className="font-semibold text-blue-900 hover:text-blue-700"
                            >
                              {primaryName}
                            </Link>
                            {secondaryName && (
                              <div className="text-sm text-purple-800 font-medium">
                                {secondaryName}
                              </div>
                            )}
                            {member.email && (
                              <div className="text-sm text-slate-500">{member.email}</div>
                            )}
                          </td>
                          <td className="py-4 px-6 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <div
                                className={`w-3 h-3 rounded-full ${
                                  member.membership_active ? 'bg-green-500' : 'bg-red-500'
                                }`}
                              ></div>
                              <span
                                className={`text-sm font-medium ${
                                  member.membership_active ? 'text-green-600' : 'text-red-600'
                                }`}
                              >
                                {member.membership_active ? 'Active' : 'Inactive'}
                              </span>
                            </div>
                            <div className="mt-1 text-xs">
                              {member.stripe_default_payment_method_id ? (
                                <span className="text-green-700">Card on file</span>
                              ) : (
                                <span className="text-slate-400">No card</span>
                              )}
                            </div>
                          </td>
                          <td className="py-4 px-6">
                            {memberCharges.length > 0 || memberRecurring.length > 0 ? (
                              <div className="space-y-1">
                                {memberCharges.map((charge) => (
                                  <div key={charge.id} className="flex items-center gap-2">
                                    <span className="text-sm px-2 py-1 bg-amber-100 text-amber-800 rounded">
                                      {charge.charge_type === 'standard_donation'
                                        ? 'Recurring Donation'
                                        : 'Installment'}
                                    </span>
                                    <span className="text-sm font-medium">
                                      ${charge.amount.toFixed(2)}
                                    </span>
                                    <button
                                      onClick={() =>
                                        updateChargeMutation.mutate({
                                          id: charge.id,
                                          data: { is_active: false },
                                        })
                                      }
                                      className="text-xs text-red-600 hover:text-red-800"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                ))}
                                {memberRecurring
                                  .filter((p) => p.payment_type === 'balance_payoff')
                                  .map((payment) => (
                                    <div key={payment.id} className="flex items-center gap-2">
                                      <span className="text-sm px-2 py-1 bg-blue-100 text-blue-800 rounded">
                                        Installment
                                      </span>
                                      <span className="text-sm font-medium">
                                        ${payment.amount_per_month.toFixed(2)}
                                      </span>
                                      <button
                                        onClick={() =>
                                          cancelPayoffMutation.mutate({ id: payment.id })
                                        }
                                        className="text-xs text-red-600 hover:text-red-800"
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  ))}
                              </div>
                            ) : (
                              <span className="text-sm text-slate-400">None</span>
                            )}
                          </td>
                          <td className="py-4 px-6 text-right">
                            {currentPlan ? (
                              <div className="text-lg font-bold text-blue-900">
                                ${totalMonthly.toFixed(2)}
                              </div>
                            ) : (
                              <span className="text-sm text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-4 px-6 text-right">
                            <div
                              className={`text-lg font-bold ${
                                displayBalance > 0 ? 'text-amber-600' : 'text-green-600'
                              }`}
                            >
                              ${displayBalance.toFixed(2)}
                            </div>
                          </td>
                          <td className="py-4 px-6 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleEditMember(member)}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDeleteMember(member)}
                                className="text-red-600 hover:text-red-700"
                                title="מחיקת חבר"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                              {!member.membership_active ? (
                                <Button
                                  size="sm"
                                  className="bg-green-600 hover:bg-green-700"
                                  onClick={() => openPaymentDialog(member)}
                                >
                                  <Plus className="w-4 h-4 mr-1" />
                                  הוספת חברות
                                </Button>
                              ) : (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-red-600 text-red-600 hover:bg-red-50"
                                    onClick={() => openDeactivateDialog(member)}
                                  >
                                    הסרה
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setSelectedMember(member);
                                      setChargeDialogOpen(true);
                                    }}
                                  >
                                    <Plus className="w-4 h-4 mr-1" />
                                    הוספת חיוב
                                  </Button>
                                </>
                              )}
                            </div>
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

        {/* Payment Dialog */}
        <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CreditCard className="w-5 h-5" />
                הוספת אמצעי תשלום
              </DialogTitle>
            </DialogHeader>
            {selectedMember && (
              <form onSubmit={activateMembership} className="space-y-4 mt-4">
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="text-sm text-slate-600 mb-1">הפעלת חברות עבור:</div>
                  <div className="font-semibold text-slate-900">{selectedMember.full_name}</div>
                  <div className="text-xs mt-1">
                    {selectedMember.stripe_default_payment_method_id ? (
                      <span className="text-green-700">כרטיס קיים במערכת</span>
                    ) : (
                      <span className="text-amber-700">אין כרטיס במערכת</span>
                    )}
                  </div>
                  {currentPlan && (
                    <div className="text-sm text-slate-600 mt-2">
                      סכום חודשי:{' '}
                      <span className="font-semibold">
                        ${currentPlan.standard_amount.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>

                {/* New: Payment month choice */}
                <div className="space-y-2">
                  <Label className="text-sm text-slate-700">להחיל את התשלום הראשון על:</Label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="paymentMonthChoice"
                        value="this"
                        checked={paymentMonthChoice === 'this'}
                        onChange={() => setPaymentMonthChoice('this')}
                      />
                      <span>החודש הזה</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="paymentMonthChoice"
                        value="next"
                        checked={paymentMonthChoice === 'next'}
                        onChange={() => setPaymentMonthChoice('next')}
                      />
                      <span>החודש הבא</span>
                    </label>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    אם תבחרו בחודש הבא, התשלום הראשון יחול על החודש הבא והחיובים הקבועים יתחילו בחודש שלאחריו.
                  </div>
                </div>

                <div className="text-sm text-slate-600">
                  פרטי התשלום יוזנו בצורה מאובטחת ב-Stripe Checkout.
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPaymentDialogOpen(false)}
                  >
                    ביטול
                  </Button>
                  <Button
                    type="submit"
                    className="bg-green-600 hover:bg-green-700"
                    disabled={processing}
                  >
                    {processing ? 'מעבד...' : 'הפעלת חברות'}
                  </Button>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>

        {/* Deactivate Confirmation Dialog */}
        <Dialog open={deactivateDialogOpen} onOpenChange={setDeactivateDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-700">
                <AlertCircle className="w-5 h-5" />
                השבתת חברות
              </DialogTitle>
            </DialogHeader>
            {selectedMember && (
              <div className="space-y-4 mt-4">
                <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
                  <p className="text-sm text-slate-700 mb-2">
                    האם אתם בטוחים שברצונכם להשבית חברות עבור{' '}
                    <span className="font-semibold">{selectedMember.full_name}</span>?
                  </p>
                  <p className="text-sm text-amber-700 font-medium">
                    שימו לב: החברות תישאר פעילה עד סוף החודש הנוכחי.
                  </p>
                </div>

                <div className="flex justify-end gap-3">
                  <Button variant="outline" onClick={() => setDeactivateDialogOpen(false)}>
                    ביטול
                  </Button>
                  <Button
                    className="bg-red-600 hover:bg-red-700"
                    onClick={() => deactivateMembership(selectedMember)}
                  >
                    השבתה
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Edit Member Dialog */}
        <Dialog open={editMemberDialogOpen} onOpenChange={setEditMemberDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>עריכת חבר</DialogTitle>
            </DialogHeader>
            {selectedMember && (
              <form onSubmit={handleSaveEdit} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="edit_english_name">שם באנגלית</Label>
                  <Input
                    id="edit_english_name"
                    value={selectedMember.english_name || ''}
                    onChange={(e) =>
                      setSelectedMember({ ...selectedMember, english_name: e.target.value })
                    }
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_hebrew_name">שם בעברית</Label>
                  <Input
                    id="edit_hebrew_name"
                    value={selectedMember.hebrew_name || ''}
                    onChange={(e) =>
                      setSelectedMember({ ...selectedMember, hebrew_name: e.target.value })
                    }
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_email">אימייל</Label>
                  <Input
                    id="edit_email"
                    type="email"
                    value={selectedMember.email || ''}
                    onChange={(e) =>
                      setSelectedMember({ ...selectedMember, email: e.target.value })
                    }
                    placeholder="name@example.com"
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_phone">טלפון</Label>
                  <Input
                    id="edit_phone"
                    value={selectedMember.phone || ''}
                    onChange={(e) =>
                      setSelectedMember({ ...selectedMember, phone: e.target.value })
                    }
                    placeholder="050-000-0000"
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_address">כתובת</Label>
                  <Input
                    id="edit_address"
                    value={selectedMember.address || ''}
                    onChange={(e) =>
                      setSelectedMember({ ...selectedMember, address: e.target.value })
                    }
                    placeholder="רחוב ודירה"
                    className="h-11"
                  />
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditMemberDialogOpen(false)}
                  >
                    ביטול
                  </Button>
                  <Button type="submit" className="bg-blue-900 hover:bg-blue-800">
                    שמירת שינויים
                  </Button>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>

        {/* Add Charge Dialog */}
        <Dialog open={chargeDialogOpen} onOpenChange={setChargeDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>הוספת חיוב נוסף</DialogTitle>
            </DialogHeader>
            {selectedMember && (
              <form onSubmit={handleAddCharge} className="space-y-4 mt-4">
                <div className="p-3 bg-slate-50 rounded-lg">
                  <span className="text-sm text-slate-600">חבר: </span>
                  <span className="font-semibold text-slate-900">{selectedMember.full_name}</span>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="chargeType">סוג חיוב *</Label>
                  <Select value={chargeType} onValueChange={setChargeType}>
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard_donation">תרומה קבועה</SelectItem>
                      <SelectItem value="pay_off">פריסה (עד סגירת היתרה)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="chargeAmount">סכום *</Label>
                  <Input
                    id="chargeAmount"
                    type="number"
                    step="0.01"
                    value={chargeAmount}
                    onChange={(e) => setChargeAmount(e.target.value)}
                    placeholder="0.00"
                    required
                    className="h-11"
                  />
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setChargeDialogOpen(false)}
                  >
                    ביטול
                  </Button>
                  <Button type="submit" className="bg-blue-900 hover:bg-blue-800">
                    הוספת חיוב
                  </Button>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
