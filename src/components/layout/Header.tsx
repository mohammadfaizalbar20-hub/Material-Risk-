import React, { useState, useRef, useEffect } from 'react';
import { usePpic } from '../../context/PpicContext';
import {
  Menu,
  Bell,
  Search,
  Calendar,
  CheckCheck,
  AlertTriangle,
  Flame,
  Info,
  X,
  ExternalLink,
} from 'lucide-react';

export const Header: React.FC = () => {
  const {
    activeMenu,
    setActiveMenu,
    toggleSidebar,
    notifications,
    markNotificationAsRead,
    clearAllNotifications,
    activeSearchQuery,
    setActiveSearchQuery,
    registeredOrNumbers,
    searchRegisteredOrs,
    getOrSummary,
  } = usePpic();

  const [notifOpen, setNotifOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Format today's date in Indonesian
  const todayFormatted = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  // Close popovers on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setSearchFocused(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Matched ORs based on search query or top registered ORs
  const matchedOrs = activeSearchQuery.trim()
    ? searchRegisteredOrs(activeSearchQuery)
    : registeredOrNumbers.slice(0, 5);

  const handleSelectOr = (orNumber: string, targetMenu?: 'Rekap Material' | 'Material Risk Analysis' | 'Penjadwalan Produksi') => {
    setActiveSearchQuery(orNumber);
    setSearchFocused(false);
    if (targetMenu) {
      setActiveMenu(targetMenu);
    }
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-4 md:px-6 bg-white border-b border-slate-200">
      {/* Left: Universal Hamburger Button & Page Breadcrumb */}
      <div className="flex items-center gap-3 md:gap-4">
        <button
          onClick={toggleSidebar}
          className="p-2 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors flex items-center gap-2 text-xs font-semibold"
          title="Buka Menu Navigasi"
          aria-label="Buka menu navigasi PPIC"
        >
          <Menu className="w-5 h-5 text-slate-800" />
          <span className="hidden sm:inline text-xs text-slate-700 font-medium">Menu</span>
        </button>

        <div>
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span>PPIC Material System</span>
            <span>/</span>
            <span className="font-semibold text-blue-700">
              {activeMenu === 'Rekap Material' ? 'Master Data Material' : activeMenu}
            </span>
          </div>
          <h1 className="text-sm md:text-base font-bold text-slate-900 leading-tight">
            {activeMenu === 'Rekap Material' ? 'Master Data Material' : activeMenu}
          </h1>
        </div>
      </div>

      {/* Middle: Global Search (Single Source of Truth from Upload Excel) */}
      <div className="hidden md:flex items-center flex-1 max-w-md mx-6" ref={searchRef}>
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Cari Nomor OR (contoh: OR-2026), Style, atau Kode Material..."
            value={activeSearchQuery}
            onFocus={() => setSearchFocused(true)}
            onChange={(e) => {
              setActiveSearchQuery(e.target.value);
              setSearchFocused(true);
            }}
            className="w-full pl-9 pr-8 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-hidden focus:ring-1 focus:ring-blue-500 focus:bg-white transition-all text-slate-800 placeholder-slate-400"
          />
          {activeSearchQuery && (
            <button
              onClick={() => {
                setActiveSearchQuery('');
                setSearchFocused(false);
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              aria-label="Hapus pencarian"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Autocomplete / Quick Search Dropdown */}
          {searchFocused && (
            <div className="absolute left-0 right-0 top-full mt-1.5 bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[11px] text-slate-600">
                <span className="font-semibold text-slate-800">
                  {activeSearchQuery.trim()
                    ? `Hasil Pencarian OR (${matchedOrs.length})`
                    : `Nomor OR Terdaftar (${registeredOrNumbers.length})`}
                </span>
                <span className="text-[10px] text-blue-600 font-medium">Single Source: Upload Excel</span>
              </div>

              {registeredOrNumbers.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">
                  Belum ada Nomor OR
                </div>
              ) : matchedOrs.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">
                  Tidak ada Nomor OR terdaftar yang cocok dengan &ldquo;{activeSearchQuery}&rdquo;.
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                  {matchedOrs.map((or) => {
                    const summary = getOrSummary(or);
                    return (
                      <div
                        key={or}
                        className="p-2.5 hover:bg-slate-50 transition-colors flex items-center justify-between gap-3 text-xs"
                      >
                        <div
                          className="flex-1 cursor-pointer"
                          onClick={() => handleSelectOr(or, 'Rekap Material')}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded text-[11px] border border-blue-200">
                              {or}
                            </span>
                            {summary?.style && (
                              <span className="text-slate-800 font-medium truncate max-w-xs">
                                {summary.style}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-1">
                            {summary?.requirements?.length ? (
                              <span>{summary.requirements.length} item material</span>
                            ) : null}
                            {summary?.latestUpdateDate ? (
                              <span>Update: {summary.latestUpdateDate}</span>
                            ) : null}
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleSelectOr(or, 'Rekap Material')}
                            className="px-2 py-1 text-[10px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 transition-colors"
                            title="Buka di Master Data Material"
                          >
                            Master Data
                          </button>
                          <button
                            onClick={() => handleSelectOr(or, 'Material Risk Analysis')}
                            className="px-2 py-1 text-[10px] font-semibold text-red-700 bg-red-50 hover:bg-red-100 rounded border border-red-200 transition-colors"
                            title="Buka di Material Risk Analysis"
                          >
                            Risk
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: Date info & Notification */}
      <div className="flex items-center gap-3">
        {/* Date Badge */}
        <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-600">
          <Calendar className="w-3.5 h-3.5 text-slate-500" />
          <span className="font-medium">{todayFormatted}</span>
        </div>

        {/* Notification Bell */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifOpen(!notifOpen)}
            className="relative p-2 text-slate-600 rounded-md hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Notifikasi PPIC"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 flex items-center justify-center w-4 h-4 text-[10px] font-bold text-white bg-red-600 rounded-full">
                {unreadCount}
              </span>
            )}
          </button>

          {/* Notification Dropdown Menu */}
          {notifOpen && (
            <div className="absolute right-0 mt-2 w-80 md:w-96 bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden z-50">
              <div className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-blue-400" />
                  <span className="text-xs font-semibold">Notifikasi & Peringatan PPIC</span>
                </div>
                {unreadCount > 0 && (
                  <button
                    onClick={clearAllNotifications}
                    className="flex items-center gap-1 text-[11px] text-blue-300 hover:text-white"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    Tandai Semua Selesai
                  </button>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                {notifications.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    Tidak ada notifikasi aktif. Seluruh material dalam status terkendali.
                  </div>
                ) : (
                  notifications.map((notif) => {
                    return (
                      <div
                        key={notif.id}
                        className={`p-3.5 hover:bg-slate-50 transition-colors ${
                          !notif.read ? 'bg-blue-50/40' : ''
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          {notif.type === 'critical' ? (
                            <Flame className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                          ) : notif.type === 'warning' ? (
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          ) : (
                            <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1">
                              <p className="text-xs font-semibold text-slate-900 truncate">
                                {notif.title}
                              </p>
                              <span className="text-[10px] text-slate-400 shrink-0">
                                {notif.timestamp}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">
                              {notif.message}
                            </p>
                            <div className="mt-2 flex items-center justify-between">
                              <button
                                onClick={() => {
                                  setActiveMenu('Material Risk Analysis');
                                  markNotificationAsRead(notif.id);
                                  setNotifOpen(false);
                                }}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800"
                              >
                                Tinjau Risiko <ExternalLink className="w-3 h-3" />
                              </button>
                              {!notif.read && (
                                <button
                                  onClick={() => markNotificationAsRead(notif.id)}
                                  className="text-[10px] text-slate-400 hover:text-slate-600"
                                >
                                  Tandai dibaca
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="p-2.5 bg-slate-50 border-t border-slate-200 text-center">
                <button
                  onClick={() => {
                    setActiveMenu('Material Risk Analysis');
                    setNotifOpen(false);
                  }}
                  className="w-full py-1 text-xs font-medium text-slate-700 hover:text-blue-600"
                >
                  Buka Matriks Analisis Risiko Lengkap →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
