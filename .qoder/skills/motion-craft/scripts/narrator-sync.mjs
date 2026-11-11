#!/usr/bin/env node
/**
 * scripts/narrator-sync.mjs
 * Generator Suara Narator & Peta Kata (words.json + research/word-map.md)
 * Mendukung:
 * 1. Konversi naskah (--text "...") menjadi public/words.json dengan timestamp kata-per-kata,
 *    peran hierarki (keyword/support/connector), dan 10 efek kata yang tidak pernah berulang berurutan.
 * 2. Opsional: Sintesis suara narator menggunakan Edge-TTS jika tersedia (--tts --voice N01..N05).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VOICE_PROFILES = {
  N01: { voice: 'id-ID-ArdiNeural', rate: '+5%', pitch: '-2Hz', desc: 'Editorial Hangat (ID Pria)' },
  N02: { voice: 'id-ID-GadisNeural', rate: '+10%', pitch: '+2Hz', desc: 'Kreatif Energik (ID Wanita)' },
  N03: { voice: 'id-ID-ArdiNeural', rate: '-5%', pitch: '-6Hz', desc: 'Dokumenter Sinematik (ID Pria Dalam)' },
  N04: { voice: 'en-US-ChristopherNeural', rate: '+8%', pitch: '+0Hz', desc: 'Tech Explainer Cepat (EN Male)' },
  N05: { voice: 'en-US-AriaNeural', rate: '+0%', pitch: '+0Hz', desc: 'Design Essayist (EN Female)' },
};

const EFFECTS = [
  'mask-up',
  'slide-mask',
  'spring-pop',
  'flip-3d',
  'blur-sharp',
  'tracking-lock',
  'split-merge',
  'draw-underline',
  'wipe-highlight',
  'slot-roll',
];

const CONNECTORS = new Set([
  'yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'dengan', 'pada', 'adalah', 'ini', 'itu',
  'atau', 'dalam', 'bisa', 'akan', 'the', 'and', 'to', 'of', 'in', 'for', 'with', 'on', 'is',
]);

function parseArgs(argv) {
  const args = {
    text: 'Bukan sekadar template biasa, setiap frame dirancang presisi dengan kamera hidup dan suara yang menyatu.',
    wpm: 155,
    startOffsetMs: 120,
    profile: 'N01',
    tts: false,
    timings: null,
    duration: null,
    outWords: 'public/words.json',
    outMap: 'research/word-map.md',
    outAudio: 'public/audio/narration.mp3',
  };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--tts') { args.tts = true; continue; }
    const value = argv[++i];
    if (value === undefined) throw new Error(`Missing value for ${key}.`);
    switch (key) {
      case '--text': args.text = value; break;
      case '--wpm': args.wpm = Number(value); break;
      case '--profile': args.profile = value.toUpperCase(); break;
      case '--timings': args.timings = value; break;
      case '--duration': args.duration = Number(value); break;
      case '--out-audio': args.outAudio = value; break;
      case '--out-words': args.outWords = value; break;
      case '--out-map': args.outMap = value; break;
      default: throw new Error(`Unknown option: ${key}`);
    }
  }
  return args;
}

const opts = parseArgs(process.argv);
if (!Number.isFinite(opts.wpm) || opts.wpm <= 0) throw new Error('WPM must be positive.');
if (opts.duration !== null && (!Number.isFinite(opts.duration) || opts.duration <= 0)) throw new Error('Duration must be positive.');
if (!VOICE_PROFILES[opts.profile]) throw new Error('Unknown voice profile.');
if (opts.tts && opts.timings) throw new Error('Choose --tts or --timings, not both.');
let timingSource = 'estimated';
let measuredWords = null;
if (opts.tts) {
  const prof = VOICE_PROFILES[opts.profile];
  const audioPath = path.resolve(opts.outAudio);
  const timingPath = audioPath + '.words.json';
  fs.mkdirSync(path.dirname(audioPath), { recursive: true });
  try {
    execFileSync('python3', [fileURLToPath(new URL('./tts-boundaries.py', import.meta.url)), opts.text, prof.voice, prof.rate, prof.pitch, audioPath, timingPath], { stdio: 'pipe' });
  } catch (err) {
    throw new Error('TTS failed; no synchronized words were produced. Install a compatible edge-tts Python package and check connectivity. ' + (err.stderr?.toString() || err.message));
  }
  measuredWords = JSON.parse(fs.readFileSync(timingPath, 'utf8'));
  timingSource = 'tts-word-boundaries';
} else if (opts.timings) {
  measuredWords = JSON.parse(fs.readFileSync(opts.timings, 'utf8'));
  timingSource = 'provided-audio-alignment';
}
if (measuredWords !== null) {
  if (!Array.isArray(measuredWords) || !measuredWords.length) throw new Error('Timings must be a non-empty word array.');
  let previousEnd = 0;
  for (const w of measuredWords) {
    if (typeof w.text !== 'string' || !w.text.trim() || !Number.isFinite(w.startMs) || !Number.isFinite(w.endMs) || w.startMs < previousEnd || w.endMs <= w.startMs) throw new Error('Invalid or overlapping audio word timings.');
    previousEnd = w.endMs;
  }
}
const rawTokens = opts.text.trim().split(/\s+/).filter(Boolean);
const avgMsPerWord = Math.round(60000 / opts.wpm);

let cursorMs = opts.startOffsetMs;
let prevEffect = '';

const words = rawTokens.map((token, idx) => {
  const clean = token.replace(/[.,!?;:"]/g, '').toLowerCase();
  const hasPunctuationPause = /[.,!?;:]$/.test(token);
  const charFactor = Math.max(0.65, Math.min(1.45, clean.length / 6));
  const durMs = Math.round(avgMsPerWord * charFactor);

  let role = 'support';
  if (CONNECTORS.has(clean) || clean.length <= 2) {
    role = 'connector';
  } else if (/\d/.test(token) || clean.length >= 7 || idx % 4 === 0) {
    role = 'keyword';
  }

  let effect = EFFECTS[(idx * 3 + clean.length) % EFFECTS.length];
  if (/\d/.test(token)) effect = 'slot-roll';
  if (effect === prevEffect) {
    effect = EFFECTS[(EFFECTS.indexOf(effect) + 1) % EFFECTS.length];
  }
  prevEffect = effect;

  const item = {
    text: token,
    startMs: cursorMs,
    endMs: cursorMs + durMs,
    role,
    effect,
  };

  cursorMs += durMs + (hasPunctuationPause ? 180 : 25);
  return item;
});

if (measuredWords) {
  words.splice(0, words.length, ...measuredWords.map((w) => ({ ...w, role: 'support', effect: 'mask-up' })));
  cursorMs = words.at(-1).endMs;
}
if (!words.length) throw new Error('Narration cannot be empty.');
if (opts.duration !== null && words.at(-1).endMs > opts.duration * 1000) throw new Error('Narration exceeds video duration; shorten text or extend video.');
const wordsPath = path.resolve(process.cwd(), opts.outWords);
fs.mkdirSync(path.dirname(wordsPath), { recursive: true });
fs.writeFileSync(wordsPath, JSON.stringify(words, null, 2), 'utf8');
fs.writeFileSync(wordsPath + '.meta.json', JSON.stringify({ timingSource, synchronized: timingSource !== 'estimated', audioPath: opts.tts ? path.resolve(opts.outAudio) : null }, null, 2));

// Tulis research/word-map.md sesuai SKILL.md
const mapPath = path.resolve(process.cwd(), opts.outMap);
fs.mkdirSync(path.dirname(mapPath), { recursive: true });
const tableRows = words
  .map(
    (w, i) =>
      `| ${i + 1} | \`${w.text}\` | ${w.startMs}–${w.endMs} ms | **${w.role}** | \`${w.effect}\` | ${
        'Tidak ada SFX otomatis; ikuti aksi visual'
      } |`
  )
  .join('\n');

const wordMapMd = `# Peta Kata Narasi (Word Map)

- **Profil Suara Narator:** ${opts.profile} — ${VOICE_PROFILES[opts.profile]?.desc || 'Custom'}
- **Sumber Timestamp:** ${timingSource}${timingSource === 'estimated' ? ' (perkiraan WPM; belum sinkron dengan audio)' : ''}
- **Total Kata:** ${words.length} kata
- **Estimasi Durasi Narasi:** ${(cursorMs / 1000).toFixed(2)} detik

| # | Kata | Timestamp | Hierarki | Efek Masuk | Reaksi Audio & Kamera |
|---|---|---|---|---|---|
${tableRows}
`;

fs.writeFileSync(mapPath, wordMapMd, 'utf8');

console.log(`[narrator-sync] Generated ${words.length} words (${timingSource}) in ${wordsPath} and ${mapPath}`);
