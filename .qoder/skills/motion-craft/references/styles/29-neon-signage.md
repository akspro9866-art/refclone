# Gaya #29 · Neon Signage

Buat signage sebagai benda bercahaya yang dipasang ke permukaan. Bayangan ruang, dudukan, dan pantulan lokal membuat neon terasa nyata.

## Komposisi

- **16:9** — Taruh papan utama di sisi gelap frame. Satu bidang dinding atau kaca menangkap spill cahaya. Informasi kecil berada di bidang matte di bawah atau samping.
- **9:16** — Jadikan tanda sebagai satu bentuk tinggi dan ikuti nyala dari atas ke bawah. Simpan nama tempat dan detail dalam area terbaca, jauh dari inti glow.

## Warna, huruf, dan bahan

Panggung hampir hitam, satu warna tabung seperti pink, cyan sebagai pantulan opsional. Tilt Neon 78–112 px pada nama singkat; Space Grotesk 30–38 px atau sans netral untuk isi. Bentuk tabung punya inti pucat sempit, halo lebar yang redup, dan dudukan gelap.

Token awal `getStyleById(29)`: kanvas `#121014`, bidang `#1D1922`, tinta `#FFE9C7`, muted `#786E82`, aksen `#FF3D6E`, aksen sekunder `#6EE7FF`. Font preset: Tilt Neon / Space Grotesk / DM Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Jika venue/brand punya signage asli, ikuti bentuk huruf dan proporsinya. Jangan beri halo pada tombol, alamat, atau jadwal.

## Koreografi contoh pada 30 fps

F00–23 tampilkan papan mati dan ruang. F24–30 dua aktivasi pendek, F31–64 cahaya stabil dan spill terasa, F65–113 tahan nama dengan informasi jelas. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Gandakan path tabung untuk inti dan halo SVG; ikat intensitas dinding pada progress nyala yang sama. Letakkan blur di balik path dan hindari bayangan pada teks data. Audio relay hanya pada aktivasi.

Jika perlu musik, audisi `B02` dan palet SFX `S-ANALOG` / `S-UMUM` sesuai isi shot.

## Uji frame

Periksa keterbacaan ketika neon sudah stabil. Kalau semua tepi berpendar atau ruang tampak seperti gradient kosong, tambahkan material dinding yang spesifik dan kurangi halo.
