# Gaya #26 · Terminal CLI

Terminal adalah subjek ketika perintah dan output menjelaskan hasil. Presentasikan satu sesi yang konsisten dengan platform, shell, dan lebar kolom.

## Komposisi

- **16:9** — Tempatkan terminal sebagai hero dengan judul kecil di kiri/atas. Pilih lebar yang menahan perintah terpanjang, atau wrap secara sengaja pada batas token. Gunakan gutter 40–56 px dalam jendela 1080p.
- **9:16** — Tampilkan satu perintah dan 2–4 baris output relevan, lalu pindah crop. Hindari mengecilkan seluruh desktop. Kunci prompt dan kolom log dari scene ke scene.

## Warna, huruf, dan bahan

Gunakan arang hampir hitam, teks off-white, aksen hijau fosfor atau amber jika cocok dengan terminal rujukan. JetBrains Mono 28–38 px untuk perintah dan 24–32 px untuk log. Warna galat hanya untuk galat dan selalu sertakan kata/status.

Token awal `getStyleById(26)`: kanvas `#0A0F0A`, bidang `#111A11`, tinta `#E8F0E0`, muted `#5E7A5E`, aksen `#33FF66`, aksen sekunder `#FFB000`. Font preset: JetBrains Mono / IBM Plex Mono / JetBrains Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Pilih chrome sesuai OS. Untuk terminal Linux yang tidak butuh chrome, gunakan mode polos, prompt shell yang tepat, dan output yang memang dihasilkan. Untuk installer grafis, pakai UI installer asli dan pindahkan terminal ke bagian yang memang memakai perintah.

## Koreografi contoh pada 30 fps

F00–24 baca prompt serta konteks. F25–61 ketik hanya perintah yang ditunjukkan. F62–75 keluarkan log yang menjawab aksi. F76–113 tahan hasil/exit status. Kamera diam saat teks harus dibaca. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Gunakan AuthenticTerminalWindow dengan title, cwd, dan opsi chrome yang cocok, atau komponen CSS monospaced dengan whiteSpace pre-wrap. Sisakan ruang baris agar scroll terukur. Jadwalkan suara ketik hanya selama input; output tidak mengetik sendiri.

Jika perlu musik, audisi `B09` dan palet SFX `S-DIGITAL` / `S-MEKANIK` sesuai isi shot.

## Uji frame

Lihat apakah penonton bisa menyalin satu perintah dari frame hold dan memahami hasilnya. Hilangkan lampu macOS pada UI Linux, kode dekoratif, scanline di atas glyph, dan gerak kamera saat log perlu dibaca.
