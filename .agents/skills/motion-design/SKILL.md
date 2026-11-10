---
name: motion-design
description: End-to-end beat-locked SaaS motion architecture (claude-motion workflow): unifies timeline.json beat contracts, procedural Cavalry scene compilation, contact-sheet review loops, and -14 LUFS sound design.
---

# Motion Design (`claude-motion` Unified Beat-Locked Workflow)

Use `motion-design` to coordinate the shared `timeline.json` contract across scene choreography, Cavalry procedural execution, visual contact-sheet verification (`review-loop`), and procedural audio synthesis (`sound-design` + `sfx/`).

## 1. The Shared `timeline.json` Contract

Every SaaS animation is anchored by a deterministic `timeline.json` document so visual keyframes, camera moves, contact-sheet frames, and `-14 LUFS` audio cues share the exact same frame and millisecond clock:

```json
{
  "version": 1,
  "title": "SaaS Feature Launch",
  "fps": 60,
  "width": 1920,
  "height": 1080,
  "durationSeconds": 6.0,
  "totalFrames": 360,
  "archetype": "Tactile Craft",
  "beats": [
    {
      "id": "beat_01_shell",
      "frameStart": 0,
      "frameSettle": 21,
      "frameHoldEnd": 66,
      "role": "container_entrance",
      "move": "spring_pop",
      "sfx": { "type": "whoosh", "gainDb": -6.0, "durationMs": 220 }
    },
    {
      "id": "beat_02_headline",
      "frameStart": 12,
      "frameSettle": 36,
      "frameHoldEnd": 96,
      "role": "hero_typography",
      "move": "masked_baseline_reveal",
      "sfx": { "type": "pop", "gainDb": -4.5 }
    },
    {
      "id": "beat_03_cta_click",
      "frameStart": 96,
      "frameSettle": 114,
      "frameHoldEnd": 180,
      "role": "interaction_confirm",
      "move": "magnetic_cursor_pull",
      "sfx": { "type": "click", "gainDb": -3.0 }
    }
  ]
}
```

## 2. Beat-Locked Execution Rules

1. **Derive Beat Inspection Frames**: From `timeline.json`, collect `[frameStart, Math.round((frameStart + frameSettle) / 2), frameSettle, frameHoldEnd]` for every beat and pass them as `beatFrames` / `sampleFrames` to `cavalry_verify_frames` or `runBatchStep`.
2. **Verify Hold Duration**: Ensure `(frameHoldEnd - frameSettle) / fps >= 0.70` seconds for every beat containing readable text or metrics.
3. **Compile Synced Audio**: Pass `timeline.json` (or the beat list from `src/tools/beats.ts`) to `python -m sfx --timeline timeline.json --out out.wav` to synthesize a frame-accurate `-14 LUFS` WAV sound track.
