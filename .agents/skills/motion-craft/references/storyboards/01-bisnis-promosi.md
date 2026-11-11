# Storyboard 01 — Bisnis & Promosi (T001–T010)

Tampilkan produk atau hasil yang dijual. Pakai foto, kemasan, atau layar sumber; arahkan komposisi dari satu manfaat ke satu bukti dan CTA. Gunakan hitung mundur, harga, dan testimoni hanya saat datanya ada.

Kode kamera, transisi, dan SFX ada di [INDEX.md](INDEX.md). Durasi, rasio, dan cue pada tabel adalah acuan yang bisa diadaptasi untuk brief dan panduan gaya yang terpilih.

---

### T001 · Promo Produk Teaser
durasi 15s · 9:16 · gaya "produk sebagai hero, satu pesan, satu ajakan" · bgm B25 opsional · komponen: foto/vektor asli, crop detail, tipografi

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–2 | Produk atau siluet khas dan judul singkat | Buka bentuk dengan mekanisme gaya yang terpilih | HOLD | MC | — |
| 2 | 2–5 | Close-up bahan, bentuk, atau bagian yang membuat produk dikenali | Potong ke sudut yang memperlihatkan detail | HOLD | MC | — |
| 3 | 5–9 | Satu aksi atau pengalaman menggunakan produk | Gerakkan bagian produk yang memang berubah | HOLD | MC | — |
| 4 | 9–12 | Kembali ke komposisi hero dan pesan inti | Selaraskan siluet atau baseline antarscene | HOLD | MC | — |
| 5 | 12–15 | Produk, nama, dan CTA dari brief | Tahan layout hasil dan sisakan ruang baca | HOLD | END | — |

### T002 · Flash Sale Countdown
durasi 12s · 9:16 · gaya "high-energy, tipografi raksasa, kontras tajam" · bgm B29 · komponen: `<CardStackSwipe />`, `<AnimatedCursor enableClickSfx />`, `<BrandLogo />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–2 | Angka countdown raksasa 03→01 di tengah, background solid | snap per detik + scale pulse | HOLD | MC | impact-soft |
| 2 | 2–5 | Kata "FLASH SALE" kinetic typography memenuhi frame | letter-by-letter `staggeredSpringAt` | PUSH | WGL | pop-in |
| 3 | 5–8 | 3 produk andalan masuk bergantian, harga coret lalu harga baru | slide samping + garis coret draw-on | GLIDE | WGU | data-reveal |
| 4 | 8–10.5 | Persentase diskon dan batas waktu sebagai angka besar | counter 0→70% | HOLD | PZI | impact-soft |
| 5 | 10.5–12 | `<BrandLogo />` toko + tombol "Beli Sekarang" yang diklik kursor | tombol press, `<AnimatedCursor />` | CURSOR | END | CLICK |

### T003 · Grand Opening Toko
durasi 20s · 16:9 · gaya "hangat, meriah tapi bersih" · bgm B31 · komponen: `<ExplodeToGrid />`, `<FanSpreadCards />`, `<BrandLogo />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Fasad toko dari shape SVG, pita terbentang di pintu | line draw-on + wipe reveal | GLIDE | WGL | pop-plop |
| 2 | 3–7 | Nama toko dan tanggal pembukaan, tipografi besar | mask reveal per baris | HOLD | PZI | pop-in |
| 3 | 7–12 | Peta mini lokasi (SVG), pin jatuh, rute tergambar, alamat | pin spring drop, rute draw-on | PUSH | WGU | confirm-glass |
| 4 | 12–17 | 3 promo pembukaan sebagai kartu bergantian, angka diskon dominan | `staggeredSpringAt` kartu | GLIDE | MC | data-reveal |
| 5 | 17–20 | `<BrandLogo />` + jam buka + kontak | logo reveal, hold 24f | HOLD | END | confirm-glass |

### T004 · Product Reveal Peluncuran
durasi 20s · 16:9 · gaya "sinematik minimal, gelap elegan" · bgm B25 · komponen: `<CubeRoll3D />`, `<BentoGridReveal />`, `<BrandLogo />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Layar gelap, siluet produk muncul dari gradient cahaya (kode) | fade-in lambat + opacity ramp | HOLD | PZI | impact-soft |
| 2 | 4–9 | Produk berputar 3D ringan, nama model di bawahnya | `rotateY` 1 putaran, `easeInOutSmooth` | PUSH | MC | pop-in |
| 3 | 9–14 | Garis tipis menunjuk 3 komponen kunci dengan label | line draw-on, label fade stagger | GLIDE | WGL | data-reveal |
| 4 | 14–18 | Spesifikasi kunci sebagai angka besar (berat, baterai, ukuran) | counter naik, stagger | HOLD | WGU | data-reveal |
| 5 | 18–20 | Nama produk + tanggal rilis + `<BrandLogo />` | hold + `microBob` | PULL | END | confirm-glass |

### T005 · Testimoni Pelanggan (Gaya Chat)
durasi 18s · 9:16 · gaya "UI nyata, hangat, sehari-hari" · bgm B31 · komponen: `<ChatAppShell />`, `<TypeText enableTypingSfx typingVariant="soft" />`, `<BrandLogo />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | `<ChatAppShell />` dengan nama kontak pelanggan, pesan pertama masuk | bubble spring-in dengan ekor | HOLD | MC | pop-plop |
| 2 | 3–8 | Pelanggan mengetik testimoni lewat `<TypeText />` | kecepatan ketik bervariasi | TYPE | MC | TYPE (soft) |
| 3 | 8–12 | Balasan penjual dan foto produk terlampir | bubble stagger | HOLD | WGU | pop-in |
| 4 | 12–16 | Skor kepuasan sebagai angka tipografi besar (misal 4,9/5) | counter naik | PUSH | PZI | data-reveal |
| 5 | 16–18 | `<BrandLogo />` + ajakan memesan | logo reveal | HOLD | END | confirm-glass |

### T006 · Before–After Produk
durasi 15s · 1:1 · gaya "bersih, perbandingan tegas" · bgm B25 · komponen: `<CardFlip3D />`, `<PageCurlCard />`, `<BrandLogo />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–2 | Kondisi "sebelum" memenuhi frame, tipografi "Sebelum" di sudut | fade-in, tanpa gerak berlebihan | HOLD | MC | — |
| 2 | 2–5 | Detail masalah diperbesar, garis penunjuk ke bagian bermasalah | zoom halus + line draw-on | PUSH | MORPH | pop-in |
| 3 | 5–9 | Garis pemisah vertikal bergeser, kondisi "sesudah" terbuka | slider wipe `easeInOutSmooth` | HOLD | PZI | impact-soft |
| 4 | 9–13 | Angka perbaikan (misal 3x lebih cepat) sebagai tipografi besar | counter naik | HOLD | WGL | data-reveal |
| 5 | 13–15 | `<BrandLogo />` + nama produk | hold | HOLD | END | confirm-glass |

### T007 · Katalog Menu Kafe/Restoran
durasi 20s · 9:16 · gaya "hangat, tipografi menu, kontras lembut" · bgm B31 · komponen: `<Coverflow3D />`, `<MasonryZoomDetail />`, `<BrandLogo />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Nama kafe tipografi besar di atas permukaan warna hangat | mask reveal | HOLD | WGU | pop-in |
| 2 | 3–8 | Menu kategori 1 (minuman): foto user, nama, harga rata kanan | daftar masuk `staggeredSpringAt` | GLIDE | WGU | — |
| 3 | 8–13 | Menu kategori 2 (makanan), tata letak sama untuk konsistensi | stagger sama, ritme sama | GLIDE | MC | — |
| 4 | 13–17 | Menu andalan: satu item besar, harga tebal | scale-up + `microBob` | PUSH | PZI | impact-soft |
| 5 | 17–20 | Alamat, jam buka, `<BrandLogo />` | hold 24f | HOLD | END | confirm-glass |

### T008 · Promo Ramadan / Lebaran
durasi 20s · 16:9 · gaya "hangat, elegan, ornamen geometris tipis" · bgm B31 · komponen: `<FanSpreadCards />`, `<BentoGridReveal />`, `<BrandLogo />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Pola geometris Islami tipis digambar kode, judul promo muncul | pola line draw-on, judul fade | HOLD | PZI | pop-in |
| 2 | 4–9 | Paket hemat 1 sebagai tipografi + harga, tata letak dua kolom | slide masuk kiri-kanan | HOLD | MC | data-reveal |
| 3 | 9–14 | Paket hemat 2 dan 3, tata letak sama | `staggeredSpringAt` | GLIDE | WGL | data-reveal |
| 4 | 14–18 | Periode promo dan syarat singkat | fade + translateY kecil | HOLD | WGU | — |
| 5 | 18–20 | `<BrandLogo />` + ucapan singkat | hold + `microBob` | PULL | END | confirm-glass |

### T009 · Paket Harga (Pricing Tiers)
durasi 18s · 16:9 · gaya "SaaS bersih, grid rapi" · bgm B26 · komponen: `<LayoutMorphGridToCarousel />`, `<AnimatedCursor enableClickSfx />`, `<BrandLogo />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Judul "Pilih paket" dan toggle bulanan/tahunan | toggle digeser `<AnimatedCursor />` | CURSOR | MC | CLICK |
| 2 | 3–7 | Tier 1: nama, harga, 3 fitur, tombol | kartu spring-in | HOLD | MC | pop-in |
| 3 | 7–11 | Tier 2 (disorot lewat skala dan kontras, bukan pill): harga, fitur | kartu spring-in, scale 1.04 | PUSH | WGL | pop-plop |
| 4 | 11–15 | Tier 3 dan perbandingan fitur antar tier | baris fitur stagger | GLIDE | WGU | data-reveal |
| 5 | 15–18 | Kursor klik tombol pada tier terpilih lalu `<BrandLogo />` | hover 5f lalu klik | CURSOR | END | CLICK |

### T010 · Cara Pemesanan 4 Langkah (UMKM)
durasi 20s · 9:16 · gaya "jelas, ramah, tipografi besar" · bgm B31 · komponen: `<ChatAppShell />`, `<AccordionFoldCard />`, `<AnimatedProgressBar enableProgressSfx />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Judul "Pesan dalam 4 langkah", angka 1–4 berbaris vertikal | angka stagger masuk | HOLD | MC | pop-in |
| 2 | 3–7 | Langkah 1: layar aplikasi chat dengan pesan "pilih produk" | `<ChatAppShell />` bubble masuk | HOLD | MC | pop-plop |
| 3 | 7–11 | Langkah 2–3: isi alamat dan pilih pembayaran, form UI kode-drawn | `<TypeText />` isi kolom | TYPE | WGU | TYPE (soft) |
| 4 | 11–16 | Langkah 4: konfirmasi pesanan, progress pengiriman | `<AnimatedProgressBar enableProgressSfx />` 0→100% | HOLD | PZI | PROG |
| 5 | 16–20 | `<BrandLogo />` + nomor kontak | logo reveal, hold | HOLD | END | confirm-glass |
