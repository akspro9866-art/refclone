# Gaya #27 · Wireframe dan Low-Poly 3D

Perlihatkan bentuk dan topologi objek. Wireframe digunakan untuk menjelaskan konstruksi, low-poly memberi massa agar penonton melihat fungsi tiap bagian.

## Komposisi

- **16:9** — Satu objek 3/4 berada di kanan sekitar 58% frame. Diagram garis atau callout di kiri menamai dua bagian. Gunakan siluet solid di belakang wireframe tipis untuk kedalaman.
- **9:16** — Awali dengan siluet utuh di atas, lalu satu detail sendi atau modul di tengah. Pindahkan label ke luar mesh pada bidang gelap polos.

## Warna, huruf, dan bahan

Panggung biru arang, garis grid redup, outline objek pucat, oranye untuk satu edge/face aktif. Cyan sebagai garis bantu terpisah bila dibutuhkan. Space Mono 56–76 px untuk judul, Plex Mono 24–30 px untuk callout.

Token awal `getStyleById(27)`: kanvas `#0C1015`, bidang `#141B24`, tinta `#E8EEF2`, muted `#6C7D8C`, aksen `#FF7A1A`, aksen sekunder `#38BDF8`. Font preset: Space Mono / IBM Plex Mono / IBM Plex Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Gunakan jumlah dan posisi muka yang menjelaskan objek, bukan segitiga acak. UI berupa anotasi screen-space yang menunjuk vertex nyata. Jika memperlihatkan UI aplikasi 3D, tampilkan crop viewport dan pertahankan alat asli.

## Koreografi contoh pada 30 fps

F00–23 siluet sudah terlihat. F24–62 putar 15–25° sampai tepi penting menghadap kamera. F63–85 highlight face dan label masuk. F86–119 tahan tampilan 3/4. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Buat vertex, edge, dan face sekali. Proyeksikan satu matriks, urutkan muka berdasarkan kedalaman, lalu garis yang terlihat diberi opacity lebih tinggi daripada garis tersembunyi. Gunakan satu klik ketika edge dikunci.

Jika perlu musik, audisi `B09` dan palet SFX `S-DIGITAL` / `S-UMUM` sesuai isi shot.

## Uji frame

Cek bahwa objek masih bisa diidentifikasi tanpa grid. Kalau semua garis sama terang, redupkan garis belakang dan buat siluet lebih tegas.
