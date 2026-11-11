"""Offline behavioral boundaries; temporary files only, no producer or renderer."""
import copy
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from _contracts import load_json, catalog, CATALOG_DIR
from validate_plan import validate_plan
from check_delivery import check_delivery

SCRIPTS = Path(__file__).resolve().parent


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="video-design-contract-")
        self.root = Path(self.tmp.name)
        self.plan_path = self.root / "plan.json"
        self.plan = dict(schema_version=1, project_id="demo", revision=1, goal="Understand a change",
                         audience="First-time reader", scenario_id="knowledge-explainer", mode="compose",
                         output=dict(width=1920, height=1080, fps=30, duration_seconds=8, audio="silent"),
                         design=dict(style_id="paper-editorial", rationale="A clear concept relation"),
                         runtime=dict(adapter="fixture", status="ready", capabilities=catalog("motion")["reveal"]["required_capabilities"]), assets=[],
                         scenes=[dict(id="scene-01", purpose="A becomes B", start=0, end=8,
                                      elements=[dict(id="object-01", role="subject")],
                                      beats=[dict(id="beat-01", time=1, meaning="Object appears")],
                                      motions=[dict(id="motion-01", pattern_id="reveal", target_id="object-01", start=1, end=2, beat_id="beat-01")])])
        self.write_plan()

    def tearDown(self):
        self.tmp.cleanup()

    def write_plan(self):
        self.plan_path.write_text(json.dumps(self.plan), encoding="utf-8")

    def validate(self, **options):
        return validate_plan(self.plan, self.plan_path, **options)

    def codes(self, result):
        return {item["code"] for item in result["errors"]}

    def manifest(self):
        folder = self.root / "delivery"
        folder.mkdir(exist_ok=True)
        source = folder / "source.html"
        source.write_text("<p>Editable source</p>")
        data = dict(schema_version=1, project_id="demo", plan_sha256=hashlib.sha256(self.plan_path.read_bytes()).hexdigest(),
                    producer=dict(tool="fixture", model="unknown", run_id="unknown"),
                    outputs=[dict(kind="source", path="source.html", sha256=hashlib.sha256(source.read_bytes()).hexdigest())],
                    checks={name: dict(status="not_run", evidence=[]) for name in ["structure", "semantic", "visual", "playback", "audio", "comprehension"]})
        manifest_path = folder / "delivery.json"
        return data, manifest_path

    def check(self, data, path, **options):
        path.write_text(json.dumps(data))
        return check_delivery(self.plan_path, path, **options)

    def test_valid_plan_and_unknown_reference(self):
        self.assertTrue(self.validate()["valid"])
        self.plan["scenes"][0]["motions"][0]["target_id"] = "other-scene-object"
        self.assertIn("motion_target", self.codes(self.validate()))

    def add_director(self):
        self.plan["director"] = dict(
            intent="Explain one change", viewer_start="Does not know the relation",
            viewer_end="Can explain the relation", throughline="Keep the same subject",
            structure=dict(kind="causal-comparison", rationale="A controlled change, no invented conflict"),
            entities=[dict(id="subject", kind="object", role="state carrier", identity_constraints=["Same subject"])],
            beats=[dict(id="turn", function="Show the result", before="Original state", change="One action", after="New state")],
            sound_arc=[dict(id="cue", beat_id="turn", role="silence", onset_anchor="Result settles", energy="Low", visual_relation="Leave reading space")],
            iteration=dict(max_passes=2, stop_rule="References valid; intent tested separately"),
            tech_language=dict(choices=["Stable composition"], avoid=["Decorative camera movement"]))
        self.plan["scenes"][0]["intent"] = dict(
            beat_ids=["turn"], viewer_change="Understands the result", focus_entity_ids=["subject"],
            reveal_order=["object-01"], camera=dict(framing="Medium", movement="Still", purpose="Read the change"),
            handoff="Retain subject", acceptance="Viewer can identify result")

    def test_director_valid_and_reference_boundaries(self):
        self.add_director()
        self.assertTrue(self.validate()["valid"])
        intent = self.plan["scenes"][0]["intent"]
        for key in ["beat_ids", "focus_entity_ids", "reveal_order"]:
            old = intent[key]
            intent[key] = ["unresolved"]
            self.assertIn("intent_reference", self.codes(self.validate()))
            intent[key] = old
        self.plan["director"]["sound_arc"][0]["beat_id"] = "missing"
        self.assertIn("director_beat_reference", self.codes(self.validate()))

    def test_director_bad_types_missing_fields_and_duplicate_ids(self):
        self.add_director()
        baseline = copy.deepcopy(self.plan)
        for value in [None, [], "director"]:
            self.plan["director"] = value
            self.assertIn("object_type", self.codes(self.validate()))
        self.plan = copy.deepcopy(baseline)
        del self.plan["director"]["throughline"]
        self.assertIn("required_string", self.codes(self.validate()))
        self.plan = copy.deepcopy(baseline)
        self.plan["director"]["entities"].append(copy.deepcopy(self.plan["director"]["entities"][0]))
        self.assertIn("duplicate_id", self.codes(self.validate()))
        self.plan = copy.deepcopy(baseline)
        self.plan["director"]["iteration"]["max_passes"] = True
        self.assertIn("iteration_limit", self.codes(self.validate()))
        self.plan = copy.deepcopy(baseline)
        self.plan["scenes"][0]["intent"]["camera"] = "orbit"
        self.assertIn("object_type", self.codes(self.validate()))

    def test_optional_director_does_not_change_legacy_schema(self):
        self.assertTrue(self.validate()["valid"])
        self.plan["scenes"][0]["intent"] = dict(viewer_change="Read the result")
        self.assertTrue(self.validate()["valid"])
        self.plan["scenes"][0]["intent"]["beat_ids"] = ["undeclared-global-beat"]
        self.assertIn("intent_reference", self.codes(self.validate()))

    def test_expression_recipe_selection_and_cross_scenario_adaptation(self):
        self.plan["design"].update(expression_ids=["narrative.goal-proof"], recipe_id="signal-journey")
        self.assertTrue(self.validate()["valid"])
        self.plan["design"]["recipe_id"] = "ui-continuity"
        result = self.validate()
        self.assertTrue(result["valid"])
        warning = next(x for x in result["warnings"] if x["code"] == "design_outside_scenario")
        self.assertIn("explain the adaptation", warning["message"])
        self.assertNotIn("design_outside_scenario", self.codes(result))
        self.plan["design"]["recipe_id"] = "missing"
        self.assertIn("design_reference", self.codes(self.validate()))
        self.plan["design"]["expression_ids"] = {"not": "an array"}
        self.assertIn("string_array", self.codes(self.validate()))

    def test_new_catalog_cross_refs_and_guidance_not_implementation(self):
        catalog_root = self.root / "extended-catalog"
        shutil.copytree(CATALOG_DIR, catalog_root)
        target = catalog_root / "expressions.json"
        data = load_json(target)
        data["items"][0]["existing_motion_ids"] = ["missing-motion"]
        target.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, "unresolved motion"):
            catalog("expression", catalog_root)
        data["items"][0]["existing_motion_ids"] = ["hold"]
        data["items"][0]["status"] = "implemented"
        target.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, "expected guidance"):
            catalog("expression", catalog_root)
        data["items"][0]["status"] = "guidance"
        data["items"][0]["parameters"] = {"control": {"type": "number", "default": 1}}
        target.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, "design-control"):
            catalog("expression", catalog_root)

    def test_expression_recipe_require_source_relationship_and_guidance(self):
        catalog_root = self.root / "source-boundary-catalog"
        shutil.copytree(CATALOG_DIR, catalog_root)
        for kind, filename in [("expression", "expressions"), ("recipe", "recipes")]:
            target = catalog_root / (filename + ".json")
            original = load_json(target)
            for relationship in [None, "", "   ", []]:
                data = copy.deepcopy(original)
                if relationship is None:
                    del data["items"][0]["source_relation"]
                else:
                    data["items"][0]["source_relation"] = relationship
                target.write_text(json.dumps(data))
                with self.assertRaisesRegex(ValueError, "source_relation"):
                    catalog(kind, catalog_root)
            data = copy.deepcopy(original)
            data["items"][0]["status"] = "implemented"
            target.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, "expected guidance"):
                catalog(kind, catalog_root)
            for field in ["source_refs", "verification_questions"]:
                data = copy.deepcopy(original)
                data["items"][0][field] = "not-an-array"
                target.write_text(json.dumps(data))
                with self.assertRaisesRegex(ValueError, field):
                    catalog(kind, catalog_root)
            target.write_text(json.dumps(original))

    def test_finite_numbers_and_duplicate_json_keys(self):
        self.plan_path.write_text('{"duration": NaN}')
        with self.assertRaises(ValueError):
            load_json(self.plan_path)
        self.plan_path.write_text('{"revision": 1, "revision": 2}')
        with self.assertRaises(ValueError):
            load_json(self.plan_path)
        self.plan["output"]["duration_seconds"] = float("inf")
        self.assertIn("non_finite", self.codes(self.validate()))

    def test_timeline_gap_and_overlap_explanation(self):
        self.plan["scenes"][0]["start"] = 0.5
        self.assertIn("timeline_gap", self.codes(self.validate()))
        self.plan["scenes"][0]["start"] = 0
        second = copy.deepcopy(self.plan["scenes"][0])
        second.update(id="scene-02", start=7, end=8, elements=[], motions=[], beats=[])
        self.plan["scenes"].append(second)
        self.assertIn("scene_overlap", self.codes(self.validate()))
        second["overlap_reason"] = "Crossfade while preserving the shared concept"
        self.assertTrue(self.validate()["valid"])

    def test_channel_conflict_and_declared_composition(self):
        scene = self.plan["scenes"][0]
        scene["motions"].append(dict(id="motion-02", pattern_id="custom", custom=True, target_id="object-01",
                                     channels=["opacity"], implementation="layered opacity in scene source", start=1.5, end=2.5))
        self.assertIn("motion_conflict", self.codes(self.validate()))
        scene["motions"][1]["composition_reason"] = "Multiply opacity on an isolated wrapper"
        self.assertTrue(self.validate()["valid"])

    def test_capabilities_ready_vs_unresolved(self):
        self.plan["runtime"]["capabilities"] = []
        self.assertIn("capability_missing", self.codes(self.validate()))
        self.plan["runtime"]["status"] = "unresolved"
        result = self.validate()
        self.assertTrue(result["valid"])
        self.assertIn("capability_missing", {x["code"] for x in result["warnings"]})

    def test_estimated_narration_and_missing_assets_strict(self):
        self.plan["output"]["audio"] = "required"
        self.plan["scenes"][0]["narration"] = [dict(id="voice-01", display="Look", spoken="Look", start=1, duration_seconds=2, timing="estimated")]
        self.assertTrue(self.validate()["valid"])
        self.assertIn("estimated_timing", self.codes(self.validate(strict_timing=True)))
        self.plan["assets"] = [dict(id="image-01", kind="image", path="not-produced.png", source="procedural", rights="original", status="missing")]
        self.assertIn("asset_unavailable", self.codes(self.validate(strict_assets=True)))

    def test_inner_timing_and_bad_types(self):
        self.plan["scenes"][0]["beats"][0]["time"] = 9
        self.assertIn("outside_scene", self.codes(self.validate()))
        self.plan["scenes"][0]["motions"][0]["pattern_id"] = []
        self.assertFalse(self.validate()["valid"])
        self.plan["scenes"][0]["elements"][0]["asset_id"] = {}
        self.assertFalse(self.validate()["valid"])

    def test_custom_design_and_motion_are_explicit(self):
        self.plan.update(scenario_id="custom", scenario_description="A special relationship")
        self.plan["design"].update(style_id="custom", tokens={"accent": "#123456"})
        motion = self.plan["scenes"][0]["motions"][0]
        motion.update(pattern_id="custom", custom=True, channels=["stroke"], implementation="source:draw-relationship")
        self.assertTrue(self.validate()["valid"])
        del motion["implementation"]
        self.assertIn("required_string", self.codes(self.validate()))

    def test_measured_narration_needs_actual_file(self):
        self.plan["output"]["audio"] = "required"
        self.plan["assets"] = [dict(id="voice-source", kind="audio", path="absent.wav", source="user", rights="authorized", status="ready")]
        self.plan["scenes"][0]["narration"] = [dict(id="voice-01", display="Look", spoken="Look", start=0, duration_seconds=1, timing="measured", asset_id="voice-source")]
        self.assertIn("measured_without_audio", self.codes(self.validate()))

    def test_audio_acceptance_cannot_pass_estimated_sync(self):
        self.plan["output"]["audio"] = "required"
        self.plan["scenes"][0]["narration"] = [dict(id="voice-01", display="Look", spoken="Look", start=0, duration_seconds=1, timing="estimated")]
        self.write_plan()
        data, path = self.manifest()
        data["checks"]["audio"] = dict(status="passed", evidence=[dict(observation="Timing estimated only")])
        self.assertIn("estimated_audio_acceptance", self.codes(self.check(data, path)))

    def test_stale_manifest_uses_original_bytes(self):
        data, path = self.manifest()
        self.plan_path.write_text(self.plan_path.read_text() + "\n")
        self.assertIn("stale_plan", self.codes(self.check(data, path)))

    def test_manifest_paths_relative_to_manifest_and_hash(self):
        data, path = self.manifest()
        result = self.check(data, path)
        self.assertTrue(result["valid"])
        self.assertEqual(result["status"], "partial")
        self.assertFalse(result["media_verified"])
        (path.parent / "source.html").write_text("Changed")
        self.assertIn("output_hash", self.codes(self.check(data, path)))

    def test_passed_check_needs_existing_evidence_or_observation(self):
        data, path = self.manifest()
        data["checks"]["visual"] = dict(status="passed", evidence=[])
        self.assertIn("passed_without_evidence", self.codes(self.check(data, path)))
        data["checks"]["visual"]["evidence"] = ["missing-contact-sheet.png"]
        self.assertIn("evidence_missing", self.codes(self.check(data, path)))
        data["checks"]["visual"]["evidence"] = [dict(observation="Human reviewed frame 1; not playback")]
        self.assertTrue(self.check(data, path)["valid"])

    def test_required_video_and_required_audio_check(self):
        data, path = self.manifest()
        self.assertIn("video_required", self.codes(self.check(data, path, require_video=True)))
        self.plan["output"]["audio"] = "required"
        self.write_plan()
        data["plan_sha256"] = hashlib.sha256(self.plan_path.read_bytes()).hexdigest()
        data["checks"]["audio"]["status"] = "not_applicable"
        self.assertIn("required_audio_check", self.codes(self.check(data, path)))

    @unittest.skipUnless(shutil.which("ffprobe"), "existing ffprobe unavailable; no installation attempted")
    def test_probe_rejects_pseudo_video_without_renderer(self):
        data, path = self.manifest()
        fake = path.parent / "fake.mp4"
        fake.write_bytes(b"not video, just an extension")
        data["outputs"] = [dict(kind="video", path="fake.mp4", sha256=hashlib.sha256(fake.read_bytes()).hexdigest())]
        self.assertIn("probe_failed", self.codes(self.check(data, path, probe=True, require_video=True)))

    def test_catalog_real_cli_and_json_errors(self):
        result = subprocess.run([sys.executable, "-B", str(SCRIPTS / "catalog.py"), "--kind", "motion", "list", "--scenario", "product-demo", "--json"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        items = json.loads(result.stdout)["items"]
        self.assertIn("reveal", {x["id"] for x in items})
        result = subprocess.run([sys.executable, "-B", str(SCRIPTS / "catalog.py"), "--kind", "motion", "get", "missing", "--json"], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)["status"], "failed")

    def test_incomplete_catalog_cannot_disable_motion_checks(self):
        catalog_root = self.root / "catalog"
        shutil.copytree(CATALOG_DIR, catalog_root)
        target = catalog_root / "motions.json"
        original = load_json(target)
        for missing in ["channels", "required_capabilities"]:
            broken = copy.deepcopy(original)
            del broken["items"][0][missing]
            target.write_text(json.dumps(broken))
            result = validate_plan(self.plan, self.plan_path, catalog_dir=catalog_root)
            self.assertIn("catalog_unavailable", self.codes(result))
            self.assertIn(missing, result["errors"][0]["message"])
        broken = copy.deepcopy(original)
        broken["items"][0]["channels"] = []
        target.write_text(json.dumps(broken))
        self.assertIn("catalog_unavailable", self.codes(validate_plan(self.plan, self.plan_path, catalog_dir=catalog_root)))

    def test_catalog_passed_preview_needs_scope_and_artifact(self):
        catalog_root = self.root / "catalog"
        shutil.copytree(CATALOG_DIR, catalog_root)
        target = catalog_root / "motions.json"
        data = load_json(target)
        record = data["items"][0]["verification"]["preview"]
        record.update(status="passed", evidence=["a-preview.html"])
        target.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, "environment, scope and artifact"):
            catalog("motion", catalog_root)
        record.update(environment="recorded fixture environment", scope="a specific frame", artifact="a-preview.html")
        target.write_text(json.dumps(data))
        self.assertIn("reveal", catalog("motion", catalog_root))

    def test_motion_parameter_enum_type_and_explicit_extension(self):
        motion = self.plan["scenes"][0]["motions"][0]
        motion["pattern_id"] = "mask-wipe"
        self.plan["runtime"]["capabilities"] = catalog("motion")["mask-wipe"]["required_capabilities"]
        motion["parameters"] = {"direction": "left-to-right"}
        self.assertTrue(self.validate()["valid"])
        motion["parameters"]["direction"] = "spiral"
        self.assertIn("parameter_enum", self.codes(self.validate()))
        motion["parameters"]["direction"] = 12
        self.assertIn("parameter_type", self.codes(self.validate()))
        motion["parameters"] = {"direction": "left-to-right", "feather": True}
        # Find the bounded numeric field rather than assuming its implementation name.
        numeric = next(key for key, spec in catalog("motion")["mask-wipe"]["parameters"].items() if "min" in spec)
        motion["parameters"] = {"direction": "left-to-right", numeric: True}
        self.assertIn("parameter_range", self.codes(self.validate()))
        motion["parameters"] = {"direction": "left-to-right", "adapter-specific-option": "experimental"}
        result = self.validate()
        self.assertTrue(result["valid"])
        self.assertIn("unknown_parameter", {x["code"] for x in result["warnings"]})
        motion.update(pattern_id="custom", custom=True, channels=["mask"], implementation="custom mask renderer")
        result = self.validate()
        self.assertTrue(result["valid"])
        self.assertNotIn("unknown_parameter", {x["code"] for x in result["warnings"]})


if __name__ == "__main__":
    unittest.main(verbosity=2)
