# Gaya #43 · Motion Reel Editorial

Buat reel seperti seri halaman editorial yang dipotong mengikuti bukti. Kontras huruf display, gambar, dan ruang kosong memberi identitas antarshot.

## Komposisi

- **16:9** — Pakai grid 12 kolom dan satu sumbu teks yang berulang. Frame A headline serif besar di kiri, bukti di kanan; frame B bukti memenuhi sebagian besar layar, metadata kecil di sumbu lama. Tetapkan satu margin/sistem penomoran jika informasi itu berguna.
- **9:16** — Gunakan grid 4 kolom, hero besar mengisi tengah, dan judul pendek yang menempel satu margin. Pecah produk atau demo jadi satu aksi per scene daripada memuat bento penuh.

## Warna, huruf, dan bahan

Krem/hitam untuk mode terang atau arang/ivory untuk mode gelap. Oranye untuk satu highlight, lime untuk mode alternatif bila mendukung brand. Instrument Serif 96–136 px regular/italic untuk display, Hanken Grotesk 36–48 px untuk kalimat, JetBrains Mono 22–26 px hanya untuk metadata.

Token awal `getStyleById(43)`: kanvas `#F4EEE7`, bidang `#FFFFFF`, tinta `#0F110F`, muted `#686662`, aksen `#FD5837`, aksen sekunder `#C9DE4B`. Font preset: Instrument Serif / Hanken Grotesk / JetBrains Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Pilih satu bukti yang memang berkaitan dengan klaim seperti foto produk atau potongan UI nyata. Pertahankan brand dan chrome di shot bukti. Counter/timecode opsional bila menyatakan bab atau progres sungguhan.

## Koreografi contoh pada 30 fps

F00–20 headline pendek terbaca. F21–52 masuk bukti dengan crop berporos sama. F53–80 match cut pada siluet produk atau garis antarmuka. F81–120 lockup akhir bersih dan diam. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Jaga baseline dan sumbu crop antarshot. Gunakan mask/clip reveal dan satu shared element yang memang sama; beri satu accent cut di beat. Jangan tambahkan kartu, bracket, atau grain secara default.

Jika perlu musik, audisi `B09` dan palet SFX `S-DIGITAL` / `S-MEKANIK` sesuai isi shot.

## Uji frame

Ambil frame awal, tengah, dan akhir dan lihat sebagai seri. Jika hero selalu berupa browser besar dan copy kecil, tukar skala atau medium bukti. Pertahankan sumbu, aksen, dan timing baca antarframe.
