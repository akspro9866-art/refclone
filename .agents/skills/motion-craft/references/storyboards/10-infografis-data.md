# Storyboard 10 — Infografis & Data (T091–T100)

Mulai dari pertanyaan, grafik yang menjawabnya, dan sumber data. Pertahankan unit, skala, dan baseline. Gunakan sorotan langsung serta hold baca. Tampilkan peta/proses sebagai skematis bila disederhanakan.

Kode kamera, transisi, dan SFX ada di [INDEX.md](INDEX.md). Durasi, rasio, dan cue pada tabel adalah acuan yang bisa diadaptasi untuk brief dan panduan gaya yang terpilih.

---

### T091 · Statistik Tahunan (Big Number)
durasi 20s · 16:9 · gaya "data-forward, tipografi raksasa, satu aksen warna" · bgm B27 · komponen: `<BentoGridReveal />`, `<ExplodeToGrid />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Judul dan tahun data | mask reveal | HOLD | MC | — |
| 2 | 3–8 | Angka utama raksasa dengan satuan dan label | counter naik `easeInOutSmooth` | HOLD | WGL | data-reveal |
| 3 | 8–13 | Dua angka pendukung berdampingan | counter stagger | HOLD | WGU | data-reveal |
| 4 | 13–17 | Perubahan dibanding tahun lalu (delta dan arah panah fungsional) | counter delta + panah SVG | PUSH | PZI | pop-plop |
| 5 | 17–20 | Sumber data dan `<BrandLogo />` | hold | HOLD | END | confirm-glass |

### T092 · Perbandingan A vs B
durasi 20s · 16:9 · gaya "dua sisi tegas, garis tengah, tipografi besar" · bgm B26 · komponen: `<CardFlip3D />`, `<BentoGridReveal />`, `<LayoutMorphGridToCarousel />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Layar terbelah dua, nama A (kiri) dan B (kanan) | garis tengah draw-on, nama mask | HOLD | MC | pop-in |
| 2 | 3–8 | Kriteria 1: nilai A dan B sebagai angka besar | counter stagger | HOLD | WGU | data-reveal |
| 3 | 8–13 | Kriteria 2 dengan tata letak sama | stagger sama | HOLD | WGU | data-reveal |
| 4 | 13–17 | Kriteria 3 dan pemenang tiap kriteria disorot lewat kontras | highlight kontras | PUSH | PZI | pop-plop |
| 5 | 17–20 | Ringkasan: kapan memilih A dan kapan B | mask reveal | HOLD | END | confirm-glass |

### T093 · Timeline Proses
durasi 25s · 16:9 · gaya "alur baca tetap, tahap yang dapat dibedakan" · bgm B27 opsional · komponen: timeline SVG, papan status, atau rute yang sesuai data

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Judul, konteks proses, dan satuan waktu bila tersedia | Tampilkan titik awal dan akhir | HOLD | MC | — |
| 2 | 3–9 | Dua tahap awal dan kaitan di antaranya | Ungkap urutan dari satu sumbu tetap | HOLD | MC | — |
| 3 | 9–16 | Tahap berikutnya dengan perubahan yang terlihat | Lanjutkan arah baca; perbarui hanya nilai yang berubah | HOLD | MC | — |
| 4 | 16–21 | Tahap penentu dengan satu kalimat penjelas | Tahan keadaan sebelum dan sesudah | HOLD | MC | — |
| 5 | 21–25 | Hasil atau rute utuh, dengan label/sumber yang relevan | Sisakan waktu baca pada hasil | HOLD | END | — |

### T094 · Alur Bisnis / Funnel
durasi 20s · 16:9 · gaya "funnel bersih, angka dominan" · bgm B26 · komponen: `<AccordionFoldCard />`, `<BentoGridReveal />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Judul "Dari pengunjung sampai pembeli" | mask reveal | HOLD | MC | — |
| 2 | 3–8 | Tahap 1 (pengunjung): bentuk funnel paling lebar, angka besar | shape draw-on + counter | HOLD | WGU | data-reveal |
| 3 | 8–12 | Tahap 2 dan 3 menyempit, angka turun | shape stagger + counter | PUSH | WGU | data-reveal |
| 4 | 12–17 | Tahap 4 (pembeli), persentase konversi besar | counter persen | HOLD | PZI | impact-soft |
| 5 | 17–20 | Satu rekomendasi perbaikan | mask reveal | HOLD | END | confirm-glass |

### T095 · Cara Kerja Produk (Exploded View)
durasi 25s · 16:9 · gaya "teknis bersih, garis tipis, label kecil" · bgm B25 · komponen: `<ExplodeToGrid />`, `<CubeRoll3D />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–4 | Produk utuh digambar kode (SVG), nama produk | shape draw-on | HOLD | MC | pop-in |
| 2 | 4–10 | Produk terurai: komponen bergeser keluar dengan garis penghubung | translate `easeInOutSmooth` | PUSH | MC | pop-plop |
| 3 | 10–17 | Tiap komponen disorot satu per satu, label dan fungsi satu baris | highlight kontras + label | GLIDE | WGL | data-reveal |
| 4 | 17–22 | Alur kerja: panah antar komponen berurutan | line draw-on | HOLD | PZI | data-reveal |
| 5 | 22–25 | Produk menyatu kembali, nama produk | translate balik | PULL | END | confirm-glass |

### T096 · Top 5 Ranking
durasi 20s · 9:16 · gaya "tipografi besar, ritme cepat, satu aksen" · bgm B29 · komponen: `<CardStackSwipe />`, `<Coverflow3D />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Judul "Top 5 ..." dan kriteria peringkat | mask reveal | HOLD | MC | pop-in |
| 2 | 3–7 | Peringkat 5 dan 4: angka besar, nama, nilai | slide masuk dari bawah | HOLD | WGU | data-reveal |
| 3 | 7–11 | Peringkat 3 dan 2 dengan tata letak sama | stagger sama | HOLD | WGU | data-reveal |
| 4 | 11–17 | Peringkat 1: elemen paling besar, nilai counter | scale-up + counter | PUSH | PZI | impact-soft |
| 5 | 17–20 | Sumber data dan nama akun | hold | HOLD | END | confirm-glass |

### T097 · Peta Data Geografis
durasi 20s · 16:9 · gaya "peta bersih, satu warna dengan gradasi nilai" · bgm B27 · komponen: `<SphereCards3D />`, `<MasonryZoomDetail />`, `<BentoGridReveal />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Judul dan wilayah yang dipetakan | mask reveal | HOLD | MC | — |
| 2 | 3–9 | Peta (SVG/GeoJSON) tergambar, batas wilayah | path draw-on | HOLD | WGL | data-reveal |
| 3 | 9–14 | Wilayah terisi warna sesuai nilai, berurutan dari rendah ke tinggi | fill stagger | PUSH | WGU | pop-plop |
| 4 | 14–18 | Wilayah tertinggi diperbesar, nama dan angka | zoom + counter | PUSH | PZI | data-reveal |
| 5 | 18–20 | Legenda skala dan sumber | hold | PULL | END | — |

### T098 · Tren Harga (Line Chart)
durasi 15s · 16:9 · gaya "grafik tenang, grid halus, satu aksen" · bgm B27 · komponen: `<BentoGridReveal />`, `<MasonryZoomDetail />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Judul dan rentang waktu, sumbu x dan y | axis draw-on | HOLD | MC | — |
| 2 | 3–9 | Garis harga tergambar dari kiri ke kanan | path draw-on `easeInOutSmooth` | PUSH | WGL | data-reveal |
| 3 | 9–12 | Titik tertinggi dan terendah diberi label nilai | titik pop + counter | PUSH | PZI | pop-plop |
| 4 | 12–15 | Kesimpulan satu kalimat dan sumber | mask reveal | HOLD | END | — |

### T099 · Hasil Survei
durasi 20s · 16:9 · gaya "bersih, bar horizontal, persentase besar" · bgm B27 · komponen: `<ExplodeToGrid />`, `<BentoGridReveal />`, `<AnimatedProgressBar enableProgressSfx />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Judul survei, jumlah responden, periode | counter responden + mask | HOLD | MC | — |
| 2 | 3–9 | Pertanyaan 1: bar horizontal tiap jawaban dengan persentase | bar tumbuh `staggeredSpringAt` | HOLD | WGU | data-reveal |
| 3 | 9–14 | Pertanyaan 2 dengan tata letak sama | stagger sama | HOLD | WGU | data-reveal |
| 4 | 14–18 | Temuan utama satu kalimat besar | mask reveal | PUSH | PZI | pop-plop |
| 5 | 18–20 | Metode survei dan sumber | hold | HOLD | END | confirm-glass |

### T100 · Year in Review (Wrapped)
durasi 30s · 9:16 · gaya "tipografi besar, warna berganti tiap bagian, ritme cepat" · bgm B29 · komponen: `<ZDepthTunnel />`, `<PolaroidDropTable />`, `<GridRecapZoomOut />`

| # | Detik | Visual | Motion | Cam | Out | SFX |
|---|---|---|---|---|---|---|
| 1 | 0–3 | Judul "Tahun ..." dan nama pengguna | letter stagger | HOLD | PZI | impact-soft |
| 2 | 3–9 | Statistik 1: angka raksasa (misal total jam) dan satu kalimat | counter naik | HOLD | MC | data-reveal |
| 3 | 9–16 | Statistik 2: tiga item teratas dalam daftar peringkat | baris stagger | HOLD | WGU | data-reveal |
| 4 | 16–23 | Momen puncak: bulan paling aktif sebagai grafik batang dengan satu batang disorot | batang tumbuh + highlight | PUSH | WGL | pop-plop |
| 5 | 23–27 | Pencapaian tahun ini, satu kalimat besar | mask reveal | HOLD | PZI | impact-soft |
| 6 | 27–30 | Ajakan tahun berikutnya dan `<BrandLogo />` | hold | PULL | END | confirm-glass |
