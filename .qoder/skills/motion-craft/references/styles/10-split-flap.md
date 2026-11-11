# Gaya #10 · Split Flap

Buat papan dengan mekanisme fisik yang menyatakan perubahan nilai. Penonton harus bisa membaca baris sebelum dan sesudah flap bergerak.

## Komposisi

- **16:9** — Tampilkan dua hingga tiga baris dan maksimal empat kolom nyata seperti waktu, tujuan, peron, dan status. Beri lebar tetap per kolom, judul header sejajar dengan nilai, dan angka tabular.
- **9:16** — Ambil satu baris utuh tiap shot atau pecah kolom menjadi dua tingkat yang tetap berlabel. Hindari mengecilkan seluruh papan.

## Warna, huruf, dan bahan

Arang dan putih tulang untuk glyph. Amber menandai baris yang berubah, teal untuk status yang benar-benar selesai. Barlow Condensed 56–72 px untuk judul; DM Mono 34–52 px pada flap. Garis engsel 1–2 px berada di tengah glyph.

Token awal `getStyleById(10)`: kanvas `#111111`, bidang `#1B1B1B`, tinta `#F5F1E6`, muted `#7A766E`, aksen `#F2A900`, aksen sekunder `#2EC4B6`. Font preset: Barlow Condensed / DM Mono / DM Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Data jadwal atau status harus berasal dari brief atau diberi label demo. Untuk UI lain, jadikan mekanisme flap khusus satu nilai yang berubah, misalnya jumlah stok. Jaga ikon dan tombol aplikasi tetap asli.

## Koreografi contoh pada 30 fps

F00–24 tampilkan nilai awal. F25–35 putar panel atas menuju engsel, tukar glyph di tengah, lalu buka panel bawah. F36–57 lanjut ke kolom yang memang berubah. F58–103 tahan nilai akhir. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Pisah glyph ke mask atas dan bawah, gunakan transform-origin di engsel dengan rotateX. Cadangkan lebar per karakter termasuk spasi. SFX clack dipasang per kelompok perubahan, dengan volume lebih rendah untuk flap susulan.

Jika perlu musik, audisi `B24` dan palet SFX `S-MEKANIK` / `S-DIGITAL` sesuai isi shot.

## Uji frame

Periksa pertengahan flip dan pastikan tidak ada glyph ganda atau garis engsel memutus bacaan akhir. Baris yang tidak berubah harus tetap diam.
