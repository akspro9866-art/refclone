# Gaya #12 · Swiss Internasional

Bangun satu grid editorial yang menempatkan informasi dan UI sesuai prioritas baca. Ruang kosong dan keselarasan melakukan pekerjaan yang biasanya diberikan ke dekorasi.

## Komposisi

- **16:9** — Gunakan 12 kolom, margin sekitar 6%, dan gutter 24 px pada 1920×1080. Judul atau langkah memakai 3–4 kolom; visual memakai 8–9 kolom. Sejajarkan awal teks dengan objek yang sedang dijelaskan.
- **9:16** — Susun grid 4 kolom: judul singkat di atas, satu crop UI terbaca di tengah, catatan singkat di bawah. Potong chrome atau sidebar yang tidak terlibat dengan aksi jika crop masih memberi konteks.

## Warna, huruf, dan bahan

Off-white sebagai panggung, hitam tinta untuk isi, merah satu fokus yang artinya konsisten. Hanken Grotesk 68–88 px pada judul, 32–42 px pada penjelasan. IBM Plex Mono 22–26 px untuk nomor langkah/versi bila berguna. Grid tampak lewat align dan gutter; garis grid opsional dan biasanya tersembunyi.

Token awal `getStyleById(12)`: kanvas `#F4F4F0`, bidang `#EAEAE4`, tinta `#111111`, muted `#767670`, aksen `#E10600`, aksen sekunder `#111111`. Font preset: Hanken Grotesk / Hanken Grotesk / IBM Plex Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Untuk tutorial installer grafis, tampilkan chrome serta kontrol sesuai platform dan label tombol yang terbaca. Nomor langkah dan garis penunjuk berada di luar screenshot. Warna brand atau status asli tetap di dalam UI.

## Koreografi contoh pada 30 fps

F00–26 baca tujuan dan konteks. F27–58 crop diperbesar tanpa rotasi, berhenti sebelum aksi. F59–76 status berubah tepat pada klik. F77–112 tahan bukti hasil dengan baseline yang tetap. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Pakai grid CSS dengan ukuran dari useVideoConfig. Pindahkan fokus dengan mask/crop atau translasi pendek; pasang hard cut saat struktur informasi berubah. Dengan kamera 1.0×, gerakkan highlight pada kontrol yang benar.

Jika perlu musik, audisi `B21` dan palet SFX `S-DIGITAL` / `S-UMUM` sesuai isi shot.

## Uji frame

Overlay grid saat QA untuk memeriksa empat sisi yang sejajar. Uji bacaan judul, langkah, dan tombol pada skala 50%. Jika garis merah muncul di lebih dari satu fokus, pilih yang sedang dijelaskan.
