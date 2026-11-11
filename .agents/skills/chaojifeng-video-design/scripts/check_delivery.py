#!/usr/bin/env python3
"""Check manifest identity and files; optionally probe media. Never renders or plays."""
import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from _contracts import (Report, load_json, sha256, resolve_path, nonempty,
                        finite_tree, required_text, object_field, list_field, is_number)
from validate_plan import validate_plan

CHECKS = ["structure", "semantic", "visual", "playback", "audio", "comprehension"]
STATES = ["passed", "partial", "failed", "not_run", "not_applicable"]


def probe_video(path, output, report, locator):
    executable = shutil.which("ffprobe")
    if not executable:
        report.error("ffprobe_unavailable", locator, "--probe needs an existing ffprobe; no dependency was installed")
        return None
    try:
        result = subprocess.run([executable, "-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format", "-of", "json", str(Path(path).resolve())],
                                shell=False, capture_output=True, text=True, timeout=30, check=False)
        if result.returncode:
            report.error("probe_failed", locator, "ffprobe could not decode media metadata: " + result.stderr[:500])
            return None
        data = json.loads(result.stdout)
    except (OSError, subprocess.TimeoutExpired, ValueError) as exc:
        report.error("probe_failed", locator, str(exc))
        return None
    videos = [stream for stream in data.get("streams", []) if stream.get("codec_type") == "video" and not stream.get("disposition", {}).get("attached_pic")]
    audios = [stream for stream in data.get("streams", []) if stream.get("codec_type") == "audio"]
    if not videos:
        report.error("no_video_stream", locator, "no non-cover-art video stream found")
        return None
    stream = videos[0]
    for field in ["width", "height"]:
        if stream.get(field) != output.get(field):
            report.error("video_spec_mismatch", locator, field + " differs from plan")
    try:
        rate = stream.get("avg_frame_rate") or stream.get("r_frame_rate")
        numerator, denominator = str(rate).split("/")
        fps = float(numerator) / float(denominator)
        if not is_number(fps) or abs(fps - output["fps"]) > 0.01:
            report.error("video_fps_mismatch", locator, "frame rate differs from plan")
        if not is_number(fps):
            fps = None
    except (ValueError, ZeroDivisionError, TypeError, KeyError):
        fps = None
        report.error("video_fps_unknown", locator, "could not verify finite frame rate")
    try:
        duration = float(stream.get("duration", data.get("format", {}).get("duration")))
        tolerance = max(0.05, 1 / output["fps"])
        if not is_number(duration) or abs(duration - output["duration_seconds"]) > tolerance:
            report.error("video_duration_mismatch", locator, "duration differs from plan by more than one frame or 0.05s")
        if not is_number(duration):
            duration = None
    except (ValueError, TypeError, KeyError, ZeroDivisionError):
        duration = None
        report.error("video_duration_unknown", locator, "could not verify duration")
    frames = stream.get("nb_frames")
    if frames is not None and str(frames).isdigit() and is_number(output.get("duration_seconds")) and is_number(output.get("fps")):
        expected = round(output["duration_seconds"] * output["fps"])
        if abs(int(frames) - expected) > 1:
            report.error("video_frame_count", locator, "reported frame count differs from plan")
    if output.get("audio") == "required" and not audios:
        report.error("audio_stream_missing", locator, "plan requires an audio stream")
    if output.get("audio") == "silent" and audios:
        report.warning("unexpected_audio", locator, "silent plan has an audio stream; inspect its content")
    return dict(path=str(path), width=stream.get("width"), height=stream.get("height"), fps=fps,
                duration_seconds=duration, frame_count=frames, audio_streams=len(audios),
                verification="metadata-probed", playback_verified=False, audio_quality_verified=False)


def check_delivery(plan_path, manifest_path, probe=False, require_video=False, catalog_dir=None):
    r = Report()
    plan_path, manifest_path = Path(plan_path), Path(manifest_path)
    plan, manifest = load_json(plan_path), load_json(manifest_path)
    plan_report = validate_plan(plan, plan_path, catalog_dir)
    for error in plan_report["errors"]:
        r.error("plan_" + error["code"], error["path"], error["message"])
    for warning in plan_report["warnings"]:
        r.warning("plan_" + warning["code"], warning["path"], warning["message"])
    if not isinstance(plan, dict) or not isinstance(manifest, dict):
        r.error("manifest_type", "$", "plan and manifest must be objects")
        return r.result(scope="delivery-records", media_verified=False)
    if plan_report["errors"]:
        return r.result(scope="delivery-records", media_verified=False,
                        limitation="Invalid plan; no media subprocess was started.")
    finite_tree(manifest, r, "$")
    if type(manifest.get("schema_version")) is not int or manifest.get("schema_version") != 1:
        r.error("schema_version", "$.schema_version", "expected integer 1")
    if manifest.get("project_id") != plan.get("project_id"):
        r.error("project_mismatch", "$.project_id", "manifest must identify this plan's project")
    plan_hash = sha256(plan_path)
    if manifest.get("plan_sha256") != plan_hash:
        r.error("stale_plan", "$.plan_sha256", "manifest does not match the plan's current original bytes; regenerate affected outputs/checks")
    for i, asset in enumerate(plan.get("assets", [])):
        if asset.get("status") == "ready" and not asset.get("sha256"):
            r.warning("asset_fingerprint_missing", f"$.assets[{i}]", "record this asset's hash in the plan to detect material changes after checks")
    producer = object_field(manifest, "producer", r, "$")
    required_text(producer, ["tool", "model", "run_id"], r, "$.producer")
    resolved_outputs, probes = [], []
    videos = 0
    outputs = list_field(manifest, "outputs", r, "$", True)
    if not outputs:
        r.error("empty_outputs", "$.outputs", "include at least one actual source, preview, audio or video artifact")
    for i, item in enumerate(outputs):
        locator = f"$.outputs[{i}]"
        if not isinstance(item, dict):
            r.error("output_type", locator, "expected object")
            continue
        if item.get("kind") not in ["video", "source", "preview", "audio"]:
            r.error("output_kind", locator, "unknown output kind")
        if item.get("kind") == "video":
            videos += 1
        if not nonempty(item.get("path")) or "://" in item["path"]:
            r.error("output_path", locator, "output must be a local file, relative to manifest or absolute")
            continue
        path = resolve_path(manifest_path.parent, item["path"])
        resolved_outputs.append(dict(kind=item.get("kind"), path=str(path.resolve()), exists=path.is_file()))
        if not path.is_file():
            r.error("output_missing", locator, "supply the actual output file: " + str(path))
            continue
        expected = item.get("sha256")
        if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", expected):
            r.error("output_hash", locator, "output requires SHA256 hex")
        elif sha256(path).lower() != expected.lower():
            r.error("output_hash", locator, "output bytes differ from recorded hash")
        if item.get("kind") == "video" and probe:
            metadata = probe_video(path, plan.get("output", {}), r, locator)
            if metadata:
                probes.append(metadata)
    if require_video and not videos:
        r.error("video_required", "$.outputs", "include a real hashed video file")
    if not videos:
        r.warning("no_video", "$.outputs", "design/source-only delivery; no video was checked")
    elif not probe:
        r.warning("video_unprobed", "$.outputs", "file existence/hash is not media verification; use --probe for metadata only")
    checks = object_field(manifest, "checks", r, "$")
    for name in CHECKS:
        locator = "$.checks." + name
        check = checks.get(name)
        if not isinstance(check, dict):
            r.error("check_missing", locator, "each required check needs status and evidence")
            continue
        state = check.get("status")
        if state not in STATES:
            r.error("check_status", locator, "invalid check status")
        evidence = list_field(check, "evidence", r, locator, True)
        if state == "failed":
            r.error("failed_check", locator, "resolve failed check before delivery")
        if state in ["not_run", "partial"]:
            r.warning("check_incomplete", locator, "check is not complete; do not report it passed")
        if state == "not_applicable" and name == "audio" and plan.get("output", {}).get("audio") == "required":
            r.error("required_audio_check", locator, "required audio cannot be not_applicable")
        if state == "not_applicable" and name in ["structure", "semantic", "visual", "playback"] and videos:
            r.warning("check_not_applicable", locator, "explain why a video delivery does not need this check")
        if state == "passed" and not evidence:
            r.error("passed_without_evidence", locator, "passed needs a local evidence path or an observation record")
        if name == "audio" and state == "passed" and any(
                narration.get("timing") == "estimated"
                for scene in plan.get("scenes", []) for narration in scene.get("narration", [])):
            r.error("estimated_audio_acceptance", locator, "retime estimated narration against actual audio before passing synchronization")
        for j, entry in enumerate(evidence):
            ep = locator + f".evidence[{j}]"
            if isinstance(entry, dict):
                if nonempty(entry.get("path")):
                    file = resolve_path(manifest_path.parent, entry["path"])
                    if not file.is_file():
                        r.error("evidence_missing", ep, "evidence file does not exist: " + str(file))
                elif not nonempty(entry.get("observation")):
                    r.error("evidence_record", ep, "record needs path or observation")
            elif nonempty(entry):
                # Prefer explicit records for prose. Strings containing path syntax are file references.
                if entry.startswith("observation:"):
                    if not entry[len("observation:"):].strip():
                        r.error("evidence_record", ep, "empty observation")
                elif not resolve_path(manifest_path.parent, entry).is_file():
                    r.error("evidence_missing", ep, "string evidence must resolve to a local file; use {observation: ...} for prose")
            else:
                r.error("evidence_record", ep, "expected path string or observation object")
    # Record verification never certifies the truth of a human observation or continuous playback.
    result = r.result(scope="delivery-records-and-metadata" if probe else "delivery-records",
                      plan_sha256=plan_hash, outputs=resolved_outputs, probes=probes,
                      media_verified=False, playback_verified=False,
                      limitation="Records and optional ffprobe metadata only; no playback, visual/audio assessment or comprehension test performed.")
    if result["valid"]:
        result["status"] = "partial"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan")
    parser.add_argument("delivery")
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--require-video", action="store_true")
    parser.add_argument("--catalog-dir", help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        result = check_delivery(args.plan, args.delivery, args.probe, args.require_video, args.catalog_dir)
    except (OSError, ValueError, TypeError) as exc:
        result = dict(schema_version=1, valid=False, status="failed", errors=[dict(code="read_error", path="$", message=str(exc))], warnings=[])
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0 if result["valid"] else 1


if __name__ == "__main__":
    sys.exit(main())
