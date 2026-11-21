import React, { useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckSquare,
  ClipboardCheck,
  FileText,
  GitBranch,
  LayoutDashboard,
  Mail,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  X,
} from 'lucide-react';
import type { DashboardMetrics } from '../../shared/types';

export interface NavCounts {
  conflicts: number;
  pendingReviews: number;
  overdue: number;
}

interface LayoutProps {
  currentPath: string;
  navigate: (path: string) => void;
  breadcrumb: string[];
  pageTitle: string;
  onNewMeeting: () => void;
  counts?: NavCounts;
  metrics?: DashboardMetrics | null;
  storageMode?: 'supabase' | 'local_fallback';
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { path: '/', label: 'Overview', icon: LayoutDashboard },
  { path: '/meetings', label: 'Meetings', icon: FileText },
  { path: '/decisions', label: 'Decisions', icon: GitBranch },
  { path: '/conflicts', label: 'Conflicts', icon: AlertTriangle, countKey: 'conflicts' as const },
  { path: '/review', label: 'Review & Post', icon: ClipboardCheck, countKey: 'pendingReviews' as const },
  { path: '/tasks', label: 'Tasks', icon: CheckSquare },
  { path: '/reminders', label: 'Reminders', icon: Bell, countKey: 'overdue' as const },
  { path: '/digests', label: 'Digests', icon: Mail },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export function Layout({
  currentPath,
  navigate,
  breadcrumb,
  pageTitle,
  onNewMeeting,
  counts,
  storageMode,
  children,
}: LayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (path: string) => {
    if (path === '/') return currentPath === '/';
    return currentPath === path || currentPath.startsWith(`${path}/`);
  };

  const handleNavClick = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  const renderSidebarContent = (isMobile: boolean) => (
    <div className="flex h-full flex-col bg-white border-r border-slate-200">
      {/* Brand header */}
      <div className="flex h-14 items-center justify-between px-4 border-b border-slate-200 shrink-0">
        {(!collapsed || isMobile) && (
          <button
            type="button"
            onClick={() => handleNavClick('/')}
            className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
          >
            Followthrough
          </button>
        )}
        {isMobile ? (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100 transition-colors"
          >
            {collapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        )}
      </div>

      {/* Workspace identity & primary action */}
      <div className="p-3 border-b border-slate-200 space-y-2.5 shrink-0">
        {(!collapsed || isMobile) && (
          <div className="px-1">
            <div className="text-xs font-semibold text-slate-900 truncate">
              Demo Workspace
            </div>
            <div className="text-xs text-slate-500 truncate">
              Sample Organization: Nova
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            setMobileOpen(false);
            onNewMeeting();
          }}
          className={`w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#1D4ED8] text-white text-xs font-medium hover:bg-[#1E40AF] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 ${
            collapsed && !isMobile ? 'h-9 px-0' : 'py-2 px-3'
          }`}
          title="Process Meeting"
        >
          <Plus className="w-3.5 h-3.5 shrink-0" />
          {(!collapsed || isMobile) && <span>New Meeting</span>}
        </button>
      </div>

      {/* Navigation links */}
      <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          const count = item.countKey && counts ? counts[item.countKey] : 0;

          return (
            <button
              key={item.path}
              type="button"
              onClick={() => handleNavClick(item.path)}
              title={collapsed && !isMobile ? item.label : undefined}
              className={`w-full flex items-center justify-between gap-2.5 rounded-lg text-sm transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                collapsed && !isMobile ? 'justify-center px-0 py-2.5' : 'px-3 py-2'
              } ${
                active
                  ? 'bg-slate-100 text-slate-900 font-semibold'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-medium'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 ${active ? 'text-[#1D4ED8]' : 'text-slate-400'}`}
                />
                {(!collapsed || isMobile) && <span className="truncate">{item.label}</span>}
              </span>
              {(!collapsed || isMobile) && count > 0 && (
                <span className="font-mono text-xs tabular-nums text-slate-600">{count}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Workspace status & user profile */}
      {(!collapsed || isMobile) && (
        <div className="p-3 border-t border-slate-200 space-y-2 shrink-0 text-xs">
          <div className="px-1 text-slate-500">
            <span>Shared Judge Access</span>
            <span aria-hidden="true"> · </span>
            <span className="text-slate-700 font-medium">
              {storageMode === 'supabase' ? 'Supabase DB' : 'Local Server DB'}
            </span>
          </div>
          <div className="flex items-center gap-2.5 px-1 pt-1">
            <div className="w-7 h-7 rounded-md bg-slate-900 text-white flex items-center justify-center text-xs font-semibold shrink-0">
              NV
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-900 truncate">Nova Workspace</div>
              <div className="text-[11px] text-slate-500 truncate">Public Evaluation Mode</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen flex bg-[#F8FAFC] text-slate-900">
      {/* Desktop collapsible sidebar */}
      <aside
        className={`hidden lg:block shrink-0 sticky top-0 h-screen transition-[width] duration-150 ${
          collapsed ? 'w-[68px]' : 'w-[252px]'
        }`}
      >
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile slide-over navigation */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-64 max-w-[80vw] h-full z-10">
            {renderSidebarContent(true)}
          </div>
        </div>
      )}

      {/* Main viewport */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar — single row, contextual breadcrumbs + 1 primary action */}
        <header className="h-14 sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200 px-4 lg:px-8 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-md hover:bg-slate-100"
            >
              <Menu className="w-5 h-5" />
            </button>
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm min-w-0">
              {breadcrumb.map((crumb, idx) => {
                const isLast = idx === breadcrumb.length - 1;
                return (
                  <React.Fragment key={`${crumb}-${idx}`}>
                    {idx > 0 && (
                      <span className="text-slate-300" aria-hidden="true">
                        /
                      </span>
                    )}
                    <span
                      className={`truncate ${
                        isLast ? 'font-semibold text-slate-900' : 'text-slate-500'
                      }`}
                    >
                      {crumb}
                    </span>
                  </React.Fragment>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <span className="hidden md:inline text-xs text-slate-500 whitespace-nowrap">
              Demo Workspace — Sample Organization: Nova
            </span>
            <button
              type="button"
              onClick={onNewMeeting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#1D4ED8] text-white px-3.5 py-2 text-xs font-medium hover:bg-[#1E40AF] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Process Meeting</span>
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 w-full max-w-[1320px] mx-auto px-4 lg:px-8 py-6">
          <h1 className="sr-only">{pageTitle}</h1>
          {children}
        </main>
      </div>
    </div>
  );
}
