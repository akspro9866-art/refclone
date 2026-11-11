#!/usr/bin/env python3
"""Production routing, read-only probes and project evidence checks. No installers."""
import argparse
import hashlib
import json
import re
import shutil
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAX_JSON = 2_000_000
REVIEW_STATUSES = {"not_run", "passed", "partial", "failed"}


def choice(value, allowed):
    return isinstance(value, str) and value in allowed


def read_json(path):
    with Path(path).open("rb") as stream:
        data = stream.read(MAX_JSON + 1)
    if len(data) > MAX_JSON:
        raise ValueError("JSON exceeds 2 MB budget")
    return json.loads(data, parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Non-finite JSON")))


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def registry():
    rows = read_json(ROOT / "catalog/production-tools.json")["tools"]
    if len({row["id"] for row in rows}) != len(rows):
        raise ValueError("Duplicate production tool ID")
    return {row["id"]: row for row in rows}


def route(task=None):
    rows = list(registry().values())
    tasks = sorted({task for row in rows for task in row["tasks"]})
    if task is not None and task not in tasks:
        raise ValueError("Unknown task; choose: " + ", ".join(tasks))
    return dict(schema_version=1, scope="guidance-not-runtime-proof", task=task,
                asset_order=["project-cache", "licensed-library", "adapt-existing", "make-missing"],
                tools=[row for row in rows if task is None or task in row["tasks"]])


def local_probe():
    ports = {}
    for name, port in (("blender-mcp", 9876), ("aivis-speech-engine", 10101)):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                ports[name] = dict(port=port, tcp_accepting=True, protocol="not_verified")
        except OSError:
            ports[name] = dict(port=port, tcp_accepting=False, protocol="not_verified")
    return dict(schema_version=1, scope="local-presence-only", ports=ports,
                executables={name: shutil.which(name) for name in ("blender", "ffmpeg", "ffprobe")},
                blender_mac_app_present=Path("/Applications/Blender.app").is_dir(),
                aivis_mac_app_present=Path("/Applications/AivisSpeech.app").is_dir(),
                mcp_connection="not_verified", import_render_listen="not_run")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Redirect not followed; inspect the endpoint before retrying")


def request_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "video-design-production-tools/1.0",
                                              "Accept": "application/json"})
    with urllib.request.build_opener(NoRedirect).open(req, timeout=15) as response:
        data = response.read(MAX_JSON + 1)
        if len(data) > MAX_JSON:
            raise ValueError("Metadata response exceeds 2 MB budget")
        return json.loads(data, parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Non-finite JSON")))


def polyhaven_search(query, asset_type, limit=5, cache_dir=None):
    if not choice(asset_type, {"hdris", "textures", "models"}) or not isinstance(query, str) or not query.strip():
        raise ValueError("Choose hdris/textures/models and a nonempty query")
    if not 1 <= limit <= 20:
        raise ValueError("limit must be between 1 and 20")
    url = "https://api.polyhaven.com/search?" + urllib.parse.urlencode({"q": query.strip(), "t": asset_type})
    cache = Path(cache_dir) / (hashlib.sha256(url.encode()).hexdigest() + ".json") if cache_dir else None
    payload, hit = None, False
    if cache and cache.is_file():
        try:
            stored = read_json(cache)
            age = time.time() - stored["fetched_at"]
            if stored.get("url") == url and 0 <= age < 3600 and isinstance(stored.get("payload"), dict):
                payload, hit = stored["payload"], True
        except (OSError, ValueError, KeyError, TypeError):
            pass
    if payload is None:
        payload = request_json(url)
        if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
            raise ValueError("Unexpected Poly Haven search response")
        if cache:
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(dict(url=url, fetched_at=time.time(), payload=payload), ensure_ascii=False))
    rows = payload.get("results")
    if not isinstance(rows, list):
        raise ValueError("Unexpected cached search response")
    candidates = []
    for row in rows:
        slug = row.get("slug") if isinstance(row, dict) else None
        if isinstance(slug, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", slug):
            candidates.append(dict(asset_id=slug, source="polyhaven", asset_type=asset_type,
                                   url="https://polyhaven.com/a/" + slug))
        if len(candidates) == limit:
            break
    return dict(schema_version=1, scope="public-api-metadata-only", query=query, asset_type=asset_type,
                source_url=url, cache_hit=hit, ranked_result_count=len(rows), candidates=candidates,
                mcp_search="not_run", downloaded=False, imported=False, visual_review="not_run")


def aivis_speakers(base_url="http://127.0.0.1:10101"):
    parsed = urllib.parse.urlsplit(base_url)
    if (parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
            or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}):
        raise ValueError("Only a local HTTP engine origin is supported")
    base = base_url.rstrip("/")
    rows = request_json(base + "/speakers")
    if not isinstance(rows, list):
        raise ValueError("Unexpected Aivis speakers response")
    speakers = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Unexpected speaker record")
        speakers.append(dict(name=row.get("name"), speaker_uuid=row.get("speaker_uuid"),
                             styles=[dict(id=x.get("id"), name=x.get("name"))
                                     for x in row.get("styles", []) if isinstance(x, dict)]))
    return dict(schema_version=1, scope="local-speaker-discovery-only", speakers=speakers,
                synthesis="not_run", model_rights="not_verified", listening="not_run")


def check_job(job, base_dir, require_reviewed=False):
    """Validate references and declared evidence. Does not verify truth or aesthetics."""
    errors, warnings = [], []
    base_dir = Path(base_dir)
    tools = registry()

    def issue(code, where, message, warning=False):
        (warnings if warning else errors).append(dict(code=code, path=where, message=message))

    def rows(field):
        value = job.get(field, [])
        if not isinstance(value, list):
            issue("array_required", field, "Expected an array")
            return []
        result, seen = [], set()
        for n, row in enumerate(value):
            loc = f"{field}[{n}]"
            if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not row["id"].strip():
                issue("id_required", loc, "Expected an object with a nonempty ID")
            elif row["id"] in seen:
                issue("duplicate_id", loc, "Duplicate ID")
            else:
                seen.add(row["id"])
                result.append((loc, row))
        return result

    def files(value, loc):
        if not isinstance(value, list) or not value:
            issue("evidence_required", loc, "Expected actual project evidence paths")
            return
        for item in value:
            if not isinstance(item, str) or not item.strip() or not (base_dir / item).is_file():
                issue("evidence_missing", loc, "Evidence file does not exist")

    def media(row, loc):
        path = row.get("path")
        if not isinstance(path, str) or not path.strip() or not (base_dir / path).is_file():
            issue("media_missing", loc, "Ready media must exist")
        elif file_hash(base_dir / path) != row.get("sha256"):
            issue("media_hash", loc, "Ready media hash is stale or missing")

    if not isinstance(job, dict):
        return dict(schema_version=1, valid=False, errors=[dict(code="object_required", path="$", message="Expected object")], warnings=[], scope="declared-production-evidence-only", media_review="not_run")
    if type(job.get("schema_version")) is not int or job["schema_version"] != 1:
        issue("schema_version", "$", "Expected integer schema_version 1")
    if not isinstance(job.get("project_id"), str) or not job["project_id"].strip():
        issue("project_id", "$", "Expected project identity")
    if "plan_path" in job or "plan_sha256" in job:
        path = job.get("plan_path")
        if not isinstance(path, str) or not (base_dir / path).is_file():
            issue("plan_missing", "plan_path", "Bound plan file must exist")
        elif file_hash(base_dir / path) != job.get("plan_sha256"):
            issue("stale_plan", "plan_sha256", "Sidecar does not match current plan bytes")
    for loc, row in rows("tool_choices"):
        tool = tools.get(row.get("tool_id")) if isinstance(row.get("tool_id"), str) else None
        if tool is None or row.get("task") not in tool["tasks"]:
            issue("tool_task", loc, "Tool is unknown or does not support this declared task")
        if not isinstance(row.get("reason"), str) or not row["reason"].strip():
            issue("selection_reason", loc, "Record the scene-specific choice")
    assets = {}
    for loc, row in rows("assets"):
        assets[row["id"]] = row
        if not choice(row.get("origin"), {"project", "user", "library", "generated", "procedural"}):
            issue("asset_origin", loc, "Record actual origin separately from action")
        if choice(row.get("action"), {"generate", "scratch"}) and not choice(row.get("origin"), {"generated", "procedural"}):
            issue("origin_action", loc, "Generated or scratch assets need the corresponding origin")
        if not choice(row.get("action"), {"reuse", "library", "adapt", "generate", "scratch"}):
            issue("asset_action", loc, "Unknown asset action")
        if not choice(row.get("role"), {"event-proof", "illustration", "model", "motion", "environment", "material", "audio"}):
            issue("asset_role", loc, "Unknown evidence or production role")
        if row.get("role") == "event-proof" and choice(row.get("origin"), {"generated", "procedural"}):
            issue("fabricated_evidence", loc, "Generated scenes cannot prove an event happened")
        if choice(row.get("action"), {"generate", "scratch"}):
            search = row.get("search", {})
            sources = search.get("sources") if isinstance(search, dict) else None
            if (not isinstance(search, dict) or not choice(search.get("status"), {"completed", "blocked"})
                    or not isinstance(sources, list) or not sources
                    or not all(isinstance(s, str) and s.strip() for s in sources)):
                issue("search_first", loc, "Record prior project/library search or its actual blocker")
            if not isinstance(row.get("gap_reason"), str) or not row["gap_reason"].strip():
                issue("asset_gap", loc, "Explain why existing assets cannot complete this shot")
        if not choice(row.get("status"), {"planned", "ready", "unavailable"}):
            issue("asset_status", loc, "Expected planned, ready or unavailable")
        if row.get("status") == "ready":
            media(row, loc)
            for key in ("source", "rights"):
                if not isinstance(row.get(key), str) or not row[key].strip():
                    issue("asset_provenance", loc + "." + key, "Record source and usage basis")
    for loc, row in rows("lighting_reviews"):
        if not isinstance(row.get("asset_id"), str) or row["asset_id"] not in assets:
            issue("lighting_asset", loc, "Environment asset ID is unknown")
        status = row.get("status")
        if not choice(status, REVIEW_STATUSES):
            issue("review_status", loc, "Invalid review status")
        elif status == "passed":
            for key in ("baseline_evidence", "candidate_evidence"):
                files(row.get(key), loc + "." + key)
            if row.get("baseline_evidence") == row.get("candidate_evidence"):
                issue("comparison_identity", loc, "Baseline and candidate must be distinct evidence")
            else:
                baseline, candidate = row.get("baseline_evidence"), row.get("candidate_evidence")
                if (isinstance(baseline, list) and baseline and isinstance(candidate, list) and candidate
                        and all(isinstance(p, str) and (base_dir / p).is_file() for p in baseline + candidate)
                        and {file_hash(base_dir / p) for p in baseline} == {file_hash(base_dir / p) for p in candidate}):
                    issue("comparison_identity", loc, "Renamed copies are not a visual comparison")
            if (not choice(row.get("scope"), {"still", "clip"})
                    or not isinstance(row.get("finding"), str) or not row["finding"].strip()):
                issue("visual_review_scope", loc, "Record actual scope and visual findings")
            if row.get("motion_continuity") == "passed" and row.get("scope") != "clip":
                issue("motion_scope", loc, "A still cannot verify moving reflections")
        else:
            issue("visual_pending", loc, "Lighting quality is not accepted by this record", not require_reviewed)
    for loc, row in rows("voice_jobs"):
        if not isinstance(row.get("tool_id"), str) or row["tool_id"] not in tools:
            issue("voice_tool", loc, "Unknown voice tool")
        if row.get("tool_id") == "aivis-speech-engine" and (row.get("language") != "ja" or row.get("mode") != "narration"):
            issue("aivis_scope", loc, "This adapter covers Japanese narration, not singing or rap")
        if not choice(row.get("status"), {"planned", "ready", "unavailable"}):
            issue("voice_status", loc, "Invalid voice state")
        if row.get("status") == "ready":
            media(row, loc)
            if not isinstance(row.get("model_rights"), str) or not row["model_rights"].strip():
                issue("voice_rights", loc, "Record model/voice usage basis separately")
        review = row.get("listening", {})
        if not isinstance(review, dict) or not choice(review.get("status"), REVIEW_STATUSES):
            issue("listening_record", loc, "Declare listening status explicitly")
        elif review["status"] == "passed":
            if row.get("status") != "ready":
                issue("listening_media", loc, "Accepted listening must refer to ready audio with current hash")
            files(review.get("evidence"), loc + ".listening")
            if not choice(review.get("method"), {"listened", "user-feedback"}):
                issue("listening_proxy", loc, "ASR, concatenation and waveform checks are not listening")
        else:
            issue("listening_pending", loc, "Speech naturalness is not accepted by this record", not require_reviewed)
    if not any(job.get(field) for field in ("tool_choices", "assets", "lighting_reviews", "voice_jobs")):
        issue("empty_job", "$", "Empty draft has no production evidence", not require_reviewed)
    return dict(schema_version=1, scope="declared-production-evidence-only", valid=not errors,
                errors=errors, warnings=warnings, media_review="not_run",
                note="Checks verify declarations and files, not factual truth, aesthetics or listening")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="command", required=True)
    listing = subs.add_parser("list")
    listing.add_argument("--task")
    subs.add_parser("probe")
    search = subs.add_parser("polyhaven-search")
    search.add_argument("--query", required=True)
    search.add_argument("--type", required=True, choices=["hdris", "textures", "models"])
    search.add_argument("--limit", type=int, default=5)
    search.add_argument("--cache-dir", type=Path, required=True, help="Project-owned metadata cache")
    speakers = subs.add_parser("aivis-speakers")
    speakers.add_argument("--base-url", default="http://127.0.0.1:10101")
    check = subs.add_parser("check")
    check.add_argument("job", type=Path)
    check.add_argument("--require-reviewed", action="store_true", help="Reject pending declared lighting/listening reviews")
    args = parser.parse_args()
    try:
        if args.command == "list":
            result = route(args.task)
        elif args.command == "probe":
            result = local_probe()
        elif args.command == "polyhaven-search":
            result = polyhaven_search(args.query, args.type, args.limit, args.cache_dir)
        elif args.command == "aivis-speakers":
            result = aivis_speakers(args.base_url)
        else:
            result = check_job(read_json(args.job), args.job.resolve().parent, args.require_reviewed)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2 if result.get("valid") is False else 0
    except urllib.error.HTTPError as exc:
        print(json.dumps(dict(schema_version=1, status="failed", error="HTTP " + str(exc.code),
                              retry_after=exc.headers.get("Retry-After"), retried=False)))
        return 2
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps(dict(schema_version=1, status="failed", error=str(exc), retried=False)))
        return 2


if __name__ == "__main__":
    sys.exit(main())
