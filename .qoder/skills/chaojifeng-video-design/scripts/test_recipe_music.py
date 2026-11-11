"""Music selection precedence, extensibility and source changes. No media rendering."""
import copy
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from _contracts import CATALOG_DIR, catalog
from _recipe_music import select_music, select_source_file, source_info, validate_policy

SCRIPTS = Path(__file__).resolve().parent


class RecipeMusicTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="recipe-music-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.audio = self.root / "track.wav"
        with wave.open(str(self.audio), "wb") as stream:
            stream.setnchannels(1)
            stream.setsampwidth(2)
            stream.setframerate(8000)
            stream.writeframes(b"\x00\x00" * 8000)
        self.info = source_info(self.audio)
        tracks = []
        for name in ("track-a", "track-b", "track-c"):
            tracks.append(dict(id=name, title=name, sha256=self.info["sha256"], duration_seconds=1,
                               emotion_ids=["unknown"], scenario_ids=["knowledge-explainer"],
                               narrative_roles=["explain"], rights={"status": "unverified"},
                               semantic_confidence="low", tag_status="fixture-not-auditioned",
                               cues=[dict(id=name + "-whole", track_id=name, source_in=0,
                                          source_out=1, duration_seconds=1, kind="support", arousal="unknown",
                                          scenario_ids=["knowledge-explainer"], emotion_ids=["unknown"],
                                          role_ids=["explain"], presence_2_5k_ratio=0, high_4k_ratio=0,
                                          audition_status="not_run")]))
        tracks[0]["selection_preference"] = dict(loop_policy="repeat-same-track")
        self.library = dict(schema_version=1, library_id="fixture", track_count=3, cue_count=3,
                            taxonomy=dict(emotions={"unknown": "Unknown"},
                                          scenarios={"knowledge-explainer": "Knowledge"},
                                          roles={"explain": "Explain"}), items=tracks)
        self.recipe = dict(id="concept-knowledge", name="Concept knowledge", music_policy=dict(
            candidate_track_ids=["track-a", "track-b"], default_track_id="track-a",
            planning_mode="music_first", default_requires_confirmation=False))

    def test_default_is_recipe_owned_and_does_not_ask(self):
        result = select_music(self.recipe, self.library)
        self.assertEqual(result["selected_track_id"], "track-a")
        self.assertEqual(result["selection_source"], "recipe_default")
        self.assertFalse(result["requires_confirmation"])
        self.assertEqual(result["planning_mode"], "music_first")

    def test_explicit_choice_overrides_project_and_default(self):
        result = select_music(self.recipe, self.library, "track-b", "track-a")
        self.assertEqual(result["selected_track_id"], "track-b")
        self.assertEqual(result["selection_source"], "user_specified")

    def test_project_choice_overrides_default(self):
        result = select_music(self.recipe, self.library, project_track_id="track-b")
        self.assertEqual(result["selected_track_id"], "track-b")

    def test_default_can_be_replaced_without_code_changes(self):
        self.recipe["music_policy"]["default_track_id"] = "track-b"
        result = select_music(self.recipe, self.library)
        self.assertEqual(result["selected_track_id"], "track-b")
        self.assertEqual(result["adaptation_policy"], "plan_for_this_track")

    def test_adding_candidate_does_not_change_default(self):
        self.recipe["music_policy"]["candidate_track_ids"].append("track-c")
        self.assertEqual(select_music(self.recipe, self.library)["selected_track_id"], "track-a")

    def test_out_of_pool_explicit_choice_is_project_only(self):
        before = copy.deepcopy(self.recipe)
        result = select_music(self.recipe, self.library, "track-c")
        self.assertEqual(result["selected_track_id"], "track-c")
        self.assertFalse(result["is_recipe_candidate"])
        self.assertFalse(result["policy_mutated"])
        self.assertEqual(self.recipe, before)

    def test_silent_and_original_do_not_pick_default(self):
        for mode in ("silent", "original"):
            result = select_music(self.recipe, self.library, project_track_id="track-a", music_mode=mode)
            self.assertIsNone(result["selected_track_id"])

    def test_unknown_explicit_track_does_not_fall_back(self):
        with self.assertRaisesRegex(ValueError, "unknown selected"):
            select_music(self.recipe, self.library, "missing")

    def test_default_must_be_in_pool(self):
        self.recipe["music_policy"]["default_track_id"] = "track-c"
        self.assertTrue(validate_policy(self.recipe["music_policy"]))

    def test_duplicate_candidate_is_rejected(self):
        self.recipe["music_policy"]["candidate_track_ids"].append("track-a")
        self.assertTrue(validate_policy(self.recipe["music_policy"]))

    def test_unknown_candidate_reference_is_rejected(self):
        self.recipe["music_policy"]["candidate_track_ids"].append("missing")
        with self.assertRaisesRegex(ValueError, "unresolved music"):
            select_music(self.recipe, self.library)

    def test_legacy_recipe_can_use_explicit_choice(self):
        del self.recipe["music_policy"]
        self.assertEqual(select_music(self.recipe, self.library, "track-b")["selected_track_id"], "track-b")
        with self.assertRaisesRegex(ValueError, "no default"):
            select_music(self.recipe, self.library)

    def test_source_file_is_hashed_without_changing_policy(self):
        before = copy.deepcopy(self.recipe)
        result = select_source_file(self.recipe, self.library, self.audio)
        self.assertEqual(result["source_sha256"], self.info["sha256"])
        self.assertEqual(result["duration_seconds"], 1)
        self.assertEqual(result["selection_source"], "user_source_file")
        self.assertFalse(result["policy_mutated"])
        self.assertEqual(self.recipe, before)

    def test_missing_source_file_does_not_substitute_default(self):
        with self.assertRaisesRegex(ValueError, "missing"):
            select_source_file(self.recipe, self.library, self.root / "missing.wav")

    def cli(self, *flags):
        paths = {}
        for name, value in (("music", self.library), ("recipes", dict(items=[self.recipe])),
                            ("registry", dict(library_id="fixture", assets={
                                "track-a": {"path": str(self.audio)},
                                "track-b": {"path": str(self.audio)}}))):
            paths[name] = self.root / (name + ".json")
            paths[name].write_text(json.dumps(value))
        command = [sys.executable, str(SCRIPTS / "music_library.py"), "select", "--recipe", self.recipe["id"],
                   "--catalog", str(paths["music"]), "--recipes", str(paths["recipes"]),
                   "--registry", str(paths["registry"]), *flags]
        result = subprocess.run(command, capture_output=True, text=True)
        return result.returncode, json.loads(result.stdout)

    def test_cli_resolves_and_checks_only_selected_source(self):
        code, result = self.cli()
        self.assertEqual(code, 0, result)
        self.assertEqual(result["source_state"], "ready")
        self.assertEqual(result["subjective_listening"], "not_run")

    def test_cli_explicit_source_file(self):
        code, result = self.cli("--source-file", str(self.audio))
        self.assertEqual(code, 0, result)
        self.assertEqual(result["selection_source"], "user_source_file")

    def test_cli_missing_selected_track_is_blocked(self):
        code, result = self.cli("--track", "track-c")
        self.assertEqual(code, 2)
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["selected_track_id"], "track-c")

    def test_cli_changed_hash_is_blocked(self):
        self.library["items"][0]["sha256"] = "b" * 64
        code, result = self.cli()
        self.assertEqual(code, 2)
        self.assertEqual(result["source_state"], "hash_mismatch")

    def test_cli_changed_duration_is_blocked(self):
        track = self.library["items"][0]
        track["duration_seconds"] = 2
        track["cues"][0].update(source_out=2, duration_seconds=2)
        code, result = self.cli()
        self.assertEqual(code, 2)
        self.assertEqual(result["source_state"], "duration_mismatch")

    def test_search_can_be_limited_to_recipe_candidates(self):
        self.cli()
        result = subprocess.run([
            sys.executable, str(SCRIPTS / "music_library.py"), "search", "--recipe", self.recipe["id"],
            "--catalog", str(self.root / "music.json"), "--recipes", str(self.root / "recipes.json"),
            "--registry", str(self.root / "registry.json")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout)
        data = json.loads(result.stdout)
        self.assertEqual({x["track_id"] for x in data["items"]}, {"track-a", "track-b"})
        self.assertEqual(data["default_track_id"], "track-a")

    def test_catalog_checks_music_refs_but_legacy_needs_no_music(self):
        target = self.root / "catalog"
        shutil.copytree(CATALOG_DIR, target)
        path = target / "recipes.json"
        data = json.loads(path.read_text())
        row = next(x for x in data["items"] if "music_policy" in x)
        row["music_policy"]["candidate_track_ids"].append("missing-track")
        path.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, "unresolved music"):
            catalog("recipe", target)
        for row in data["items"]:
            row.pop("music_policy", None)
        path.write_text(json.dumps(data))
        (target / "music.json").unlink()
        self.assertTrue(catalog("recipe", target))


if __name__ == "__main__":
    unittest.main()
