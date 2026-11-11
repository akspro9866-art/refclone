---
name: motion-craft
description: Create, edit, or reconstruct motion graphics, animated explainers, product demos, and video references in Remotion. Use when the user asks for motion-craft, a Remotion storyboard or render, authentic animated UI, or motion graphics with a specific art direction.
---

# Motion Craft

Bangun video deterministik di Remotion. Ubah ide menjadi keputusan visual dan shot yang bisa diuji sebelum render penuh. Di contoh perintah, `<skill>` adalah direktori ini.

## 1. Tetapkan brief

Baca [BRIEF-INTAKE.md](references/BRIEF-INTAKE.md) sebelum produksi. Wajib tanyakan keputusan brief yang belum jelas dan tunggu jawaban sebelum storyboard, scaffold, coding, atau render. Tanyakan topik dahulu jika belum ada. Untuk setiap pertanyaan, berikan **Saran agen (Rekomendasi)** yang konkret dan jalur **Tulis sendiri**. Gunakan menu host jika tersedia, atau chat dua opsi. Jangan menganggap full permission, timeout, atau input kosong sebagai jawaban.

Ambil keputusan yang sudah jelas dari prompt dan percakapan agar tidak bertanya ulang. Catat delegasi eksplisit seperti “sisanya bebas”, isi pilihan yang didelegasikan, dan ringkas hasilnya. Brief lengkap dapat langsung lanjut. Simpan semua keputusan beserta bukti ke `resolved-brief.json` sesuai kontrak intake. Jangan mengganti mode aplikasi atau mengklaim sudah masuk Plan Mode.

Prioritaskan permintaan eksplisit, pedoman brand, dan referensi user. Untuk **replikasi**, ikuti layout, timing, framing, kamera, status UI, dan transisi yang terlihat pada referensi. Baca [REPLICATION-AND-QA.md](references/REPLICATION-AND-QA.md) untuk pengukuran dan laporan selisih. Untuk **adaptasi**, catat unsur yang dipertahankan dan yang diganti.

## 2. Pilih panduan gaya dan storyboard

Pilih **pasangan** gaya dan storyboard berdasarkan bentuk konten dan tindakan yang perlu terlihat. Storyboard memberi urutan dan pacing. Panduan gaya menentukan komposisi, material, tipografi, kamera, dan gerak yang mendukung adegan itu. Satu gaya dapat dipakai pada beberapa storyboard.

```bash
node "<skill>/scripts/plan-motion.mjs" --brief-file resolved-brief.json --out research
```

Gunakan `--style <1–44>` dan/atau `--template <T001–T103>` jika user menetapkan pilihan atau agen perlu mengoreksi kecocokan. Planner memakai petunjuk kata utuh dan rekomendasi kompatibilitas. Untuk brief “cara install Linux”, titik awalnya installer grafis (#12 + T023). Jika brief menyebut memasang paket lewat CLI, gunakan #26 + T036. Untuk gaya Apple interaktif #44, pakai template kode T101 untuk tutorial, T102 untuk intro brand, atau T103 untuk edukasi. Ikuti [panduan #44](references/styles/44-apple-inspired-product-cinema.md) untuk mengisi slot dan menyesuaikan koreografi ke referensi. Periksa hasil terhadap maksud user.

Baca satu `research/selected-style-guide.md` dan satu `research/storyboard.md`. Buka indeks [STYLES.md](references/STYLES.md) dan [storyboards/INDEX.md](references/storyboards/INDEX.md) saat butuh alternatif. Sesuaikan visual, aset, kamera, suara, dan durasi per adegan di `motion-plan.md` dan `scenes-plan.json`. Hapus cue atau komponen yang tidak berperan. Bila user memilih gaya yang berbeda dari rekomendasi, terapkan gaya pada panggung dan edit, sambil mempertahankan tindakan serta UI sumber.

Tulis hero spesifik, tindakan, bukti, dan titik hold sebelum coding. Gunakan [STORYBOARD.template.md](templates/STORYBOARD.template.md) untuk struktur kustom. Jika mengubah batas frame, gunakan akhir eksklusif dan pastikan durasi dikurangi overlap sama dengan komposisi.

## 3. Arahkan tampilan sebelum animasi

- Buat frame establishing dan frame hasil pada rasio akhir. Periksa siluet, hierarki baca, area aman platform, dan warna teks pada bidang yang benar-benar dirender. Gunakan ruang kosong dan kesejajaran untuk memisahkan informasi.
- Pertahankan anatomi UI sumber. Ambil screenshot atau potongan layar dari aset user bila tersedia. Saat menggambar ulang, pertahankan chrome platform, posisi kontrol, label, status, dan isi yang relevan. Terapkan gaya video pada panggung, anotasi, atau transisi jika gaya tersebut mengganggu keterbacaan UI asli. Pakai shell di `LivedInUIShells.tsx` hanya jika anatominya cocok.
- Tampilkan wujud benda fisik dengan foto/vektor asli atau siluet dan bagian yang khas. Gerakkan sesuai poros, berat, atau mekanisme yang diterangkan. Grafik dan angka mengikuti data. Tandai data atau layar contoh sebagai ilustrasi jika bisa disangka fakta.
- Gunakan logo yang cocok dengan aset resmi ketika logo memang bagian dari subjek. Prioritaskan file lokal atau artwork yang diverifikasi. `fetch-brand-logo.mjs --brands "<slug>" --project-dir . --out public/brands` membantu mencari aset. Gunakan `<BrandLogo customPublicSvgPath="brands/<slug>.svg" brand="<slug>" />` untuk menentukan file yang benar.
- Pilih bentuk dan tekstur berdasarkan bahan atau fungsi. Hindari badge, kartu, indikator bulat, dan ikon yang hanya mengisi ruang. Status, ikon, atau pill fungsional dari UI asli tetap boleh. `ProceduralBackground` statis secara default. Pilih `pattern="none"` untuk panggung bersih atau batasi tekstur ke objek yang membutuhkan.
- Gunakan kartu/grid/3D ketika isi memang butuh tata letak itu. Masukkan palet, tipografi, dan visual nyata lewat `Card3DItem.stylePreset` / `content`. Baca [CARD-GRID-3D-PATTERNS.md](references/CARD-GRID-3D-PATTERNS.md) untuk 19 pola yang tersedia.

## 4. Implementasikan gerak, suara, dan caption

- Pilih komponen per aksi dari [SCENE-COMPONENTS.md](references/SCENE-COMPONENTS.md). Pakai warna, ukuran, dan data dari brief atau referensi.
- Gerakkan objek yang menyebabkan perubahan. Mulai kamera dari hold. Gunakan `splineAt` atau waypoint `CameraRig` untuk memindahkan fokus dengan tujuan jelas. Pilih hard cut, match cut, atau overlap sesuai hubungan antarscene. Blur, portal glow, dan efek kursor hanya saat mendukung aksi.
- Gunakan `TypeText presentation="native"` di input asli. Ikat klik, ketikan, progress, dan SFX transisi ke frame kejadian. Baca `research/selected-sfx-guide.md` untuk tiga cue opsional dari gaya yang dipilih. Gunakan `SfxCue` pada frame aksi dan sisakan jeda. Baca [SOUND.md](references/SOUND.md) untuk musik prosedural, rekaman, dan cue yang tersedia.
- Tambahkan caption bila brief/narasi memerlukannya. Tempatkan `BottomSubtitleBar` di screen-space, di luar kamera. Ukur jarak terhadap UI, lower third, atau chrome platform pada frame akhir. Caption tampil dengan posisi dan bobot stabil. Baca [CAMERA-SCENES-NARRATOR.md](references/CAMERA-SCENES-NARRATOR.md) untuk penerapan.
- `narrator-sync.mjs --tts` memakai Python `edge-tts` dengan `WordBoundary` dan akses layanan. Gunakan `--timings alignment.json` untuk audio yang sudah ada dengan format `[{"text":"Halo","startMs":120,"endMs":480}]`. Tambahkan `--duration` agar kelebihan durasi ditolak. Tanpa TTS/alignment, `words.json.meta.json` menandai timing sebagai perkiraan. Sambungkan TTS ke `AudioStage narrationSrc="audio/narration.mp3"` jika berhasil.

## 5. Render dan cek hasil

1. Jalankan `node "<skill>/scripts/lint.mjs" src`.
2. Render still pada frame pembuka, sebelum dan sesudah tindakan penting, di batas transisi, dan pada hold hasil. Gunakan `inspect-motion.mjs --src src --comp MainVideo --frames <nomor-dipisah-koma>`. Periksa hierarki, identitas gaya, potongan UI, keterbacaan, dan batas objek. Ukur rectangle screen-space pada frame penting bila perlu cek geometri.
3. Render `npx remotion render MainVideo out/v1.mp4`. Putar hasil, periksa kontinuitas dan sinkronisasi audio. Gunakan `inspect-motion.mjs --video out/v1.mp4 --geometry research/geometry.json --comp MainVideo --frames <daftar> --require-complete` untuk gate otomatis yang lengkap. `PARTIAL` menandai pemeriksaan yang masih terbuka.
4. Untuk evaluasi metadata, jalankan `evaluate-video.mjs --video out/v1.mp4 --width <w> --height <h> --fps <fps> --frames <total>`. Tambahkan `--reference <file> --min-ssim <ambang>` hanya untuk referensi yang sudah disejajarkan. Sertakan bukti visual dan selisih nyata bila klaim replikasi dibutuhkan.
5. Serahkan hasil sesuai brief dengan catatan asumsi atau keterbatasan yang memengaruhi pemakaian. `run-evals.mjs` menguji skrip dan kontrak template. Jalankan prompt evaluasi secara terpisah untuk menilai video nyata.
