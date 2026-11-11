# SOUND.md — Katalog Lengkap Backsound (64 Pilihan Lagu) & Studio SFX (65+ Efek)

Katalog suara untuk agent: **40 Lagu Backsound Prosedural Multi-Chord (`B00`–`B39`)**, **24 Lagu Studio Royalty-Free (`M01`–`M24`)**, dan **65+ Sound Effects (43 Rekaman Studio CC0 Asli + Pack Sintesis Spesifik)**.

---

## Palet SFX per gaya

Planner menulis `research/selected-sfx-guide.md` dengan tiga pilihan cue untuk masing-masing dari 44 gaya. [Pemetaan lengkap](style-sfx.json) menyimpan ID file, gain awal, dan kejadian pemicu. Gunakan sebagai titik awal. Pada Risograph, misalnya, pakai `ink-stamp` saat plat kedua mencapai register. Pada Split Flap, gunakan `flap-train` saat rangkaian huruf mulai berputar. Kalau frame hanya ditahan untuk dibaca, biarkan suara fokus pada narasi atau room tone.

Scaffold atau `synth-audio.mjs` menyiapkan WAV di `public/audio/sfx/`. Selain aset lama, ada 12 aproksimasi Foley sintetis untuk kertas, tinta, engsel, kapur, kuas, kaset, kaca, karet, katup udara, air, dan relay.

```tsx
<SfxCue frame={secondPlateContactFrame} sfx="ink-stamp" volume={0.26} />
```

`frame` relatif terhadap `Sequence` terdekat. Dalam 19 pola kartu, grid, dan 3D, audio bawaan aktif dengan `enableSfx`. Jika memakai cue dari palet gaya, tempatkan cue itu secara terpisah pada frame aksi.

## Prinsip Utama Audio & SFX

1. **SFX Wajib Terikat ke Aksi Visual Nyata (Event-Driven, Bukan Acak):**
   - **Dilarang keras** menaruh SFX pada setiap kata subtitle (`words.json`) atau membunyikan SFX dengan timer buta.
   - SFX dipicu otomatis oleh komponen animasi saat aksi benar-benar terjadi di layar:
     - **Ketikan (`<TypeText enableTypingSfx />`):** Memutar `typing-loop.wav` (keyboard mekanik asli), `typing-soft.wav` (laptop), atau `typing-digital.wav` (terminal) tepat dari karakter pertama hingga karakter terakhir selesai diketik.
     - **Loading / Render Progress (`<AnimatedProgressBar enableProgressSfx />`):** Memutar `progress-loop.wav` (`D3` rising ticks) selama bar bergerak dari `0% -> 100%`, lalu membunyikan `confirm-chime.wav` / `d2.wav` tepat saat mencapai `100%`.
     - **Hover & Klik Kursor (`<AnimatedCursor enableClickSfx />`):** Memutar `hover-rollover.wav` saat kursor tiba di tombol (`clickFrame - 6`) dan `click.wav` (`d1.wav`) tepat saat tombol ditekan (`clickFrame`).
     - **Transisi Scene (`<SeamlessSceneShell enableTransitionSfx />`):** Memilih otomatis dari **9 SFX Transisi Studio CC0** sesuai jenis perpindahan scene.
     - **Kemunculan Kartu/Window (`<SfxCue frame={...} sfx="pop-in" />`):** Memutar `pop-in.wav`, `pop-plop.wav`, atau `data-reveal.wav` tepat saat elemen muncul.
2. **Suara Melayani Narasi (Auto-Ducking `-14 LUFS`):**
   - `<AudioStage />` menurunkan volume musik sekitar `-9 dB` (`0.32x`) saat narator berbicara dan menaikkannya kembali secara halus saat jeda.

---

## Bagian 1: Katalog 9 SFX Transisi Studio CC0 (`assets/audio/sfx/`)

Menggantikan suara whoosh sintetis lama dengan rekaman studio CC0 1.0 (Public Domain, 48kHz stereo WAV) yang empuk dan modern:

| File SFX (`public/audio/sfx/`) | Karakter Suara | Dipakai Otomatis / Cocok Untuk |
|---|---|---|
| `transition-swoosh.wav` (`u3.wav`) | Airy modern swoosh pendek (0.30s) | Default untuk `whip-glide-left` & geser cepat horizontal |
| `transition-swipe.wav` (`u8.wav`) | Organic cloth/air swipe lembut (0.55s) | Default untuk `whip-glide-up` & geser vertikal |
| `transition-whoosh-soft.wav` (`u4.wav`) | Deep warm studio whoosh (0.45s) | Default untuk `portal-zoom-in` & camera push-in |
| `transition-maximize.wav` | Smooth UI sheet/window open (0.40s) | Default untuk `spring-sheet-up` & buka window baru |
| `transition-minimize.wav` | Smooth UI window collapse (0.40s) | Tutup window / shrink card |
| `transition-chop.wav` | Fast snappy cut chop (0.45s) | Default untuk `match-cut` & potongan cepat |
| `transition-cinematic.wav` | Wide stereo cinematic swoosh (0.60s) | Transisi pembuka/penutup utama |
| `transition-scroll.wav` | Subtle UI scroll glide (0.40s) | Pergeseran kanvas desktop (`SceneWideDesktopGlide`) |
| `transition-glitch.wav` | Hologram digital glitch cut (0.75s) | Gaya Cyberpunk (1), Glitch (28), VHS (15), Terminal (26) |

---

## Bagian 2: Katalog Lengkap Studio SFX & Pack Tematik (65+ File di `public/audio/sfx/`)

### A. Ketikan, Data, & Loading Progress
- `typing-loop.wav` — Rekaman ketikan keyboard mekanik asli (default `<TypeText typingVariant="mechanical" />`).
- `typing-soft.wav` — Rekaman ketikan keyboard laptop lembut (`<TypeText typingVariant="soft" />`).
- `typing-digital.wav` — Ketikan terminal data cepat (`<TypeText typingVariant="digital" />`).
- `progress-loop.wav` — Rangkaian *counter tick* yang naik nadanya (`0% -> 100%`) untuk `<AnimatedProgressBar />`.
- `data-reveal.wav` — Suara stream data untuk kemunculan grafik batang / chart.

### B. Klik Kursor, Toggle, Hover, & Tick
- `click.wav` (`d1.wav`) — Klik mouse studio tegas (default `<AnimatedCursor />`).
- `click-soft.wav` — Klik tombol UI lembut.
- `click-select.wav` — Klik pilih item/tab.
- `toggle-on.wav` & `toggle-off.wav` — Suara saklar switch UI aktif/nonaktif.
- `hover-rollover.wav` — Suara halus saat kursor tiba di atas tombol sebelum klik.
- `tick.wav` (`u1.wav`) & `tick-soft.wav` — Detak halus untuk counter angka / indikator.

### C. Pop, Plop, Drop, & Kemunculan Kartu
- `pop.wav` (`u2.wav`) — Studio pop netral untuk kemunculan badge/elemen.
- `pop-in.wav` — Pop-in hangat saat kartu utama muncul (`springAt`).
- `pop-plop.wav` — Bubble plop organik (cocok untuk Chat bubble, Clay 3D, Doodle).
- `pop-drop.wav` & `pop-pluck.wav` — UI drop & pluck pendek.

### D. Ding, Chime, Impact, Riser, & Pack Tematik
- `ding-bell.wav` (`d2.wav`) — Lonceng notifikasi/selesai lembut (diputar saat loading 100%).
- `confirm-chime.wav` & `confirm-glass.wav` — Nada konfirmasi sukses & denting kaca.
- `impact-soft.wav` (`u5.wav`), `impact-cinematic.wav`, `impact-punch.wav` — Pukulan sub-bass untuk reveal besar.
- `riser-short.wav` (`u6.wav`), `u7.wav` (sub drop), `u9.wav` (chord stinger penutup), `u10.wav` (reverse swell).
- **Pack Spesifik:** `k1.wav`–`k5.wav` (`S-KERTAS`: geser, tempel, sobek, stempel, goresan), `m1.wav`–`m4.wav` (`S-MEKANIK`: split-flap clack, jam, mesin ketik, servo), `r1.wav`–`r3.wav` (`S-ARCADE`: koin, lompat, power-up), `o1.wav`–`o5.wav` (`S-ORGANIK`: squish, boing, tetes air).

---

## Bagian 3: 64 Pilihan Lagu Backsound (40 Lagu Prosedural `B00`–`B39` + 24 Lagu Studio `M01`–`M24`)

### A. 15 Pilihan Lagu Baru Gaya Modern Reels, Keynote, & SaaS (`B25`–`B39`)
Dihasilkan secara deterministik dengan **progresi 4-akor harmonis**, bassline, Rhodes/marimba/pad, dan drum groove lewat `node scripts/synth-audio.mjs --bgm <Kode>`:

| Kode | Nama Lagu | BPM | Karakter & Instrumen | Cocok untuk Gaya / Konten |
|---|---|---|---|---|
| **B25** | **Apple Keynote Minimal Pluck** | 116 | Felt marimba hangat, sub-bass lembut, rim click presisi | Product launch, showcase fitur, Apple-Inspired Interactive Motion (44), Motion Reel Editorial (43), Swiss (12) |
| **B26** | **Framer / Linear SaaS Groove** | 122 | Deep warm house bass, akor Rhodes 7th, shaker rapi | Demo aplikasi web/SaaS, UI interaktif, Neo-Brutalism (11), Isometric (7) |
| **B27** | **Vox Documentary Piano & Pulse** | 104 | Arpeggio piano felt, pizzicato, detak jam halus | Explainer edukasi, Data Editorial (36), Koran (25), Peta Transit (38) |
| **B28** | **Phonk / Drift High Energy** | 135 | Melodi cowbell tegas, 808 sub punchy, snare tajam | Hype reel, otomotif, olahraga ekstrem, Grafiti (4), Manga (35) |
| **B29** | **UK Garage / 2-Step Tech** | 132 | Ketukan 2-step shuffling, akor organ/Rhodes hangat, sub-bass | Fashion, kreatif, developer reel cepat, Y2K (16), Motion Reel (43) |
| **B30** | **Bedroom Indie Dream Synth** | 110 | Akor synth chorus hangat, bass indie, drum rapat | Cerita personal, Risograph (14), Collage (20), Zine (3) |
| **B31** | **Neo-Soul Coffeehouse Rhodes** | 88 | Akor 9th elektrik piano lembut, swing santai | Kuliner, kafe, UMKM, lifestyle, Mid-Century (21), Doodle (2) |
| **B32** | **Liquid Drum & Bass Flow** | 168 | Pad atmosferik halus + breakbeat cepat mengalir + sub-bass | Speedrun coding, demo performa cepat, Terminal CLI (26), HUD Game (39) |
| **B33** | **Future Bass Uplifting Showcase** | 138 | Supersaw LFO chords cerah, arpeggio naik, snare enerjik | Peluncuran aplikasi konsumer, Inflatable 3D (37), Memphis (6) |
| **B34** | **Bossa Nova Sore Santai** | 114 | Petikan akustik sinkopasi, rimshot bossa, walking bass | Kafe, pariwisata, gaya hidup santai, Papercut (19), Cat Air (41) |
| **B35** | **Dark Matrix Techno** | 128 | Bassline acid hipnotis, kick empat-per-empat gelap, hi-hat logam | AI, cybersecurity, infrastruktur cloud, Cyberpunk (1), Wireframe 3D (27) |
| **B36** | **Sunny Acoustic Explainer** | 112 | Petikan cerah ceria, bass lembut, perkusi ringan | Edukasi anak, onboarding ramah, Clay 3D (8), Krayon (42) |
| **B37** | **Cinematic Hybrid Launch** | 96 | Ostinato string, brass swell, taiko hit dalam | Teaser produk besar, manifesto, Bauhaus (13), Art Deco (22) |
| **B38** | **80s Vaporwave Mallsoft** | 82 | Piano elektrik FM lambat, snare gated reverb, pad chorus | Nostalgia 80/90-an, VHS Analog (15), Retro-Futurism (32) |
| **B39** | **Upbeat Nu-Disco Funk** | 118 | Slap bass oktaf, disco groove, stab akor funk ceria | Promo event, fashion, hiburan, Memphis (6), Neon Signage (29) |

### B. 25 Pilihan Lagu Klasik (`B00`–`B24`)
- **B00** Room Tone Ambience (tanpa melodi)
- **B01** Lo-Fi Dusty Rhodes (84 BPM)
- **B02** Synthwave Night Drive (110 BPM)
- **B03** Dark Sub & Pulse (98 BPM)
- **B04** Glitch Electro Cut (124 BPM)
- **B05** Boom-Bap Street (90 BPM)
- **B06** Halftime 808 Trap (140 BPM)
- **B07** Funk Bounce Groove (110 BPM)
- **B08** Playful Marimba Studio (116 BPM)
- **B09** Minimal Tech Pulse (122 BPM)
- **B10** Warm Ambient Pad (68 BPM)
- **B11** Cinematic Tension (78 BPM)
- **B12** Synthetic Orchestra (112 BPM)
- **B13** 8-Bit Chiptune Arcade (140 BPM)
- **B14** Cool Jazz Brush Swing (118 BPM)
- **B15** Vintage Ragtime Stride (106 BPM)
- **B16** Exotica Vibraphone Lounge (98 BPM)
- **B17** Nusantara Metallophone (78 BPM — inspirasi slendro/pelog)
- **B18** Industrial Mechanica (118 BPM)
- **B19** Warm Acoustic Pluck (92 BPM)
- **B20** Deep Mystery Drone (64 BPM)
- **B21** Clean Corporate Editorial (108 BPM)
- **B22** Fast Breakbeat Kinetic (158 BPM)
- **B23** Taiko & Rim Percussion (108 BPM)
- **B24** Precision Clockwork Tick (112 BPM)

### C. 24 Pilihan Lagu Studio Royalty-Free (`M01`–`M24` via `scripts/fetch-music.mjs`)
Untuk mengunduh lagu rekaman studio asli berlisensi *Mixkit Stock Music Free License* langsung menjadi WAV 48kHz stereo:
```bash
node "<skill>/scripts/fetch-music.mjs" --list
node "<skill>/scripts/fetch-music.mjs" --song M03 --out public/audio/music.wav
```
- **Launch & High-Energy:** `M01` (*Tech House Vibes*, 122 BPM), `M02` (*Techno Fights*, 128 BPM), `M03` (*Hazy After Hours*, 118 BPM), `M04` (*Pop 09*, 116 BPM), `M05` (*Coffee or Tea*, 114 BPM), `M24` (*Dreaming Big*, 122 BPM).
- **Clean SaaS & Corporate:** `M06` (*It's Love*, 108 BPM), `M07` (*Pop Track 06*, 112 BPM), `M08` (*Your Breath*, 105 BPM), `M09` (*Driving Ambition*, 120 BPM), `M10` (*Raising Me Higher*, 115 BPM).
- **Lo-Fi, Urban, & Gaming:** `M11` (*Hip Hop 02*, 90 BPM), `M12` (*Deep Urban*, 94 BPM), `M13` (*Comical*, 116 BPM), `M14` (*Games Worldbeat*, 126 BPM).
- **Documentary, Ambient, & Cyberpunk:** `M15` (*Pilates and Yoga*, 72 BPM), `M16` (*Jungle Voices*, 98 BPM), `M17` (*Serene View*, 76 BPM), `M18` (*Spirit in the Woods*, 84 BPM), `M19` (*Cyberpunk City*, 106 BPM), `M20` (*Other World*, 92 BPM), `M21` (*Sun and His Daughter*, 96 BPM), `M22` (*A Very Brady Special*, 110 BPM), `M23` (*Epical Drums 01*, 118 BPM).
