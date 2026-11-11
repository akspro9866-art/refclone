# Gaya #08 · Clay 3D

Tampilkan benda seperti model tanah liat yang bisa ditekan. Berat, deformasi saat mendarat, dan arah cahaya membuat materialnya terasa.

## Komposisi

- **16:9** — Letakkan satu objek pada panggung matte dengan bidang bayangan lebar. Gunakan sudut kamera rendah sekitar 10–15° di atas permukaan. Caption berada di luar bayangan.
- **9:16** — Besarkan objek di atas titik kontaknya. Beri ruang vertikal untuk perubahan bentuk, lalu gunakan bagian bawah sebagai ruang copy yang tenang.

## Warna, huruf, dan bahan

Pakai tiga rona pastel dengan nilai terang berbeda, satu warna gelap untuk teks. Sumber cahaya dari kiri atas; bayangan kontak tajam dekat alas, makin lebar menjauh. Baloo 2 64–88 px dan Fredoka 30–38 px; tekstur permukaan sangat tipis.

Token awal `getStyleById(8)`: kanvas `#F7EDE2`, bidang `#FFF9F2`, tinta `#2D232E`, muted `#7A6C7B`, aksen `#FF8FA3`, aksen sekunder `#FFC857`. Font preset: Baloo 2 / Fredoka / DM Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Kalau animasi membahas aplikasi, jadikan clay sebagai objek metafora di samping crop UI. Status asli tetap dalam UI, dengan warna dan huruf platform yang benar.

## Koreografi contoh pada 30 fps

F00–22 objek jatuh singkat. F23–34 tekan Y ke 0.88 dan lebarkan X ke 1.07 saat menyentuh alas. F35–63 pulihkan bentuk dengan satu rebound, lalu F64–108 tahan ekspresi/pose yang menjelaskan manfaat. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Bangun bentuk dengan path SVG berlapis dan satu gradient radial lembut di tiap volume. Sinkronkan scaleY, scaleX, dan lebar bayangan dengan posisi alas; kuantisasi gerak objek jika ingin rasa stop motion, kamera tetap halus.

Jika perlu musik, audisi `B08` dan palet SFX `S-ORGANIK` / `S-UMUM` sesuai isi shot.

## Uji frame

Pastikan objek menyentuh lantai saat tertekan dan tidak terlihat melayang. Jika tampak seperti balon mengilap, kurangi specular dan pertajam bayangan kontak.
