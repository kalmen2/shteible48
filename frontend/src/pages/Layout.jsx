
import React from "react";
import { Link } from "react-router-dom";
import { Users, Receipt, Calendar, DollarSign, FileText, Mail, Settings } from "lucide-react";

const createPageUrl = (page) => {
  const [pageName, queryString] = page.split('?');
  return queryString ? `/${pageName}?${queryString}` : `/${pageName}`;
};

export default function Layout({ children, currentPageName }) {
  const navItems = [
    { name: "Dashboard", icon: DollarSign, page: "Dashboard" },
    { name: "Members", icon: Users, page: "Members" },
    { name: "Guests / Old", icon: Users, page: "Guests" },
    { name: "Transactions", icon: Calendar, page: "Calendar" },
    { name: "Months", icon: Receipt, page: "Months" },
    { name: "Emails", icon: Mail, page: "EmailManagement" },
    { name: "Settings", icon: Settings, page: "Settings" }
  ];

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      {/* Left Sidebar */}
      <aside className="w-64 bg-blue-900 text-white shadow-xl flex flex-col fixed h-screen">
        {/* Logo/Header */}
        <div className="p-6 border-b border-blue-800">
          <div>
            <h1 className="text-xl font-bold">Shtiebel 48</h1>
            <h2 className="text-lg font-semibold text-blue-100">Manager</h2>
            <p className="text-xs text-blue-200 mt-1">Member & Billing System</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4">
          <div className="space-y-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentPageName === item.page;
              return (
                <Link
                  key={item.page}
                  to={createPageUrl(item.page)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                    isActive
                      ? 'bg-blue-800 text-white shadow-lg'
                      : 'text-blue-100 hover:bg-blue-800/50'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-medium">{item.name}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto ml-64">{children}</main>
    </div>
  );
}
