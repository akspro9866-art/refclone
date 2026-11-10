#!/usr/bin/env python3
"""Deterministic validator for the SaaS reference-video analysis workflow.

Two modes:

  --preflight <video1> ... <video10>
      Verify the batch contains 5-10 existing video files with valid extensions.
      Probe each file with ffprobe and emit one JSON object containing per-video
      resolution, FPS, aspect ratio, duration, and the batch's modal
      baseline_resolution / baseline_fps.

  --validate <path/to/preset.json>
      Validate the style library against preset.schema.json, verify every
      preset_id exists in cavalry-mcp's resolved preset_manifest.json, and verify
      the companion SKILL.md exists and starts with valid YAML frontmatter.

Exit codes: 0 only when every check passes; 1 on any validation/preflight
failure; 2 for command-line usage errors (argparse).

The script is dependency-free (standard library only) and resolves the preset
manifest from --manifest, CAVALRY_PRESET_MANIFEST, the current user's home
directory (cavalry-mcp/dist/presets/preset_manifest.json), and ancestors of the
current working directory (including the current repository's own
dist/presets/preset_manifest.json).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from collections import Counter
from fractions import Fraction
from pathlib import Path
from typing import Any, Iterable

SCRIPT_DIR = Path(__file__).resolve().parent
SCHEMA_PATH = SCRIPT_DIR / "preset.schema.json"
HOME = Path.home()

VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm"}
MIN_VIDEOS = 5
MAX_VIDEOS = 10
NON_SAAS_REFUSAL = "This library is SaaS-only. Remove non-SaaS video and retry."


class ManifestError(RuntimeError):
    """Raised when no readable preset_manifest.json can be resolved."""


# ---------------------------------------------------------------------------
# Manifest resolution
# ---------------------------------------------------------------------------


def _unique_paths(candidates: Iterable[Path]) -> Iterable[Path]:
    seen: set[str] = set()
    for candidate in candidates:
        key = os.path.normcase(str(candidate))
        if key in seen:
            continue
        seen.add(key)
        yield candidate


def manifest_candidates(explicit: str | None = None) -> Iterable[Path]:
    """Yield manifest candidates in deterministic priority order."""
    if explicit:
        yield Path(explicit).expanduser()

    env_path = os.environ.get("CAVALRY_PRESET_MANIFEST")
    if env_path:
        yield Path(env_path).expanduser()

    # Path.home() is the portable default: it needs no username literal and
    # covers the standard sibling layout used by this workflow.
    yield HOME / "cavalry-mcp" / "dist" / "presets" / "preset_manifest.json"
    yield HOME / "cavalry-mcp" / "preset_manifest.json"

    for base in (Path.cwd(), SCRIPT_DIR):
        try:
            resolved = base.resolve()
        except OSError:
            resolved = base
        for parent in (resolved, *resolved.parents):
            yield parent / "dist" / "presets" / "preset_manifest.json"
            yield parent / "cavalry-mcp" / "dist" / "presets" / "preset_manifest.json"
            yield parent / "cavalry-mcp" / "preset_manifest.json"
            yield parent / "preset_manifest.json"


def resolve_manifest_path(explicit: str | None = None) -> Path:
    tried: list[str] = []
    for candidate in _unique_paths(manifest_candidates(explicit)):
        tried.append(str(candidate))
        if candidate.is_file():
            return candidate.resolve()
    raise ManifestError(
        "could not resolve cavalry-mcp preset_manifest.json. "
        "Pass --manifest <path> or set CAVALRY_PRESET_MANIFEST. Tried:\n  "
        + "\n  ".join(tried)
    )


def load_manifest(path: Path) -> tuple[set[str], dict[str, Any]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except OSError as exc:
        raise ManifestError(f"cannot read manifest {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ManifestError(f"manifest is not valid JSON ({path}): {exc}") from exc

    if not isinstance(data, dict):
        raise ManifestError(f"manifest root must be an object: {path}")
    entries = data.get("presets")
    if not isinstance(entries, list):
        raise ManifestError(f"manifest has no presets array: {path}")

    ids: set[str] = set()
    for entry in entries:
        preset_id: str | None = None
        if isinstance(entry, str):
            preset_id = entry.split("|", 1)[0].strip()
        elif isinstance(entry, dict):
            raw = entry.get("id") or entry.get("preset_id") or entry.get("name")
            if raw is not None:
                preset_id = str(raw).strip()
        if preset_id:
            ids.add(preset_id)

    if not ids:
        raise ManifestError(f"manifest contains no preset ids: {path}")
    return ids, data


# ---------------------------------------------------------------------------
# JSON Schema (draft-07 subset) validation
# ---------------------------------------------------------------------------


def _json_type_name(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def _type_matches(value: Any, expected: str) -> bool:
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    return True


def _child_path(path: str, key: str) -> str:
    return f"{path}.{key}" if path != "$" else f"$.{key}"


def _resolve_ref(root: Any, ref: str) -> Any:
    if not ref.startswith("#/"):
        return None
    node = root
    for raw_part in ref[2:].split("/"):
        part = raw_part.replace("~1", "/").replace("~0", "~")
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def _validate_schema_node(
    instance: Any,
    schema: Any,
    path: str,
    root: Any,
    errors: list[str],
) -> None:
    if schema is True:
        return
    if schema is False:
        errors.append(f"{path}: value is not allowed")
        return
    if not isinstance(schema, dict):
        errors.append(f"{path}: invalid schema node {schema!r}")
        return

    if "$ref" in schema:
        target = _resolve_ref(root, str(schema["$ref"]))
        if target is None:
            errors.append(f"{path}: unresolved $ref {schema['$ref']!r}")
        else:
            _validate_schema_node(instance, target, path, root, errors)
        return

    for sub in schema.get("allOf", []) or []:
        _validate_schema_node(instance, sub, path, root, errors)

    if "anyOf" in schema:
        branches = schema.get("anyOf") or []
        passed = 0
        for sub in branches:
            local: list[str] = []
            _validate_schema_node(instance, sub, path, root, local)
            if not local:
                passed += 1
        if passed == 0:
            errors.append(f"{path}: value does not match any 'anyOf' branch")

    if "oneOf" in schema:
        branches = schema.get("oneOf") or []
        passed = 0
        for sub in branches:
            local = []
            _validate_schema_node(instance, sub, path, root, local)
            if not local:
                passed += 1
        if passed != 1:
            errors.append(f"{path}: value matches {passed} 'oneOf' branches; expected exactly 1")

    if "not" in schema:
        local = []
        _validate_schema_node(instance, schema["not"], path, root, local)
        if not local:
            errors.append(f"{path}: value matches a forbidden 'not' schema")

    expected_type = schema.get("type")
    if expected_type is not None:
        types = expected_type if isinstance(expected_type, list) else [expected_type]
        if not any(_type_matches(instance, str(t)) for t in types):
            errors.append(
                f"{path}: expected type {'/'.join(map(str, types))}, "
                f"got {_json_type_name(instance)}"
            )
            return

    if "const" in schema and instance != schema["const"]:
        errors.append(f"{path}: expected const {schema['const']!r}, got {instance!r}")

    if "enum" in schema and instance not in (schema.get("enum") or []):
        errors.append(f"{path}: value {instance!r} is not in enum {schema['enum']!r}")

    if isinstance(instance, str):
        pattern = schema.get("pattern")
        if isinstance(pattern, str):
            try:
                if re.search(pattern, instance) is None:
                    errors.append(
                        f"{path}: string {instance!r} does not match pattern {pattern!r}"
                    )
            except re.error as exc:
                errors.append(f"{path}: invalid schema pattern {pattern!r}: {exc}")
        min_length = schema.get("minLength")
        if isinstance(min_length, int) and len(instance) < min_length:
            errors.append(f"{path}: string is shorter than minLength {min_length}")
        max_length = schema.get("maxLength")
        if isinstance(max_length, int) and len(instance) > max_length:
            errors.append(f"{path}: string is longer than maxLength {max_length}")

    if isinstance(instance, (int, float)) and not isinstance(instance, bool):
        minimum = schema.get("minimum")
        if isinstance(minimum, (int, float)) and instance < minimum:
            errors.append(f"{path}: {instance!r} is less than minimum {minimum!r}")
        maximum = schema.get("maximum")
        if isinstance(maximum, (int, float)) and instance > maximum:
            errors.append(f"{path}: {instance!r} is greater than maximum {maximum!r}")
        exclusive_minimum = schema.get("exclusiveMinimum")
        if isinstance(exclusive_minimum, (int, float)) and instance <= exclusive_minimum:
            errors.append(f"{path}: {instance!r} is not greater than exclusiveMinimum {exclusive_minimum!r}")
        exclusive_maximum = schema.get("exclusiveMaximum")
        if isinstance(exclusive_maximum, (int, float)) and instance >= exclusive_maximum:
            errors.append(f"{path}: {instance!r} is not less than exclusiveMaximum {exclusive_maximum!r}")

    if isinstance(instance, list):
        min_items = schema.get("minItems")
        if isinstance(min_items, int) and len(instance) < min_items:
            errors.append(f"{path}: array has fewer than minItems {min_items}")
        max_items = schema.get("maxItems")
        if isinstance(max_items, int) and len(instance) > max_items:
            errors.append(f"{path}: array has more than maxItems {max_items}")
        if schema.get("uniqueItems") is True:
            seen: list[Any] = []
            for index, item in enumerate(instance):
                if item in seen:
                    errors.append(f"{path}[{index}]: duplicate array item {item!r}")
                else:
                    seen.append(item)
        items = schema.get("items")
        if isinstance(items, dict):
            for index, item in enumerate(instance):
                _validate_schema_node(item, items, f"{path}[{index}]", root, errors)
        elif isinstance(items, list):
            for index, sub_schema in enumerate(items):
                if index < len(instance):
                    _validate_schema_node(instance[index], sub_schema, f"{path}[{index}]", root, errors)

    if isinstance(instance, dict):
        for key in schema.get("required", []) or []:
            if key not in instance:
                errors.append(f"{path}: missing required property {key!r}")

        properties = schema.get("properties") or {}
        for key, sub_schema in properties.items():
            if key in instance:
                _validate_schema_node(instance[key], sub_schema, _child_path(path, key), root, errors)

        additional = schema.get("additionalProperties", True)
        if additional is False:
            for key in instance:
                if key not in properties:
                    errors.append(f"{path}: unexpected property {key!r}")
        elif isinstance(additional, dict):
            for key in instance:
                if key not in properties:
                    _validate_schema_node(instance[key], additional, _child_path(path, key), root, errors)

        for pattern, sub_schema in (schema.get("patternProperties") or {}).items():
            try:
                regex = re.compile(pattern)
            except re.error:
                continue
            for key, value in instance.items():
                if regex.search(key):
                    _validate_schema_node(value, sub_schema, _child_path(path, key), root, errors)


def validate_against_schema(instance: Any, schema: Any) -> list[str]:
    errors: list[str] = []
    _validate_schema_node(instance, schema, "$", schema, errors)
    return errors


# ---------------------------------------------------------------------------
# YAML frontmatter (the small subset used by SKILL.md files)
# ---------------------------------------------------------------------------


def parse_frontmatter(text: str) -> tuple[dict[str, str] | None, str | None, str | None]:
    """Return (frontmatter, body, error) for a simple key: value frontmatter."""
    text = text.lstrip("\ufeff")
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None, None, "does not start with a YAML frontmatter delimiter '---'"

    closing: int | None = None
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            closing = index
            break
    if closing is None:
        return None, None, "YAML frontmatter has no closing '---'"

    frontmatter_lines = lines[1:closing]
    if not any(line.strip() for line in frontmatter_lines):
        return None, None, "YAML frontmatter is empty"

    data: dict[str, str] = {}
    for line_number, line in enumerate(frontmatter_lines, start=2):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line[:1].isspace():
            return None, None, f"line {line_number}: nested/indented YAML is not supported"
        if ":" not in line:
            return None, None, f"line {line_number}: expected 'key: value'"
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            return None, None, f"line {line_number}: empty frontmatter key"
        if value[:1] in {"'", '"'}:
            if len(value) < 2 or value[-1] != value[0]:
                return None, None, f"line {line_number}: unterminated quoted value"
            value = value[1:-1]
        data[key] = value

    body = "\n".join(lines[closing + 1 :])
    return data, body, None


# ---------------------------------------------------------------------------
# Post-extraction validation
# ---------------------------------------------------------------------------


def _preset_summary(preset: Any) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "style_name": None,
        "preset_count": 0,
        "core": 0,
        "optional": 0,
    }
    if not isinstance(preset, dict):
        return summary
    summary["style_name"] = preset.get("style_name")
    entries = preset.get("presets")
    if isinstance(entries, list):
        summary["preset_count"] = len(entries)
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            if entry.get("tier") == "CORE":
                summary["core"] += 1
            elif entry.get("tier") == "OPTIONAL":
                summary["optional"] += 1
    return summary


def validate_preset_library(preset_path: Path, manifest_path: Path) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    result: dict[str, Any] = {
        "mode": "validate",
        "ok": False,
        "preset_path": str(preset_path),
        "manifest_path": str(manifest_path),
        "schema_path": str(SCHEMA_PATH),
        "manifest_preset_ids": 0,
        "errors": errors,
        "warnings": warnings,
        "summary": {},
    }

    if not preset_path.is_file():
        errors.append(f"preset file does not exist: {preset_path}")
        return result

    try:
        preset = json.loads(preset_path.read_text(encoding="utf-8-sig"))
    except OSError as exc:
        errors.append(f"cannot read preset file {preset_path}: {exc}")
        return result
    except json.JSONDecodeError as exc:
        errors.append(f"preset file is not valid JSON ({preset_path}): {exc}")
        return result

    if not isinstance(preset, dict):
        errors.append("preset.json root must be a JSON object")
        return result

    result["summary"] = _preset_summary(preset)

    # 1. Schema compliance.
    if not SCHEMA_PATH.is_file():
        errors.append(f"schema file is missing: {SCHEMA_PATH}")
    else:
        try:
            schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"cannot read schema {SCHEMA_PATH}: {exc}")
        else:
            if not isinstance(schema, dict):
                errors.append(f"schema root must be a JSON object: {SCHEMA_PATH}")
            else:
                errors.extend(validate_against_schema(preset, schema))

    # 2. Every preset_id must exist in the manifest.
    try:
        manifest_ids, manifest_data = load_manifest(manifest_path)
    except ManifestError as exc:
        errors.append(str(exc))
        manifest_ids = set()
        manifest_data = {}
    result["manifest_preset_ids"] = len(manifest_ids)

    entries = preset.get("presets")
    if isinstance(entries, list):
        seen_ids: dict[str, int] = {}
        for index, entry in enumerate(entries):
            if not isinstance(entry, dict):
                continue
            preset_id = entry.get("preset_id")
            if not isinstance(preset_id, str) or not preset_id.strip():
                continue
            preset_id = preset_id.strip()

            if preset_id in seen_ids:
                errors.append(
                    f"$.presets[{index}].preset_id: duplicate preset_id {preset_id!r} "
                    f"(first seen at index {seen_ids[preset_id]})"
                )
            else:
                seen_ids[preset_id] = index

            if manifest_ids and preset_id not in manifest_ids:
                errors.append(
                    f"$.presets[{index}].preset_id: {preset_id!r} is not present in "
                    f"{manifest_path}"
                )

            occurrences = entry.get("occurrences")
            if isinstance(occurrences, str) and not re.fullmatch(r"\d+\s*/\s*\d+", occurrences):
                warnings.append(
                    f"$.presets[{index}].occurrences: {occurrences!r} does not look like "
                    "'<matched>/<total>'"
                )
            tier = entry.get("tier")
            if tier == "CORE":
                matched = _first_int(occurrences)
                if matched is not None and matched < 2:
                    warnings.append(
                        f"$.presets[{index}].tier is CORE but occurrences says {occurrences!r} "
                        "(CORE requires 2+ reference videos)"
                    )

        if not entries:
            warnings.append("$.presets is empty; the library has no mapped presets")

    # 3. Companion SKILL.md must exist and start with valid YAML frontmatter.
    skill_path = preset_path.parent / "SKILL.md"
    if not skill_path.is_file():
        errors.append(f"companion SKILL.md is missing: {skill_path}")
    else:
        try:
            skill_text = skill_path.read_text(encoding="utf-8-sig")
        except OSError as exc:
            errors.append(f"cannot read companion SKILL.md {skill_path}: {exc}")
        else:
            frontmatter, body, frontmatter_error = parse_frontmatter(skill_text)
            if frontmatter_error:
                errors.append(f"{skill_path}: {frontmatter_error}")
            elif frontmatter is not None:
                for key in ("name", "description"):
                    if not frontmatter.get(key):
                        errors.append(f"{skill_path}: frontmatter is missing non-empty {key!r}")
                name = frontmatter.get("name")
                style_name = preset.get("style_name")
                if name and style_name and name != style_name:
                    warnings.append(
                        f"{skill_path}: frontmatter name {name!r} does not match "
                        f"style_name {style_name!r}"
                    )
                if body is not None:
                    required_sections = (
                        "SaaS Scope Lock",
                        "Project DNA",
                        "Pacing",
                        "Core vs. Optional",
                        "Asset Prompts",
                    )
                    lowered = body.lower()
                    for section in required_sections:
                        if section.lower() not in lowered:
                            warnings.append(
                                f"{skill_path}: expected section {section!r} was not found"
                            )

    # 4. Cross-file sanity checks that catch honest naming mistakes.
    style_name = preset.get("style_name")
    if isinstance(style_name, str) and style_name != preset_path.parent.name:
        warnings.append(
            f"style_name {style_name!r} does not match containing folder name "
            f"{preset_path.parent.name!r}"
        )
    fallback_font = preset.get("fallback_font")
    if isinstance(fallback_font, str) and fallback_font not in {"Inter", "Manrope"}:
        warnings.append(
            f"$.fallback_font: {fallback_font!r} is not one of the required fallbacks "
            "('Inter' or 'Manrope')"
        )

    result["ok"] = not errors
    return result


def _first_int(value: Any) -> int | None:
    if not isinstance(value, str):
        return None
    match = re.match(r"\s*(\d+)", value)
    return int(match.group(1)) if match else None


# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------


def _parse_rate(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    text = str(value).strip()
    if not text or text in {"0/0", "N/A", "nan", "NaN"}:
        return None
    try:
        return float(Fraction(text))
    except (ValueError, ZeroDivisionError):
        try:
            return float(text)
        except ValueError:
            return None


def _parse_sar(value: Any) -> tuple[int, int]:
    if not isinstance(value, str) or ":" not in value:
        return (1, 1)
    left, right = value.split(":", 1)
    try:
        x, y = int(left), int(right)
    except ValueError:
        return (1, 1)
    return (x, y) if x > 0 and y > 0 else (1, 1)


def _aspect_ratio(width: int | None, height: int | None, sar: tuple[int, int]) -> str | None:
    if not width or not height:
        return None
    fraction = Fraction(width * sar[0], height * sar[1])
    return f"{fraction.numerator}:{fraction.denominator}"


def _rotation_degrees(stream: dict[str, Any]) -> int:
    for side_data in stream.get("side_data_list") or []:
        if isinstance(side_data, dict) and "rotation" in side_data:
            try:
                return int(round(float(side_data["rotation"])))
            except (TypeError, ValueError):
                pass
    tags = stream.get("tags") or {}
    if isinstance(tags, dict) and "rotate" in tags:
        try:
            return int(round(float(tags["rotate"])))
        except (TypeError, ValueError):
            pass
    return 0


def _float_or_none(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_probe_payload(probe: Any, record: dict[str, Any]) -> dict[str, Any]:
    """Parse one ffprobe JSON payload into the per-video record.

    Kept separate from probe_video so the metadata logic can be exercised with a
    synthetic payload without decoding any media file.
    """
    if not isinstance(probe, dict):
        record["error"] = "ffprobe returned a non-object JSON payload"
        return record

    streams = probe.get("streams") or []
    stream = next(
        (item for item in streams if isinstance(item, dict) and item.get("codec_type") == "video"),
        None,
    )
    if stream is None:
        record["error"] = "no video stream found"
        return record

    source_width = stream.get("width")
    source_height = stream.get("height")
    source_width = int(source_width) if isinstance(source_width, (int, float)) else None
    source_height = int(source_height) if isinstance(source_height, (int, float)) else None

    rotation = _rotation_degrees(stream)
    display_width, display_height = source_width, source_height
    if rotation % 180 != 0:
        display_width, display_height = source_height, source_width

    average_rate = _parse_rate(stream.get("avg_frame_rate"))
    nominal_rate = _parse_rate(stream.get("r_frame_rate"))
    fps = average_rate or nominal_rate
    if average_rate and nominal_rate and abs(average_rate - nominal_rate) > 0.01:
        fps_mode = "variable"
    elif average_rate:
        fps_mode = "average"
    elif nominal_rate:
        fps_mode = "nominal"
    else:
        fps_mode = "unknown"

    duration = None
    format_info = probe.get("format") or {}
    if isinstance(format_info, dict):
        duration = _float_or_none(format_info.get("duration"))
    if duration is None:
        duration = _float_or_none(stream.get("duration"))

    nb_frames = None
    raw_frames = stream.get("nb_frames")
    if raw_frames is not None:
        try:
            nb_frames = int(raw_frames)
        except (TypeError, ValueError):
            nb_frames = None

    sar = _parse_sar(stream.get("sample_aspect_ratio"))

    record.update(
        {
            "probe_ok": True,
            "error": None,
            "codec": stream.get("codec_name"),
            "width": display_width,
            "height": display_height,
            "source_width": source_width,
            "source_height": source_height,
            "rotation": rotation,
            "resolution": (
                f"{display_width}x{display_height}" if display_width and display_height else None
            ),
            "aspect_ratio": _aspect_ratio(display_width, display_height, sar),
            "fps": round(fps, 3) if fps is not None else None,
            "fps_mode": fps_mode,
            "duration_seconds": round(duration, 3) if duration is not None else None,
            "nb_frames": nb_frames,
        }
    )
    return record


def probe_video(path: Path, ffprobe_bin: str | None) -> dict[str, Any]:
    record: dict[str, Any] = {
        "path": str(path),
        "exists": path.is_file(),
        "extension": path.suffix.lower(),
        "valid_extension": path.suffix.lower() in VIDEO_EXTENSIONS,
        "probe_ok": False,
        "error": None,
        "codec": None,
        "width": None,
        "height": None,
        "source_width": None,
        "source_height": None,
        "rotation": 0,
        "resolution": None,
        "aspect_ratio": None,
        "fps": None,
        "fps_mode": None,
        "duration_seconds": None,
        "nb_frames": None,
    }

    if not record["exists"]:
        record["error"] = "file does not exist"
        return record
    if not record["valid_extension"]:
        allowed = ", ".join(sorted(VIDEO_EXTENSIONS))
        record["error"] = f"unsupported video extension {path.suffix!r}; allowed: {allowed}"
        return record
    if not ffprobe_bin:
        record["error"] = "ffprobe was not found on PATH (set FFPROBE_BIN)"
        return record

    command = [
        ffprobe_bin,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        str(path),
    ]
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
            check=False,
        )
    except FileNotFoundError:
        record["error"] = f"ffprobe executable not found: {ffprobe_bin}"
        return record
    except subprocess.TimeoutExpired:
        record["error"] = "ffprobe timed out after 60 seconds"
        return record
    except OSError as exc:
        record["error"] = f"ffprobe could not run: {exc}"
        return record

    if completed.returncode != 0:
        detail = (completed.stderr or "").strip().splitlines()
        record["error"] = "ffprobe failed: " + (detail[-1] if detail else f"exit {completed.returncode}")
        return record

    try:
        probe = json.loads(completed.stdout)
    except json.JSONDecodeError:
        record["error"] = "ffprobe returned invalid JSON"
        return record

    return parse_probe_payload(probe, record)


def _resolution_sort_key(value: str) -> tuple[int, int, int]:
    match = re.fullmatch(r"(\d+)x(\d+)", value or "")
    if not match:
        return (0, 0, 0)
    width, height = int(match.group(1)), int(match.group(2))
    return (width * height, width, height)


def _modal(values: list[Any], sort_key) -> tuple[Any | None, list[Any]]:
    counter = Counter(values)
    if not counter:
        return None, []
    highest = max(counter.values())
    tied = [value for value, count in counter.items() if count == highest]
    return max(tied, key=sort_key), tied


def run_preflight(raw_inputs: list[str]) -> int:
    errors: list[str] = []
    warnings: list[str] = []

    ffprobe_bin = os.environ.get("FFPROBE_BIN") or shutil.which("ffprobe")
    if not ffprobe_bin:
        errors.append("ffprobe was not found on PATH (set FFPROBE_BIN)")

    videos: list[Path] = []
    for raw in raw_inputs:
        path = Path(raw).expanduser()
        if path.is_dir():
            directory_videos = sorted(
                child
                for child in path.iterdir()
                if child.is_file() and child.suffix.lower() in VIDEO_EXTENSIONS
            )
            if not directory_videos:
                errors.append(
                    f"directory contains no {', '.join(sorted(VIDEO_EXTENSIONS))} files: {path}"
                )
            videos.extend(directory_videos)
        else:
            videos.append(path)

    count = len(videos)
    if count < MIN_VIDEOS or count > MAX_VIDEOS:
        errors.append(
            f"video count {count} is outside the required {MIN_VIDEOS}-{MAX_VIDEOS} range "
            f"(inclusive); {MIN_VIDEOS} to {MAX_VIDEOS} paths are required"
        )

    normalized_inputs = [str(path) for path in videos]
    duplicates = sorted(
        {value for value in normalized_inputs if normalized_inputs.count(value) > 1}
    )
    for duplicate in duplicates:
        warnings.append(f"duplicate video path: {duplicate}")

    records: list[dict[str, Any]] = []
    for path in videos:
        record = probe_video(path, ffprobe_bin)
        records.append(record)
        if record["error"]:
            errors.append(f"{record['path']}: {record['error']}")

    resolutions = [
        record["resolution"]
        for record in records
        if record.get("probe_ok") and record.get("resolution")
    ]
    frame_rates = [
        record["fps"]
        for record in records
        if record.get("probe_ok") and record.get("fps") is not None
    ]

    baseline_resolution, resolution_ties = _modal(resolutions, _resolution_sort_key)
    baseline_fps, fps_ties = _modal(frame_rates, float)

    payload = {
        "mode": "preflight",
        "ok": not errors,
        "required_count": {"min": MIN_VIDEOS, "max": MAX_VIDEOS},
        "count": count,
        "inputs": [str(item) for item in raw_inputs],
        "videos": records,
        "baseline_resolution": baseline_resolution,
        "baseline_fps": baseline_fps,
        "modal_ties": {
            "resolution": resolution_ties,
            "fps": fps_ties,
        },
        "normalization": "normalized_frames = round(raw_frames * (baseline_fps / video_fps))",
        "warnings": warnings,
        "errors": errors,
    }
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0 if payload["ok"] else 1


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="validate_output.py",
        description=(
            "Validate a SaaS reference-video batch or a generated SaaS style library. "
            "Dependency-free; ffprobe is required for --preflight."
        ),
    )
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument(
        "--preflight",
        nargs="*",
        metavar="VIDEO",
        help=(
            "5-10 video paths (directories expand to their top-level .mp4/.mov/.mkv/.webm files). "
            "Emits a JSON metadata summary with modal baseline_resolution and baseline_fps."
        ),
    )
    modes.add_argument(
        "--validate",
        metavar="PRESET_JSON",
        help="Validate a generated .qoder/skills/<style>/preset.json style library.",
    )
    parser.add_argument(
        "--manifest",
        metavar="PATH",
        help=(
            "Explicit cavalry-mcp preset_manifest.json path. Defaults to "
            "CAVALRY_PRESET_MANIFEST, the user's cavalry-mcp dist path, then ancestors."
        ),
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit the --validate result as one JSON object instead of text.",
    )
    args = parser.parse_args(argv)

    try:
        if args.preflight is not None:
            return run_preflight(args.preflight)

        try:
            manifest_path = resolve_manifest_path(args.manifest)
        except ManifestError as exc:
            payload = {
                "mode": "validate",
                "ok": False,
                "preset_path": str(Path(args.validate).expanduser()),
                "errors": [str(exc)],
                "warnings": [],
            }
            if args.json:
                print(json.dumps(payload, indent=2, ensure_ascii=False))
            else:
                print("VALIDATION FAILED")
                print(f"- {exc}")
            return 1

        result = validate_preset_library(Path(args.validate).expanduser(), manifest_path)
        if args.json:
            print(json.dumps(result, indent=2, ensure_ascii=False))
        else:
            print(f"Preset:   {result['preset_path']}")
            print(f"Manifest: {result['manifest_path']} ({result['manifest_preset_ids']} preset ids)")
            print(f"Schema:   {result['schema_path']}")
            summary = result.get("summary") or {}
            if summary:
                print(
                    "Summary:  style_name={style_name!r}, presets={preset_count}, "
                    "CORE={core}, OPTIONAL={optional}".format(**summary)
                )
            for warning in result.get("warnings", []):
                print(f"WARN: {warning}")
            if result["errors"]:
                print("VALIDATION FAILED")
                for error in result["errors"]:
                    print(f"- {error}")
            else:
                print("VALIDATION PASSED")
        return 0 if result["ok"] else 1

    except KeyboardInterrupt:
        print("VALIDATION FAILED", file=sys.stderr)
        print("- interrupted", file=sys.stderr)
        return 1
    except Exception as exc:  # Keep the CLI honest even on an unexpected bug.
        print("VALIDATION FAILED", file=sys.stderr)
        print(f"- internal error: {type(exc).__name__}: {exc}", file=sys.stderr)
        if os.environ.get("SAAS_VALIDATOR_DEBUG"):
            import traceback

            traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
