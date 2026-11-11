"""Offline timing failures and compatibility. No renderer, model or private audio."""
import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from _contracts import load_json, sha256
from explainer_timing_audit import audit_score

ROOT = Path(__file__).resolve().parents[1]


class ExplainerTimingTests(unittest.TestCase):
    def setUp(self):
        self.plan = load_json(ROOT / "examples/knowledge-music.plan.json")
        self.score = load_json(ROOT / "templates/knowledge-music-score.json")
        self.digest = sha256(ROOT / "examples/knowledge-music.plan.json")
        self.sheet = None

    def audit(self):
        return audit_score(self.score, self.plan, self.digest, self.sheet)

    def codes(self):
        return {x["code"] for x in self.audit()["errors"]}

    def music(self):
        self.score["music_map"] = dict(track_id="synthetic-track", source_sha256="a" * 64,
                                      analysis_method="synthetic timing fixture; no listening",
                                      anchors=[dict(id="accent", source_time=2, kind="beat",
                                                    status="candidate", evidence=[])])
        self.sheet = dict(cues=[dict(id="placement-01", track_id="synthetic-track",
                                    source_sha256="a" * 64, source_in=1, source_out=9,
                                    timeline_start=0, timeline_end=8, playback_rate=1)])
        self.score["sync_points"] = [dict(id="sync-01", visual_beat_id="beat-01", anchor_id="accent",
                                          placement_id="placement-01", intended_offset_s=0, tolerance_s=.04)]

    def test_template_direct_without_pilot_requirement(self):
        result = self.audit()
        self.assertTrue(result["valid"], result)
        self.assertEqual(result["media_review"], "not_run")
        self.assertEqual(result["coverage"]["reading_windows"], 1)

    def test_staged_also_supported(self):
        self.score["delivery_mode"] = "staged"
        self.assertTrue(self.audit()["valid"])

    def test_stale_plan_is_rejected(self):
        self.score["plan_sha256"] = "b" * 64
        self.assertIn("stale_plan", self.codes())

    def test_short_reading_window_is_rejected(self):
        self.score["reading_windows"][0]["min_read_seconds"] = 5
        self.assertIn("reading_short", self.codes())

    def test_reversed_window_is_rejected(self):
        row = self.score["reading_windows"][0]
        row["start_beat_id"], row["end_beat_id"] = row["end_beat_id"], row["start_beat_id"]
        self.assertIn("reading_bounds", self.codes())

    def test_wrong_element_type_is_reported_without_crashing(self):
        self.score["reading_windows"][0]["element_id"] = []
        self.assertIn("element_ref", self.codes())

    def test_unknown_knowledge_reference_is_rejected(self):
        self.score["reading_windows"][0]["claim_ids"] = ["missing"]
        self.assertIn("claim_ref", self.codes())

    def test_duplicate_window_id_is_rejected(self):
        self.score["reading_windows"] *= 2
        self.assertIn("duplicate_id", self.codes())

    def test_empty_scope_does_not_claim_success(self):
        self.score["reading_windows"] = []
        self.assertIn("empty_scope", self.codes())

    def test_candidate_anchor_warns_without_claiming_listening(self):
        self.music()
        result = self.audit()
        self.assertTrue(result["valid"], result)
        self.assertIn("candidate_anchor", {x["code"] for x in result["warnings"]})
        self.assertEqual(result["media_review"], "not_run")

    def test_trim_change_causes_mapping_drift(self):
        self.music()
        self.sheet["cues"][0].update(source_in=0, source_out=8)
        self.assertIn("music_drift", self.codes())

    def test_playback_rate_is_applied_to_source_mapping(self):
        self.music()
        self.sheet["cues"][0].update(source_out=17, playback_rate=2)
        self.score["music_map"]["anchors"][0]["source_time"] = 3
        self.assertTrue(self.audit()["valid"], self.audit())

    def test_loop_placement_maps_to_the_selected_repeat(self):
        self.music()
        cue = self.sheet["cues"][0]
        cue.update(source_in=0, source_out=4, timeline_end=4)
        repeat = copy.deepcopy(cue)
        repeat.update(id="placement-02", timeline_start=4, timeline_end=8)
        self.sheet["cues"].append(repeat)
        self.score["music_map"]["anchors"][0]["source_time"] = 1
        self.score["sync_points"][0].update(visual_beat_id="beat-read-end", placement_id="placement-02")
        self.assertTrue(self.audit()["valid"], self.audit())
        self.score["sync_points"][0]["placement_id"] = "placement-01"
        self.assertIn("music_drift", self.codes())

    def test_changed_source_hash_is_rejected(self):
        self.music()
        self.sheet["cues"][0]["source_sha256"] = "b" * 64
        self.assertIn("music_identity", self.codes())

    def test_source_out_is_excluded(self):
        self.music()
        self.score["music_map"]["anchors"][0]["source_time"] = 9
        self.assertIn("mapping_bounds", self.codes())

    def test_verified_anchor_requires_evidence(self):
        self.music()
        self.score["music_map"]["anchors"][0]["status"] = "verified"
        self.assertIn("anchor_evidence", self.codes())

    def test_wrong_source_duration_is_rejected(self):
        self.music()
        self.sheet["cues"][0]["source_out"] = 10
        self.assertIn("mapping_duration", self.codes())

    def test_sfx_onset_includes_file_attack_offset(self):
        self.plan["scenes"][0]["audio_cues"] = [dict(id="sfx-01", role="sfx", time=.98)]
        self.score["sync_points"] = [dict(id="sfx-sync", visual_beat_id="beat-01", audio_cue_id="sfx-01",
                                          onset_offset_s=.02, intended_offset_s=0, tolerance_s=.04)]
        self.assertTrue(self.audit()["valid"], self.audit())
        self.plan["scenes"][0]["audio_cues"][0]["time"] = .8
        self.assertIn("sfx_drift", self.codes())

    def test_nonfinite_and_boolean_tolerances_are_rejected(self):
        self.music()
        for value in (float("nan"), True, -1):
            self.score["sync_points"][0]["tolerance_s"] = value
            self.assertIn("invalid_number", self.codes())

    def test_malformed_root_is_reported(self):
        self.assertFalse(audit_score([], self.plan, self.digest)["valid"])

    def test_cli_strict_rejects_candidate_and_duplicate_json(self):
        self.music()
        with tempfile.TemporaryDirectory(prefix="explainer-timing-") as folder:
            root = Path(folder)
            plan_path = root / "plan.json"
            plan_path.write_text(json.dumps(self.plan))
            self.score["plan_sha256"] = sha256(plan_path)
            score_path, sheet_path = root / "score.json", root / "sheet.json"
            score_path.write_text(json.dumps(self.score))
            sheet_path.write_text(json.dumps(self.sheet))
            command = [sys.executable, str(ROOT / "scripts/explainer_timing_audit.py"), str(score_path),
                       "--plan", str(plan_path), "--music-sheet", str(sheet_path), "--strict"]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertTrue(json.loads(result.stdout)["valid"])
            score_path.write_text('{"schema_version":1,"schema_version":1}')
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(json.loads(result.stdout)["errors"][0]["code"], "input_error")


if __name__ == "__main__":
    unittest.main()
