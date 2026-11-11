#!/usr/bin/env python3
"""Measure a finished film: structure, cuts, ground colours, loudness, energy valleys and hits.

This is a measurement probe for studying a reference film or checking your own export. It reads
the file with ffprobe/ffmpeg and writes a JSON report. It does not watch, listen, render or judge:
cuts come from frame differences, audio events come from the energy envelope, and the palette is a
3x3 block average. Look at the frames and listen before claiming anything about taste.

    python3 film_probe.py VIDEO [--out report.json] [--frames-dir DIR] [--sheet-step 1.0]
                          [--cut-threshold 0.05] [--min-gap 0.5] [--no-audio] [--no-palette]
"""
import argparse
import json
import math
import re
import sys
from pathlib import Path

import _media

PTS_RE = re.compile(r"pts_time:([0-9.]+)")
SCORE_RE = re.compile(r"lavfi\.scene_score=([0-9.]+)")
LIMITS = [
    "切点来自相邻帧差分：交叉淡化的检测起点晚于真实起点（最多晚一个淡化时长），慢速渐变可能漏检；有源码时以源码时间为准。",
    "音频事件来自能量包络，分不清音乐重拍与音效，也不代表听感；未听审。",
    "调色板是 3x3 区块平均色，ground 取四角平均，不等于品牌色或设计 token。",
    "测量不能证明镜头好看、节奏舒服或观众看懂。",
]


def _ratio(text):
    try:
        top, _, bottom = str(text).partition("/")
        value = float(top) / float(bottom) if bottom else float(top)
        return value if math.isfinite(value) else None
    except (ValueError, ZeroDivisionError):
        return None


def _number(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def structure(info):
    fmt = info.get("format", {})
    video = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
    audio = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), None)
    if video is None:
        raise _media.MediaError("no video stream found")
    duration = _number(fmt.get("duration")) or _number(video.get("duration")) or 0.0
    return {
        "container": {"format": fmt.get("format_name"), "duration_s": round(duration, 3),
                      "size_bytes": int(fmt.get("size", 0) or 0), "bit_rate": int(fmt.get("bit_rate", 0) or 0)},
        "video": {"codec": video.get("codec_name"), "width": video.get("width"), "height": video.get("height"),
                  "fps": _ratio(video.get("avg_frame_rate") or video.get("r_frame_rate")),
                  "pix_fmt": video.get("pix_fmt"), "frames": int(video.get("nb_frames", 0) or 0) or None},
        "audio": ({"codec": audio.get("codec_name"), "sample_rate": int(audio.get("sample_rate", 0) or 0),
                   "channels": audio.get("channels")} if audio else None),
    }


def detect_cuts(path, threshold=0.10, min_gap=0.5):
    """Frames whose scene score exceeds `threshold`, merged into clusters closer than `min_gap` seconds."""
    out, _ = _media.run([_media.require_tool("ffmpeg"), "-hide_banner", "-nostats", "-i", str(path), "-an",
                         "-vf", "select='gt(scene,%s)',metadata=print:file=-" % threshold, "-f", "null", "-"])
    frames, current = [], None
    for line in out.decode("utf-8", "replace").splitlines():
        t = PTS_RE.search(line)
        if t:
            current = float(t.group(1))
            continue
        s = SCORE_RE.search(line)
        if s and current is not None:
            frames.append((current, float(s.group(1))))
    clusters = []
    for t, score in sorted(frames):
        if clusters and t - clusters[-1][-1][0] <= min_gap:
            clusters[-1].append((t, score))
        else:
            clusters.append([(t, score)])
    cuts = []
    for cluster in clusters:
        peak = max(cluster, key=lambda item: item[1])
        cuts.append({"t": round(cluster[0][0], 3), "peak_t": round(peak[0], 3),
                     "score": round(peak[1], 3), "frames": len(cluster)})
    return cuts


def scenes_from_cuts(cuts, duration):
    bounds = [0.0] + [c["t"] for c in cuts] + [duration]
    scenes = []
    for index in range(len(bounds) - 1):
        start, end = bounds[index], bounds[index + 1]
        if end - start <= 0:
            continue
        scenes.append({"index": len(scenes) + 1, "start_s": round(start, 3), "end_s": round(end, 3),
                       "duration_s": round(end - start, 3),
                       "share": round((end - start) / duration, 3) if duration else None})
    return scenes


def measure_loudness(path):
    _, err = _media.run([_media.require_tool("ffmpeg"), "-hide_banner", "-nostats", "-i", str(path), "-vn",
                         "-af", "ebur128=peak=true", "-f", "null", "-"])
    summary = err.split("Summary:")[-1]

    def grab(pattern):
        match = re.search(pattern, summary)
        return _number(match.group(1)) if match else None
    return {"integrated_lufs": grab(r"\n\s*I:\s*(-?[0-9.]+|-inf)\s*LUFS"),
            "lra_lu": grab(r"LRA:\s*(-?[0-9.]+)\s*LU"),
            "true_peak_dbfs": grab(r"Peak:\s*(-?[0-9.]+|-inf)\s*dBFS")}


def audio_events(path, hit_db=9.0, valley_db=6.0):
    samples, rate = _media.decode_mono_pcm(path)
    hit_env, hit_hop = _media.envelope_db(samples, rate, hop_ms=5, window_ms=10, preemphasis=0.95)
    level_env, level_hop = _media.envelope_db(samples, rate, hop_ms=10, window_ms=20, preemphasis=0.0)
    return {"hit_threshold_db": hit_db, "valley_threshold_db": valley_db,
            "hits": _media.find_hits(hit_env, hit_hop, hit_db=hit_db),
            "valleys": _media.find_valleys(level_env, level_hop, depth_db=valley_db)}


def sample_palette(path, t):
    out, _ = _media.run([_media.require_tool("ffmpeg"), "-v", "error", "-ss", "%.3f" % t, "-i", str(path),
                         "-frames:v", "1", "-vf", "scale=3:3:flags=area", "-f", "rawvideo",
                         "-pix_fmt", "rgb24", "-"])
    if len(out) < 27:
        return None
    cells = [tuple(out[i:i + 3]) for i in range(0, 27, 3)]
    corners = [cells[0], cells[2], cells[6], cells[8]]
    ground = tuple(int(round(sum(c[k] for c in corners) / 4.0)) for k in range(3))
    hexed = lambda c: "#%02x%02x%02x" % c  # noqa: E731
    return {"t": round(t, 3), "ground": hexed(ground), "centre": hexed(cells[4]),
            "grid": [hexed(c) for c in cells]}


def sample_time(scene, offset):
    return scene["start_s"] + min(offset, scene["duration_s"] * 0.5)


def export_frames(path, scenes, out_dir, offset):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    frames = []
    for scene in scenes:
        t = sample_time(scene, offset)
        target = out_dir / ("scene_%02d_%06.2fs.png" % (scene["index"], t))
        _media.run([_media.require_tool("ffmpeg"), "-v", "error", "-y", "-ss", "%.3f" % t, "-i", str(path),
                    "-frames:v", "1", str(target)])
        frames.append({"scene": scene["index"], "t": round(t, 3), "path": str(target)})
    return frames


def export_sheets(path, out_dir, step, duration, cols=4, rows=4, tile_width=320):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("sheet_*.png"):
        old.unlink()
    _media.run([_media.require_tool("ffmpeg"), "-v", "error", "-y", "-i", str(path), "-an", "-vf",
                "fps=1/%s,scale=%d:-1,tile=%dx%d" % (step, tile_width, cols, rows), str(out_dir / "sheet_%02d.png")])
    per_sheet = cols * rows
    sheets = []
    for number, sheet in enumerate(sorted(out_dir.glob("sheet_*.png"))):
        start = number * per_sheet * step
        tiles = [round(start + i * step, 3) for i in range(per_sheet) if start + i * step < duration]
        sheets.append({"path": str(sheet), "start_s": round(start, 3), "tile_times_s": tiles,
                       "layout": "%dx%d row-major" % (cols, rows)})
    return sheets


def probe(path, cut_threshold=0.05, min_gap=0.5, audio=True, palette=True, frames_dir=None,
          frame_offset=0.4, sheet_step=None, hit_db=9.0, valley_db=6.0):
    path = Path(path)
    if not path.is_file():
        raise _media.MediaError("file not found: " + str(path))
    report = {"schema_version": 1, "tool": "film_probe",
              "input": {"path": str(path), "bytes": path.stat().st_size}}
    report.update(structure(_media.ffprobe_json(path)))
    duration = report["container"]["duration_s"]
    report["settings"] = {"cut_threshold": cut_threshold, "min_gap_s": min_gap}
    report["cuts"] = detect_cuts(path, cut_threshold, min_gap)
    report["scenes"] = scenes_from_cuts(report["cuts"], duration)
    if palette:
        report["palette"] = [dict(scene=s["index"], **p) for s in report["scenes"]
                             for p in [sample_palette(path, sample_time(s, frame_offset))] if p]
    if audio and report["audio"]:
        report["loudness"] = measure_loudness(path)
        report["audio_events"] = audio_events(path, hit_db, valley_db)
    if frames_dir:
        report["frames"] = export_frames(path, report["scenes"], frames_dir, frame_offset)
    if sheet_step:
        if not frames_dir:
            raise _media.MediaError("--sheet-step needs --frames-dir (contact sheets are written under DIR/sheets)")
        report["sheets"] = export_sheets(path, Path(frames_dir) / "sheets", sheet_step, duration)
    report["limits"] = LIMITS
    return report


def summary_lines(report):
    c, v = report["container"], report["video"]
    lines = ["%s  %sx%s @ %s fps  %.2fs  %s" % (Path(report["input"]["path"]).name, v["width"], v["height"],
                                                 v["fps"], c["duration_s"], v["codec"])]
    palette = {p["scene"]: p for p in report.get("palette", [])}
    for s in report["scenes"]:
        ground = palette.get(s["index"], {}).get("ground", "")
        lines.append("  scene %02d  %7.2f - %7.2f  %5.2fs  %4.1f%%  %s" % (
            s["index"], s["start_s"], s["end_s"], s["duration_s"], 100 * (s["share"] or 0), ground))
    if "loudness" in report:
        l = report["loudness"]
        lines.append("  loudness  I=%s LUFS  LRA=%s LU  peak=%s dBFS" % (
            l["integrated_lufs"], l["lra_lu"], l["true_peak_dbfs"]))
        e = report["audio_events"]
        lines.append("  audio hits %d  valleys %d (energy facts, not listened)" % (len(e["hits"]), len(e["valleys"])))
    return lines


def main(argv=None):
    parser = argparse.ArgumentParser(description="Measure a finished film. Measurement only; look and listen before judging.")
    parser.add_argument("video")
    parser.add_argument("--out", help="write the JSON report here")
    parser.add_argument("--frames-dir", help="export one frame per scene (and sheets here/sheets)")
    parser.add_argument("--sheet-step", type=float, help="seconds per contact-sheet tile (4x4 sheets)")
    parser.add_argument("--cut-threshold", type=float, default=0.05, help="lower catches gradual transitions but also UI motion")
    parser.add_argument("--min-gap", type=float, default=0.5, help="merge cut frames closer than this (s)")
    parser.add_argument("--frame-offset", type=float, default=0.4, help="seconds after a scene start to sample")
    parser.add_argument("--hit-db", type=float, default=9.0)
    parser.add_argument("--valley-db", type=float, default=6.0)
    parser.add_argument("--no-audio", action="store_true")
    parser.add_argument("--no-palette", action="store_true")
    args = parser.parse_args(argv)
    try:
        report = probe(args.video, cut_threshold=args.cut_threshold, min_gap=args.min_gap, audio=not args.no_audio,
                       palette=not args.no_palette, frames_dir=args.frames_dir, frame_offset=args.frame_offset,
                       sheet_step=args.sheet_step, hit_db=args.hit_db, valley_db=args.valley_db)
    except _media.MediaError as error:
        print("film_probe: " + str(error), file=sys.stderr)
        return 2
    text = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(text, encoding="utf-8")
        print("\n".join(summary_lines(report)))
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
