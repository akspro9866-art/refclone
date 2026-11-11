# Gaya #13 · Bauhaus dan Konstruktivis

Bentuk geometri berfungsi sebagai argumen: ukuran menyatakan pentingnya, diagonal menyatakan arah, dan kontras menyatakan perubahan.

## Komposisi

- **16:9** — Pilih satu diagonal 18–25° sebagai garis aksi. Bidang judul mengikuti ujung diagonal tetapi baseline isi tetap horizontal. Pakai satu lingkaran atau bidang besar sebagai titik balik.
- **9:16** — Geser arah diagonal menjadi sumbu bawah-ke-atas dan sisakan kolom copy tegak. Bentuk besar memotong tepi tanpa memotong huruf.

## Warna, huruf, dan bahan

Kertas hangat, tinta hitam, merah untuk perubahan utama, kuning untuk penanda kedua bila dibutuhkan. Bebas Neue 92–128 px untuk kata kunci; Jost 30–40 px untuk kalimat; satu ukuran angka diulang konsisten.

Token awal `getStyleById(13)`: kanvas `#EFE6D2`, bidang `#F5EBD8`, tinta `#141414`, muted `#5C5649`, aksen `#D7261E`, aksen sekunder `#F2B705`. Font preset: Bebas Neue / Jost / DM Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Gunakan bentuk untuk hubungan seperti input, hambatan, dan hasil. Jika ada foto atau UI sumber, potong jadi satu bidang bukti dengan caption tegak; jangan putar antarmuka dan isi baca.

## Koreografi contoh pada 30 fps

F00–24 tampakkan dua bidang kontras. F25–52 bidang merah bergerak sepanjang diagonal sampai membentur pusat argumen. F53–76 potong ke hasil dengan diagonal sama. F77–106 tahan kata kunci. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Definisikan sumbu diagonal sekali dan gunakan clipPath SVG pada bidang, posisi teks, serta wipe. Pilih eased linear yang berhenti tepat di alignment. Beri satu aksen mekanik ketika bentuk menyentuh ujungnya.

Jika perlu musik, audisi `B23` dan palet SFX `S-MEKANIK` / `S-SINEMA` sesuai isi shot.

## Uji frame

Di frame diam, penonton harus bisa membaca arah argumen tanpa motion. Hilangkan bentuk yang hanya mengisi ruang kosong atau membentuk beberapa diagonal saingan.
