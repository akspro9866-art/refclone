# Gaya #38 · Peta Transit

Gunakan peta jaringan untuk menjelaskan urutan. Stasiun adalah tahap nyata, simpang adalah pilihan, dan garis aktif menunjukkan rute penonton.

## Komposisi

- **16:9** — Satu jalur horizontal atau diagonal 45°, dengan titik transfer di tempat yang benar. Beri label stasiun di sisi berselang hanya kalau perlu ruang.
- **9:16** — Ubah jaringan jadi rute vertikal. Fokus satu perpindahan per shot, dan tampilkan legenda kecil yang tidak menabrak label stasiun.

## Warna, huruf, dan bahan

Dasar putih hangat, tinta gelap, merah dan biru untuk dua jalur berbeda. Barlow Condensed 58–80 px untuk judul, Barlow 30–36 px untuk tahap, Plex Mono 22–26 px untuk nomor. Stasiun transfer ditandai bentuk dan label, bukan warna saja.

Token awal `getStyleById(38)`: kanvas `#F6F4EE`, bidang `#FFFFFF`, tinta `#1A1A1A`, muted `#757570`, aksen `#E63946`, aksen sekunder `#1D8FE1`. Font preset: Barlow Condensed / Barlow / IBM Plex Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Pilih metafora rute bila brief memang punya urutan atau cabang. Gunakan nama tempat dan urutan benar untuk jaringan nyata; tandai skematis jika posisi disederhanakan.

## Koreografi contoh pada 30 fps

F00–23 tampilkan asal dan tujuan. F24–57 gambar jalur sampai simpang. F58–80 cabang yang dipilih diberi penekanan. F81–117 tahan seluruh rute dan legenda. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Definisikan segmen H/V atau 45° pada grid SVG. Gunakan satu path untuk garis dan posisi penanda. Geser kamera mengikuti stasiun aktif hanya jika keseluruhan peta tidak muat.

Jika perlu musik, audisi `B24` dan palet SFX `S-MEKANIK` / `S-DIGITAL` sesuai isi shot.

## Uji frame

Pastikan label tidak beradu di persimpangan dan arah baca bisa diikuti tanpa animasi. Hapus stasiun yang tidak mewakili tahap atau fakta.
