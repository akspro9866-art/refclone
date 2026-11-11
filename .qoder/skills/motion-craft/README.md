# /motion-craft

Skill untuk membuat motion graphics dan mengedit video dengan Remotion (React dan TypeScript). Mulai dari brief, pilih satu dari 44 panduan gaya dan satu dari 103 storyboard, lalu adaptasi isi shot. Template React mencakup UI, tipografi, kamera, grid, dan kartu. Gunakan aset sumber, cue audio sesuai aksi, dan pemeriksaan hasil render.

<p align="center">
  <img src="assets/preview/motion-demo.gif" alt="Motion Craft Demo" width="100%" />
</p>

## Status QA dan Timestamp

Default desain mengikuti brief dan referensi; badge UI asli, kamera referensi, serta jeda yang disengaja tetap boleh. `narrator-sync.mjs --tts` mengambil batas kata dari audio TTS (Python `edge-tts` diperlukan), sedangkan tanpa TTS/alignment hasilnya ditandai sebagai perkiraan. Gunakan `--timings alignment.json` untuk audio yang sudah ada.

Inspector menghasilkan `FAIL`, `PARTIAL`, atau `PASS` sesuai pemeriksaan yang benar-benar dilakukan. Safe-zone membutuhkan rectangle screen-space terukur melalui `--geometry`; tidak lagi disimpulkan dari angka waypoint. Tes regresi bukan bukti kualitas artistik. Gunakan `scripts/evaluate-video.mjs` untuk render/metadata dan perbandingan SSIM video nyata. Lihat [cakupan dan format QA](references/REPLICATION-AND-QA.md#4-cakupan-qa-dan-geometri-yang-diukur).

---

## Daftar Isi

1. [Cara Instalasi](#1-cara-instalasi)
2. [Cara Pakai di Agent (`/motion-craft`)](#2-cara-pakai-di-agent-motion-craft)
3. [Arah Visual](#3-arah-visual)
4. [Kamera, Editing, dan Caption](#4-kamera-editing-dan-caption)
5. [19 Komponen 3D Card Layout, Grid Animation, & Card Interaction](#5-19-komponen-3d-card-layout-grid-animation--card-interaction)
6. [103 Template Storyboard Siap Pakai (`T001`–`T103`)](#6-103-template-storyboard-siap-pakai-t001t103)
7. [44 File Spesifikasi Gaya Desain (`references/styles/`)](#7-44-file-spesifikasi-gaya-desain-referencesstyles)
8. [64 Lagu Backsound & 65+ Studio SFX Terikat-Animasi](#8-64-lagu-backsound--65-studio-sfx-terikat-animasi)
9. [Alur Kerja CLI & Skrip Otomatis](#9-alur-kerja-cli--skrip-otomatis)
10. [Struktur Direktori & Benchmark Uji Skill](#10-struktur-direktori--benchmark-uji-skill)

---

## 1. Cara Instalasi

### Opsi A — Lewat `npx skills` (Rekomendasi Utama)
```bash
npx skills add https://github.com/RajaskaJanuardani/motion-craft --skill "motion-craft"
```

### Opsi B — Sebagai Plugin Claude Code
Jalankan di dalam sesi Claude Code:
```text
/plugin marketplace add RajaskaJanuardani/motion-craft
/plugin install motion-craft@motion-craft
```

### Opsi C — Clone & Installer Otomatis (Claude Code, ZCode, Cursor, Codex)
**macOS / Linux / Git Bash:**
```bash
git clone https://github.com/RajaskaJanuardani/motion-craft.git
cd motion-craft
./install.sh --all-agents
```

**Windows PowerShell:**
```powershell
git clone https://github.com/RajaskaJanuardani/motion-craft.git
cd motion-craft
.\install.ps1
```

---

## 2. Cara Pakai di Agent (`/motion-craft`)

Panggil langsung menggunakan perintah **`/motion-craft`** di chat agent pada project Remotion Anda:

### Brief singkat

```text
/motion-craft Buat video motion graphics tentang cara install Linux.
```

Planner menyarankan #12 Swiss Internasional + T023 dengan asumsi awal installer grafis. Brief yang menyebut instalasi paket lewat terminal memilih #26 Terminal CLI + T036.

### Gaya eksplisit

```text
/motion-craft Bikin Reels 15 detik buat memperkenalkan Kopisusu 3% dengan gaya #14 Risograph. Tampilkan gelas transparan, es, dan kopi susu. Tutup dengan “Cobain hari ini”.
```

Gaya #14 dipertahankan dan T001 memberi struktur teaser produk. Agen menentukan palet tinta, siluet, crop bahan, dan hold CTA berdasarkan panduan serta aset yang tersedia.

---

## 3. Arah Visual

Susun satu hero, hierarki baca, ruang kosong, dan satu peran warna aksen untuk tiap shot. Pakai panduan gaya untuk komposisi dan material yang khas. Terapkan gaya pada panggung dan editing bila antarmuka sumber perlu tetap persis. Pertahankan badge, status, dan ikon yang memang fungsional. Pakai aset produk dan logo yang diverifikasi.

## 4. Kamera, Editing, dan Caption

Mulai dari hold untuk bacaan. Pindahkan fokus dengan kamera atau crop saat ada detail yang perlu dilihat. Pilih cut, match cut, atau transisi overlap berdasarkan hubungan antarshot. Gunakan SFX pada tindakan atau perubahan yang terlihat. Caption opsional berada di screen-space dengan ukuran dan offset sesuai rasio. Cek [panduan kamera dan caption](references/CAMERA-SCENES-NARRATOR.md) dan [QA tampilan](references/REPLICATION-AND-QA.md#3-cek-tampilan-sebelum-serah).

## 5. 19 Komponen 3D Card Layout, Grid Animation, & Card Interaction

Tersedia langsung di `templates/components/` (dokumentasi lengkap di [`references/CARD-GRID-3D-PATTERNS.md`](references/CARD-GRID-3D-PATTERNS.md)):

### A. 3D Card Layouts (`templates/components/Card3DLayouts.tsx`)
| Komponen | Cara Kerja Animasi | SFX Otomatis | Kegunaan Utama |
|---|---|---|---|
| `<Coverflow3D />` | Kartu aktif menghadap lurus di depan (`rotateY(0deg) translateZ(90px)`), kartu kiri/kanan miring perspektif 3D (`±48deg`). | `transition-swipe.wav` | Galeri fitur & showcase pilihan produk. |
| `<FerrisWheelCards />` | Kartu beredar mengikuti roda bianglala melingkar namun orientasi tiap kartu tetap tegak lurus (`0deg`). | `tick-soft.wav` | Daftar fitur/tahapan yang tampil bergiliran. |
| `<CubeRoll3D />` | 6 kartu ditempel pada 6 sisi kubus 3D utuh (`preserve-3d`) yang berputar menggulung per sisi. | `transition-swoosh.wav` | Menampilkan 6 poin utama dalam satu objek 3D. |
| `<CylinderCards3D />` | Kartu mengelilingi tabung drum horizontal 3D (`rotateY` + `translateZ`). | `transition-scroll.wav` | Carousel melingkar 360 derajat. |
| `<HelixCards3D />` | Kartu naik melingkar seperti tangga putar (spiral vertikal 3D). | `transition-swipe.wav` | Urutan langkah / evolusi timeline bertahap. |
| `<SphereCards3D />` | Kartu menempel mengelilingi permukaan bola 3D (*Fibonacci lattice*). | `transition-whoosh-soft.wav` | Ekosistem integrasi / jaringan global. |
| `<ZDepthTunnel />` | Kartu meluncur datang dari kejauhan (`jauh` → `dekat`) menembus sumbu Z kamera lengkap dengan *rack-focus blur*. | `transition-whoosh-soft.wav` | Intro sinematik / penjelajahan arsip visual. |

### B. Grid Animations (`templates/components/GridAnimations.tsx`)
| Komponen | Tahapan Gerakan (3 Fase) | SFX Otomatis | Kegunaan Utama |
|---|---|---|---|
| `<BentoGridReveal />` | `kotak 1` (hero besar) → `kotak 2–3` → `lengkap` (6 kotak beda ukuran). | `pop-in.wav` tiap gelombang | Ringkasan spesifikasi unggulan (gaya Apple Bento). |
| `<ExplodeToGrid />` | `tumpukan` di tengah → `pecah` menyebar radial → `rapi di grid` 3×2. | `transition-swoosh.wav` + `pop-drop.wav` | Membuka koleksi atau memperkenalkan banyak modul. |
| `<LayoutMorphGridToCarousel />` | Interpolasi *FLIP* mulus dari `grid` → `kartu berpindah` → `jadi carousel` horizontal tanpa *hard cut*. | `transition-maximize.wav` + `transition-swipe.wav` | Mengubah ikhtisar grid menjadi fokus per kartu. |
| `<MasonryZoomDetail />` | `pilih kotak` di galeri → `membesar` → `jadi halaman` detail layar penuh. | `click.wav` + `transition-whoosh-soft.wav` | Transisi mulus dari galeri menuju bedah detail. |
| `<GridRecapZoomOut />` | `slide terakhir` layar penuh → `kartu kembali` mengecil → `recap semua` 6 kartu di grid. | `transition-minimize.wav` + `confirm-chime.wav` | Scene penutup untuk merangkum seluruh poin. |

### C. Card Interactions (`templates/components/CardInteractions.tsx`)
| Komponen | Cara Kerja Animasi | SFX Otomatis | Kegunaan Utama |
|---|---|---|---|
| `<CardStackSwipe />` | Kartu teratas digeser (`swipe`) ke samping dengan rotasi natural sementara kartu bawahnya naik ke depan. | `transition-swipe.wav` | Pemilihan opsi cepat / *flashcards*. |
| `<FanSpreadCards />` | Tumpukan kartu membuka melengkung seperti kipas dari satu poros bawah (`50% 115%`). | `k1.wav` (gesekan kartu) | Memamerkan beberapa varian kartu sekaligus. |
| `<PolaroidDropTable />` | Bingkai foto Polaroid jatuh satu per satu ke atas meja dengan bayangan merapat saat mendarat. | `k2.wav` (hentakan foto) | Dokumentasi momen, *behind the scenes*, testimoni. |
| `<CardFlip3D />` | Kartu berputar `180°` pada sumbu Y dari sisi `depan` ke `belakang` dengan angkatan Z di tengah putaran. | `transition-swipe.wav` | Perbandingan *Before vs After* atau *Mitos vs Fakta*. |
| `<PageCurlCard />` | Sudut kanan-bawah kartu tergulung diagonal memperlihatkan `Sisi belakang` di bawahnya. | `k1.wav` | Pengungkapan rahasia / balik kartu bergaya kertas. |
| `<PageTurnBook />` | Halaman buku terbuka yang membalik `180°` dari poros punggung tengah. | `k1.wav` | Storytelling bab demi bab / undangan / katalog. |
| `<AccordionFoldCard />` | Kartu berlipat zig-zag 3D (`dilipat & dibuka`) dengan *shading* lipatan dinamis. | `transition-maximize.wav` | Penjelasan prosedur bertahap (*step-by-step*). |

---

## 6. 103 Template Storyboard Siap Pakai (`T001`–`T103`)

Tersedia di [`references/storyboards/INDEX.md`](references/storyboards/INDEX.md) dan terbagi ke dalam **11 file kategori** (masing-masing sudah memetakan waktu asimetris, gerak kamera, transisi seamless, SFX, dan komponen 3D/Grid/Card yang direkomendasikan):

| File Kategori | Rentang ID | Contoh Template di Dalamnya |
|---|---|---|
| [`01-bisnis-promosi.md`](references/storyboards/01-bisnis-promosi.md) | `T001`–`T010` | Promo Produk Teaser, Flash Sale Countdown, Grand Opening, Product Reveal, Testimoni Chat, Before–After, Katalog Menu, Pricing Tiers |
| [`02-korporat-profesional.md`](references/storyboards/02-korporat-profesional.md) | `T011`–`T020` | Company Profile, Pitch Startup, Laporan Kinerja Kuartal, Onboarding Karyawan, Rekrutmen, Event Recap, Roadmap Produk |
| [`03-edukasi-akademik.md`](references/storyboards/03-edukasi-akademik.md) | `T021`–`T030` | Explainer Konsep, Presentasi Skripsi, Tutorial Step-by-Step, Timeline Sejarah, Cheatsheet, Demo Proyek Capstone, Diagram Alur Sistem |
| [`04-teknologi-software.md`](references/storyboards/04-teknologi-software.md) | `T031`–`T040` | Demo Aplikasi Mobile, Demo SaaS Dashboard, Changelog Rilis, Cara Kerja API, Coding Demo Live-Typing, Instalasi CLI Terminal, AI Prompt-to-Result, GitHub Repo |
| [`05-media-sosial.md`](references/storyboards/05-media-sosial.md) | `T041`–`T050` | Hook 3 Detik TikTok/Reels, Tips Cepat 3 Hal, Cerita Chat iMessage, Kinetic Typography Quote, Behind the Scenes Desktop, Mitos vs Fakta |
| [`06-event-perayaan.md`](references/storyboards/06-event-perayaan.md) | `T051`–`T060` | Undangan Pernikahan, Ulang Tahun, Save the Date, Aftermovie Event, Trailer Pembukaan, Ucapan Wisuda, Idulfitri, HUT RI 17 Agustus |
| [`07-sosial-kampanye.md`](references/storyboards/07-sosial-kampanye.md) | `T061`–`T070` | Kampanye Lingkungan, Galang Dana/Donasi, Edukasi Kesehatan, Anti-Bullying, Hemat Energi, Literasi, Keselamatan Berkendara |
| [`08-kreatif-hiburan.md`](references/storyboards/08-kreatif-hiburan.md) | `T071`–`T080` | Intro/Outro YouTube, Lyric Video Kinetic, Trailer Film Pendek, Intro Gaming, Podcast Audiogram, Music Visualizer, Opening Credits |
| [`09-kuliner-travel-lifestyle.md`](references/storyboards/09-kuliner-travel-lifestyle.md) | `T081`–`T090` | Resep Cepat, Promo Restoran, Destinasi Wisata, Hotel/Villa Promo, Rutinitas Fitness, Skincare, Fashion Lookbook, Tur Properti, Otomotif |
| [`10-infografis-data.md`](references/storyboards/10-infografis-data.md) | `T091`–`T100` | Statistik Tahunan (Big Number), Perbandingan A vs B, Timeline Proses, Funnel Bisnis, Exploded View, Top 5 Ranking, Peta Data, Line Chart, Wrapped |
| [`11-apple-interactive.md`](references/storyboards/11-apple-interactive.md) | `T101`–`T103` | Tutorial, intro brand, edukasi interaktif dengan template TSX |

---

## 7. 44 File Spesifikasi Gaya Desain (`references/styles/`)

Lihat [44 gaya dan file panduan masing-masing](references/STYLES.md). Setiap panduan berisi komposisi 16:9 dan 9:16, arah palet dan material, cara memperlakukan UI sumber, contoh koreografi per frame, resep Remotion, serta uji tampilan yang khas.

Contoh: [Swiss #12](references/styles/12-swiss-internasional.md) memakai grid, crop kontrol, dan hold baca. [Split Flap #10](references/styles/10-split-flap.md) mengatur engsel glyph dan kolom angka tetap. [Risograph #14](references/styles/14-risograph.md) memakai plat tinta, overprint, dan register slip. Pilih berdasarkan subjek yang perlu terlihat, lalu uji hasil pada ukuran layar tujuan.

---

## 8. 64 Lagu Backsound & 65+ Studio SFX Terikat-Animasi

Dokumentasi lengkap terdapat di [`references/SOUND.md`](references/SOUND.md):

1. **9 SFX Transisi Studio CC0 (`public/audio/sfx/`):**
   - `transition-swoosh.wav` (`whip-glide-left`), `transition-swipe.wav` (`whip-glide-up`), `transition-whoosh-soft.wav` (`portal-zoom-in`), `transition-maximize.wav` (`spring-sheet-up`), `transition-minimize.wav`, `transition-chop.wav` (`match-cut`), `transition-cinematic.wav`, `transition-scroll.wav`, `transition-glitch.wav`.
2. **56+ SFX Interaksi & Pack Tematik:**
   - **Ketikan Keyboard Asli:** `typing-loop.wav` (mekanik), `typing-soft.wav` (laptop), `typing-digital.wav` (terminal).
   - **Loading & Data:** `progress-loop.wav` (detak naik `0% -> 100%`), `data-reveal.wav`, `confirm-chime.wav`, `ding-bell.wav` (`d2.wav`).
   - **Kursor & Kartu:** `hover-rollover.wav`, `click.wav` (`d1.wav`), `click-soft.wav`, `toggle-on.wav`, `pop-in.wav`, `pop-plop.wav`, `pop-drop.wav`, `k1.wav`–`k5.wav` (kertas/polaroid), `m1.wav`–`m4.wav` (mekanik), `r1.wav`–`r3.wav` (arcade), `o1.wav`–`o5.wav` (organik).
3. **40 Lagu Backsound Prosedural Multi-Chord (`B00`–`B39` di `scripts/synth-audio.mjs`):**
   - Termasuk 15 lagu modern `B25` (*Apple Keynote Minimal Pluck*), `B26` (*Framer / Linear SaaS Groove*), `B27` (*Vox Documentary Piano*), `B28` (*Phonk Drift*), `B29` (*UK Garage 2-Step*), `B30` (*Bedroom Indie Synth*), `B31` (*Neo-Soul Rhodes*), `B32` (*Liquid DnB*), `B33` (*Future Bass*), `B34` (*Bossa Nova*), `B35` (*Dark Matrix Techno*), `B36` (*Sunny Acoustic*), `B37` (*Cinematic Hybrid*), `B38` (*Vaporwave*), `B39` (*Nu-Disco Funk*).
4. **24 Lagu Rekaman Studio Royalty-Free (`M01`–`M24` di `scripts/fetch-music.mjs`):**
   - Mengunduh dan mengonversi lagu studio ke WAV 48kHz stereo siap pakai.

---

## 9. Alur Kerja CLI & Skrip Otomatis

Seluruh skrip di folder `scripts/` berjalan dengan **Node.js murni (zero external npm dependencies)**:

Lengkapi brief bersama user melalui [intake adaptif](references/BRIEF-INTAKE.md). Pertanyaan hanya untuk detail yang belum jelas, dengan saran agen atau jawaban sendiri. Simpan keputusan ke `resolved-brief.json`; seluruh entry point produksi memerlukannya dan menolak flag yang bertentangan.

Perintah `plan-motion.mjs` memilih struktur adegan dan gaya dalam satu langkah. Output meliputi `style-bible.md`, `selected-style-guide.md`, `storyboard.md`, `scenes-plan.json`, dan `motion-plan.md`. Periksa asumsi di plan dan adaptasi adegan ke aset/aksi yang diminta. `draw-style.mjs` dan `scenes.mjs` tetap bisa dipakai terpisah dengan pemilih yang sama.

```bash
# Pilih pasangan dari brief. Brief ini memakai asumsi installer grafis.
node "<skill>/scripts/plan-motion.mjs" --brief-file resolved-brief.json --out research

# Atau kunci salah satu/kedua pilihan. Format bisa disetel terpisah.
node "<skill>/scripts/plan-motion.mjs" --brief-file resolved-brief.json --template T036 --out research

# 3. Ambil Logo SVG Resmi untuk Semua Brand/Project yang Disebut
node "<skill>/scripts/fetch-brand-logo.mjs" --brands "claude,remotion,after-effects,react,typescript,github" --project-dir . --out public/brands

# 4. Sinkronisasi Subtitle Narator (words.json) & Sintesis Audio 48kHz (Lagu B00-B39 + 65 SFX)
node "<skill>/scripts/narrator-sync.mjs" --text "Tampilkan visual utama di tengah dan subtitle bersih di bawah." --profile N01 --out-words public/words.json --out-map research/word-map.md
node "<skill>/scripts/synth-audio.mjs" --bgm B26 --duration 15 --fps 30 --out public/audio

# Opsional: Unduh Lagu Studio Royalty-Free (M01-M24)
node "<skill>/scripts/fetch-music.mjs" --song M03 --duration 15 --out public/audio/music.wav

# 5. Jalankan Static Anti-Slop Linter & Safe-Zone Camera Inspector
node "<skill>/scripts/lint.mjs" src
node "<skill>/scripts/inspect-motion.mjs" --src src --comp MainVideo --frames 15,50,95,100,150,200

# 6. Render Video Akhir
npx remotion render MainVideo out/v1.mp4
```

---

## 10. Struktur Direktori & Benchmark Uji Skill

```text
motion-craft/
├── SKILL.md                              # Instruksi utama agent (/motion-craft)
├── README.md                             # Dokumentasi lengkap (Bahasa Indonesia)
├── install.sh / install.ps1              # Installer lintas agent (Claude, ZCode, Cursor, Codex)
├── assets/audio/
│   ├── sfx/                              # 49 file rekaman studio SFX CC0 (.wav)
│   └── songs/                            # 8 lagu BGM pre-bundled (.wav)
├── references/
│   ├── STYLES.md                         # Indeks utama 44 gaya desain visual
│   ├── styles/                           # 44 file spesifikasi rinci (01-cyberpunk.md .. 44-apple-inspired-product-cinema.md)
│   ├── storyboards/                      # INDEX.md + 11 file kategori (103 template T001-T103)
│   ├── CARD-GRID-3D-PATTERNS.md          # Dokumentasi 19 komponen 3D Card, Grid, & Card Interaction
│   ├── SOUND.md                          # Katalog 64 lagu BGM & 65+ Studio SFX
│   ├── CAMERA-SCENES-NARRATOR.md         # Dokumentasi C1 Spline Camera & 5 profil narator
│   └── REPLICATION-AND-QA.md             # Tabel After Effects -> Remotion & Mode Replikasi 100%
├── scripts/
│   ├── plan-motion.mjs                  # Pemilih pasangan dan generator rencana
│   ├── draw-style.mjs                    # Pemilih gaya desain & penyalin style guide .md
│   ├── scenes.mjs                        # Planner storyboard (T001-T103) & pacing asimetris
│   ├── fetch-brand-logo.mjs              # Resolver SVG logo brand resmi (lokal + svgl + SimpleIcons)
│   ├── narrator-sync.mjs                 # Generator word-level subtitle timing (words.json)
│   ├── synth-audio.mjs                   # Synthesizer 48kHz WAV (40 lagu B00-B39 + 65 SFX)
│   ├── fetch-music.mjs                   # Downloader 24 lagu studio royalty-free (M01-M24)
│   ├── lint.mjs                          # Static Anti-Slop Linter (0 emoji, 0 shake, 0 filler icon)
│   ├── inspect-motion.mjs                # Safe-Zone & Bounding-Box Camera Spline Inspector
│   └── run-evals.mjs                     # Automated Benchmark Suite (5 pengujian menyeluruh)
└── templates/
    ├── STORYBOARD.template.md            # Template kosong rencana storyboard
    ├── components/
    │   ├── BrandLogos.tsx                # Komponen <BrandLogo /> (25+ preset + auto-fallback SVG)
    │   ├── LivedInUIShells.tsx           # <AuthenticBrowserWindow />, <AuthenticTerminalWindow />, <ChatAppShell />, <MacDesktopChrome />
    │   ├── Card3DLayouts.tsx             # 7 komponen 3D Card Layout (Coverflow, FerrisWheel, CubeRoll, Cylinder, Helix, Sphere, ZDepthTunnel)
    │   ├── GridAnimations.tsx            # 5 komponen Grid Animation (Bento, ExplodeToGrid, LayoutMorph, MasonryZoom, GridRecap)
    │   ├── CardInteractions.tsx          # 7 komponen Card Interaction (StackSwipe, FanSpread, PolaroidDrop, CardFlip, PageCurl, PageTurn, Accordion)
    │   ├── KineticWords.tsx              # <BottomSubtitleBar />, <TypeText />, <AnimatedProgressBar />, <FlyText />
    │   ├── AnimatedCursor.tsx            # Kursor Fitts's Law dengan hover & click SFX otomatis
    │   ├── CameraRig.tsx                 # Kamera C1 Spline dengan velocity motion blur & spotlight
    │   ├── Transitions.tsx               # <SeamlessSceneShell />, <SharedElementMorph />, & <SfxCue />
    │   ├── AudioStage.tsx                # Mixer BGM, Ambience, & Auto-Ducking (-14 LUFS)
    │   └── ProceduralBackground.tsx      # Latar prosedural bersih sesuai gaya
    └── theme/
        ├── easing-and-timing.ts          # Fungsi splineAt, springAt, staggeredSpringAt, microBob
        └── styles-catalog.ts             # Preset data ringkas ke-44 gaya desain
```

### Menjalankan Benchmark Uji Skill
Untuk memastikan seluruh komponen, linter, generator storyboard, dan synthesizer audio berjalan sempurna:
```bash
node scripts/run-evals.mjs
```

---

## Lisensi

Dirilis di bawah lisensi [MIT License](LICENSE).

