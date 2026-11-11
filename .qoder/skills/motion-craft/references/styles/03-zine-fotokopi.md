# Gaya #03 · Zine Fotokopi

Susun halaman seperti lembar fotokopi yang benar-benar disunting: satu judul kasar, satu foto kontras tinggi, dan satu informasi yang bisa dibaca cepat.

## Komposisi

- **16:9** — Tempel foto utama dari kiri bawah hingga melewati garis lipat. Sisakan kolom kanan bersih untuk tanggal, tempat, atau pernyataan. Miringkan potongan foto maksimal 4°, sementara informasi sejajar tepi halaman.
- **9:16** — Naikkan judul jadi dua baris, letakkan potongan foto di bawah, lalu data di satu strip kertas utuh. Pertahankan bidang kosong di sekeliling data.

## Warna, huruf, dan bahan

Pilih satu spot ink, pink atau lime, untuk stempel yang penting. Pakai Anton 82–116 px untuk judul, Special Elite atau sans netral 28–36 px untuk bacaan. Beri satu tepi sobek dan toner yang menebal pada area foto. Kertas tetap hangat, hitam tetap pekat.

Token awal `getStyleById(3)`: kanvas `#EFECE6`, bidang `#F8F4EA`, tinta `#111111`, muted `#555555`, aksen `#FF4F9A`, aksen sekunder `#C6F500`. Font preset: Anton / Special Elite / Space Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Screenshot bisa dijadikan bukti cetak, tetapi jangan halftone teks yang perlu dibaca. Kalau menggunakan kutipan, pisahkan blok kutipan dan sumber dari foto supaya penonton bisa menautkannya.

## Koreografi contoh pada 30 fps

F00–16 judul turun pendek seperti selembar kertas. F17–46 dua potongan dirapatkan dengan jump cut dan satu bunyi staples. F47–72 stempel informasi masuk. F73–110 tahan kertas diam. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Gunakan clipPath polygon untuk tepi sobek dengan jumlah titik terbatas dan posisi tetap. Halftone foto sebagai lapisan masking; batasi pergeseran register ke satu spot ink di luar teks.

Jika perlu musik, audisi `B05` dan palet SFX `S-KERTAS` / `S-JALANAN` sesuai isi shot.

## Uji frame

Lihat frame pada ukuran ponsel. Jika tanggal tenggelam dalam toner atau semua potongan miring, rapikan kolom data dan sisakan tekstur pada foto.
