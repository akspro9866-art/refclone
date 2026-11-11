# Gaya #28 · Glitch

Glitch menceritakan satu gangguan. Konteks normal harus ada sebelum artefak, dengan hasil yang bisa dibaca setelah pemulihan.

## Komposisi

- **16:9** — Satu bidang gambar/tipografi stabil memenuhi layar. Pilih area sempit sebagai sumber gangguan, misalnya baris error atau bagian frame yang hilang. Teks status di luar pita.
- **9:16** — Ganggu satu potong layar yang berbatas jelas. Gunakan layar yang sama sebelum dan sesudah agar perubahannya terbaca pada ponsel.

## Warna, huruf, dan bahan

Hitam/putih sebagai keadaan normal, merah untuk error, biru untuk kanal terpisah. Rubik Mono One 65–86 px untuk status pendek, IBM Plex Mono 26–34 px untuk detail. Pisahkan warna kanal 2–4 px hanya pada beat rusak.

Token awal `getStyleById(28)`: kanvas `#000000`, bidang `#121212`, tinta `#FFFFFF`, muted `#7A7A7A`, aksen `#FF0033`, aksen sekunder `#1E5BFF`. Font preset: Rubik Mono One / Share Tech Mono / Share Tech Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

UI tetap berperilaku sesuai peristiwa. Pisahkan glitch kreatif di luar screenshot jika user meminta tampilan sistem nyata. Jangan ubah angka/error menjadi huruf acak yang tidak punya hasil.

## Koreografi contoh pada 30 fps

F00–27 keadaan normal. F28–31 pindahkan tiga pita dari sumber yang sama. F32–58 kembali bersih dan tampilkan sebab. F59–104 tahan respons. Satu burst singkat mengikuti gangguan. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Salin region gambar dengan clipPath persegi dan offset X tetap untuk tiap frame terpilih. Pakai seeded offsets atau array eksplisit. Jangan flash seluruh layar berulang; cek juga frame cut masuk dan keluar.

Jika perlu musik, audisi `B04` dan palet SFX `S-DIGITAL` / `S-ANALOG` sesuai isi shot.

## Uji frame

Pastikan keadaan normal dan hasil akhir bisa dibaca tanpa replay. Jika glitch terjadi pada setiap cut, sisakan satu gangguan yang benar-benar menjelaskan cerita.
