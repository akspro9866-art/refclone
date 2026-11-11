# Gaya #21 · Mid-Century 70-an

Bentuk adegan seperti poster perjalanan atau iklan cetak: massa warna lebar, siluet yang ramah, dan huruf display dengan ritme.

## Komposisi

- **16:9** — Gunakan dua bidang blok besar: satu tempat hero dan satu tempat copy. Benda, furnitur, atau kemasan boleh punya outline satu sisi untuk menunjukkan bentuk, dengan baseline panggung jelas.
- **9:16** — Tempatkan headline sebagai header poster, hero besar di tengah, dan satu baris keterangan. Pindahkan lingkaran/arch agar menyokong siluet, bukan menutupnya.

## Warna, huruf, dan bahan

Krem dan cokelat sebagai dasar, terakota untuk bidang utama, mustard untuk cahaya, olive sebagai detail kecil. Shrikhand 72–102 px untuk judul; DM Serif Display 30–42 px untuk keterangan pendek. Tahan grain satu lapis tipis.

Token awal `getStyleById(21)`: kanvas `#F2E8D5`, bidang `#FFF8EA`, tinta `#4A2C1A`, muted `#6B7A3A`, aksen `#D4572A`, aksen sekunder `#E1A730`. Font preset: Shrikhand / DM Serif Display / DM Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Gunakan motif yang memang terkait subjek, misalnya setengah lingkaran seperti piring atau lengkung kanopi. UI asli masuk sebagai bukti terpisah jika konten membutuhkannya.

## Koreografi contoh pada 30 fps

F00–24 buka judul dan siluet. F25–54 wipe melingkar dari satu arch. F55–82 detail hero maju satu langkah, F83–113 tahan poster utuh. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Gabungkan bentuk SVG datar dan path lengkung. Pakai satu wipe dengan mask berbentuk arch; diamkan background dan gerakkan hanya objek yang menjelaskan pesan. Pakai bunyi mekanik lembut jika transisi terasa seperti pindah cetakan.

Jika perlu musik, audisi `B16` dan palet SFX `S-KERTAS` / `S-MEKANIK` sesuai isi shot.

## Uji frame

Cek perbandingan massa warna, siluet dan headline. Jika muncul pola bunga/boomerang yang tidak terikat subjek, ganti dengan bentuk benda atau material.
