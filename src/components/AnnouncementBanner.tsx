import { AlertTriangle, ChevronDown, ChevronUp, Edit3, Megaphone, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CloudAnnouncementKind, CloudPublicAnnouncement } from '../services/cloudSync';
import { AppSounds } from '../utils/sound';

interface AnnouncementBannerProps {
  announcement: Pick<CloudPublicAnnouncement, 'active' | 'kind' | 'title' | 'message' | 'updatedAtMs'> | null;
  variant?: 'portal' | 'login' | 'admin';
  onEdit?: () => void;
  forceVisible?: boolean;
}

const KIND_STYLES: Record<
  CloudAnnouncementKind,
  {
    wrapper: string;
    iconWrap: string;
    badge: string;
    badgeLabel: string;
    title: string;
    body: string;
    toggleBtn: string;
    editBtn: string;
  }
> = {
  urgent: {
    wrapper:
      'bg-gradient-to-r from-rose-700 via-red-700 to-rose-800 text-white border border-rose-400/50 shadow-md',
    iconWrap: 'bg-white/15 text-amber-200 ring-1 ring-white/25',
    badge: 'bg-amber-300 text-rose-950',
    badgeLabel: 'URGENT MESSAGE',
    title: 'text-white',
    body: 'text-rose-50/95',
    toggleBtn: 'text-white/85 hover:text-white hover:bg-white/15',
    editBtn: 'bg-white text-rose-800 hover:bg-rose-50',
  },
  offer: {
    wrapper:
      'bg-gradient-to-r from-[#0B1E47] via-[#132C63] to-[#1D3B7A] text-white border border-amber-400/55 shadow-md',
    iconWrap: 'bg-amber-400/20 text-amber-300 ring-1 ring-amber-300/40',
    badge: 'bg-amber-400 text-slate-950',
    badgeLabel: 'SPECIAL OFFER',
    title: 'text-white',
    body: 'text-indigo-100',
    toggleBtn: 'text-amber-200 hover:text-white hover:bg-white/12',
    editBtn: 'bg-amber-400 text-slate-950 hover:bg-amber-300',
  },
  notice: {
    wrapper:
      'bg-indigo-50/95 text-indigo-950 border border-indigo-200/90 shadow-xs',
    iconWrap: 'bg-indigo-600 text-white shadow-2xs',
    badge: 'bg-indigo-700 text-white',
    badgeLabel: 'AGENCY NOTICE',
    title: 'text-indigo-950',
    body: 'text-indigo-900/90',
    toggleBtn: 'text-indigo-700 hover:bg-indigo-100',
    editBtn: 'bg-indigo-700 text-white hover:bg-indigo-800',
  },
};

export function AnnouncementBanner({
  announcement,
  variant = 'portal',
  onEdit,
  forceVisible = false,
}: AnnouncementBannerProps) {
  const [collapsed, setCollapsed] = useState(false);

  const signature = announcement
    ? `${announcement.kind}|${announcement.title}|${announcement.message}|${announcement.updatedAtMs}`
    : '';

  // Auto-expand whenever Admin publishes or updates the message
  useEffect(() => {
    setCollapsed(false);
  }, [signature]);

  if (!announcement) return null;
  const title = (announcement.title || '').trim();
  const message = (announcement.message || '').trim();
  if (!title && !message) return null;
  if (!forceVisible && !announcement.active) return null;

  const style = KIND_STYLES[announcement.kind] || KIND_STYLES.offer;
  const Icon =
    announcement.kind === 'urgent'
      ? AlertTriangle
      : announcement.kind === 'offer'
        ? Sparkles
        : Megaphone;

  const isLongMessage = message.length > 140 || message.includes('\n');
  const canToggleCollapse = variant === 'portal' && isLongMessage;

  return (
    <div
      role="status"
      aria-live={announcement.kind === 'urgent' ? 'assertive' : 'polite'}
      className={`rounded-2xl px-3.5 py-3 sm:px-4 sm:py-3.5 transition-all ${style.wrapper}`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${style.iconWrap}`}
        >
          <Icon className="w-4.5 h-4.5" aria-hidden="true" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black tracking-wider uppercase ${style.badge}`}
            >
              {announcement.kind === 'urgent' && (
                <span className="w-1.5 h-1.5 rounded-full bg-rose-700 animate-ping" />
              )}
              <span>{style.badgeLabel}</span>
            </span>
            {variant === 'admin' && (
              <span className="text-[10.5px] font-bold opacity-85">
                Live on App, Link &amp; All Masters / Sub-Masters
              </span>
            )}
          </div>

          {title && (
            <div className={`mt-1 text-sm sm:text-[15px] font-extrabold leading-snug ${style.title}`}>
              {title}
            </div>
          )}

          {message && (
            <p
              className={`mt-1 text-xs sm:text-[13px] font-semibold leading-relaxed whitespace-pre-line break-words ${style.body} ${
                collapsed ? 'line-clamp-2' : ''
              }`}
            >
              {message}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {canToggleCollapse && (
            <button
              type="button"
              onClick={() => {
                AppSounds.tap();
                setCollapsed((prev) => !prev);
              }}
              aria-label={collapsed ? 'Expand message' : 'Collapse message'}
              className={`p-1.5 rounded-xl transition-colors cursor-pointer ${style.toggleBtn}`}
            >
              {collapsed ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronUp className="w-4 h-4" />
              )}
            </button>
          )}

          {variant === 'admin' && onEdit && (
            <button
              type="button"
              onClick={() => {
                AppSounds.tap();
                onEdit();
              }}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold transition-colors cursor-pointer shadow-xs ${style.editBtn}`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
