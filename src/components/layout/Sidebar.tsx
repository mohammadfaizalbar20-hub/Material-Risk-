import React from 'react';
import { usePpic, AppMenu } from '../../context/PpicContext';
import {
  LayoutDashboard,
  FileSpreadsheet,
  Boxes,
  CalendarClock,
  ShieldAlert,
  Bot,
  Settings,
  X,
  Factory,
  ChevronRight,
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const {
    activeMenu,
    setActiveMenu,
    sidebarOpen,
    setSidebarOpen,
    productionSchedules,
    materialRiskAssessments,
  } = usePpic();

  const criticalCount = materialRiskAssessments.filter((r) => r.riskCategory === 'CRITICAL').length;

  const menuItems: Array<{
    id: AppMenu;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number | string;
    badgeVariant?: 'red' | 'blue' | 'amber';
  }> = [
    { id: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'Upload Excel', label: 'Upload Excel', icon: FileSpreadsheet },
    { id: 'Rekap Material', label: 'Master Data Material', icon: Boxes },
    {
      id: 'Penjadwalan Produksi',
      label: 'Penjadwalan Produksi',
      icon: CalendarClock,
      badge: productionSchedules.length,
      badgeVariant: 'blue',
    },
    {
      id: 'Material Risk Analysis',
      label: 'Material Risk Analysis',
      icon: ShieldAlert,
      badge: criticalCount > 0 ? `${criticalCount} Kritis` : undefined,
      badgeVariant: 'red',
    },
    { id: 'AI Assistant', label: 'AI Assistant', icon: Bot },
    { id: 'Pengaturan', label: 'Pengaturan', icon: Settings },
  ];

  return (
    <>
      {/* Backdrop overlay when sidebar is open on any screen size */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-xs transition-opacity duration-300"
          aria-hidden="true"
        />
      )}

      {/* Slide-out Sidebar Drawer with Glassmorphism Transparency */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 flex flex-col w-64 bg-slate-900/80 backdrop-blur-xl text-slate-100 border-r border-white/10 shadow-2xl transition-transform duration-300 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand / Logo Area with Semi-transparent Glass border */}
        <div className="flex items-center justify-between h-16 px-5 border-b border-white/10 bg-slate-950/40 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600 text-white shadow-xs">
              <Factory className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold tracking-tight text-white leading-tight">
                PPIC SYSTEM
              </div>
              <div className="text-[10px] text-slate-400 font-medium">
                Material & Risk Control
              </div>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Tutup menu sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation list */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <div className="px-3 pb-2 text-[10px] font-semibold text-slate-400/80 uppercase tracking-wider">
            Menu Operasional PPIC
          </div>

          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeMenu === item.id;

            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveMenu(item.id);
                  setSidebarOpen(false); // Clean dismiss
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-xs font-medium transition-all group cursor-pointer ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-md font-semibold'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={`w-4 h-4 transition-colors shrink-0 ${
                      isActive ? 'text-white' : 'text-slate-400 group-hover:text-blue-400'
                    }`}
                  />
                  <span className="truncate text-left">{item.label}</span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {item.badge !== undefined && (
                    <span
                      className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                        item.badgeVariant === 'red'
                          ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                          : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                  {isActive && <ChevronRight className="w-3.5 h-3.5 text-blue-200" />}
                </div>
              </button>
            );
          })}
        </nav>
      </aside>
    </>
  );
};
