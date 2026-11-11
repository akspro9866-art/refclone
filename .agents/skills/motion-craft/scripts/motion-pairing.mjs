import { STYLE_INDEX } from './style-index.mjs';
import { APPLE_INTERACTIVE_COMPONENTS, ASPECTS, loadStoryboards } from './storyboard-library.mjs';

const normalize = (text) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const has = (text, phrase) => ` ${text} `.includes(` ${normalize(phrase)} `);
const some = (text, phrases) => phrases.some((phrase) => has(text, phrase));
const filler = new Set('pakai gunakan buat bikin buatkan saya aku video motion craft graphics grafis remotion tentang dengan untuk dari yang and the a of in using make about'.split(' '));

const GUI_TUTORIAL = {
  id: 'gui-tutorial', storyboard: 'T023', styles: [12, 43, 11],
  note: 'Susun langkah dari installer grafis. Pakai platform, label, dan status yang sebenarnya; jelaskan asumsi distro dan target instalasi bila belum disebut.',
};
const CLI_INSTALL = {
  id: 'cli-install', storyboard: 'T036', styles: [26, 12],
  note: 'Perlihatkan prompt, perintah, output, dan bukti hasil sesuai shell dan platform. Gunakan perintah serta log dari sumber yang benar.',
};

// More specific content wins over generic format words such as tutorial, short, or video.
const PROFILES = [
  ['T004', [44], ['cinematic product reveal', 'reveal produk sinematik']],
  ['T039', [1, 28, 26], ['cybersecurity', 'keamanan siber', 'phishing', 'security incident', 'threat detection']],
  ['T034', [7, 18, 26, 27], ['arsitektur api', 'cara kerja api', 'api architecture', 'api flow']],
  ['T030', [7, 18, 27, 38], ['diagram alur', 'arsitektur sistem', 'flowchart', 'uml', 'system architecture']],
  ['T095', [27, 18, 7, 32], ['exploded view', 'cara kerja mesin', 'bongkar komponen', 'cara kerja produk']],
  ['T035', [26, 12], ['coding', 'live typing', 'code walkthrough', 'menulis kode', 'demo kode']],
  ['T040', [26, 43, 12], ['github', 'open source', 'repositori', 'repository', 'repo']],
  ['T037', [43, 12], ['prompt to result', 'ai assistant', 'asisten ai', 'chatbot', 'demo ai', 'percakapan ai']],
  ['T031', [12, 43, 11], ['demo aplikasi mobile', 'apk', 'android app', 'mobile app', 'ios app']],
  ['T032', [12, 11, 43], ['saas', 'dashboard', 'software demo', 'demo produk digital']],
  ['T038', [43, 12, 11], ['portofolio', 'showreel', 'reel desainer', 'website', 'landing page']],
  ['T007', [21, 30, 29], ['katalog menu', 'menu kafe', 'menu restoran', 'daftar menu']],
  ['T081', [21, 30, 19], ['resep', 'cara masak', 'cara membuat makanan', 'cooking recipe']],
  ['T082', [21, 43, 29, 8], ['promo restoran', 'promo kafe', 'menu spesial', 'promo menu']],
  ['T001', [21, 43, 8, 14], ['kopisusu', 'kopi susu', 'kopi', 'coffee', 'minuman kemasan', 'food product']],
  ['T082', [21, 43, 29, 8], ['kafe', 'restoran', 'kuliner']],
  ['T002', [10, 11, 43], ['flash sale', 'diskon kilat', 'sale countdown']],
  ['T009', [11, 12, 43], ['pricing', 'paket harga', 'harga langganan']],
  ['T004', [43, 37, 16, 8], ['product reveal', 'peluncuran produk', 'launch produk']],
  ['T006', [43, 12, 9], ['before after', 'sebelum sesudah', 'before and after']],
  ['T012', [43, 11, 12], ['pitch', 'investor', 'startup']],
  ['T011', [12, 43, 25], ['company profile', 'profil perusahaan', 'profil usaha']],
  ['T038', [43, 11, 12], ['promo jasa', 'promo layanan', 'portfolio', 'portofolio']],
  ['T093', [10, 38, 12], ['terminal bus', 'jadwal bus', 'jadwal kereta', 'jadwal penerbangan', 'papan keberangkatan', 'jadwal keberangkatan', 'train schedule', 'departure board']],
  ['T097', [5, 38, 36], ['peta data', 'peta geografis', 'elevasi', 'kontur', 'geografi']],
  ['T083', [5, 41, 20, 23], ['wisata', 'destinasi', 'travel', 'perjalanan']],
  ['T098', [36, 12], ['tren harga', 'line chart', 'grafik tren']],
  ['T099', [36, 12], ['survei', 'survey', 'hasil polling']],
  ['T092', [36, 12, 43], ['perbandingan', 'comparison', 'bandingkan']],
  ['T091', [36, 25, 12], ['statistik', 'infografis', 'laporan data', 'visualisasi data']],
  ['T100', [43, 20, 36], ['wrapped', 'year in review', 'rekap tahunan']],
  ['T080', [40, 39, 43], ['olahraga', 'skor pertandingan', 'siaran', 'scorebug']],
  ['T075', [39, 17, 35, 1], ['game', 'gaming', 'esport', 'arcade', 'gameplay']],
  ['T054', [4, 29, 3, 40], ['konser', 'aftermovie', 'event musik']],
  ['T073', [41, 16, 29], ['lyric video', 'video lirik', 'lirik lagu']],
  ['T051', [22, 41, 24], ['wedding', 'pernikahan', 'undangan nikah']],
  ['T056', [20, 43], ['wisuda', 'kelulusan']],
  ['T057', [24, 19], ['idulfitri', 'lebaran', 'eid']],
  ['T061', [5, 19, 41], ['kampanye lingkungan', 'konservasi', 'pelestarian']],
  ['T048', [30, 36], ['mitos', 'myth vs fact']],
  ['T024', [25, 20, 33, 23], ['timeline sejarah', 'sejarah', 'historis']],
  ['T023', [12, 30, 2, 43], ['tutorial', 'cara', 'step by step', 'how to', 'langkah']],
  ['T021', [2, 19, 12, 32], ['jelaskan', 'explainer', 'konsep', 'edukasi', 'belajar']],
  ['T001', [43, 21, 37, 8], ['promo', 'iklan', 'produk', 'product teaser']],
  ['T041', [43, 6, 17, 37], ['tiktok', 'reels', 'shorts', 'social media']],
];

function resolveIntent(text) {
  const isGui = some(text, ['gui', 'installer grafis', 'layar installer', 'graphical installer', 'installation wizard', 'wizard instalasi']);
  const isTransport = some(text, ['terminal bus', 'terminal bandara', 'airport terminal', 'bus terminal']);
  const isCli = some(text, ['cli', 'command line', 'shell', 'bash', 'zsh', 'powershell', 'perintah', 'apt install', 'apt get install', 'pip install', 'npm install'])
    || (has(text, 'terminal') && !isTransport);
  const installVerbs = ['install', 'instal', 'instalasi', 'installation', 'installing', 'memasang', 'pasang'];
  const isInstall = some(text, installVerbs);
  const osNames = ['linux', 'ubuntu', 'debian', 'fedora', 'linux mint', 'windows', 'sistem operasi', 'operating system'];
  const isOsInstall = installVerbs.some((verb) => osNames.some((os) => has(text, `${verb} ${os}`)));

  if (isGui && (isInstall || isOsInstall || has(text, 'tutorial'))) return GUI_TUTORIAL;
  if (isCli && isInstall) return CLI_INSTALL;
  if (isOsInstall && !some(text, ['paket', 'package', 'library', 'dependency'])) {
    return { ...GUI_TUTORIAL, note: `Asumsi awal: installer grafis. ${GUI_TUTORIAL.note}` };
  }
  if (isCli) {
    return {
      id: 'cli-walkthrough', storyboard: 'T023', styles: [26, 12],
      note: 'Adaptasi struktur tutorial ke satu sesi shell, dengan perintah dan output yang benar.',
    };
  }
  if (isInstall && some(text, ['software', 'aplikasi', 'vscode', 'vs code', 'linux', 'ubuntu', 'windows', 'macos', 'android'])) {
    return {
      id: 'software-tutorial', storyboard: 'T023', styles: [12, 43, 11],
      note: 'Perlihatkan cara instalasi sesuai platform dan sumber. Pilih layar atau perintah yang memang dipakai.',
    };
  }
  const profile = PROFILES.find(([, , phrases]) => some(text, phrases));
  if (!profile) return null;
  const [storyboard, styles, phrases] = profile;
  return {
    id: storyboard.toLowerCase(),
    storyboard,
    styles,
    note: `Konteks brief cocok dengan ${phrases.filter((phrase) => has(text, phrase)).join(', ')}. Ganti contoh visual, label, dan data dari template dengan konten user.`,
  };
}

function storyboardFromText(catalog, text, requestedStyle) {
  const words = [...new Set(text.split(' '))].filter((word) => word.length > 2 && !filler.has(word));
  const ranked = catalog.map((storyboard) => {
    const title = normalize(storyboard.title);
    const score = words.filter((word) => has(title, word)).length;
    const fitsStyle = requestedStyle?.storyboards.includes(storyboard.id) ?? false;
    return { storyboard, score, fitsStyle };
  }).sort((a, b) => b.score - a.score || Number(b.fitsStyle) - Number(a.fitsStyle));
  if (ranked[0]?.score > 0) return ranked[0].storyboard;
  return catalog.find(({ id }) => id === (requestedStyle?.storyboards[0] ?? 'T021'));
}

export function selectMotion(brief, { styleId, templateId, aspect } = {}) {
  const catalog = loadStoryboards();
  const normalized = normalize(brief);
  const namedStyleMatch = STYLE_INDEX.flatMap((style) =>
    [style.name, style.slug, ...style.aliases].flatMap((label) =>
      ['gaya', 'style', 'ala'].map((prefix) => ({ style, phrase: normalize(`${prefix} ${label}`) })),
    ),
  ).sort((a, b) => b.phrase.length - a.phrase.length).find(({ phrase }) => has(normalized, phrase));
  const namedStyle = namedStyleMatch?.style;
  const taggedStyle = brief.match(/\b(?:gaya|style)\s*(?:nomor\s*)?#?\s*(\d+)\b/i);
  const requestedId = styleId ?? (taggedStyle ? Number(taggedStyle[1]) : namedStyle?.id);
  const requestedStyle = STYLE_INDEX.find(({ id }) => id === requestedId);
  if (requestedId != null && !requestedStyle) throw new Error(`Unknown style #${requestedId}. Choose 1–${STYLE_INDEX.at(-1).id}.`);

  const taggedTemplate = brief.match(/\b(?:template|storyboard)\s*#?\s*(T\d{3})\b/i);
  const requestedTemplateId = (templateId ?? taggedTemplate?.[1])?.toUpperCase();
  const requestedTemplate = catalog.find(({ id }) => id === requestedTemplateId);
  if (requestedTemplateId && !requestedTemplate) throw new Error(`Unknown storyboard ${requestedTemplateId}. Choose T001–${catalog.at(-1).id}.`);

  // A visual style name is separate from the subject or interaction shown in the video.
  let content = normalized.replace(/\b(?:tanpa|bukan|hindari|without|no)\s+(?:(?:pakai|lewat|menggunakan|via|demo)\s+)?(?:terminal|cli|command line|shell|bash|zsh|gui|installer grafis|coding|ai)\b/g, ' ');
  if (namedStyleMatch) {
    content = ` ${content} `.replace(` ${namedStyleMatch.phrase} `, ' ').trim();
  }
  const appleDirection = requestedStyle?.id === 44 || (
    !requestedStyle && (Object.hasOwn(APPLE_INTERACTIVE_COMPONENTS, requestedTemplateId) ||
      some(content, ['intro apple', 'apple keynote', 'apple creator studio', 'apple interactive motion']))
  );
  const appleStoryboard = some(content, ['tutorial', 'cara', 'how to', 'step by step']) ? 'T101'
    : some(content, ['education', 'edukasi', 'explainer', 'jelaskan', 'belajar']) ? 'T103' : 'T102';
  const intent = appleDirection ? {
    id: 'apple-interactive',
    storyboard: appleStoryboard,
    styles: [44],
    note: 'Petakan satu aksi nyata ke respons yang bisa dilihat. Pakai isi, aset, dan identitas brand user.',
  } : resolveIntent(content);
  const storyboard = requestedTemplate
    ?? (intent && catalog.find(({ id }) => id === intent.storyboard))
    ?? storyboardFromText(catalog, content, requestedStyle);
  if (!storyboard) throw new Error('No usable storyboard in the catalog.');

  const ranked = STYLE_INDEX.map((style) => {
    const keywords = style.keywords.filter((keyword) => has(content, keyword));
    const compatible = style.storyboards.includes(storyboard.id);
    const position = intent?.styles.indexOf(style.id) ?? -1;
    const routeScore = position < 0 ? 0 : 14 - position * 2;
    return {
      style, keywords, compatible,
      score: routeScore + (compatible ? 8 : 0) + keywords.length * 3,
    };
  }).sort((a, b) => b.score - a.score || a.style.id - b.style.id);

  const winner = requestedStyle ? ranked.find(({ style }) => style.id === requestedStyle.id) : ranked[0];
  const textAspect = brief.match(/\b(16:9|9:16|1:1)\b/)?.[1];
  const inferredAspect = some(content, ['vertikal', 'vertical', 'portrait', 'reels', 'shorts', 'tiktok']) ? '9:16'
    : some(content, ['landscape', 'horizontal']) ? '16:9' : undefined;
  const selectedAspect = aspect ?? textAspect ?? inferredAspect ?? storyboard.aspect;
  if (!ASPECTS.includes(selectedAspect)) throw new Error(`Unsupported aspect ${selectedAspect}. Choose ${ASPECTS.join(', ')}.`);

  const style = winner.style;
  const selectionNote = requestedStyle ? `Gaya #${style.id} dipilih eksplisit.`
    : winner.compatible ? `Panduan #${style.id} punya rekomendasi pairing dengan ${storyboard.id}.`
    : `Panduan #${style.id} dipilih berdasarkan konteks brief; adaptasi ke struktur ${storyboard.id}.`;
  return {
    brief,
    style,
    storyboard,
    aspect: selectedAspect,
    intent: intent?.id ?? 'open-brief',
    intentNote: intent?.note ?? 'Gunakan judul template sebagai struktur awal. Isi semua adegan dengan subjek, bukti, dan aksi dari brief.',
    selectionNote,
    keywordMatches: winner.keywords,
    compatible: winner.compatible,
    styleExplicit: Boolean(requestedStyle),
    storyboardExplicit: Boolean(requestedTemplate),
    alternatives: ranked.filter((item) => item.style.id !== style.id).slice(0, 2).map(({ style: alternative }) => ({
      id: alternative.id, name: alternative.name,
    })),
  };
}
