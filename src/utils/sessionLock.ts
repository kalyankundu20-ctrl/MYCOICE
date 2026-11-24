import { SessionId } from '../types/ledger';

export interface SessionCutoffConfig {
  sessionId: SessionId;
  hour: number;
  minute: number;
  totalMinutes: number;
  cutoffLabel: string;
}

export const SELLER_SESSION_CUTOFFS: Record<SessionId, SessionCutoffConfig> = {
  '1PM': {
    sessionId: '1PM',
    hour: 12,
    minute: 58,
    totalMinutes: 12 * 60 + 58, // 778
    cutoffLabel: '12:58 PM',
  },
  '6PM': {
    sessionId: '6PM',
    hour: 17,
    minute: 58,
    totalMinutes: 17 * 60 + 58, // 1078
    cutoffLabel: '5:58 PM',
  },
  '8PM': {
    sessionId: '8PM',
    hour: 19,
    minute: 58,
    totalMinutes: 19 * 60 + 58, // 1198
    cutoffLabel: '7:58 PM',
  },
};

export interface IstClockParts {
  isoDate: string;
  hour: number;
  minute: number;
  second: number;
  totalMinutes: number;
  totalSeconds: number;
  timeLabel: string;
}

export function getIstClockParts(now: Date = new Date()): IstClockParts {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const map: Record<string, string> = {};
    for (const p of parts) {
      map[p.type] = p.value;
    }

    const year = map.year || String(now.getFullYear());
    const month = map.month || String(now.getMonth() + 1).padStart(2, '0');
    const day = map.day || String(now.getDate()).padStart(2, '0');
    const rawHour = parseInt(map.hour || '0', 10);
    const hour = rawHour === 24 ? 0 : rawHour;
    const minute = parseInt(map.minute || '0', 10);
    const second = parseInt(map.second || '0', 10);

    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const timeLabel = `${h12}:${String(minute).padStart(2, '0')} ${ampm} IST`;

    return {
      isoDate: `${year}-${month}-${day}`,
      hour,
      minute,
      second,
      totalMinutes: hour * 60 + minute,
      totalSeconds: hour * 3600 + minute * 60 + second,
      timeLabel,
    };
  } catch {
    // Fallback: calculate UTC + 5:30 directly
    const istMs = now.getTime() + 330 * 60 * 1000;
    const d = new Date(istMs);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const hour = d.getUTCHours();
    const minute = d.getUTCMinutes();
    const second = d.getUTCSeconds();
    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    return {
      isoDate: `${year}-${month}-${day}`,
      hour,
      minute,
      second,
      totalMinutes: hour * 60 + minute,
      totalSeconds: hour * 3600 + minute * 60 + second,
      timeLabel: `${h12}:${String(minute).padStart(2, '0')} ${ampm} IST`,
    };
  }
}

export interface SessionLockStatus {
  sessionId: SessionId;
  isLocked: boolean;
  reason: 'past-date' | 'cutoff-passed' | 'open' | 'future-date';
  cutoffLabel: string;
  remainingLabel: string;
  isClosingSoon: boolean;
  istTimeLabel: string;
  todayIstDate: string;
}

export function getSellerSessionLockStatus(
  sessionId: SessionId,
  billingDate: string,
  now: Date = new Date()
): SessionLockStatus {
  const cutoff = SELLER_SESSION_CUTOFFS[sessionId];
  const ist = getIstClockParts(now);
  const cleanDate = /^\d{4}-\d{2}-\d{2}$/.test(billingDate) ? billingDate : ist.isoDate;

  // If Admin already rolled over to a future date (e.g. tomorrow after Close Day), keep all 3 sessions unlocked
  if (cleanDate > ist.isoDate) {
    return {
      sessionId,
      isLocked: false,
      reason: 'future-date',
      cutoffLabel: cutoff.cutoffLabel,
      remainingLabel: `Cutoff ${cutoff.cutoffLabel}`,
      isClosingSoon: false,
      istTimeLabel: ist.timeLabel,
      todayIstDate: ist.isoDate,
    };
  }

  // Strictly follow exact IST cutoff times (1PM: 12:58 PM, 6PM: 5:58 PM, 8PM: 7:58 PM).
  // Never blanket-lock all 3 sessions just because agency.date has not rolled over yet —
  // during 1PM work (before 12:58 PM) all 3 are unlocked; after 12:58 PM, 6PM & 8PM stay unlocked until their own cutoffs.
  const cutoffSeconds = cutoff.totalMinutes * 60;
  const remainingSeconds = cutoffSeconds - ist.totalSeconds;

  if (remainingSeconds <= 0) {
    return {
      sessionId,
      isLocked: true,
      reason: 'cutoff-passed',
      cutoffLabel: cutoff.cutoffLabel,
      remainingLabel: '',
      isClosingSoon: false,
      istTimeLabel: ist.timeLabel,
      todayIstDate: ist.isoDate,
    };
  }

  const hrs = Math.floor(remainingSeconds / 3600);
  const mins = Math.floor((remainingSeconds % 3600) / 60);
  const secs = remainingSeconds % 60;
  const remainingLabel =
    hrs > 0
      ? `${hrs}h ${String(mins).padStart(2, '0')}m left`
      : `${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s left`;

  return {
    sessionId,
    isLocked: false,
    reason: 'open',
    cutoffLabel: cutoff.cutoffLabel,
    remainingLabel,
    isClosingSoon: remainingSeconds <= 15 * 60,
    istTimeLabel: ist.timeLabel,
    todayIstDate: ist.isoDate,
  };
}
