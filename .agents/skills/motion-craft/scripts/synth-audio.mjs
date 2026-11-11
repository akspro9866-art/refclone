#!/usr/bin/env node
/**
 * scripts/synth-audio.mjs
 * Studio-Grade Multi-Chord Song Synthesizer (B00-B39 = 40 Pilihan Lagu)
 * + Real CC0 Studio SFX Bundler & Pack Synthesizer (48,000 Hz Stereo WAV)
 *
 * Fitur Utama:
 * 1. Menyalin seluruh koleksi SFX Studio CC0 asli (termasuk 9 SFX Transisi baru, 4 SFX Ketikan asli,
 *    6 SFX Klik/Toggle/Hover, 5 SFX Pop/Plop, 3 SFX Ding/Chime, dan 5 SFX Impact/Riser) ke `<outDir>/sfx/`.
 * 2. Mensintesis SFX Pack tematik (K1-K8 Kertas, M1-M8 Mekanik, A1-A7 Analog, R1-R5 Arcade, O1-O7 Organik,
 *    J1-J5 Jalanan, C1-C5 Sinema, Y1-Y6 Komik, serta `progress-loop.wav`).
 * 3. Menghasilkan 40 Pilihan Lagu Backsound (`B00` s/d `B39`) dengan progresi 4-akor harmonis,
 *    bassline, Rhodes/pad chord voicing, lead arpeggio/melodi, dan drum groove spesifik genre.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATERIAL_SFX, synthesizeMaterialSfx } from './material-sfx.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, '..');
const BUNDLED_SFX_DIR = path.join(SKILL_ROOT, 'assets', 'audio', 'sfx');

const SAMPLE_RATE = 48000;

function mulberry32(seedStr = 'antislop-audio') {
  let a = 0;
  for (let i = 0; i < seedStr.length; i++) {
    a = (a * 31 + seedStr.charCodeAt(i)) | 0;
  }
  if (a === 0) a = 987654321;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function writeStereoWav(filePath, left, right, sampleRate = SAMPLE_RATE) {
  const numSamples = Math.min(left.length, right.length);
  const dataSize = numSamples * 4;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const l = Math.tanh(left[i]) * 0.88;
    const r = Math.tanh(right[i]) * 0.88;
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(l * 32767))), offset);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(r * 32767))), offset + 2);
    offset += 4;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buf);
}

function osc(type, phase) {
  const p = phase - Math.floor(phase);
  switch (type) {
    case 'sine':
      return Math.sin(p * 2 * Math.PI);
    case 'saw':
      return 2 * p - 1;
    case 'square':
      return p < 0.5 ? 1 : -1;
    case 'triangle':
      return 1 - 4 * Math.abs(Math.round(p - 0.25) - (p - 0.25));
    case 'rhodes':
      return (
        Math.sin(p * 2 * Math.PI) * 0.72 +
        Math.sin(p * 4 * Math.PI) * 0.2 +
        Math.sin(p * 6 * Math.PI) * 0.08
      );
    case 'marimba':
      return (
        Math.sin(p * 2 * Math.PI) * 0.82 +
        Math.sin(p * 8 * Math.PI) * 0.18
      );
    default:
      return Math.sin(p * 2 * Math.PI);
  }
}

function filterLP(samples, cutoffHz) {
  const out = new Float32Array(samples.length);
  const rc = 1.0 / (2 * Math.PI * Math.max(20, cutoffHz));
  const dt = 1.0 / SAMPLE_RATE;
  const alpha = dt / (rc + dt);
  let prev = 0;
  for (let i = 0; i < samples.length; i++) {
    prev = prev + alpha * (samples[i] - prev);
    out[i] = prev;
  }
  return out;
}

function filterHP(samples, cutoffHz) {
  const lp = filterLP(samples, cutoffHz);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i] - lp[i];
  }
  return out;
}

/**
 * Sintesis SFX Spesifik Pack (Kertas, Mekanik, Digital, Analog, Arcade, Organik, Jalanan, Sinema, Komik)
 */
function synthesizePackSfx(code, variant = 0, seed = 'sfx') {
  const rand = mulberry32(`${seed}-${code}-${variant}`);
  const pitchShift = 1 + (variant - 1.5) * 0.06;

  // D3: Counter / Progress Tick
  if (code === 'D3') {
    const dur = 0.022;
    const len = Math.floor(dur * SAMPLE_RATE);
    const buf = new Float32Array(len);
    const freq = 980 * pitchShift;
    for (let i = 0; i < len; i++) {
      const t = i / SAMPLE_RATE;
      const env = Math.exp(-t * 185);
      buf[i] = (osc('triangle', t * freq) * 0.7 + osc('sine', t * freq * 2) * 0.3) * env * 0.5;
    }
    return buf;
  }

  // D9: Mechanical Keypress
  if (code === 'D9') {
    const dur = 0.026;
    const len = Math.floor(dur * SAMPLE_RATE);
    const buf = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const t = i / SAMPLE_RATE;
      const switchClick = (rand() * 2 - 1) * Math.exp(-t * 280) * 0.55;
      const bodyThock = osc('sine', t * 440 * pitchShift) * Math.exp(-t * 130) * 0.6;
      buf[i] = (switchClick + bodyThock) * 0.55;
    }
    return filterLP(buf, 3600);
  }

  // K1-K8: Pack Kertas (Geser, Tempel, Sobek, Stempel, Marker)
  if (code.startsWith('K')) {
    const dur = code === 'K3' ? 0.28 : code === 'K4' ? 0.16 : 0.18;
    const len = Math.floor(dur * SAMPLE_RATE);
    const buf = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const t = i / SAMPLE_RATE;
      const env = Math.sin((t / dur) * Math.PI) * Math.exp(-t * 12);
      const body = code === 'K4' ? osc('sine', t * 95) * Math.exp(-t * 35) * 0.7 : 0;
      const friction = (rand() * 2 - 1) * (0.5 + 0.5 * Math.sin(t * 90)) * 0.55;
      buf[i] = (body + friction) * env * 0.65;
    }
    return filterHP(filterLP(buf, 5200), 400);
  }

  // M1-M8: Pack Mekanik (Split-Flap Clack, Mesin Ketik, Servo, Ratchet)
  if (code.startsWith('M')) {
    const dur = code === 'M1' ? 0.048 : 0.14;
    const len = Math.floor(dur * SAMPLE_RATE);
    const buf = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const t = i / SAMPLE_RATE;
      const env = Math.exp(-t * 95);
      buf[i] = ((rand() * 2 - 1) * 0.65 + osc('triangle', t * 2100 * pitchShift) * 0.35) * env * 0.65;
    }
    return filterLP(buf, 3800);
  }

  // R1-R5: Pack Arcade (Coin, Jump, Powerup)
  if (code.startsWith('R')) {
    const dur = 0.18;
    const len = Math.floor(dur * SAMPLE_RATE);
    const buf = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const t = i / SAMPLE_RATE;
      const f = t < 0.06 ? 987.77 : 1318.51;
      const env = Math.exp(-t * 16);
      buf[i] = osc('square', t * f * pitchShift) * env * 0.4;
    }
    return filterLP(buf, 4200);
  }

  // O1-O7: Pack Organik (Squish, Boing, Tetes Air, Marimba Hit)
  if (code.startsWith('O') || code.startsWith('Y')) {
    const dur = 0.22;
    const len = Math.floor(dur * SAMPLE_RATE);
    const buf = new Float32Array(len);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SAMPLE_RATE;
      const f = (280 + Math.sin(t * 45) * 140 + (t / dur) * 260) * pitchShift;
      phase += f / SAMPLE_RATE;
      const env = Math.exp(-t * 14);
      buf[i] = osc('sine', phase) * env * 0.6;
    }
    return buf;
  }

  // U7 / U9 / U10
  if (code === 'U9') {
    const dur = 1.25;
    const len = Math.floor(dur * SAMPLE_RATE);
    const buf = new Float32Array(len);
    const freqs = [261.63, 329.63, 392.0, 523.25];
    for (let i = 0; i < len; i++) {
      const t = i / SAMPLE_RATE;
      const env = Math.exp(-t * 3.2);
      let s = 0;
      for (const f of freqs) s += osc('rhodes', t * f) * 0.22;
      buf[i] = s * env * 0.7;
    }
    return buf;
  }

  const dur = 0.24;
  const len = Math.floor(dur * SAMPLE_RATE);
  const buf = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * 20);
    buf[i] = (osc('sine', t * 120 * pitchShift) * 0.7 + (rand() * 2 - 1) * 0.3) * env * 0.55;
  }
  return filterLP(buf, 2800);
}

function synthesizeProgressLoopTrack(durationSec = 5, seed = 'progress-loop') {
  const len = Math.floor(durationSec * SAMPLE_RATE);
  const left = new Float32Array(len);
  const right = new Float32Array(len);

  let tSec = 0.02;
  let step = 0;
  while (tSec < durationSec - 0.05) {
    const progressRatio = tSec / durationSec;
    const tick = synthesizePackSfx('D3', Math.floor(progressRatio * 8), `${seed}-${step}`);
    const startSample = Math.floor(tSec * SAMPLE_RATE);
    for (let i = 0; i < tick.length && startSample + i < len; i++) {
      left[startSample + i] += tick[i] * 0.55;
      right[startSample + i] += tick[i] * 0.55;
    }
    tSec += 0.072;
    step++;
  }
  return { left, right };
}

function synthesizeRoomToneBed(durationSec, seed = 'room-bed') {
  const rand = mulberry32(seed);
  const len = Math.floor(durationSec * SAMPLE_RATE);
  const left = new Float32Array(len);
  const right = new Float32Array(len);

  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    const lowHum = Math.sin(2 * Math.PI * 55 * t) * 0.01 + Math.sin(2 * Math.PI * 110 * t) * 0.005;
    const pinkL = (rand() * 2 - 1) * 0.015;
    const pinkR = (rand() * 2 - 1) * 0.015;
    left[i] = lowHum + pinkL;
    right[i] = lowHum + pinkR;
  }
  return { left: filterLP(left, 900), right: filterLP(right, 900) };
}

/**
 * 4-Chord Harmonic Progressions (Freqs in Hz for 4 bars)
 */
const CHORD_PROGRESSIONS = {
  // Am9 -> Fmaj7 -> Cmaj9 -> G6 (Warm Modern SaaS / Tech / Lo-Fi)
  warmModern: [
    { root: 110.0, chord: [220.0, 261.63, 329.63, 392.0, 493.88] },
    { root: 87.31, chord: [174.61, 220.0, 261.63, 329.63, 392.0] },
    { root: 130.81, chord: [261.63, 329.63, 392.0, 493.88, 587.33] },
    { root: 98.0, chord: [196.0, 246.94, 293.66, 329.63, 392.0] },
  ],
  // Dm9 -> G13 -> Cmaj9 -> A7alt (Jazz / Neo-Soul / Editorial / Lounge)
  jazzEditorial: [
    { root: 73.42, chord: [146.83, 174.61, 220.0, 261.63, 329.63] },
    { root: 98.0, chord: [196.0, 246.94, 293.66, 349.23, 440.0] },
    { root: 130.81, chord: [261.63, 329.63, 392.0, 493.88, 587.33] },
    { root: 110.0, chord: [220.0, 277.18, 329.63, 392.0, 466.16] },
  ],
  // Fm -> Db -> Eb -> Cm (Synthwave / Cyberpunk / Dark Tech / Phonk)
  darkCyber: [
    { root: 87.31, chord: [174.61, 207.65, 261.63, 311.13] },
    { root: 69.3, chord: [138.59, 174.61, 207.65, 261.63] },
    { root: 77.78, chord: [155.56, 196.0, 233.08, 293.66] },
    { root: 65.41, chord: [130.81, 155.56, 196.0, 233.08] },
  ],
  // C -> G -> Am -> F (Upbeat / Marimba / Indie Pop / Ukulele)
  brightUpbeat: [
    { root: 130.81, chord: [261.63, 329.63, 392.0, 523.25] },
    { root: 98.0, chord: [196.0, 246.94, 293.66, 392.0] },
    { root: 110.0, chord: [220.0, 261.63, 329.63, 440.0] },
    { root: 87.31, chord: [174.61, 220.0, 261.63, 349.23] },
  ],
  // Nusantara Slendro/Pelog Inspired Pentatonic Cycle
  nusantaraCycle: [
    { root: 130.81, chord: [261.63, 298.0, 342.0, 402.0, 460.0] },
    { root: 114.0, chord: [228.0, 261.63, 342.0, 402.0, 523.25] },
    { root: 100.5, chord: [201.0, 261.63, 298.0, 402.0, 460.0] },
    { root: 130.81, chord: [261.63, 342.0, 402.0, 460.0, 523.25] },
  ],
};

/**
 * Katalog Lengkap 40 Pilihan Lagu Backsound (B00 s/d B39)
 */
export const BGM_CATALOG = {
  // Original B00 - B24 (Diperkaya dengan Progresi 4-Akor)
  B00: { name: 'Room Tone Ambience', bpm: 70, prog: 'warmModern', drum: 'none', wave: 'sine', cutoff: 900 },
  B01: { name: 'Lo-Fi Dusty Rhodes', bpm: 84, prog: 'jazzEditorial', drum: 'lofi', wave: 'rhodes', cutoff: 2400 },
  B02: { name: 'Synthwave Night Drive', bpm: 110, prog: 'darkCyber', drum: 'fourfloor', wave: 'saw', cutoff: 3800 },
  B03: { name: 'Dark Sub & Pulse', bpm: 98, prog: 'darkCyber', drum: 'halftime', wave: 'saw', cutoff: 1800 },
  B04: { name: 'Glitch Electro Cut', bpm: 124, prog: 'darkCyber', drum: 'fourfloor', wave: 'square', cutoff: 4200 },
  B05: { name: 'Boom-Bap Street', bpm: 90, prog: 'jazzEditorial', drum: 'boombap', wave: 'rhodes', cutoff: 2800 },
  B06: { name: 'Halftime 808 Trap', bpm: 140, prog: 'darkCyber', drum: 'halftime', wave: 'triangle', cutoff: 3200 },
  B07: { name: 'Funk Bounce Groove', bpm: 110, prog: 'jazzEditorial', drum: 'fourfloor', wave: 'rhodes', cutoff: 3900 },
  B08: { name: 'Playful Marimba Studio', bpm: 116, prog: 'brightUpbeat', drum: 'minimal', wave: 'marimba', cutoff: 4500 },
  B09: { name: 'Minimal Tech Pulse', bpm: 122, prog: 'warmModern', drum: 'fourfloor', wave: 'rhodes', cutoff: 3800 },
  B10: { name: 'Warm Ambient Pad', bpm: 68, prog: 'warmModern', drum: 'none', wave: 'rhodes', cutoff: 2100 },
  B11: { name: 'Cinematic Tension', bpm: 78, prog: 'darkCyber', drum: 'minimal', wave: 'saw', cutoff: 2200 },
  B12: { name: 'Synthetic Orchestra', bpm: 112, prog: 'warmModern', drum: 'taiko', wave: 'saw', cutoff: 3400 },
  B13: { name: '8-Bit Chiptune Arcade', bpm: 140, prog: 'brightUpbeat', drum: 'fourfloor', wave: 'square', cutoff: 4800 },
  B14: { name: 'Cool Jazz Brush Swing', bpm: 118, prog: 'jazzEditorial', drum: 'lofi', wave: 'rhodes', cutoff: 3200 },
  B15: { name: 'Vintage Ragtime Stride', bpm: 106, prog: 'brightUpbeat', drum: 'lofi', wave: 'triangle', cutoff: 3500 },
  B16: { name: 'Exotica Vibraphone Lounge', bpm: 98, prog: 'jazzEditorial', drum: 'minimal', wave: 'marimba', cutoff: 3400 },
  B17: { name: 'Nusantara Metallophone', bpm: 78, prog: 'nusantaraCycle', drum: 'minimal', wave: 'marimba', cutoff: 3600 },
  B18: { name: 'Industrial Mechanica', bpm: 118, prog: 'darkCyber', drum: 'fourfloor', wave: 'saw', cutoff: 3100 },
  B19: { name: 'Warm Acoustic Pluck', bpm: 92, prog: 'brightUpbeat', drum: 'minimal', wave: 'triangle', cutoff: 3600 },
  B20: { name: 'Deep Mystery Drone', bpm: 64, prog: 'darkCyber', drum: 'none', wave: 'saw', cutoff: 1400 },
  B21: { name: 'Clean Corporate Editorial', bpm: 108, prog: 'warmModern', drum: 'minimal', wave: 'rhodes', cutoff: 3900 },
  B22: { name: 'Fast Breakbeat Kinetic', bpm: 158, prog: 'darkCyber', drum: 'breakbeat', wave: 'saw', cutoff: 4400 },
  B23: { name: 'Taiko & Rim Percussion', bpm: 108, prog: 'darkCyber', drum: 'taiko', wave: 'marimba', cutoff: 3000 },
  B24: { name: 'Precision Clockwork Tick', bpm: 112, prog: 'warmModern', drum: 'clockwork', wave: 'marimba', cutoff: 4000 },

  // 15 PILIHAN LAGU BARU (B25 - B39) — Gaya Modern Viral Reels, Keynote, & SaaS Demos
  B25: { name: 'Apple Keynote Minimal Pluck', bpm: 116, prog: 'warmModern', drum: 'minimal', wave: 'marimba', cutoff: 4200 },
  B26: { name: 'Framer / Linear SaaS Groove', bpm: 122, prog: 'warmModern', drum: 'fourfloor', wave: 'rhodes', cutoff: 4100 },
  B27: { name: 'Vox Documentary Piano & Pulse', bpm: 104, prog: 'jazzEditorial', drum: 'clockwork', wave: 'rhodes', cutoff: 3400 },
  B28: { name: 'Phonk / Drift High Energy', bpm: 135, prog: 'darkCyber', drum: 'halftime', wave: 'square', cutoff: 3800 },
  B29: { name: 'UK Garage / 2-Step Tech', bpm: 132, prog: 'jazzEditorial', drum: 'garage', wave: 'rhodes', cutoff: 3900 },
  B30: { name: 'Bedroom Indie Dream Synth', bpm: 110, prog: 'brightUpbeat', drum: 'boombap', wave: 'rhodes', cutoff: 3300 },
  B31: { name: 'Neo-Soul Coffeehouse Rhodes', bpm: 88, prog: 'jazzEditorial', drum: 'lofi', wave: 'rhodes', cutoff: 2600 },
  B32: { name: 'Liquid Drum & Bass Flow', bpm: 168, prog: 'warmModern', drum: 'breakbeat', wave: 'rhodes', cutoff: 4200 },
  B33: { name: 'Future Bass Uplifting Showcase', bpm: 138, prog: 'brightUpbeat', drum: 'halftime', wave: 'saw', cutoff: 4500 },
  B34: { name: 'Bossa Nova Sore Santai', bpm: 114, prog: 'jazzEditorial', drum: 'minimal', wave: 'triangle', cutoff: 3200 },
  B35: { name: 'Dark Matrix Techno', bpm: 128, prog: 'darkCyber', drum: 'fourfloor', wave: 'saw', cutoff: 3400 },
  B36: { name: 'Sunny Acoustic Explainer', bpm: 112, prog: 'brightUpbeat', drum: 'minimal', wave: 'marimba', cutoff: 4400 },
  B37: { name: 'Cinematic Hybrid Launch', bpm: 96, prog: 'warmModern', drum: 'taiko', wave: 'saw', cutoff: 3600 },
  B38: { name: '80s Vaporwave Mallsoft', bpm: 82, prog: 'jazzEditorial', drum: 'lofi', wave: 'rhodes', cutoff: 2300 },
  B39: { name: 'Upbeat Nu-Disco Funk', bpm: 118, prog: 'brightUpbeat', drum: 'fourfloor', wave: 'rhodes', cutoff: 4300 },
};

function synthesizeBgmTrack(bgmCode = 'B09', durationSec = 15, seed = 'antislop-bgm') {
  const cfg = BGM_CATALOG[bgmCode] || BGM_CATALOG.B09;
  if (bgmCode === 'B00') {
    return synthesizeRoomToneBed(durationSec, seed);
  }

  const progression = CHORD_PROGRESSIONS[cfg.prog] || CHORD_PROGRESSIONS.warmModern;
  const rand = mulberry32(`${seed}-${bgmCode}`);
  const len = Math.floor(durationSec * SAMPLE_RATE);
  const left = new Float32Array(len);
  const right = new Float32Array(len);

  const stepSec = 60 / cfg.bpm / 4; // 16th note
  const totalSteps = Math.ceil(durationSec / stepSec);

  for (let step = 0; step < totalSteps; step++) {
    const startSample = Math.floor(step * stepSec * SAMPLE_RATE);
    if (startSample >= len) break;

    const barIndex = Math.floor(step / 16) % progression.length;
    const stepInBar = step % 16;
    const currentBar = progression[barIndex];

    // 1. LAYER DRUM GROOVE
    if (cfg.drum !== 'none') {
      const isKick =
        (cfg.drum === 'fourfloor' && stepInBar % 4 === 0) ||
        (cfg.drum === 'boombap' && (stepInBar === 0 || stepInBar === 7 || stepInBar === 10)) ||
        (cfg.drum === 'lofi' && (stepInBar === 0 || stepInBar === 9)) ||
        (cfg.drum === 'garage' && (stepInBar === 0 || stepInBar === 6 || stepInBar === 10)) ||
        (cfg.drum === 'breakbeat' && (stepInBar === 0 || stepInBar === 10)) ||
        (cfg.drum === 'halftime' && (stepInBar === 0 || stepInBar === 11)) ||
        (cfg.drum === 'taiko' && (stepInBar === 0 || stepInBar === 6 || stepInBar === 12)) ||
        (cfg.drum === 'minimal' && (stepInBar === 0 || stepInBar === 8));

      if (isKick) {
        const kickLen = Math.min(Math.floor(0.26 * SAMPLE_RATE), len - startSample);
        let kPhase = 0;
        for (let i = 0; i < kickLen; i++) {
          const t = i / SAMPLE_RATE;
          const f = 45 + 100 * Math.exp(-t * 30);
          kPhase += f / SAMPLE_RATE;
          const env = Math.exp(-t * 12);
          const s = Math.sin(kPhase * 2 * Math.PI) * env * 0.38;
          left[startSample + i] += s;
          right[startSample + i] += s;
        }
      }

      // Snare / Rimshot pada ketukan 4 dan 12 (atau 8 pada halftime)
      const isSnare =
        cfg.drum === 'halftime'
          ? stepInBar === 8
          : cfg.drum === 'garage'
          ? stepInBar === 4 || stepInBar === 12 || stepInBar === 15
          : stepInBar === 4 || stepInBar === 12;

      if (isSnare && cfg.drum !== 'clockwork') {
        const snareLen = Math.min(Math.floor(0.14 * SAMPLE_RATE), len - startSample);
        const snareGain = cfg.drum === 'minimal' || cfg.drum === 'lofi' ? 0.14 : 0.22;
        for (let i = 0; i < snareLen; i++) {
          const t = i / SAMPLE_RATE;
          const body = Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 35) * 0.5;
          const snap = (rand() * 2 - 1) * Math.exp(-t * 28) * 0.6;
          const s = (body + snap) * snareGain;
          left[startSample + i] += s * 0.95;
          right[startSample + i] += s * 1.05;
        }
      }

      // Hi-hat / Shaker / Clock tick
      if (stepInBar % 2 === 0 || cfg.drum === 'breakbeat' || cfg.drum === 'clockwork') {
        const hatLen = Math.min(Math.floor(0.035 * SAMPLE_RATE), len - startSample);
        const hatGain = stepInBar % 4 === 2 ? 0.09 : 0.045;
        for (let i = 0; i < hatLen; i++) {
          const t = i / SAMPLE_RATE;
          const n = (rand() * 2 - 1) * Math.exp(-t * 110) * hatGain;
          left[startSample + i] += n * 0.85;
          right[startSample + i] += n * 1.15;
        }
      }
    }

    // 2. LAYER WARM CHORD PAD / RHODES (Setiap awal bar / setengah bar)
    if (stepInBar === 0 || (stepInBar === 8 && cfg.drum !== 'none')) {
      const chordDur = stepSec * (stepInBar === 0 ? 8.5 : 7.5);
      const chordLen = Math.min(Math.floor(chordDur * SAMPLE_RATE), len - startSample);
      for (let i = 0; i < chordLen; i++) {
        const t = i / SAMPLE_RATE;
        const attack = Math.min(1, t / 0.04);
        const decay = Math.exp(-t * 1.65);
        const env = attack * decay * 0.14;
        let chL = 0;
        let chR = 0;
        currentBar.chord.forEach((freq, idx) => {
          const sig = osc(cfg.wave, t * freq);
          if (idx % 2 === 0) {
            chL += sig * 0.7;
            chR += sig * 0.3;
          } else {
            chL += sig * 0.3;
            chR += sig * 0.7;
          }
        });
        left[startSample + i] += chL * env;
        right[startSample + i] += chR * env;
      }
    }

    // 3. LAYER BASSLINE (Mengikuti Root & Fifth dari Chord Aktif)
    if (stepInBar === 0 || stepInBar === 3 || stepInBar === 6 || stepInBar === 10 || stepInBar === 12) {
      const bassFreq = stepInBar === 10 ? currentBar.root * 1.5 : currentBar.root;
      const bassDur = stepSec * 2.4;
      const bassLen = Math.min(Math.floor(bassDur * SAMPLE_RATE), len - startSample);
      for (let i = 0; i < bassLen; i++) {
        const t = i / SAMPLE_RATE;
        const env = Math.min(1, t / 0.008) * Math.exp(-t * 6.5);
        const sub = osc('sine', t * bassFreq) * 0.24 + osc('triangle', t * bassFreq * 2) * 0.09;
        left[startSample + i] += sub * env;
        right[startSample + i] += sub * env;
      }
    }

    // 4. LAYER LEAD MELODIC ARPEGGIO / PLUCK MOTIF
    if (stepInBar % 2 === 0 || (stepInBar === 7 && rand() > 0.3)) {
      const noteIdx = (stepInBar / 2 + barIndex) % currentBar.chord.length;
      const noteFreq = currentBar.chord[Math.floor(noteIdx)];
      const noteDur = stepSec * 2.2;
      const noteLen = Math.min(Math.floor(noteDur * SAMPLE_RATE), len - startSample);
      const pan = 0.3 + ((stepInBar * 7) % 5) * 0.1;

      for (let i = 0; i < noteLen; i++) {
        const t = i / SAMPLE_RATE;
        const env = Math.min(1, t / 0.004) * Math.exp(-t * 7.5);
        let sig = osc(cfg.wave, t * noteFreq) * 0.16;
        if (cfg.prog === 'nusantaraCycle') {
          sig += osc('sine', t * noteFreq * 2.76) * 0.06 * Math.exp(-t * 14);
        }
        left[startSample + i] += sig * env * pan;
        right[startSample + i] += sig * env * (1 - pan);
      }
    }
  }

  return {
    left: filterLP(left, cfg.cutoff || 3800),
    right: filterLP(right, cfg.cutoff || 3800),
  };
}

function buildEventDrivenSfxTrack(cues = [], durationSec = 15, fps = 30, seed = 'sfx-mix') {
  const len = Math.floor(durationSec * SAMPLE_RATE);
  const left = new Float32Array(len);
  const right = new Float32Array(len);

  function placeSound(buf, timeSec, gain = 0.5, pan = 0.5) {
    const startIdx = Math.max(0, Math.floor(timeSec * SAMPLE_RATE));
    for (let i = 0; i < buf.length && startIdx + i < len; i++) {
      left[startIdx + i] += buf[i] * gain * (1 - pan * 0.4);
      right[startIdx + i] += buf[i] * gain * (0.6 + pan * 0.4);
    }
  }

  for (const cue of cues) {
    const tSec = Math.max(0, (cue.frame ?? 0) / fps);
    const buf = synthesizePackSfx(cue.code || 'D3', 0, seed);
    placeSound(buf, tSec, cue.gain ?? 0.45, 0.5);
  }

  return { left, right };
}

function copyBundledStudioSfx(destSfxDir) {
  fs.mkdirSync(destSfxDir, { recursive: true });
  if (!fs.existsSync(BUNDLED_SFX_DIR)) return 0;
  let copied = 0;
  for (const entry of fs.readdirSync(BUNDLED_SFX_DIR)) {
    if (entry.endsWith('.wav')) {
      const s = path.join(BUNDLED_SFX_DIR, entry);
      const d = path.join(destSfxDir, entry);
      if (path.resolve(s) !== path.resolve(d)) {
        fs.copyFileSync(s, d);
      }
      copied++;
    }
  }
  return copied;
}

function parseArgs(argv) {
  const args = {
    bgm: 'B26',
    sfxPack: 'S-DIGITAL',
    duration: 15,
    fps: 30,
    outDir: 'public/audio',
    cuesFile: 'public/sfx-cues.json',
    seed: 'antislop-2026',
    listBgm: false,
    bundleSongs: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--bgm' && v) args.bgm = v.toUpperCase();
    if (k === '--sfx' && v) args.sfxPack = v.toUpperCase();
    if (k === '--duration' && v) args.duration = Number(v);
    if (k === '--fps' && v) args.fps = Number(v);
    if (k === '--out' && v) args.outDir = v;
    if (k === '--cues' && v) args.cuesFile = v;
    if (k === '--seed' && v) args.seed = v;
    if (k === '--list-bgm') args.listBgm = true;
    if (k === '--bundle-songs') args.bundleSongs = true;
  }
  return args;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('synth-audio.mjs')) {
  const opts = parseArgs(process.argv);

  if (opts.listBgm) {
    console.log('\n=== 40 PILIHAN LAGU BACKSOUND PROSEDURAL (B00 - B39) ===');
    for (const [code, meta] of Object.entries(BGM_CATALOG)) {
      console.log(`  ${code} | ${meta.name} (${meta.bpm} BPM, ${meta.prog}, drum: ${meta.drum})`);
    }
    process.exit(0);
  }

  const outPath = path.resolve(process.cwd(), opts.outDir);
  const sfxOutDir = path.join(outPath, 'sfx');
  fs.mkdirSync(sfxOutDir, { recursive: true });

  // 1. Salin aset WAV yang dibundel.
  const copiedCount = copyBundledStudioSfx(sfxOutDir);

  // 2. Sintesis tambahan Pack SFX (Kertas, Mekanik, Arcade, Organik, dll.) + progress-loop.wav
  const progressLoop = synthesizeProgressLoopTrack(5, opts.seed);
  writeStereoWav(path.join(sfxOutDir, 'progress-loop.wav'), progressLoop.left, progressLoop.right);

  const extraPackCodes = [
    'D3', 'D9', 'U7', 'U9', 'U10',
    'K1', 'K2', 'K3', 'K4', 'K5',
    'M1', 'M2', 'M3', 'M4',
    'R1', 'R2', 'R3',
    'O1', 'O2', 'O3', 'O5',
  ];
  for (const code of extraPackCodes) {
    const file = path.join(sfxOutDir, `${code.toLowerCase()}.wav`);
    const mono = synthesizePackSfx(code, 0, opts.seed);
    writeStereoWav(file, mono, mono);
  }

  for (const [name, recipe] of Object.entries(MATERIAL_SFX)) {
    const mono = synthesizeMaterialSfx(recipe, SAMPLE_RATE, mulberry32(`${opts.seed}-${name}`));
    writeStereoWav(path.join(sfxOutDir, `${name}.wav`), mono, mono);
  }

  // 3. Sintesis Room Tone Bed & Lagu Backsound Utama
  const bed = synthesizeRoomToneBed(opts.duration, opts.seed);
  writeStereoWav(path.join(outPath, 'bed.wav'), bed.left, bed.right);

  const music = synthesizeBgmTrack(opts.bgm, opts.duration, opts.seed);
  writeStereoWav(path.join(outPath, 'music.wav'), music.left, music.right);

  let cues = [];
  const resolvedCues = path.resolve(process.cwd(), opts.cuesFile);
  if (fs.existsSync(resolvedCues)) {
    try {
      cues = JSON.parse(fs.readFileSync(resolvedCues, 'utf8'));
    } catch {
      cues = [];
    }
  }
  const sfxMix = buildEventDrivenSfxTrack(cues, opts.duration, opts.fps, opts.seed);
  writeStereoWav(path.join(outPath, 'sfx-track.wav'), sfxMix.left, sfxMix.right);

  // 4. Jika --bundle-songs diberikan, generate juga 8 pilihan lagu populer siap pakai di <outDir>/songs/
  if (opts.bundleSongs) {
    const featuredSongs = [
      { code: 'B01', slug: 'B01-lofi-dusty-rhodes.wav' },
      { code: 'B02', slug: 'B02-synthwave-night-drive.wav' },
      { code: 'B09', slug: 'B09-minimal-tech-pulse.wav' },
      { code: 'B21', slug: 'B21-clean-corporate-editorial.wav' },
      { code: 'B25', slug: 'B25-apple-keynote-pluck.wav' },
      { code: 'B26', slug: 'B26-framer-linear-saas-groove.wav' },
      { code: 'B27', slug: 'B27-vox-documentary-piano.wav' },
      { code: 'B29', slug: 'B29-uk-garage-2step-tech.wav' },
    ];
    for (const song of featuredSongs) {
      const trk = synthesizeBgmTrack(song.code, opts.duration, opts.seed);
      writeStereoWav(path.join(outPath, 'songs', song.slug), trk.left, trk.right);
    }
  }

  const totalSfxFiles = fs.readdirSync(sfxOutDir).filter((f) => f.endsWith('.wav')).length;
  console.log(
    `[synth-audio] Done! Song: ${opts.bgm} (${BGM_CATALOG[opts.bgm]?.name || 'Custom'}) | ${totalSfxFiles} SFX files ready in ${sfxOutDir} (${copiedCount} bundled files, plus synthesized sounds).`
  );
}
