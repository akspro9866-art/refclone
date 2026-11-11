# Gaya #30 · Papan Tulis Kapur

Gunakan papan sebagai alat menjelaskan satu langkah atau menyusun menu singkat. Teks harus terasa ditulis untuk dibaca, dengan jejak kapur di permukaan papan.

## Komposisi

- **16:9** — Bagi papan jadi dua bagian dengan margin lebar: judul dan langkah di satu sisi, gambar atau rumus di sisi lain. Satu garis horizontal menahan baseline tulisan.
- **9:16** — Susun tiga baris besar atau satu langkah per kartu papan. Hapus langkah lama sebelum menggantinya; sisakan area kosong untuk jawaban.

## Warna, huruf, dan bahan

Hijau papan tua, putih kapur untuk isi, kuning lembut untuk garis fokus, merah untuk koreksi. Schoolbell 64–88 px untuk headline dan Kalam 34–46 px untuk isi. Debu tipis hanya sekitar stroke; kurangi grain di area angka.

Token awal `getStyleById(30)`: kanvas `#2B3A37`, bidang `#222F2C`, tinta `#F1F1E8`, muted `#9AB0AA`, aksen `#F6D365`, aksen sekunder `#F28DA6`. Font preset: Schoolbell / Kalam / DM Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Untuk menu, pakai nama dan harga yang benar dari brief dengan kolom harga tetap. Untuk kelas, tampilkan rumus/diagram dengan makna. Kalau konten butuh screenshot aplikasi, papan menjelaskan di luarnya.

## Koreografi contoh pada 30 fps

F00–21 tulisan awal. F22–56 tulis satu bentuk atau langkah dari kiri ke kanan. F57–79 garis bawah atau hapus bagian yang berubah. F80–111 tahan hasil. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Reveal path stroke dengan mask halus dan noise statis dari SVG filter. Gunakan wipe lokal untuk penghapus dan biarkan residu 4–8% saja. SFX kapur mengikuti durasi goresan.

Jika perlu musik, audisi `B19` dan palet SFX `S-ORGANIK` / `S-KERTAS` sesuai isi shot.

## Uji frame

Periksa angka dan huruf pada thumbnail. Jika seluruh bidang penuh debu atau tulisan terlihat seperti font putih bersih di hijau polos, perbaiki tekstur di tepi goresan.
