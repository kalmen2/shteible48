import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { getUser } from '@/lib/auth';
import {
  Users,
  Receipt,
  Calendar,
  DollarSign,
  Mail,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
} from 'lucide-react';

const createPageUrl = (page) => {
  const [pageName, queryString] = page.split('?');
  return queryString ? `/${pageName}?${queryString}` : `/${pageName}`;
};

export default function Layout({ children, currentPageName }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [authUser, setAuthUser] = useState(getUser());
  const navigate = useNavigate();

  useEffect(() => {
    try {
      setIsCollapsed(localStorage.getItem('sidebar-collapsed') === 'true');
    } catch {
      setIsCollapsed(false);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('sidebar-collapsed', String(isCollapsed));
    } catch {
      // ignore
    }
  }, [isCollapsed]);

  useEffect(() => {
    setAuthUser(getUser());
  }, [currentPageName]);

  const navItems = [
    { name: 'Dashboard', icon: DollarSign, page: 'Dashboard' },
    { name: 'Members', icon: Users, page: 'Members' },
    { name: 'Guests', icon: Users, page: 'Guests' },
    { name: 'Calendar', icon: Calendar, page: 'Calendar' },
    { name: 'Months', icon: Receipt, page: 'Months' },
    { name: 'Emails', icon: Mail, page: 'EmailManagement' },
    { name: 'Settings', icon: Settings, page: 'Settings' },
  ];

  const sidebarWidth = isCollapsed ? 80 : 256;
  const role = String(authUser?.role || '').toLowerCase();
  const isScopedUser = role === 'member' || role === 'guest';
  const scopedNavItems = isScopedUser
    ? [
        {
          name: 'My Details',
          icon: Users,
          page:
            role === 'guest'
              ? `GuestDetail?id=${encodeURIComponent(String(authUser?.guest_id || ''))}`
              : `MemberDetail?id=${encodeURIComponent(String(authUser?.member_id || ''))}`,
        },
      ]
    : navItems;

  const handleLogout = async () => {
    await base44.auth.logout();
    navigate('/', { replace: true });
  };

  return (
    <div className="app-shell flex h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      {/* Left Sidebar */}
      <aside
        className="app-sidebar fixed inset-y-0 left-0 z-30 flex flex-col overflow-hidden border-r border-white/10 bg-gradient-to-b from-slate-950 via-blue-950 to-[#0b1936] text-slate-100 shadow-[0_20px_60px_rgba(2,6,23,0.55)] transition-[width] duration-300 ease-in-out"
        style={{ width: sidebarWidth }}
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="absolute bottom-[-160px] left-[-80px] h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_60%)]" />
        </div>

        {/* Logo/Header */}
        <div className="relative z-10 border-b border-white/10 p-4">
          <div className="flex items-start justify-between gap-2">
            <div
              className={`overflow-hidden transition-all duration-300 ${
                isCollapsed ? 'max-w-0 opacity-0' : 'max-w-xs opacity-100'
              }`}
            >
              <div className="rounded-2xl border border-white/15 bg-white/5 px-3 py-2 backdrop-blur-sm">
                <h1 className="text-xl font-bold tracking-tight text-white">Shtiebel 48</h1>
                <h2 className="text-base font-semibold text-cyan-100">Management</h2>
                <p className="mt-1 text-xs text-blue-100/80">Members & Billing System</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsCollapsed((prev) => !prev)}
              className="rounded-xl border border-white/15 bg-white/10 p-2 text-blue-50 transition-all hover:bg-white/20 hover:text-white"
              aria-label={isCollapsed ? 'Expand menu' : 'Collapse menu'}
              title={isCollapsed ? 'Expand menu' : 'Collapse menu'}
            >
              {isCollapsed ? (
                <ChevronRight className="w-5 h-5" />
              ) : (
                <ChevronLeft className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="relative z-10 flex-1 p-3">
          <div className="space-y-2">
            {scopedNavItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                currentPageName === item.page ||
                (isScopedUser &&
                  ((item.page.startsWith('MemberDetail') && currentPageName === 'MemberDetail') ||
                    (item.page.startsWith('GuestDetail') && currentPageName === 'GuestDetail')));
              return (
                <Link
                  key={item.page}
                  to={createPageUrl(item.page)}
                  title={isCollapsed ? item.name : undefined}
                  className={`group flex items-center rounded-lg transition-all duration-200 ${
                    isCollapsed ? 'justify-center px-2 py-3' : 'gap-3 px-4 py-3'
                  } ${
                    isActive
                      ? 'border border-cyan-200/30 bg-gradient-to-r from-cyan-300/20 via-sky-300/20 to-blue-400/25 text-white shadow-[0_8px_24px_rgba(59,130,246,0.35)]'
                      : 'border border-transparent text-blue-100/90 hover:border-white/15 hover:bg-white/10 hover:text-white'
                  } ${isCollapsed ? 'hover:scale-[1.03]' : 'hover:translate-x-1'}`}
                >
                  <Icon
                    className={`h-5 w-5 transition-transform duration-300 ${isActive ? 'scale-110 text-cyan-100' : 'group-hover:scale-105'}`}
                  />
                  <span
                    className={`font-medium transition-all duration-300 ${
                      isCollapsed ? 'max-w-0 opacity-0' : 'max-w-xs opacity-100'
                    }`}
                  >
                    {item.name}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="relative z-10 border-t border-white/10 p-3">
          <button
            type="button"
            onClick={handleLogout}
            className={`group flex w-full items-center rounded-xl border border-transparent text-blue-100/90 transition-all duration-200 hover:border-red-200/25 hover:bg-red-400/10 hover:text-white ${
              isCollapsed ? 'justify-center px-2 py-3' : 'gap-3 px-4 py-3'
            }`}
            title={isCollapsed ? 'Logout' : undefined}
          >
            <LogOut className="w-5 h-5 transition-transform duration-300 group-hover:scale-105" />
            <span
              className={`font-medium transition-all duration-300 ${
                isCollapsed ? 'max-w-0 opacity-0' : 'max-w-xs opacity-100'
              }`}
            >
              Logout
            </span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main
        className="app-main flex-1 h-screen overflow-y-auto transition-[margin] duration-300 ease-in-out"
        style={{ marginLeft: sidebarWidth }}
      >
        {children}
      </main>
    </div>
  );
}
