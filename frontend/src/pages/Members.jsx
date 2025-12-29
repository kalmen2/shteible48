import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, DollarSign, Settings, CreditCard, AlertCircle, Upload, Download, UserPlus, ChevronDown, FileSpreadsheet, Search, Pencil } from "lucide-react";
import { Link } from "react-router-dom";

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
    full_name: "",
    email: "",
    phone: "",
    address: ""
  });
  const [uploading, setUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [selectedMember, setSelectedMember] = useState(null);
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeType, setChargeType] = useState("standard_donation");
  // Stripe Checkout handles secure card entry.
  const [processing, setProcessing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("alpha"); // "alpha" or "balance"

  const queryClient = useQueryClient();

  const { data: members = [] } = useQuery({
    queryKey: ['members'],
    queryFn: () => base44.entities.Member.list('-full_name', 1000),
  });

  const filteredMembers = members
    .filter(m => 
      m.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.member_id?.includes(searchQuery)
    )
    .sort((a, b) => {
      if (sortBy === "balance") {
        return (b.total_owed || 0) - (a.total_owed || 0);
      }
      return (a.full_name || "").localeCompare(b.full_name || "");
    });

  const { data: plans = [] } = useQuery({
    queryKey: ['membershipPlans'],
    queryFn: () => base44.entities.MembershipPlan.list('-created_date', 1),
  });

  // Process monthly charges for active members on mount
  React.useEffect(() => {
    const processMonthlyCharges = async () => {
      const currentPlan = plans[0];
      if (!currentPlan) return;

      const today = new Date();
      const isFirstOfMonth = today.getDate() === 1;

      if (!isFirstOfMonth) return;

      // Check each active member
      for (const member of members) {
        if (!member.membership_active) continue;

        // Check if they already have a charge for this month
        const thisMonth = today.toISOString().slice(0, 7); // YYYY-MM
        const transactions = await base44.entities.Transaction.filter({
          member_id: member.id,
          type: "charge",
          description: "Monthly Membership"
        });

        const hasChargeThisMonth = transactions.some(t => 
          t.date && t.date.startsWith(thisMonth)
        );

        if (!hasChargeThisMonth) {
          // Add monthly charge
          const newBalance = (member.total_owed || 0) + currentPlan.standard_amount;
          await base44.entities.Member.update(member.id, { total_owed: newBalance });
          await base44.entities.Transaction.create({
            member_id: member.id,
            member_name: member.full_name,
            type: "charge",
            description: "Monthly Membership",
            amount: currentPlan.standard_amount,
            date: today.toISOString().split('T')[0]
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ['members'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    };

    if (members.length > 0 && plans.length > 0) {
      processMonthlyCharges();
    }
  }, [members, plans]);

  const { data: charges = [] } = useQuery({
    queryKey: ['membershipCharges'],
    queryFn: () => base44.entities.MembershipCharge.list('-created_date', 1000),
  });

  const { data: recurringPayments = [] } = useQuery({
    queryKey: ['recurringPayments'],
    queryFn: () => base44.entities.RecurringPayment.filter({ is_active: true }),
  });

  const currentPlan = plans[0];

  const createPlanMutation = useMutation({
    mutationFn: (planData) => base44.entities.MembershipPlan.create(planData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['membershipPlans'] });
      setPlanDialogOpen(false);
      setStandardAmount("");
    },
  });

  const createMemberMutation = useMutation({
    mutationFn: (memberData) => base44.entities.Member.create(memberData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members'] });
      setAddMemberDialogOpen(false);
      setNewMember({
        full_name: "",
        email: "",
        phone: "",
        address: ""
      });
    },
  });

  const updateMemberMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Member.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members'] });
      setEditMemberDialogOpen(false);
      setSelectedMember(null);
    },
  });

  const createChargeMutation = useMutation({
    mutationFn: (chargeData) => base44.entities.MembershipCharge.create(chargeData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['membershipCharges'] });
      setChargeDialogOpen(false);
      setSelectedMember(null);
      setChargeAmount("");
      setChargeType("standard_donation");
    },
  });

  const updateChargeMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.MembershipCharge.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['membershipCharges'] });
    },
  });

  const handleAddMember = (e) => {
    e.preventDefault();
    // Generate 6-digit member ID
    const member_id = Math.floor(100000 + Math.random() * 900000).toString();
    createMemberMutation.mutate({ ...newMember, member_id });
  };

  const handleDownloadTemplate = () => {
    const csvContent = "member_id,full_name,email,phone,address\n123456,John Doe,john@example.com,123-456-7890,123 Main St";
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'member_template.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!uploadFile) return;

    setUploading(true);
    try {
      // Upload file first
      const { file_url } = await base44.integrations.Core.UploadFile({ file: uploadFile });
      
      // Extract data from file
      const result = await base44.integrations.Core.ExtractDataFromUploadedFile({
        file_url: file_url,
        json_schema: {
          type: "object",
          properties: {
            members: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  member_id: { type: "string" },
                  full_name: { type: "string" },
                  email: { type: "string" },
                  phone: { type: "string" },
                  address: { type: "string" }
                }
              }
            }
          }
        }
      });

      if (result.status === "success" && result.output) {
        const membersData = result.output.members || result.output;
        await base44.entities.Member.bulkCreate(Array.isArray(membersData) ? membersData : [membersData]);
        queryClient.invalidateQueries({ queryKey: ['members'] });
        setUploadDialogOpen(false);
        setUploadFile(null);
      }
    } catch (error) {
      alert("Upload failed: " + error.message);
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
        is_active: true
      });
    }
  };

  const activateMembership = async (e) => {
    e.preventDefault();
    if (!selectedMember || !currentPlan?.standard_amount) return;
    setProcessing(true);
    try {
      const out = await base44.payments.createSubscriptionCheckout({
        memberId: selectedMember.id,
        paymentType: "membership",
        amountPerMonth: currentPlan.standard_amount,
        successPath: `/Members`,
        cancelPath: `/Members`,
      });
      if (out?.url) window.location.href = out.url;
    } finally {
      setProcessing(false);
    }
  };

  const deactivateMembership = (member) => {
    updateMemberMutation.mutate({
      id: member.id,
      data: { membership_active: false }
    });
    setDeactivateDialogOpen(false);
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
    updateMemberMutation.mutate({
      id: selectedMember.id,
      data: {
        full_name: selectedMember.full_name,
        email: selectedMember.email || undefined,
        phone: selectedMember.phone || undefined,
        address: selectedMember.address || undefined
      }
    });
  };

  const getMemberCharges = (memberId) => {
    return charges.filter(c => c.member_id === memberId && c.is_active);
  };

  const getMemberRecurringPayments = (memberId) => {
    return recurringPayments.filter(p => p.member_id === memberId && p.is_active);
  };

  const getMemberTotalMonthly = (memberId) => {
    const standardAmount = currentPlan?.standard_amount || 0;
    const memberCharges = getMemberCharges(memberId);
    const memberRecurring = getMemberRecurringPayments(memberId);
    
    const chargesTotal = memberCharges.reduce((sum, c) => sum + (c.amount || 0), 0);
    const recurringTotal = memberRecurring.reduce((sum, p) => sum + (p.amount_per_month || 0), 0);
    
    return standardAmount + chargesTotal + recurringTotal;
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
                      Upload a CSV or Excel file with columns: member_id, full_name, email, phone, address
                    </p>
                  </div>
                  <div className="flex justify-end gap-3 pt-4">
                    <Button type="button" variant="outline" onClick={() => setUploadDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" className="bg-blue-900 hover:bg-blue-800" disabled={uploading}>
                      {uploading ? "Uploading..." : "Upload Members"}
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
                    A unique 6-digit member ID will be automatically generated
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="full_name">Full Name *</Label>
                    <Input
                      id="full_name"
                      value={newMember.full_name}
                      onChange={(e) => setNewMember({...newMember, full_name: e.target.value})}
                      placeholder="John Doe"
                      required
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={newMember.email}
                      onChange={(e) => setNewMember({...newMember, email: e.target.value})}
                      placeholder="john@example.com"
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      value={newMember.phone}
                      onChange={(e) => setNewMember({...newMember, phone: e.target.value})}
                      placeholder="123-456-7890"
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="address">Address</Label>
                    <Input
                      id="address"
                      value={newMember.address}
                      onChange={(e) => setNewMember({...newMember, address: e.target.value})}
                      placeholder="123 Main St"
                      className="h-11"
                    />
                  </div>
                  <div className="flex justify-end gap-3 pt-4">
                    <Button type="button" variant="outline" onClick={() => setAddMemberDialogOpen(false)}>
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
            <CardTitle>Members & Charges</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filteredMembers.length === 0 ? (
                                <div className="p-12 text-center text-slate-500">
                                  {members.length === 0 ? "No members yet" : "No members found matching your search"}
                                </div>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="w-full">
                                    <thead className="bg-slate-50 border-b border-slate-200">
                                      <tr>
                                        <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">Member</th>
                                        <th className="text-center py-4 px-6 text-sm font-semibold text-slate-700">Status</th>
                                        <th className="text-right py-4 px-6 text-sm font-semibold text-slate-700">Standard Amount</th>
                                        <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">Additional Charges</th>
                                        <th className="text-right py-4 px-6 text-sm font-semibold text-slate-700">Total Monthly</th>
                                        <th className="text-right py-4 px-6 text-sm font-semibold text-slate-700">Balance Owed</th>
                                        <th className="text-center py-4 px-6 text-sm font-semibold text-slate-700">Actions</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {filteredMembers.map((member) => {
                      const memberCharges = getMemberCharges(member.id);
                      const memberRecurring = getMemberRecurringPayments(member.id);
                      const totalMonthly = getMemberTotalMonthly(member.id);
                      return (
                        <tr key={member.id} className="hover:bg-blue-50/30 transition-colors">
                          <td className="py-4 px-6">
                            <Link
                              to={createPageUrl(`MemberDetail?id=${member.id}`)}
                              className="font-semibold text-blue-900 hover:text-blue-700"
                            >
                              {member.full_name}
                            </Link>
                            {member.member_id && <div className="text-xs text-slate-500 font-mono">ID: {member.member_id}</div>}
                            {member.email && <div className="text-sm text-slate-500">{member.email}</div>}
                          </td>
                          <td className="py-4 px-6 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <div className={`w-3 h-3 rounded-full ${
                                member.membership_active ? 'bg-green-500' : 'bg-red-500'
                              }`}></div>
                              <span className={`text-sm font-medium ${
                                member.membership_active ? 'text-green-600' : 'text-red-600'
                              }`}>
                                {member.membership_active ? 'Active' : 'Inactive'}
                              </span>
                            </div>
                          </td>
                          <td className="py-4 px-6 text-right">
                            {currentPlan ? (
                              <span className="text-lg font-bold text-slate-900">
                                ${currentPlan.standard_amount.toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-sm text-slate-500">No plan set</span>
                            )}
                          </td>
                          <td className="py-4 px-6">
                            {(memberCharges.length > 0 || memberRecurring.length > 0) ? (
                              <div className="space-y-1">
                                {memberCharges.map((charge) => (
                                  <div key={charge.id} className="flex items-center gap-2">
                                    <span className="text-sm px-2 py-1 bg-amber-100 text-amber-800 rounded">
                                      {charge.charge_type === 'standard_donation' ? 'Donation' : 'Pay Off'}
                                    </span>
                                    <span className="text-sm font-medium">${charge.amount.toFixed(2)}</span>
                                    <button
                                      onClick={() => updateChargeMutation.mutate({ id: charge.id, data: { is_active: false } })}
                                      className="text-xs text-red-600 hover:text-red-800"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                ))}
                                {memberRecurring.map((payment) => (
                                  <div key={payment.id} className="flex items-center gap-2">
                                    <span className="text-sm px-2 py-1 bg-blue-100 text-blue-800 rounded">
                                      {payment.payment_type === 'additional_monthly' ? 'Donation' : 'Payoff'}
                                    </span>
                                    <span className="text-sm font-medium">${payment.amount_per_month.toFixed(2)}</span>
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
                            <div className={`text-lg font-bold ${
                              (member.total_owed || 0) > 0 ? 'text-amber-600' : 'text-green-600'
                            }`}>
                              ${(member.total_owed || 0).toFixed(2)}
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
                              {!member.membership_active ? (
                                <Button
                                  size="sm"
                                  className="bg-green-600 hover:bg-green-700"
                                  onClick={() => openPaymentDialog(member)}
                                >
                                  <Plus className="w-4 h-4 mr-1" />
                                  Add Membership
                                </Button>
                              ) : (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-red-600 text-red-600 hover:bg-red-50"
                                    onClick={() => openDeactivateDialog(member)}
                                  >
                                    Remove
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
                                    Add Charge
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
                Add Payment Method
              </DialogTitle>
            </DialogHeader>
            {selectedMember && (
              <form onSubmit={activateMembership} className="space-y-4 mt-4">
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="text-sm text-slate-600 mb-1">Activating membership for:</div>
                  <div className="font-semibold text-slate-900">{selectedMember.full_name}</div>
                  {currentPlan && (
                    <div className="text-sm text-slate-600 mt-2">
                      Monthly Amount: <span className="font-semibold">${currentPlan.standard_amount.toFixed(2)}</span>
                    </div>
                  )}
                </div>
                
                <div className="text-sm text-slate-600">
                  You’ll enter payment details securely in Stripe Checkout.
                </div>
                
                <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setPaymentDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    className="bg-green-600 hover:bg-green-700"
                    disabled={processing}
                  >
                    {processing ? "Processing..." : "Activate Membership"}
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
                Deactivate Membership
              </DialogTitle>
            </DialogHeader>
            {selectedMember && (
              <div className="space-y-4 mt-4">
                <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
                  <p className="text-sm text-slate-700 mb-2">
                    Are you sure you want to deactivate membership for <span className="font-semibold">{selectedMember.full_name}</span>?
                  </p>
                  <p className="text-sm text-amber-700 font-medium">
                    Note: The membership will remain active until the end of this month.
                  </p>
                </div>
                
                <div className="flex justify-end gap-3">
                  <Button variant="outline" onClick={() => setDeactivateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button 
                    className="bg-red-600 hover:bg-red-700"
                    onClick={() => deactivateMembership(selectedMember)}
                  >
                    Deactivate
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
              <DialogTitle>Edit Member</DialogTitle>
            </DialogHeader>
            {selectedMember && (
              <form onSubmit={handleSaveEdit} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="edit_name">Full Name *</Label>
                  <Input
                    id="edit_name"
                    value={selectedMember.full_name}
                    onChange={(e) => setSelectedMember({...selectedMember, full_name: e.target.value})}
                    required
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_email">Email</Label>
                  <Input
                    id="edit_email"
                    type="email"
                    value={selectedMember.email || ""}
                    onChange={(e) => setSelectedMember({...selectedMember, email: e.target.value})}
                    placeholder="john@example.com"
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_phone">Phone</Label>
                  <Input
                    id="edit_phone"
                    value={selectedMember.phone || ""}
                    onChange={(e) => setSelectedMember({...selectedMember, phone: e.target.value})}
                    placeholder="123-456-7890"
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_address">Address</Label>
                  <Input
                    id="edit_address"
                    value={selectedMember.address || ""}
                    onChange={(e) => setSelectedMember({...selectedMember, address: e.target.value})}
                    placeholder="123 Main St"
                    className="h-11"
                  />
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setEditMemberDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" className="bg-blue-900 hover:bg-blue-800">
                    Save Changes
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
              <DialogTitle>Add Additional Charge</DialogTitle>
            </DialogHeader>
            {selectedMember && (
              <form onSubmit={handleAddCharge} className="space-y-4 mt-4">
                <div className="p-3 bg-slate-50 rounded-lg">
                  <span className="text-sm text-slate-600">Member: </span>
                  <span className="font-semibold text-slate-900">{selectedMember.full_name}</span>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="chargeType">Charge Type *</Label>
                  <Select value={chargeType} onValueChange={setChargeType}>
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard_donation">Standard Donation</SelectItem>
                      <SelectItem value="pay_off">Pay Off (Until Balance Clear)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="chargeAmount">Amount *</Label>
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
                  <Button type="button" variant="outline" onClick={() => setChargeDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" className="bg-blue-900 hover:bg-blue-800">
                    Add Charge
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