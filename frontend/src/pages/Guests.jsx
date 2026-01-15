import React, { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Trash2, Calendar, UserPlus, Pencil, Printer } from "lucide-react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import GuestInvoiceTemplate from "../components/guests/GuestInvoiceTemplate";

const createPageUrl = (page) => {
  const [pageName, queryString] = page.split('?');
  return queryString ? `/${pageName}?${queryString}` : `/${pageName}`;
};

export default function Guests() {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("alpha"); // "alpha" or "balance"
  const [addGuestDialogOpen, setAddGuestDialogOpen] = useState(false);
  const [editGuestDialogOpen, setEditGuestDialogOpen] = useState(false);
  const [editingGuest, setEditingGuest] = useState(null);
  const [printGuest, setPrintGuest] = useState(null);
  const [selectedGuestIds, setSelectedGuestIds] = useState([]);
  const invoiceRef = useRef();
  
  const [newGuest, setNewGuest] = useState({
    full_name: "",
    email: "",
    phone: "",
    address: ""
  });

  const queryClient = useQueryClient();

  const { data: guests = [] } = useQuery({
    queryKey: ['guests'],
    queryFn: () => base44.entities.Guest.list('full_name', 1000),
  });

  const { data: guestTransactions = [] } = useQuery({
    queryKey: ['guestTransactions'],
    queryFn: () => base44.entities.GuestTransaction.listAll('-date'),
  });

  const filteredGuests = guests
    .filter(g => 
      g.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      g.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      g.phone?.includes(searchQuery)
    )
    .sort((a, b) => {
      if (sortBy === "balance") {
        return (b.total_owed || 0) - (a.total_owed || 0);
      }
      return (a.full_name || "").localeCompare(b.full_name || "");
    });

  const createGuestMutation = useMutation({
    mutationFn: (data) => base44.entities.Guest.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guests'] });
      setAddGuestDialogOpen(false);
      setNewGuest({ full_name: "", email: "", phone: "", address: "" });
    },
  });

  const updateGuestMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Guest.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guests'] });
      setEditGuestDialogOpen(false);
      setEditingGuest(null);
    },
  });

  const deleteGuestsMutation = useMutation({
    mutationFn: async (ids) => {
      for (const id of ids) {
        await base44.entities.Guest.delete(id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guests'] });
      setSelectedGuestIds([]);
    },
  });

  const handleAddGuest = (e) => {
    e.preventDefault();
    if (newGuest.full_name.trim()) {
      createGuestMutation.mutate({
        full_name: newGuest.full_name.trim(),
        email: newGuest.email.trim() || undefined,
        phone: newGuest.phone.trim() || undefined,
        address: newGuest.address.trim() || undefined
      });
    }
  };

  const handleEditGuest = (guest) => {
    setEditingGuest({ ...guest });
    setEditGuestDialogOpen(true);
  };

  const handleSaveGuestEdit = () => {
    if (editingGuest) {
      updateGuestMutation.mutate({
        id: editingGuest.id,
        data: {
          full_name: editingGuest.full_name,
          email: editingGuest.email || undefined,
          phone: editingGuest.phone || undefined,
          address: editingGuest.address || undefined,
          notes: editingGuest.notes || undefined
        }
      });
    }
  };

  const handlePrintInvoice = (guest) => {
    setPrintGuest(guest);
    setTimeout(() => {
      const printContent = invoiceRef.current;
      if (printContent) {
        const printWindow = window.open('', '', 'height=800,width=800');
        printWindow.document.write('<html><head><title>Guest Invoice - ' + guest.full_name + '</title>');
        printWindow.document.write('</head><body>');
        printWindow.document.write(printContent.innerHTML);
        printWindow.document.write('</body></html>');
        printWindow.document.close();
        printWindow.print();
      }
      setPrintGuest(null);
    }, 100);
  };

  const getGuestTransactions = (guestId) => {
    return guestTransactions.filter(t => t.guest_id === guestId);
  };

  const toggleGuestSelection = (id) => {
    setSelectedGuestIds((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  };

  const toggleAllGuests = (checked) => {
    if (!checked) {
      setSelectedGuestIds([]);
      return;
    }
    setSelectedGuestIds(filteredGuests.map((g) => g.id));
  };

  const handleDeleteSelected = () => {
    if (selectedGuestIds.length === 0) return;
    const ok = window.confirm(`Delete ${selectedGuestIds.length} guest(s)? This cannot be undone.`);
    if (!ok) return;
    deleteGuestsMutation.mutate(selectedGuestIds);
  };

  const handleDeleteGuest = (guest) => {
    const ok = window.confirm(`Delete ${guest.full_name || "this guest"}? This cannot be undone.`);
    if (!ok) return;
    deleteGuestsMutation.mutate([guest.id]);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header with Search and Add Button */}
        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h1 className="text-3xl font-bold text-slate-900">Guests / Old</h1>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search guests..."
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
            <Button
              variant="outline"
              disabled={selectedGuestIds.length === 0 || deleteGuestsMutation.isPending}
              onClick={handleDeleteSelected}
              className="border-red-200 text-red-700 hover:bg-red-50"
            >
              {deleteGuestsMutation.isPending
                ? "Deleting..."
                : `Delete Selected (${selectedGuestIds.length})`}
            </Button>
            <Dialog open={addGuestDialogOpen} onOpenChange={setAddGuestDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-blue-900 hover:bg-blue-800">
                  <UserPlus className="w-4 h-4 mr-2" />
                  Add Guest
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Guest</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleAddGuest} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="full_name">Full Name *</Label>
                    <Input
                      id="full_name"
                      value={newGuest.full_name}
                      onChange={(e) => setNewGuest({...newGuest, full_name: e.target.value})}
                      //placeholder="John Doe"
                      required
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={newGuest.email}
                      onChange={(e) => setNewGuest({...newGuest, email: e.target.value})}
                      //placeholder="john@example.com"
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      value={newGuest.phone}
                      onChange={(e) => setNewGuest({...newGuest, phone: e.target.value})}
                      //placeholder="123-456-7890"
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="address">Address</Label>
                    <Input
                      id="address"
                      value={newGuest.address}
                      onChange={(e) => setNewGuest({...newGuest, address: e.target.value})}
                      //placeholder="123 Main St"
                      className="h-11"
                    />
                  </div>
                  <div className="flex justify-end gap-3 pt-4">
                    <Button type="button" variant="outline" onClick={() => setAddGuestDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" className="bg-blue-900 hover:bg-blue-800">
                      Add Guest
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Guests List */}
        <Card className="border-slate-200 shadow-lg">
          <CardHeader className="border-b border-slate-200 bg-slate-50">
            <CardTitle>All Guests</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filteredGuests.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                {guests.length === 0 ? "No guests yet" : "No guests found matching your search"}
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
                            filteredGuests.length > 0 &&
                            selectedGuestIds.length === filteredGuests.length
                          }
                          onChange={(e) => toggleAllGuests(e.target.checked)}
                          className="w-4 h-4 text-blue-900 rounded border-slate-300"
                        />
                      </th>
                      <th className="text-left py-4 px-6 text-sm font-semibold text-slate-700">Guest</th>
                      <th className="text-right py-4 px-6 text-sm font-semibold text-slate-700">Balance Owed</th>
                      <th className="text-center py-4 px-6 text-sm font-semibold text-slate-700">Transactions</th>
                      <th className="text-center py-4 px-6 text-sm font-semibold text-slate-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredGuests.map((guest) => {
                      const transactions = getGuestTransactions(guest.id);
                      return (
                        <tr key={guest.id} className="hover:bg-blue-50/30 transition-colors">
                          <td className="py-4 px-6 align-top">
                            <input
                              type="checkbox"
                              checked={selectedGuestIds.includes(guest.id)}
                              onChange={() => toggleGuestSelection(guest.id)}
                              className="w-4 h-4 text-blue-900 rounded border-slate-300"
                            />
                          </td>
                          <td className="py-4 px-6">
                            <Link
                              to={createPageUrl(`GuestDetail?id=${guest.id}`)}
                              className="font-semibold text-blue-900 hover:text-blue-700"
                            >
                              {guest.full_name}
                            </Link>
                            {guest.email && <div className="text-sm text-slate-500">{guest.email}</div>}
                            {guest.phone && <div className="text-xs text-slate-400">{guest.phone}</div>}
                          </td>
                          <td className="py-4 px-6 text-right">
                            <span className={`text-lg font-bold ${
                              (guest.total_owed || 0) > 0 ? 'text-amber-600' : 'text-green-600'
                            }`}>
                              ${(guest.total_owed || 0).toFixed(2)}
                            </span>
                          </td>
                          <td className="py-4 px-6 text-center text-slate-600">
                            {transactions.length}
                          </td>
                          <td className="py-4 px-6 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleEditGuest(guest)}
                                className="h-8 w-8"
                                title="Edit guest"
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handlePrintInvoice(guest)}
                                className="h-8 w-8"
                                title="Print invoice"
                              >
                                <Printer className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteGuest(guest)}
                                className="h-8 w-8 text-red-600 hover:text-red-700"
                                title="Delete guest"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
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
      </div>

      {/* Edit Guest Dialog */}
      <Dialog open={editGuestDialogOpen} onOpenChange={setEditGuestDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Guest</DialogTitle>
          </DialogHeader>
          {editingGuest && (
            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Full Name *</Label>
                <Input
                  value={editingGuest.full_name}
                  onChange={(e) => setEditingGuest({...editingGuest, full_name: e.target.value})}
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={editingGuest.email || ""}
                  onChange={(e) => setEditingGuest({...editingGuest, email: e.target.value})}
                  placeholder="email@example.com"
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  value={editingGuest.phone || ""}
                  onChange={(e) => setEditingGuest({...editingGuest, phone: e.target.value})}
                  placeholder="123-456-7890"
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label>Address</Label>
                <Input
                  value={editingGuest.address || ""}
                  onChange={(e) => setEditingGuest({...editingGuest, address: e.target.value})}
                  placeholder="123 Main St"
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Input
                  value={editingGuest.notes || ""}
                  onChange={(e) => setEditingGuest({...editingGuest, notes: e.target.value})}
                  placeholder="Additional notes..."
                  className="h-11"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button variant="outline" onClick={() => setEditGuestDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSaveGuestEdit} className="bg-blue-900 hover:bg-blue-800">
                  Save Changes
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Hidden Invoice Template for Printing */}
      {printGuest && (
        <div style={{ display: 'none' }}>
          <GuestInvoiceTemplate
            ref={invoiceRef}
            guest={printGuest}
            transactions={getGuestTransactions(printGuest.id)}
            totalCharges={getGuestTransactions(printGuest.id).filter(t => t.type === 'charge').reduce((sum, t) => sum + (t.amount || 0), 0)}
            totalPayments={getGuestTransactions(printGuest.id).filter(t => t.type === 'payment').reduce((sum, t) => sum + (t.amount || 0), 0)}
          />
        </div>
      )}
    </div>
  );
}
