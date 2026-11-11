"""Offline tests for film_probe.py, audio_event_audit.py and _media.py.

Fixtures are synthesised here (sine/noise bursts, flat colour clips). No third-party film,
brand, font or music is used. Video tests need ffmpeg with libx264 and skip otherwise.
"""
import array
import json
import math
import random
import shutil
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _media  # noqa: E402
import audio_event_audit  # noqa: E402
import film_probe  # noqa: E402

SCRIPTS = Path(__file__).resolve().parent
RATE = 16000


def has_encoder(name):
    if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        return False
    out = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], stdout=subprocess.PIPE,
                         stderr=subprocess.DEVNULL).stdout.decode("utf-8", "replace")
    return name in out


def synth(duration, bursts=(), tones=(), noise_db=-70.0, seed=7, rate=RATE, burst_ms=30, channels=1):
    """Return int16 samples: quiet noise floor + noise bursts at `bursts` (s) + sine `tones` [(start, end)]."""
    rng = random.Random(seed)
    total = int(duration * rate)
    floor = 10 ** (noise_db / 20.0)
    samples = [rng.uniform(-1, 1) * floor for _ in range(total)]
    for start in bursts:
        a = int(start * rate)
        for i in range(a, min(total, a + int(burst_ms / 1000.0 * rate))):
            samples[i] += rng.uniform(-1, 1) * 0.5
    for start, end in tones:
        for i in range(int(start * rate), min(total, int(end * rate))):
            samples[i] += 0.3 * math.sin(2 * math.pi * 220.0 * i / rate)
    data = array.array("h", [max(-32767, min(32767, int(s * 32767))) for s in samples])
    if channels == 2:
        data = array.array("h", [v for s in data for v in (s, s)])
    return data


def write_wav(path, data, rate=RATE, channels=1):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(data.tobytes())


class AudioToolkitTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="film-tools-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def hits_for(self, data, **kw):
        env, hop = _media.envelope_db(data, RATE, hop_ms=5, window_ms=10, preemphasis=0.95)
        return _media.find_hits(env, hop, **kw)

    def test_hits_are_found_at_burst_starts(self):
        data = synth(3.0, bursts=[0.5, 1.2, 2.0])
        hits = self.hits_for(data)
        self.assertEqual(len(hits), 3, hits)
        for found, expected in zip(hits, [0.5, 1.2, 2.0]):
            self.assertLess(abs(found["t"] - expected), 0.03, (found, expected))
            self.assertGreater(found["strength_db"], 20)

    def test_quiet_noise_has_no_hits(self):
        self.assertEqual(self.hits_for(synth(2.0)), [])

    def test_close_hits_merge_by_min_gap(self):
        data = synth(2.0, bursts=[0.5, 0.56])
        self.assertEqual(len(self.hits_for(data, min_gap_s=0.1)), 1)
        self.assertEqual(len(self.hits_for(data, min_gap_s=0.02)), 2)

    def test_valley_between_two_tones(self):
        data = synth(2.5, tones=[(0.0, 1.0), (1.3, 2.5)])
        env, hop = _media.envelope_db(data, RATE, hop_ms=10, window_ms=20, preemphasis=0.0)
        valleys = _media.find_valleys(env, hop)
        self.assertEqual(len(valleys), 1, valleys)
        self.assertLess(abs(valleys[0]["t"] - 1.15), 0.12, valleys)
        self.assertGreater(valleys[0]["depth_db"], 30)
        self.assertGreater(valleys[0]["duration_s"], 0.1)

    def test_steady_tone_has_no_valley(self):
        data = synth(2.0, tones=[(0.0, 2.0)])
        env, hop = _media.envelope_db(data, RATE, hop_ms=10, window_ms=20, preemphasis=0.0)
        self.assertEqual(_media.find_valleys(env, hop), [])

    def test_wav_decode_mixes_stereo_to_mono(self):
        data = synth(0.5, tones=[(0.0, 0.5)], channels=2)
        path = self.tmp / "stereo.wav"
        write_wav(path, data, channels=2)
        mono, rate = _media.decode_mono_pcm(path)
        self.assertEqual(rate, RATE)
        self.assertEqual(len(mono), int(0.5 * RATE))

    def test_silence_floors_at_minus_100_db(self):
        env, _ = _media.envelope_db(array.array("h", [0] * 1600), RATE, hop_ms=10, window_ms=20, preemphasis=0.0)
        self.assertTrue(all(v == _media.FLOOR_DB for v in env))


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="film-audit-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def media(self, bursts, duration=4.0):
        path = self.tmp / "mix.wav"
        write_wav(path, synth(duration, bursts=bursts))
        return path

    @staticmethod
    def event_map(*events):
        return {"schema_version": 1, "events": list(events)}

    def audit(self, events, bursts, **kw):
        return audio_event_audit.audit(self.event_map(*events), self.media(bursts), **kw)

    def by_id(self, report):
        return {e["id"]: e for e in report["events"]}

    def test_aligned_events_pass(self):
        report = self.audit([{"id": "click", "visual_time_s": 1.0}, {"id": "pop", "visual_time_s": 2.5}], [1.0, 2.5])
        statuses = [e["status"] for e in report["events"]]
        self.assertEqual(statuses, ["ok", "ok"], report)
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["orphans"], [])

    def test_late_sound_reports_signed_offset(self):
        report = self.audit([{"id": "send", "visual_time_s": 2.3}], [3.5])
        event = self.by_id(report)["send"]
        self.assertEqual(event["status"], "late")
        self.assertAlmostEqual(event["measured_error_s"], 1.2, delta=0.04)
        self.assertEqual(report["status"], "failed")

    def test_early_sound_is_flagged(self):
        event = self.by_id(self.audit([{"id": "x", "visual_time_s": 2.0}], [1.6]))["x"]
        self.assertEqual(event["status"], "early")
        self.assertAlmostEqual(event["measured_error_s"], -0.4, delta=0.04)

    def test_missing_sound_when_nothing_in_search_window(self):
        report = self.audit([{"id": "lost", "visual_time_s": 1.0}], [3.9], search_s=1.0)
        self.assertEqual(self.by_id(report)["lost"]["status"], "missing")

    def test_intended_lead_is_honoured(self):
        report = self.audit([{"id": "drop", "visual_time_s": 2.0, "intended_offset_s": -0.3}], [1.7])
        self.assertEqual(self.by_id(report)["drop"]["status"], "ok", report)

    def test_unexplained_hit_becomes_orphan(self):
        report = self.audit([{"id": "a", "visual_time_s": 1.0}], [1.0, 3.0])
        self.assertEqual(len(report["orphans"]), 1)
        self.assertAlmostEqual(report["orphans"][0]["t"], 3.0, delta=0.03)
        self.assertEqual(report["status"], "partial")

    def test_one_hit_cannot_explain_two_events(self):
        report = self.audit([{"id": "a", "visual_time_s": 1.0}, {"id": "b", "visual_time_s": 1.1}], [1.0])
        statuses = sorted(e["status"] for e in report["events"])
        self.assertIn("missing", statuses)

    def test_schedule_drift_is_reported_even_when_sound_matches_schedule(self):
        # The sound is where it was scheduled (3.5s) but the schedule is 1.2s after the action.
        report = self.audit([{"id": "send", "visual_time_s": 2.3, "sound_start_s": 3.5}], [3.5])
        event = self.by_id(report)["send"]
        self.assertAlmostEqual(event["schedule_drift_s"], 1.2, delta=0.001)
        self.assertEqual(event["status"], "late")

    def test_scheduled_event_is_not_stolen_by_a_nearer_unrelated_onset(self):
        # Another sound lands at 2.0 (near the 2.1 action) but this event is scheduled at 2.7 and plays there.
        report = self.audit([{"id": "paste", "visual_time_s": 2.1, "sound_start_s": 2.7}], [2.0, 2.7])
        event = self.by_id(report)["paste"]
        self.assertAlmostEqual(event["measured_time_s"], 2.7, delta=0.03)
        self.assertEqual(event["status"], "late")
        self.assertAlmostEqual(event["measured_error_s"], 0.6, delta=0.04)
        self.assertEqual(len(report["orphans"]), 1)

    def test_scheduled_but_silent_is_missing_even_with_other_onsets_near_the_action(self):
        report = self.audit([{"id": "paste", "visual_time_s": 2.1, "sound_start_s": 3.2}], [2.0])
        event = self.by_id(report)["paste"]
        self.assertEqual(event["status"], "missing")
        self.assertIn("scheduled", event["note"])

    def test_render_window_controls_how_far_from_the_schedule_to_look(self):
        events = [{"id": "x", "visual_time_s": 2.0, "sound_start_s": 2.0}]
        narrow = self.audit(events, [2.3], render_window_s=0.15)
        wide = self.audit(events, [2.3], render_window_s=0.5)
        self.assertEqual(self.by_id(narrow)["x"]["status"], "missing")
        self.assertEqual(self.by_id(wide)["x"]["status"], "late")

    def test_onset_offset_builds_the_scheduled_time(self):
        report = self.audit([{"id": "a", "visual_time_s": 1.0, "sound_id": "pop", "onset_offset_s": 0.0}], [1.0])
        self.assertEqual(report["events"][0]["sound_id"], "pop")

    def test_schema_errors(self):
        bad_maps = [
            {"schema_version": 2, "events": []},
            {"schema_version": 1, "events": [{"id": "a"}]},
            {"schema_version": 1, "events": [{"id": "a", "visual_time_s": -1}]},
            {"schema_version": 1, "events": [{"id": "a", "visual_time_s": 1}, {"id": "a", "visual_time_s": 2}]},
            {"schema_version": 1, "events": [{"id": "Bad Id", "visual_time_s": 1}]},
            {"schema_version": 1, "events": [{"id": "a", "visual_time_s": float("nan")}]},
        ]
        for bad in bad_maps:
            with self.assertRaises(audio_event_audit.EventMapError, msg=str(bad)):
                audio_event_audit.load_events(bad)

    def test_cli_strict_exit_code(self):
        events = self.tmp / "events.json"
        events.write_text(json.dumps(self.event_map({"id": "send", "visual_time_s": 2.3})), encoding="utf-8")
        media = self.media([3.5])
        script = str(SCRIPTS / "audio_event_audit.py")
        loose = subprocess.run([sys.executable, script, str(events), str(media)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        strict = subprocess.run([sys.executable, script, str(events), str(media), "--strict"], stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL)
        self.assertEqual(loose.returncode, 0)
        self.assertEqual(strict.returncode, 1)
        self.assertEqual(json.loads(strict.stdout.decode("utf-8"))["status"], "failed")

    def test_template_event_map_loads(self):
        template = SCRIPTS.parent / "templates" / "audio-event-map.json"
        events = audio_event_audit.load_events(json.loads(template.read_text(encoding="utf-8")))
        self.assertTrue(events)


@unittest.skipUnless(has_encoder("libx264") and has_encoder("aac"), "ffmpeg with libx264/aac is required")
class FilmProbeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="film-probe-"))
        wav = cls.tmp / "a.wav"
        # Hits exactly on the two cuts at 1.0s and 2.0s, a tone bed that stops for 0.3s at 1.5s.
        write_wav(wav, synth(3.0, bursts=[1.0, 2.0], tones=[(0.0, 1.5), (1.8, 3.0)]))
        video = cls.tmp / "film.mp4"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y",
             "-f", "lavfi", "-i", "color=c=0xd02020:s=160x90:r=30:d=1",
             "-f", "lavfi", "-i", "color=c=0x2040d0:s=160x90:r=30:d=1",
             "-f", "lavfi", "-i", "color=c=0x20a040:s=160x90:r=30:d=1",
             "-i", str(wav),
             "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-map", "3:a",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(video)],
            check=True)
        cls.video = video

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, True)

    def test_probe_reports_structure(self):
        report = film_probe.probe(self.video)
        self.assertEqual(report["video"]["width"], 160)
        self.assertEqual(report["video"]["height"], 90)
        self.assertAlmostEqual(report["video"]["fps"], 30.0, delta=0.01)
        self.assertAlmostEqual(report["container"]["duration_s"], 3.0, delta=0.15)
        self.assertGreater(report["audio"]["sample_rate"], 0)
        self.assertEqual(report["video"]["codec"], "h264")

    def test_cuts_and_scenes(self):
        report = film_probe.probe(self.video)
        times = [c["t"] for c in report["cuts"]]
        self.assertEqual(len(times), 2, report["cuts"])
        self.assertAlmostEqual(times[0], 1.0, delta=0.07)
        self.assertAlmostEqual(times[1], 2.0, delta=0.07)
        self.assertEqual(len(report["scenes"]), 3)
        self.assertAlmostEqual(report["scenes"][0]["duration_s"], 1.0, delta=0.07)

    def test_palette_ground_follows_scene_colour(self):
        report = film_probe.probe(self.video)
        grounds = [p["ground"] for p in report["palette"]]
        self.assertEqual(len(grounds), 3)

        def channels(hex_value):
            return [int(hex_value[i:i + 2], 16) for i in (1, 3, 5)]
        self.assertGreater(channels(grounds[0])[0], 150)
        self.assertGreater(channels(grounds[1])[2], 150)
        self.assertGreater(channels(grounds[2])[1], 110)

    def test_audio_measurements(self):
        report = film_probe.probe(self.video)
        self.assertIsNotNone(report["loudness"]["integrated_lufs"])
        hit_times = [h["t"] for h in report["audio_events"]["hits"]]
        for expected in (1.0, 2.0):
            self.assertTrue(any(abs(t - expected) < 0.06 for t in hit_times), (expected, hit_times))
        valley_times = [v["t"] for v in report["audio_events"]["valleys"]]
        self.assertTrue(any(abs(t - 1.65) < 0.25 for t in valley_times), valley_times)
        self.assertIn("limits", report)

    def test_no_audio_flag_skips_audio_sections(self):
        report = film_probe.probe(self.video, audio=False)
        self.assertNotIn("loudness", report)
        self.assertNotIn("audio_events", report)

    def test_frames_and_sheets_are_exported(self):
        out = self.tmp / "frames"
        report = film_probe.probe(self.video, frames_dir=out, sheet_step=0.5)
        self.assertEqual(len(report["frames"]), 3)
        for frame in report["frames"]:
            self.assertTrue(Path(frame["path"]).is_file(), frame)
        self.assertTrue(report["sheets"])
        self.assertTrue(Path(report["sheets"][0]["path"]).is_file())

    def test_cli_writes_json(self):
        out = self.tmp / "report.json"
        run = subprocess.run([sys.executable, str(SCRIPTS / "film_probe.py"), str(self.video), "--out", str(out)],
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(run.returncode, 0, run.stderr.decode("utf-8", "replace"))
        data = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(data["schema_version"], 1)
        self.assertEqual(data["tool"], "film_probe")

    def test_missing_file_is_a_clean_error(self):
        run = subprocess.run([sys.executable, str(SCRIPTS / "film_probe.py"), str(self.tmp / "nope.mp4")],
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertNotEqual(run.returncode, 0)
        self.assertNotIn("Traceback", run.stderr.decode("utf-8", "replace"))


class LaunchFilmDocsTests(unittest.TestCase):
    """Keep the launch-film catalog increment, its documents, template and evals from drifting apart."""

    ROOT = SCRIPTS.parent
    GRAMMAR = "references/launch-film-grammar.md"

    @classmethod
    def setUpClass(cls):
        from _contracts import catalog
        cls.expressions = catalog("expression")
        cls.recipes = catalog("recipe")
        cls.scenarios = catalog("scenario")
        cls.grammar = (cls.ROOT / cls.GRAMMAR).read_text(encoding="utf-8")

    def launch_ids(self):
        return {ident for ident, item in self.expressions.items()
                if any(ref.endswith("launch-film-grammar.md") for ref in item["source_refs"])}

    def test_every_launch_expression_is_documented_in_the_grammar_page(self):
        import re
        documented = set(re.findall(r"^### \d+\. .*`([a-z]+\.[a-z0-9-]+)`\s*$", self.grammar, re.M))
        self.assertEqual(self.launch_ids(), documented,
                         "catalog items citing the grammar page and its numbered headings must match")
        self.assertEqual(len(documented), 14)

    def test_launch_expressions_stay_guidance_and_unverified(self):
        for ident in self.launch_ids():
            item = self.expressions[ident]
            self.assertEqual(item["status"], "guidance", ident)
            self.assertEqual(item["verification"]["design"]["status"], "authored", ident)
            self.assertEqual(item["verification"]["preview"]["status"], "not_run", ident)
            self.assertEqual(item["verification"]["exported"]["status"], "not_run", ident)
            self.assertIn("没有观众实验", item["source_relation"], ident)

    def test_launch_recipes_use_the_new_expressions_and_resolve_in_scenarios(self):
        for ident in ("launch-film-arc", "feature-chapter-reel"):
            recipe = self.recipes[ident]
            self.assertEqual(recipe["status"], "guidance", ident)
            self.assertTrue(set(recipe["expression_ids"]) & self.launch_ids(), ident)
            for scenario_id in recipe["scenario_ids"]:
                self.assertIn(ident, self.scenarios[scenario_id]["recipe_ids"], (ident, scenario_id))
        arc = set(self.recipes["launch-film-arc"]["expression_ids"])
        self.assertTrue(self.launch_ids() <= arc, sorted(self.launch_ids() - arc))
        self.assertIn("dual-ground-launch", self.scenarios["product-demo"]["style_ids"])

    def test_event_map_and_beat_sheet_templates_exist_and_are_linked(self):
        for name in ("templates/audio-event-map.json", "templates/launch-beat-sheet.md"):
            self.assertTrue((self.ROOT / name).is_file(), name)
        skill = (self.ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("templates/audio-event-map.json", skill)
        for script in ("film_probe.py", "audio_event_audit.py"):
            self.assertIn(script, skill)

    def test_launch_evals_are_well_formed_and_not_claimed_as_run(self):
        data = json.loads((self.ROOT / "evals" / "launch-film-method-evals.json").read_text(encoding="utf-8"))
        self.assertEqual(data["status"], "authored-not-run")
        ids = [e["id"] for e in data["evals"]]
        self.assertEqual(len(ids), len(set(ids)))
        for item in data["evals"]:
            self.assertTrue(item["prompt"] and item["expected_output"] and item["assertions"], item["id"])
            used = item["assertions"].get("uses", [])
            for ident in used:
                if "." in ident and not ident.endswith((".py", ".md")):
                    self.assertIn(ident, self.expressions, (item["id"], ident))
                elif ident in self.recipes or ident.endswith((".py", ".md")):
                    continue
                else:
                    self.assertIn(ident, self.recipes, (item["id"], ident))


if __name__ == "__main__":
    unittest.main()
