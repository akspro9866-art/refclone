import fs from 'node:fs';
import path from 'node:path';
import { selectMotion } from './motion-pairing.mjs';
import { APPLE_INTERACTIVE_COMPONENTS, SKILL_ROOT, buildSceneTimeline, readBeats } from './storyboard-library.mjs';

const STYLE_SFX = JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'references/style-sfx.json'), 'utf8'));

export function parseMotionArgs(argv) {
  const options = {
    brief: 'Demo Produk & Alur Kerja Interaktif',
    styleId: undefined,
    templateId: undefined,
    aspect: undefined,
    duration: undefined,
    fps: 30,
    overlap: 10,
    outDir: 'research',
  };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const value = argv[++index];
    if (value === undefined) throw new Error(`Missing value for ${flag}.`);
    switch (flag) {
      case '--brief-file': options.briefFile = value; break;
      case '--brief': options.brief = value; break;
      case '--style': options.styleId = Number(value); break;
      case '--template':
      case '--storyboard': options.templateId = value; break;
      case '--aspect': options.aspect = value; break;
      case '--duration': options.duration = Number(value); break;
      case '--fps': options.fps = Number(value); break;
      case '--overlap': options.overlap = Number(value); break;
      case '--out': options.outDir = value; break;
      default: throw new Error(`Unknown option: ${flag}`);
    }
  }
  if (options.duration !== undefined && (!Number.isFinite(options.duration) || options.duration <= 0)) {
    throw new Error('Duration must be positive.');
  }
  if (!Number.isFinite(options.fps) || options.fps <= 0) throw new Error('FPS must be positive.');
  if (!Number.isSafeInteger(options.overlap) || options.overlap < 0) {
    throw new Error('Overlap must be a non-negative integer.');
  }
  return options;
}

export function choosePair(options) {
  const pair = selectMotion(options.brief, options);
  const { style } = pair;
  const styleGuide = `references/styles/${String(style.id).padStart(2, '0')}-${style.slug}.md`;
  const guide = fs.readFileSync(path.join(SKILL_ROOT, styleGuide), 'utf8');
  const chosen = { id: style.id, name: style.name, bgm: style.bgm, sfx: style.sfx, bpm: style.bpm, styleGuide };
  const templateComponent = style.id === 44 ? APPLE_INTERACTIVE_COMPONENTS[pair.storyboard.id] : undefined;
  const summary = {
    styleId: style.id,
    styleName: style.name,
    styleGuide,
    soundPalette: STYLE_SFX[style.id].map(([sfx, volume, action]) => ({ sfx, volume, action })),
    storyboardId: pair.storyboard.id,
    ...(templateComponent && { templateComponent }),
    storyboardTitle: pair.storyboard.title,
    storyboardFile: pair.storyboard.file,
    aspect: pair.aspect,
    intent: pair.intent,
    selectionNote: pair.selectionNote,
    adaptation: pair.intentNote,
    compatible: pair.compatible,
    explicitStyle: pair.styleExplicit,
    explicitStoryboard: pair.storyboardExplicit,
  };
  return { pair, chosen, guide, summary };
}

export function writeStyleOutputs(options, selection) {
  const { pair, chosen, guide, summary } = selection;
  const out = path.resolve(options.outDir);
  const styleBiblePath = path.join(out, 'style-bible.md');
  const selectedStyleGuidePath = path.join(out, 'selected-style-guide.md');
  const selectedSfxGuidePath = path.join(out, 'selected-sfx-guide.md');
  const sfxRows = summary.soundPalette.map(({ sfx, volume, action }) => `| \`${sfx}\` | ${volume} | ${action} |`).join('\n');
  const sfxGuide = `# SFX · #${chosen.id} ${chosen.name}

| Cue | Volume awal | Pasang ketika |
|---|---:|---|
${sfxRows}

Pilih cue sesuai tindakan yang tampak. Catat frame kejadian pada timeline adegan. Pakai \`SfxCue\` dari \`Transitions.tsx\` setelah menyiapkan WAV dengan scaffold atau \`synth-audio.mjs\`. Sisakan ruang untuk dialog dan jeda baca. Kalau audio sumber sudah memuat aksinya, pakai audio tersebut.
`;
  const alternatives = pair.alternatives.map(({ id, name }) => `#${id} ${name}`).join(', ');
  const matches = pair.keywordMatches.length ? pair.keywordMatches.join(', ') : 'Pilihan konteks dan storyboard.';
  const fitNote = summary.compatible ? ''
    : '\n- **Adaptasi gaya:** Pertahankan struktur adegan. Terapkan gaya pada komposisi luar, materi, atau transisi jika UI sumber perlu tetap utuh.';
  const styleBible = `# Style Bible

- **Brief:** ${pair.brief}
- **Gaya:** Gaya #${chosen.id} ${chosen.name}
- **Storyboard:** ${summary.storyboardId} · ${summary.storyboardTitle}
- **Rasio:** ${summary.aspect}
- **Panduan:** \`${chosen.styleGuide}\` → \`selected-style-guide.md\`
- **Dasar pilihan:** ${summary.selectionNote} ${summary.adaptation}
- **Sinyal gaya:** ${matches}
- **Kandidat lain:** ${alternatives}
- **Audio opsional:** ${chosen.bgm} dan ${chosen.sfx}. Baca \`selected-sfx-guide.md\` untuk cue gaya. Ritme acuan gaya ${chosen.bpm} BPM. Ikuti timing aksi dan tempo track yang dipilih.${fitNote}

Terapkan grid, tipografi, material, dan koreografi dari panduan terpilih. Gunakan isi adegan dari storyboard yang diadaptasi. Tetapkan satu aksen dengan peran yang jelas dan catat keputusan aktual sebelum coding.
`;
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(selectedStyleGuidePath, guide);
  fs.writeFileSync(selectedSfxGuidePath, sfxGuide);
  fs.writeFileSync(styleBiblePath, styleBible);
  fs.appendFileSync(path.join(out, 'style-log.md'),
    `- [${new Date().toISOString().slice(0, 10)}] Gaya #${chosen.id} ${chosen.name} + ${summary.storyboardId} | ${pair.brief.replace(/\s+/g, ' ')}\n`);

  return { chosen, alternatives: pair.alternatives, pairing: summary, styleBiblePath, selectedStyleGuidePath, selectedSfxGuidePath };
}

const PRODUCT_CINEMA_BEATS = [
  { visual: 'Siluet produk dari brand user. Cahaya tepi membuka satu bagian kontur.', motion: 'Geser cahaya secara halus. Tahan kamera sebelum kontur terlihat.', camera: 'HOLD', transition: 'MC', sound: 'transition-whoosh-soft jika cahaya benar-benar menyapu' },
  { visual: 'Close-up satu detail bahan, bentuk, atau fungsi yang khas dari produk.', motion: 'Match cut dari kontur ke detail. Push-in pendek dengan easing lembut.', camera: 'PUSH', transition: 'MC', sound: 'glass-contact jika ada kontak material yang terlihat' },
  { visual: 'Reveal produk utuh dari detail yang sama.', motion: 'Tarik kamera dan hentikan gerak saat siluet lengkap terbaca.', camera: 'PULL', transition: 'MC', sound: 'impact-soft saat hero mencapai posisi akhir' },
  { visual: 'Produk utuh dan satu klaim atau fitur dari brief.', motion: 'Tahan framing. Munculkan teks sekali tanpa gerak berulang.', camera: 'HOLD', transition: 'MC', sound: 'Jeda' },
  { visual: 'Lockup logo dan copy akhir brand user.', motion: 'Tahan logo dan teks sampai akhir.', camera: 'HOLD', transition: 'END', sound: 'Jeda' },
];

function adaptBeats(beats, pair) {
  if (pair.style.id === 44 && pair.storyboard.id === 'T004') {
    return beats.map((beat, index) => ({ ...beat, ...PRODUCT_CINEMA_BEATS[index] }));
  }
  if (pair.storyboard.id !== 'T023') return beats;
  const visuals = {
    'gui-tutorial': [
      'Tujuan instalasi dan tampilan hasil yang ingin dicapai.',
      'Layar installer grafis. Tunjukkan kontrol pertama dan konteks platform.',
      'Langkah utama pada installer. Perlihatkan pilihan yang relevan, tindakan kursor, dan respons UI.',
      'Konfirmasi atau status instalasi yang benar. Beri label jika waktu dipercepat.',
      'Hasil setelah boot. Tahan tampilan atau status yang membuktikan instalasi selesai.',
    ],
    'cli-walkthrough': [
      'Tujuan sesi dan prompt shell sesuai lingkungan.',
      'Perintah pertama yang benar, dengan konteks lokasi atau lingkungan.',
      'Perintah atau opsi utama dan output yang relevan.',
      'Status yang memverifikasi tindakan, memakai log yang benar.',
      'Hasil akhir yang bisa dibaca pada terminal yang sama.',
    ],
  }[pair.intent];
  return visuals ? beats.map((beat, index) => ({ ...beat, visual: visuals[index] ?? beat.visual })) : beats;
}

export function makeScenePlan(options, selection) {
  const { pair, summary } = selection;
  const beats = adaptBeats(readBeats(pair.storyboard), pair);
  const duration = options.duration ?? beats.reduce((sum, beat) => sum + beat.weight, 0);
  const totalFrames = Math.round(duration * options.fps);
  const scenes = buildSceneTimeline(beats, totalFrames, options.overlap);
  return {
    brief: options.brief,
    totalFrames,
    width: options.width,
    height: options.height,
    resolvedBrief: options.resolvedBrief,
    fps: options.fps,
    aspect: pair.aspect,
    asymmetricPacing: new Set(scenes.map(({ contentFrames }) => contentFrames)).size > 1,
    selectedStoryboardId: summary.storyboardId,
    selectedStoryboardTitle: summary.storyboardTitle,
    selectedStoryboardFile: summary.storyboardFile,
    selectedStyleId: summary.styleId,
    selectedStyleGuide: summary.styleGuide,
    pairing: summary,
    scenes,
  };
}

export function writeSceneOutputs(options, selection, plan) {
  const { pair, summary } = selection;
  const out = path.resolve(options.outDir);
  const planPath = path.join(out, 'scenes-plan.json');
  const storyboardPath = path.join(out, 'storyboard.md');
  const motionPlanPath = path.join(out, 'motion-plan.md');
  const shotList = plan.scenes.map((scene) => {
    const exit = `${scene.exitTransition} (${scene.exitOverlapFrames}f overlap)`;
    return `### Scene ${scene.sceneIndex} · ${scene.pacingRole} · f${scene.startFrame}–${scene.endFrame} (akhir eksklusif)
- **Visual:** ${scene.visualHeroCenter}
- **Motion:** ${scene.motion}
- **Kamera:** ${scene.camera} · ${scene.cameraSplineBehavior}
- **Sambungan keluar:** ${exit}
- **Cue:** ${scene.sfx}
`;
  }).join('\n');
  const codeTemplate = summary.templateComponent
    ? `\n- **Template kode:** \`${summary.templateComponent}\` di \`templates/components/AppleInteractive.tsx\`. Scaffold menyiapkan \`AppleInteractiveStarter.tsx\`.`
    : '';
  const summaryMd = `- **Brief:** ${plan.brief}
- **Pasangan:** #${summary.styleId} ${summary.styleName} + ${summary.storyboardId} ${summary.storyboardTitle}
- **Sumber:** \`${summary.styleGuide}\` dan \`${summary.storyboardFile}\`
- **Format:** ${plan.aspect} · ${plan.totalFrames} frame @ ${plan.fps} fps
- **Arah adaptasi:** ${summary.adaptation}${codeTemplate}`;

  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
  fs.writeFileSync(storyboardPath, `# Storyboard\n\n${summaryMd}\n\n## Kerangka yang diterapkan\n\n${shotList}\n## Template sumber\n\n${pair.storyboard.block}\n`);
  fs.writeFileSync(motionPlanPath, `# Motion Plan\n\n${summaryMd}\n\n## Beat dan batas frame\n\n${shotList}\nLengkapi aset, posisi, dan timing aksi setelah menyusun frame pembuka dan hasil. Cocokkan gerak dan audio dengan panduan gaya serta konten. Tinjau shot pada rasio akhir sebelum render.\n`);
  return { planPath, storyboardPath, motionPlanPath };
}
