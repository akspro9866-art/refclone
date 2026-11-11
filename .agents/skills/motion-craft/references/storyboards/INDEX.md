# STORYBOARD INDEX — 103 Template Storyboard untuk Remotion

Katalog 103 template storyboard di 11 kategori. Setiap template memberi struktur shot, waktu, visual, gerak, kamera, dan cue suara. Buka satu kategori atau satu storyboard yang dipilih planner.

## Pilih dan adaptasi

1. Mulai dari brief. Tentukan tindakan atau objek yang perlu terlihat, lalu pilih pasangan storyboard dan gaya dengan `plan-motion.mjs`. Gunakan `--template` atau `--style` untuk pilihan eksplisit.
2. Baca `research/storyboard.md` dan `research/selected-style-guide.md`. Keterangan gaya pada template memberi mood/struktur awal. Terapkan sistem warna, bentuk, dan gerak dari panduan gaya. Jika keduanya bertentangan, jaga keaslian subjek dan tuntutan brief.
3. Isi scene dengan aset, teks, tindakan, dan data yang benar. Gunakan struktur yang terpilih dan ganti komponen, transisi, atau SFX berdasarkan fungsi. Contoh T023 bisa untuk installer grafis, resep, atau proses kerja. T036 khusus instalasi lewat perintah.
4. Pakai hasil `scenes-plan.json` sebagai batas frame awal. Planner menggunakan durasi relatif dari baris storyboard. `endFrame` eksklusif. `--overlap` menjadi batas maksimum untuk transisi yang membutuhkannya. Match cut dan penutup tidak memakai overlap.

---

## Kode Singkatan

**Cam** (kamera, selalu C1 spline `splineAt`, tanpa shake)

| Kode | Arti |
|---|---|
| HOLD | Diam 1.0x. Dipakai saat konteks utuh. |
| PUSH | Zoom-in halus (sekitar 1.0→1.15x), dengan anticipation pullback 3 frame. |
| PULL | Zoom-out pelan ke tampilan utuh. |
| TYPE | Zoom-follow ketikan, `buildTypingCameraSpline`. |
| CURSOR | Mengikuti kursor dan klik, `buildCursorFollowCameraSpline` (overshoot Fitts's Law, hover 5 frame). |
| GLIDE | Sapuan lebar di kanvas panjang, jendela/elemen masuk via `staggeredSpringAt`. |

**Out** (transisi keluar scene, lewat `<SeamlessSceneShell enableTransitionSfx />`)

| Kode | Arti |
|---|---|
| WGL | `whip-glide-left` |
| WGU | `whip-glide-up` |
| PZI | `portal-zoom-in` |
| SSU | `spring-sheet-up` |
| MC | `match-cut` |
| MORPH | `<SharedElementMorph />` (objek yang sama berubah bentuk lintas scene) |
| END | Scene terakhir: hold lalu fade/keluar. |

**SFX** (selalu terikat pada animasi yang sedang berjalan)

| Kode | Arti |
|---|---|
| TYPE (varian) | `<TypeText enableTypingSfx typingVariant="mechanical" \| "soft" \| "digital" />`, mulai di karakter pertama, berhenti di karakter terakhir. |
| CLICK | `<AnimatedCursor enableClickSfx />` (hover-rollover 6 frame sebelum klik, lalu click). |
| PROG | `<AnimatedProgressBar enableProgressSfx />` dan chime saat 100%. |
| pop-in, pop-plop, data-reveal, confirm-glass, impact-soft | `<SfxCue frame={...} sfx="..." />` tepat saat elemen muncul. |
| — | Tanpa SFX. Jangan menambah SFX liar. |

**BGM** yang dipakai di template:

| ID | Karakter |
|---|---|
| B25 | Apple Keynote Minimal Pluck (minimal, elegan) |
| B26 | Framer / Linear SaaS Groove (teknologi, SaaS) |
| B27 | Vox Documentary Piano (dokumenter, data, edukasi) |
| B28 | Phonk Drift (tegas, gelap, otomotif, gaming) |
| B29 | UK Garage 2-Step (muda, cepat, media sosial) |
| B31 | Neo-Soul Rhodes (hangat, kuliner, perayaan) |
| B32 | Liquid DnB (energik, event, trailer) |

Pilihan lain (B00–B39 dan M01–M24) ada di `references/SOUND.md`.

---

## Cek desain saat adaptasi

- Pilih satu hero dan satu tindakan atau perubahan yang jelas pada tiap scene.
- Pastikan warna, font, dan jenis gerak memperkuat gaya yang dipilih. Jaga posisi label dan nilai yang perlu dibandingkan.
- Pakai UI, nama kontrol, dan status yang benar. Gunakan caption yang terbaca dan tidak menutup aksi bila diperlukan.
- Cocokkan suara ke aksi yang terlihat. Tahan frame hasil, ukur geometri bila dibutuhkan, dan cek shot pada rasio pengiriman.

## Komponen Koreografi Kartu 3D, Grid Animation, & Card Interaction (Siap Pakai di Storyboard)

Selain UI autentik (`<AuthenticBrowserWindow />`, `<AuthenticTerminalWindow />`, `<ChatAppShell />`, `<MacDesktopChrome />`), pakai rekomendasi komponen sesuai isi dari `references/CARD-GRID-3D-PATTERNS.md`:

- **3D Card Layouts (`templates/components/Card3DLayouts.tsx`):** `<Coverflow3D />`, `<FerrisWheelCards />`, `<CubeRoll3D />`, `<CylinderCards3D />`, `<HelixCards3D />`, `<SphereCards3D />`, `<ZDepthTunnel />`.
- **Grid Animations (`templates/components/GridAnimations.tsx`):** `<BentoGridReveal />` (`kotak 1` -> `2-3` -> `lengkap`), `<ExplodeToGrid />` (`tumpukan` -> `pecah` -> `rapi di grid`), `<LayoutMorphGridToCarousel />` (`grid` -> `carousel`), `<MasonryZoomDetail />` (`pilih kotak` -> `jadi halaman`), `<GridRecapZoomOut />` (`slide terakhir` -> `recap semua`).
- **Card Interactions (`templates/components/CardInteractions.tsx`):** `<CardStackSwipe />`, `<FanSpreadCards />`, `<PolaroidDropTable />` (foto jatuh ke meja + `k2.wav`), `<CardFlip3D />` (balik 180 derajat), `<PageCurlCard />` (sudut halaman tergulung), `<PageTurnBook />` (balik halaman buku), `<AccordionFoldCard />` (lipatan zig-zag 3D).

Generate storyboard otomatis dari CLI:
```bash
node "<skill>/scripts/plan-motion.mjs" --brief-file resolved-brief.json --template T032 --out research
```

---

## Daftar Template

### 01 · Bisnis & Promosi — `01-bisnis-promosi.md`
| ID | Nama | Durasi | Rasio |
|---|---|---|---|
| T001 | Promo Produk Teaser | 15s | 9:16 |
| T002 | Flash Sale Countdown | 12s | 9:16 |
| T003 | Grand Opening Toko | 20s | 16:9 |
| T004 | Product Reveal Peluncuran | 20s | 16:9 |
| T005 | Testimoni Pelanggan (Gaya Chat) | 18s | 9:16 |
| T006 | Before–After Produk | 15s | 1:1 |
| T007 | Katalog Menu Kafe/Restoran | 20s | 9:16 |
| T008 | Promo Ramadan / Lebaran | 20s | 16:9 |
| T009 | Paket Harga (Pricing Tiers) | 18s | 16:9 |
| T010 | Cara Pemesanan 4 Langkah (UMKM) | 20s | 9:16 |

### 02 · Korporat & Profesional — `02-korporat-profesional.md`
| ID | Nama | Durasi | Rasio |
|---|---|---|---|
| T011 | Company Profile | 30s | 16:9 |
| T012 | Pitch Startup | 30s | 16:9 |
| T013 | Laporan Kinerja Kuartal | 25s | 16:9 |
| T014 | Onboarding Karyawan Baru | 25s | 16:9 |
| T015 | Lowongan Kerja (Rekrutmen) | 15s | 9:16 |
| T016 | Event Recap Perusahaan | 20s | 16:9 |
| T017 | Laporan CSR | 25s | 16:9 |
| T018 | Ucapan HUT Perusahaan | 15s | 16:9 |
| T019 | Visi, Misi & Nilai | 20s | 16:9 |
| T020 | Roadmap Produk | 25s | 16:9 |

### 03 · Edukasi & Akademik — `03-edukasi-akademik.md`
| ID | Nama | Durasi | Rasio |
|---|---|---|---|
| T021 | Penjelasan Konsep (Explainer) | 30s | 16:9 |
| T022 | Presentasi Tugas Kuliah / Skripsi | 30s | 16:9 |
| T023 | Tutorial Step-by-Step | 30s | 16:9 |
| T024 | Timeline Sejarah | 25s | 16:9 |
| T025 | Fakta Singkat Edukasi | 15s | 9:16 |
| T026 | Rangkuman Materi (Cheatsheet) | 25s | 16:9 |
| T027 | Pengumuman Kampus | 15s | 9:16 |
| T028 | Promosi Seminar / Webinar | 20s | 16:9 |
| T029 | Demo Proyek Capstone | 30s | 16:9 |
| T030 | Diagram Alur Sistem (UML / Flow Explainer) | 25s | 16:9 |

### 04 · Teknologi & Software — `04-teknologi-software.md`
| ID | Nama | Durasi | Rasio |
|---|---|---|---|
| T031 | Demo Aplikasi Mobile | 20s | 9:16 |
| T032 | Demo SaaS Dashboard | 20s | 16:9 |
| T033 | Changelog / Fitur Baru | 15s | 16:9 |
| T034 | Arsitektur / Cara Kerja API | 25s | 16:9 |
| T035 | Coding Demo Live-Typing | 20s | 16:9 |
| T036 | Instalasi CLI di Terminal | 15s | 16:9 |
| T037 | AI Prompt-to-Result | 20s | 16:9 |
| T038 | Showcase Website / Portofolio Developer | 20s | 16:9 |
| T039 | Cybersecurity Awareness | 20s | 16:9 |
| T040 | Proyek Open Source / GitHub Repo | 20s | 16:9 |

### 05 · Media Sosial — `05-media-sosial.md`
| ID | Nama | Durasi | Rasio |
|---|---|---|---|
| T041 | Hook 3 Detik TikTok / Reels | 15s | 9:16 |
| T042 | Tips Cepat 3 Hal | 20s | 9:16 |
| T043 | Cerita Chat Gaya iMessage | 20s | 9:16 |
| T044 | Kinetic Typography Quote | 15s | 9:16 |
| T045 | Countdown Event / Rilis | 10s | 9:16 |
| T046 | Giveaway | 15s | 9:16 |
| T047 | Behind the Scenes Desktop | 20s | 16:9 |
| T048 | Mitos vs Fakta | 15s | 9:16 |
| T049 | Poll / Tanya Jawab | 10s | 9:16 |
| T050 | Expectation vs Reality | 12s | 9:16 |

### 06 · Event & Perayaan — `06-event-perayaan.md`
| ID | Nama | Durasi | Rasio |
|---|---|---|---|
| T051 | Undangan Pernikahan | 25s | 9:16 |
| T052 | Ulang Tahun | 15s | 9:16 |
| T053 | Save the Date | 12s | 1:1 |
| T054 | Aftermovie Konser / Event (Tipografis) | 25s | 16:9 |
| T055 | Trailer Pembukaan Acara | 20s | 16:9 |
| T056 | Ucapan Wisuda | 20s | 9:16 |
| T057 | Ucapan Idulfitri | 20s | 9:16 |
| T058 | Ucapan Tahun Baru | 15s | 9:16 |
| T059 | HUT RI 17 Agustus | 20s | 16:9 |
| T060 | Undangan Reuni | 15s | 9:16 |

### 07 · Sosial & Kampanye — `07-sosial-kampanye.md`
| ID | Nama | Durasi | Rasio |
|---|---|---|---|
| T061 | Kampanye Lingkungan | 25s | 16:9 |
| T062 | Galang Dana / Donasi | 25s | 9:16 |
| T063 | Edukasi Kesehatan Masyarakat | 20s | 9:16 |
| T064 | Anti-Bullying | 20s | 9:16 |
| T065 | Hemat Energi | 20s | 16:9 |
| T066 | Kampanye Literasi | 20s | 16:9 |
| T067 | Keselamatan Berkendara | 15s | 9:16 |
| T068 | Kampanye Pemilihan Ketua Organisasi (OSIS/BEM) | 20s | 9:16 |
| T069 | Hari Peringatan Nasional / Internasional | 15s | 9:16 |
| T070 | Rekrutmen Relawan | 15s | 9:16 |

### 08 · Kreatif & Hiburan — `08-kreatif-hiburan.md`
| ID | Nama | Durasi | Rasio |
|---|---|---|---|
| T071 | Intro Channel YouTube | 8s | 16:9 |
| T072 | Outro + End Screen YouTube | 15s | 16:9 |
| T073 | Lyric Video Kinetic | 30s | 16:9 |
| T074 | Trailer Film Pendek | 30s | 16:9 |
| T075 | Intro Channel Gaming / Game Trailer | 20s | 16:9 |
| T076 | Podcast Promo Audiogram | 20s | 9:16 |
| T077 | Music Visualizer Teaser | 15s | 1:1 |
| T078 | Vlog Opening Title | 10s | 16:9 |
| T079 | Title Sequence Short Film (Opening Credits) | 25s | 16:9 |
| T080 | Bumper / Lower Third Pack | 6s | 16:9 |

### 09 · Kuliner, Travel & Lifestyle — `09-kuliner-travel-lifestyle.md`
| ID | Nama | Durasi | Rasio |
|---|---|---|---|
| T081 | Resep Cepat | 20s | 9:16 |
| T082 | Promo Restoran / Menu Spesial | 15s | 9:16 |
| T083 | Destinasi Wisata | 25s | 16:9 |
| T084 | Hotel / Villa Promo | 20s | 16:9 |
| T085 | Rutinitas Latihan Fitness | 20s | 9:16 |
| T086 | Rutinitas Skincare | 20s | 9:16 |
| T087 | Fashion Lookbook | 20s | 9:16 |
| T088 | Tur Properti | 25s | 16:9 |
| T089 | Showcase Otomotif | 20s | 16:9 |
| T090 | Adopsi Hewan Peliharaan | 15s | 9:16 |

### 10 · Infografis & Data — `10-infografis-data.md`
| ID | Nama | Durasi | Rasio |
|---|---|---|---|
| T091 | Statistik Tahunan (Big Number) | 20s | 16:9 |
| T092 | Perbandingan A vs B | 20s | 16:9 |
| T093 | Timeline Proses | 25s | 16:9 |
| T094 | Alur Bisnis / Funnel | 20s | 16:9 |
| T095 | Cara Kerja Produk (Exploded View) | 25s | 16:9 |
| T096 | Top 5 Ranking | 20s | 9:16 |
| T097 | Peta Data Geografis | 20s | 16:9 |
| T098 | Tren Harga (Line Chart) | 15s | 16:9 |
| T099 | Hasil Survei | 20s | 16:9 |
| T100 | Year in Review (Wrapped) | 30s | 9:16 |
| T101 | Tutorial Interaktif (#44) | 12s | 16:9 |
| T102 | Intro Brand Interaktif (#44) | 10s | 16:9 |
| T103 | Edukasi Sebab–Akibat Interaktif (#44) | 15s | 16:9 |
