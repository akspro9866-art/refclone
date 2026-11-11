#!/usr/bin/env python3
"""Audit declared explainer timing. No rendering, beat detection or listening."""
import argparse
import json
import re
import sys
from pathlib import Path
from _contracts import is_number, load_json, nonempty, sha256


def audit_score(score, plan, plan_hash, music_sheet=None):
    errors, warnings = [], []

    def issue(code, path, message, warning=False):
        (warnings if warning else errors).append(dict(code=code, path=path, message=message))

    def result(counts=None):
        return dict(schema_version=1, scope="declared-explainer-timing-only",
                    valid=not errors, errors=errors, warnings=warnings,
                    coverage=counts or {}, media_review="not_run")

    def index(rows, path):
        found = {}
        if not isinstance(rows, list):
            issue("array_required", path, "Expected an array")
            return found
        for n, row in enumerate(rows):
            loc = f"{path}[{n}]"
            if not isinstance(row, dict) or not nonempty(row.get("id")):
                issue("id_required", loc, "Expected an object with a nonempty ID")
            elif row["id"] in found:
                issue("duplicate_id", loc, "Duplicate ID: " + row["id"])
            else:
                found[row["id"]] = row
        return found

    def number(value, path, minimum=None, positive=False):
        if not is_number(value) or (minimum is not None and value < minimum) or (positive and value <= 0):
            issue("invalid_number", path, "Expected a finite number in the allowed range")
            return False
        return True

    if not isinstance(score, dict) or not isinstance(plan, dict):
        issue("object_required", "$", "Score and plan must be objects")
        return result()
    if type(score.get("schema_version")) is not int or score["schema_version"] != 1:
        issue("schema_version", "schema_version", "Expected integer 1")
    if score.get("plan_sha256") != plan_hash:
        issue("stale_plan", "plan_sha256", "Score does not match the current plan bytes")
    if score.get("delivery_mode") not in ("direct", "staged"):
        issue("delivery_mode", "delivery_mode", "Expected direct or staged")
    if score.get("lead_mode") not in ("subtitle", "narration"):
        issue("lead_mode", "lead_mode", "Expected subtitle or narration")
    if not nonempty(score.get("decision_reason")):
        issue("decision_reason", "decision_reason", "Record the actual task basis")
    output = plan.get("output", {})
    duration = output.get("duration_seconds") if isinstance(output, dict) else None
    if not number(duration, "plan.output.duration_seconds", positive=True):
        return result()
    scenes = index(plan.get("scenes"), "plan.scenes")
    beats, elements, audio, owners = {}, {}, {}, {}
    for scene_id, scene in scenes.items():
        for field, target in (("beats", beats), ("elements", elements), ("audio_cues", audio)):
            rows = index(scene.get(field, []), f"plan.{scene_id}.{field}")
            for ident, row in rows.items():
                if ident in target:
                    issue("duplicate_id", f"plan.{field}", "Duplicate ID: " + ident)
                target[ident] = row
                owners[(field, ident)] = scene_id

    knowledge = plan.get("knowledge", {})
    if not isinstance(knowledge, dict):
        knowledge = {}
    truth = knowledge.get("truth", {})
    claims = index(truth.get("claims", []) if isinstance(truth, dict) else [], "plan.knowledge.truth.claims")
    layers = index(knowledge.get("layers", []), "plan.knowledge.layers")

    windows = index(score.get("reading_windows"), "reading_windows")
    for ident, row in windows.items():
        loc = "reading_windows." + ident
        scene_id = row.get("scene_id")
        scene = scenes.get(scene_id) if isinstance(scene_id, str) else None
        if scene is None:
            issue("scene_ref", loc, "Unknown scene")
            continue
        element_id = row.get("element_id")
        if not isinstance(element_id, str) or owners.get(("elements", element_id)) != scene_id:
            issue("element_ref", loc, "Element must belong to the selected scene")
        if not nonempty(row.get("reason")):
            issue("reading_reason", loc, "Explain the reading and diagram-comparison budget")
        start, end = None, None
        for key in ("start_beat_id", "end_beat_id"):
            ref = row.get(key)
            if not isinstance(ref, str) or owners.get(("beats", ref)) != scene_id:
                issue("beat_ref", loc + "." + key, "Beat must belong to the selected scene")
                continue
            value = beats[ref].get("time")
            if number(value, loc + "." + key, minimum=0):
                if key == "start_beat_id":
                    start = value
                else:
                    end = value
        budget = row.get("min_read_seconds")
        budget_ok = number(budget, loc + ".min_read_seconds", positive=True)
        if start is not None and end is not None:
            a, b = scene.get("start"), scene.get("end")
            if not (is_number(a) and is_number(b) and a <= start < end <= b and end <= duration):
                issue("reading_bounds", loc, "Reading window must be ordered and inside its scene")
            elif budget_ok and end - start + 1e-9 < budget:
                issue("reading_short", loc, "Fully visible reading window is shorter than its declared budget")
        claim_refs = row.get("claim_ids", [])
        if not isinstance(claim_refs, list) or any(not isinstance(x, str) or x not in claims for x in claim_refs):
            issue("claim_ref", loc, "Unknown claim ID")
        if "layer_id" in row and (not isinstance(row["layer_id"], str) or row["layer_id"] not in layers):
            issue("layer_ref", loc, "Unknown knowledge layer")

    music_map = score.get("music_map")
    anchors = {}
    if music_map is not None:
        if not isinstance(music_map, dict):
            issue("music_map", "music_map", "Expected an object")
            music_map = None
        else:
            for key in ("track_id", "source_sha256", "analysis_method"):
                if not nonempty(music_map.get(key)):
                    issue("music_metadata", "music_map." + key, "Expected nonempty source metadata")
            if not re.fullmatch(r"[a-fA-F0-9]{64}", str(music_map.get("source_sha256", ""))):
                issue("source_hash", "music_map.source_sha256", "Expected SHA256 hex")
            anchors = index(music_map.get("anchors"), "music_map.anchors")
            for ident, anchor in anchors.items():
                loc = "music_map.anchors." + ident
                number(anchor.get("source_time"), loc + ".source_time", minimum=0)
                if anchor.get("kind") not in ("beat", "downbeat", "phrase", "section"):
                    issue("anchor_kind", loc, "Unknown anchor kind")
                if anchor.get("status") not in ("candidate", "verified"):
                    issue("anchor_status", loc, "Expected candidate or verified")
                evidence = anchor.get("evidence", [])
                if not isinstance(evidence, list) or any(not nonempty(x) for x in evidence):
                    issue("anchor_evidence", loc, "Expected an array of evidence strings")
                elif anchor.get("status") == "verified" and not evidence:
                    issue("anchor_evidence", loc, "Verified anchor needs evidence")
    if music_sheet is not None and not isinstance(music_sheet, dict):
        issue("music_sheet", "music_sheet", "Expected an object")
        music_sheet = None
    placements = index(music_sheet.get("cues", []), "music_sheet.cues") if music_sheet is not None else {}
    points = index(score.get("sync_points", []), "sync_points")
    if not windows and not points:
        issue("empty_scope", "$", "Declare at least one reading window or synchronization point")
    music_count, sfx_count = 0, 0
    for ident, row in points.items():
        loc = "sync_points." + ident
        ref = row.get("visual_beat_id")
        visual = beats.get(ref) if isinstance(ref, str) else None
        if visual is None:
            issue("visual_ref", loc, "Unknown visual beat ID")
            continue
        visual_time = visual.get("time")
        offset, tolerance = row.get("intended_offset_s"), row.get("tolerance_s")
        if not all([number(visual_time, loc + ".visual_time", minimum=0),
                    number(offset, loc + ".intended_offset_s"),
                    number(tolerance, loc + ".tolerance_s", positive=True)]):
            continue
        if visual_time > duration:
            issue("visual_bounds", loc, "Visual beat is beyond the plan duration")
        has_music = "anchor_id" in row or "placement_id" in row
        has_sfx = "audio_cue_id" in row
        if not has_music and not has_sfx:
            issue("sync_target", loc, "Select a music anchor/placement or an SFX cue")
        if has_music:
            anchor_id, placement_id = row.get("anchor_id"), row.get("placement_id")
            anchor = anchors.get(anchor_id) if isinstance(anchor_id, str) else None
            cue = placements.get(placement_id) if isinstance(placement_id, str) else None
            if anchor is None or cue is None or music_map is None:
                issue("music_ref", loc, "Music map, anchor and cue-sheet placement must resolve")
            else:
                if any(cue.get(k) != music_map.get(k) for k in ("track_id", "source_sha256")):
                    issue("music_identity", loc, "Map and placement must use the same track and source hash")
                values = [cue.get(k) for k in ("source_in", "source_out", "timeline_start", "timeline_end")]
                rate = cue.get("playback_rate", 1)
                source = anchor.get("source_time")
                if not all(is_number(v) for v in values + [source, rate]) or rate <= 0:
                    issue("mapping_number", loc, "Source mapping requires finite numbers and positive rate")
                else:
                    a, b, t0, t1 = values
                    if not (0 <= a < b and 0 <= t0 < t1 <= duration and a <= source < b):
                        issue("mapping_bounds", loc, "Anchor must fall in this placement's half-open source interval")
                    elif abs((b - a) / rate - (t1 - t0)) > 1e-6:
                        issue("mapping_duration", loc, "Source duration/rate must match the timeline interval")
                    else:
                        music_count += 1
                        mapped = t0 + (source - a) / rate
                        if abs(mapped - visual_time - offset) > tolerance + 1e-9:
                            issue("music_drift", loc, "Mapped music anchor misses the declared visual offset/tolerance")
                if anchor.get("status") == "candidate":
                    issue("candidate_anchor", loc, "Anchor is still a candidate; listening/beat review remains pending", True)
        if has_sfx:
            cue_id = row.get("audio_cue_id")
            cue = audio.get(cue_id) if isinstance(cue_id, str) else None
            onset = row.get("onset_offset_s")
            if cue is None or cue.get("role") != "sfx":
                issue("sfx_ref", loc, "Expected an existing SFX audio cue")
            elif number(cue.get("time"), loc + ".audio_time", minimum=0) and number(onset, loc + ".onset_offset_s", minimum=0):
                sfx_count += 1
                sound_time = cue["time"] + onset
                if sound_time > duration:
                    issue("sfx_bounds", loc, "Declared sound onset is beyond the plan duration")
                if abs(sound_time - visual_time - offset) > tolerance + 1e-9:
                    issue("sfx_drift", loc, "Declared SFX onset misses the visual offset/tolerance")
    return result(dict(reading_windows=len(windows), sync_points=len(points),
                       mapped_music_points=music_count, declared_sfx_points=sfx_count))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("score")
    parser.add_argument("--plan", required=True)
    parser.add_argument("--music-sheet")
    parser.add_argument("--out")
    parser.add_argument("--strict", action="store_true", help="Treat warnings as a failing exit status")
    args = parser.parse_args()
    try:
        result = audit_score(load_json(args.score), load_json(args.plan), sha256(args.plan),
                             load_json(args.music_sheet) if args.music_sheet else None)
    except (OSError, ValueError) as exc:
        result = dict(schema_version=1, scope="declared-explainer-timing-only", valid=False,
                      errors=[dict(code="input_error", path="$", message=str(exc))], warnings=[],
                      coverage={}, media_review="not_run")
    payload = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(payload + "\n", encoding="utf-8")
    print(payload)
    return 0 if result["valid"] and not (args.strict and result["warnings"]) else 2


if __name__ == "__main__":
    sys.exit(main())
