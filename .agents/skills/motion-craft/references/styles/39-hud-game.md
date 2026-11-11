# Gaya #39 · HUD Game

Buat HUD untuk satu tujuan pemain, dengan indikator yang bisa dibaca sekilas dan aksi yang memicu perubahan jelas.

## Komposisi

- **16:9** — Hero/medan aksi di tengah; tujuan di kiri atas, status paling penting di kanan, pesan kejadian dekat aksi. Tahan dua zona kosong agar gameplay tidak tertutup.
- **9:16** — Pindahkan tujuan dan status ke satu strip atas. Di bawah, tampilkan event yang aktif saja. Kurangi modul daripada mengecilkan teks.

## Warna, huruf, dan bahan

Biru arang, tinta putih, teal untuk aksi siap atau selesai, amber untuk warning. Rajdhani 60–78 px untuk judul, Teko 38–48 px untuk status, Share Tech Mono 26–32 px untuk angka. Gunakan segmen yang menyatakan kuantitas.

Token awal `getStyleById(39)`: kanvas `#0B1118`, bidang `#14202E`, tinta `#F2F6F8`, muted `#6E859E`, aksen `#00D1B2`, aksen sekunder `#FFB800`. Font preset: Rajdhani / Teko / Share Tech Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Ikuti istilah dan ikon game bila UI nyata. Untuk demo fiksi, buat aturan konsisten, misalnya satu indikator bertambah saat objektif tercapai. Hindari angka acak yang terus berputar.

## Koreografi contoh pada 30 fps

F00–23 tujuan terbaca. F24–54 aksi mengubah satu indikator, F55–78 panel event ringkas muncul, F79–112 HUD hasil diam. Satu cue audio untuk perubahan status. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Tempatkan HUD di screen-space di luar CameraRig. Kaitkan nilai dan indikator dengan timeline yang sama. Pakai clamp untuk progress dan hold yang cukup setelah nilai berubah.

Jika perlu musik, audisi `B03` dan palet SFX `S-DIGITAL` / `S-ARCADE` sesuai isi shot.

## Uji frame

Cek bahwa penonton bisa menyebut tujuan serta status dari satu frame. Jika bracket dan meter memenuhi layar, sisakan indikator yang memengaruhi keputusan.
