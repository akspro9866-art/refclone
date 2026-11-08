---
name: style-smoke_test_style
description: Generate a Cavalry SaaS animation using the cloned "smoke_test_style" motion style (measured 4s 30fps, 10 keyed layers / 20 beats, 4s).
---
# Cloned Style Skill: `smoke_test_style`
- **Visual & Motion DNA:** 11 layers + 10 keyed layers + Duplicator-style item array + SlowOut/SpringOut easing; normalized layout anchors and keyframe timing preserve the original procedural rig.
- **Default Spec:** `30fps`, `4s`, `1920x1080`
- **Required Slots Schema:**
  ```json
  {"text_0":{"type":"string","max_chars":13,"max_words":4,"line_breaks":0},"headline":{"type":"string","max_chars":34,"max_words":5,"line_breaks":0},"subhead":{"type":"string","max_chars":60,"max_words":10,"line_breaks":0},"cta_text":{"type":"string","max_chars":13,"max_words":3,"line_breaks":0},"items":{"type":"array","length":3,"min_items":3,"max_items":3,"item":{"text":{"type":"string","max_chars":17,"max_words":5,"line_breaks":0},"icon":{"type":"string","format":"path"}}},"bg_color":{"type":"string","format":"color"},"text_color":{"type":"string","format":"color"},"primary_color":{"type":"string","format":"color"},"accent_color":{"type":"string","format":"color"}}
  ```
## Single-Shot Execution Rule
When the user pitches a new video idea using `style-smoke_test_style`, DO NOT inspect layers one by one. Map the user's new copy/colors into the `slots` object (strictly respecting character/word counts so typography layout does not overflow) and execute a SINGLE tool call to `cavalry-mcp:instantiate_cloned_style`.
