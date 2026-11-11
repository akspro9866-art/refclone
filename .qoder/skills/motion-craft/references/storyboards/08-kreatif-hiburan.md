# Storyboard 08 — Kreatif & Hiburan (T071–T080)

Tetapkan bentuk aksi utama sebelum memilih efek: pose, cut editorial, lyric timing, waveform, atau overlay siaran. Pakai lirik, audio, dan footage yang diberikan atau berlisensi. Sinkronkan efek dengan kejadian.

Kode kamera, transisi, dan SFX ada di [INDEX.md](INDEX.md). Durasi, rasio, dan cue pada tabel adalah acuan yang bisa diadaptasi untuk brief dan panduan gaya yang terpilih.

---

### T071 · Intro Channel YouTube
durasi 8s · 16:9 · gaya "ringkas, logo sebagai hero, ritme cepat" · bgm B29 · komponen: `<ZDepthTunnel />`, `<CubeRoll3D />`, `<BrandLogo />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–2 | Layar solid, satu garis tipis bergerak melintas | line sweep `easeInOutSmooth` | HOLD | MORPH | impact-soft |
| 2 | 2–5 | Garis berubah jadi bentuk logo, nama channel muncul | `SharedElementMorph` garis→logo | PUSH | MC | pop-in |
| 3 | 5–7 | Tagline satu baris di bawah logo | mask reveal | HOLD | PZI | — |
| 4 | 7–8 | Hold singkat lalu keluar | fade | HOLD | END | confirm-glass |

### T072 · Outro + End Screen YouTube
durasi 15s · 16:9 · gaya "bersih, memberi ruang kosong untuk elemen YouTube" · bgm B25 · komponen: `<LayoutMorphGridToCarousel />`, `<AnimatedCursor enableClickSfx />`, `<BrandLogo />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Ucapan terima kasih tipografi besar di sisi kiri | mask reveal | HOLD | MC | pop-in |
| 2 | 3–8 | Dua kotak kosong (zona video rekomendasi) digambar garis tipis, label kecil di bawahnya | line draw-on | HOLD | MC | pop-plop |
| 3 | 8–12 | Zona subscribe di sisi kiri bawah, nama channel dan `<BrandLogo />` | logo reveal | HOLD | WGU | confirm-glass |
| 4 | 12–15 | Hold dengan `microBob` | hold | HOLD | END | — |

### T073 · Lyric Video Kinetic
durasi 30s · 16:9 · gaya "tipografi kinetis, tenang, kontras kuat" · bgm lagu milik user (atau B31) · komponen: `<PageTurnBook />`, `<ZDepthTunnel />`, `<SharedElementMorph />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Judul lagu dan nama artis, tipografi besar | mask reveal | HOLD | MC | — |
| 2 | 4–12 | Baris lirik 1 dan 2, kata disinkronkan ke ketukan (`words.json`) | kata stagger sesuai timestamp | HOLD | MC | — |
| 3 | 12–20 | Baris lirik 3 dan 4, kata kunci diperbesar dan diberi kontras | scale + `MORPH` antar baris | PUSH | MORPH | — |
| 4 | 20–27 | Bagian reff: tipografi memenuhi frame, ritme lebih cepat | letter stagger | PUSH | PZI | — |
| 5 | 27–30 | Kredit: nama penulis dan label | fade | HOLD | END | — |

### T074 · Trailer Film Pendek
durasi 30s · 16:9 · gaya "sinematik, kontras tinggi, tipografi lebar" · bgm B32 · komponen: `<ZDepthTunnel />`, `<Coverflow3D />`, `<PolaroidDropTable />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–5 | Layar gelap, satu kalimat premis muncul kata per kata | mask reveal pelan | HOLD | PZI | impact-soft |
| 2 | 5–12 | Cuplikan 3 adegan (aset user) dengan keterangan kecil | match-cut ritme beat | GLIDE | MC | pop-in |
| 3 | 12–19 | Nama pemeran dan peran, tipografi lebar satu per layar | mask reveal | HOLD | WGL | pop-plop |
| 4 | 19–26 | Klimaks: cuplikan cepat, 4 potongan | match-cut cepat | PUSH | WGU | impact-soft |
| 5 | 26–30 | Judul film, tanggal tayang, `<BrandLogo />` rumah produksi | scale reveal | PULL | END | confirm-glass |

### T075 · Intro Channel Gaming / Game Trailer
durasi 20s · 16:9 · gaya "agresif, kontras gelap, aksen neon tunggal" · bgm B28 · komponen: `<ZDepthTunnel />`, `<CubeRoll3D />`, `<CylinderCards3D />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Layar hitam, garis aksen menyapu dan membentuk nama game | line sweep + mask | HOLD | WGL | impact-soft |
| 2 | 3–9 | Gameplay atau key art (aset user), judul tipografi tebal | foto/video scale 1.08→1.0 | PUSH | MC | pop-in |
| 3 | 9–14 | Tiga fitur game satu per layar dengan angka (misal 40+ level) | counter + mask | HOLD | WGU | data-reveal |
| 4 | 14–18 | Cuplikan cepat 4 adegan | match-cut ritme beat | GLIDE | PZI | impact-soft |
| 5 | 18–20 | Nama game, platform (`<BrandLogo />` platform), tanggal rilis | hold | PULL | END | confirm-glass |

### T076 · Podcast Promo Audiogram
durasi 20s · 9:16 · gaya "editorial, tipografi besar, waveform sebagai hero" · bgm audio podcast user · komponen: `<Coverflow3D />`, `<ChatAppShell />`, `<BottomSubtitleBar />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Judul episode dan nama podcast | mask reveal | HOLD | MC | — |
| 2 | 3–7 | Waveform digambar dari data audio asli (`getAudioData`/`visualizeAudio`) | bar bergerak sesuai audio | HOLD | MC | — |
| 3 | 7–15 | Kutipan episode muncul kata per kata, disinkronkan dengan suara | kata stagger dari `words.json` | HOLD | WGU | — |
| 4 | 15–18 | Nama tamu dan topik | mask reveal | HOLD | PZI | — |
| 5 | 18–20 | Platform putar dengan `<BrandLogo />` tiap platform, tautan | logo stagger | HOLD | END | confirm-glass |

### T077 · Music Visualizer Teaser
durasi 15s · 1:1 · gaya "gelap, minimal, garis tipis, audio-reaktif" · bgm lagu milik user · komponen: `<SphereCards3D />`, `<CylinderCards3D />`, `<BottomSubtitleBar />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Frame gelap, satu garis horizontal tipis di tengah | fade-in garis | HOLD | MC | — |
| 2 | 3–8 | Garis berubah jadi bentuk gelombang mengikuti audio | `visualizeAudio` bass/mid/treble | HOLD | MC | — |
| 3 | 8–12 | Judul lagu muncul tipografi tipis di bawah | mask reveal | PUSH | PZI | — |
| 4 | 12–15 | Tanggal rilis, platform, nama artis | fade | HOLD | END | — |

### T078 · Vlog Opening Title
durasi 10s · 16:9 · gaya "ringan, tipografi besar, cepat" · bgm B31 · komponen: `<PolaroidDropTable />`, `<FanSpreadCards />`, `<BottomSubtitleBar />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Judul episode vlog tipografi besar di atas footage user | mask reveal | HOLD | WGL | pop-in |
| 2 | 3–6 | Lokasi dan tanggal kecil, garis tipis pemisah | line draw-on | PUSH | MC | — |
| 3 | 6–9 | Nama kreator dan nomor episode | counter nomor | HOLD | PZI | pop-plop |
| 4 | 9–10 | Keluar ke footage | fade | HOLD | END | — |

### T079 · Title Sequence Short Film (Opening Credits)
durasi 25s · 16:9 · gaya "sinematik, tipografi serif lebar, kontras halus" · bgm B27 · komponen: `<PageTurnBook />`, `<ZDepthTunnel />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–5 | Layar gelap, nama rumah produksi muncul perlahan | fade-in pelan | HOLD | PZI | — |
| 2 | 5–11 | "Disutradarai oleh ..." dan nama, satu baris di atas visual abstrak (kode) | mask reveal | HOLD | MC | — |
| 3 | 11–17 | Nama pemeran utama, satu per layar | match-cut | HOLD | MC | — |
| 4 | 17–22 | Kru utama: penulis, sinematografer, editor | baris stagger | HOLD | WGU | — |
| 5 | 22–25 | Judul film besar di tengah | scale reveal lambat | PUSH | END | impact-soft |

### T080 · Bumper / Lower Third Pack
durasi 6s · 16:9 · gaya "overlay transparan, minimal" · bgm tanpa musik (SFX saja) · komponen: `<CardFlip3D />`, `<PageCurlCard />`, `<BrandLogo />`

Render sebagai video transparan (ProRes 4444 atau WebM VP9 alpha) agar bisa ditumpuk di editor lain.

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–1.5 | Garis tipis tumbuh dari kiri di zona sepertiga bawah | line draw-on | HOLD | MC | pop-in |
| 2 | 1.5–4.5 | Nama (baris 1, tebal) dan jabatan/topik (baris 2, tipis) di atas garis | mask reveal berurutan | HOLD | MC | — |
| 3 | 4.5–6 | Semua elemen keluar ke kiri | slide out `easeInOutSmooth` | HOLD | END | — |
