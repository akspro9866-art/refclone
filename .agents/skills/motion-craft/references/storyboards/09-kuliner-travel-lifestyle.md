# Storyboard 09 — Kuliner, Travel & Lifestyle (T081–T090)

Jadikan makanan, tempat, atau benda sebagai hero. Prioritaskan foto/video user atau ilustrasi yang menjaga siluet. Pakai satu sudut cahaya dan satu detail material untuk menyatukan shot.

Kode kamera, transisi, dan SFX ada di [INDEX.md](INDEX.md). Durasi, rasio, dan cue pada tabel adalah acuan yang bisa diadaptasi untuk brief dan panduan gaya yang terpilih.

---

### T081 · Resep Cepat
durasi 20s · 9:16 · gaya "hangat, foto makanan dominan, tipografi besar" · bgm B31 · komponen: `<AccordionFoldCard />`, `<CardStackSwipe />`, `<PolaroidDropTable />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Foto hasil masakan penuh layar, nama resep tipografi besar | foto scale 1.08→1.0, judul mask | PUSH | MC | pop-in |
| 2 | 3–8 | Bahan: daftar dengan takaran, satu kolom rapi | baris stagger | HOLD | WGU | pop-plop |
| 3 | 8–14 | Langkah 1 dan 2: dua foto proses dengan keterangan satu baris | match-cut + mask | HOLD | WGU | — |
| 4 | 14–18 | Langkah 3 dan waktu masak sebagai angka besar | counter menit | HOLD | PZI | data-reveal |
| 5 | 18–20 | Hasil akhir, porsi, nama akun | hold | PULL | END | confirm-glass |

### T082 · Promo Restoran / Menu Spesial
durasi 15s · 9:16 · gaya "detail makanan/minuman, copy pendek, bukti dari sumber" · bgm B29 opsional · komponen: foto atau ilustrasi hidangan dan tipografi

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Hidangan utama, nama, dan framing yang memperlihatkan bentuknya | Reveal berdasarkan material dan gaya | HOLD | MC | — |
| 2 | 3–7 | Close-up tekstur, bahan, kemasan, atau proses yang disebut brief | Potong ke detail dan tahan aksinya | HOLD | MC | — |
| 3 | 7–11 | Kembali ke menu atau satu hidangan dengan detail tawaran yang diberikan | Munculkan copy dengan tipografi yang selaras | HOLD | MC | — |
| 4 | 11–13 | Informasi pemesanan bila diberikan, atau hero kedua yang relevan | Tahan kontras dan hierarki | HOLD | MC | — |
| 5 | 13–15 | Ajakan dari brief dan nama menu/restoran yang benar | Tahan frame tanpa menambah data rekaan | HOLD | END | — |

### T083 · Destinasi Wisata
durasi 25s · 16:9 · gaya "sinematik terang, tipografi lebar, foto/video dominan" · bgm B31 · komponen: `<PolaroidDropTable />`, `<MasonryZoomDetail />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Pemandangan pembuka penuh layar, nama destinasi tipografi besar | video/foto scale pelan, judul mask | PUSH | PZI | — |
| 2 | 4–10 | Peta kecil dengan pin lokasi dan rute dari kota terdekat | rute draw-on, pin drop | HOLD | WGU | confirm-glass |
| 3 | 10–16 | Tiga spot utama: foto bergantian dengan nama | match-cut + mask | GLIDE | MC | pop-in |
| 4 | 16–21 | Info praktis: tiket, jam buka, musim terbaik sebagai tiga angka | counter + mask | HOLD | WGL | data-reveal |
| 5 | 21–25 | Nama destinasi, kota, tautan | hold | PULL | END | confirm-glass |

### T084 · Hotel / Villa Promo
durasi 20s · 16:9 · gaya "mewah tenang, ruang kosong luas, serif tipis" · bgm B25 · komponen: `<Coverflow3D />`, `<MasonryZoomDetail />`, `<BentoGridReveal />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Foto eksterior, nama properti tipografi serif | fade + zoom pelan | PUSH | PZI | — |
| 2 | 4–10 | Tiga foto kamar dan fasilitas dengan keterangan satu baris | match-cut halus | GLIDE | MC | — |
| 3 | 10–15 | Lokasi: peta kecil dengan jarak ke titik penting | pin drop + label | HOLD | WGU | confirm-glass |
| 4 | 15–18 | Harga mulai dari dan periode promo | counter + mask | HOLD | WGL | data-reveal |
| 5 | 18–20 | `<BrandLogo />` dan kontak reservasi | hold | HOLD | END | confirm-glass |

### T085 · Rutinitas Latihan Fitness
durasi 20s · 9:16 · gaya "energik, kontras tinggi, tipografi besar" · bgm B28 · komponen: `<FerrisWheelCards />`, `<CardStackSwipe />`, `<AnimatedProgressBar enableProgressSfx />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Nama program dan durasi (misal 15 menit) | counter menit + mask | HOLD | MC | impact-soft |
| 2 | 3–9 | Gerakan 1: footage/foto (aset user) dengan nama gerakan dan jumlah repetisi | counter repetisi | HOLD | MC | pop-in |
| 3 | 9–14 | Gerakan 2 dengan tata letak sama | stagger sama | HOLD | WGU | pop-in |
| 4 | 14–18 | Gerakan 3 dan timer set | counter timer | HOLD | PZI | data-reveal |
| 5 | 18–20 | Ajakan ikuti program dan nama akun | hold | HOLD | END | confirm-glass |

### T086 · Rutinitas Skincare
durasi 20s · 9:16 · gaya "lembut, bersih, palet netral, serif tipis" · bgm B25 · komponen: `<FerrisWheelCards />`, `<AccordionFoldCard />`, `<CardFlip3D />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Judul "Rutinitas pagi" dan durasi | mask reveal | HOLD | PZI | pop-in |
| 2 | 3–8 | Langkah 1 (pembersih): foto produk, nama produk, satu baris manfaat | slide + mask | HOLD | WGU | pop-plop |
| 3 | 8–13 | Langkah 2 (pelembap) dengan tata letak sama | stagger sama | HOLD | WGU | pop-plop |
| 4 | 13–17 | Langkah 3 (tabir surya) dengan tata letak sama | stagger sama | HOLD | MC | pop-plop |
| 5 | 17–20 | Urutan lengkap dalam satu daftar dan nama akun | baris stagger | PULL | END | confirm-glass |

### T087 · Fashion Lookbook
durasi 20s · 9:16 · gaya "editorial, tipografi besar, foto penuh layar" · bgm B29 · komponen: `<Coverflow3D />`, `<FanSpreadCards />`, `<PolaroidDropTable />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Nama koleksi tipografi raksasa | letter stagger | HOLD | MC | pop-in |
| 2 | 3–8 | Look 1 foto penuh layar, nama item dan harga kecil | scale 1.06→1.0 + mask | PUSH | MC | — |
| 3 | 8–13 | Look 2 dengan tata letak sama | match-cut | PUSH | MC | — |
| 4 | 13–17 | Look 3 dengan tata letak sama | match-cut | PUSH | WGU | — |
| 5 | 17–20 | `<BrandLogo />` merek dan tautan koleksi | hold | HOLD | END | confirm-glass |

### T088 · Tur Properti
durasi 25s · 16:9 · gaya "arsitektural bersih, denah sebagai hero" · bgm B25 · komponen: `<MasonryZoomDetail />`, `<BentoGridReveal />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Foto eksterior, alamat dan tipe properti | fade + zoom pelan | PUSH | PZI | — |
| 2 | 4–10 | Denah lantai digambar kode, ruang muncul satu per satu dengan label ukuran | shape draw-on + label stagger | HOLD | WGL | data-reveal |
| 3 | 10–16 | Tiga foto ruang utama (aset user) | match-cut | GLIDE | MC | — |
| 4 | 16–21 | Spesifikasi: luas, kamar tidur, kamar mandi sebagai angka besar | counter stagger | HOLD | WGU | data-reveal |
| 5 | 21–25 | Harga, kontak agen, `<BrandLogo />` | hold | HOLD | END | confirm-glass |

### T089 · Showcase Otomotif
durasi 20s · 16:9 · gaya "sinematik gelap, tipografi lebar, aksen metalik" · bgm B28 · komponen: `<CylinderCards3D />`, `<BentoGridReveal />`, `<ZDepthTunnel />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Layar gelap, siluet kendaraan muncul dari cahaya gradient | fade-in + opacity ramp | HOLD | PZI | impact-soft |
| 2 | 4–10 | Foto kendaraan, nama model dan varian | scale + mask | PUSH | MC | pop-in |
| 3 | 10–15 | Tiga spesifikasi kunci sebagai angka besar (tenaga, torsi, konsumsi) | counter stagger | HOLD | WGL | data-reveal |
| 4 | 15–18 | Detail interior atau fitur utama dengan garis penunjuk | line draw-on | GLIDE | WGU | pop-plop |
| 5 | 18–20 | `<BrandLogo />` merek, harga, kontak dealer | hold | HOLD | END | confirm-glass |

### T090 · Adopsi Hewan Peliharaan
durasi 15s · 9:16 · gaya "hangat, ramah, tipografi bulat tapi bersih" · bgm B31 · komponen: `<PolaroidDropTable />`, `<CardStackSwipe />`, `<ChatAppShell />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Foto hewan penuh layar, nama dan umur | foto scale + mask | PUSH | MC | pop-in |
| 2 | 3–7 | Tiga sifat dan kondisi (vaksin, steril) dalam daftar singkat | baris stagger | HOLD | WGU | data-reveal |
| 3 | 7–11 | Foto kedua dan ketiga bergantian | match-cut | HOLD | PZI | — |
| 4 | 11–13 | Syarat adopsi satu kalimat | mask reveal | HOLD | WGL | — |
| 5 | 13–15 | Kontak dan lokasi shelter, `<BrandLogo />` | hold | HOLD | END | confirm-glass |
