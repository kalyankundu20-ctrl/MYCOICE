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
  Volume2,
  VolumeX,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { ReactNode, useEffect, useRef } from 'react';
import { formatDateDDMMYYYY } from '../engine/calculations';
import { SheetTab } from '../types/ledger';
import { AppSounds } from '../utils/sound';

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

export function AppShell({
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
  soundEnabled,
  onToggleSound,
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
    AppSounds.tap();
    onSelectTab(tab);
  };

  return (
    <div className="h-full w-full overflow-hidden bg-[var(--kk-canvas)] text-slate-950 flex transition-colors duration-200">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 kk-brand-gradient text-white border-r border-black/15 h-full transition-colors duration-200">
        <div className="px-4 h-16 flex items-center justify-between border-b border-white/12">
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => handleNavClick('Seller Bill')}
            className="flex items-center gap-3 text-left cursor-pointer group min-w-0"
          >
            <img
              src="/kk-logo.png"
              alt="KK Agency"
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-xl object-cover shadow-md ring-1 ring-white/30 shrink-0 transition-transform duration-200 group-hover:scale-105"
            />
            <div className="text-lg font-black tracking-tight text-white truncate group-hover:opacity-90 transition-opacity">
              KK Agency
            </div>
          </motion.button>
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
              <motion.button
                key={item.id}
                type="button"
                whileHover={{ x: isActive ? 0 : 2 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 520, damping: 32 }}
                onClick={() => handleNavClick(item.id)}
                className={`relative w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold rounded-xl transition-colors cursor-pointer ${
                  isActive
                    ? 'text-[var(--kk-brand)]'
                    : 'text-white/85 hover:bg-white/10 hover:text-white'
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="desktopNavPill"
                    transition={{ type: 'spring', stiffness: 520, damping: 36 }}
                    className="absolute inset-0 bg-white rounded-xl shadow-sm"
                  />
                )}
                <span className="relative z-10 flex items-center gap-2.5 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
                      isActive ? 'text-[var(--kk-brand)] scale-105' : 'text-white/75'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                {badge && (
                  <span
                    className={`relative z-10 text-xs font-mono-tabular shrink-0 ${
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
              </motion.button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-white/10 space-y-2">
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              AppSounds.tap();
              onOpenSellerIds();
            }}
            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold text-white bg-white/12 hover:bg-white/20 rounded-xl transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <Smartphone className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="truncate">Seller IDs</span>
            </span>
            {cloudConnected && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            )}
          </motion.button>

          {onOpenAnnouncement && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                AppSounds.tap();
                onOpenAnnouncement();
              }}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold text-white bg-amber-400/18 hover:bg-amber-400/28 border border-amber-300/30 rounded-xl transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Megaphone className="w-4 h-4 shrink-0 text-amber-300" aria-hidden="true" />
                <span className="truncate">Ad / Offer</span>
              </span>
              {announcementActive && (
                <span className="w-2 h-2 rounded-full bg-amber-300 shrink-0 animate-pulse" />
              )}
            </motion.button>
          )}

          {onOpenGoogleSheets && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                AppSounds.tap();
                onOpenGoogleSheets();
              }}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold text-white bg-white/12 hover:bg-white/20 rounded-xl transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <FileSpreadsheet className="w-4 h-4 shrink-0 text-emerald-300" aria-hidden="true" />
                <span className="truncate">Google Sheet</span>
              </span>
              {googleSheetsActive && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
              )}
            </motion.button>
          )}

          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              AppSounds.tap();
              onOpenSettings();
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-semibold text-white bg-white/12 hover:bg-white/20 rounded-xl transition-colors cursor-pointer"
          >
            <SlidersHorizontal className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Agency Settings</span>
          </motion.button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
        {/* Executive Full-App Top Bar (Solid Navy, Zero Blur, Safe-Area Full-Screen) */}
        <header className="shrink-0 z-30 kk-brand-gradient text-white border-b border-black/15 pt-[env(safe-area-inset-top)] transition-colors duration-200">
          <div className="min-h-16 sm:min-h-[68px] py-2 px-3 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0 flex-1">
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => handleNavClick('Seller Bill')}
              className="lg:hidden w-10 h-10 rounded-xl overflow-hidden shrink-0 shadow-md ring-1 ring-white/25 cursor-pointer"
              aria-label="KK Agency Home"
            >
              <img
                src="/kk-logo.png"
                alt="KK Agency"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </motion.button>

            <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-3 min-w-0">
              <button
                type="button"
                onClick={() => handleNavClick('Seller Bill')}
                className="lg:hidden text-left text-[17px] sm:text-xl font-extrabold tracking-[-0.015em] text-white leading-tight whitespace-nowrap cursor-pointer"
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
                className="group relative self-start sm:self-auto inline-flex items-center gap-1.5 -ml-1 sm:ml-0 px-1 sm:px-2 py-0.5 sm:py-1 text-[12px] sm:text-[13.5px] font-semibold font-mono-tabular tracking-[0.02em] text-white/90 hover:text-white hover:bg-white/10 rounded-md cursor-pointer whitespace-nowrap shrink-0 transition-colors"
              >
                <Calendar
                  className="w-3.5 h-3.5 shrink-0 text-amber-300/95"
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
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {onOpenAnnouncement && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.94 }}
                onClick={() => {
                  AppSounds.tap();
                  onOpenAnnouncement();
                }}
                aria-label="Advertisement & Urgent Message"
                title="Advertisement, Offer & Urgent Message"
                className="relative inline-flex items-center justify-center gap-1 h-9.5 sm:h-10 px-2 sm:px-3 text-xs font-extrabold text-amber-100 bg-amber-500/25 hover:bg-amber-500/38 border border-amber-300/45 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
              >
                <Megaphone className="w-4 h-4 shrink-0 text-amber-300" aria-hidden="true" />
                <span className="hidden sm:inline">Ad</span>
                {announcementActive && (
                  <span
                    aria-hidden="true"
                    className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-300 ring-2 ring-[var(--kk-brand)] animate-pulse"
                  />
                )}
              </motion.button>
            )}

            {onOpenGoogleSheets && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.94 }}
                onClick={() => {
                  AppSounds.tap();
                  onOpenGoogleSheets();
                }}
                aria-label="Google Sheets Live Sync"
                title="Google Sheets Live Sync"
                className="relative inline-flex items-center justify-center gap-1 h-9.5 sm:h-10 px-2 sm:px-3 text-xs font-extrabold text-white bg-emerald-600/85 hover:bg-emerald-600 border border-emerald-300/35 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
              >
                <FileSpreadsheet className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="hidden xs:inline sm:inline">Sheet</span>
                {googleSheetsActive && (
                  <span
                    aria-hidden="true"
                    className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-300 ring-2 ring-[var(--kk-brand)] animate-pulse"
                  />
                )}
              </motion.button>
            )}

            <motion.button
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={() => {
                AppSounds.tap();
                onOpenSellerIds();
              }}
              aria-label="Seller Mobile IDs"
              title="Seller Mobile IDs & Live Sync"
              className="relative inline-flex items-center justify-center gap-1 h-9.5 sm:h-10 px-2.5 sm:px-3 text-xs font-extrabold text-white bg-white/18 hover:bg-white/28 border border-white/25 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
            >
              <Smartphone className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>IDs</span>
              {cloudConnected && (
                <span
                  aria-hidden="true"
                  className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[var(--kk-brand)]"
                />
              )}
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={onToggleSound}
              aria-label={soundEnabled ? 'Turn sound off' : 'Turn sound on'}
              title={soundEnabled ? 'Sound On (Tap to Mute)' : 'Sound Off (Tap to Unmute)'}
              className={`inline-flex items-center justify-center w-9.5 h-9.5 sm:w-10 sm:h-10 rounded-xl border transition-colors shrink-0 cursor-pointer shadow-xs ${
                soundEnabled
                  ? 'bg-white/18 hover:bg-white/28 text-white border-white/25'
                  : 'bg-slate-900/35 hover:bg-slate-900/50 text-white/65 border-white/15'
              }`}
            >
              {soundEnabled ? (
                <Volume2 className="w-[18px] h-[18px] stroke-[2.2]" aria-hidden="true" />
              ) : (
                <VolumeX className="w-[18px] h-[18px] stroke-[2.2]" aria-hidden="true" />
              )}
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                AppSounds.tap();
                onOpenSettings();
              }}
              aria-label="Agency Settings"
              className="inline-flex items-center justify-center gap-1.5 h-9.5 sm:h-10 px-2.5 sm:px-3.5 text-xs sm:text-sm font-bold text-[var(--kk-brand)] bg-white hover:bg-slate-100 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-sm"
            >
              <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">Settings</span>
            </motion.button>
          </div>
          </div>
        </header>

        {/* Internal Scroll Viewport so window never scrolls (eliminates iOS 26 top blur & freezes sheet headers flush at top-0) */}
        <main
          ref={scrollRef}
          data-kk-scroll-root="true"
          className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain bg-[var(--kk-canvas)]"
        >
          <div
            className={`px-2 pt-2 sm:px-5 sm:pt-4 max-w-[1440px] w-full mx-auto ${
              activeTab === '1PM' || activeTab === '6PM' || activeTab === '8PM'
                ? 'pb-20 lg:pb-8'
                : 'pb-28 lg:pb-8'
            }`}
          >
            <div key={activeTab}>{children}</div>
          </div>
        </main>

        {/* Executive Mobile Bottom App Navigation Bar (Solid, Zero Blur, Flex-Docked Edge-to-Edge) */}
        <nav
          aria-label="Mobile app navigation"
          className="lg:hidden shrink-0 z-30 bg-white border-t border-slate-200/90 shadow-[0_-4px_18px_rgba(15,36,96,0.08)] px-1.5 pt-1.5 pb-[max(0.65rem,env(safe-area-inset-bottom))] grid grid-cols-7 gap-1"
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
            <motion.button
              key={item.id}
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={() => handleNavClick(item.id)}
              className={`relative min-w-0 flex flex-col items-center justify-center py-2 px-0.5 rounded-2xl transition-colors cursor-pointer ${
                isActive
                  ? 'text-white'
                  : isLimitAlert
                    ? 'text-rose-700 bg-rose-50/70 hover:bg-rose-100/70'
                    : 'text-slate-600 hover:bg-slate-100/90 hover:text-slate-950'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="mobileTabBg"
                  transition={{ type: 'spring', stiffness: 520, damping: 34 }}
                  aria-hidden="true"
                  className="absolute inset-0 kk-brand-gradient rounded-2xl shadow-[0_4px_14px_rgba(15,36,96,0.32)]"
                />
              )}

              {(isLimitAlert || hasPrizeDot) && (
                <span
                  aria-hidden="true"
                  className={`absolute top-1.5 right-1.5 z-20 w-2 h-2 rounded-full ring-2 ${
                    isActive ? 'ring-[var(--kk-brand)]' : 'ring-white'
                  } ${isLimitAlert ? 'bg-rose-500' : 'bg-emerald-500'}`}
                />
              )}

              <motion.span
                animate={{ scale: isActive ? 1.1 : 1, y: isActive ? -1 : 0 }}
                transition={{ type: 'spring', stiffness: 480, damping: 26 }}
                className="relative z-10 inline-flex"
              >
                <Icon
                  className="w-[21px] h-[21px] shrink-0"
                  strokeWidth={isActive ? 2.35 : 1.95}
                  aria-hidden="true"
                />
              </motion.span>
              <span
                className={`relative z-10 text-[11px] leading-none mt-1.5 whitespace-nowrap tracking-[-0.015em] ${
                  isActive ? 'font-extrabold text-white' : 'font-bold'
                }`}
              >
                {item.shortLabel}
              </span>
            </motion.button>
          );
        })}
        </nav>
      </div>
    </div>
  );
}
