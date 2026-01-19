import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, DollarSign, TrendingUp, TrendingDown, Calendar, Receipt } from 'lucide-react';
import { Link } from 'react-router-dom';

const createPageUrl = (page) => {
  const [pageName, queryString] = page.split('?');
  return queryString ? `/${pageName}?${queryString}` : `/${pageName}`;
};

export default function Dashboard() {
  const { data: members = [] } = useQuery({
    queryKey: ['members'],
    queryFn: () => base44.entities.Member.list('-full_name', 1000),
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => base44.entities.Transaction.list('-date', 1000),
  });

  const { data: plans = [] } = useQuery({
    queryKey: ['membershipPlans'],
    queryFn: () => base44.entities.MembershipPlan.list('-created_date', 1),
  });

  // Calculate statistics
  const activeMembers = members.filter((m) => m.membership_active).length;
  const totalMembers = members.length;
  const totalOwed = members.reduce((sum, m) => sum + (m.total_owed || 0), 0);

  const thisMonth = new Date().toISOString().slice(0, 7);
  const thisMonthTransactions = transactions.filter((t) => t.date?.startsWith(thisMonth));
  const thisMonthCharges = thisMonthTransactions
    .filter((t) => t.type === 'charge')
    .reduce((sum, t) => sum + (t.amount || 0), 0);
  const thisMonthPayments = thisMonthTransactions
    .filter((t) => t.type === 'payment')
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  const allCharges = transactions
    .filter((t) => t.type === 'charge')
    .reduce((sum, t) => sum + (t.amount || 0), 0);
  const allPayments = transactions
    .filter((t) => t.type === 'payment')
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  const topOwingMembers = [...members]
    .filter((m) => (m.total_owed || 0) > 0)
    .sort((a, b) => (b.total_owed || 0) - (a.total_owed || 0))
    .slice(0, 5);

  const recentTransactions = transactions.slice(0, 10);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Dashboard</h1>
          <p className="text-slate-600">Overview of your synagogue membership and finances</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="border-slate-200 shadow-lg">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-600 mb-1">Active Members</div>
                  <div className="text-3xl font-bold text-slate-900">{activeMembers}</div>
                  <div className="text-xs text-slate-500 mt-1">of {totalMembers} total</div>
                </div>
                <Users className="w-10 h-10 text-blue-900" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-lg">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-600 mb-1">Total Owed</div>
                  <div className="text-3xl font-bold text-amber-600">${totalOwed.toFixed(2)}</div>
                  <div className="text-xs text-slate-500 mt-1">Outstanding balance</div>
                </div>
                <DollarSign className="w-10 h-10 text-amber-600" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-lg">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-600 mb-1">This Month Charges</div>
                  <div className="text-3xl font-bold text-slate-900">
                    ${thisMonthCharges.toFixed(2)}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {thisMonthTransactions.filter((t) => t.type === 'charge').length} transactions
                  </div>
                </div>
                <TrendingUp className="w-10 h-10 text-red-600" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-lg">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-600 mb-1">This Month Payments</div>
                  <div className="text-3xl font-bold text-slate-900">
                    ${thisMonthPayments.toFixed(2)}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {thisMonthTransactions.filter((t) => t.type === 'payment').length} transactions
                  </div>
                </div>
                <TrendingDown className="w-10 h-10 text-green-600" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Owing Members */}
          <Card className="border-slate-200 shadow-lg">
            <CardHeader className="border-b border-slate-200 bg-slate-50">
              <CardTitle className="text-lg">Top 5 Members with Outstanding Balances</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {topOwingMembers.length === 0 ? (
                <div className="p-8 text-center text-slate-500">No outstanding balances</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {topOwingMembers.map((member) => (
                    <Link
                      key={member.id}
                      to={createPageUrl(`MemberDetail?id=${member.id}`)}
                      className="flex items-center justify-between p-4 hover:bg-blue-50 transition-colors"
                    >
                      <div>
                        <div className="font-semibold text-slate-900">{member.full_name}</div>
                        {member.email && (
                          <div className="text-sm text-slate-500">{member.email}</div>
                        )}
                      </div>
                      <div className="text-lg font-bold text-amber-600">
                        ${(member.total_owed || 0).toFixed(2)}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Transactions */}
          <Card className="border-slate-200 shadow-lg">
            <CardHeader className="border-b border-slate-200 bg-slate-50">
              <CardTitle className="text-lg">Recent Transactions</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {recentTransactions.length === 0 ? (
                <div className="p-8 text-center text-slate-500">No transactions yet</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {recentTransactions.map((transaction) => (
                    <div
                      key={transaction.id}
                      className="flex items-center justify-between p-4 hover:bg-blue-50 transition-colors"
                    >
                      <div className="flex-1">
                        <div className="font-semibold text-slate-900">
                          {transaction.member_name}
                        </div>
                        <div className="text-sm text-slate-600">{transaction.description}</div>
                        <div className="text-xs text-slate-500 mt-1">{transaction.date}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                            transaction.type === 'charge'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-green-100 text-green-800'
                          }`}
                        >
                          {transaction.type === 'charge' ? 'Charge' : 'Payment'}
                        </span>
                        <span
                          className={`text-lg font-bold ${
                            transaction.type === 'charge' ? 'text-amber-600' : 'text-green-600'
                          }`}
                        >
                          {transaction.type === 'charge' ? '+' : '-'}$
                          {transaction.amount.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Financial Overview */}
        <Card className="mt-6 border-slate-200 shadow-lg">
          <CardHeader className="border-b border-slate-200 bg-slate-50">
            <CardTitle className="text-lg">All-Time Financial Overview</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="flex items-center gap-4">
                <Receipt className="w-10 h-10 text-slate-500" />
                <div>
                  <div className="text-sm text-slate-600">Total Charges</div>
                  <div className="text-2xl font-bold text-slate-900">${allCharges.toFixed(2)}</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <DollarSign className="w-10 h-10 text-green-600" />
                <div>
                  <div className="text-sm text-slate-600">Total Payments</div>
                  <div className="text-2xl font-bold text-slate-900">${allPayments.toFixed(2)}</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <TrendingUp className="w-10 h-10 text-amber-600" />
                <div>
                  <div className="text-sm text-slate-600">Net Outstanding</div>
                  <div className="text-2xl font-bold text-amber-600">
                    ${(allCharges - allPayments).toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {plans[0] && (
          <Card className="mt-6 border-blue-200 bg-blue-50 shadow-lg">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <Calendar className="w-10 h-10 text-blue-900" />
                <div>
                  <div className="text-sm text-slate-600">Standard Monthly Membership</div>
                  <div className="text-2xl font-bold text-blue-900">
                    ${plans[0].standard_amount.toFixed(2)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
