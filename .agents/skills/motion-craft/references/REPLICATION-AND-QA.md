# After Effects to Remotion Reference, Reference Matching, & QA Standards

Dokumen teknis untuk **Pemetaan Konsep After Effects ke Remotion**, **Prosedur Mode Replikasi 100% (`SSIM` / `PSNR`)**, dan **Standar Quality Assurance (QA)** sebelum video diserahkan.

---

## 1. Terjemahan Istilah After Effects ke Remotion

Berpikirlah dengan presisi artist After Effects, lalu terjemahkan ke arsitektur Remotion:

| Konsep After Effects | Implementasi di Remotion (`motion-craft`) |
|---|---|
| **Composition / Precomp** | `<Composition />` di `Root.tsx`, atau komponen scene yang dibungkus `<SeamlessSceneShell />` |
| **Layer & In/Out Timeline** | `<AbsoluteFill />` dengan `<Sequence from={...} durationInFrames={...} />` |
| **Keyframe Linear / Clamped** | `ip(frame, [f0, f1], [v0, v1], easing)` (`interpolate` dengan clamp kiri & kanan) |
| **Graph Editor / Easy Ease** | `easeOutExpo` (`Easing.bezier(0.16, 1, 0.3, 1)`), `easeInOutSmooth` (`Easing.bezier(0.45, 0, 0.15, 1)`), `springAt()` |
| **Smooth Camera Rig & Null Object** | `splineAt(frame, CAM)` (C1 Catmull-Rom / Cubic Hermite Spline) di dalam `<CameraRig />` |
| **Overlapping Action / Follow-Through** | `staggeredSpringAt(frame, baseStart, layerIndex)` |
| **Subtle Wiggle / Breathing Hold** | `microBob(frame, index, amplitude, speed)` (fase berbeda tiap elemen saat hold) |
| **Motion Blur (Shutter Angle)** | `splineVelocityAt(frame, CAM)` pada `<CameraRig enableVelocityBlur />` |
| **Camera Depth / Rack Focus** | `<CameraRig enableRackFocusSpotlight />` + `<ParallaxLayer depth="background" \| "midground" \| "foreground" />` |
| **Shape Layer & Trim Paths** | SVG inline dengan `strokeDasharray` & `strokeDashoffset` (`<CustomSVGIcon />`) |
| **Track Matte / Mask Reveal** | CSS `clip-path`, `overflow: 'hidden'`, atau SVG `<mask>` |
| **Text Animator (Per-Char)** | `<TypeText humanizeCadence />` (ketikan per karakter) & `<FlyText />` (spring fly-in per karakter) |
| **Bottom Subtitle / Caption Track** | `<BottomSubtitleBar words={...} />` di ruang layar bawah (*screen-space*) |
| **Render Queue** | `npx remotion render <CompId> out/v1.mp4` |

---

## 2. Mode Replikasi Referensi (Target Frame-Exact)

### Pemicu
Aktif ketika user memberikan video referensi dan meminta hasil yang **identik** (*"100% sama"*, *"persis"*, *"clone"*, *"replikasi"*).
*(Jika user hanya meminta "terinspirasi" atau "gaya mirip", ambil prinsip gerak dan gayanya saja, bukan pikselnya).*

### Prosedur Teknis 7 Langkah

1. **Bedah Spesifikasi Teknis (`ffprobe`):**
   Ambil resolusi, fps, durasi total frame, codec, dan stream audio dari video referensi:
   ```bash
   ffprobe -v error -show_streams -show_format ref.mp4
   ```
2. **Ekstrak Frame Referensi & Deteksi Scene Cut (`ffmpeg`):**
   ```bash
   mkdir -p frames/ref
   ffmpeg -i ref.mp4 -fps_mode passthrough frames/ref/%05d.png
   ```
3. **Inventaris Elemen & Koordinat per Frame:**
   Catat frame mulai/selesai, posisi `(x, y)`, ukuran `(w, h)`, rotasi, opacity, sampel warna hex piksel asli (bukan tebakan mata), ukuran font, radius sudut, dan bayangan.
4. **Rekonstruksi Kurva Kamera C1 Spline (`splineAt`):**
   Ukur koordinat elemen pada frame-frame kunci, lalu susun array waypoint `[frame, scale, tx, ty, rotDeg]` di `splineAt(frame, CAM)` hingga lintasan gerak menempel frame-ke-frame.
5. **Bangun di Remotion:**
   Gunakan `width`, `height`, `fps`, dan `durationInFrames` yang **sama persis** dengan video referensi.
6. **Verifikasi Kuantitatif (`SSIM` & `PSNR`) dan Visual Diff:**
   ```bash
   npx remotion render <CompId> out/video.mp4
   ffmpeg -i out/video.mp4 -i ref.mp4 -lavfi "[0:v][1:v]ssim=stats_file=ssim.log" -f null -
   ffmpeg -i out/video.mp4 -i ref.mp4 -lavfi "[0:v][1:v]psnr=stats_file=psnr.log" -f null -
   ffmpeg -i out/video.mp4 -i ref.mp4 -filter_complex "[0:v][1:v]blend=all_mode=difference" diff.mp4
   ```
   Cari frame dengan skor terendah di `ssim.log`, perbaiki koordinat/easing/warnanya, lalu render ulang sampai selisih mendekati nol (untuk elemen vektor/UI, target `SSIM` per frame mendekati `1.0`).
7. **Laporan Jujur:**
   Sertakan skor rata-rata dan minimum `SSIM` serta `PSNR`, plus catatan jujur bila ada aset eksternal (foto/font berbayar) yang diganti atas persetujuan user.

---

## 3. Cek Tampilan Sebelum Serah

1. **Hierarki dan bukti.** Periksa frame pembuka, aksi utama, transisi, dan hasil pada resolusi akhir dan preview kecil. Subjek dan tindakan harus jelas. Bandingkan dengan panduan gaya: material, komposisi, tipografi, dan mekanisme geraknya harus tampak pada hasil.
2. **Keterbacaan.** Cek teks terkecil, kontras aktual, batas crop, dan tabrakan subtitle/overlay. UI harus menunjukkan nama kontrol, status, dan brand yang benar. Benda fisik harus tetap dikenali dari siluet dan proporsinya.
3. **Kamera dan editing.** Scrub sebelum/sesudah setiap cut. Posisikan kamera diam pada beat baca. Periksa kontinuitas arah, posisi shared element, serta titik masuk SFX.
4. **Audio dan durasi.** Putar hasil utuh. Cocokkan narasi dengan kata dan aksi. Tinjau interval diam/beku sesuai brief. Jika ada target loudness, ukur level terpadu dan true peak pada file hasil.
5. **Bukti uji.** Lulus lint, catat frame sampel dan temuan visual, lalu jalankan QA video/geometri bila pengukuran tersedia. Catat apa yang masih PARTIAL. Jika ada referensi, tampilkan perbandingan pada frame dengan selisih terbesar.

## 4. Cakupan QA dan Geometri yang Diukur

Aturan prioritas dalam SKILL.md mengungguli default di dokumen ini. Hold diam dan jeda audio boleh jika disengaja sesuai brief/referensi. Tinjau temuan detector, lalu gunakan `--allow-freeze` / `--allow-silence` hanya untuk kejadian yang sudah ditinjau. Kegagalan FFmpeg, file hilang, atau sumber kosong harus menjadi FAIL, bukan dilewati.

`inspect-motion.mjs` tidak mengukur DOM secara otomatis. `--geometry` menerima JSON dari pengukuran bounding box DOM pada frame render atau pengukuran frame hasil render. Gunakan koordinat **screen-space piksel setelah kamera/rotasi/scale**, bukan koordinat lokal layer. Untuk objek berotasi, gunakan axis-aligned bounding box hasil transform. Catat semua hero, teks penting, tombol fokus dan subtitle di frame awal/akhir, extrema kamera, serta sekitar setiap transisi.

```json
{
  "width": 1920,
  "height": 1080,
  "samples": [{
    "frame": 50,
    "subtitleRect": {"x": 120, "y": 930, "width": 1680, "height": 100},
    "objects": [{"id": "hero", "x": 240, "y": 140, "width": 1440, "height": 720}]
  }]
}
```

Objek wajib harus berada di viewport dan tidak overlap subtitle. `required: false` hanya untuk dekorasi atau elemen keluar layar yang memang disengaja saat transisi. Sampel/objek wajib kosong adalah kegagalan. Pemeriksaan hanya membuktikan rectangle yang diberikan, bukan kebenaran pengukuran atau seluruh frame video. PASS otomatis tetap membutuhkan tinjauan visual. Gunakan `--require-complete` pada delivery gate: PARTIAL menghasilkan exit code 2, FAIL menghasilkan 1, dan pemeriksaan lengkap yang lulus menghasilkan 0.

## 5. Evaluasi Video Nyata dan Batas Klaim

`run-evals.mjs` menguji regresi skrip dan kontrak template. Prompt di `evals/evals.json` harus dikerjakan secara terpisah untuk menilai hasil agen. Catat prompt, model, komposisi, output video, dan hasil tinjauan; jangan menyebut ketiga skenario berhasil hanya karena tes skrip lulus.

```bash
node scripts/evaluate-video.mjs --project /path/to/remotion-project --comp MainVideo --width 1920 --height 1080 --fps 30 --frames 360
# Atau evaluasi render yang sudah ada:
node scripts/evaluate-video.mjs --project /path/to/remotion-project --video out/v1.mp4 --width 1920 --height 1080 --fps 30 --frames 360 --reference ref.mp4 --min-ssim 0.95
```

Evaluator merender komposisi jika `--video` tidak diberikan, memeriksa metadata aktual, lalu opsional menghitung SSIM seluruh frame. Referensi wajib sama resolusi, fps, dan jumlah frame; sejajarkan offset waktu, PTS, color space, serta pixel aspect ratio sebelum perbandingan. Jangan diam-diam meregangkan referensi agar cocok. `out/evaluation/result.json` mencatat hasil; `ssim.log` memuat skor frame. Ambang minimum berlaku untuk **setiap frame**, agar satu scene buruk tidak tersembunyi oleh rata-rata tinggi.

SSIM/PSNR bukan persentase kemiripan artistik. Codec, font rasterization, dan warna memengaruhi skor; skor tinggi tidak membuktikan cerita, audio, atau detail brand benar. Laporkan penggantian aset dan hasil tinjauan manual bersama metrik. Semua klaim LUFS/true peak tetap memerlukan pengukuran loudness terpisah; inspector tidak memeriksanya.
