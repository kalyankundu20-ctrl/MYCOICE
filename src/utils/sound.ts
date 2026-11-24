// Clean Click-Free Studio Sound Engine + Mobile Haptics
// - Uses pre-rendered native-rate AudioBuffers with raised-cosine fade-in/out & zero-padding
//   so phone speakers never crackle, pop, or clip.
// - Automatically recovers from iOS Home Screen / PWA background suspension ('interrupted'
//   or frozen AudioContext.currentTime) on the very next tap.
// - Supports instant user Sound ON / OFF toggle.

type SoundName = 'tap' | 'add' | 'success' | 'warning' | 'limitAlert' | 'prizeReveal' | 'remove';

interface CleanVoiceSpec {
  freq: number;
  endFreq?: number;
  durationSec: number;
  gainPeak: number;
  delaySec?: number;
  attackSec?: number;
  octaveGain?: number;
}

const SOUND_PRIORITY: Record<SoundName, number> = {
  tap: 0,
  add: 1,
  remove: 1,
  warning: 1,
  success: 2,
  limitAlert: 2,
  prizeReveal: 2,
};

// Soft, warm pure-sine presets tuned for phone micro-speakers (zero harsh harmonics, zero clipping)
const SOUND_PRESETS: Record<SoundName, CleanVoiceSpec[]> = {
  tap: [
    {
      freq: 760,
      endFreq: 540,
      durationSec: 0.036,
      gainPeak: 0.12,
      attackSec: 0.007,
      octaveGain: 0.08,
    },
  ],
  add: [
    {
      freq: 698.46,
      durationSec: 0.09,
      gainPeak: 0.13,
      delaySec: 0,
      attackSec: 0.009,
      octaveGain: 0.08,
    },
    {
      freq: 1046.5,
      durationSec: 0.14,
      gainPeak: 0.14,
      delaySec: 0.048,
      attackSec: 0.01,
      octaveGain: 0.07,
    },
  ],
  success: [
    {
      freq: 523.25,
      durationSec: 0.14,
      gainPeak: 0.11,
      delaySec: 0,
      attackSec: 0.01,
      octaveGain: 0.07,
    },
    {
      freq: 659.25,
      durationSec: 0.15,
      gainPeak: 0.12,
      delaySec: 0.048,
      attackSec: 0.01,
      octaveGain: 0.07,
    },
    {
      freq: 783.99,
      durationSec: 0.18,
      gainPeak: 0.12,
      delaySec: 0.096,
      attackSec: 0.01,
      octaveGain: 0.06,
    },
    {
      freq: 1046.5,
      durationSec: 0.24,
      gainPeak: 0.12,
      delaySec: 0.144,
      attackSec: 0.012,
      octaveGain: 0.05,
    },
  ],
  warning: [
    {
      freq: 587.33,
      durationSec: 0.09,
      gainPeak: 0.12,
      delaySec: 0,
      attackSec: 0.009,
      octaveGain: 0.05,
    },
    {
      freq: 466.16,
      durationSec: 0.12,
      gainPeak: 0.12,
      delaySec: 0.085,
      attackSec: 0.009,
      octaveGain: 0.05,
    },
  ],
  limitAlert: [
    {
      freq: 987.77,
      durationSec: 0.095,
      gainPeak: 0.13,
      delaySec: 0,
      attackSec: 0.009,
      octaveGain: 0.06,
    },
    {
      freq: 1318.51,
      durationSec: 0.12,
      gainPeak: 0.14,
      delaySec: 0.085,
      attackSec: 0.009,
      octaveGain: 0.06,
    },
    {
      freq: 987.77,
      durationSec: 0.14,
      gainPeak: 0.12,
      delaySec: 0.185,
      attackSec: 0.01,
      octaveGain: 0.05,
    },
  ],
  prizeReveal: [
    {
      freq: 587.33,
      durationSec: 0.13,
      gainPeak: 0.11,
      delaySec: 0,
      attackSec: 0.01,
      octaveGain: 0.07,
    },
    {
      freq: 739.99,
      durationSec: 0.14,
      gainPeak: 0.12,
      delaySec: 0.045,
      attackSec: 0.01,
      octaveGain: 0.07,
    },
    {
      freq: 880.0,
      durationSec: 0.17,
      gainPeak: 0.12,
      delaySec: 0.09,
      attackSec: 0.01,
      octaveGain: 0.06,
    },
    {
      freq: 1174.66,
      durationSec: 0.24,
      gainPeak: 0.12,
      delaySec: 0.135,
      attackSec: 0.012,
      octaveGain: 0.05,
    },
  ],
  remove: [
    {
      freq: 360,
      endFreq: 195,
      durationSec: 0.085,
      gainPeak: 0.13,
      delaySec: 0,
      attackSec: 0.009,
      octaveGain: 0.03,
    },
  ],
};

let soundEnabled = true;

export function setSoundEnabled(enabled: boolean) {
  soundEnabled = Boolean(enabled);
}

export function isSoundEnabled(): boolean {
  return soundEnabled;
}

function pulseHaptic(ms: number | number[]) {
  if (!soundEnabled) return;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms);
    }
  } catch {
    // Ignore unsupported environments
  }
}

// =============================================================================
// UNIFIED ZERO-POP WEB AUDIO ENGINE WITH iOS PWA BACKGROUND RECOVERY
// =============================================================================

const LEADING_SILENCE_SEC = 0.008; // 8ms pure zero lead-in prevents DAC start pop
const TRAILING_SILENCE_SEC = 0.024; // 24ms pure zero tail prevents teardown pop
const SCHEDULE_LOOKAHEAD_SEC = 0.012; // 12ms scheduling cushion avoids UI jitter clicks
const MAX_PEAK_AMPLITUDE = 0.22; // Strict headroom ceiling prevents phone speaker clipping

let audioCtx: AudioContext | null = null;
let masterGainNode: GainNode | null = null;
let bufferCache = new Map<SoundName, AudioBuffer>();
let unlockedOnce = false;
let listenersBound = false;
let needsRebuild = false;
let lastObservedCtxTime = -1;
let lastObservedPerfMs = 0;

function configureAudioSession() {
  try {
    const nav = navigator as unknown as {
      audioSession?: { type: string };
    };
    if (nav && nav.audioSession && nav.audioSession.type !== 'playback') {
      nav.audioSession.type = 'playback';
    }
  } catch {
    // Supported on iOS 17+ Safari; safe no-op elsewhere
  }
}

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return win.AudioContext || win.webkitAudioContext || null;
}

function isContextStalled(ctx: AudioContext): boolean {
  const state = ctx.state as string;
  // iOS Safari uses non-standard 'interrupted' state after home-screen / phone calls / lock screen
  if (state === 'closed' || state === 'interrupted') {
    return true;
  }
  if (state === 'running' && lastObservedPerfMs > 0) {
    const wallDeltaMs = performance.now() - lastObservedPerfMs;
    const ctxDeltaSec = ctx.currentTime - lastObservedCtxTime;
    // If real time moved forward > 350ms but AudioContext clock didn't advance, iOS froze the audio thread
    if (wallDeltaMs > 350 && ctxDeltaSec < 0.005) {
      return true;
    }
  }
  return false;
}

function teardownAudioContext() {
  const oldCtx = audioCtx;
  audioCtx = null;
  masterGainNode = null;
  bufferCache = new Map<SoundName, AudioBuffer>();
  unlockedOnce = false;
  lastObservedCtxTime = -1;
  lastObservedPerfMs = 0;
  if (oldCtx && oldCtx.state !== 'closed') {
    try {
      void oldCtx.close();
    } catch {
      // ignore
    }
  }
}

function createFreshAudioContext(): AudioContext | null {
  const Ctor = getAudioContextConstructor();
  if (!Ctor) return null;

  configureAudioSession();
  try {
    const ctx = new Ctor();
    const gain = ctx.createGain();
    gain.gain.value = 0.85;
    gain.connect(ctx.destination);

    ctx.onstatechange = () => {
      const s = ctx.state as string;
      if (s === 'interrupted' || s === 'closed') {
        needsRebuild = true;
      }
    };

    audioCtx = ctx;
    masterGainNode = gain;
    bufferCache = new Map<SoundName, AudioBuffer>();
    unlockedOnce = false;
    needsRebuild = false;
    lastObservedCtxTime = ctx.currentTime;
    lastObservedPerfMs = performance.now();
    return ctx;
  } catch {
    audioCtx = null;
    masterGainNode = null;
    return null;
  }
}

function ensureHealthyAudioContext(): AudioContext | null {
  if (audioCtx && (needsRebuild || isContextStalled(audioCtx))) {
    teardownAudioContext();
  }
  if (audioCtx && audioCtx.state !== 'closed') {
    return audioCtx;
  }
  return createFreshAudioContext();
}

/**
 * Renders a click-free mono Float32 AudioBuffer at the AudioContext's native sample rate.
 * Every voice uses pure sine oscillators, raised-cosine (Hann) attack & release envelopes,
 * exact zero leading/trailing silence, DC-offset removal, and strict peak limiting.
 */
function renderCleanBuffer(ctx: AudioContext, name: SoundName): AudioBuffer {
  const cached = bufferCache.get(name);
  if (cached) return cached;

  const sampleRate = ctx.sampleRate || 44100;
  const voices = SOUND_PRESETS[name];

  let activeDurationSec = 0;
  for (const v of voices) {
    const end = (v.delaySec ?? 0) + v.durationSec;
    if (end > activeDurationSec) activeDurationSec = end;
  }

  const totalSec = LEADING_SILENCE_SEC + activeDurationSec + TRAILING_SILENCE_SEC;
  const totalSamples = Math.max(1, Math.ceil(totalSec * sampleRate));
  const buffer = ctx.createBuffer(1, totalSamples, sampleRate);
  const data = buffer.getChannelData(0);

  const leadSamples = Math.floor(LEADING_SILENCE_SEC * sampleRate);
  const activeEndSample = Math.min(
    totalSamples,
    leadSamples + Math.ceil(activeDurationSec * sampleRate)
  );

  for (const v of voices) {
    const startSample = leadSamples + Math.floor((v.delaySec ?? 0) * sampleRate);
    const lenSamples = Math.max(1, Math.floor(v.durationSec * sampleRate));
    const endSample = Math.min(totalSamples - 1, startSample + lenSamples);

    const startFreq = v.freq;
    const endFreq = v.endFreq ?? v.freq;
    const attackSec = Math.min(v.attackSec ?? 0.008, v.durationSec * 0.4);
    const releaseSec = Math.min(0.016, v.durationSec * 0.45);
    const octGain = v.octaveGain ?? 0.06;

    let phase1 = 0;
    let phase2 = 0;

    for (let i = startSample; i < endSample; i++) {
      const localIdx = i - startSample;
      const t = localIdx / sampleRate;
      const progress = localIdx / lenSamples;

      const instFreq =
        endFreq !== startFreq
          ? startFreq * Math.pow(endFreq / startFreq, progress)
          : startFreq;

      // Raised-cosine (Hann) attack: zero slope at t = 0
      const attackEnv =
        t < attackSec
          ? 0.5 * (1 - Math.cos((Math.PI * t) / attackSec))
          : 1;

      // Smooth exponential body decay
      const decayProgress = Math.max(
        0,
        (t - attackSec) / Math.max(0.001, v.durationSec - attackSec)
      );
      const decayEnv = Math.exp(-3.6 * decayProgress);

      // Raised-cosine tail fade-out to exact 0.0 before note end
      const timeRemaining = v.durationSec - t;
      const releaseEnv =
        timeRemaining < releaseSec
          ? 0.5 * (1 - Math.cos((Math.PI * Math.max(0, timeRemaining)) / releaseSec))
          : 1;

      const env = attackEnv * decayEnv * releaseEnv * v.gainPeak;

      const dPhase = (2 * Math.PI * instFreq) / sampleRate;
      phase1 += dPhase;
      phase2 += dPhase * 2;

      const sample = Math.sin(phase1) + Math.sin(phase2) * octGain;
      data[i] += sample * env;
    }
  }

  // Remove any tiny DC offset across the active region and enforce strict peak ceiling
  let sum = 0;
  const activeCount = Math.max(1, activeEndSample - leadSamples);
  for (let i = leadSamples; i < activeEndSample; i++) {
    sum += data[i];
  }
  const dcMean = sum / activeCount;

  let peak = 0;
  for (let i = leadSamples; i < activeEndSample; i++) {
    const distFromEdge = Math.min(i - leadSamples, activeEndSample - 1 - i);
    const edgeFade = distFromEdge < 64 ? distFromEdge / 64 : 1;
    data[i] -= dcMean * edgeFade;
    const abs = Math.abs(data[i]);
    if (abs > peak) peak = abs;
  }

  if (peak > MAX_PEAK_AMPLITUDE) {
    const scale = MAX_PEAK_AMPLITUDE / peak;
    for (let i = leadSamples; i < activeEndSample; i++) {
      data[i] *= scale;
    }
  }

  // Guarantee exact zero samples in leading and trailing silence pads
  for (let i = 0; i < leadSamples; i++) data[i] = 0;
  for (let i = activeEndSample; i < totalSamples; i++) data[i] = 0;

  bufferCache.set(name, buffer);
  return buffer;
}

function playBufferOnContext(ctx: AudioContext, name: SoundName) {
  try {
    const buffer = renderCleanBuffer(ctx, name);
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const dest = masterGainNode && ctx === audioCtx ? masterGainNode : ctx.destination;
    source.connect(dest);
    source.onended = () => {
      try {
        source.disconnect();
      } catch {
        // ignore
      }
    };

    lastObservedCtxTime = ctx.currentTime;
    lastObservedPerfMs = performance.now();

    // Schedule slightly ahead so main-thread React renders never clip the start of the buffer
    source.start(ctx.currentTime + SCHEDULE_LOOKAHEAD_SEC);
  } catch {
    needsRebuild = true;
  }
}

function unlockOnGesture() {
  if (!soundEnabled) return;
  const ctx = ensureHealthyAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {
      needsRebuild = true;
    });
  }

  if (!unlockedOnce) {
    unlockedOnce = true;
    try {
      const silent = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
      const src = ctx.createBufferSource();
      src.buffer = silent;
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      // Ignore
    }
  }
}

/**
 * Forces a clean AudioContext wake-up / rebuild on user gesture (e.g. toggling Sound ON).
 */
export function wakeSoundEngine() {
  needsRebuild = true;
  if (soundEnabled) {
    unlockOnGesture();
  }
}

export function initSoundEngine() {
  if (typeof window === 'undefined' || listenersBound) return;
  listenersBound = true;

  const handleGesture = () => {
    unlockOnGesture();
  };

  window.addEventListener('pointerdown', handleGesture, { passive: true, capture: true });
  window.addEventListener('touchstart', handleGesture, { passive: true, capture: true });
  window.addEventListener('keydown', handleGesture, { passive: true, capture: true });

  // iOS Home Screen / App Switcher lifecycle recovery:
  // Flag context for clean rebuild whenever app leaves foreground so the very next tap revives sound instantly!
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      needsRebuild = true;
    } else if (document.visibilityState === 'visible') {
      needsRebuild = true;
      if (soundEnabled && audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {
          needsRebuild = true;
        });
      }
    }
  });

  window.addEventListener('pagehide', () => {
    needsRebuild = true;
  });

  window.addEventListener('pageshow', () => {
    needsRebuild = true;
  });

  window.addEventListener('focus', () => {
    if (audioCtx && isContextStalled(audioCtx)) {
      needsRebuild = true;
    }
  });
}

// =============================================================================
// GLOBAL ANTI-DOUBLE-SOUND DEDUPLICATION GATE
// =============================================================================

let lastSoundName: SoundName | null = null;
let lastSoundTimeMs = 0;

function shouldSkipDuplicateSound(name: SoundName): boolean {
  const now = performance.now();
  const elapsed = now - lastSoundTimeMs;

  if (lastSoundName === null) {
    lastSoundName = name;
    lastSoundTimeMs = now;
    return false;
  }

  // Never play the exact same sound twice inside 110ms
  if (name === lastSoundName && elapsed < 110) {
    return true;
  }

  // Never let a low-priority tap echo right after any recent sound (within 160ms)
  if (name === 'tap' && elapsed < 160) {
    return true;
  }

  // Prevent same-priority or lower-priority rapid stacking inside 85ms
  if (SOUND_PRIORITY[name] <= SOUND_PRIORITY[lastSoundName] && elapsed < 85) {
    return true;
  }

  lastSoundName = name;
  lastSoundTimeMs = now;
  return false;
}

function playSound(name: SoundName): boolean {
  if (!soundEnabled) {
    return false;
  }

  if (shouldSkipDuplicateSound(name)) {
    return false;
  }

  initSoundEngine();
  const ctx = ensureHealthyAudioContext();
  if (!ctx) return false;

  if (ctx.state === 'running') {
    playBufferOnContext(ctx, name);
    return true;
  }

  // Resume synchronously inside the tap gesture; play cleanly once running
  ctx
    .resume()
    .then(() => {
      if (ctx === audioCtx && ctx.state === 'running') {
        playBufferOnContext(ctx, name);
      }
    })
    .catch(() => {
      needsRebuild = true;
    });

  return true;
}

export const AppSounds = {
  /** Soft, click-free tactile tap */
  tap() {
    if (playSound('tap')) pulseHaptic(4);
  },

  /** Clean rising fifth (F5 -> C6) */
  add() {
    if (playSound('add')) pulseHaptic(8);
  },

  /** Smooth major chord for save, copy, paste, WhatsApp send */
  success() {
    if (playSound('success')) pulseHaptic([8, 22, 12]);
  },

  /** Gentle two-tone caution cue */
  warning() {
    if (playSound('warning')) pulseHaptic([12, 20, 12]);
  },

  /** Crisp twin-bell alert when over-limit threshold is crossed */
  limitAlert() {
    if (playSound('limitAlert')) pulseHaptic([14, 24, 14]);
  },

  /** Ascending cascade when Prize List reveals winning matches */
  prizeReveal() {
    if (playSound('prizeReveal')) pulseHaptic([8, 18, 8, 18, 16]);
  },

  /** Soft damped drop for delete / clear */
  remove() {
    if (playSound('remove')) pulseHaptic(14);
  },
};
