# Gaya #18 · Blueprint

Tampilkan gambar kerja yang menjawab pertanyaan ukuran atau cara rakit. Setiap garis membantu membedakan kontur, ukuran, sambungan, atau pandangan potong.

## Komposisi

- **16:9** — Gunakan bidang gambar di 8 dari 12 kolom. Tambahkan satu detail potong di kanan dan satu blok judul kecil dengan satuan/revisi jika tersedia. Sisakan margin lebar dari garis ukur ke objek.
- **9:16** — Susun pandangan utama di atas dan detail potong di bawah. Ambil satu dimensi pada tiap beat, lalu tampilkan ringkas keduanya di frame hasil.

## Warna, huruf, dan bahan

Biru tinta sebagai dasar, putih biru untuk kontur, biru muda untuk garis bantu. Kuning hanya untuk titik yang sedang diukur. IBM Plex Mono 56–72 px untuk judul dan 24–30 px untuk ukuran; gunakan angka tabular.

Token awal `getStyleById(18)`: kanvas `#1A4E8A`, bidang `#123A6B`, tinta `#EAF2FF`, muted `#8EB4E3`, aksen `#FFD60A`, aksen sekunder `#FF6B35`. Font preset: IBM Plex Mono / Architects Daughter / IBM Plex Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Jika dimensi belum diketahui, pakai label skematis atau nama bagian. Saat memperlihatkan UI CAD, pertahankan nomenklatur dan panel nyata; gambar ulang hanya bidang yang perlu dibesarkan.

## Koreografi contoh pada 30 fps

F00–22 tampilkan siluet. F23–52 tarik garis ukur dari extension line ke ujung panah. F53–77 buka satu section dengan hatch terbatas. F78–116 tahan nilai dan satuan. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Susun tiga kelas stroke SVG untuk kontur, proyeksi, dan dimensi. Gunakan marker arrowhead pada garis ukur dan clipPath pada hatching. Kunci ukuran label terhadap kamera jika blueprint diperbesar.

Jika perlu musik, audisi `B10` dan palet SFX `S-MEKANIK` / `S-KERTAS` sesuai isi shot.

## Uji frame

Cek arah kedua panah mengukur bagian yang dimaksud. Tutup grid sementara; gambar harus tetap berfungsi, dan angka tidak boleh hanya jadi hiasan.
