# Storyboard 02 — Korporat & Profesional (T011–T020)

Letakkan bukti di depan slogan. Pilih satu grafik, gambar tim, atau aksi yang membuktikan klaim. Jaga grid dan identitas brand, serta hilangkan kartu dekoratif yang mengulang pesan.

Kode kamera, transisi, dan SFX ada di [INDEX.md](INDEX.md). Durasi, rasio, dan cue pada tabel adalah acuan yang bisa diadaptasi untuk brief dan panduan gaya yang terpilih.

---

### T011 · Company Profile
durasi 30s · 16:9 · gaya "korporat bersih, tipografi tegas, palet 2 warna" · bgm B26 · komponen: `<BentoGridReveal />`, `<GridRecapZoomOut />`, `<BrandLogo />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | `<BrandLogo />` perusahaan di tengah, nama dan tagline di bawah | logo reveal, tagline mask | HOLD | PZI | pop-in |
| 2 | 4–10 | Profil singkat: tahun berdiri, lokasi, jumlah karyawan sebagai angka besar | counter naik stagger | HOLD | MC | data-reveal |
| 3 | 10–17 | Layanan utama: 3 kolom tipografi dengan garis tipis pemisah | kolom `staggeredSpringAt` | GLIDE | WGL | pop-plop |
| 4 | 17–24 | Pencapaian atau klien: deretan `<BrandLogo />` klien asli | logo masuk berurutan | GLIDE | WGU | data-reveal |
| 5 | 24–30 | Ajakan kerja sama, situs web dan kontak | hold + `microBob` | PULL | END | confirm-glass |

### T012 · Pitch Startup
durasi 30s · 16:9 · gaya "modern, berani, kontras gelap" · bgm B26 · komponen: `<ExplodeToGrid />`, `<BentoGridReveal />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Satu kalimat masalah dalam tipografi besar | mask reveal per kata | HOLD | MC | impact-soft |
| 2 | 4–10 | Solusi: tampilan produk nyata di `<AuthenticBrowserWindow />` | window pop-in | PUSH | PZI | pop-plop |
| 3 | 10–16 | Ukuran pasar: tiga angka besar (TAM, SAM, SOM) | counter naik | HOLD | WGL | data-reveal |
| 4 | 16–23 | Traksi: grafik pertumbuhan garis tergambar | line draw-on + titik data | PUSH | WGU | data-reveal |
| 5 | 23–30 | Permintaan investasi dan kontak tim | hold, hero tipografi | HOLD | END | confirm-glass |

### T013 · Laporan Kinerja Kuartal
durasi 25s · 16:9 · gaya "data-forward, tenang, grid rapi" · bgm B27 · komponen: `<BentoGridReveal />`, `<MasonryZoomDetail />`, `<BrandLogo />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Judul periode (misal Q3) dan nama perusahaan | fade + translateY kecil | HOLD | MC | — |
| 2 | 3–9 | Pendapatan: angka besar dan delta persentase naik/turun | counter + panah SVG fungsional | HOLD | WGL | data-reveal |
| 3 | 9–16 | Grafik batang per bulan | batang tumbuh `staggeredSpringAt` | PUSH | PZI | data-reveal |
| 4 | 16–21 | Tiga metrik pendukung dalam grid | stagger kartu | GLIDE | WGU | pop-plop |
| 5 | 21–25 | Ringkasan satu kalimat dan target kuartal berikutnya | mask reveal | HOLD | END | confirm-glass |

### T014 · Onboarding Karyawan Baru
durasi 25s · 16:9 · gaya "ramah, terang, informatif" · bgm B26 · komponen: `<AccordionFoldCard />`, `<CardStackSwipe />`, `<MacDesktopChrome />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Ucapan "Selamat bergabung" dan nama perusahaan | mask reveal + `<BrandLogo />` | HOLD | PZI | pop-in |
| 2 | 3–9 | Hari pertama: jadwal dalam bentuk daftar waktu | baris masuk stagger | HOLD | MC | pop-plop |
| 3 | 9–15 | Akses akun: layar login dan email di `<AuthenticBrowserWindow />` | `<TypeText />` isi kolom | TYPE | WGU | TYPE (soft) |
| 4 | 15–21 | Peta tim: diagram struktur tim dengan garis penghubung | line draw-on | GLIDE | WGL | data-reveal |
| 5 | 21–25 | Kontak HR dan jam bantuan | hold | HOLD | END | confirm-glass |

### T015 · Lowongan Kerja (Rekrutmen)
durasi 15s · 9:16 · gaya "tegas, tipografi besar, kontras tinggi" · bgm B29 · komponen: `<CardStackSwipe />`, `<FanSpreadCards />`, `<BrandLogo />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–2 | Tulisan "KAMI MENCARI" tipografi raksasa | letter stagger | HOLD | MC | impact-soft |
| 2 | 2–6 | Nama posisi dan lokasi penempatan | mask reveal | PUSH | WGU | pop-in |
| 3 | 6–10 | 3 kualifikasi utama, satu per baris | baris masuk bergantian | HOLD | WGL | data-reveal |
| 4 | 10–13 | Batas pendaftaran, angka tanggal besar | counter tanggal | HOLD | PZI | pop-plop |
| 5 | 13–15 | `<BrandLogo />` + alamat email atau tautan lamaran | hold | HOLD | END | confirm-glass |

### T016 · Event Recap Perusahaan
durasi 20s · 16:9 · gaya "dinamis, editorial, foto dominan" · bgm B32 · komponen: `<PolaroidDropTable />`, `<ExplodeToGrid />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Nama acara dan tanggal di atas foto acara (aset user) | foto scale 1.08→1.0 | PUSH | WGL | impact-soft |
| 2 | 3–8 | Tiga foto bergantian, tiap foto dengan keterangan tipografi | match-cut antar foto | GLIDE | MC | pop-in |
| 3 | 8–13 | Angka kunci acara: peserta, sesi, pembicara | counter naik stagger | HOLD | WGU | data-reveal |
| 4 | 13–17 | Kutipan peserta atau pembicara, tipografi besar | mask reveal | HOLD | PZI | — |
| 5 | 17–20 | `<BrandLogo />` + ajakan acara berikutnya | hold | PULL | END | confirm-glass |

### T017 · Laporan CSR
durasi 25s · 16:9 · gaya "tulus, dokumenter, palet alam" · bgm B27 · komponen: `<BentoGridReveal />`, `<PolaroidDropTable />`, `<BrandLogo />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Judul program dan lokasi kegiatan, latar foto lapangan (aset user) | fade + zoom pelan | PUSH | PZI | — |
| 2 | 4–10 | Ringkasan masalah masyarakat, satu kalimat besar | mask reveal | HOLD | MC | — |
| 3 | 10–17 | Kegiatan: tiga foto dengan keterangan singkat | match-cut + slide halus | GLIDE | WGL | pop-in |
| 4 | 17–22 | Dampak: angka penerima manfaat sebagai angka besar | counter naik | HOLD | WGU | data-reveal |
| 5 | 22–25 | `<BrandLogo />` + ucapan terima kasih | hold | HOLD | END | confirm-glass |

### T018 · Ucapan HUT Perusahaan
durasi 15s · 16:9 · gaya "perayaan elegan, tipografi besar" · bgm B31 · komponen: `<HelixCards3D />`, `<PolaroidDropTable />`, `<BrandLogo />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Angka usia perusahaan (misal 10) raksasa di tengah | counter 0→10, spring | HOLD | PZI | impact-soft |
| 2 | 3–7 | Kalimat "Tahun ... bersama Anda" muncul di bawah angka | mask reveal | PUSH | MC | pop-in |
| 3 | 7–11 | Tiga tonggak sejarah dalam garis waktu singkat | line draw-on + titik | GLIDE | WGL | data-reveal |
| 4 | 11–15 | `<BrandLogo />` + ucapan terima kasih | logo reveal, hold | HOLD | END | confirm-glass |

### T019 · Visi, Misi & Nilai
durasi 20s · 16:9 · gaya "tenang, tipografi serif/sans kontras" · bgm B27 · komponen: `<CubeRoll3D />`, `<FanSpreadCards />`, `<BrandLogo />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Kata "Visi" kecil, kalimat visi tipografi besar | mask reveal per baris | HOLD | MC | — |
| 2 | 4–9 | Kata "Misi", empat poin misi dalam daftar bernomor | baris stagger | HOLD | WGU | pop-in |
| 3 | 9–15 | Nilai perusahaan: tiga kata besar bergantian | kata ganti dengan `MORPH` huruf | HOLD | MORPH | pop-plop |
| 4 | 15–20 | `<BrandLogo />` + tagline | logo reveal | PULL | END | confirm-glass |

### T020 · Roadmap Produk
durasi 25s · 16:9 · gaya "teknis bersih, garis waktu horizontal" · bgm B26 · komponen: `<HelixCards3D />`, `<CylinderCards3D />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Judul "Roadmap" dan tahun | fade + translateY | HOLD | MC | — |
| 2 | 3–9 | Garis waktu horizontal tergambar, penanda kuartal | line draw-on `easeInOutSmooth` | GLIDE | WGL | data-reveal |
| 3 | 9–16 | Milestone 1 dan 2 muncul di garis dengan nama fitur | titik pop + label fade | GLIDE | WGL | pop-plop |
| 4 | 16–22 | Milestone 3 dan 4, kamera menyapu ke kanan | `staggeredSpringAt` | GLIDE | PZI | pop-plop |
| 5 | 22–25 | Ringkasan satu kalimat + `<BrandLogo />` | hold | PULL | END | confirm-glass |
