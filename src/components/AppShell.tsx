import {
  Archive,
  Award,
  Calendar,
  Clock,
  FileSpreadsheet,
  Megaphone,
  SlidersHorizontal,
  Smartphone,
  Trophy,
} from 'lucide-react';
import { memo, ReactNode, useEffect, useRef } from 'react';
import { formatDateDDMMYYYY } from '../engine/calculations';
import { SheetTab } from '../types/ledger';
import { AppSounds } from '../utils/sound';
import { AuroraLiveBackdrop } from './AuroraLiveBackdrop';

interface AppShellProps {
  activeTab: SheetTab;
  onSelectTab: (tab: SheetTab) => void;
  billingDate: string;
  onChangeBillingDate: (newDate: string) => void;
  onOpenSettings: () => void;
  onOpenSellerIds: () => void;
  onOpenGoogleSheets?: () => void;
  onOpenAnnouncement?: () => void;
  announcementActive?: boolean;
  googleSheetsActive?: boolean;
  cloudConnected: boolean;
  soundEnabled: boolean;
  onToggleSound: () => void;
  counts: {
    sellers: number;
    overLimit1PM: number;
    overLimit6PM: number;
    overLimit8PM: number;
    prizes: number;
    limitPrizes: number;
    archives: number;
  };
  children: ReactNode;
}

interface NavItemDef {
  id: SheetTab;
  label: string;
  shortLabel: string;
  icon: typeof FileSpreadsheet;
}

const NAV_ITEMS: NavItemDef[] = [
  { id: 'Seller Bill', label: 'Seller Bill', shortLabel: 'Bill', icon: FileSpreadsheet },
  { id: '1PM', label: '1PM Morning', shortLabel: '1PM', icon: Clock },
  { id: '6PM', label: '6PM Day', shortLabel: '6PM', icon: Clock },
  { id: '8PM', label: '8PM Evening', shortLabel: '8PM', icon: Clock },
  { id: 'Winning Number', label: 'Winning Number', shortLabel: 'Win', icon: Trophy },
  { id: 'Prize List', label: 'Prize & Limit', shortLabel: 'Prize', icon: Award },
  { id: 'Archive', label: 'Archive', shortLabel: 'Archive', icon: Archive },
];

export const AppShell = memo(function AppShell({
  activeTab,
  onSelectTab,
  billingDate,
  onChangeBillingDate,
  onOpenSettings,
  onOpenSellerIds,
  onOpenGoogleSheets,
  onOpenAnnouncement,
  announcementActive = false,
  googleSheetsActive = false,
  cloudConnected,
  counts,
  children,
}: AppShellProps) {
  const getCountLabel = (tab: SheetTab): string | null => {
    if (tab === 'Seller Bill') return String(counts.sellers);
    if (tab === '1PM' && counts.overLimit1PM > 0) return `L:${counts.overLimit1PM}`;
    if (tab === '6PM' && counts.overLimit6PM > 0) return `L:${counts.overLimit6PM}`;
    if (tab === '8PM' && counts.overLimit8PM > 0) return `L:${counts.overLimit8PM}`;
    if (tab === 'Prize List' && counts.prizes + counts.limitPrizes > 0) {
      return counts.limitPrizes > 0
        ? `${counts.prizes}·L${counts.limitPrizes}`
        : String(counts.prizes);
    }
    if (tab === 'Archive' && counts.archives > 0) return String(counts.archives);
    return null;
  };

  const scrollRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  const handleNavClick = (tab: SheetTab) => {
    if (tab === activeTab) return;
    AppSounds.tap();
    onSelectTab(tab);
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-[var(--kk-canvas)] kk-app-canvas text-slate-950 dark:text-slate-100 flex">
      <AuroraLiveBackdrop />
      {/* Desktop Left Sidebar */}
      <aside className="relative z-10 hidden lg:flex lg:flex-col w-60 shrink-0 kk-brand-gradient kk-header-bar text-white border-r border-black/15 dark:border-slate-700/40 h-full">
        <div className="px-4 h-16 flex items-center justify-between border-b border-white/12">
          <button
            type="button"
            onClick={() => handleNavClick('Seller Bill')}
            className="flex items-center gap-2.5 text-left cursor-pointer group min-w-0"
          >
            <img
              src="/kk-logo.png"
              alt="KK Agency"
              referrerPolicy="no-referrer"
              decoding="async"
              className="w-9 h-9 rounded-xl object-cover shadow-md ring-1 ring-white/30 shrink-0"
            />
            <div className="text-lg font-black tracking-tight text-white truncate group-hover:opacity-90">
              KK Agency
            </div>
            <span className="kk-kali-emblem w-10 h-10 shrink-0" aria-hidden="true">
              <span className="kk-kali-aura" />
              <span className="kk-kali-rays" />
              <img
                src="/maa-kali-face.png"
                alt=""
                decoding="async"
                className="kk-kali-img"
              />
            </span>
          </button>
        </div>

        <nav aria-label="Main navigation" className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const badge = getCountLabel(item.id);
            const isLimitAlert =
              (item.id === '1PM' && counts.overLimit1PM > 0) ||
              (item.id === '6PM' && counts.overLimit6PM > 0) ||
              (item.id === '8PM' && counts.overLimit8PM > 0);

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                className={`relative w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold rounded-xl transition-colors duration-100 cursor-pointer ${
                  isActive
                    ? 'bg-white text-[var(--kk-brand)] shadow-sm'
                    : 'text-white/85 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-[var(--kk-brand)]' : 'text-white/75'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                {badge && (
                  <span
                    className={`text-xs font-mono-tabular shrink-0 ${
                      isLimitAlert
                        ? isActive
                          ? 'text-red-700 font-bold'
                          : 'text-amber-300 font-bold'
                        : isActive
                          ? 'text-slate-600'
                          : 'text-white/75'
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-white/10 space-y-2">
          <button
            type="button"
            onClick={() => {
              AppSounds.tap();
              onOpenSellerIds();
            }}
            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold text-white bg-white/12 hover:bg-white/20 rounded-xl transition-colors duration-100 cursor-pointer"
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <Smartphone className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="truncate">Seller IDs</span>
            </span>
            {cloudConnected && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            )}
          </button>

          {onOpenAnnouncement && (
            <button
              type="button"
              onClick={() => {
                AppSounds.tap();
                onOpenAnnouncement();
              }}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold text-white bg-amber-400/18 hover:bg-amber-400/28 border border-amber-300/30 rounded-xl transition-colors duration-100 cursor-pointer"
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Megaphone className="w-4 h-4 shrink-0 text-amber-300" aria-hidden="true" />
                <span className="truncate">Ad / Offer</span>
              </span>
              {announcementActive && (
                <span className="w-2 h-2 rounded-full bg-amber-300 shrink-0 animate-pulse" />
              )}
            </button>
          )}

          {onOpenGoogleSheets && (
            <button
              type="button"
              onClick={() => {
                AppSounds.tap();
                onOpenGoogleSheets();
              }}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold text-white bg-white/12 hover:bg-white/20 rounded-xl transition-colors duration-100 cursor-pointer"
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <FileSpreadsheet className="w-4 h-4 shrink-0 text-emerald-300" aria-hidden="true" />
                <span className="truncate">Google Sheet</span>
              </span>
              {googleSheetsActive && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              AppSounds.tap();
              onOpenSettings();
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-semibold text-white bg-white/12 hover:bg-white/20 rounded-xl transition-colors duration-100 cursor-pointer"
          >
            <SlidersHorizontal className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Agency Settings</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="relative z-10 flex-1 min-w-0 h-full flex flex-col overflow-hidden">
        {/* Executive Full-App Top Bar */}
        <header className="shrink-0 z-30 kk-brand-gradient kk-header-bar text-white border-b border-black/15 dark:border-slate-700/40 pt-[env(safe-area-inset-top)]">
          <div className="min-h-[58px] sm:min-h-[64px] py-1.5 sm:py-2 px-2 min-[390px]:px-2.5 sm:px-6 flex items-center justify-between gap-1.5 sm:gap-2">
            {/* Left Brand Cluster: Logo + Agency Name/Date + Animated Maa Kali PNG */}
            <div className="flex items-center gap-1.5 min-[390px]:gap-2 sm:gap-3 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => handleNavClick('Seller Bill')}
                className="lg:hidden w-9 h-9 min-[390px]:w-9.5 min-[390px]:h-9.5 sm:w-10 sm:h-10 rounded-xl overflow-hidden shrink-0 shadow-md ring-1 ring-white/30 cursor-pointer"
                aria-label="KK Agency Home"
              >
                <img
                  src="/kk-logo.png"
                  alt="KK Agency"
                  referrerPolicy="no-referrer"
                  decoding="async"
                  className="w-full h-full object-cover"
                />
              </button>

              <div className="flex flex-col sm:flex-row sm:items-center justify-center gap-0.5 sm:gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => handleNavClick('Seller Bill')}
                  className="lg:hidden text-left text-[15.5px] min-[390px]:text-[16.5px] sm:text-xl font-extrabold tracking-[-0.02em] text-white leading-tight whitespace-nowrap cursor-pointer"
                >
                  KK Agency
                </button>

                <h1 className="hidden lg:block text-xl font-extrabold tracking-[-0.015em] text-white truncate min-w-0">
                  {activeTab === 'Prize List' || activeTab === 'Limit Prize'
                    ? 'Prize List & Limit Prize'
                    : activeTab}
                </h1>

                <span
                  aria-hidden="true"
                  className="hidden sm:inline-block h-4 w-px bg-white/25 shrink-0"
                />

                <label
                  title="Change billing date"
                  className="group relative self-start sm:self-auto inline-flex items-center gap-1 sm:gap-1.5 sm:px-2 py-0 sm:py-1 text-[11px] min-[390px]:text-[11.5px] sm:text-[13.5px] font-bold font-sans tabular-nums tracking-[0.01em] text-white/88 hover:text-white sm:hover:bg-white/10 rounded-md cursor-pointer whitespace-nowrap shrink-0 leading-tight"
                >
                  <Calendar
                    className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 text-amber-300"
                    aria-hidden="true"
                  />
                  <span>{formatDateDDMMYYYY(billingDate)}</span>
                  <input
                    type="date"
                    aria-label="Customize billing date"
                    value={billingDate}
                    onChange={(e) => {
                      if (e.target.value) {
                        AppSounds.tap();
                        onChangeBillingDate(e.target.value);
                      }
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-base"
                  />
                </label>
              </div>

              {/* Animated Maa Kali PNG beside KK Agency (matches Google Sheet icon size) */}
              <div
                className="lg:hidden kk-kali-emblem w-9 h-9 min-[390px]:w-9.5 min-[390px]:h-9.5 sm:w-10 sm:h-10 shrink-0 ml-0.5"
                title="Maa Kali"
              >
                <span className="kk-kali-aura" aria-hidden="true" />
                <span className="kk-kali-rays" aria-hidden="true" />
                <img
                  src="/maa-kali-face.png"
                  alt="Maa Kali"
                  decoding="async"
                  className="kk-kali-img"
                />
              </div>
            </div>

            {/* Right Action Cluster: Uniform Glass Tiles (Ad · Sheet · IDs · Settings) */}
            <div className="flex items-center gap-1 min-[390px]:gap-1.5 sm:gap-2 shrink-0">
              {onOpenAnnouncement && (
                <button
                  type="button"
                  onClick={() => {
                    AppSounds.tap();
                    onOpenAnnouncement();
                  }}
                  aria-label="Advertisement & Urgent Message"
                  title="Advertisement, Offer & Urgent Message"
                  className="relative inline-flex items-center justify-center gap-1 w-9 min-[390px]:w-9.5 sm:w-auto h-9 min-[390px]:h-9.5 sm:h-10 sm:px-3 text-xs font-extrabold text-amber-200 bg-amber-400/16 hover:bg-amber-400/26 border border-amber-300/35 rounded-xl transition-colors duration-100 whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
                >
                  <Megaphone className="w-[17px] h-[17px] shrink-0 text-amber-300" aria-hidden="true" />
                  <span className="hidden sm:inline">Ad</span>
                  {announcementActive && (
                    <span
                      aria-hidden="true"
                      className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse"
                    />
                  )}
                </button>
              )}

              {onOpenGoogleSheets && (
                <button
                  type="button"
                  onClick={() => {
                    AppSounds.tap();
                    onOpenGoogleSheets();
                  }}
                  aria-label="Google Sheets Live Sync"
                  title="Google Sheets Live Sync"
                  className="relative inline-flex items-center justify-center gap-1 w-9 min-[390px]:w-9.5 sm:w-auto h-9 min-[390px]:h-9.5 sm:h-10 sm:px-3 text-xs font-extrabold text-emerald-100 bg-emerald-500/24 hover:bg-emerald-500/34 border border-emerald-300/40 rounded-xl transition-colors duration-100 whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
                >
                  <FileSpreadsheet className="w-[17px] h-[17px] shrink-0 text-emerald-300" aria-hidden="true" />
                  <span className="hidden sm:inline">Sheet</span>
                  {googleSheetsActive && (
                    <span
                      aria-hidden="true"
                      className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse"
                    />
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  AppSounds.tap();
                  onOpenSellerIds();
                }}
                aria-label="Seller Mobile IDs"
                title="Seller Mobile IDs & Live Sync"
                className="relative inline-flex items-center justify-center gap-1 h-9 min-[390px]:h-9.5 sm:h-10 px-2 min-[390px]:px-2.5 sm:px-3 text-xs font-extrabold text-white bg-white/14 hover:bg-white/24 border border-white/25 rounded-xl transition-colors duration-100 whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
              >
                <Smartphone className="w-3.5 h-3.5 min-[390px]:w-4 min-[390px]:h-4 shrink-0 text-white/95" aria-hidden="true" />
                <span>IDs</span>
                {cloudConnected && (
                  <span
                    aria-hidden="true"
                    className="w-1.5 h-1.5 rounded-full bg-emerald-300 shrink-0"
                  />
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  AppSounds.tap();
                  onOpenSettings();
                }}
                aria-label="Agency Settings"
                title="Agency Settings"
                className="inline-flex items-center justify-center gap-1.5 w-9 min-[390px]:w-9.5 sm:w-auto h-9 min-[390px]:h-9.5 sm:h-10 sm:px-3.5 text-xs sm:text-sm font-bold text-white bg-white/18 hover:bg-white/28 border border-white/30 rounded-xl transition-colors duration-100 whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
              >
                <SlidersHorizontal className="w-[17px] h-[17px] shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">Settings</span>
              </button>
            </div>
          </div>
        </header>

        {/* Internal Scroll Viewport so window never scrolls (eliminates iOS top blur & freezes sheet headers flush at top-0) */}
        <main
          ref={scrollRef}
          data-kk-scroll-root="true"
          className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain bg-transparent"
        >
          <div
            className={`px-2 sm:px-5 sm:pt-4 max-w-[1440px] w-full mx-auto ${
              activeTab === 'Seller Bill'
                ? 'min-h-full flex flex-col pt-1.5 pb-1.5 lg:pb-8'
                : activeTab === '1PM' || activeTab === '6PM' || activeTab === '8PM'
                  ? 'pt-2 pb-20 lg:pb-8'
                  : 'pt-2 pb-28 lg:pb-8'
            }`}
          >
            {children}
          </div>
        </main>

        {/* Executive Mobile Bottom App Navigation Bar */}
        <nav
          aria-label="Mobile app navigation"
          className="lg:hidden shrink-0 z-30 kk-bottom-nav bg-white border-t border-slate-200/90 shadow-[0_-4px_18px_rgba(15,36,96,0.08)] px-1.5 pt-1.5 pb-[max(0.65rem,env(safe-area-inset-bottom))] grid grid-cols-7 gap-1"
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const isLimitAlert =
              (item.id === '1PM' && counts.overLimit1PM > 0) ||
              (item.id === '6PM' && counts.overLimit6PM > 0) ||
              (item.id === '8PM' && counts.overLimit8PM > 0);
            const hasPrizeDot = item.id === 'Prize List' && counts.prizes + counts.limitPrizes > 0;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                className={`relative min-w-0 flex flex-col items-center justify-center py-2 px-0.5 rounded-2xl transition-colors duration-100 cursor-pointer ${
                  isActive
                    ? 'kk-brand-gradient kk-nav-active text-white shadow-[0_4px_14px_rgba(15,36,96,0.32)]'
                    : isLimitAlert
                      ? 'text-rose-700 bg-rose-50/70 hover:bg-rose-100/70 dark:text-rose-300 dark:bg-rose-500/14 dark:hover:bg-rose-500/22'
                      : 'text-slate-600 hover:bg-slate-100/90 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white'
                }`}
              >
                {(isLimitAlert || hasPrizeDot) && (
                  <span
                    aria-hidden="true"
                    className={`absolute top-1.5 right-1.5 z-20 w-2 h-2 rounded-full ring-2 ${
                      isActive ? 'ring-[var(--kk-brand)] dark:ring-[#1E3A8A]' : 'ring-white dark:ring-[#0B1324]'
                    } ${isLimitAlert ? 'bg-rose-500' : 'bg-emerald-500'}`}
                  />
                )}

                <Icon
                  className="w-[21px] h-[21px] shrink-0"
                  strokeWidth={isActive ? 2.35 : 1.95}
                  aria-hidden="true"
                />
                <span
                  className={`text-[11px] leading-none mt-1.5 whitespace-nowrap tracking-[-0.015em] ${
                    isActive ? 'font-extrabold text-white' : 'font-bold'
                  }`}
                >
                  {item.shortLabel}
                </span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
});
