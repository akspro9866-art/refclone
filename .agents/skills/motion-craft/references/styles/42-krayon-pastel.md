# Gaya #42 · Krayon dan Pastel Minyak

Tampilkan gambar seolah dibuat dengan tekanan tangan. Goresan, celah putih, dan arah coretan menjelaskan cara satu bentuk dibangun.

## Komposisi

- **16:9** — Pakai satu gambar besar dan dua label maksimal. Goresan diagonal untuk isi, garis gelap lebih mantap untuk kontur. Tempatkan anak panah hanya jika mengarahkan bacaan.
- **9:16** — Bangun bentuk dari atas ke bawah atau satu objek per halaman. Taruh jawaban dekat gambar, jauh dari tepi platform. Sisakan ruang untuk satu goresan koreksi.

## Warna, huruf, dan bahan

Kertas krim, navy untuk kontur, merah untuk satu bagian penting, kuning untuk isian. Gochi Hand 64–88 px untuk judul, Patrick Hand 34–44 px untuk isi. Tahan palet kecil agar gambar terasa dari beberapa krayon yang sama.

Token awal `getStyleById(42)`: kanvas `#FFF9EC`, bidang `#FFFFFF`, tinta `#1D3557`, muted `#457B9D`, aksen `#E63946`, aksen sekunder `#FFD166`. Font preset: Gochi Hand / Patrick Hand / DM Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Gunakan proporsi yang mudah dikenali audiens. UI asli dapat ditunjuk oleh krayon di lapisan luar, dengan label/kontrol asli tetap bersih.

## Koreografi contoh pada 30 fps

F00–22 kontur utama. F23–60 isi muncul menurut arah coretan, F61–80 satu lingkaran penekanan, F81–114 tahan jawaban. Goresan terlihat bertahap sementara teks tetap stabil. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Mask beberapa path goresan dengan celah tetap 1–3 px pada 1080p. Kunci variasi stroke ke seed; tahan pose pada 10–12 fps hanya untuk lapisan gambar. SFX krayon mengikuti goresan yang terlihat.

Jika perlu musik, audisi `B08` dan palet SFX `S-KERTAS` / `S-ORGANIK` sesuai isi shot.

## Uji frame

Pastikan siluet cukup sederhana untuk ditiru dan goresan punya arah. Jika hasil tampak seperti vektor licin dengan overlay noise, ubah tepi dan celah pada stroke asli.
