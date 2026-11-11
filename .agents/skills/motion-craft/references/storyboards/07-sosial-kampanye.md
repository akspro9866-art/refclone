# Storyboard 07 — Sosial & Kampanye (T061–T070)

Hubungkan satu bukti dengan satu tindakan yang bisa dilakukan. Bedakan ilustrasi dari bukti faktual. Rancang CTA yang terbaca dalam hold dan cantumkan sumber angka pada adegan terkait.

Kode kamera, transisi, dan SFX ada di [INDEX.md](INDEX.md). Durasi, rasio, dan cue pada tabel adalah acuan yang bisa diadaptasi untuk brief dan panduan gaya yang terpilih.

---

### T061 · Kampanye Lingkungan
durasi 25s · 16:9 · gaya "dokumenter, palet alam, tipografi tegas" · bgm B27 · komponen: `<SphereCards3D />`, `<BentoGridReveal />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Pernyataan masalah (misal sampah plastik) sebagai satu kalimat besar | mask reveal pelan | HOLD | PZI | — |
| 2 | 4–10 | Satu angka dampak dari sumber resmi, tampil besar dengan label sumber kecil | counter naik | HOLD | MC | data-reveal |
| 3 | 10–16 | Diagram sederhana akibat berantai (dari sumber ke dampak), panah tergambar | shape pop + line draw-on | GLIDE | WGL | pop-plop |
| 4 | 16–22 | Tiga tindakan kecil yang bisa dilakukan, satu per baris | baris stagger | HOLD | WGU | confirm-glass |
| 5 | 22–25 | Ajakan, tagar kampanye, `<BrandLogo />` penyelenggara | hold | PULL | END | confirm-glass |

### T062 · Galang Dana / Donasi
durasi 25s · 9:16 · gaya "tulus, hangat, tipografi besar, tanpa dramatisasi berlebihan" · bgm B27 · komponen: `<PolaroidDropTable />`, `<AnimatedProgressBar enableProgressSfx />`, `<AnimatedCursor enableClickSfx />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Nama penerima manfaat atau program, satu kalimat kebutuhan | mask reveal | HOLD | MC | — |
| 2 | 4–10 | Foto kondisi (aset user) dengan keterangan singkat | foto fade + zoom pelan | PUSH | WGU | — |
| 3 | 10–16 | Target dana dan terkumpul sebagai bar progres dengan angka besar | `<AnimatedProgressBar />` + counter | HOLD | PZI | PROG |
| 4 | 16–21 | Cara berdonasi: rekening atau tautan dalam layar yang jelas, nama pemilik rekening | mask reveal | HOLD | WGU | data-reveal |
| 5 | 21–25 | Ucapan terima kasih dan `<BrandLogo />` lembaga | hold | HOLD | END | confirm-glass |

### T063 · Edukasi Kesehatan Masyarakat
durasi 20s · 9:16 · gaya "bersih, medis ramah, palet biru-hijau" · bgm B25 · komponen: `<AccordionFoldCard />`, `<CardStackSwipe />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Pertanyaan umum ("Tahukah kamu ...?") tipografi besar | mask reveal | HOLD | MC | pop-in |
| 2 | 3–8 | Penjelasan inti satu kalimat dengan diagram sederhana | shape draw-on | PUSH | WGU | pop-plop |
| 3 | 8–14 | Tiga langkah pencegahan, satu per layar kecil | baris stagger | HOLD | WGL | data-reveal |
| 4 | 14–18 | Kapan harus ke fasilitas kesehatan, satu kalimat tegas | mask reveal | HOLD | PZI | — |
| 5 | 18–20 | Sumber informasi (instansi kesehatan) dan nama akun | hold | HOLD | END | confirm-glass |

### T064 · Anti-Bullying
durasi 20s · 9:16 · gaya "empatik, tenang, kontras lembut" · bgm B27 · komponen: `<ChatAppShell />`, `<CardFlip3D />`, `<BottomSubtitleBar />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | `<ChatAppShell />` dengan pesan ejekan masuk satu per satu | bubble masuk lambat | HOLD | MC | pop-plop |
| 2 | 4–9 | Pesan tertumpuk, layar meredup perlahan | opacity ramp + kamera tenang | PUSH | PZI | — |
| 3 | 9–14 | Kalimat "Kata-kata punya dampak" sebagai tipografi besar | mask reveal | HOLD | WGU | — |
| 4 | 14–18 | Tiga hal yang bisa dilakukan saksi: tegur, dukung, laporkan | baris stagger | HOLD | WGU | confirm-glass |
| 5 | 18–20 | Kontak layanan pengaduan sekolah dan `<BrandLogo />` | hold | HOLD | END | confirm-glass |

### T065 · Hemat Energi
durasi 20s · 16:9 · gaya "bersih, data-forward, aksen hijau tunggal" · bgm B26 · komponen: `<BentoGridReveal />`, `<CardFlip3D />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Judul kampanye dan satu kalimat tujuan | mask reveal | HOLD | MC | — |
| 2 | 3–9 | Grafik konsumsi listrik per jam, batang tumbuh | batang `staggeredSpringAt` | PUSH | WGL | data-reveal |
| 3 | 9–14 | Titik pemborosan disorot dan diberi label | highlight kontras + label | PUSH | WGU | pop-in |
| 4 | 14–18 | Tiga tindakan hemat dengan estimasi penghematan, dari sumber yang disebut | baris stagger + counter | HOLD | PZI | data-reveal |
| 5 | 18–20 | Ajakan dan `<BrandLogo />` | hold | HOLD | END | confirm-glass |

### T066 · Kampanye Literasi
durasi 20s · 16:9 · gaya "editorial, serif, hangat" · bgm B27 · komponen: `<PageTurnBook />`, `<PageCurlCard />`, `<FanSpreadCards />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Halaman buku terbuka digambar kode, satu kalimat kutipan diketik | `<TypeText />` | TYPE | MC | TYPE (soft) |
| 2 | 4–9 | Pertanyaan "Kapan terakhir kamu membaca buku?" | mask reveal | HOLD | WGU | — |
| 3 | 9–14 | Angka minat baca dari sumber resmi, tampil besar dengan label sumber | counter naik | HOLD | PZI | data-reveal |
| 4 | 14–18 | Tantangan baca 10 menit sehari dengan penghitung hari | counter hari | HOLD | WGL | pop-plop |
| 5 | 18–20 | Tagar kampanye dan `<BrandLogo />` | hold | PULL | END | confirm-glass |

### T067 · Keselamatan Berkendara
durasi 15s · 9:16 · gaya "tegas, kontras tinggi, aksen kuning-hitam terbatas" · bgm B28 · komponen: `<CardStackSwipe />`, `<AccordionFoldCard />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Tipografi besar "30 DETIK" dengan kalimat tanya | counter dan mask | HOLD | MC | impact-soft |
| 2 | 3–7 | Tiga aturan: helm, sabuk, tidak main ponsel, satu per baris | baris stagger | HOLD | WGU | pop-in |
| 3 | 7–11 | Diagram jarak aman antar kendaraan, garis tergambar | line draw-on | PUSH | WGL | data-reveal |
| 4 | 11–13 | Satu kalimat peringatan tegas | scale-up | HOLD | PZI | impact-soft |
| 5 | 13–15 | `<BrandLogo />` instansi dan nama kampanye | hold | HOLD | END | confirm-glass |

### T068 · Kampanye Pemilihan Ketua Organisasi (OSIS/BEM)
durasi 20s · 9:16 · gaya "tegas, muda, tipografi besar" · bgm B29 · komponen: `<Coverflow3D />`, `<BentoGridReveal />`, `<FanSpreadCards />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Nomor urut raksasa dan nama kandidat | counter + mask | HOLD | PZI | impact-soft |
| 2 | 3–8 | Foto kandidat (aset user), jabatan dan program studi | foto reveal wipe | PUSH | MC | pop-in |
| 3 | 8–14 | Tiga program kerja dalam tiga baris | baris stagger | HOLD | WGU | data-reveal |
| 4 | 14–17 | Tanggal dan tempat pemilihan | counter tanggal | HOLD | WGL | pop-plop |
| 5 | 17–20 | Ajakan menggunakan hak suara dan `<BrandLogo />` organisasi | hold | HOLD | END | confirm-glass |

### T069 · Hari Peringatan Nasional / Internasional
durasi 15s · 9:16 · gaya "editorial, tipografi besar, satu aksen warna" · bgm B27 · komponen: `<HelixCards3D />`, `<PolaroidDropTable />`, `<BottomSubtitleBar />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Tanggal peringatan sebagai angka raksasa | counter | HOLD | MC | impact-soft |
| 2 | 3–7 | Nama hari peringatan dan tema tahun ini | mask reveal | HOLD | PZI | pop-in |
| 3 | 7–12 | Satu fakta singkat dengan sumber, tipografi besar | mask + counter | PUSH | WGU | data-reveal |
| 4 | 12–15 | Ajakan dan nama akun | hold | HOLD | END | confirm-glass |

### T070 · Rekrutmen Relawan
durasi 15s · 9:16 · gaya "hangat, aksi nyata, tipografi besar" · bgm B29 · komponen: `<PolaroidDropTable />`, `<AccordionFoldCard />`, `<AnimatedCursor enableClickSfx />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Kalimat ajakan "Kami butuh kamu" | letter stagger | HOLD | MC | pop-in |
| 2 | 3–7 | Kegiatan relawan: foto (aset user) dengan lokasi | foto reveal | PUSH | WGU | — |
| 3 | 7–11 | Tiga syarat dan komitmen waktu | baris stagger | HOLD | WGL | data-reveal |
| 4 | 11–13 | Batas pendaftaran | counter tanggal | HOLD | PZI | pop-plop |
| 5 | 13–15 | Formulir atau kontak dan `<BrandLogo />` | hold | HOLD | END | confirm-glass |
