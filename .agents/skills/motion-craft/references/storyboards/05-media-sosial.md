# Storyboard 05 — Media Sosial (T041–T050)

Bangun layout vertikal dari awal. Gunakan crop besar, satu aksi per beat, dan ruang untuk overlay platform. Hard cut bisa dipakai saat informasi berubah. Pastikan hook dan frame hasil tetap terbaca pada ponsel.

Kode kamera, transisi, dan SFX ada di [INDEX.md](INDEX.md). Durasi, rasio, dan cue pada tabel adalah acuan yang bisa diadaptasi untuk brief dan panduan gaya yang terpilih.

---

### T041 · Hook 3 Detik TikTok / Reels
durasi 15s · 9:16 · gaya "tipografi raksasa, kontras tajam, cepat" · bgm B29 · komponen: `<CardStackSwipe />`, `<BentoGridReveal />`, `<BottomSubtitleBar />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–2 | Satu pernyataan kontroversial/pertanyaan tipografi raksasa | letter stagger, scale pop | HOLD | MC | impact-soft |
| 2 | 2–5 | Pertegas masalah: 2 kata kunci berganti cepat | kata ganti dengan `MORPH` huruf | PUSH | WGU | pop-in |
| 3 | 5–10 | Jawaban atau demo: UI nyata atau diagram kecil | element pop `staggeredSpringAt` | HOLD | WGL | data-reveal |
| 4 | 10–13 | Hasil/angka kunci | counter naik | HOLD | PZI | impact-soft |
| 5 | 13–15 | Ajakan: ikuti akun dan nama akun | hold | HOLD | END | confirm-glass |

### T042 · Tips Cepat 3 Hal
durasi 20s · 9:16 · gaya "bersih, penomoran besar, ramah" · bgm B29 · komponen: `<CardStackSwipe />`, `<FanSpreadCards />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Judul "3 tips ...", angka 3 raksasa | angka spring-in, judul mask | HOLD | MC | pop-in |
| 2 | 3–8 | Tips 1: angka 1 besar, kalimat tips, diagram kecil | slide masuk | HOLD | WGU | pop-plop |
| 3 | 8–13 | Tips 2 dengan tata letak sama | slide sama | HOLD | WGU | pop-plop |
| 4 | 13–18 | Tips 3 dengan tata letak sama | slide sama | HOLD | PZI | pop-plop |
| 5 | 18–20 | Ajakan simpan dan bagikan, nama akun | hold | HOLD | END | confirm-glass |

### T043 · Cerita Chat Gaya iMessage
durasi 20s · 9:16 · gaya "UI chat autentik, warna bubble asli" · bgm B31 · komponen: `<ChatAppShell />`, `<TypeText enableTypingSfx typingVariant="soft" />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | `<ChatAppShell />` dengan nama kontak, pesan pembuka masuk | bubble spring-in | HOLD | MC | pop-plop |
| 2 | 3–9 | Balas-membalas 4 pesan dengan indikator mengetik di antaranya | typing indicator + bubble stagger | HOLD | MC | pop-plop |
| 3 | 9–14 | Pesan panjang diketik langsung oleh `<TypeText />` | kamera mengikuti ketikan | TYPE | WGU | TYPE (soft) |
| 4 | 14–18 | Plot twist: satu pesan penting, bubble diperbesar | scale 1.15 + kamera push | PUSH | PZI | impact-soft |
| 5 | 18–20 | Kalimat penutup dan nama akun | hold | HOLD | END | confirm-glass |

### T044 · Kinetic Typography Quote
durasi 15s · 9:16 · gaya "editorial, tipografi sebagai hero, minim elemen" · bgm B27 · komponen: `<PageTurnBook />`, `<SharedElementMorph />`, `<BottomSubtitleBar />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Kata pertama kutipan raksasa di tengah | scale + mask | HOLD | MORPH | pop-in |
| 2 | 3–7 | Kata kedua dan ketiga menggantikan lewat morph huruf | `SharedElementMorph` antar kata | HOLD | MORPH | pop-in |
| 3 | 7–11 | Kalimat lengkap tersusun, kata kunci diberi kontras | kata stagger | PUSH | WGU | data-reveal |
| 4 | 11–13 | Nama pengutip kecil di bawah | fade | HOLD | PZI | — |
| 5 | 13–15 | Nama akun | hold | HOLD | END | confirm-glass |

### T045 · Countdown Event / Rilis
durasi 10s · 9:16 · gaya "dramatis, angka raksasa" · bgm B32 · komponen: `<CubeRoll3D />`, `<ZDepthTunnel />`, `<BottomSubtitleBar />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–2 | Nama event kecil di atas, angka hari (misal 03) raksasa | counter snap | HOLD | MC | impact-soft |
| 2 | 2–5 | Angka jam dan menit menyusul, tata letak grid tiga kolom | counter stagger | PUSH | WGU | data-reveal |
| 3 | 5–8 | Tanggal rilis tipografi besar | mask reveal | HOLD | PZI | pop-in |
| 4 | 8–10 | Nama akun dan ajakan ingatkan saya | hold | HOLD | END | confirm-glass |

### T046 · Giveaway
durasi 15s · 9:16 · gaya "meriah tapi bersih, hadiah sebagai hero" · bgm B29 · komponen: `<FanSpreadCards />`, `<CardFlip3D />`, `<AnimatedCursor enableClickSfx />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Kata "GIVEAWAY" raksasa | letter stagger | HOLD | MC | impact-soft |
| 2 | 3–7 | Hadiah (aset user atau mockup SVG) di tengah | scale-up + `microBob` | PUSH | WGU | pop-in |
| 3 | 7–11 | Tiga syarat ikut dalam daftar bernomor | baris stagger | HOLD | WGL | data-reveal |
| 4 | 11–13 | Batas waktu dan tanggal pengumuman | counter tanggal | HOLD | PZI | pop-plop |
| 5 | 13–15 | Nama akun penyelenggara | hold | HOLD | END | confirm-glass |

### T047 · Behind the Scenes Desktop
durasi 20s · 16:9 · gaya "layar kerja nyata, tenang, timelapse halus" · bgm B25 · komponen: `<MacDesktopChrome />`, `<AuthenticBrowserWindow />`, `<AuthenticTerminalWindow />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | `<MacDesktopChrome />` menu bar dan dock dengan `<BrandLogo />` aplikasi kerja | desktop fade-in | HOLD | MC | pop-plop |
| 2 | 3–9 | Jendela aplikasi 1 dibuka, timeline atau kanvas terisi | window pop-in `staggeredSpringAt` | GLIDE | WGL | pop-in |
| 3 | 9–14 | Jendela aplikasi 2 di sisi lain, kursor memindahkan elemen | kursor drag, `<AnimatedCursor />` | CURSOR | WGL | CLICK |
| 4 | 14–18 | Render: progress 0→100% | `<AnimatedProgressBar enableProgressSfx />` | HOLD | PZI | PROG |
| 5 | 18–20 | Hasil akhir diputar dan nama kreator | hold | HOLD | END | confirm-glass |

### T048 · Mitos vs Fakta
durasi 15s · 9:16 · gaya "kontras dua sisi, tipografi besar" · bgm B29 · komponen: `<CardFlip3D />`, `<PageCurlCard />`, `<BottomSubtitleBar />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Kata "MITOS" dan pernyataan keliru | mask reveal | HOLD | MC | pop-in |
| 2 | 3–6 | Pernyataan dicoret garis tergambar | line draw-on | PUSH | WGU | impact-soft |
| 3 | 6–11 | Kata "FAKTA" dan pernyataan benar | wipe pergantian warna | HOLD | WGL | confirm-glass |
| 4 | 11–13 | Satu data pendukung sebagai angka | counter | HOLD | PZI | data-reveal |
| 5 | 13–15 | Sumber dan nama akun | hold | HOLD | END | — |

### T049 · Poll / Tanya Jawab
durasi 10s · 9:16 · gaya "interaktif, bersih, tipografi besar" · bgm B25 · komponen: `<CardStackSwipe />`, `<AnimatedCursor enableClickSfx />`, `<AnimatedProgressBar enableProgressSfx />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Pertanyaan tipografi besar | mask reveal | HOLD | MC | pop-in |
| 2 | 3–7 | Dua pilihan A dan B sebagai dua blok besar, kursor memilih satu | `<AnimatedCursor enableClickSfx />` | CURSOR | PZI | CLICK |
| 3 | 7–10 | Hasil persentase sebagai batang, nama akun | bar tumbuh, counter | HOLD | END | data-reveal |

### T050 · Expectation vs Reality
durasi 12s · 9:16 · gaya "komedik, dua panel tegas" · bgm B29 · komponen: `<CardFlip3D />`, `<PageCurlCard />`, `<PolaroidDropTable />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–2 | Judul "Ekspektasi vs Realita" | mask reveal | HOLD | MC | pop-in |
| 2 | 2–6 | Panel ekspektasi: gambaran ideal (UI rapi atau komposisi indah) | elemen masuk anggun | HOLD | WGU | confirm-glass |
| 3 | 6–10 | Panel realita: kondisi berantakan, elemen jatuh berantakan | elemen jatuh dengan spring | PUSH | WGL | impact-soft |
| 4 | 10–12 | Satu kalimat punchline dan nama akun | mask reveal | HOLD | END | pop-plop |
