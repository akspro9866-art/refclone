import React, { useMemo } from 'react';
import { Audio, staticFile, useVideoConfig } from 'remotion';
import { WordItem } from './KineticWords';

/**
 * Membangun envelope ducking per frame sesuai SOUND.md:
 * - Musik turun ke ~0.35 (-9 dB) mulai 6 frame sebelum kata pertama frasa
 * - Naik kembali 15 frame setelah kata terakhir
 * - Dihaluskan dengan moving average 6 frame supaya tidak patah
 */
export function buildDuckEnvelope(
  words: { startMs: number; endMs: number }[],
  fps: number,
  totalFrames: number,
  duckRatio = 0.35
): number[] {
  const env = new Array<number>(Math.max(1, totalFrames)).fill(1);

  for (const w of words) {
    const startFrame = Math.round((w.startMs / 1000) * fps) - 6;
    const endFrame = Math.round((w.endMs / 1000) * fps) + 15;
    for (
      let f = Math.max(0, startFrame);
      f < Math.min(totalFrames, endFrame);
      f++
    ) {
      env[f] = duckRatio;
    }
  }

  // Moving average 7-point window (-3..+3)
  return env.map((_, idx) => {
    const a = Math.max(0, idx - 3);
    const b = Math.min(totalFrames - 1, idx + 3);
    let sum = 0;
    for (let k = a; k <= b; k++) {
      sum += env[k];
    }
    return sum / (b - a + 1);
  });
}

export interface AudioStageProps {
  /** Path di dalam public/, misal 'audio/bed.wav' */
  bedSrc?: string;
  /** Path di dalam public/, misal 'audio/music.wav' */
  musicSrc?: string;
  /** Path di dalam public/, misal 'audio/sfx-track.wav' (hasil mix dari scripts/synth-audio.mjs) */
  sfxTrackSrc?: string;
  /** Path di dalam public/, misal 'audio/narration.wav' */
  narrationSrc?: string;
  /** Data kata untuk menghitung auto-ducking musik */
  words?: WordItem[];
  /** Volume dasar musik (default 0.52 tanpa narasi, otomatis ducking saat ada narasi) */
  baseMusicVolume?: number;
  /** Volume dasar bed/room tone (sekitar -34 LUFS -> ~0.08) */
  bedVolume?: number;
  /** Volume track SFX (default 0.85) */
  sfxVolume?: number;
  /** Volume narator (default 1.0) */
  narrationVolume?: number;
}

/**
 * Panggung Audio 5-Lapis sesuai SOUND.md:
 * Menggunakan satu elemen <Audio> per lapisan (Bed, Musik dengan Ducking + Fade In/Out, SFX Track, dan Narasi).
 */
export const AudioStage: React.FC<AudioStageProps> = ({
  bedSrc = 'audio/bed.wav',
  musicSrc = 'audio/music.wav',
  sfxTrackSrc = 'audio/sfx-track.wav',
  narrationSrc,
  words = [],
  baseMusicVolume = 0.48,
  bedVolume = 0.08,
  sfxVolume = 0.85,
  narrationVolume = 1.0,
}) => {
  const { fps, durationInFrames } = useVideoConfig();

  const duckEnvelope = useMemo(
    () => buildDuckEnvelope(words, fps, durationInFrames, narrationSrc || words.length > 0 ? 0.32 : 1.0),
    [words, fps, durationInFrames, narrationSrc]
  );

  const fadeInFrames = Math.round(fps * 0.5);
  const fadeOutFrames = Math.round(fps * 1.4);

  return (
    <>
      {/* 1. Room Tone / Bed tipis agar tidak pernah ada detik sunyi mati */}
      {bedSrc && <Audio src={staticFile(bedSrc)} volume={bedVolume} />}

      {/* 2. Musik Backsound dengan Auto-Ducking & Fade In/Out */}
      {musicSrc && (
        <Audio
          src={staticFile(musicSrc)}
          volume={(f) => {
            const duck = duckEnvelope[Math.min(f, duckEnvelope.length - 1)] ?? 1;
            const fadeIn = Math.min(1, f / Math.max(1, fadeInFrames));
            const rem = durationInFrames - f;
            const fadeOut = Math.min(1, rem / Math.max(1, fadeOutFrames));
            return baseMusicVolume * duck * fadeIn * fadeOut;
          }}
        />
      )}

      {/* 3. Pre-mixed SFX + Stinger + Riser Track */}
      {sfxTrackSrc && <Audio src={staticFile(sfxTrackSrc)} volume={sfxVolume} />}

      {/* 4. Suara Narator / Voiceover */}
      {narrationSrc && <Audio src={staticFile(narrationSrc)} volume={narrationVolume} />}
    </>
  );
};
