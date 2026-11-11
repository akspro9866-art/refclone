# Gaya #36 · Data Editorial

Buat satu grafik yang menjawab satu pertanyaan. Judul menyampaikan kesimpulan, grafik menunjukkan bukti, dan sumber bisa dibaca.

## Komposisi

- **16:9** — Gunakan 4 kolom untuk pertanyaan/kesimpulan, 8 kolom untuk grafik. Letakkan angka kunci dekat seri aktif. Sisakan margin untuk axis label dan satu baris sumber.
- **9:16** — Tampilkan satu perbandingan pada satu waktu. Gunakan batang horizontal untuk label panjang, pindahkan legenda menjadi label langsung, dan simpan satuan di dekat angka.

## Warna, huruf, dan bahan

Off-white, tinta gelap, abu ringan untuk grid, terakota untuk seri fokus, biru untuk pembanding. Source Serif 4 62–84 px untuk klaim, Source Sans 3 30–38 px untuk penjelasan, IBM Plex Mono 24–32 px untuk nilai.

Token awal `getStyleById(36)`: kanvas `#FAF8F3`, bidang `#F0EDE4`, tinta `#1F1F1F`, muted `#8C8C84`, aksen `#D1432B`, aksen sekunder `#2F6F8F`. Font preset: Source Serif 4 / Source Sans 3 / IBM Plex Mono. Gunakan aturan di atas untuk menentukan warna mana yang masuk shot dan pasangan teks/latar yang terbaca.

## Adaptasi subjek dan UI

Pakai data yang benar atau beri label data ilustratif. Untuk UI analytics asli, tampilkan crop dengan sumber/periodenya; anotasi bisa berada di luar grafik. Selaraskan unit serta rentang data antarshot.

## Koreografi contoh pada 30 fps

F00–27 tampilkan pertanyaan dan sumbu. F28–60 ungkap seri fokus sambil menjaga skala. F61–83 tambah satu pembanding. F84–120 tahan angka akhir dan sumber. Skala ulang waktu untuk durasi shot dan beri hold yang cukup untuk bacaan.

## Rakit di Remotion

Bangun skala SVG dari nilai dan domain yang sama; animasikan ukuran batang dari baseline atau reveal jalur berdasarkan titik. Pakai angka tabular dan penanda yang bisa dibaca tanpa warna. SFX satu aksen untuk munculnya insight, bila perlu.

Jika perlu musik, audisi `B21` dan palet SFX `S-DIGITAL` / `S-UMUM` sesuai isi shot.

## Uji frame

Cek angka terhadap tabel input, baseline, unit, tanggal, dan source. Hilangkan perspektif 3D, count-up angka palsu, serta grid yang lebih terang dari seri.
