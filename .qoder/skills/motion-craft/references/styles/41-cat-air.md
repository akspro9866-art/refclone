# Gaya #41 · Cat Air

Bangun gambar dari sapuan air yang berhenti di tepi pigmen. Biarkan kertas kosong menjadi cahaya dan latar baca.

## Komposisi

- **16:9** — Letakkan satu wash lebar di sisi hero, dengan tepi basah menuju ruang kosong. Judul dan keterangan tinggal di kertas yang tidak disapu.
- **9:16** — Tumbuhkan wash dari bawah mengikuti arah bentuk. Sisakan sepertiga atas yang tenang untuk judul dan potong ke detail pigment saat perlu.

## Warna, huruf, dan bahan

Kertas hangat, tinta biru arang untuk tulisan, pink kusam dan hijau lembut untuk dua lapis warna. Cormorant 72–98 px untuk judul, Patrick Hand 30–38 px untuk catatan. Kedalaman muncul dari tepi dan transparansi, dengan maksimal dua wash bertemu.

Token awal `getStyleById(41)`: kanvas `#FBF7F0`, bidang `#F3ECE0`, tinta `#2F3E46`, muted `#6A8CAF`, aksen `#E7A5A5`, aksen sekunder `#A8C69F`. Font preset: Cormorant / Patrick Hand / DM Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Jika ada foto atau UI asli, gunakan wash sebagai latar atau transisi di luarnya. Pertahankan identitas objek melalui kontur ringan dan bidang pigment yang mengikuti bentuk.

## Koreografi contoh pada 30 fps

F00–23 bentuk pensil tipis. F24–60 wash menyebar dari titik basah. F61–85 tepi warna berhenti, detail kecil masuk. F86–120 tahan kertas diam. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Gunakan mask SVG dengan tepi tidak beraturan dan beberapa opacity band. Pisahkan tekstur kertas statis dari luasan wash yang dianimasikan. Audio organik tipis saat sapuan, lalu ruang untuk bacaan.

Jika perlu musik, audisi `B10` dan palet SFX `S-ORGANIK` / `S-UMUM` sesuai isi shot.

## Uji frame

Cek tepi wash dan pusat warna pada frame final. Kalau terlihat seperti blur digital merata, buat tepi pigmen lebih tajam di sebagian bentuk dan beri arah serapan.
