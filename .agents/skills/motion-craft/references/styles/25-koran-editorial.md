# Gaya #25 · Koran Editorial

Buat halaman berita yang punya headline, lead, bukti, dan keterangan. Hierarki terasa dari kolom dan ukuran huruf yang tegas.

## Komposisi

- **16:9** — Gunakan grid 12 kolom: headline dan lead di 5 kolom, satu gambar atau tabel di 7 kolom. Satu garis rule horizontal menautkan halaman, jangan isi semua kolom dengan artikel kecil.
- **9:16** — Susun headline, gambar, caption, dan satu angka ringkas. Pertahankan lebar bacaan; pisahkan adegan kalau ada lebih dari satu paragraf.

## Warna, huruf, dan bahan

Kertas kusam, tinta hitam, merah marun hanya untuk edisi, penanda kutipan, atau fokus editorial. Playfair Display 72–104 px untuk headline, Old Standard TT 29–36 px untuk lead. Libre Franklin 23–28 px untuk caption dan sumber.

Token awal `getStyleById(25)`: kanvas `#E9E4D4`, bidang `#DFD9C6`, tinta `#1A1A1A`, muted `#5A574F`, aksen `#B3261E`, aksen sekunder `#1A1A1A`. Font preset: Playfair Display / Old Standard TT / Libre Franklin. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Gunakan judul dan tanggal yang akurat atau label simulasi. Tampilkan artikel/screenshot sebagai crop terbaca. Untuk berita sumber, pisahkan kutipan dari narasi video.

## Koreografi contoh pada 30 fps

F00–24 headline masuk dengan cut. F25–58 geser sepanjang kolom ke satu foto. F59–79 tarik garis penunjuk ke detail. F80–118 tahan keterangan. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Buat rules dengan CSS 1–2 px dan set lebar kolom sebelum memasukkan copy. Gunakan clip reveal untuk halaman dan hard cut saat berpindah artikel. Suara lembar hanya bila halaman memang berpindah.

Jika perlu musik, audisi `B14` dan palet SFX `S-MEKANIK` / `S-KERTAS` sesuai isi shot.

## Uji frame

Periksa urutan headline, bukti, sumber pada preview kecil. Hindari faux Lorem Ipsum, tanggal palsu, atau font mikro yang hanya meniru kerapatan koran.
