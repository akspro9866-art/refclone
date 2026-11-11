# Gaya #16 · Y2K Kromium

Buat objek krom yang terasa dipantuli ruang. Benda utama, highlight, dan judul seolah berada di sampul produk digital, dengan garis yang jelas saat diam.

## Komposisi

- **16:9** — Tampilkan hero besar pada latar tinta. Biarkan satu highlight mengikuti kurva bentuk. Judul berada di kiri bawah atau kolom samping, dengan indeks produk kecil.
- **9:16** — Crop ke close-up siluet terlebih dahulu, lalu tampilkan bentuk utuh di tengah. Beri label di bawah objek pada bidang solid agar highlight tidak menabraknya.

## Warna, huruf, dan bahan

Gunakan perak dan biru dingin untuk refleksi, merah sebagai satu tanda aksi. Unbounded 64–88 px untuk judul pendek, Space Grotesk 29–38 px untuk isi. Gradient krom perlu pita sempit terang dan pita gelap yang jelas, dengan tepi yang mengikuti volume.

Token awal `getStyleById(16)`: kanvas `#0D0D12`, bidang `#191D28`, tinta `#F5F8FF`, muted `#8F9BB3`, aksen `#A8D8FF`, aksen sekunder `#E8143C`. Font preset: Unbounded / Space Grotesk / DM Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Pada demo UI, simpan efek krom di objek panggung atau bingkai visual. Panel aplikasi tetap memakai material aslinya dan angka tetap kontras tanpa efek refleksi.

## Koreografi contoh pada 30 fps

F00–20 tampilkan potongan refleksi. F21–55 putar hero 12–20° sehingga pita terang lewat satu sisi. F56–77 match cut ke profil atau detail. F78–111 tahan lockup. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Buat mask dari siluet objek dan definisikan SVG linearGradient dengan stop tajam serta transisi lembut bergantian. Animasikan koordinat highlight mengikuti rotasi objek, bukan semua warna latar. Pakai satu sweep ringan saat pantulan bergerak.

Jika perlu musik, audisi `B04` dan palet SFX `S-DIGITAL` / `S-UMUM` sesuai isi shot.

## Uji frame

Cek siluet saat gradient dimatikan. Jika bentuk menjadi tak dikenal atau teks tampak seperti chrome default, desain ulang hero dan gunakan teks datar.
