# Gaya #14 · Risograph

Pisahkan setiap bidang warna sebagai plat tinta. Tumpang tindih membentuk warna ketiga yang punya tujuan, dan tepi register membuat proses cetak terasa.

## Komposisi

- **16:9** — Tata foto atau ilustrasi sebagai satu plat besar di kiri dengan area warna kedua yang menempel sebagian. Judul dan copy punya bidang kertas tersendiri.
- **9:16** — Bangun poster bertingkat. Masukkan register slip pada bidang foto dan border, sisakan label di bagian bawah yang tidak terpengaruh offset.

## Warna, huruf, dan bahan

Pilih dua tinta, misalnya biru dan pink, di atas kertas hangat. Kuning opsional hanya untuk plat kecil yang dibenarkan oleh tema. Fraunces 64–90 px untuk judul; Space Mono 24–30 px untuk detail. Warna body perlu lebih gelap daripada tinta dekoratif.

Token awal `getStyleById(14)`: kanvas `#F5F0E4`, bidang `#FFFDF8`, tinta `#0078BF`, muted `#00A95C`, aksen `#FF48B0`, aksen sekunder `#FFE800`. Font preset: Fraunces / Space Mono / Space Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Jika memasukkan screenshot, pisahkan foto/thumbnail yang boleh dicetak dari angka dan kontrol yang perlu tetap tajam. Produk fisik bisa dibentuk dari dua siluet yang tumpang tindih.

## Koreografi contoh pada 30 fps

F00–20 plat pertama menempel. F21–49 plat kedua meluncur 12 px, berhenti dengan offset register tetap 1–3 px. F50–72 potong ke detail overprint. F73–110 tahan poster. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Pakai layer SVG terpisah dan blend multiply pada plat, lalu beri mask halftone per gambar. Posisi bintik tetap antarframe. Satu SFX kontak per plat, bukan ambience mesin yang terus berbunyi.

Jika perlu musik, audisi `B01` dan palet SFX `S-KERTAS` / `S-UMUM` sesuai isi shot.

## Uji frame

Cek bahwa overprint terlihat sebagai warna ketiga dan teks tetap satu warna. Kalau hasil hanya terlihat seperti filter noise, buat pemisahan plat lebih jelas.
