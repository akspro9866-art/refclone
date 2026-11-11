# Gaya #37 · Inflatable 3D

Tunjukkan tekanan udara lewat perubahan volume, seam, specular, dan settling. Prop harus punya bobot dan bentuk yang bisa dikenali saat belum mengembang.

## Komposisi

- **16:9** — Satu bentuk besar dekat permukaan matte dengan ruang untuk mengembang. Copy berada di kolom terpisah, dan bayangan kontak mulai di titik dasar.
- **9:16** — Susun hero vertikal dengan copy ringkas di atas. Gunakan frame awal yang cukup longgar sehingga bentuk maksimum tetap masuk area aman.

## Warna, huruf, dan bahan

Gunakan dasar krem, satu warna jenuh untuk hero, teal atau gelap untuk kontras. Fredoka 68–96 px untuk headline, Baloo 2 32–42 px untuk isi. Tempatkan highlight pada sisi melengkung dan garis seam yang lebih redup.

Token awal `getStyleById(37)`: kanvas `#FFF4E6`, bidang `#FFFFFF`, tinta `#1D1D2C`, muted `#6E6E85`, aksen `#FF4D6D`, aksen sekunder `#00C2A8`. Font preset: Fredoka / Baloo 2 / DM Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Bila menceritakan aplikasi, inflatable berperan sebagai metafora hasil dan UI asli ditempatkan pada cut terpisah. Hindari menggembungkan label atau kontrol yang perlu terbaca.

## Koreografi contoh pada 30 fps

F00–22 bentuk mengempis. F23–56 volume bertambah dengan posisi alas terkunci. F57–70 satu rebound 3–5%, F71–112 tahan volume penuh dan seam terbaca. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Buat path tertutup dan gradient radial dengan strip specular yang mengikuti kelengkungan. Animasikan skala dari pivot kontak dan bentuk seam bersama siluet. Gunakan SFX pompa singkat dan satu udara berhenti saat volume stabil.

Jika perlu musik, audisi `B07` dan palet SFX `S-ORGANIK` / `S-UMUM` sesuai isi shot.

## Uji frame

Cek bayangan dan seam pada ukuran kecil. Bila bentuk menyerupai clay matte, tambah specular lokal; bila tampak seperti gel plastik tanpa berat, pertajam kontak dengan lantai.
