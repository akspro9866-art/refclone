# Gaya #05 · Topografi

Bangun peta yang bisa dibaca. Kontur mengungkap bentuk medan, rute menunjukkan keputusan, dan legenda menjelaskan satuan.

## Komposisi

- **16:9** — Pakai sekitar 72% frame untuk peta dari atas. Kolom kecil berisi nama rute, jarak atau elevasi, dan legenda dengan bentuk berbeda. Label menghadap penonton meski medan dimiringkan.
- **9:16** — Ikuti satu jalur utama dari bawah ke atas. Letakkan titik awal dan akhir dalam frame resolusi, lalu tampilkan profil elevasi tipis dengan sumbu yang sama.

## Warna, huruf, dan bahan

Kertas pucat untuk dasar, kontur cokelat tipis, hijau tua untuk label, dan garis rute merah tebal 5–7 px. Air biru hanya jika datanya ada. EB Garamond 52–68 px untuk nama lokasi; DM Mono 23–28 px untuk ketinggian, jarak, dan skala.

Token awal `getStyleById(5)`: kanvas `#EFE8D6`, bidang `#E4DBC4`, tinta `#2F5D50`, muted `#7B4B2A`, aksen `#D1432B`, aksen sekunder `#3E7CB1`. Font preset: EB Garamond / DM Mono / DM Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Gunakan geometri dan nama tempat dari aset/data yang disediakan. Tandai peta skematis sebagai ilustrasi; hindari elevasi atau jarak rekaan yang tampil sebagai fakta. Jika merekam UI peta asli, biarkan peta sumber bekerja dan tambahkan legenda di luarnya.

## Koreografi contoh pada 30 fps

F00–22 baca orientasi. F23–61 garis rute muncul mengikuti perjalanan aktual. F62–86 pindah ke profil hanya saat ketinggian penting. F87–118 tahan posisi akhir dengan skala. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Gambar garis kontur dari jalur elevasi atau path rancangan yang konsisten, bukan cincin konsentris acak. Pakai strokeDashoffset untuk rute dan parameter path yang sama untuk penanda. Hilangkan suara langkah pada peta yang sedang diam.

Jika perlu musik, audisi `B10` dan palet SFX `S-KERTAS` / `S-UMUM` sesuai isi shot.

## Uji frame

Rute harus tetap jelas saat warna diubah menjadi abu-abu. Periksa garis kontur, garis rute, titik akhir, satuan, dan orientasi bisa dibedakan.
