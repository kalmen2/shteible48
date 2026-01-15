
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users, Receipt, Calendar, DollarSign, Mail, Settings, ChevronLeft, ChevronRight } from "lucide-react";

const createPageUrl = (page) => {
  const [pageName, queryString] = page.split('?');
  return queryString ? `/${pageName}?${queryString}` : `/${pageName}`;
};

export default function Layout({ children, currentPageName }) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    try {
      setIsCollapsed(localStorage.getItem("sidebar-collapsed") === "true");
    } catch {
      setIsCollapsed(false);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("sidebar-collapsed", String(isCollapsed));
    } catch {
      // ignore
    }
  }, [isCollapsed]);

  const navItems = [
    { name: "Dashboard", icon: DollarSign, page: "Dashboard" },
    { name: "Members", icon: Users, page: "Members" },
    { name: "Guests / Old", icon: Users, page: "Guests" },
    { name: "Transactions", icon: Calendar, page: "Calendar" },
    { name: "Months", icon: Receipt, page: "Months" },
    { name: "Emails", icon: Mail, page: "EmailManagement" },
    { name: "Settings", icon: Settings, page: "Settings" }
  ];

  const sidebarWidth = isCollapsed ? 80 : 256;

  return (
    <div className="flex h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      {/* Left Sidebar */}
      <aside
        className="fixed inset-y-0 left-0 z-30 bg-blue-900/80 text-white shadow-xl flex flex-col transition-[width] duration-300 ease-in-out backdrop-blur-md"
        style={{ width: sidebarWidth }}
      >
        {/* Logo/Header */}
        <div className="p-4 border-b border-blue-800">
          <div className="flex items-start justify-between gap-2">
            <div
              className={`overflow-hidden transition-all duration-300 ${
                isCollapsed ? "max-w-0 opacity-0" : "max-w-xs opacity-100"
              }`}
            >
              <h1 className="text-xl font-bold">Shtiebel 48</h1>
              <h2 className="text-lg font-semibold text-blue-100">Manager</h2>
              <p className="text-xs text-blue-200 mt-1">Member & Billing System</p>
            </div>
            <button
              type="button"
              onClick={() => setIsCollapsed((prev) => !prev)}
              className="rounded-md p-2 text-blue-100 hover:bg-blue-800 hover:text-white transition-colors"
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {isCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
            </button>
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
                  title={isCollapsed ? item.name : undefined}
                  className={`group flex items-center rounded-lg transition-all duration-200 ${
                    isCollapsed ? "justify-center px-2 py-3" : "gap-3 px-4 py-3"
                  } ${
                    isActive
                      ? 'bg-blue-800/80 text-white shadow-lg ring-1 ring-white/10'
                      : 'text-blue-100 hover:bg-blue-800/50'
                  } ${isCollapsed ? "hover:scale-[1.03]" : "hover:translate-x-1"}`}
                >
                  <Icon
                    className={`w-5 h-5 transition-transform duration-300 ${isActive ? "scale-110" : "group-hover:scale-105"}`}
                  />
                  <span
                    className={`font-medium transition-all duration-300 ${
                      isCollapsed ? "max-w-0 opacity-0" : "max-w-xs opacity-100"
                    }`}
                  >
                    {item.name}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <main
        className="flex-1 h-screen overflow-y-auto transition-[margin] duration-300 ease-in-out"
        style={{ marginLeft: sidebarWidth }}
      >
        {children}
      </main>
    </div>
  );
}
