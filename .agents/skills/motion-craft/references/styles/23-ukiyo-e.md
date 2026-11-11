# Gaya #23 · Ukiyo-e

Buat gambar bertingkat seperti cetakan balok, dengan siluet kuat dan beberapa bidang warna yang dipisahkan garis tinta.

## Komposisi

- **16:9** — Tempatkan bentuk depan di satu tepi, bidang tengah yang membawa aksi, dan jauh yang rata. Pakai ruang kosong langit atau air sebagai jeda untuk judul.
- **9:16** — Susun kedalaman dari bawah ke atas seperti gulungan. Arah gerak mengikuti satu alur air, angin, atau jalan. Taruh judul pada bidang polos yang tidak bergerak.

## Warna, huruf, dan bahan

Kertas krem, tinta pekat, biru indigo untuk bidang jauh, vermilion untuk fokus kecil. Zen Antique untuk judul 60–84 px dan Shippori Mincho untuk isi 29–38 px. Gunakan gradasi lembut hanya jika dibatasi satu bidang cetak.

Token awal `getStyleById(23)`: kanvas `#F0E6D0`, bidang `#E5D8BC`, tinta `#1A1A1A`, muted `#5A5244`, aksen `#D9381E`, aksen sekunder `#1D3F6B`. Font preset: Zen Antique / Shippori Mincho / DM Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Pakai teks dalam bahasa yang dimengerti penonton. Jika butuh tulisan Jepang, gunakan tulisan yang benar dari materi user dan jaga glyph. Jangan tempel cap atau huruf acak sebagai ornamen.

## Koreografi contoh pada 30 fps

F00–23 satu siluet sudah memimpin. F24–53 gerakkan bidang tengah 6–10% melawan foreground. F54–80 tampilkan fokus dengan pergeseran kecil. F81–119 tahan seperti cetakan utuh. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Pakai path SVG per lapis dan parallax translasi kecil, dengan outline lebar yang tidak berubah ketebalan. Buat tekstur serat statis dan rolloff warna di dalam mask.

Jika perlu musik, audisi `B23` dan palet SFX `S-KERTAS` / `S-ORGANIK` sesuai isi shot.

## Uji frame

Jika tiga lapis diratakan, siluet utama harus tetap jelas. Cek garis tinta konsisten dan tidak berbayang seperti kartu 3D.
