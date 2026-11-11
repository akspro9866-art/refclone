# CARD-GRID-3D-PATTERNS.md — 19 Komponen Siap Pakai: 3D Card Layout, Grid Animation, & Card Interaction

Katalog lengkap **19 pola koreografi kartu & grid** yang tersedia langsung di `templates/components/` beserta pilihan SFX yang bisa diaktifkan per pola. Gunakan `enableSfx` untuk cue bawaan, atau tempatkan `SfxCue` dari palet gaya pada frame aksi.

---

Pilih pola berdasarkan tugas di layar: membalik isi depan/belakang, membandingkan beberapa item, atau membuka detail. Gunakan kartu hanya jika ada informasi yang perlu ditempatkan dalam kartu. Bawa palet dan tipografi panduan ke `Card3DItem.stylePreset`; isi visual dengan `content`, foto, atau data. Nomor muncul jika `indexLabel` diisi. Satu permukaan fokus cukup. `BentoGridReveal` dan layout 3D berbagi tampilan kartu yang sama.

Untuk `PolaroidDropTable`, berikan `src` relatif ke `public/`, `customVisual`, atau logo yang memang diperlukan. Gunakan `objectPosition` untuk menjaga crop hero dan `subCaption` untuk tanggal/sumber. Cek frame mendarat dan ukuran teks pada rasio output.

## Ringkasan Pemetaan Kebutuhan Konten ke Komponen

| Kategori | Nama Pola | Komponen TSX | File Template | SFX Bawaan jika diaktifkan (`public/audio/sfx/`) | Kapan Digunakan di Video |
|---|---|---|---|---|---|
| **1. 3D Card Layout** | **Coverflow** | `<Coverflow3D />` | `Card3DLayouts.tsx` | `transition-swipe.wav` tiap pindah kartu aktif | Galeri & showcase pilihan produk/fitur (kartu aktif menghadap depan). |
| **1. 3D Card Layout** | **Ferris Wheel** | `<FerrisWheelCards />` | `Card3DLayouts.tsx` | `tick-soft.wav` tiap rotasi roda | Daftar fitur/tahapan yang bergiliran melingkar tetap tegak. |
| **1. 3D Card Layout** | **Cube Roll** | `<CubeRoll3D />` | `Card3DLayouts.tsx` | `transition-swoosh.wav` tiap putar sisi kubus | Menampilkan 6 poin utama dalam 6 sisi satu objek kubus 3D utuh. |
| **1. 3D Card Layout** | **Cylinder** | `<CylinderCards3D />` | `Card3DLayouts.tsx` | `transition-scroll.wav` | Kartu mengelilingi tabung drum 3D horizontal. |
| **1. 3D Card Layout** | **Helix** | `<HelixCards3D />` | `Card3DLayouts.tsx` | `transition-swipe.wav` | Kartu naik melingkar seperti tangga putar (timeline/evolusi bertahap). |
| **1. 3D Card Layout** | **Sphere** | `<SphereCards3D />` | `Card3DLayouts.tsx` | `transition-whoosh-soft.wav` | Kartu menempel mengelilingi bola 3D (ekosistem global / banyak integrasi). |
| **1. 3D Card Layout** | **Z-Depth Tunnel** | `<ZDepthTunnel />` | `Card3DLayouts.tsx` | `transition-whoosh-soft.wav` tiap kartu mendekat | Kartu meluncur datang dari kejauhan (`jauh` -> `dekat`) menembus sumbu Z. |
| **2. Grid Animation** | **Bento Grid** | `<BentoGridReveal />` | `GridAnimations.tsx` | `pop-in.wav` per gelombang (`kotak 1` -> `2-3` -> `lengkap`) | Ringkasan spesifikasi / fitur unggulan beda ukuran (misal `48MP`, `IP68`, `120Hz`). |
| **2. Grid Animation** | **Explode to Grid** | `<ExplodeToGrid />` | `GridAnimations.tsx` | `transition-swoosh.wav` (pecah) + `pop-drop.wav` (rapi) | `tumpukan` di tengah -> `pecah` menyebar -> `rapi di grid` (membuka koleksi). |
| **2. Grid Animation** | **Layout Morph** | `<LayoutMorphGridToCarousel />` | `GridAnimations.tsx` | `transition-maximize.wav` + `transition-swipe.wav` | `grid` berubah mulus (`kartu berpindah`) menjadi `carousel` tanpa potongan cut. |
| **2. Grid Animation** | **Masonry Zoom** | `<MasonryZoomDetail />` | `GridAnimations.tsx` | `click.wav` (pilih kotak) + `transition-whoosh-soft.wav` (zoom) | `pilih kotak` di galeri -> `membesar` -> `jadi halaman` detail penuh. |
| **2. Grid Animation** | **Grid Recap** | `<GridRecapZoomOut />` | `GridAnimations.tsx` | `transition-minimize.wav` (mundur) + `confirm-chime.wav` (lengkap) | `slide terakhir` penuh -> `kartu kembali` mengecil -> `recap semua` di grid penutup. |
| **3. Card Interaction** | **Card Stack Swipe** | `<CardStackSwipe />` | `CardInteractions.tsx` | `transition-swipe.wav` tiap swipe kartu teratas | Geser (`swipe`) kartu teratas ke samping lalu kartu bawahnya naik ke depan. |
| **3. Card Interaction** | **Fan Spread** | `<FanSpreadCards />` | `CardInteractions.tsx` | `k1.wav` (gesekan kartu membuka kipas) | Tumpukan kartu membuka melengkung seperti kipas dari satu poros bawah. |
| **3. Card Interaction** | **Polaroid Drop** | `<PolaroidDropTable />` | `CardInteractions.tsx` | `k2.wav` (hentakan foto polaroid ke meja) | Foto polaroid (`liburan`, `ulang tahun`, `kopi pagi`) jatuh satu per satu ke meja. |
| **3. Card Interaction** | **Card Flip** | `<CardFlip3D />` | `CardInteractions.tsx` | `transition-swipe.wav` saat berputar 180 derajat | Kartu dibalik 3D dari sisi `depan` ke `belakang` (*before/after* atau *Q&A*). |
| **3. Card Interaction** | **Page Curl** | `<PageCurlCard />` | `CardInteractions.tsx` | `k1.wav` (lipatan sudut kertas) | Sudut halaman tergulung diagonal memperlihatkan `Sisi belakang`. |
| **3. Card Interaction** | **Page Turn** | `<PageTurnBook />` | `CardInteractions.tsx` | `k1.wav` (balik halaman buku) | Halaman dibalik 3D dari poros tengah seperti membaca buku terbuka. |
| **3. Card Interaction** | **Accordion Fold** | `<AccordionFoldCard />` | `CardInteractions.tsx` | `transition-maximize.wav` saat lipatan terbuka | Kartu terlipat zig-zag 3D (`dilipat & dibuka`) untuk tahapan berurutan. |

---

## 1. Kategori: 3D Card Layout (`templates/components/Card3DLayouts.tsx`)

Semua komponen menerima array `items: Card3DItem[]` yang bersih (mendukung `indexLabel`, `title`, `subtitle`, `metric`, dan logo resmi `brand` via `<BrandLogo />`).

### Contoh Penggunaan (`Coverflow3D`, `FerrisWheelCards`, `CubeRoll3D`, `ZDepthTunnel`)
```tsx
import {
  Coverflow3D,
  FerrisWheelCards,
  CubeRoll3D,
  CylinderCards3D,
  HelixCards3D,
  SphereCards3D,
  ZDepthTunnel,
  Card3DItem,
} from '../components/Card3DLayouts';

const FEATURE_CARDS: Card3DItem[] = [
  { id: 'c1', indexLabel: '01', title: 'Claude Code', subtitle: 'Autonomous CLI', metric: '3.2x', brand: 'claude' },
  { id: 'c2', indexLabel: '02', title: 'Remotion Engine', subtitle: 'Deterministic MP4', metric: '60fps', brand: 'remotion' },
  { id: 'c3', indexLabel: '03', title: 'After Effects', subtitle: 'C1 Spline Camera', metric: 'C1', brand: 'after-effects' },
  { id: 'c4', indexLabel: '04', title: 'TypeScript', subtitle: 'Strict Props', metric: '100%', brand: 'typescript' },
  { id: 'c5', indexLabel: '05', title: 'React 19', subtitle: 'Frame Synced', metric: '0ms', brand: 'react' },
  { id: 'c6', indexLabel: '06', title: 'GitHub Action', subtitle: 'Cloud Render', metric: 'CI/CD', brand: 'github' },
];

// 1A. Coverflow (Kartu aktif menghadap depan, samping miring perspektif 3D)
<Coverflow3D items={FEATURE_CARDS} startFrame={12} framesPerStep={28} />

// 1B. Ferris Wheel (Kartu ikut roda berputar tapi tetap tegak lurus)
<FerrisWheelCards items={FEATURE_CARDS} startFrame={14} framesPerStep={30} radiusPx={250} />

// 1C. Cube Roll (6 konten di 6 sisi kubus 3D utuh)
<CubeRoll3D items={FEATURE_CARDS} startFrame={15} framesPerFace={32} cubeSize={320} />

// 1D. Cylinder vs Helix (Tabung horizontal atau tangga spiral naik)
<CylinderCards3D items={FEATURE_CARDS} startFrame={10} durationInFrames={110} />
<HelixCards3D items={FEATURE_CARDS} startFrame={10} durationInFrames={110} />

// 1E. Sphere vs Z-Depth Tunnel (Menempel di bola 3D atau datang dari kejauhan Z-axis)
<SphereCards3D items={FEATURE_CARDS} startFrame={8} durationInFrames={120} />
<ZDepthTunnel items={FEATURE_CARDS} startFrame={10} framesPerCard={26} />
```

---

## 2. Kategori: Grid Animation (`templates/components/GridAnimations.tsx`)

Dirancang khusus untuk koreografi multi-kartu: pembukaan koleksi, ringkasan fitur Bento, *FLIP layout morphing*, transisi galeri ke detail, hingga penutup *Grid Recap*.

### Contoh Penggunaan (`BentoGridReveal`, `ExplodeToGrid`, `LayoutMorphGridToCarousel`, `MasonryZoomDetail`, `GridRecapZoomOut`)
```tsx
import {
  BentoGridReveal,
  ExplodeToGrid,
  LayoutMorphGridToCarousel,
  MasonryZoomDetail,
  GridRecapZoomOut,
} from '../components/GridAnimations';

// 2A. Bento Grid (Kotak 1 -> Kotak 2-3 -> Lengkap 6 kotak beda ukuran)
<BentoGridReveal
  startFrame={10}
  waveGapFrames={18}
  items={[
    { id: 'b1', indexLabel: '01', metric: '48MP', title: 'Pro Camera System', subtitle: 'Sensor utama ultra-tajam', colSpan: 2, rowSpan: 2, revealWave: 1 },
    { id: 'b2', indexLabel: '02', title: 'Chip Generasi Baru', subtitle: '4nm Neural Engine', colSpan: 1, rowSpan: 1, revealWave: 2 },
    { id: 'b3', indexLabel: '03', metric: 'IP68', title: 'Tahan Air & Debu', subtitle: 'Kedalaman 6 meter', colSpan: 1, rowSpan: 1, revealWave: 2 },
    { id: 'b4', indexLabel: '04', title: 'Baterai 2 Hari', subtitle: 'Fast charge 65W', colSpan: 1, rowSpan: 1, revealWave: 3 },
    { id: 'b5', indexLabel: '05', metric: '120Hz', title: 'LTPO OLED Display', subtitle: 'Adaptive refresh rate', colSpan: 1, rowSpan: 1, revealWave: 3 },
  ]}
/>

// 2B. Explode to Grid (Tumpukan di tengah -> Pecah radial -> Rapi di grid 3x2)
<ExplodeToGrid items={FEATURE_CARDS} explodeFrame={18} settleFrame={42} columns={3} />

// 2C. Layout Morph (Grid 3x2 berubah mulus jadi Carousel horizontal tanpa cut)
<LayoutMorphGridToCarousel items={FEATURE_CARDS} morphFrame={32} carouselStepFrame={64} focusedCarouselIndex={1} />

// 2D. Masonry Zoom (Pilih 1 kotak di galeri -> Membesar -> Jadi halaman detail penuh)
<MasonryZoomDetail items={FEATURE_CARDS} targetIndex={1} selectFrame={18} zoomFrame={34} />

// 2E. Grid Recap (Slide terakhir penuh -> Kartu kembali mengecil -> Recap semua 6 kartu di grid)
<GridRecapZoomOut items={FEATURE_CARDS} pullbackFrame={22} columns={3} />
```

---

## 3. Kategori: Card Interaction (`templates/components/CardInteractions.tsx`)

Menghadirkan interaksi kartu taktil seperti tumpukan kartu yang di-*swipe*, dikipas, foto polaroid jatuh ke meja, kartu berbalik 180°, lipatan sudut kertas (*page curl*), buku membalik (*page turn*), dan lipatan akordeon (*accordion fold*).

### Contoh Penggunaan (`CardStackSwipe`, `FanSpreadCards`, `PolaroidDropTable`, `CardFlip3D`, `PageCurlCard`, `PageTurnBook`, `AccordionFoldCard`)
```tsx
import {
  CardStackSwipe,
  FanSpreadCards,
  PolaroidDropTable,
  CardFlip3D,
  PageCurlCard,
  PageTurnBook,
  AccordionFoldCard,
} from '../components/CardInteractions';

// 3A. Card Stack Swipe vs Fan Spread
<CardStackSwipe items={FEATURE_CARDS} startFrame={16} framesPerSwipe={28} />
<FanSpreadCards items={FEATURE_CARDS.slice(0, 5)} spreadFrame={14} maxFanAngleDeg={56} />

// 3B. Polaroid Drop (Foto jatuh satu per satu ke meja. Aktifkan enableSfx untuk k2.wav.)
<PolaroidDropTable
  startFrame={12}
  dropIntervalFrames={22}
  photos={[
    { id: 'p1', caption: 'liburan', tintColor: '#F07B56', restingPose: [-250, 18, -9] },
    { id: 'p2', caption: 'ulang tahun', tintColor: '#7C5CFC', restingPose: [12, -14, 5] },
    { id: 'p3', caption: 'kopi pagi', tintColor: '#3B9EFF', restingPose: [255, 22, -6] },
  ]}
/>

// 3C. Card Flip 3D vs Page Curl
<CardFlip3D frontItem={FEATURE_CARDS[0]} backItem={FEATURE_CARDS[1]} flipFrame={26} />
<PageCurlCard frontItem={FEATURE_CARDS[0]} backItem={FEATURE_CARDS[1]} curlStartFrame={20} curlDurationFrames={36} />

// 3D. Page Turn vs Accordion Fold
<PageTurnBook leftPage={FEATURE_CARDS[0]} rightPageFront={FEATURE_CARDS[1]} rightPageBack={FEATURE_CARDS[2]} turnFrame={24} />
<AccordionFoldCard panels={FEATURE_CARDS.slice(0, 3)} unfoldFrame={16} direction="vertical" />
```
