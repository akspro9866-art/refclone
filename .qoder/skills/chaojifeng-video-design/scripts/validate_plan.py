#!/usr/bin/env python3
"""Validate a video plan's structure, references and timing; not its media quality."""
import argparse
import json
import re
import sys
from pathlib import Path
from _contracts import (Report, catalog, load_json, is_number, nonempty, ID_RE,
                        finite_tree, required_text, object_field, list_field,
                        string_list, resolve_path, sha256)
from knowledge_pack import validate_knowledge

EPS = 1e-7


def known(value, mapping):
    return isinstance(value, str) and value in mapping


def validate_plan(plan, plan_path, catalog_dir=None, strict_assets=False, strict_timing=False, strict_knowledge=False, style_roots=None):
    r = Report()
    if not isinstance(plan, dict):
        r.error("plan_type", "$", "plan must be an object")
        return r.result(scope="plan-contract-only")
    finite_tree(plan, r, "$")
    if type(plan.get("schema_version")) is not int or plan.get("schema_version") != 1:
        r.error("schema_version", "$.schema_version", "expected integer 1")
    required_text(plan, ["project_id", "goal", "audience", "scenario_id"], r, "$")
    if not ID_RE.fullmatch(plan.get("project_id", "") if isinstance(plan.get("project_id"), str) else ""):
        r.error("stable_id", "$.project_id", "use a stable lowercase ID")
    if type(plan.get("revision")) is not int or plan["revision"] < 1:
        r.error("revision", "$.revision", "expected positive integer")
    if plan.get("mode") not in ["recipe", "compose", "free"]:
        r.error("mode", "$.mode", "expected recipe, compose or free")
    try:
        scenarios, styles, patterns = [catalog(k, catalog_dir, style_roots=style_roots) for k in ["scenario", "style", "motion"]]
    except (OSError, ValueError) as exc:
        r.error("catalog_unavailable", "$", str(exc))
        return r.result(scope="plan-contract-only")
    if plan.get("scenario_id") == "custom":
        required_text(plan, ["scenario_description"], r, "$")
    elif not known(plan.get("scenario_id"), scenarios):
        r.error("unknown_scenario", "$.scenario_id", "choose a catalog ID or custom with scenario_description")
    output = object_field(plan, "output", r, "$")
    for key in ["width", "height", "fps"]:
        if type(output.get(key)) is not int or output[key] <= 0:
            r.error("output_spec", "$.output." + key, "expected positive integer")
    duration = output.get("duration_seconds")
    if not is_number(duration) or duration <= 0:
        r.error("duration", "$.output.duration_seconds", "expected positive finite seconds")
        duration = None
    if output.get("audio") not in ["silent", "optional", "required"]:
        r.error("audio_mode", "$.output.audio", "expected silent, optional or required")
    if "language" in output and not nonempty(output["language"]):
        r.error("language", "$.output.language", "expected nonempty language identifier")
    design = object_field(plan, "design", r, "$")
    required_text(design, ["style_id", "rationale"], r, "$.design")
    if design.get("style_id") == "custom":
        if not isinstance(design.get("tokens"), dict) or not design["tokens"]:
            r.error("custom_tokens", "$.design.tokens", "custom style needs nonempty tokens")
    elif not known(design.get("style_id"), styles):
        r.error("unknown_style", "$.design.style_id", "choose a catalog ID or custom with tokens")
    if "style_lock" in design:
        try:
            from _stylepacks import style_lock
            expected = style_lock(design.get('style_id'), style_roots)
            if design['style_lock'] != expected:
                r.error('style_lock', '$.design.style_lock', 'selected package, dependency or shared source changed; resolve the style and review the plan again')
        except (ValueError, OSError, TypeError, KeyError) as exc:
            r.error('style_lock', '$.design.style_lock', str(exc))
    if "style_overrides" in design:
        overrides = design["style_overrides"]
        if not isinstance(overrides, dict) or not overrides:
            r.error("style_overrides", "$.design.style_overrides", "expected a nonempty object")
        elif set(overrides) - {"tokens", "motion_character", "camera", "sound"}:
            r.error("style_overrides", "$.design.style_overrides", "only appearance, motion, camera and sound may be overridden")
        elif any(not isinstance(v, dict) or not v for v in overrides.values()):
            r.error("style_overrides", "$.design.style_overrides", "each section must be a nonempty object")
    if "preserve" in design:
        string_list(design["preserve"], r, "$.design.preserve")
    for field, kind in [("expression_ids", "expression"), ("recipe_id", "recipe")]:
        if field not in design:
            continue
        values = string_list(design[field], r, "$.design." + field) if field.endswith("_ids") else [design[field]]
        try:
            choices = catalog(kind, catalog_dir)
        except (OSError, ValueError) as exc:
            r.error("catalog_unavailable", "$.design." + field, str(exc))
            continue
        for value in values:
            if not known(value, choices):
                r.error("design_reference", "$.design." + field, "unknown " + kind + " ID: " + str(value))
            elif choices[value].get("scenario_ids") and plan.get("scenario_id") not in choices[value]["scenario_ids"]:
                r.warning("design_outside_scenario", "$.design." + field,
                          "outside recommended scenarios; explain the adaptation and check facts, inputs and runtime capabilities before production")
    runtime = object_field(plan, "runtime", r, "$")
    required_text(runtime, ["adapter"], r, "$.runtime")
    status = runtime.get("status", "unresolved")
    selected_style = styles.get(design.get("style_id"), {}) if isinstance(design.get("style_id"), str) else {}
    style_caps = set(selected_style.get("required_capabilities", []))
    actual_caps = runtime.get("capabilities", [])
    if isinstance(actual_caps, list) and all(isinstance(v, str) for v in actual_caps):
        missing_style_caps = sorted(style_caps - set(actual_caps))
        if missing_style_caps:
            r.warning("style_capabilities", "$.runtime.capabilities", "selected style requires actual implementation of: " + ", ".join(missing_style_caps), status == "ready")
    if status not in ["unresolved", "ready"]:
        r.error("runtime_status", "$.runtime.status", "expected unresolved or ready")
    if status != "ready":
        r.warning("runtime_unresolved", "$.runtime", "detect an existing runtime before promising export")
    capabilities = set(string_list(runtime.get("capabilities", []), r, "$.runtime.capabilities"))
    required_caps = set(string_list(runtime.get("required_capabilities", []), r, "$.runtime.required_capabilities"))
    ids = {}

    def register(item, category, path):
        if not isinstance(item, dict):
            r.error("item_type", path, "expected object")
            return False
        ident = item.get("id")
        if not isinstance(ident, str) or not ID_RE.fullmatch(ident):
            r.error("stable_id", path + ".id", "use a stable lowercase ID")
            return False
        seen = ids.setdefault(category, set())
        if ident in seen:
            r.error("duplicate_id", path + ".id", f"duplicate {category} ID: {ident}")
        seen.add(ident)
        return True

    director_entities, director_beats = {}, {}
    if "director" in plan:
        director = object_field(plan, "director", r, "$")
        dp = "$.director"
        required_text(director, ["intent", "viewer_end", "throughline"], r, dp)
        if "viewer_start" in director:
            required_text(director, ["viewer_start"], r, dp)
        structure = object_field(director, "structure", r, dp)
        required_text(structure, ["kind", "rationale"], r, dp + ".structure")
        for key, target, category, fields in [
            ("entities", director_entities, "director_entity", ["kind", "role"]),
            ("beats", director_beats, "director_beat", ["function", "before", "change", "after"])]:
            items = list_field(director, key, r, dp, True)
            if not items:
                r.error("director_empty", dp + "." + key, "director requires at least one entry")
            for j, item in enumerate(items):
                ip = f"{dp}.{key}[{j}]"
                if not register(item, category, ip):
                    continue
                target[item["id"]] = item
                required_text(item, fields, r, ip)
                if key == "entities":
                    string_list(item.get("identity_constraints"), r, ip + ".identity_constraints")
        for j, cue in enumerate(list_field(director, "sound_arc", r, dp)):
            cp = f"{dp}.sound_arc[{j}]"
            if not register(cue, "director_sound", cp):
                continue
            required_text(cue, ["beat_id", "role", "onset_anchor", "energy", "visual_relation"], r, cp)
            if not known(cue.get("beat_id"), director_beats):
                r.error("director_beat_reference", cp + ".beat_id", "resolve to director.beats")
        if "iteration" in director:
            iteration = object_field(director, "iteration", r, dp)
            if type(iteration.get("max_passes")) is not int or iteration["max_passes"] < 1:
                r.error("iteration_limit", dp + ".iteration.max_passes", "expected positive integer")
            required_text(iteration, ["stop_rule"], r, dp + ".iteration")
        if "tech_language" in director:
            tech = object_field(director, "tech_language", r, dp)
            for key in ["choices", "avoid"]:
                string_list(tech.get(key), r, dp + ".tech_language." + key)

    assets = {}
    for i, asset in enumerate(list_field(plan, "assets", r, "$")):
        path = f"$.assets[{i}]"
        if not register(asset, "asset", path):
            continue
        assets[asset["id"]] = asset
        required_text(asset, ["path", "source", "rights", "status"], r, path)
        if asset.get("kind") not in ["image", "video", "audio", "font", "product", "data"]:
            r.error("asset_kind", path + ".kind", "unknown asset kind")
        if asset.get("status") not in ["ready", "missing"]:
            r.error("asset_status", path + ".status", "expected ready or missing")
        asset_path = asset.get("path")
        remote = isinstance(asset_path, str) and "://" in asset_path
        local = resolve_path(Path(plan_path).parent, asset_path) if nonempty(asset_path) and not remote else None
        if asset.get("status") == "missing" or remote or local is None or not local.is_file():
            r.warning("asset_unavailable", path, "supply a local ready file or revise the affected scene; URL is not a downloaded asset", strict_assets)
        if "sha256" in asset:
            expected = asset["sha256"]
            if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", expected):
                r.error("asset_hash", path + ".sha256", "expected SHA256 hex")
            elif local and local.is_file() and sha256(local).lower() != expected.lower():
                r.error("asset_hash", path + ".sha256", "local asset bytes do not match recorded hash")

    def asset_ref(value, path, audio=False):
        if not known(value, assets):
            r.error("asset_reference", path, "unresolved asset ID: " + str(value))
            return None
        asset = assets[value]
        if audio and asset.get("kind") != "audio":
            r.error("audio_asset_kind", path, "sound cues and narration require an audio asset")
        return asset

    def within(item, path, start, end, moment=False, duration_key=None):
        if moment:
            a = b = item.get("time")
        else:
            a = item.get("start")
            if duration_key:
                delta = item.get(duration_key)
                b = a + delta if is_number(a) and is_number(delta) else None
                if not is_number(delta) or delta <= 0:
                    r.error("interval_duration", path + "." + duration_key, "expected positive finite duration")
            else:
                b = item.get("end")
        if not is_number(a) or not is_number(b):
            r.error("time_type", path, "expected finite numeric time boundaries")
            return None
        if b < a or (not moment and b <= a):
            r.error("interval_order", path, "end must follow start")
        if is_number(start) and is_number(end) and (a < start - EPS or b > end + EPS):
            r.error("outside_scene", path, "time must fall inside its scene")
        return a, b

    scenes = list_field(plan, "scenes", r, "$", True)
    if not scenes:
        r.error("empty_scenes", "$.scenes", "at least one scene is required")
    coverage_end = 0
    previous_start = -1
    for i, scene in enumerate(scenes):
        sp = f"$.scenes[{i}]"
        if not register(scene, "scene", sp):
            continue
        required_text(scene, ["purpose"], r, sp)
        a, b = scene.get("start"), scene.get("end")
        interval = within(scene, sp, 0, duration)
        if interval:
            if a < previous_start - EPS:
                r.error("scene_order", sp, "scenes must be sorted by start")
            if a > coverage_end + EPS:
                r.error("timeline_gap", sp, f"uncovered interval {coverage_end:g} to {a:g}")
            if a < coverage_end - EPS and not nonempty(scene.get("overlap_reason")):
                r.error("scene_overlap", sp, "overlap requires this scene's overlap_reason")
            previous_start, coverage_end = a, max(coverage_end, b)
        if "hold_seconds" in scene and (not is_number(scene["hold_seconds"]) or scene["hold_seconds"] < 0
                                        or (interval and scene["hold_seconds"] > b - a)):
            r.error("hold_budget", sp + ".hold_seconds", "hold must fit nonnegative seconds inside scene")
        elements = {}
        for j, element in enumerate(list_field(scene, "elements", r, sp, True)):
            ep = f"{sp}.elements[{j}]"
            if not register(element, "element", ep):
                continue
            elements[element["id"]] = element
            required_text(element, ["role"], r, ep)
            for optional in ["content", "continuity_key", "implementation"]:
                if optional in element and not isinstance(element[optional], str):
                    r.error("string_type", ep + "." + optional, "expected string")
            if "asset_id" in element:
                asset_ref(element["asset_id"], ep + ".asset_id")
            if "start" in element or "end" in element:
                within(element, ep, a, b)
        if "intent" in scene:
            intent = object_field(scene, "intent", r, sp)
            ip = sp + ".intent"
            required_text(intent, ["viewer_change"], r, ip)
            for field, targets in [("beat_ids", director_beats), ("focus_entity_ids", director_entities),
                                   ("reveal_order", elements)]:
                if field in intent:
                    values = string_list(intent[field], r, ip + "." + field)
                    for ident in values:
                        if not known(ident, targets):
                            r.error("intent_reference", ip + "." + field,
                                    "unresolved " + field + " ID: " + str(ident))
            for field in ["handoff", "acceptance"]:
                if field in intent:
                    required_text(intent, [field], r, ip)
            if "camera" in intent:
                camera = object_field(intent, "camera", r, ip)
                required_text(camera, ["framing", "movement", "purpose"], r, ip + ".camera")
        narrations = {}
        for j, narration in enumerate(list_field(scene, "narration", r, sp)):
            np = f"{sp}.narration[{j}]"
            if not register(narration, "narration", np):
                continue
            narrations[narration["id"]] = narration
            required_text(narration, ["display", "spoken"], r, np)
            within(narration, np, a, b, duration_key="duration_seconds")
            if narration.get("timing") not in ["measured", "estimated"]:
                r.error("narration_timing", np, "timing must be measured or estimated")
            if narration.get("timing") == "estimated":
                r.warning("estimated_timing", np, "obtain actual audio and retime before final sync acceptance", strict_timing)
            if "asset_id" in narration:
                asset = asset_ref(narration["asset_id"], np + ".asset_id", True)
            else:
                asset = None
            audio_path = asset.get("path") if asset else None
            audio_exists = (nonempty(audio_path) and "://" not in audio_path
                            and resolve_path(Path(plan_path).parent, audio_path).is_file())
            if narration.get("timing") == "measured" and (not asset or asset.get("status") != "ready" or not audio_exists):
                r.error("measured_without_audio", np, "measured narration requires an actual local ready audio asset")
            if output.get("audio") == "silent":
                r.error("silent_narration", np, "spoken narration conflicts with silent output")
        beats = {}
        for j, beat in enumerate(list_field(scene, "beats", r, sp)):
            bp = f"{sp}.beats[{j}]"
            if not register(beat, "beat", bp):
                continue
            beats[beat["id"]] = beat
            required_text(beat, ["meaning"], r, bp)
            within(beat, bp, a, b, moment=True)
            if "narration_id" in beat and not known(beat["narration_id"], narrations):
                r.error("narration_reference", bp, "narration_id must resolve within scene")
        motion_records = []
        for j, motion in enumerate(list_field(scene, "motions", r, sp)):
            mp = f"{sp}.motions[{j}]"
            if not register(motion, "motion", mp):
                continue
            required_text(motion, ["pattern_id", "target_id"], r, mp)
            mi = within(motion, mp, a, b)
            if not known(motion.get("target_id"), elements):
                r.error("motion_target", mp, "target_id must resolve to an element in this scene")
            if "beat_id" in motion and not known(motion["beat_id"], beats):
                r.error("beat_reference", mp, "beat_id must resolve within scene")
            if motion.get("pattern_id") == "custom":
                if motion.get("custom") is not True:
                    r.error("custom_marker", mp, "custom motion requires custom=true")
                required_text(motion, ["implementation"], r, mp)
                channels = string_list(motion.get("channels"), r, mp + ".channels")
                if not channels:
                    r.error("custom_channels", mp, "custom motion must declare controlled channels")
                required_caps.update(string_list(motion.get("required_capabilities", []), r, mp + ".required_capabilities"))
            elif not known(motion.get("pattern_id"), patterns):
                r.error("unknown_motion", mp, "unknown pattern; use catalog ID or explicit custom implementation")
                channels = []
            else:
                pattern = patterns[motion["pattern_id"]]
                channels = pattern.get("channels", [])
                required_caps.update(pattern.get("required_capabilities", []))
                if "channels" in motion:
                    declared = string_list(motion["channels"], r, mp + ".channels")
                    if set(declared) != set(channels):
                        r.error("motion_channels", mp, "built-in channels are catalog-defined; use custom for a different implementation")
            parameters = motion.get("parameters", {})
            if not isinstance(parameters, dict):
                r.error("parameters_type", mp + ".parameters", "expected object")
            elif known(motion.get("pattern_id"), patterns):
                schemas = patterns[motion["pattern_id"]]["parameters"]
                type_checks = {"number": is_number, "integer": lambda v: type(v) is int,
                               "string": lambda v: isinstance(v, str), "boolean": lambda v: type(v) is bool,
                               "object": lambda v: isinstance(v, dict), "array": lambda v: isinstance(v, list),
                               "null": lambda v: v is None}
                for key, value in parameters.items():
                    pp = mp + ".parameters." + key
                    if key not in schemas:
                        r.warning("unknown_parameter", pp,
                                  "parameter is not specified by this pattern; confirm adapter support or use explicit custom motion")
                        continue
                    spec = schemas[key]
                    if "type" in spec and not type_checks[spec["type"]](value):
                        r.error("parameter_type", pp, "expected catalog type " + spec["type"])
                    if "values" in spec and not any(
                            value == choice and (type(value) is type(choice) or is_number(value) and is_number(choice))
                            for choice in spec["values"]):
                        r.error("parameter_enum", pp,
                                "choose a catalog value: " + json.dumps(spec["values"], ensure_ascii=False))
                    if "min" in spec or "max" in spec:
                        if not is_number(value) or ("min" in spec and value < spec["min"]) or ("max" in spec and value > spec["max"]):
                            r.error("parameter_range", pp, "provide a finite number within catalog bounds; booleans are not numbers")
            if mi:
                for other, other_i, other_channels, other_path in motion_records:
                    if (motion.get("target_id") == other.get("target_id") and set(channels) & set(other_channels)
                            and min(mi[1], other_i[1]) - max(mi[0], other_i[0]) > EPS
                            and not (nonempty(motion.get("composition_reason")) or nonempty(other.get("composition_reason")))):
                        r.error("motion_conflict", mp, "same target/channel overlaps " + other_path + "; provide composition_reason or separate layers/times")
                motion_records.append((motion, mi, channels, mp))
        for j, cue in enumerate(list_field(scene, "audio_cues", r, sp)):
            cp = f"{sp}.audio_cues[{j}]"
            if not register(cue, "audio_cue", cp):
                continue
            within(cue, cp, a, b, moment=True)
            asset_ref(cue.get("asset_id"), cp + ".asset_id", True)
            if cue.get("role") not in ["music", "voice", "sfx"]:
                r.error("audio_role", cp + ".role", "expected music, voice or sfx")
            for key in ["gain_db", "sync_offset_seconds"]:
                if key in cue and not is_number(cue[key]):
                    r.error("audio_number", cp + "." + key, "expected finite number")
            if is_number(cue.get("time")) and is_number(cue.get("sync_offset_seconds", 0)):
                effective = cue["time"] + cue.get("sync_offset_seconds", 0)
                if is_number(a) and is_number(b) and not a - EPS <= effective <= b + EPS:
                    r.error("audio_offset_range", cp, "effective cue time must fall inside scene")
            if "beat_id" in cue and not known(cue["beat_id"], beats):
                r.error("beat_reference", cp, "beat_id must resolve within scene")
            if "end" in cue:
                within(dict(start=cue.get("time"), end=cue["end"]), cp, a, b)
            if "duration_seconds" in cue:
                within(dict(start=cue.get("time"), duration_seconds=cue["duration_seconds"]), cp, a, b, duration_key="duration_seconds")
            if output.get("audio") == "silent":
                r.error("silent_cue", cp, "audio cue conflicts with silent output")
    if duration is not None and abs(coverage_end - duration) > EPS:
        r.error("timeline_end", "$.scenes", "scenes must cover exactly output.duration_seconds")
    for capability in sorted(required_caps - capabilities):
        r.warning("capability_missing", "$.runtime", "detect or implement capability: " + capability, status == "ready")
    extra = {}
    chosen = [x for x in design.get("expression_ids", []) if isinstance(x, str)] if isinstance(design.get("expression_ids"), list) else []
    uses_knowledge = any(x.startswith("knowledge.") for x in chosen)
    if "knowledge" in plan:
        result = validate_knowledge(plan["knowledge"], plan=plan, strict=strict_knowledge, base="$.knowledge")
        for item in result["errors"]:
            r.error(item["code"], item["path"], item["message"])
        for item in result["warnings"]:
            r.warning(item["code"], item["path"], item["message"])
        if isinstance(plan["knowledge"], dict):
            extra["knowledge"] = dict(scope=result.get("scope"), summary=result.get("summary"))
        if not uses_knowledge:
            r.warning("knowledge_expression_unrecorded", "$.design.expression_ids",
                      "plan.knowledge is present; record the knowledge.* expression IDs it follows", strict_knowledge)
    elif uses_knowledge:
        r.warning("knowledge_pack_missing", "$.knowledge",
                  "knowledge.* expressions need a plan.knowledge block (topic, domain standards, carrier, truth ledger, layers) or a standalone pack",
                  strict_knowledge)
    return r.result(scope="plan-contract-only", media_verified=False, **extra)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan")
    parser.add_argument("--strict-assets", action="store_true")
    parser.add_argument("--strict-timing", action="store_true")
    parser.add_argument("--strict-knowledge", action="store_true", help="treat knowledge-pack warnings as errors")
    parser.add_argument("--catalog-dir", help=argparse.SUPPRESS)
    parser.add_argument("--style-root", action="append", default=None, help="additional style package collection")
    args = parser.parse_args()
    try:
        result = validate_plan(load_json(args.plan), args.plan, args.catalog_dir, args.strict_assets, args.strict_timing,
                               args.strict_knowledge, args.style_root)
    except (OSError, ValueError, TypeError) as exc:
        result = dict(schema_version=1, valid=False, status="failed", errors=[dict(code="read_error", path=args.plan, message=str(exc))], warnings=[])
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0 if result["valid"] else 1


if __name__ == "__main__":
    sys.exit(main())
