#!/usr/bin/env node
/**
 * scripts/fetch-music.mjs
 * Katalog & Downloader 24 Pilihan Lagu Studio (Royalty-Free Mixkit Stock Music)
 * + Daftar 40 Lagu Backsound Prosedural (B00-B39).
 *
 * Contoh penggunaan:
 *   node scripts/fetch-music.mjs --list
 *   node scripts/fetch-music.mjs --song M01 --out public/audio/music.wav
 *   node scripts/fetch-music.mjs --mood saas --out public/audio/music.wav
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execSync } from 'node:child_process';

export const STUDIO_SONGS_CATALOG = [
  // High Energy, Launches, & Tech Reels
  { code: 'M01', mixkitId: 130, title: 'Tech House Vibes', artist: 'Alejandro Magana', bpm: 122, mood: 'launch', desc: 'House groove bertenaga untuk launch produk, SaaS reel, dan fast cuts' },
  { code: 'M02', mixkitId: 171, title: 'Techno Fights', artist: 'Alejandro Magana', bpm: 128, mood: 'cyberpunk', desc: 'Propulsive dark techno untuk keamanan siber, AI, dan terminal demo' },
  { code: 'M03', mixkitId: 132, title: 'Hazy After Hours', artist: 'Alejandro Magana', bpm: 118, mood: 'saas', desc: 'Deep house hangat dan elegan untuk demo UI, portofolio, dan showcase' },
  { code: 'M04', mixkitId: 702, title: 'Pop 09', artist: 'Grigoriy Nuzhny', bpm: 116, mood: 'upbeat', desc: 'Futuristic upbeat pop untuk produk konsumer dan aplikasi mobile' },
  { code: 'M05', mixkitId: 1168, title: 'Coffee or Tea', artist: 'Michael Ramir C.', bpm: 114, mood: 'saas', desc: 'Electronic positif dan bersih untuk explainer teknologi & startup' },

  // Clean Product Demos, Corporate, & Editorial
  { code: 'M06', mixkitId: 834, title: "It's Love", artist: 'Michael Ramir C.', bpm: 108, mood: 'corporate', desc: 'Clean corporate uplifting untuk presentasi data dan laporan' },
  { code: 'M07', mixkitId: 732, title: 'Pop Track 06', artist: 'Lily J', bpm: 112, mood: 'saas', desc: 'Modern futuristic product demo groove' },
  { code: 'M08', mixkitId: 634, title: 'Your Breath', artist: 'Eugenio Mininni', bpm: 105, mood: 'editorial', desc: 'Warm editorial pulse untuk cerita brand dan profil perusahaan' },
  { code: 'M09', mixkitId: 245, title: 'Driving Ambition', artist: 'Ahjay Stelino', bpm: 120, mood: 'corporate', desc: 'Motivational rhythm untuk milestone, statistik, dan pencapaian' },
  { code: 'M10', mixkitId: 120, title: 'Raising Me Higher', artist: 'Ahjay Stelino', bpm: 115, mood: 'upbeat', desc: 'Energetic uplifting beat untuk CTA dan penutup promo' },

  // Lo-Fi, Hip-Hop, & Street / Creative
  { code: 'M11', mixkitId: 738, title: 'Hip Hop 02', artist: 'Lily J', bpm: 90, mood: 'lofi', desc: 'Chill boom-bap & lo-fi hip-hop untuk coding vlog, doodle, dan edukasi' },
  { code: 'M12', mixkitId: 229, title: 'Deep Urban', artist: 'Eugenio Mininni', bpm: 94, mood: 'urban', desc: 'Urban groove untuk grafiti, zine, streetwear, dan neo-brutalism' },
  { code: 'M13', mixkitId: 583, title: 'Comical', artist: 'Ahjay Stelino', bpm: 116, mood: 'playful', desc: 'Playful bouncy rhythm untuk komik, clay 3D, dan konten santai' },
  { code: 'M14', mixkitId: 660, title: 'Games Worldbeat', artist: 'Bernardo R.', bpm: 126, mood: 'gaming', desc: 'Arcade & gaming rhythm untuk HUD game, pixel art, dan turnamen' },

  // Calm Explainers, Documentary, & Ambient
  { code: 'M15', mixkitId: 419, title: 'Pilates and Yoga', artist: 'Arulo', bpm: 72, mood: 'ambient', desc: 'Calm ambient pad untuk topografi, alam, wellness, dan cat air' },
  { code: 'M16', mixkitId: 517, title: 'Jungle Voices', artist: 'Diego Nava', bpm: 98, mood: 'organic', desc: 'Relaxed organic electronic untuk dokumenter dan perjalanan' },
  { code: 'M17', mixkitId: 443, title: 'Serene View', artist: 'Arulo', bpm: 76, mood: 'ambient', desc: 'Warm atmospheric background untuk narasi panjang dan cerita' },
  { code: 'M18', mixkitId: 139, title: 'Spirit in the Woods', artist: 'Alejandro Magana', bpm: 84, mood: 'documentary', desc: 'Pensive documentary pulse untuk sejarah, riset, dan jurnalisme data' },

  // Cyberpunk, Tension, & Cinematic
  { code: 'M19', mixkitId: 140, title: 'Cyberpunk City', artist: 'Alejandro Magana', bpm: 106, mood: 'cyberpunk', desc: 'Dark synthwave & cyberpunk pulse untuk hacking, glitch, dan malam' },
  { code: 'M20', mixkitId: 723, title: 'Other World', artist: 'Lily J', bpm: 92, mood: 'cinematic', desc: 'Mysterious chillout tension untuk film noir, misteri, dan teaser' },
  { code: 'M21', mixkitId: 653, title: 'Sun and His Daughter', artist: 'Eugenio Mininni', bpm: 96, mood: 'vintage', desc: 'Warm retro-futurism & mid-century groove' },
  { code: 'M22', mixkitId: 145, title: 'A Very Brady Special', artist: 'Alejandro Magana', bpm: 110, mood: 'jazz', desc: 'Upbeat swing & lounge untuk art deco, koran editorial, dan kuliner' },
  { code: 'M23', mixkitId: 282, title: 'Epical Drums 01', artist: 'Grigoriy Nuzhny', bpm: 118, mood: 'percussion', desc: 'Big percussion & taiko hits untuk bauhaus, olahraga, dan manifesto' },
  { code: 'M24', mixkitId: 125, title: 'Dreaming Big', artist: 'Ahjay Stelino', bpm: 122, mood: 'launch', desc: 'Cinematic inspiring build-up untuk keynote dan reveal produk' },
];

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'motion-craft/2.3' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(downloadBuffer(res.headers.location));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

function parseArgs(argv) {
  const args = {
    list: false,
    song: null,
    mood: null,
    out: 'public/audio/music.wav',
    duration: 60,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--list') args.list = true;
    if (k === '--song' && v) args.song = v.toUpperCase();
    if (k === '--mood' && v) args.mood = v.toLowerCase();
    if (k === '--out' && v) args.out = v;
    if (k === '--duration' && v) args.duration = Number(v);
  }
  return args;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('fetch-music.mjs')) {
  const opts = parseArgs(process.argv);

  if (opts.list || (!opts.song && !opts.mood)) {
    console.log('\n=== 24 PILIHAN LAGU STUDIO ROYALTY-FREE (M01 - M24) ===');
    for (const s of STUDIO_SONGS_CATALOG) {
      console.log(`  ${s.code} (Mixkit #${s.mixkitId}) | ${s.title} - ${s.artist} [${s.bpm} BPM, ${s.mood}] -> ${s.desc}`);
    }
    console.log('\nCara pakai: node scripts/fetch-music.mjs --song M03 --out public/audio/music.wav\n');
    process.exit(0);
  }

  let selected = STUDIO_SONGS_CATALOG.find(
    (s) => s.code === opts.song || String(s.mixkitId) === opts.song
  );
  if (!selected && opts.mood) {
    selected = STUDIO_SONGS_CATALOG.find((s) => s.mood === opts.mood);
  }
  if (!selected) selected = STUDIO_SONGS_CATALOG[0];

  const mp3Url = `https://assets.mixkit.co/music/${selected.mixkitId}/${selected.mixkitId}.mp3`;
  const outWav = path.resolve(process.cwd(), opts.out);
  fs.mkdirSync(path.dirname(outWav), { recursive: true });
  const tmpMp3 = `${outWav}.tmp.mp3`;

  try {
    console.log(`[fetch-music] Downloading "${selected.title}" by ${selected.artist} (${selected.bpm} BPM)...`);
    const buf = await downloadBuffer(mp3Url);
    fs.writeFileSync(tmpMp3, buf);
    execSync(`ffmpeg -y -v error -i "${tmpMp3}" -t ${opts.duration} -ar 48000 -ac 2 -c:a pcm_s16le "${outWav}"`);
    fs.unlinkSync(tmpMp3);
    console.log(`[fetch-music] Saved 48kHz stereo WAV to ${outWav}`);
  } catch (err) {
    if (fs.existsSync(tmpMp3)) fs.unlinkSync(tmpMp3);
    console.log(`[fetch-music] Network/download unavailable (${err.message}). Falling back to procedural song synthesis...`);
    const synthScript = path.join(path.dirname(process.argv[1]), 'synth-audio.mjs');
    execSync(`node "${synthScript}" --bgm B26 --duration ${opts.duration} --out "${path.dirname(outWav)}"`, { stdio: 'inherit' });
  }
}
