# Gaya #09 · Comic Book

Gunakan panel komik untuk mengatur urutan sebab-akibat. Sudut pandang berbeda memberi penekanan, garis panel membentuk alur baca.

## Komposisi

- **16:9** — Buka dengan panel establishing lebar, lalu potong ke satu panel aksi dekat dan satu panel reaksi kecil. Gutter krem minimal 18 px pada frame 1080p agar panel tidak menyatu.
- **9:16** — Susun tiga panel vertikal dan ungkapnya bergantian. Buka panel aksi dari sudut bawah dan tahan panel reaksi dengan ruang kosong untuk dialog.

## Warna, huruf, dan bahan

Tinta hitam padat, merah untuk impact, kuning untuk satu aksen akibat. Bangers 72–100 px untuk kata aksi pendek; Comic Neue 28–38 px untuk dialog. Letakkan halftone pada satu bidang bayangan berukuran besar.

Token awal `getStyleById(9)`: kanvas `#FFF8E7`, bidang `#FFFFFF`, tinta `#111111`, muted `#4A4A4A`, aksen `#E4002B`, aksen sekunder `#FFDE00`. Font preset: Bangers / Comic Neue / Space Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Gunakan gelembung dialog untuk ucapan yang sumbernya jelas. Replika UI boleh muncul sebagai inset bukti; balon dialog tetap di luar elemen interaktif.

## Koreografi contoh pada 30 fps

F00–26 establishing, F27–32 potong keras saat aksi, F33–63 tahan pose aksi dengan satu garis arah, F64–104 panel reaksi dan satu jeda komedi. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Buat panel dengan CSS grid atau clipPath diagonal ringan. Mask garis laju hanya dalam panel aksi. Tulis efek bunyi singkat kalau suara itu memang terjadi; satu impact cukup untuk satu benturan.

Jika perlu musik, audisi `B22` dan palet SFX `S-KOMIK` / `S-UMUM` sesuai isi shot.

## Uji frame

Mata harus berpindah panel dengan urutan yang sama saat frame diam. Jika halftone atau garis laju menyentuh teks dialog, pangkas mask.
