"""Recipe-owned music policy. Selection only; never mutates a pool or renders."""
import hashlib
import math
import wave
from pathlib import Path


def validate_policy(policy, track_ids=None):
    errors = []
    if not isinstance(policy, dict):
        return ["music_policy must be an object"]
    candidates = policy.get("candidate_track_ids")
    if not isinstance(candidates, list) or not candidates or any(
            not isinstance(x, str) or not x.strip() for x in candidates):
        errors.append("candidate_track_ids must be a nonempty array of track IDs")
        candidates = []
    elif len(candidates) != len(set(candidates)):
        errors.append("candidate_track_ids contains duplicates")
    default = policy.get("default_track_id")
    if not isinstance(default, str) or default not in candidates:
        errors.append("default_track_id must be one of candidate_track_ids")
    if policy.get("planning_mode") not in ("music_first", "content_first", "adaptive"):
        errors.append("planning_mode must be music_first, content_first or adaptive")
    if type(policy.get("default_requires_confirmation")) is not bool:
        errors.append("default_requires_confirmation must be boolean")
    if track_ids is not None:
        for track_id in candidates:
            if track_id not in track_ids:
                errors.append("unresolved music track ID: " + track_id)
    return errors


def select_music(recipe, library, requested_track_id=None, project_track_id=None, music_mode="auto"):
    """User choice > existing project choice > recipe default. Pure metadata routing."""
    if music_mode not in ("auto", "silent", "original"):
        raise ValueError("unknown music mode")
    policy = recipe.get("music_policy")
    tracks = {row["id"]: row for row in library["items"]}
    if policy is not None:
        errors = validate_policy(policy, tracks)
        if errors:
            raise ValueError("; ".join(errors))
    base = dict(recipe_id=recipe["id"], recipe_name=recipe.get("name", recipe["id"]),
                music_mode=music_mode, planning_mode=(policy or {}).get("planning_mode", "adaptive"),
                default_track_id=(policy or {}).get("default_track_id"),
                candidate_track_ids=list((policy or {}).get("candidate_track_ids", [])),
                policy_mutated=False, subjective_listening="not_run")
    if music_mode != "auto":
        if requested_track_id:
            raise ValueError("explicit music and silent/original mode conflict")
        return dict(base, selected_track_id=None, selection_source=music_mode,
                    requires_confirmation=False)
    if requested_track_id:
        selected, origin = requested_track_id, "user_specified"
    elif project_track_id:
        selected, origin = project_track_id, "project_selected"
    elif policy:
        selected, origin = policy["default_track_id"], "recipe_default"
    else:
        raise ValueError("recipe has no default music; specify a track or source file")
    if selected not in tracks:
        raise ValueError("unknown selected track ID: " + str(selected))
    track = tracks[selected]
    return dict(base, selected_track_id=selected, selection_source=origin, title=track["title"],
                source_sha256=track["sha256"], duration_seconds=track["duration_seconds"],
                is_recipe_candidate=selected in base["candidate_track_ids"],
                requires_confirmation=bool(origin == "recipe_default" and policy["default_requires_confirmation"]),
                adaptation_policy=track.get("selection_preference", {}).get("loop_policy", "plan_for_this_track"),
                rights_status=track.get("rights", {}).get("status", "unverified"))


def source_info(path):
    """Hash and read audio metadata only. WAV uses stdlib; other formats use existing ffprobe."""
    path = Path(path).expanduser().resolve()
    if not path.is_file():
        raise ValueError("selected music source file is missing: " + str(path))
    try:
        with wave.open(str(path), "rb") as handle:
            channels, rate = handle.getnchannels(), handle.getframerate()
            if channels <= 0 or rate <= 0:
                raise ValueError("selected audio channel count/rate must be positive")
            duration = handle.getnframes() / rate
    except (wave.Error, EOFError):
        from _media import MediaError, ffprobe_json
        try:
            data = ffprobe_json(path)
        except MediaError as exc:
            raise ValueError(str(exc)) from exc
        streams = [row for row in data.get("streams", []) if row.get("codec_type") == "audio"]
        if not streams:
            raise ValueError("selected source contains no audio stream")
        duration_value = streams[0].get("duration")
        if duration_value in (None, "N/A"):
            duration_value = data.get("format", {}).get("duration")
        try:
            duration = float(duration_value)
            channels = int(streams[0]["channels"])
            rate = int(streams[0]["sample_rate"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("selected audio duration/format is unavailable") from exc
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("selected audio duration must be finite and positive")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return dict(path=str(path), sha256=digest.hexdigest(), duration_seconds=duration,
                channels=channels, sample_rate=rate)


def select_source_file(recipe, library, path):
    """One-project override; does not add to the library, pool or change the default."""
    policy = recipe.get("music_policy")
    if policy is not None:
        errors = validate_policy(policy, {row["id"] for row in library["items"]})
        if errors:
            raise ValueError("; ".join(errors))
    info = source_info(path)
    return dict(status="ready", recipe_id=recipe["id"], recipe_name=recipe.get("name", recipe["id"]),
                music_mode="auto", planning_mode=(policy or {}).get("planning_mode", "adaptive"),
                default_track_id=(policy or {}).get("default_track_id"),
                candidate_track_ids=list((policy or {}).get("candidate_track_ids", [])),
                selected_track_id="project-" + info["sha256"][:16], title=Path(info["path"]).stem,
                selection_source="user_source_file", source_sha256=info["sha256"],
                duration_seconds=info["duration_seconds"], local_asset=info,
                is_recipe_candidate=False, requires_confirmation=False, policy_mutated=False,
                adaptation_policy="plan_for_this_track", rights_status="user_provided_scope_unverified",
                subjective_listening="not_run")
