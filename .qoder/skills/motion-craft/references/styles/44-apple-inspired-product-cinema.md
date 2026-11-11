# Gaya #44 · Apple-Inspired Interactive Motion

Pakai aksi yang kelihatan dan respons yang bisa dijelaskan. Di film [Introducing Apple Creator Studio](https://www.apple.com/apple-creator-studio/), kata kerja, UI, dan objek saling meneruskan perhatian. Terapkan prinsip itu pada topik user. Pilih isi, logo, produk, palet, copy, dan tipografi dari brand tujuan.

## Pilih template yang bisa dirender

| Brief | Storyboard | Komponen | Koreografi |
|---|---|---|---|
| Tutorial | T101 | `AppleInteractiveTutorial` | Tujuan, klik kontrol, respons membesar, hasil ditahan. |
| Intro brand | T102 | `AppleInteractiveBrandIntro` | Janji brand, objek diseret, perubahan membesar, lockup. |
| Edukasi | T103 | `AppleInteractiveEducation` | Pertanyaan, pilih variabel, lihat akibat, tahan simpulan. |

Ketiga komponen ada di `templates/components/AppleInteractive.tsx`. Setelah menjalankan scaffold dengan #44 dan salah satu storyboard di atas, pakai `src/antislop/AppleInteractiveStarter.tsx`. Modul itu sudah memilih komponen yang benar dan memuat batas frame dari planner. Daftarkan komposisi dengan `appleInteractiveConfig` dan masukkan copy melalui `defaultProps`. Isi `visual` dengan React/SVG, UI, gambar produk, atau diagram dari aset produksi. Komponen mengurus gerak kursor, kontak, respons panel, dan perpindahan ke tampilan hasil. Untuk banyak langkah, susun beberapa rangkaian aksi dan hasil sesuai brief.

```tsx
import { Composition, staticFile } from 'remotion';
import { AppleInteractiveStarter, appleInteractiveConfig } from './antislop/AppleInteractiveStarter';

<Composition
  id="BrandIntro"
  component={AppleInteractiveStarter}
  {...appleInteractiveConfig}
  defaultProps={{
    headline: 'Pilih racikanmu.',
    actionLabel: 'Racik',
    subjectLabel: 'Biji kopi',
    resultTitle: 'Rasa yang kamu pilih.',
    closingTitle: 'Kopi Kamu',
    closingDetail: 'Diracik sesuai seleramu.',
    logoSrc: staticFile('brands/kopi-kamu.svg'),
  }}
/>
```

## Framing, timing, dan audio

- **16:9** — Pakai satu sumbu utama untuk kata kerja, area aksi, dan hasil. Pertahankan posisi bentuk panel saat ia mulai membesar.
- **9:16** — Susun teks di atas panel aksi. Jaga target dan kursor tetap di area tengah. Template menyesuaikan skala terhadap lebar serta tinggi komposisi.
- Mulai dengan bidang bersih dan satu aksen yang mengikuti brand. Token awal #44 memakai arang `#0D0E10`, bidang `#1B1D21`, tinta `#F5F5F7`, dan aksen `#8DB8FF`. Setel `palette` dan `fontFamily` sesuai brief.
- Aksi punya ancang-ancang dan titik kontak. Respons mulai tepat di titik itu. Pada shot berikutnya, panel hasil berangkat dari bentuk dan posisi akhir shot aksi. Tahan hasil supaya terbaca.
- `enableSfx` bersifat opt-in. Saat aktif, template memicu cue pada kontak dan akhir pembesaran. Scaffold menyiapkan aset audio di `public/audio/sfx/`. Musik bisa dipasang terpisah, misalnya B25. Berikan `--text` ke scaffold jika brief memerlukan panduan timing narasi.

## Kalau ada referensi video

Gunakan template sebagai komponen awal dan ikuti fungsi, framing, timing, dan sambungan dari referensi yang diberikan. Ganti visual dan gerak yang diperlukan dengan komponen Remotion kustom. Pakai referensi dan frame ekstraknya untuk analisis serta QA. Semua adegan produksi dibangun ulang dari kode dan aset independen. Untuk brief yang memang meminta reveal produk dari siluet, T004 tetap tersedia dengan pilihan eksplisit.

Periksa frame satu sebelum kontak, saat kontak, setelah respons, pada sambungan ke hasil, dan saat hold akhir. Pastikan perubahan yang dijanjikan benar-benar tampak. Beri contoh dan klaim yang sesuai fakta dari brief.
