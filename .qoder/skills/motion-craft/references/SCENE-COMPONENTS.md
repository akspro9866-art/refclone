# Komponen adegan Remotion

Scaffold menyalin modul berikut ke `src/antislop/components/`. Impor komponen dari modulnya. Mulai dari elemen yang dibutuhkan shot, lalu pilih palet, ukuran, dan timing berdasarkan brief. Untuk replikasi UI, ukur sumber atau letakkan screenshot di dalam viewport. Gunakan `style` atau `stylePreset` ketika komponen menyediakannya.

| Kategori | Modul | Komponen dan kegunaan |
|---|---|---|
| Bingkai UI | `InterfaceFrames.tsx` | `InstallerFrame` untuk wizard langkah demi langkah, `SettingsFrame` untuk sidebar pengaturan, `MobileViewport` untuk area aplikasi dengan bar opsional, `DialogFrame` untuk konfirmasi atau pesan kesalahan. |
| Interaksi layar | `ScreenActions.tsx` | `ScrollViewport` membatasi scroll ke tinggi konten, `TextSelection` menyeleksi rentang teks, `StateToggle` mengganti status tepat saat cue, `DragPath` memindahkan objek dengan tinggi lintasan opsional. |
| Teks dan caption | `EditorialText.tsx` | `MaskedTitle` membuka judul per baris, `LowerThird` menampilkan identitas pada rentang frame, `PhraseCaptions` menahan frasa utuh dengan label pembicara opsional, `CounterReadout` menginterpolasi angka dengan format dari scene. |
| Kamera dan kedalaman | `DepthShots.tsx` | `RegionZoom` mendekat ke persegi tanpa melewati tepi kanvas, `FocusMatte` meredupkan area luar target, `FocusPull` menggeser fokus antara dua lapisan, `DepthPlane` menggerakkan layer dengan amplitudo sesuai kedalaman. |
| Transisi | `SceneEdits.tsx` | `SplitWipe` membuka bidang dari empat arah, `IrisReveal` membuka lingkaran dari titik pilihan, `DipThroughColor` memotong melalui warna, `BeforeAfter` membandingkan dua tampilan yang sudah disejajarkan. |
| Latar, logo, dan ikon | `GraphicSurfaces.tsx` | `RuledPaper` menggambar garis atau grid statis, `HalftonePlate` menaruh plat titik sebagai lapisan tinta, `LogoLockup` menyusun aset logo lokal dan nama, `StrokeIcon` menggambar path SVG yang disediakan scene. |

## Memasangkan komponen ke aksi

- **Installer grafis.** Atur `InstallerFrame` sesuai struktur sumber, lalu gunakan `StateToggle` pada opsi yang berubah. Tempatkan `FocusMatte` setelah kamera atau gunakan koordinat screen-space. Tahan state hasil sampai pengguna bisa membaca.
- **Promo Risograph.** Letakkan dua `HalftonePlate` dalam mask bentuk produk dengan sudut yang berbeda. Gunakan `LogoLockup` jika aset asli tersedia. Posisikan cue cetak saat lapisan menyentuh bidang.
- **Sebelum dan sesudah.** Sejajarkan posisi gambar pada `BeforeAfter`. Tahan garis pemisah pada perbedaan yang ingin dibuktikan. Pilih `SplitWipe` jika keduanya merupakan dua shot terpisah.

Untuk komponen beranimasi, `startFrame` dan `endFrame` relatif ke `Sequence` tempat komponen dirender. Transisi menerima dua lapisan. Gunakan `Sequence` pada tiap lapisan jika kontennya punya titik awal berbeda. `PhraseCaptions` memakai milidetik relatif ke timeline tempat komponen dirender. Taruh caption dan lower third di luar transformasi kamera. Komponen di tabel ini bersifat visual. Pasang audio pada frame kejadian yang dipilih.
