# Gaya #32 · Retro-Futurism

Bangun optimisme masa depan melalui ilustrasi peralatan, diagram orbit, dan poster dengan bidang warna datar. Tentukan benda yang ditawarkan masa depan itu.

## Komposisi

- **16:9** — Pusatkan objek seperti satelit atau kendaraan di sisi kanan. Jalur orbit melingkar melalui satu titik acuan. Di kiri, letakkan judul dan dua keterangan kecil seperti panel brosur.
- **9:16** — Susun orbit menjadi satu busur tinggi dan beri ruang di atas hero. Pakai potongan profil pada beat berikutnya supaya siluet tetap besar.

## Warna, huruf, dan bahan

Krem seperti kertas, teal gelap untuk struktur, oranye dan mustard untuk fokus. Righteous 66–96 px untuk judul, Michroma 25–32 px untuk keterangan pendek. Refleksi cukup satu bidang cahaya datar.

Token awal `getStyleById(32)`: kanvas `#F4E3C1`, bidang `#F8EDD5`, tinta `#1F4E5F`, muted `#697A7E`, aksen `#E85D2A`, aksen sekunder `#F2B134`. Font preset: Righteous / Michroma / DM Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Jika subjek fiksi, beri label konsep. Jika membahas benda nyata, pakai proporsi dan angka yang disediakan, dengan jalur diagram di luar UI asli atau foto.

## Koreografi contoh pada 30 fps

F00–20 tampilkan poster dan satu orbit tipis. F21–56 hero meluncur ke titik acuan. F57–83 satu diagram potong muncul, F84–116 tahan hasil seperti poster cetak. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Pakai SVG arc path dan parameter panjang jalur untuk hero dan indikator. Sederhanakan volume ke 2–3 nilai warna. Mask lingkaran dipakai hanya bila transisi mengikuti orbit.

Jika perlu musik, audisi `B16` dan palet SFX `S-DIGITAL` / `S-MEKANIK` sesuai isi shot.

## Uji frame

Cek apakah alat, jalur, dan tujuan gerak tetap jelas saat siluet diperkecil. Singkirkan HUD masa kini yang mengganggu bahasa poster.
