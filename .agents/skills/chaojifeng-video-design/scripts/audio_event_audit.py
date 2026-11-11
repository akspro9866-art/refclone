#!/usr/bin/env python3
"""Compare declared sound events with the transients measured in a delivered file.

An event map says which visible action each sound belongs to (see templates/audio-event-map.json).
This tool decodes the audio, finds energy onsets, matches them one-to-one to the declared events
and reports how late or early each sound lands relative to its action. It also lists onsets that
no event explains.

It only measures timing. It cannot tell which sound a transient is, and a music bed with its own
beats will make nearly every moment look "covered", so audit an effects-only mix (or a render
without music) when you can. It does not replace listening; nothing here was heard.

    python3 audio_event_audit.py EVENT_MAP.json MEDIA [--tolerance 0.08] [--render-window 0.15]
                                 [--search 1.5] [--hit-db 9] [--out report.json] [--strict]
"""
import argparse
import json
import math
import re
import sys
from pathlib import Path

import _media

ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$")
LIMITS = [
    "只测起音时刻：分不清是哪段声音，音乐重拍会让附近看起来有声。",
    "起音时间分辨率约 ±10ms；渐起的 whoosh 以能量上升处计，不是听感起点。",
    "ok 只说明声明时刻附近有能量起跳，不说明音色、音量或舒适度；未听审。",
]


class EventMapError(ValueError):
    pass


def _number(value, field, where, minimum=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise EventMapError("%s.%s must be a finite number" % (where, field))
    if minimum is not None and value < minimum:
        raise EventMapError("%s.%s must be >= %s" % (where, field, minimum))
    return float(value)


def load_events(data):
    """Validate an event map and return normalised events (target/scheduled times resolved)."""
    if (not isinstance(data, dict) or type(data.get("schema_version")) is not int or data["schema_version"] != 1
            or not isinstance(data.get("events"), list)):
        raise EventMapError("expected an object with schema_version 1 and an events array")
    events, seen = [], set()
    for index, raw in enumerate(data["events"]):
        where = "events[%d]" % index
        if not isinstance(raw, dict):
            raise EventMapError(where + " must be an object")
        ident = raw.get("id")
        if not isinstance(ident, str) or not ID_RE.fullmatch(ident):
            raise EventMapError(where + ".id must be a stable lowercase id such as paste-url")
        if ident in seen:
            raise EventMapError("duplicate event id: " + ident)
        seen.add(ident)
        visual = _number(raw.get("visual_time_s"), "visual_time_s", where, 0.0)
        intended = _number(raw.get("intended_offset_s", 0.0), "intended_offset_s", where)
        onset = _number(raw.get("onset_offset_s", 0.0), "onset_offset_s", where, 0.0)
        scheduled = None
        if raw.get("sound_start_s") is not None:
            scheduled = _number(raw["sound_start_s"], "sound_start_s", where, 0.0) + onset
        tolerance = raw.get("tolerance_s")
        if tolerance is not None:
            tolerance = _number(tolerance, "tolerance_s", where, 0.0)
        events.append({"id": ident, "sound_id": raw.get("sound_id"), "role": raw.get("role"),
                       "visual_time_s": visual, "intended_offset_s": intended,
                       "target_time_s": visual + intended, "scheduled_time_s": scheduled,
                       "tolerance_s": tolerance})
    return events


def match(events, hits, search_s, render_window_s):
    """Greedy one-to-one matching by timing error against each event's anchor.

    An event with a scheduled onset is anchored there (did the sound really play where it was put?)
    and looks only `render_window_s` around it; schedule drift against the action is plain arithmetic.
    An event without a schedule is anchored at its target and looks `search_s` around it, which is
    unreliable on dense mixes because the nearest onset may belong to another sound.
    """
    pairs = []
    for ei, event in enumerate(events):
        anchor = event["scheduled_time_s"] if event["scheduled_time_s"] is not None else event["target_time_s"]
        window = render_window_s if event["scheduled_time_s"] is not None else search_s
        for hi, hit in enumerate(hits):
            if abs(hit["t"] - anchor) <= window:
                pairs.append((abs(hit["t"] - anchor), ei, hi))
    event_hit, used = {}, set()
    for _, ei, hi in sorted(pairs):
        if ei not in event_hit and hi not in used:
            event_hit[ei] = hi
            used.add(hi)
    return event_hit, used


def audit(event_map, media_path, tolerance=0.08, search_s=1.5, render_window_s=0.15, hit_db=9.0,
          floor_db=-60.0):
    events = load_events(event_map)
    samples, rate = _media.decode_mono_pcm(media_path)
    env, hop = _media.envelope_db(samples, rate, hop_ms=5, window_ms=10, preemphasis=0.95)
    hits = _media.find_hits(env, hop, hit_db=hit_db, floor_db=floor_db)
    event_hit, used = match(events, hits, search_s, render_window_s)
    results, counts = [], {"ok": 0, "late": 0, "early": 0, "missing": 0, "schedule_drift": 0}
    for ei, event in enumerate(events):
        tol = event["tolerance_s"] if event["tolerance_s"] is not None else tolerance
        entry = {"id": event["id"], "sound_id": event["sound_id"], "role": event["role"],
                 "visual_time_s": round(event["visual_time_s"], 3),
                 "target_time_s": round(event["target_time_s"], 3),
                 "scheduled_time_s": None if event["scheduled_time_s"] is None else round(event["scheduled_time_s"], 3),
                 "schedule_drift_s": None, "measured_time_s": None, "measured_error_s": None,
                 "strength_db": None, "tolerance_s": tol}
        if event["scheduled_time_s"] is not None:
            entry["schedule_drift_s"] = round(event["scheduled_time_s"] - event["target_time_s"], 3)
        if ei not in event_hit:
            entry["status"] = "missing"
            scheduled = event["scheduled_time_s"] is not None
            entry["note"] = ("no energy onset within %.2fs of the scheduled time (absent, too quiet, or onset_offset_s is off)"
                             % render_window_s if scheduled else
                             "no energy onset within %.2fs of the target time" % search_s)
        else:
            hit = hits[event_hit[ei]]
            error = hit["t"] - event["target_time_s"]
            entry.update(measured_time_s=hit["t"], measured_error_s=round(error, 3), strength_db=hit["strength_db"])
            if abs(error) <= tol:
                drifted = entry["schedule_drift_s"] is not None and abs(entry["schedule_drift_s"]) > tol
                entry["status"] = "schedule_drift" if drifted else "ok"
                if drifted:
                    entry["note"] = "an onset is near the target, but the scheduled time is off; check that it is the intended sound"
            else:
                entry["status"] = "late" if error > 0 else "early"
        counts[entry["status"]] += 1
        results.append(entry)
    orphans = [{"t": h["t"], "strength_db": h["strength_db"]} for i, h in enumerate(hits) if i not in used]
    failed = any(counts[k] for k in ("late", "early", "missing", "schedule_drift"))
    return {"schema_version": 1, "tool": "audio_event_audit",
            "media": {"path": str(media_path), "duration_s": round(len(samples) / float(rate), 3), "sample_rate": rate},
            "settings": {"tolerance_s": tolerance, "search_s": search_s, "render_window_s": render_window_s,
                         "hit_db": hit_db},
            "events": results, "orphans": orphans,
            "summary": dict(counts, orphans=len(orphans), measured_hits=len(hits)),
            "status": "failed" if failed else "partial" if orphans else "passed",
            "limits": LIMITS}


def table(report):
    rows = ["%-16s %-8s %8s %8s %9s  %s" % ("event", "status", "target", "measured", "error", "note")]
    for e in report["events"]:
        rows.append("%-16s %-8s %8.2f %8s %9s  %s" % (
            e["id"], e["status"], e["target_time_s"],
            "-" if e["measured_time_s"] is None else "%.2f" % e["measured_time_s"],
            "-" if e["measured_error_s"] is None else "%+.2f" % e["measured_error_s"], e.get("note", "")))
    for o in report["orphans"]:
        rows.append("%-16s %-8s %8s %8.2f %9s  unexplained onset (music beat or stray sound?)" % (
            "(orphan)", "-", "-", o["t"], "-"))
    return "\n".join(rows)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Audit declared sound events against measured onsets. Timing only; not listened.")
    parser.add_argument("event_map")
    parser.add_argument("media", help="WAV (read natively) or any file ffmpeg can decode")
    parser.add_argument("--tolerance", type=float, default=0.08, help="allowed error in seconds (default 0.08)")
    parser.add_argument("--search", type=float, default=1.5,
                        help="events without sound_start_s: how far from the target to look for an onset")
    parser.add_argument("--render-window", type=float, default=0.15,
                        help="events with sound_start_s: how far from the scheduled onset to look")
    parser.add_argument("--hit-db", type=float, default=9.0, help="onset must rise this many dB above its baseline")
    parser.add_argument("--out", help="also write the JSON report here")
    parser.add_argument("--strict", action="store_true", help="exit 1 when any event is late, early, missing or drifted")
    args = parser.parse_args(argv)
    try:
        data = json.loads(Path(args.event_map).read_text(encoding="utf-8"))
        report = audit(data, args.media, tolerance=args.tolerance, search_s=args.search,
                       render_window_s=args.render_window, hit_db=args.hit_db)
    except (OSError, ValueError, _media.MediaError) as error:
        print("audio_event_audit: " + str(error), file=sys.stderr)
        return 2
    text = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(text, encoding="utf-8")
    sys.stdout.write(text)
    print(table(report), file=sys.stderr)
    return 1 if args.strict and report["status"] == "failed" else 0


if __name__ == "__main__":
    sys.exit(main())
