"""Offline production boundaries: no model, network, server or renderer is started."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from production_tools import (NoRedirect, aivis_speakers, check_job, file_hash,
                              local_probe, polyhaven_search, read_json, registry, route)


class ProductionToolTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="production-tools-")
        self.root = Path(self.tmp.name)
        self.one = self.root / "baseline.txt"
        self.two = self.root / "candidate.txt"
        self.one.write_text("baseline fixture")
        self.two.write_text("candidate fixture")
        self.job = dict(schema_version=1, project_id="offline-fixture", tool_choices=[],
                        assets=[dict(id="env", role="environment", origin="library", action="library", status="planned")],
                        lighting_reviews=[], voice_jobs=[])

    def tearDown(self):
        self.tmp.cleanup()

    def check(self, strict=False):
        return check_job(self.job, self.root, strict)

    def codes(self):
        return {x["code"] for x in self.check()["errors"]}

    def voice(self):
        row = dict(id="voice", tool_id="aivis-speech-engine", language="ja", mode="narration",
                   status="planned", listening=dict(status="not_run"))
        self.job["voice_jobs"] = [row]
        return row

    def light(self):
        row = dict(id="light", asset_id="env", scene_id="scene", status="passed", scope="still",
                   baseline_evidence=[self.one.name], candidate_evidence=[self.two.name],
                   finding="Fixture declaration only; not a real visual test")
        self.job["lighting_reviews"] = [row]
        return row

    def test_japanese_narration_is_separate_from_music(self):
        self.assertEqual([x["id"] for x in route("japanese-narration")["tools"]], ["aivis-speech-engine"])
        self.assertEqual([x["id"] for x in route("music")["tools"]], ["ace-step-1-5"])
        self.assertEqual(registry()["mixamo"]["adapter"], "candidate")

    def test_unknown_task_does_not_select_a_default(self):
        with self.assertRaises(ValueError):
            route("unknown")

    @patch("production_tools.socket.create_connection", side_effect=OSError("refused"))
    def test_probe_refusal_is_not_a_protocol_claim(self, _):
        report = local_probe()
        self.assertFalse(report["ports"]["blender-mcp"]["tcp_accepting"])
        self.assertEqual(report["mcp_connection"], "not_verified")

    @patch("production_tools.request_json")
    def test_search_preserves_order_uses_cache_and_does_not_claim_import(self, request):
        request.return_value = dict(results=[dict(slug="second", score=.1), dict(slug="first", score=.9)])
        a = polyhaven_search("studio", "hdris", 2, self.root)
        b = polyhaven_search("studio", "hdris", 1, self.root)
        self.assertEqual([x["asset_id"] for x in a["candidates"]], ["second", "first"])
        self.assertTrue(b["cache_hit"])
        self.assertEqual(request.call_count, 1)
        self.assertFalse(a["imported"])
        self.assertEqual(a["mcp_search"], "not_run")

    @patch("production_tools.request_json", return_value={"results": []})
    def test_empty_search_is_empty_not_fabricated(self, _):
        self.assertEqual(polyhaven_search("nothing", "models")["candidates"], [])

    @patch("production_tools.request_json", return_value={"results": [{"slug": "../../escape"}, {"slug": "safe_id"}]})
    def test_bad_asset_identifiers_are_not_turned_into_urls(self, _):
        self.assertEqual([r["asset_id"] for r in polyhaven_search("q", "models")["candidates"]], ["safe_id"])

    @patch("production_tools.request_json", return_value={"results": "not-a-list"})
    def test_wrong_search_shape_fails(self, _):
        with self.assertRaises(ValueError):
            polyhaven_search("q", "textures")

    @patch("production_tools.request_json", return_value={"results": []})
    def test_corrupt_cache_requeries_instead_of_faking_success(self, request):
        for p in [self.root / "placeholder"]:
            p.write_text("not metadata")
        polyhaven_search("q", "textures", cache_dir=self.root)
        cache = next(p for p in self.root.glob("*.json"))
        cache.write_text("bad json")
        polyhaven_search("q", "textures", cache_dir=self.root)
        self.assertEqual(request.call_count, 2)

    @patch("production_tools.request_json")
    def test_remote_or_credentialed_aivis_origin_is_rejected_before_network(self, request):
        for origin in ("https://example.com", "http://user:pass@localhost:10101", "http://localhost:10101/path"):
            with self.assertRaises(ValueError):
                aivis_speakers(origin)
        request.assert_not_called()

    @patch("production_tools.request_json", return_value=[dict(name="Voice", speaker_uuid="uuid", styles=[dict(id=-1, name="style")])])
    def test_speakers_do_not_claim_synthesis_or_model_rights(self, _):
        result = aivis_speakers()
        self.assertEqual(result["speakers"][0]["styles"][0]["id"], -1)
        self.assertEqual(result["synthesis"], "not_run")
        self.assertEqual(result["model_rights"], "not_verified")

    def test_redirects_are_not_silently_followed(self):
        with self.assertRaises(ValueError):
            NoRedirect().redirect_request(None, None, 302, "move", {}, "https://example.com")

    def test_template_is_draft_not_production_proof(self):
        empty = dict(schema_version=1, project_id="draft")
        a = check_job(empty, self.root)
        self.assertTrue(a["valid"])
        self.assertEqual(a["warnings"][0]["code"], "empty_job")
        self.assertFalse(check_job(empty, self.root, True)["valid"])

    def test_from_scratch_requires_actual_search_and_gap(self):
        row = self.job["assets"][0]
        row.update(action="scratch", origin="procedural")
        self.assertIn("search_first", self.codes())
        self.assertIn("asset_gap", self.codes())
        row.update(search=dict(status="blocked", sources=["project-cache", "polyhaven"]), gap_reason="No suitable shape in available scope")
        self.assertTrue(self.check()["valid"])

    def test_generated_event_scene_cannot_be_evidence(self):
        row = self.job["assets"][0]
        row.update(role="event-proof", action="generate", origin="generated",
                   search=dict(status="completed", sources=["archive"]), gap_reason="missing")
        self.assertIn("fabricated_evidence", self.codes())

    def test_ready_asset_needs_current_file_and_provenance(self):
        row = self.job["assets"][0]
        row.update(status="ready", path=self.one.name, sha256=file_hash(self.one), source="library asset", rights="fixture usage")
        self.assertTrue(self.check()["valid"])
        self.one.write_text("new bytes")
        self.assertIn("media_hash", self.codes())
        row["sha256"] = file_hash(self.one)
        del row["rights"]
        self.assertIn("asset_provenance", self.codes())

    def test_bound_plan_cannot_silently_drift(self):
        self.job.update(plan_path=self.one.name, plan_sha256=file_hash(self.one))
        self.assertTrue(self.check()["valid"])
        self.one.write_text("revised plan")
        self.assertIn("stale_plan", self.codes())

    def test_unknown_tool_or_wrong_task_fails(self):
        self.job["tool_choices"] = [dict(id="choice", tool_id="aivis-speech-engine", task="music", reason="wrong role")]
        self.assertIn("tool_task", self.codes())

    def test_duplicate_asset_ids_fail(self):
        self.job["assets"].append(copy.deepcopy(self.job["assets"][0]))
        self.assertIn("duplicate_id", self.codes())

    def test_lighting_pass_needs_distinct_local_comparison(self):
        row = self.light()
        self.assertTrue(self.check()["valid"])
        row["candidate_evidence"] = row["baseline_evidence"]
        self.assertIn("comparison_identity", self.codes())

    def test_still_cannot_verify_moving_reflections(self):
        self.light()["motion_continuity"] = "passed"
        self.assertIn("motion_scope", self.codes())

    def test_renamed_identical_files_are_not_a_lighting_comparison(self):
        self.light()
        self.two.write_bytes(self.one.read_bytes())
        self.assertIn("comparison_identity", self.codes())

    def test_lighting_pending_is_not_accepted_in_strict_mode(self):
        self.light()["status"] = "not_run"
        self.assertTrue(self.check()["valid"])
        self.assertFalse(self.check(True)["valid"])

    def test_aivis_not_singing_or_other_languages(self):
        row = self.voice()
        row["mode"] = "rap"
        self.assertIn("aivis_scope", self.codes())
        row.update(mode="narration", language="en")
        self.assertIn("aivis_scope", self.codes())

    def test_asr_cannot_be_declared_as_listening(self):
        row = self.voice()
        row["listening"] = dict(status="passed", method="asr", evidence=[self.one.name])
        self.assertIn("listening_proxy", self.codes())

    def test_unheard_audio_is_not_strictly_accepted(self):
        self.voice()
        self.assertTrue(self.check()["valid"])
        self.assertFalse(self.check(True)["valid"])

    def test_ready_voice_requires_separate_model_usage_basis(self):
        row = self.voice()
        row.update(status="ready", path=self.one.name, sha256=file_hash(self.one))
        self.assertIn("voice_rights", self.codes())

    def test_declared_reviews_never_make_the_checker_a_listener(self):
        row = self.voice()
        row.update(status="ready", path=self.two.name, sha256=file_hash(self.two), model_rights="offline fixture only")
        row["listening"] = dict(status="passed", method="user-feedback", evidence=[self.one.name])
        report = self.check()
        self.assertTrue(report["valid"])
        self.assertEqual(report["media_review"], "not_run")

    def test_planned_voice_cannot_claim_accepted_listening(self):
        self.voice()["listening"] = dict(status="passed", method="listened", evidence=[self.one.name])
        self.assertIn("listening_media", self.codes())

    def test_malformed_statuses_report_errors_instead_of_crashing(self):
        self.light().update(status=[], asset_id=[])
        self.job["assets"][0].update(origin=[], action=[], status=[])
        self.voice()["listening"] = dict(status=[])
        self.assertFalse(self.check()["valid"])

    def test_nonfinite_json_is_rejected(self):
        p = self.root / "job.json"
        p.write_text('{"schema_version":1,"value":NaN}')
        with self.assertRaises(ValueError):
            read_json(p)


if __name__ == "__main__":
    unittest.main()
