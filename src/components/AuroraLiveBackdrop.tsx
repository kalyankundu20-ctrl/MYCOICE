import { memo, useEffect, useState } from 'react';
import { AppThemeId, getActiveDocumentThemeId, subscribeThemeChange } from '../utils/theme';

interface ParticleSpec {
  id: number;
  left: string;
  top: string;
  size: number;
  color: string;
  duration: string;
  delay: string;
  driftClass: string;
}

const PARTICLES: ParticleSpec[] = [
  { id: 1, left: '8%', top: '18%', size: 4, color: '#34F5C5', duration: '9s', delay: '0s', driftClass: 'kk-particle-a' },
  { id: 2, left: '19%', top: '72%', size: 6, color: '#38BDF8', duration: '12s', delay: '-2s', driftClass: 'kk-particle-b' },
  { id: 3, left: '28%', top: '36%', size: 3, color: '#A78BFA', duration: '10s', delay: '-4s', driftClass: 'kk-particle-a' },
  { id: 4, left: '42%', top: '84%', size: 5, color: '#2DD4BF', duration: '13s', delay: '-1s', driftClass: 'kk-particle-c' },
  { id: 5, left: '54%', top: '24%', size: 4, color: '#60A5FA', duration: '11s', delay: '-5s', driftClass: 'kk-particle-b' },
  { id: 6, left: '66%', top: '62%', size: 7, color: '#34F5C5', duration: '14s', delay: '-3s', driftClass: 'kk-particle-a' },
  { id: 7, left: '78%', top: '28%', size: 5, color: '#818CF8', duration: '10.5s', delay: '-6s', driftClass: 'kk-particle-c' },
  { id: 8, left: '88%', top: '78%', size: 6, color: '#22D3EE', duration: '12.5s', delay: '-2.5s', driftClass: 'kk-particle-b' },
  { id: 9, left: '14%', top: '48%', size: 5, color: '#5EEAD4', duration: '11.5s', delay: '-7s', driftClass: 'kk-particle-c' },
  { id: 10, left: '35%', top: '14%', size: 3.5, color: '#F472B6', duration: '13.5s', delay: '-3.5s', driftClass: 'kk-particle-a' },
  { id: 11, left: '72%', top: '44%', size: 4.5, color: '#38BDF8', duration: '9.5s', delay: '-1.5s', driftClass: 'kk-particle-b' },
  { id: 12, left: '92%', top: '16%', size: 4, color: '#34F5C5', duration: '12s', delay: '-4.5s', driftClass: 'kk-particle-a' },
  { id: 13, left: '48%', top: '52%', size: 3.5, color: '#C084FC', duration: '11s', delay: '-8s', driftClass: 'kk-particle-c' },
  { id: 14, left: '24%', top: '88%', size: 4.5, color: '#2DD4BF', duration: '10s', delay: '-5.5s', driftClass: 'kk-particle-a' },
  { id: 15, left: '82%', top: '56%', size: 3, color: '#67E8F9', duration: '8.5s', delay: '-2s', driftClass: 'kk-particle-b' },
  { id: 16, left: '61%', top: '86%', size: 5.5, color: '#818CF8', duration: '13s', delay: '-6.5s', driftClass: 'kk-particle-c' },
];

/**
 * GPU-only animated aurora ribbons + floating luminous cyan/violet particles.
 * Mounts strictly when the "Neon Aurora Live" theme is active (zero cost on all other themes).
 */
export const AuroraLiveBackdrop = memo(function AuroraLiveBackdrop() {
  const [themeId, setThemeId] = useState<AppThemeId>(() => getActiveDocumentThemeId());

  useEffect(() => {
    setThemeId(getActiveDocumentThemeId());
    return subscribeThemeChange(setThemeId);
  }, []);

  if (themeId !== 'aurora-live') return null;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-0 overflow-hidden pointer-events-none select-none"
    >
      {/* Flowing Liquid Aurora Ribbons (GPU transform + opacity only) */}
      <div className="kk-aurora-ribbon kk-aurora-ribbon-1" />
      <div className="kk-aurora-ribbon kk-aurora-ribbon-2" />
      <div className="kk-aurora-ribbon kk-aurora-ribbon-3" />

      {/* Drifting Luminous Cyan / Mint / Violet Starlight Particles */}
      {PARTICLES.map((p) => (
        <span
          key={p.id}
          className={`kk-aurora-particle ${p.driftClass}`}
          style={{
            left: p.left,
            top: p.top,
            width: `${p.size}px`,
            height: `${p.size}px`,
            backgroundColor: p.color,
            boxShadow: `0 0 ${p.size * 3}px ${p.color}, 0 0 ${p.size * 6}px ${p.color}`,
            animationDuration: p.duration,
            animationDelay: p.delay,
          }}
        />
      ))}
    </div>
  );
});
