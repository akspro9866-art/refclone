# Gaya #19 · Papercut Berlapis

Bangun dunia dari lapisan kertas yang ujungnya bisa dilihat. Kedalaman datang dari jumlah lapisan, lipatan, dan bayangan kontak.

## Komposisi

- **16:9** — Susun latar dua lapis, hero di depan, dan satu strip yang membingkai informasi. Offset lembar yang menutup hero hanya 6–12 px sehingga siluet tetap utuh.
- **9:16** — Gunakan satu potongan penuh di depan dan dua lembar yang terangkat dari bawah. Biarkan copy berada pada satu bidang kertas lapang.

## Warna, huruf, dan bahan

Kertas krem, tinta gelap, terakota untuk lapisan fokus, teal untuk pembeda. Bricolage Grotesque 62–86 px untuk judul, Fredoka 30–38 px untuk bacaan. Gunakan cahaya kiri atas dengan jarak shadow sebanding tinggi lipatan.

Token awal `getStyleById(19)`: kanvas `#F6EBD9`, bidang `#FFF8EE`, tinta `#264653`, muted `#5C7680`, aksen `#E76F51`, aksen sekunder `#2A9D8F`. Font preset: Bricolage Grotesque / Fredoka / DM Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Kemasan atau benda asli bisa masuk sebagai bentuk kertas yang mengikuti siluetnya. Untuk UI penting, buat cutout di sekitar crop asli dan taruh kertas hanya sebagai frame luar.

## Koreografi contoh pada 30 fps

F00–20 latar dan hero datar. F21–54 buka flap dari satu engsel. F55–80 lapisan kedua mengisi bagian yang terungkap. F81–113 tahan hasil sebelum satu cut kertas ke scene berikutnya. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Bangun setiap potongan sebagai path SVG tertutup; beri shading kecil sepanjang tepi. Gunakan transform-origin di lipatan dan shadow arah tetap. Bunyi geser kertas hanya ketika lembar bergesekan.

Jika perlu musik, audisi `B08` dan palet SFX `S-KERTAS` / `S-ORGANIK` sesuai isi shot.

## Uji frame

Periksa ruang antarlembar pada frame diam. Jika kelihatan seperti sejumlah kartu melayang, rapatkan bayangan ke tepi dan buat variasi bentuk yang berasal dari objek.
