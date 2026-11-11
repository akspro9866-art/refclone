# STORYBOARD — <judul video>

Salin file ini ke `research/storyboard.md` di project Remotion, lalu isi. Kode singkatan (Cam / Out / SFX) ada di `references/storyboards/INDEX.md`. Hapus komentar `<!-- -->` setelah diisi.

## 1. Info Proyek

| Field | Isi |
|---|---|
| Judul | |
| Tujuan / pesan utama (satu kalimat) | |
| Template acuan (ID dari INDEX, bila ada) | <!-- misal T032 --> |
| Durasi total | <!-- detik --> |
| Rasio · resolusi · fps | <!-- 16:9 1920×1080 · 9:16 1080×1920 · 1:1 1080×1080 · 30 fps --> |
| Target audiens | |
| Arahan visual (grid, bahan, tipografi, warna peran) | |
| Gaya terpilih (file di `references/styles/`) | <!-- diisi setelah draw-style.mjs --> |
| Komponen atau aset yang dibutuhkan | <!-- isi jika berguna untuk isi scene --> |
| BGM · profil narator | <!-- ID B00–B39 / M01–M24 dari SOUND.md · N01–N05 --> |
| Brand / teknologi / project yang muncul | <!-- tiap item wajib lewat fetch-brand-logo.mjs --> |
| Aset user di `public/` | <!-- foto, footage, logo, data; jangan mengarang aset --> |

## 2. Tabel Scene

Detik = jendela tayang scene. Pacing asimetris: hook pendek, isi lebih panjang, penutup ringkas.

| # | Detik | Visual (hero dan bukti) | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–2 | | | HOLD | | |
| 2 | | | | | | |
| 3 | | | | | | |
| 4 | | | | | | |
| 5 | | | | | END | |

## 3. Narasi per Scene

| # | Teks narasi (opsional) | Catatan sinkronisasi |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |

## 4. Cek Frame

- [ ] Setiap scene punya satu aksi, pertanyaan, atau perubahan yang terlihat.
- [ ] Frame pembuka dan hasil sesuai rasio tujuan. Hero, label, dan subtitle terbaca di ukuran kecil.
- [ ] Gaya diterapkan pada komposisi, bahan, dan gerak. Chrome, kontrol, dan status UI sumber dipertahankan.
- [ ] Pemetaan aksi, perubahan status, dan cue audio berbagi frame kejadian. Ada waktu baca setelah aksi.
- [ ] Durasi adegan dikurangi overlap sesuai total target. Cut punya overlap nol.
- [ ] Angka, aset, dan logo diverifikasi atau diberi label ilustrasi yang jelas.
