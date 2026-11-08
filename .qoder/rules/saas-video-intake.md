---
description: Auto-trigger SaaS Reference Video Analysis whenever video files or paths are provided in a chat.
alwaysApply: true
---

# AUTO-TRIGGER: SAAS REFERENCE VIDEO INTAKE RULE

Whenever the user uploads, drops, or pastes video file paths (`.mp4`, `.mov`, `.mkv`, `.webm`, or a directory of reference videos) into a chat—unless the user explicitly asks to render/build a new video using an existing style—you MUST automatically:

1. Load and execute `.qoder/skills/saas-reference-analyzer/SKILL.md`.
2. Operate in **ANALYSIS ONLY** mode:
   - Use ONLY `refclone` analysis tools and local file/validation scripts.
   - NEVER invoke `refclone` clone/build tools or `stallion` rendering tools.
3. Enforce the **Zero-Tolerance SaaS Hard Lock**:
   - If ANY video is not a SaaS video (web app, dashboard, B2B software, UI walkthrough, onboarding flow, product tour), immediately ABORT the entire batch, identify the offending file path, and output ONLY:
     "This library is SaaS-only. Remove non-SaaS video and retry."
