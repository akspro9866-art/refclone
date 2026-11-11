# Gaya #40 · Siaran Olahraga

Buat grafis yang terasa sebagai bagian dari siaran: angka terbaca saat bergerak, skor berubah tepat waktu, dan bidang aksi tetap terlihat.

## Komposisi

- **16:9** — Jadikan cuplikan atau gambar aksi sebagai hero. Tempatkan scorebug kecil di salah satu sudut, lower third untuk nama di beat terpisah, dan replay frame penuh bila diperlukan.
- **9:16** — Atur scorebug sebagai strip atas dan simpan lower third singkat di atas area aman platform. Pertahankan skor dan nama dalam hierarki meski kolom jadi sempit.

## Warna, huruf, dan bahan

Gunakan arang dan putih untuk skor, kuning untuk status aktif, merah untuk kejadian khusus. Teko 54–78 px untuk nama, Barlow Condensed 32–44 px untuk label, Plex Mono 36–52 px untuk angka tabular.

Token awal `getStyleById(40)`: kanvas `#0A0A0A`, bidang `#18181B`, tinta `#FFFFFF`, muted `#9CA3AF`, aksen `#FFD400`, aksen sekunder `#E4002B`. Font preset: Teko / Barlow Condensed / IBM Plex Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Pakai nama, warna tim, dan skor yang benar atau tandai contoh. Logo diletakkan dengan proporsi tetap. Transisi replay harus jelas dan scorebug tidak menghalangi aksi penting.

## Koreografi contoh pada 30 fps

F00–24 aksi utama. F25–38 skor berubah tepat setelah kejadian. F39–68 tahan scorebug, F69–85 wipe replay hanya kalau narasi butuh, F86–120 tahan hasil. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Gunakan lebar kolom tetap untuk skor dan kode tim. Mask wipe scorebug di dalam panel, dan jadwalkan bunyi siaran per update. Hindari zoom ke angka ketika penonton masih perlu melihat aksi.

Jika perlu musik, audisi `B22` dan palet SFX `S-SINEMA` / `S-UMUM` sesuai isi shot.

## Uji frame

Scrub sebelum dan setelah skor berubah. Tim, angka, dan status waktu harus tetap pada posisi sama. Pastikan lapisan skor tidak menutupi bola/aksi utama.
