---
name: sound-design
description: Maps SaaS UI motion beats from timeline.json to procedural audio cues (click, typing, pop, whoosh, chime, pad/riser) and masters 16-bit 44.1kHz WAV output to -14 LUFS using the pure-Python stdlib sfx package.
---

# Sound Design: Procedural SaaS Audio Synthesis & `-14 LUFS` Mastering

Use `sound-design` during **Stage 6 (Audio & Final Delivery)** to pair every visual beat in `timeline.json` with frame-accurate, procedurally synthesized UI sound effects via `cavalry-mcp/sfx/`.

## 1. Motion-to-Audio Cue Mapping Table

| Visual Motion Move / Event | SFX Cue Type | Acoustic Synthesis Model (`sfx/synth.py`) | Default Offset vs. Visual Peak | Relative Gain (`dB`) |
| :--- | :--- | :--- | :--- | :--- |
| **Cursor Click / Button Press** | `click` | Short impulsive transient (`1.8kHz -> 420Hz` pitch drop + filtered micro-burst, `18ms`) | `0 ms` (exact press frame) | `-3.0 dB` |
| **Typewriter / Prompt Stream** | `type` / `typing` | Randomized mechanical keycap transient (`±8%` pitch jitter, `14ms` decay) | `0 ms` per character/token | `-9.0 dB` |
| **Spring Card / Badge Pop** | `pop` | Sine/triangle pitch-envelope chirp (`220Hz -> 680Hz`, `45ms` exponential decay) | `+1 frame` after start | `-4.5 dB` |
| **Camera Whip / Modal Slide** | `whoosh` | Band-pass filtered pink/white noise sweep (`300Hz -> 2.4kHz -> 400Hz`, `180–320ms`) | Centered on peak velocity frame | `-6.0 dB` |
| **Payout / Workflow Success** | `chime` | FM bell harmonic triad (`523.25Hz C5 + 659.25Hz E5 + 783.99Hz G5 + 1046.5Hz C6`, `650ms`) | On checkmark settle frame | `-4.0 dB` |
| **Hero Reveal / Ambient Bed** | `pad` / `riser` | Warm detuned fifths + rising low-pass filter sweep (`110Hz A2 + 165Hz E3 + 220Hz A3`) | Spans entire shot duration | `-14.0 dB` |

## 2. Loudness & Mastering Specification (`-14.0 LUFS`)

1. **Sample Rate & Format**: `44,100 Hz`, `16-bit PCM` stereo (`2 channels`) WAV using only Python 3 standard library modules (`wave`, `math`, `struct`, `json`, `array`).
2. **K-Weighted / RMS Loudness Normalization**:
   - Measure gated integrated loudness across active cue regions:
     $$\text{LUFS} \approx -0.691 + 10 \log_{10}\left(\frac{1}{N}\sum_{n=0}^{N-1} y_{\text{K}}^2[n]\right)$$
   - Compute linear gain scalar $G = 10^{(-14.0 - \text{LUFS}_{\text{measured}}) / 20}$ and apply soft-knee `tanh` true-peak limiting at `-1.0 dBFS` (`0.891` linear ceiling) so transients never clip.

## 3. CLI Invocation

```powershell
python -m sfx --timeline timeline.json --out out.wav --target-lufs -14
```
