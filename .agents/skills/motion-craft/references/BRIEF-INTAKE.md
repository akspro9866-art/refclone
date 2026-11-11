# Brief intake sebelum produksi

## Alur percakapan

1. Baca prompt, jawaban sebelumnya, brand guide, dan metadata referensi yang sudah diperiksa. Petakan keputusan yang sudah jelas. Jangan menanyakan ulang.
2. Jika topik belum ada, tanyakan topik dahulu. Berikan satu ide konkret yang sesuai konteks user. Setelah topik dijawab, buat rekomendasi lain berdasarkan ide tersebut.
3. Tanyakan hanya bagian yang belum terjawab. Kelompokkan 1–3 pertanyaan per giliran, sesuai kapasitas host. Durasi, rasio, resolusi, fps, gaya visual, dan gerak harus jelas. Tujuan, penonton, bahasa, aset/brand/referensi, serta musik/SFX/narasi juga perlu keputusan, termasuk keputusan eksplisit tanpa audio/aset.
4. Setiap pertanyaan memiliki dua jalur: **Saran agen (Rekomendasi)** dengan nilai konkret dan alasan singkat, serta **Tulis sendiri** untuk jawaban bebas. Contoh resolusi: “1080 × 1920, cocok untuk Reels” atau jawaban sendiri. Jangan menawarkan daftar gaya acak atau mengisi sendiri lalu menganggap user setuju.
5. Gunakan alat pertanyaan interaktif jika tersedia dan didukung mode aktif. Jika host sudah menyediakan input Other/custom, gunakan itu sebagai jalur Tulis sendiri; jangan menduplikasinya. Jika API tidak mendukung susunan dua jalur tersebut, gunakan dua opsi dalam chat. Jangan mengklaim label UI dapat dipaksa atau mode aplikasi berubah menjadi Plan.
6. Tunggu jawaban. Timeout, dismissed, input kosong, full permission, atau saran agen bukan persetujuan. Jangan mulai storyboard produksi, scaffold, coding, atau render selama keputusan yang dibutuhkan masih kosong. Boleh membaca aset/referensi untuk memperjelas pertanyaan.
7. “Sisanya bebas/pilihkan” merupakan delegasi hanya untuk bagian yang disebut atau tersisa. Isi nilai konkretnya berdasarkan konteks dan catat kutipan delegasi. Brief lengkap boleh langsung lanjut tanpa pertanyaan seremonial. Untuk revisi, gunakan kembali brief lama dan tanyakan hanya perubahan yang ambigu.
8. Ringkas keputusan, simpan brief terstruktur, lalu jalankan planner. Jangan mengarang kutipan user atau mencatat rekomendasi yang belum dipilih sebagai keputusan.

## Contoh adaptif

- “Buatkan saya video motion graphics” → tanya ide konten dahulu, lalu detail tersisa.
- “Tutorial Git 30 detik untuk Reels gaya Apple” → simpan topik, durasi, rasio 9:16, gaya #44; tanyakan hanya detail tersisa. Reels menentukan rasio, bukan otomatis resolusi atau fps.
- “Pakai resolusi dan fps referensi” → periksa metadata, simpan hasil beserta sumber. Jika referensi tidak dapat dibaca, tanyakan.
- “Buat tutorial Ubuntu” → pastikan versi/platform dan GUI atau CLI sebelum menggambar prosedur. Tambahkan konteks itu ke topic.
- Replikasi/adaptasi → pastikan referensi serta elemen yang dipertahankan/diganti. Analisis video sebagai acuan; jangan menimpa video sumber dengan komponen sebagai hasil rekonstruksi.

## Kontrak CLI

Keempat entry point `plan-motion.mjs`, `scaffold-remotion.mjs`, `draw-style.mjs`, dan `scenes.mjs` memerlukan `--brief-file resolved-brief.json`. Brief tanpa file tidak menghasilkan output. File parsial melaporkan field yang belum selesai. Flag lama masih diterima tetapi tidak boleh bertentangan dengan brief.

Gunakan objek `decisions`. Setiap field berisi `{ "value": ..., "source": "user|inferred|delegated", "evidence": "kutipan atau sumber keputusan" }`.

Field wajib:

| Field | Nilai |
|---|---|
| topic | Subjek dan konteks/prosedur spesifik |
| goal, audience | Tujuan dan penonton |
| duration | Detik, angka positif |
| aspect | 16:9, 9:16, atau 1:1 |
| width, height | Resolusi pixel, integer positif sesuai rasio |
| fps | Angka positif, termasuk fractional fps |
| styleId | ID gaya 1–44 yang dipilih/disepakati |
| motion | Arah gerak, interaksi, pacing |
| audio | Musik, SFX, narasi, atau tanpa audio |
| assets | Aset/brand/referensi atau keputusan tanpa aset eksternal |
| language | Bahasa konten atau tanpa teks |

Contoh satu keputusan: `"fps": {"value":30,"source":"user","evidence":"Pakai 30 fps"}`. `inferred` hanya untuk implikasi jelas seperti Reels → 9:16 atau metadata referensi yang diminta. `delegated` harus menyertakan instruksi delegasi user. Jangan memakai satu nilai placeholder untuk seluruh brief produksi.

```bash
node "<skill>/scripts/plan-motion.mjs" --brief-file resolved-brief.json --out research
node "<skill>/scripts/scaffold-remotion.mjs" --brief-file resolved-brief.json --target project
```

Planner menyimpan seluruh keputusan dan dimensi ke `scenes-plan.json`. Terapkan width/height/fps/durationInFrames ke Composition; starter Apple mengambil dimensi langsung dari plan. Audio dan aset adalah arahan produksi yang harus diterapkan agen, bukan janji bahwa scaffold mengimplementasikan semua pilihan secara otomatis. Scaffold menyediakan WAV sebagai bahan; jangan memasang audio ketika brief meminta hening.

Validasi CLI memeriksa kelengkapan dan konsistensi nilai. Ini bukan autentikasi persetujuan user. Kepatuhan bertanya tetap bergantung pada agen dan instruksi host. Tidak ada flag bypass produksi; pengujian memakai fixture lengkap yang secara eksplisit ditandai sintetis.
