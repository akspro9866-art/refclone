# Gaya #01 · Cyberpunk

Buat sistem keamanan yang sedang membaca satu kejadian. Estetika datang dari kontras panel matte, garis sinyal, dan lingkungan malam yang punya kedalaman.

## Komposisi

- **16:9** — Tempatkan sumber insiden di x=12–63% dan log bertanda waktu di kanan. Sisakan ruang hitam di antara keduanya. Bidang data dipotong sudut 12 px hanya pada sisi yang berhadapan dengan sumber sinyal.
- **9:16** — Taruh sumber insiden di atas, tiga log terakhir di bawah. Kunci timestamp pada kolom kiri agar log berikutnya tidak mendorong judul.

## Warna, huruf, dan bahan

Pakai kuning untuk fokus pelacakan, merah untuk kejadian gagal, dan tinta pucat untuk seluruh teks operasional. Taruh teal kusam pada bidang latar jika butuh kedalaman. Chakra Petch 64–82 px untuk judul ringkas, Share Tech Mono 24–30 px untuk log. Satu garis kuning memberi arah tanpa halo yang menyebar.

Token awal `getStyleById(1)`: kanvas `#0B0B10`, bidang `#141722`, tinta `#F5F6FA`, muted `#7A869A`, aksen `#F2E900`, aksen sekunder `#FF2A3D`. Font preset: Chakra Petch / Share Tech Mono / Share Tech Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Kalau menampilkan dashboard keamanan nyata, pertahankan tabel, nama event, dan status aslinya. Pada UI fiksi, gunakan satu status per kejadian dan waktu yang konsisten. Jangan isi ruang kosong dengan kode, bracket, atau tulisan Jepang yang tidak membawa makna.

## Koreografi contoh pada 30 fps

F00–24 baca layar utuh. F25–62 satu jalur menyala dari node ke baris terkait, lalu kamera mendekat sekitar 1.12×. F63–66 potong satu pita horizontal pada saat sinyal putus. F67–100 tahan baris hasil tetap tajam. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Pakai clipPath chamfer di SVG dan strokeDashoffset pada jalur sinyal. Simpan offset glitch pada 2–4 frame kejadian dan hanya di lapisan sinyal; letakkan label serta angka di lapisan terpisah. Pakai satu klik relay di perubahan status.

Jika perlu musik, audisi `B03` dan palet SFX `S-DIGITAL` / `S-SINEMA` sesuai isi shot.

## Uji frame

Frame hasil lolos jika orang bisa menunjuk sumber dan baris tujuan tanpa warna aksen. Matikan scanline di area angka kecil; monitor operasional harus terbaca tanpa efek.
