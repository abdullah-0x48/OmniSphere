import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  CalendarSync,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Cpu,
  FileCode2,
  LayoutDashboard,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Radio,
  Rocket,
  ScrollText,
  Settings,
  ShieldCheck,
  Sliders,
  SlidersHorizontal,
  Ticket,
  User as UserIcon,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ROLE_LABELS,
  ROLE_SHORT_LABELS,
  type RoleCode,
} from '../../shared/types.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import { GlobalDeviceSearch } from '../components/devices/GlobalDeviceSearch.tsx';
import { NotificationBell } from '../components/notifications/NotificationBell.tsx';
import { useToast } from '../components/ui/index.ts';

interface NavItem {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
}

function getNavForRole(role: RoleCode): NavItem[] {
  switch (role) {
    case 'PLATFORM_ADMIN':
      return [
        { label: 'Platform', to: '/platform', icon: Activity },
        { label: 'Tenants', to: '/tenants', icon: Building2 },
        { label: 'Provider Staff', to: '/staff', icon: Users },
        { label: 'Device Models', to: '/device-models', icon: Boxes },
        { label: 'Firmware', to: '/firmware', icon: FileCode2 },
        { label: 'Reports', to: '/reports', icon: BarChart3 },
        { label: 'Simulator', to: '/simulator', icon: Radio },
        { label: 'Audit Log', to: '/audit', icon: ScrollText },
        { label: 'Email Outbox', to: '/email-outbox', icon: Mail },
      ];
    case 'SUPPORT_ENGINEER':
      return [
        { label: 'NOC Overview', to: '/noc', icon: Radio },
        { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
        { label: 'Alerts', to: '/alerts', icon: Bell },
        { label: 'Alert Rules', to: '/alert-rules', icon: SlidersHorizontal },
        { label: 'Tickets', to: '/tickets', icon: Ticket },
        { label: 'Work Orders', to: '/work-orders', icon: Wrench },
        { label: 'Maintenance Plans', to: '/maintenance-plans', icon: CalendarSync },
        { label: 'Devices', to: '/devices', icon: Cpu },
        { label: 'Sites', to: '/sites', icon: MapPin },
        { label: 'Config Profiles', to: '/config-profiles', icon: Sliders },
        { label: 'Firmware', to: '/firmware', icon: FileCode2 },
        { label: 'Rollouts', to: '/rollouts', icon: Rocket },
        { label: 'Reports', to: '/reports', icon: BarChart3 },
        { label: 'Device Models', to: '/device-models', icon: Boxes },
        { label: 'Simulator', to: '/simulator', icon: Activity },
        { label: 'Email Outbox', to: '/email-outbox', icon: Mail },
      ];
    case 'FIELD_TECHNICIAN':
      return [
        { label: 'My Work Orders', to: '/my-work-orders', icon: ClipboardCheck },
        { label: 'Devices', to: '/devices', icon: Cpu },
        { label: 'Profile', to: '/profile', icon: UserIcon },
      ];
    case 'CLIENT_ADMIN':
      return [
        { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
        { label: 'Alerts', to: '/alerts', icon: Bell },
        { label: 'Alert Rules', to: '/alert-rules', icon: SlidersHorizontal },
        { label: 'Tickets', to: '/tickets', icon: Ticket },
        { label: 'Work Orders', to: '/work-orders', icon: Wrench },
        { label: 'Devices', to: '/devices', icon: Cpu },
        { label: 'Sites', to: '/sites', icon: MapPin },
        { label: 'Config Profiles', to: '/config-profiles', icon: Sliders },
        { label: 'Firmware', to: '/firmware', icon: FileCode2 },
        { label: 'Rollouts', to: '/rollouts', icon: Rocket },
        { label: 'Reports', to: '/reports', icon: BarChart3 },
        { label: 'Simulator', to: '/simulator', icon: Radio },
        { label: 'Users', to: '/users', icon: Users },
        { label: 'Settings', to: '/settings', icon: Settings },
        { label: 'Audit Log', to: '/audit', icon: ScrollText },
        { label: 'Email Outbox', to: '/email-outbox', icon: Mail },
      ];
    case 'CLIENT_MANAGER':
      return [
        { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
        { label: 'Approvals', to: '/approvals', icon: CheckSquare },
        { label: 'Alerts', to: '/alerts', icon: Bell },
        { label: 'Alert Rules', to: '/alert-rules', icon: SlidersHorizontal },
        { label: 'Tickets', to: '/tickets', icon: Ticket },
        { label: 'Work Orders', to: '/work-orders', icon: Wrench },
        { label: 'Devices', to: '/devices', icon: Cpu },
        { label: 'Sites', to: '/sites', icon: MapPin },
        { label: 'Config Profiles', to: '/config-profiles', icon: Sliders },
        { label: 'Firmware', to: '/firmware', icon: FileCode2 },
        { label: 'Rollouts', to: '/rollouts', icon: Rocket },
        { label: 'Reports', to: '/reports', icon: BarChart3 },
        { label: 'Profile', to: '/profile', icon: UserIcon },
      ];
    case 'CLIENT_OPERATOR':
      return [
        { label: 'Live Status', to: '/live-status', icon: Radio },
        { label: 'Alerts', to: '/alerts', icon: Bell },
        { label: 'Tickets', to: '/tickets', icon: Ticket },
        { label: 'Devices', to: '/devices', icon: Cpu },
        { label: 'Reports', to: '/reports', icon: BarChart3 },
        { label: 'Sites', to: '/sites', icon: MapPin },
        { label: 'Config Profiles', to: '/config-profiles', icon: Sliders },
        { label: 'Profile', to: '/profile', icon: UserIcon },
      ];
  }
}

export function AppShell() {
  const { user, tenants, activeTenantId, setActiveTenantId, logout } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMobileMenuOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  if (!user) return null;

  const navItems = getNavForRole(user.role);
  const useMobileBottomBar =
    user.role === 'FIELD_TECHNICIAN' || user.role === 'CLIENT_OPERATOR';

  const handleSignOut = async () => {
    await logout();
    toast({ kind: 'info', title: 'Signed out' });
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-3.5 focus:py-2 focus:rounded-lg focus:bg-indigo-600 focus:text-white focus:text-sm focus:font-medium focus:shadow-lg"
      >
        Skip to main content
      </a>
      {/* Desktop Sidebar */}
      <aside
        aria-label="Primary navigation"
        className={`hidden md:flex flex-col bg-slate-900 text-slate-100 shrink-0 transition-[width] duration-200 border-r border-slate-800 ${
          collapsed ? 'w-[72px]' : 'w-60'
        }`}
      >
        <div className="h-14 px-4 flex items-center justify-between border-b border-slate-800">
          <Link
            to={navItems[0]?.to ?? '/profile'}
            className="flex items-center gap-2.5 min-w-0"
          >
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4 text-white" aria-hidden="true" />
            </div>
            {!collapsed && (
              <span className="text-base font-semibold tracking-tight text-white truncate">
                OmniSphere
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        <nav className="flex-1 py-4 px-2.5 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800'
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-800">
          {!collapsed ? (
            <div className="px-2 py-1.5 text-xs text-slate-400">
              <p className="font-medium text-slate-200 truncate">{ROLE_LABELS[user.role]}</p>
              <p className="truncate mt-0.5">
                {user.tenantName ? `${user.tenantName} (${user.tenantCode})` : 'Service Provider'}
              </p>
            </div>
          ) : (
            <div
              className="text-center text-xs font-mono font-semibold text-slate-300 py-1"
              title={ROLE_LABELS[user.role]}
            >
              {ROLE_SHORT_LABELS[user.role]}
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Slide-Over Drawer for Admin/SE/CM roles */}
      {mobileMenuOpen && !useMobileBottomBar && (
        <div
          className="fixed inset-0 z-50 md:hidden flex bg-slate-900/50"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile navigation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMobileMenuOpen(false);
          }}
        >
          <div className="w-64 bg-slate-900 text-slate-100 h-full flex flex-col">
            <div className="h-14 px-4 flex items-center justify-between border-b border-slate-800">
              <span className="text-base font-semibold text-white">OmniSphere</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation"
                className="p-1.5 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                        isActive ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            {!useMobileBottomBar && (
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open menu"
                className="md:hidden inline-flex items-center justify-center min-h-[44px] min-w-[44px] -ml-2 rounded-lg text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <Menu className="w-5 h-5" />
              </button>
            )}
            <span className="md:hidden font-semibold text-slate-900 tracking-tight whitespace-nowrap">
              OmniSphere
            </span>
            {user.tenantName && (
              <div className="hidden lg:flex items-center gap-2 text-xs text-slate-500 min-w-0">
                <span className="font-mono font-semibold text-slate-700">{user.tenantCode}</span>
                <span aria-hidden="true">·</span>
                <span className="truncate">{user.tenantName}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Global Device Search (Section 10.1; roles with device access) */}
            {user.role !== 'PLATFORM_ADMIN' && <GlobalDeviceSearch />}

            {/* SE-only Tenant Switcher (Section 10.1) */}
            {user.role === 'SUPPORT_ENGINEER' && (
              <div className="flex items-center gap-2">
                <label htmlFor="se-tenant-switcher" className="hidden sm:inline text-xs font-medium text-slate-500">
                  Tenant
                </label>
                <select
                  id="se-tenant-switcher"
                  aria-label="Select working tenant"
                  value={activeTenantId ?? ''}
                  onChange={(e) => {
                    const nextId = e.target.value || null;
                    setActiveTenantId(nextId);
                    const picked = tenants.find((t) => t.id === nextId);
                    if (picked) {
                      toast({ kind: 'info', title: `Switched workspace to ${picked.name} (${picked.code})` });
                    }
                  }}
                  className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                >
                  {tenants.length === 0 ? (
                    <option value="">No assigned tenants</option>
                  ) : (
                    tenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.code} — {t.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
            )}

            {/* Notification Bell (all roles — Section 10.1) */}
            <NotificationBell />

            {/* User Menu */}
            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setUserMenuOpen((o) => !o)}
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
                aria-label={`Account menu for ${user.name}`}
                className="flex items-center gap-2 min-h-[44px] sm:min-h-[36px] px-2.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <span className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-800 text-xs font-semibold flex items-center justify-center shrink-0">
                  {user.name
                    .split(' ')
                    .map((p) => p[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
                <span className="hidden sm:block text-left leading-tight">
                  <span className="block text-xs font-semibold text-slate-800 max-w-[140px] truncate">
                    {user.name}
                  </span>
                  <span className="block text-[11px] text-slate-600">
                    {ROLE_SHORT_LABELS[user.role]}
                  </span>
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              </button>

              {userMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-1.5 w-56 rounded-xl bg-white border border-slate-200 shadow-lg py-1.5 z-40"
                >
                  <div className="px-3.5 py-2 border-b border-slate-100">
                    <p className="text-xs font-semibold text-slate-900 truncate">{user.name}</p>
                    <p className="text-xs text-slate-500 truncate">{user.email}</p>
                  </div>
                  <Link
                    role="menuitem"
                    to="/profile"
                    className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <UserIcon className="w-4 h-4 text-slate-400" />
                    Profile & Password
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void handleSignOut()}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-red-600 hover:bg-red-50 cursor-pointer text-left"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className={`flex-1 w-full max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 py-6 focus:outline-none ${
            useMobileBottomBar ? 'pb-20 md:pb-6' : ''
          }`}
        >
          <Outlet />
        </main>

        {/* Mobile Bottom Tab Bar for FT and CO (Section 10.1) */}
        {useMobileBottomBar && (
          <nav
            aria-label="Mobile navigation"
            className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 flex items-center justify-around h-16 px-1 z-30"
          >
            {navItems.slice(0, 5).map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex-1 min-w-0 min-h-[48px] flex flex-col items-center justify-center gap-0.5 px-1 py-1 text-[11px] font-medium rounded-lg transition-colors ${
                      isActive ? 'text-indigo-700 bg-indigo-50/60' : 'text-slate-600 hover:text-slate-900'
                    }`
                  }
                >
                  <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span className="truncate max-w-full">{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}
