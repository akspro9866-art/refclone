# Storyboard 03 — Edukasi & Akademik (T021–T030)

Atur satu pertanyaan atau langkah per scene. Pakai representasi yang paling tepat untuk materi: diagram, benda, layar installer, atau terminal. Tahan hasil cukup lama untuk dipahami dan simpan caption di luar fokus aksi.

Kode kamera, transisi, dan SFX ada di [INDEX.md](INDEX.md). Durasi, rasio, dan cue pada tabel adalah acuan yang bisa diadaptasi untuk brief dan panduan gaya yang terpilih.

---

### T021 · Penjelasan Konsep (Explainer)
durasi 30s · 16:9 · gaya "dokumenter bersih, diagram dominan" · bgm B27 · komponen: `<AccordionFoldCard />`, `<CardFlip3D />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Pertanyaan pembuka sebagai tipografi besar | mask reveal | HOLD | MC | — |
| 2 | 4–10 | Definisi konsep: diagram sederhana, 3 elemen berlabel | shape draw-on, label fade | PUSH | PZI | pop-plop |
| 3 | 10–18 | Cara kerja: panah aliran antar elemen, bergerak berurutan | line draw-on + titik data bergerak | GLIDE | WGL | data-reveal |
| 4 | 18–25 | Contoh nyata: satu skenario digambar dengan elemen yang sama | morph dari diagram abstrak ke contoh | HOLD | MORPH | pop-in |
| 5 | 25–30 | Ringkasan satu kalimat | mask reveal, hold 24f | HOLD | END | confirm-glass |

### T022 · Presentasi Tugas Kuliah / Skripsi
durasi 30s · 16:9 · gaya "akademik rapi, tipografi sans, palet kampus" · bgm B27 · komponen: `<BentoGridReveal />`, `<MasonryZoomDetail />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Judul tugas, nama, NIM, mata kuliah, `<BrandLogo />` kampus | fade + translateY, urutan baris | HOLD | MC | — |
| 2 | 4–10 | Latar belakang masalah: satu kalimat besar + 2 data pendukung | counter naik | HOLD | WGU | data-reveal |
| 3 | 10–17 | Metode atau rancangan sistem: diagram blok tergambar | blok `staggeredSpringAt`, panah draw-on | GLIDE | WGL | pop-plop |
| 4 | 17–25 | Hasil: tangkapan layar atau grafik di `<AuthenticBrowserWindow />` | window pop-in, kamera zoom ke bagian penting | PUSH | PZI | data-reveal |
| 5 | 25–30 | Kesimpulan 1 kalimat dan ucapan terima kasih | mask reveal | HOLD | END | confirm-glass |

### T023 · Tutorial Step-by-Step
durasi 30s · 16:9 · gaya "instruksi jelas, konteks dan hasil terbaca" · bgm B21 opsional · komponen: visual sumber, anotasi, kontrol UI yang relevan

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Tujuan tutorial dan tampilan hasil yang ingin dicapai | Tampilkan judul dan bukti dalam satu hierarki | HOLD | MC | — |
| 2 | 4–11 | Langkah pertama: layar, bahan, atau kontrol yang digunakan | Perlihatkan keadaan sebelum aksi dan penunjuk bila perlu | HOLD | MC | — |
| 3 | 11–18 | Langkah utama: satu perubahan pada objek atau pengaturan | Perlihatkan tindakan dan respons yang sesuai | PUSH | MC | — |
| 4 | 18–25 | Langkah terakhir: konfirmasi atau cek hasil | Tahan status nyata atau beri label bila waktu dipercepat | HOLD | MC | — |
| 5 | 25–30 | Hasil akhir dan satu keterangan untuk memverifikasinya | Kembali ke tampilan utuh dan beri waktu baca | HOLD | END | — |

### T024 · Timeline Sejarah
durasi 25s · 16:9 · gaya "editorial, sepia lembut atau monokrom, serif" · bgm B27 · komponen: `<HelixCards3D />`, `<ZDepthTunnel />`, `<PageTurnBook />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Judul peristiwa dan rentang tahun | mask reveal | HOLD | MC | — |
| 2 | 4–10 | Garis waktu horizontal tergambar, tahun pertama dan peristiwa | line draw-on, label fade | GLIDE | WGL | data-reveal |
| 3 | 10–16 | Tahun kedua dan ketiga, kamera menyapu ke kanan | titik pop + label | GLIDE | WGL | pop-plop |
| 4 | 16–21 | Titik balik: satu peristiwa diperbesar, foto arsip (aset user) | zoom + fade foto | PUSH | PZI | impact-soft |
| 5 | 21–25 | Dampak sampai hari ini, kalimat penutup | mask reveal | PULL | END | — |

### T025 · Fakta Singkat Edukasi
durasi 15s · 9:16 · gaya "tipografi besar, ramah, kontras tinggi" · bgm B29 · komponen: `<CardFlip3D />`, `<CardStackSwipe />`, `<BottomSubtitleBar />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–2 | Pertanyaan pemancing, tipografi raksasa | letter stagger | HOLD | MC | pop-in |
| 2 | 2–6 | Jawaban: satu angka atau kata besar | scale-up spring | PUSH | WGU | impact-soft |
| 3 | 6–11 | Penjelasan singkat dengan diagram kecil pendukung | shape draw-on | HOLD | WGL | data-reveal |
| 4 | 11–15 | Sumber data dan nama akun | fade + hold | HOLD | END | — |

### T026 · Rangkuman Materi (Cheatsheet)
durasi 25s · 16:9 · gaya "grid rapi, seperti catatan terstruktur" · bgm B27 · komponen: `<ExplodeToGrid />`, `<BentoGridReveal />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Judul materi dan bab | fade + translateY | HOLD | MC | — |
| 2 | 3–10 | Poin inti 1 dan 2 sebagai kartu dengan satu rumus atau kata kunci | kartu `staggeredSpringAt` | HOLD | WGU | pop-plop |
| 3 | 10–17 | Poin inti 3 dan 4 dengan layout sama | stagger sama | GLIDE | WGL | pop-plop |
| 4 | 17–22 | Contoh soal satu baris dan jawabannya diketik | `<TypeText />` | TYPE | PZI | TYPE (soft) |
| 5 | 22–25 | Ringkasan semua poin dalam satu layar | semua kartu mengecil ke grid | PULL | END | confirm-glass |

### T027 · Pengumuman Kampus
durasi 15s · 9:16 · gaya "resmi tapi segar, palet kampus" · bgm B25 · komponen: `<PageCurlCard />`, `<CardStackSwipe />`, `<BrandLogo />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | `<BrandLogo />` kampus dan kata "PENGUMUMAN" | logo reveal + mask | HOLD | MC | pop-in |
| 2 | 3–8 | Isi pengumuman: judul dan satu kalimat inti | mask reveal | HOLD | WGU | — |
| 3 | 8–12 | Tanggal dan tempat sebagai angka dan tipografi besar | counter tanggal | PUSH | PZI | data-reveal |
| 4 | 12–15 | Kontak panitia atau tautan | hold | HOLD | END | confirm-glass |

### T028 · Promosi Seminar / Webinar
durasi 20s · 16:9 · gaya "modern, bold, tipografi besar" · bgm B26 · komponen: `<Coverflow3D />`, `<FanSpreadCards />`, `<AnimatedCursor enableClickSfx />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Judul acara raksasa, jenis acara (webinar/seminar) di atasnya | letter stagger | HOLD | PZI | impact-soft |
| 2 | 3–8 | Pembicara: foto (aset user) dan nama + jabatan | foto reveal wipe | HOLD | MC | pop-in |
| 3 | 8–13 | Topik utama dalam 3 baris | baris stagger | HOLD | WGL | pop-plop |
| 4 | 13–17 | Tanggal, jam, platform sebagai angka dan tipografi besar | counter + mask | PUSH | WGU | data-reveal |
| 5 | 17–20 | Tombol "Daftar" diklik kursor, `<BrandLogo />` penyelenggara | `<AnimatedCursor enableClickSfx />` | CURSOR | END | CLICK |

### T029 · Demo Proyek Capstone
durasi 30s · 16:9 · gaya "teknis, nyata, tenang" · bgm B26 · komponen: `<AuthenticBrowserWindow />`, `<AuthenticTerminalWindow />`, `<BentoGridReveal />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Nama proyek, tim, dosen pembimbing, `<BrandLogo />` kampus | fade + mask | HOLD | PZI | pop-in |
| 2 | 4–9 | Masalah yang diselesaikan, satu kalimat | mask reveal | HOLD | MC | — |
| 3 | 9–20 | Demo aplikasi di `<AuthenticBrowserWindow />`, login lalu fitur utama | `<AnimatedCursor />` klik, `<TypeText />` isi form | CURSOR | WGL | CLICK |
| 4 | 20–26 | Arsitektur singkat: diagram blok teknologi dengan `<BrandLogo />` tiap teknologi | blok stagger, panah draw-on | GLIDE | WGU | pop-plop |
| 5 | 26–30 | Hasil uji dan ucapan terima kasih | counter + hold | HOLD | END | confirm-glass |

### T030 · Diagram Alur Sistem (UML / Flow Explainer)
durasi 25s · 16:9 · gaya "diagram teknis bersih, garis tipis, grid tersembunyi" · bgm B27 · komponen: `<AccordionFoldCard />`, `<LayoutMorphGridToCarousel />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Judul diagram (misal Use Case, Activity, ERD) | fade + mask | HOLD | MC | — |
| 2 | 3–10 | Aktor dan entitas muncul sebagai shape berlabel | shape pop `staggeredSpringAt` | PUSH | WGL | pop-plop |
| 3 | 10–18 | Relasi: garis dan panah tergambar satu per satu, bagian aktif disorot dengan kontras | line draw-on berurutan | GLIDE | WGL | data-reveal |
| 4 | 18–23 | Satu skenario dijalankan: titik data bergerak sepanjang alur | titik bergerak di jalur | CURSOR | PZI | data-reveal |
| 5 | 23–25 | Kesimpulan alur dalam satu kalimat | hold | PULL | END | — |
