# Gaya #11 · Neo-Brutalism

Pakai tata letak poster yang tegas dengan bidang datar dan keputusan ukuran yang berani. Struktur visual terasa seperti objek dicetak, bukan tumpukan kartu aplikasi.

## Komposisi

- **16:9** — Beri judul besar rata kiri pada dua kolom, dan satu bukti visual yang bisa membentang penuh di sisi kanan. Garis pembatas 3–5 px juga menjadi sumbu transisi.
- **9:16** — Susun judul, bukti, dan CTA di atas satu sumbu kiri. Sisakan margin 7%; buat satu bidang menabrak tepi pada beat penekanan.

## Warna, huruf, dan bahan

Gunakan kuning sebagai lapangan warna, hitam untuk teks, dan satu dari koral atau mint untuk aksi. Archivo Black 88–122 px untuk judul; Space Mono 25–30 px untuk label kecil. Shadow offset 6–8 px dipakai hanya jika satu objek perlu terasa di atas kertas.

Token awal `getStyleById(11)`: kanvas `#FFDE59`, bidang `#FFFFFF`, tinta `#111111`, muted `#333333`, aksen `#FF6B6B`, aksen sekunder `#7DF9AA`. Font preset: Archivo Black / Space Mono / Space Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Pertahankan fungsi button, input, dan label ketika menata UI buatan sendiri. Pada UI produk asli, gunakan outline dan blok warna di panggung; jangan memaksa border tebal ke dalam screenshot.

## Koreografi contoh pada 30 fps

F00–20 judul potong masuk dan langsung terbaca. F21–48 bidang bukti bergeser lalu mengunci ke garis. F49–75 ubah satu fakta atau tindakan. F76–109 tahan copy. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Pakai border CSS dan transform translasi per elemen. Untuk press, geser target 4 px searah shadow dan kurangi offset pada frame klik. Hindari spring berkali-kali setelah objek sudah terkunci.

Jika perlu musik, audisi `B09` dan palet SFX `S-DIGITAL` / `S-KERTAS` sesuai isi shot.

## Uji frame

Lihat apakah headline dan satu bukti masih dominan pada ukuran kecil. Kalau setiap elemen punya border dan bayangan sama berat, lepaskan border dari elemen pendukung.
