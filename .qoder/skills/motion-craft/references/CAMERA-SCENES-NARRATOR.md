# Framing, kamera, transisi, dan caption

## Framing dan area aman

Komposisikan untuk ukuran pengiriman. Mulai dari margin 5–7% pada landscape dan 7–10% pada vertikal, lalu sesuaikan dengan area overlay platform dan aset sumber. Untuk UI yang padat, pilih crop aksi yang masih menunjukkan konteks. Jangan memperkecil desktop penuh sampai kontrol tak terbaca.

Letakkan caption, scorebug, dan anotasi yang perlu diam di screen-space. `BottomSubtitleBar` memakai teks stabil dengan outline, ukuran proporsional terhadap kanvas, dan offset bawah yang dapat diubah. Atur `fontSize`, `bottomOffset`, dan `maxWordsPerLine` pada footage terang, layout vertikal, atau lower third yang sudah ada. Sediakan ruang sesuai caption yang benar-benar dirender; video tanpa caption bisa memakai ruang itu.

## Kamera sesuai aksi

| Kebutuhan | Gunakan | Verifikasi |
|---|---|---|
| Membaca teks, peta, log, atau data | `CameraRig mode="calm-steady"` atau kamera tetap | Teks, pointer, dan grid tetap tajam dan diam saat hold |
| Menunjukkan kontrol kecil | Crop lebih dulu, atau `waypoints` dengan push pendek lalu hold | Target klik dan label berada dalam frame yang sama |
| Mengikuti aksi sungguhan | `buildTypingCameraSpline` atau `buildCursorFollowCameraSpline` bila layar harus bergeser | Ujung kursor tepat pada kontrol saat status berubah |
| Menunjukkan ruang/lapisan | Gerakkan objek atau gunakan parallax dan orbit yang searah dengan bentuk | Siluet dan ruang negatif tetap terbaca, label tidak ikut miring tanpa alasan |

Waypoints `[frame, scale, tx, ty, rotDeg]` bertambah urut; ulangi posisi untuk hold. `splineAt` menjaga gerak halus di antara fokus. Default kamera tidak menambahkan blur, spotlight, atau kuantisasi. Nyalakan efek opt-in jika diinginkan untuk shot tertentu. Ukur geometri setelah transformasi.

## Sambungan antarscene

- **Cut** untuk pergantian informasi atau sudut yang jelas. Pakai overlap nol.
- **Match cut / morph** ketika ada bentuk atau objek yang sama. Cocokkan posisi, ukuran, dan orientasi di sambungan. `SharedElementMorph` membantu interpolasi bentuk yang sama.
- **Whip/glide** ketika arah gerak berlanjut. `SeamlessSceneShell` dapat mengatur perpindahan masuk/keluar pada overlap. Pasang `enterOverlapFrames` dan `exitOverlapFrames` dari plan. `endFrame` adalah frame pertama di luar scene. Gunakan SFX transisi hanya ketika cue dibutuhkan.
- **Sheet atau portal** ketika panel membuka ruang berikutnya atau objek memang menjadi pintu transisi. Batasi glow jika mengganggu detail. Baca panduan gaya yang terpilih untuk mekanisme gerak dan hold.

Scrub sebelum, saat, dan sesudah sambungan. Satu frame kosong, teks tertutup, atau dua objek yang seharusnya sama muncul ganda perlu diperbaiki sebelum render akhir.

## Narasi

Sediakan timestamp dari batas kata TTS atau alignment audio. `N01`–`N05` adalah opsi profil di `scripts/narrator-sync.mjs`. Cek sumber waktu di `words.json.meta.json`. Saat tidak ada narasi, pilih label atau callout singkat yang mengikuti konten.
