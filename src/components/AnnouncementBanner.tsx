import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Edit3,
  Megaphone,
  Sparkles,
  X,
  ZoomIn,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CloudAnnouncementKind, CloudPublicAnnouncement } from '../services/cloudSync';
import { AppSounds } from '../utils/sound';

interface AnnouncementBannerProps {
  announcement: Pick<
    CloudPublicAnnouncement,
    'active' | 'kind' | 'title' | 'message' | 'imageDataUrl' | 'imageDataUrls' | 'updatedAtMs'
  > | null;
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
  const [activeSlide, setActiveSlide] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [touchPaused, setTouchPaused] = useState(false);
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const touchResumeTimerRef = useRef<number | null>(null);

  const photos = useMemo(() => {
    if (!announcement) return [] as string[];
    const list: string[] = [];
    if (Array.isArray(announcement.imageDataUrls)) {
      for (const u of announcement.imageDataUrls) {
        if (typeof u === 'string' && u.startsWith('data:image/') && !list.includes(u)) {
          list.push(u);
        }
      }
    }
    if (
      list.length === 0 &&
      typeof announcement.imageDataUrl === 'string' &&
      announcement.imageDataUrl.startsWith('data:image/')
    ) {
      list.push(announcement.imageDataUrl);
    }
    return list;
  }, [announcement]);

  const imgSig = photos.map((u) => `${u.length}:${u.slice(-16)}`).join(',');
  const signature = announcement
    ? `${announcement.kind}|${announcement.title}|${announcement.message}|${imgSig}|${announcement.updatedAtMs}`
    : '';

  // Auto-expand & reset slide whenever Admin publishes or updates the advertisement
  useEffect(() => {
    setCollapsed(false);
    setActiveSlide(0);
    setLightboxOpen(false);
    if (sliderRef.current) {
      sliderRef.current.scrollTo({ left: 0, behavior: 'auto' });
    }
  }, [signature]);

  // Clamp activeSlide if photo list shrinks
  useEffect(() => {
    if (activeSlide >= photos.length && photos.length > 0) {
      setActiveSlide(0);
    }
  }, [photos.length, activeSlide]);

  // Gentle auto-advance for multi-photo banners (pauses while user interacts or zooms)
  useEffect(() => {
    if (photos.length <= 1 || collapsed || lightboxOpen || touchPaused) return;
    const timer = window.setInterval(() => {
      setActiveSlide((prev) => {
        const next = (prev + 1) % photos.length;
        const el = sliderRef.current;
        if (el) {
          el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
        }
        return next;
      });
    }, 4500);
    return () => window.clearInterval(timer);
  }, [photos.length, collapsed, lightboxOpen, touchPaused]);

  useEffect(() => {
    return () => {
      if (touchResumeTimerRef.current) {
        window.clearTimeout(touchResumeTimerRef.current);
      }
    };
  }, []);

  if (!announcement) return null;
  const title = (announcement.title || '').trim();
  const message = (announcement.message || '').trim();
  if (!title && !message && photos.length === 0) return null;
  if (!forceVisible && !announcement.active) return null;

  const style = KIND_STYLES[announcement.kind] || KIND_STYLES.offer;
  const Icon =
    announcement.kind === 'urgent'
      ? AlertTriangle
      : announcement.kind === 'offer'
        ? Sparkles
        : Megaphone;

  const hasText = Boolean(title || message);
  const isLongMessage = message.length > 140 || message.includes('\n');
  const canToggleCollapse = variant === 'portal' && (isLongMessage || photos.length > 0);
  const safeSlide = Math.min(activeSlide, Math.max(0, photos.length - 1));

  const pauseAutoSlideBriefly = () => {
    setTouchPaused(true);
    if (touchResumeTimerRef.current) {
      window.clearTimeout(touchResumeTimerRef.current);
    }
    touchResumeTimerRef.current = window.setTimeout(() => {
      setTouchPaused(false);
    }, 7000);
  };

  const goToSlide = (nextIdx: number) => {
    if (photos.length <= 1) return;
    const wrapped = (nextIdx + photos.length) % photos.length;
    setActiveSlide(wrapped);
    pauseAutoSlideBriefly();
    const el = sliderRef.current;
    if (el) {
      el.scrollTo({ left: wrapped * el.clientWidth, behavior: 'smooth' });
    }
  };

  const handleSliderScroll = () => {
    const el = sliderRef.current;
    if (!el || el.clientWidth <= 0 || photos.length <= 1) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx >= 0 && idx < photos.length && idx !== activeSlide) {
      setActiveSlide(idx);
    }
  };

  return (
    <>
      <div
        role="status"
        aria-live={announcement.kind === 'urgent' ? 'assertive' : 'polite'}
        className={`rounded-2xl overflow-hidden transition-all ${style.wrapper}`}
      >
        {/* Compact Top Strip (slim header bar so KPI cards & Bill table stay visible on screen) */}
        {(hasText || variant === 'admin' || canToggleCollapse) && (
          <div className="px-3 py-1.5 sm:px-3.5 sm:py-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div
                className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${style.iconWrap}`}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9.5px] font-black tracking-wider uppercase ${style.badge}`}
                  >
                    {announcement.kind === 'urgent' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-700 animate-ping" />
                    )}
                    <span>{style.badgeLabel}</span>
                  </span>
                  {title && (
                    <span
                      className={`text-xs sm:text-[13px] font-extrabold leading-tight truncate ${style.title}`}
                    >
                      {title}
                    </span>
                  )}
                  {photos.length > 1 && (
                    <span className="px-1.5 py-0.5 rounded-md bg-white/15 text-[9.5px] font-extrabold font-mono-tabular shrink-0">
                      {safeSlide + 1}/{photos.length}
                    </span>
                  )}
                </div>

                {message && (
                  <p
                    className={`mt-0.5 text-[11px] sm:text-xs font-semibold leading-snug break-words ${style.body} ${
                      collapsed || photos.length > 0 ? 'line-clamp-1' : 'whitespace-pre-line'
                    }`}
                  >
                    {message}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {canToggleCollapse && (
                <button
                  type="button"
                  onClick={() => {
                    AppSounds.tap();
                    setCollapsed((prev) => !prev);
                  }}
                  aria-label={collapsed ? 'Expand message' : 'Collapse message'}
                  className={`p-1 rounded-lg transition-colors cursor-pointer ${style.toggleBtn}`}
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
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10.5px] font-extrabold transition-colors cursor-pointer shadow-xs ${style.editBtn}`}
                >
                  <Edit3 className="w-3 h-3" />
                  <span>Edit</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Compact Header-Strip Full-Width Photo / Multi-Photo Slider (short height ~108px mobile, ambient full-bleed edge-to-edge, tap for Full-Screen Zoom) */}
        {photos.length > 0 && !collapsed && (
          <div className="relative w-full h-[108px] sm:h-[136px] overflow-hidden">
            {photos.length === 1 ? (
              <button
                type="button"
                onClick={() => {
                  AppSounds.tap();
                  setLightboxOpen(true);
                }}
                aria-label="Photo full screen me dekhein"
                className="relative block w-full h-full overflow-hidden cursor-pointer focus:outline-none"
              >
                <img
                  src={photos[0]}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full object-cover scale-110 blur-md brightness-75 select-none pointer-events-none"
                />
                <img
                  src={photos[0]}
                  alt={title || 'KK Agency Advertisement'}
                  className="relative z-10 w-full h-full object-contain mx-auto block"
                />
                <span className="absolute bottom-1.5 right-2 z-20 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-950/75 text-white text-[10px] font-bold backdrop-blur-[2px] shadow-xs">
                  <ZoomIn className="w-3 h-3" />
                  <span>Zoom</span>
                </span>
              </button>
            ) : (
              <>
                <div
                  ref={sliderRef}
                  onScroll={handleSliderScroll}
                  onTouchStart={pauseAutoSlideBriefly}
                  className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scroll-smooth no-scrollbar"
                >
                  {photos.map((photoUrl, idx) => (
                    <div
                      key={`${idx}-${photoUrl.slice(-16)}`}
                      className="w-full h-full shrink-0 snap-center"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          AppSounds.tap();
                          setActiveSlide(idx);
                          setLightboxOpen(true);
                        }}
                        aria-label={`Photo ${idx + 1} full screen me dekhein`}
                        className="relative block w-full h-full overflow-hidden cursor-pointer focus:outline-none"
                      >
                        <img
                          src={photoUrl}
                          alt=""
                          aria-hidden="true"
                          className="absolute inset-0 w-full h-full object-cover scale-110 blur-md brightness-75 select-none pointer-events-none"
                        />
                        <img
                          src={photoUrl}
                          alt={`${title || 'KK Agency Advertisement'} (${idx + 1})`}
                          className="relative z-10 w-full h-full object-contain mx-auto block"
                        />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Prev / Next Navigation Buttons */}
                <button
                  type="button"
                  onClick={() => {
                    AppSounds.tap();
                    goToSlide(safeSlide - 1);
                  }}
                  aria-label="Previous photo"
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-full bg-slate-950/60 hover:bg-slate-950/80 text-white flex items-center justify-center backdrop-blur-[2px] shadow-md cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    AppSounds.tap();
                    goToSlide(safeSlide + 1);
                  }}
                  aria-label="Next photo"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-full bg-slate-950/60 hover:bg-slate-950/80 text-white flex items-center justify-center backdrop-blur-[2px] shadow-md cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>

                {/* Bottom Overlay: Slide Dots + Zoom */}
                <div className="absolute bottom-1.5 inset-x-2 z-20 flex items-center justify-between pointer-events-none">
                  <span className="px-1.5 py-0.5 rounded-md bg-slate-950/75 text-white text-[9.5px] font-extrabold font-mono-tabular backdrop-blur-[2px]">
                    {safeSlide + 1}/{photos.length}
                  </span>
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-950/65 backdrop-blur-[2px] pointer-events-auto">
                    {photos.map((_, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          AppSounds.tap();
                          goToSlide(idx);
                        }}
                        aria-label={`Go to photo ${idx + 1}`}
                        className={`h-1.5 rounded-full transition-all cursor-pointer ${
                          idx === safeSlide ? 'w-3.5 bg-amber-300' : 'w-1.5 bg-white/60 hover:bg-white'
                        }`}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      AppSounds.tap();
                      setLightboxOpen(true);
                    }}
                    className="pointer-events-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-950/75 text-white text-[9.5px] font-bold backdrop-blur-[2px] cursor-pointer"
                  >
                    <ZoomIn className="w-2.5 h-2.5" />
                    <span>Zoom</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Full-screen photo preview lightbox (portaled to document.body so it covers header & bottom nav) */}
      {lightboxOpen &&
        photos.length > 0 &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Advertisement Photo Preview"
            onClick={() => {
              AppSounds.tap();
              setLightboxOpen(false);
            }}
            className="fixed inset-0 z-[80] bg-slate-950/92 backdrop-blur-xs flex flex-col items-center justify-center p-3 sm:p-5"
          >
            <div className="w-full max-w-2xl flex items-center justify-between gap-3 mb-3">
              <div className="text-white text-sm font-extrabold truncate">
                {title || style.badgeLabel}
                {photos.length > 1 ? ` (${safeSlide + 1}/${photos.length})` : ''}
              </div>
              <button
                type="button"
                onClick={() => {
                  AppSounds.tap();
                  setLightboxOpen(false);
                }}
                aria-label="Close photo preview"
                className="p-2 rounded-xl bg-white/15 hover:bg-white/25 text-white transition-colors cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-2xl flex items-center justify-center"
            >
              <img
                src={photos[safeSlide]}
                alt={title || 'KK Agency Advertisement'}
                className="w-full max-h-[80dvh] object-contain rounded-2xl shadow-2xl"
              />
              {photos.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      AppSounds.tap();
                      goToSlide(safeSlide - 1);
                    }}
                    aria-label="Previous photo"
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-slate-950/75 hover:bg-slate-950 text-white flex items-center justify-center shadow-lg cursor-pointer"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      AppSounds.tap();
                      goToSlide(safeSlide + 1);
                    }}
                    aria-label="Next photo"
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-slate-950/75 hover:bg-slate-950 text-white flex items-center justify-center shadow-lg cursor-pointer"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>
            {photos.length > 1 && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="mt-3 flex items-center gap-2 overflow-x-auto max-w-full py-1 px-2"
              >
                {photos.map((thumb, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      AppSounds.tap();
                      goToSlide(idx);
                    }}
                    className={`w-12 h-12 rounded-lg overflow-hidden border-2 shrink-0 cursor-pointer transition-all ${
                      idx === safeSlide
                        ? 'border-amber-400 scale-105'
                        : 'border-white/25 opacity-65 hover:opacity-100'
                    }`}
                  >
                    <img src={thumb} alt={`Slide ${idx + 1}`} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
