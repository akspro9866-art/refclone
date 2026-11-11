# Gaya #15 · VHS Analog

Bangun rasa rekaman yang punya konteks: satu klip 4:3, satu rentang waktu, dan gangguan sinyal singkat yang punya penyebab.

## Komposisi

- **16:9** — Tempatkan area gambar 4:3 atau crop sumber sesuai formatnya. Pakai tepi hitam atau catatan arsip kecil di luar gambar. Overlay timecode berada di margin rekaman.
- **9:16** — Pertahankan rasio rekaman di tengah dan beri caption arsip di atas/bawah. Pakai crop hanya jika subjek masih terbaca.

## Warna, huruf, dan bahan

Arang, biru gelap, putih tulang, dan merah untuk indikator rekam jika memang ditampilkan. VT323 30–42 px untuk timecode, IBM Plex Mono 26–32 px untuk keterangan modern. Kompres luminans di video sumber saja.

Token awal `getStyleById(15)`: kanvas `#0A0A0A`, bidang `#1B253B`, tinta `#E8E1D0`, muted `#8E8878`, aksen `#E01E2D`, aksen sekunder `#2B4A8B`. Font preset: VT323 / IBM Plex Mono / VT323. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Gunakan waktu dan label yang memang diketahui, atau tandai rekonstruksi. Jangan tambahkan overlay REC pada klip yang dipresentasikan sebagai pemutaran. UI modern yang sedang didemokan tetap diperlakukan sebagai layar terpisah.

## Koreografi contoh pada 30 fps

F00–22 rekaman mulai stabil. F23–27 satu tracking tear saat cut atau pergantian sumber. F28–80 perlihatkan kejadian. F81–116 tahan caption dan gambar terbaca. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Layer gambar sumber, offset kanal warna 1–2 px di tepi tinggi kontras, dan satu pita horizontal hanya pada beat gangguan. Timecode dihitung dari fps dan posisi video. SFX transport tape masuk saat sumber berubah.

Jika perlu musik, audisi `B02` dan palet SFX `S-ANALOG` / `S-UMUM` sesuai isi shot.

## Uji frame

Scrub lima frame sekitar gangguan. Muka, angka, dan caption harus kembali bersih segera setelah beat. Kalau seluruh video bergoyang, pembatasan efeknya belum jalan.
