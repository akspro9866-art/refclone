# Gaya #02 · Doodle

Perlakukan adegan sebagai satu halaman catatan yang makin jelas ketika digambar. Bentuk utama perlu bisa dikenali dari urutan goresannya.

## Komposisi

- **16:9** — Sisakan sepertiga kiri untuk pertanyaan. Pakai meja gambar di kanan, dengan satu panah yang benar-benar menghubungkan dua benda. Ujung panah berhenti sebelum menabrak label.
- **9:16** — Susun pertanyaan, gambar, dan jawaban seperti catatan turun satu halaman. Perbesar subjek; potong ruang meja yang kosong.

## Warna, huruf, dan bahan

Tinta biru tua untuk struktur, kuning marker hanya untuk satu penemuan, merah bata untuk koreksi. Gochi Hand 60–76 px untuk pertanyaan, Patrick Hand 32–42 px untuk penjelasan. Tekstur kertas tipis dan stabil; dua ketebalan garis 4 dan 7 px cukup di 1080p.

Token awal `getStyleById(2)`: kanvas `#F6F0E1`, bidang `#FFFDF7`, tinta `#1F3A93`, muted `#6C7A9C`, aksen `#FFD23F`, aksen sekunder `#E4572E`. Font preset: Gochi Hand / Patrick Hand / DM Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Jika ada UI nyata, tunjukkan crop tombol atau layar yang dibahas dan gambar anotasi di luarnya. Untuk diagram sendiri, gunakan label deskriptif seperti “air masuk” dan satu bentuk tangan per benda.

## Koreografi contoh pada 30 fps

F00–18 tampilkan pertanyaan. F19–58 gambar kontur, baru panah bergerak mengikuti urutan baca. F59–78 sapukan marker satu kali. F79–110 tahan jawaban. Biarkan goresan kertas berirama 12 fps, teks tetap tajam tiap frame. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Buat path dengan sedikit variasi ketebalan; reveal stroke memakai pathLength=1. Tukar maksimal tiga bentuk garis buatan tangan pada interval tetap. Gunakan suara pensil selama garis bertambah, lalu berhenti.

Jika perlu musik, audisi `B01` dan palet SFX `S-KERTAS` / `S-ORGANIK` sesuai isi shot.

## Uji frame

Tanpa animasi, halaman harus terlihat seperti penjelasan yang utuh. Jika semua objek bergetar, batasi line boil ke kontur yang sedang digambar.
