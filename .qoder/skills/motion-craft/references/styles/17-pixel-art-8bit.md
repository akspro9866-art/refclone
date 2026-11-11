# Gaya #17 · Pixel Art 8-Bit

Rancang adegan sebagai layar permainan kecil dengan tile dan sprite yang benar-benar sejajar ke kisi piksel.

## Komposisi

- **16:9** — Buat stage logis 480×270, naikkan skala integer 4× untuk 1920×1080. HUD ringkas menempel ke atas dan sprite bergerak di playfield; sisakan padding satu tile.
- **9:16** — Gunakan stage 270×480 dan susun tujuan di atas area aksi. Pertahankan kelipatan integer di koordinat sprite, tile, dan font display.

## Warna, huruf, dan bahan

Gunakan navy dan abu biru sebagai lapisan, krem terang untuk informasi, kuning untuk item aktif, hijau untuk hasil. Press Start 2P untuk judul/angka singkat, Pixelify Sans untuk teks terbaca. Tetapkan tile 12 atau 16 piksel logis.

Token awal `getStyleById(17)`: kanvas `#1A1C2C`, bidang `#333C57`, tinta `#F4F4F4`, muted `#94B0C2`, aksen `#FFCD75`, aksen sekunder `#38B764`. Font preset: Press Start 2P / Pixelify Sans / Press Start 2P. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Buat sprite dengan siluet 2–4 warna dan pose yang bisa dibaca. Jika brief butuh UI produk asli, tampilkan potongan asli di luar stage; HUD piksel hanya untuk bagian permainan/metafora.

## Koreografi contoh pada 30 fps

F00–21 layar idle, F22–55 sprite bergerak per tile, F56–69 satu pickup mengubah angka, F70–111 pose menang dan HUD diam. Satu suara chiptune pendek saat pickup. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Render SVG dengan shapeRendering crispEdges atau raster pixelated. Bulatkan x dan y sebelum transform scale integer; kuantisasi pose sprite pada grid frame sementara kamera diam.

Jika perlu musik, audisi `B13` dan palet SFX `S-ARCADE` / `S-DIGITAL` sesuai isi shot.

## Uji frame

Scrub frame per frame. Garis 1 piksel logis harus selalu sama tebal dan ikon tetap terbaca. Hapus blur, transform pecahan, dan shadow soft.
