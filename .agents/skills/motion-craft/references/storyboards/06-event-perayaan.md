# Storyboard 06 — Event & Perayaan (T051–T060)

Arahkan layout dari identitas acara, foto, tanggal, dan tempat yang benar. Beri detail acara satu frame hold. Gunakan satu motif dari materi acara atau gaya terpilih untuk menjaga kontinuitas.

Kode kamera, transisi, dan SFX ada di [INDEX.md](INDEX.md). Durasi, rasio, dan cue pada tabel adalah acuan yang bisa diadaptasi untuk brief dan panduan gaya yang terpilih.

---

### T051 · Undangan Pernikahan
durasi 25s · 9:16 · gaya "elegan, serif tipis, ruang kosong luas" · bgm B31 · komponen: `<PageTurnBook />`, `<PolaroidDropTable />`, `<FanSpreadCards />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Nama pasangan (inisial) dalam tipografi serif besar, garis tipis di bawah | line draw-on + mask | HOLD | PZI | pop-in |
| 2 | 4–10 | Kalimat undangan singkat, foto pasangan (aset user) | foto reveal wipe halus | PUSH | MC | — |
| 3 | 10–16 | Akad: tanggal besar, jam, lokasi | counter tanggal + mask | HOLD | WGU | data-reveal |
| 4 | 16–21 | Resepsi: tanggal, jam, lokasi, peta kecil dengan pin | pin drop, rute draw-on | HOLD | WGU | confirm-glass |
| 5 | 21–25 | Ucapan terima kasih dan nama keluarga | hold + `microBob` | PULL | END | — |

### T052 · Ulang Tahun
durasi 15s · 9:16 · gaya "hangat, tipografi besar, palet cerah terbatas" · bgm B29 · komponen: `<PolaroidDropTable />`, `<FanSpreadCards />`, `<CardFlip3D />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Angka usia raksasa di tengah | counter 0→usia | HOLD | PZI | impact-soft |
| 2 | 3–7 | "Selamat ulang tahun" dan nama, tipografi besar | letter stagger | PUSH | MC | pop-in |
| 3 | 7–12 | Tiga foto kenangan bergantian (aset user) | match-cut foto | GLIDE | WGU | pop-plop |
| 4 | 12–15 | Doa singkat dan nama pengirim | mask reveal | HOLD | END | confirm-glass |

### T053 · Save the Date
durasi 12s · 1:1 · gaya "minimal, tipografi sebagai hero" · bgm B25 · komponen: `<PageCurlCard />`, `<PolaroidDropTable />`, `<BottomSubtitleBar />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Kata "Save the Date" tipografi tipis besar | mask reveal | HOLD | MC | pop-in |
| 2 | 3–7 | Tanggal sebagai angka besar dan nama acara | counter tanggal | PUSH | PZI | data-reveal |
| 3 | 7–10 | Lokasi dan kota | fade + translateY | HOLD | WGU | — |
| 4 | 10–12 | Catatan "undangan menyusul" | hold | HOLD | END | confirm-glass |

### T054 · Aftermovie Konser / Event (Tipografis)
durasi 25s · 16:9 · gaya "energik, foto dominan, tipografi kontras" · bgm B32 · komponen: `<ZDepthTunnel />`, `<ExplodeToGrid />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Nama acara raksasa di atas foto panggung (aset user) | foto scale + judul mask | PUSH | WGL | impact-soft |
| 2 | 3–10 | Rangkaian 4 foto, tiap foto dengan satu kata (misal "Musik") | match-cut ritme beat | GLIDE | MC | pop-in |
| 3 | 10–16 | Angka acara: penonton, penampil, jam | counter stagger | HOLD | WGU | data-reveal |
| 4 | 16–22 | Momen puncak: satu foto penuh layar dengan kutipan penonton | zoom pelan, mask kutipan | PUSH | PZI | impact-soft |
| 5 | 22–25 | Tanggal event berikutnya dan `<BrandLogo />` | hold | PULL | END | confirm-glass |

### T055 · Trailer Pembukaan Acara
durasi 20s · 16:9 · gaya "sinematik, kontras tinggi, tipografi lebar" · bgm B32 · komponen: `<ZDepthTunnel />`, `<CubeRoll3D />`, `<Coverflow3D />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Layar gelap, kalimat teaser muncul kata per kata | mask reveal pelan | HOLD | PZI | impact-soft |
| 2 | 4–9 | Tiga pembicara/penampil: nama besar, satu per layar | match-cut | HOLD | MC | pop-in |
| 3 | 9–14 | Tanggal, jam, lokasi sebagai tipografi besar | counter + mask | PUSH | WGL | data-reveal |
| 4 | 14–18 | Kalimat klimaks | scale-up dramatis | PUSH | WGU | impact-soft |
| 5 | 18–20 | `<BrandLogo />` acara dan tautan tiket | hold | HOLD | END | confirm-glass |

### T056 · Ucapan Wisuda
durasi 20s · 9:16 · gaya "bangga, hangat, serif + sans" · bgm B31 · komponen: `<PolaroidDropTable />`, `<PageTurnBook />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | "Selamat Wisuda" dan nama lulusan | mask reveal | HOLD | PZI | pop-in |
| 2 | 4–9 | Foto toga (aset user), gelar dan program studi | foto reveal wipe | PUSH | MC | — |
| 3 | 9–14 | Tiga pencapaian kuliah dalam daftar singkat | baris stagger | HOLD | WGU | data-reveal |
| 4 | 14–18 | Ucapan terima kasih kepada keluarga dan dosen | mask reveal | HOLD | WGU | — |
| 5 | 18–20 | `<BrandLogo />` kampus dan tahun lulus | hold | HOLD | END | confirm-glass |

### T057 · Ucapan Idulfitri
durasi 20s · 9:16 · gaya "teduh, ornamen geometris tipis, palet hangat" · bgm B31 · komponen: `<PageTurnBook />`, `<FanSpreadCards />`, `<BottomSubtitleBar />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Pola geometris Islami tipis tergambar, "Selamat Hari Raya Idulfitri" | pola line draw-on, teks mask | HOLD | PZI | pop-in |
| 2 | 4–10 | Ucapan maaf lahir dan batin, kalimat besar | mask reveal per baris | HOLD | MC | — |
| 3 | 10–15 | Foto keluarga atau tim (aset user) | wipe halus | PUSH | WGU | — |
| 4 | 15–20 | Nama pengirim atau `<BrandLogo />` | hold + `microBob` | PULL | END | confirm-glass |

### T058 · Ucapan Tahun Baru
durasi 15s · 9:16 · gaya "kontras gelap, tipografi besar, angka tahun hero" · bgm B32 · komponen: `<ZDepthTunnel />`, `<ExplodeToGrid />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Angka tahun lama berganti tahun baru | counter flip | HOLD | MORPH | impact-soft |
| 2 | 3–7 | Tahun baru raksasa di tengah | scale spring | PUSH | WGU | pop-in |
| 3 | 7–12 | Tiga harapan singkat bergantian | kata stagger | HOLD | PZI | data-reveal |
| 4 | 12–15 | Nama pengirim | hold | HOLD | END | confirm-glass |

### T059 · HUT RI 17 Agustus
durasi 20s · 16:9 · gaya "merah-putih tegas, tipografi besar, bersih" · bgm B27 · komponen: `<HelixCards3D />`, `<PolaroidDropTable />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Angka usia kemerdekaan raksasa di atas background merah-putih (shape kode) | counter naik | HOLD | PZI | impact-soft |
| 2 | 4–9 | Tema HUT RI tahun ini sebagai tipografi besar | mask reveal | HOLD | MC | — |
| 3 | 9–15 | Rangkaian kegiatan lomba atau upacara, tiga item dengan jam | baris stagger | HOLD | WGL | data-reveal |
| 4 | 15–18 | Ajakan ikut serta dan lokasi | fade | HOLD | WGU | — |
| 5 | 18–20 | `<BrandLogo />` penyelenggara (RT/RW, sekolah, instansi) | hold | HOLD | END | confirm-glass |

### T060 · Undangan Reuni
durasi 15s · 9:16 · gaya "nostalgia hangat, foto lama, tipografi besar" · bgm B31 · komponen: `<PolaroidDropTable />`, `<FanSpreadCards />`, `<ChatAppShell />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Judul "Reuni Angkatan ..." dengan tahun lulus | mask reveal | HOLD | PZI | pop-in |
| 2 | 3–7 | Foto angkatan lama (aset user) berubah dari sepia ke warna | color transition `easeInOutSmooth` | PUSH | MC | — |
| 3 | 7–11 | Tanggal, jam, lokasi | counter tanggal + mask | HOLD | WGU | data-reveal |
| 4 | 11–13 | Cara konfirmasi dan batas waktu | fade | HOLD | WGU | — |
| 5 | 13–15 | Kontak panitia | hold | HOLD | END | confirm-glass |
