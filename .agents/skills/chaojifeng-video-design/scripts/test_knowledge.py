"""Offline tests for the knowledge-explanation contracts: controlled expression lint, knowledge pack,
plan integration, catalog entries, examples and documentation drift. No network, no renderer."""
import copy
import datetime
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import controlled_lint as lint
from _contracts import catalog, load_json
from knowledge_pack import lint_script, validate_knowledge
from validate_plan import validate_plan

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parent
SIBLING = ROOT.parent / "ai-avatar-narration" / "scripts"
TODAY = datetime.date(2026, 10, 19)


def codes(result, key="errors"):
    return {item["code"] for item in result[key]}


def base_pack():
    return {
        "schema_version": 1,
        "topic": "连通器",
        "claim": "底部相通的容器里，液面最终一样高。",
        "relation_type": "process",
        "audience": {"level": "novice", "known": ["水往低处流"], "unknown": ["连通器"]},
        "domain": {
            "field": "初中物理",
            "standards": [{"id": "std-none", "title": "无单一适用标准", "kind": "none", "status": "none",
                           "reason": "入门科普，没有单一适用的行业标准"}],
            "terms": [{"id": "term-comm", "preferred": "连通器", "definition": "底部相通的容器",
                       "source": "本片自定术语卡", "aliases_forbidden": ["联通管"]}],
        },
        "expression": {"profile": "ste-zh-v1"},
        "carrier": {"kind": "diagram", "object": "两个相连的水槽", "mechanism": "水从高处流向低处，直到两边一样高",
                    "fallback": "改用两行文字", "limits": [], "mappings": []},
        "truth": {"claims": [{"id": "claim-level", "text": "两边液面最终一样高", "kind": "illustrative",
                              "disclosure": "画面写明：示意"}]},
        "layers": [
            {"id": "layer-open", "level": "L1", "goal": "看到现象", "new_load": "一个现象", "exit_test": "能说出看到了什么",
             "script_ref": "layer-1"},
            {"id": "layer-close", "level": "L6", "goal": "回顾", "new_load": "无新概念", "exit_test": "能说出边界",
             "bridge_from_previous": "把水槽拉回总览", "script_ref": "layer-2",
             "model_boundary": "水槽没有演示压强", "extension_pointers": ["回到教材的压强一章"]},
        ],
        "checks": {key: {"status": "not_run", "evidence": []}
                   for key in ("terminology", "accuracy", "novice_read", "peer_read", "expert_read")},
    }


def event_pack():
    pack = base_pack()
    pack["relation_type"] = "event"
    pack["truth"] = {
        "claims": [{"id": "claim-notice", "text": "公告宣布周末延长开放", "kind": "sourced", "source": "公告第 1 条",
                    "as_of": "2026-10-19"}],
        "unknown": [{"id": "unk-holiday", "text": "法定节假日是否同样延长", "status": "unconfirmed", "reason": "公告没有说明"}],
    }
    return pack


def check(pack, **options):
    options.setdefault("standalone", True)
    options.setdefault("today", TODAY)
    return validate_knowledge(pack, **options)


class ControlledLintTests(unittest.TestCase):
    def test_length_ignores_punctuation(self):
        self.assertEqual(lint.length_units("你好，世界！"), 4)

    def test_sentence_limits(self):
        over_target = lint.lint_text("字" * 23 + "。")
        self.assertIn("sentence_over_target", codes(over_target, "notes"))
        self.assertTrue(over_target["valid"])
        too_long = lint.lint_text("字" * 31 + "。")
        self.assertIn("sentence_too_long", codes(too_long, "warnings"))

    def test_procedure_has_a_tighter_limit(self):
        text = "字" * 19 + "。"
        self.assertNotIn("sentence_over_target", codes(lint.lint_text(text, kind="description"), "notes"))
        self.assertIn("sentence_over_target", codes(lint.lint_text(text, kind="procedure"), "notes"))

    def test_mechanical_findings(self):
        result = lint.lint_text("大概三个报文段；被丢弃的包不再处理。")
        self.assertTrue({"semicolon", "vague_word", "passive_marker"} <= codes(result, "warnings"))

    def test_strict_promotes_warnings_to_errors(self):
        result = lint.lint_text("大概可以。", strict=True)
        self.assertFalse(result["valid"])
        self.assertIn("vague_word", codes(result))
        self.assertEqual(result["warnings"], [])

    def test_placeholder_is_an_error(self):
        self.assertIn("placeholder_text", codes(lint.lint_text("这里 TODO 以后写")))

    def test_forbidden_alias_is_an_error_but_quotes_are_exempt(self):
        terms = [{"id": "t", "preferred": "证据板", "definition": "摆放事实卡的板", "aliases_forbidden": ["资料墙"]}]
        self.assertIn("forbidden_alias", codes(lint.lint_text("资料墙很好用。", terms=terms)))
        self.assertNotIn("forbidden_alias", codes(lint.lint_text("旧称“资料墙”已经不用。", terms=terms)))

    def test_first_use_needs_a_definition(self):
        terms = [{"id": "t", "preferred": "口径", "definition": "一个数字怎么统计"}]

        def undefined(text, **kwargs):
            return "undefined_on_first_use" in codes(lint.lint_text(text, terms=terms, **kwargs), "warnings")

        self.assertTrue(undefined("口径很重要。"))
        self.assertFalse(undefined("口径表示一个数字怎么统计。"))
        self.assertFalse(undefined("数字要带口径。口径表示一个数字怎么统计。"))
        self.assertTrue(undefined("数字要带口径。它很重要。"))
        self.assertFalse(undefined("口径很重要。", audience_level="expert"))
        known = [{"id": "t", "preferred": "口径", "known_to_audience": True}]
        self.assertNotIn("undefined_on_first_use", codes(lint.lint_text("口径很重要。", terms=known), "warnings"))

    def test_spoken_profile_asks_for_a_reading(self):
        bare = lint.lint_text("TCP 先握手。", profile="ste-zh-spoken")
        self.assertIn("missing_pronunciation", codes(bare, "warnings"))
        read = lint.lint_text("TCP 先握手。", profile="ste-zh-spoken", pronunciations={"TCP": "T C P"})
        self.assertNotIn("missing_pronunciation", codes(read, "warnings"))

    def test_colloquial_words_depend_on_the_profile(self):
        self.assertIn("colloquial", codes(lint.lint_text("这玩意很快。"), "warnings"))
        self.assertNotIn("colloquial", codes(lint.lint_text("这玩意很快。", profile="ste-zh-spoken"), "warnings"))

    def test_speech_applies_pronunciations_on_whole_tokens(self):
        lexicon = {"SYN": "S Y N", "ACK": "A C K"}
        self.assertEqual(lint.to_speech("SYN 和 ack 到了，SYNC 不变", lexicon), "S Y N 和 A C K 到了，SYNC 不变")

    def test_term_cards_feed_the_lexicon_but_explicit_readings_win(self):
        terms = [{"id": "t", "preferred": "SYN", "spoken_as": "同步"}]
        self.assertEqual(lint.build_lexicon(None, terms), {"SYN": "同步"})
        self.assertEqual(lint.build_lexicon({"SYN": "S Y N"}, terms), {"SYN": "S Y N"})

    def test_limits_are_validated(self):
        with self.assertRaises(ValueError):
            lint.merge_limits({"description_target": 40, "description_hard": 30})
        with self.assertRaises(ValueError):
            lint.merge_limits({"unknown_limit": 3})
        with self.assertRaises(ValueError):
            lint.merge_limits({"description_hard": 2.5})
        self.assertEqual(lint.merge_limits({"description_hard": 40})["description_hard"], 40)

    def test_script_parser_reads_directives_and_skips_non_speech(self):
        script = "\n".join([
            "# 标题", "", "<!-- kind=procedure layer=L2 id=seg-03 defines=term-a,term-b lint=off -->",
            "先做这件事。", "", "| 表 | 格 |", "", "```", "代码里的字不算", "```", "", "- 列表项一", "- 列表项二",
        ])
        units = lint.parse_script(script)
        self.assertEqual([u["id"] for u in units], ["seg-03", "p2", "p3"])
        first = units[0]
        self.assertEqual((first["kind"], first["layer"], first["defines"], first["lint"]),
                         ("procedure", "L2", ["term-a", "term-b"], False))
        self.assertTrue(units[1]["lint"])

    def test_emit_speech_refuses_to_overwrite(self):
        with tempfile.TemporaryDirectory(prefix="video-design-lint-") as tmp:
            root = Path(tmp)
            glossary = root / "glossary.json"
            glossary.write_text(json.dumps({"expression": {"profile": "ste-zh-spoken", "pronunciations": {"TCP": "T C P"}},
                                            "domain": {"terms": []}}), encoding="utf-8")
            script = root / "script.md"
            script.write_text("TCP 先握手。\n", encoding="utf-8")
            speech = root / "speech.txt"
            command = [sys.executable, "-B", str(SCRIPTS / "controlled_lint.py"), "--text-file", str(script),
                       "--glossary", str(glossary), "--emit-speech", str(speech)]
            first = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
            self.assertEqual(speech.read_text(encoding="utf-8").strip(), "T C P 先握手。")
            second = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(second.returncode, 1)
            self.assertIn("output_exists", second.stdout)

    def test_cli_rejects_bad_limits_without_traceback(self):
        with tempfile.TemporaryDirectory(prefix="video-design-lint-") as tmp:
            glossary = Path(tmp) / "glossary.json"
            glossary.write_text(json.dumps({"expression": {"profile": "ste-zh-v1", "limits": {"description_hard": -1}}}),
                                encoding="utf-8")
            run = subprocess.run([sys.executable, "-B", str(SCRIPTS / "controlled_lint.py"), "--text", "一句话。",
                                  "--glossary", str(glossary)], capture_output=True, text=True)
            self.assertEqual(run.returncode, 1)
            self.assertIn("bad_options", run.stdout)
            self.assertNotIn("Traceback", run.stderr)


class KnowledgePackTests(unittest.TestCase):
    def test_minimal_pack_passes(self):
        result = check(base_pack())
        self.assertEqual((result["valid"], result["status"], result["warnings"]), (True, "passed", []), result)

    def test_non_objects_and_versions(self):
        self.assertIn("pack_type", codes(check([])))
        pack = base_pack()
        del pack["schema_version"]
        self.assertIn("schema_version", codes(check(pack)))
        self.assertTrue(check(pack, standalone=False)["valid"])
        pack["schema_version"] = 2
        self.assertIn("schema_version", codes(check(pack, standalone=False)))

    def test_standards_are_required_and_honest(self):
        pack = base_pack()
        pack["domain"]["standards"] = []
        self.assertIn("standards_required", codes(check(pack)))
        pack = base_pack()
        del pack["domain"]["standards"][0]["reason"]
        self.assertIn("required_string", codes(check(pack)))
        pack = base_pack()
        pack["domain"]["standards"][0]["status"] = "verified"
        self.assertIn("standard_none_status", codes(check(pack)))
        pack = base_pack()
        pack["domain"]["standards"][0].update(kind="standard", status="none")
        self.assertIn("standard_none_status", codes(check(pack)))

    def test_verified_needs_evidence_of_checking(self):
        def with_standard(**changes):
            pack = base_pack()
            standard = dict(id="std-a", title="某标准", kind="standard", status="verified", version="第 2 版", locator="§3",
                            checked_on="2026-10-01")
            standard.update(changes)
            pack["domain"]["standards"] = [standard]
            pack["domain"]["terms"][0].pop("source")
            pack["domain"]["terms"][0]["standard_ref"] = "std-a"
            return pack

        self.assertEqual(check(with_standard())["status"], "passed")
        pack = with_standard()
        del pack["domain"]["standards"][0]["locator"]
        self.assertIn("verified_incomplete", codes(check(pack)))
        self.assertIn("checked_on_future", codes(check(with_standard(checked_on="2027-01-01"))))
        self.assertIn("checked_on_format", codes(check(with_standard(checked_on="2026-13-40"))))
        stale = check(with_standard(checked_on="2024-01-01"))
        self.assertTrue(stale["valid"])
        self.assertIn("stale_standard_check", codes(stale, "warnings"))

    def test_seed_standard_warns_and_taints_claims(self):
        pack = base_pack()
        pack["domain"]["standards"] = [dict(id="std-seed", title="某手册", kind="style-guide", status="seed")]
        pack["truth"]["claims"][0] = dict(id="claim-level", text="两边液面最终一样高", kind="sourced", standard_ref="std-seed")
        result = check(pack)
        self.assertTrue(result["valid"])
        self.assertTrue({"standard_unverified", "claim_on_unverified_standard", "no_verified_standard"} <= codes(result, "warnings"))
        self.assertFalse(check(pack, strict=True)["valid"])

    def test_consensus_needs_two_independent_sources(self):
        pack = base_pack()
        pack["domain"]["standards"] = [dict(id="std-c", title="历史共识", kind="consensus", status="seed", sources=["甲"])]
        self.assertIn("consensus_sources", codes(check(pack)))
        pack["domain"]["standards"][0]["sources"] = ["甲", "乙"]
        self.assertNotIn("consensus_sources", codes(check(pack)))

    def test_terms_are_one_meaning_one_word(self):
        pack = base_pack()
        del pack["domain"]["terms"][0]["source"]
        self.assertIn("term_source_required", codes(check(pack)))
        pack = base_pack()
        pack["domain"]["terms"][0]["standard_ref"] = "std-missing"
        self.assertIn("term_standard_reference", codes(check(pack)))
        pack = base_pack()
        pack["domain"]["terms"].append(dict(id="term-two", preferred="连通器", definition="另一个定义", source="某处"))
        self.assertIn("duplicate_term", codes(check(pack)))
        pack = base_pack()
        pack["domain"]["terms"].append(dict(id="term-two", preferred="联通管", definition="另一个词", source="某处"))
        self.assertIn("alias_conflict", codes(check(pack)))
        pack = base_pack()
        pack["domain"]["terms"][0]["aliases_forbidden"] = ["连通器"]
        self.assertIn("alias_is_preferred", codes(check(pack)))
        pack = base_pack()
        pack["domain"]["terms"] = []
        self.assertIn("no_terms", codes(check(pack), "warnings"))

    def test_object_carrier_needs_a_one_to_one_mapping(self):
        def mapping(index, **changes):
            item = dict(id=f"map-{index}", concept=f"概念{index}", part=f"部件{index}", fidelity="structural",
                        questions=dict(what="是什么", why="为什么"), breaks_at="比喻在这里会骗人")
            item.update(changes)
            return item

        pack = base_pack()
        pack["carrier"]["kind"] = "object"
        pack["carrier"]["mappings"] = [mapping(1), mapping(2)]
        self.assertIn("mapping_count", codes(check(pack)))
        pack["carrier"]["mappings"] = [mapping(1), mapping(2), mapping(3)]
        self.assertTrue(check(pack)["valid"])
        pack["carrier"]["mappings"][2]["concept"] = "概念1"
        self.assertIn("mapping_not_one_to_one", codes(check(pack)))
        pack["carrier"]["mappings"][2] = mapping(3, part="部件1")
        self.assertIn("mapping_not_one_to_one", codes(check(pack)))
        pack["carrier"]["mappings"][2] = mapping(3, fidelity="perfect")
        self.assertIn("mapping_fidelity", codes(check(pack)))
        pack["carrier"]["mappings"][2] = mapping(3, questions=dict(what="只写了是什么"))
        self.assertIn("mapping_questions", codes(check(pack)))
        pack["carrier"]["mappings"][2] = mapping(3)
        del pack["carrier"]["mappings"][2]["breaks_at"]
        self.assertIn("required_string", codes(check(pack)))
        pack["carrier"]["mappings"][2] = mapping(3, layer_id="layer-nowhere")
        self.assertIn("mapping_layer_reference", codes(check(pack)))

    def test_no_honest_carrier_is_allowed_with_a_reason(self):
        pack = base_pack()
        pack["carrier"] = {"kind": "none"}
        self.assertIn("required_string", codes(check(pack)))
        pack["carrier"]["reason"] = "这是观点，没有可以搭建的机构"
        self.assertTrue(check(pack)["valid"])
        pack["carrier"]["kind"] = "gadget"
        self.assertIn("carrier_kind", codes(check(pack)))

    def test_truth_ledger_classifies_every_claim(self):
        def with_claims(*claims):
            pack = base_pack()
            pack["truth"]["claims"] = list(claims)
            return pack

        self.assertIn("claims_required", codes(check(with_claims())))
        self.assertIn("claim_source_required", codes(check(with_claims(dict(id="c1", text="事实", kind="sourced")))))
        self.assertIn("claim_from_required", codes(check(with_claims(dict(id="c1", text="推出", kind="derived", derivation="算出来的")))))
        self.assertIn("required_string", codes(check(with_claims(dict(id="c1", text="示意", kind="illustrative")))))
        self.assertIn("claim_kind", codes(check(with_claims(dict(id="c1", text="事实", kind="guess")))))
        self.assertIn("claim_unit", codes(check(with_claims(dict(id="c1", text="三次", kind="illustrative", disclosure="示意", value=3)))))
        self.assertIn("claim_value", codes(check(with_claims(dict(id="c1", text="三次", kind="illustrative", disclosure="示意",
                                                                      value=float("inf"), unit="次")))))
        self.assertIn("claim_as_of", codes(check(with_claims(dict(id="c1", text="事实", kind="sourced", source="某处", as_of="昨天")))))
        self.assertIn("duplicate_id", codes(check(with_claims(dict(id="c1", text="甲", kind="illustrative", disclosure="示意"),
                                                              dict(id="c1", text="乙", kind="illustrative", disclosure="示意")))))

    def test_derived_claims_must_trace_back_without_cycles(self):
        def derived(ident, source):
            return dict(id=ident, text="推出的数", kind="derived", derivation="由来源算出", **{"from": [source]})

        pack = base_pack()
        pack["truth"]["claims"] = [derived("c-a", "c-b"), derived("c-b", "c-a")]
        self.assertIn("claim_cycle", codes(check(pack)))
        pack["truth"]["claims"] = [derived("c-a", "c-ghost")]
        self.assertIn("claim_from_reference", codes(check(pack)))
        pack["truth"]["claims"] = [dict(id="c-b", text="来源数", kind="sourced", source="某处"), derived("c-a", "c-b")]
        self.assertTrue(check(pack)["valid"])

    def test_event_pack_dates_facts_and_lists_unknowns(self):
        self.assertTrue(check(event_pack())["valid"], check(event_pack()))
        pack = event_pack()
        del pack["truth"]["claims"][0]["as_of"]
        self.assertIn("event_claim_as_of", codes(check(pack)))
        pack = event_pack()
        del pack["truth"]["unknown"]
        self.assertIn("unknown_required", codes(check(pack)))
        pack = event_pack()
        pack["truth"]["unknown"] = []
        self.assertIn("unknown_required", codes(check(pack)))
        pack["truth"]["unknown_none_reason"] = "公告已覆盖全部问题，没有遗留"
        self.assertTrue(check(pack)["valid"])
        pack = event_pack()
        pack["truth"]["unknown"][0]["status"] = "maybe"
        self.assertIn("unknown_status", codes(check(pack)))

    def test_non_event_packs_do_not_need_unknowns(self):
        self.assertNotIn("unknown_required", codes(check(base_pack())))

    def test_layers_climb_bridge_and_close(self):
        pack = base_pack()
        pack["layers"][0]["level"] = "L3"
        self.assertIn("first_layer", codes(check(pack)))
        pack = base_pack()
        pack["layers"].insert(1, dict(id="layer-mid", level="L4", goal="g", new_load="n", exit_test="e",
                                      bridge_from_previous="b", script_ref="s"))
        pack["layers"].insert(2, dict(id="layer-back", level="L2", goal="g", new_load="n", exit_test="e",
                                      bridge_from_previous="b", script_ref="s"))
        self.assertIn("layer_order", codes(check(pack)))
        pack["layers"][2]["chapter"] = "第二章"
        self.assertNotIn("layer_order", codes(check(pack)))
        pack = base_pack()
        del pack["layers"][1]["bridge_from_previous"]
        self.assertIn("bridge_required", codes(check(pack)))
        pack = base_pack()
        pack["layers"][1]["level"] = "L5"
        self.assertIn("closing_layer_required", codes(check(pack)))
        pack = base_pack()
        del pack["layers"][1]["model_boundary"]
        self.assertIn("closing_incomplete", codes(check(pack)))
        pack = base_pack()
        pack["layers"][1]["extension_pointers"] = []
        self.assertIn("closing_incomplete", codes(check(pack)))
        pack = base_pack()
        del pack["layers"][0]["script_ref"]
        self.assertIn("layer_unanchored", codes(check(pack)))
        pack = base_pack()
        pack["layers"] = pack["layers"][1:]
        self.assertIn("layers_required", codes(check(pack)))

    def test_one_new_load_per_layer_is_nudged(self):
        pack = base_pack()
        pack["layers"][0]["new_load"] = "水压、流速、管径"
        self.assertIn("multiple_new_loads", codes(check(pack), "warnings"))

    def test_checks_never_pass_without_evidence(self):
        pack = base_pack()
        pack["checks"]["accuracy"] = {"status": "passed", "evidence": []}
        self.assertIn("check_evidence", codes(check(pack)))
        pack["checks"]["accuracy"] = {"status": "passed", "evidence": ["2026-10-19 对照 RFC 全文逐条核对"]}
        self.assertTrue(check(pack)["valid"])
        pack["checks"]["accuracy"] = {"status": "great", "evidence": []}
        self.assertIn("check_status", codes(check(pack)))
        pack["checks"] = {"vibes": {"status": "not_run", "evidence": []}}
        self.assertIn("unknown_check", codes(check(pack), "warnings"))

    def test_placeholders_and_unfilled_templates(self):
        pack = base_pack()
        pack["topic"] = "TODO 以后写"
        self.assertIn("placeholder_text", codes(check(pack)))
        pack = base_pack()
        pack["claim"] = "替换为一句话"
        result = check(pack)
        self.assertTrue(result["valid"])
        self.assertIn("template_text", codes(result, "warnings"))
        self.assertFalse(check(pack, strict=True)["valid"])

    def test_expression_profile_and_limits_are_checked(self):
        pack = base_pack()
        pack["expression"]["profile"] = "ste-en"
        self.assertIn("expression_profile", codes(check(pack)))
        pack = base_pack()
        pack["expression"] = {"profile": "none"}
        self.assertIn("required_string", codes(check(pack)))
        pack = base_pack()
        pack["expression"]["limits"] = {"description_target": 50}
        self.assertIn("expression_limits", codes(check(pack)))


class PlanIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.plan = load_json(ROOT / "examples" / "tcp-handshake.plan.json")

    def knowledge(self, plan, **options):
        options.setdefault("today", TODAY)
        return validate_knowledge(plan["knowledge"], plan=plan, base="$.knowledge", **options)

    def test_the_real_facts_example_is_clean_in_strict_mode(self):
        result = self.knowledge(self.plan, strict=True)
        self.assertEqual((result["valid"], result["warnings"]), (True, []), result)

    def test_layers_must_point_at_real_scenes_and_elements(self):
        plan = copy.deepcopy(self.plan)
        plan["knowledge"]["layers"][1]["scene_ids"] = ["scene-nowhere"]
        self.assertIn("layer_scene_reference", codes(self.knowledge(plan)))
        plan = copy.deepcopy(self.plan)
        for layer in plan["knowledge"]["layers"]:
            if layer["level"] == "L3":
                layer["focus_element_id"] = "element-nowhere"
        self.assertIn("focus_reference", codes(self.knowledge(plan)))
        plan = copy.deepcopy(self.plan)
        for layer in plan["knowledge"]["layers"]:
            if layer["level"] == "L3":
                del layer["focus_element_id"]
        self.assertIn("focus_required", codes(self.knowledge(plan)))
        plan = copy.deepcopy(self.plan)
        plan["knowledge"]["carrier"]["mappings"][0]["element_id"] = "element-nowhere"
        self.assertIn("mapping_element_reference", codes(self.knowledge(plan)))
        plan = copy.deepcopy(self.plan)
        plan["knowledge"]["layers"][1].pop("scene_ids")
        self.assertIn("layer_scene_required", codes(self.knowledge(plan)))

    def test_a_scene_without_a_layer_is_flagged(self):
        plan = copy.deepcopy(self.plan)
        orphan = copy.deepcopy(plan["scenes"][1])
        orphan["id"] = "scene-orphan"
        plan["scenes"].append(orphan)
        self.assertIn("scene_without_layer", codes(self.knowledge(plan), "warnings"))

    def test_numbers_must_come_from_the_ledger(self):
        plan = copy.deepcopy(self.plan)
        plan["scenes"][0]["narration"][0]["display"] = plan["scenes"][0]["narration"][0]["display"] + "一共 9999 个。"
        plan["scenes"][0]["narration"][0]["spoken"] = plan["scenes"][0]["narration"][0]["display"]
        warnings = [w for w in self.knowledge(plan)["warnings"] if w["code"] == "number_not_in_ledger"]
        self.assertTrue(warnings)
        self.assertIn("9999", warnings[0]["message"])

    def test_forbidden_aliases_in_plan_text_are_errors(self):
        plan = copy.deepcopy(self.plan)
        scene = plan["scenes"][1]
        scene["narration"][0]["display"] += "这个数据包叫做 SYN。"
        scene["narration"][0]["spoken"] += "这个数据包叫做 S Y N。"
        self.assertIn("forbidden_alias", codes(self.knowledge(plan)))

    def test_malformed_values_are_reported_and_never_crash_the_plan_check(self):
        cases = {
            "terms": lambda k: k["domain"].update(terms=7),
            "standards": lambda k: k["domain"].update(standards=7),
            "mappings": lambda k: k["carrier"].update(mappings=7),
            "claims": lambda k: k["truth"].update(claims=7),
            "term item": lambda k: k["domain"]["terms"].append("x"),
            "standard item": lambda k: k["domain"]["standards"].append("x"),
            "domain": lambda k: k.update(domain=5),
            "carrier": lambda k: k.update(carrier=5),
            "truth": lambda k: k.update(truth=5),
            "layers": lambda k: k.update(layers=5),
            "vague_extra": lambda k: k["expression"].update(vague_extra=[1]),
        }
        for name, change in cases.items():
            with self.subTest(name):
                plan = copy.deepcopy(self.plan)
                change(plan["knowledge"])
                self.assertFalse(self.knowledge(plan)["valid"])

    def test_validate_plan_merges_knowledge_findings(self):
        path = ROOT / "examples" / "tcp-handshake.plan.json"
        result = validate_plan(self.plan, path)  # no strict mode: the staleness check depends on today's date
        self.assertTrue(result["valid"], result["errors"])
        self.assertEqual(result["knowledge"]["scope"], "knowledge-pack-contract-only")
        broken = copy.deepcopy(self.plan)
        broken["knowledge"]["layers"][1]["scene_ids"] = ["scene-nowhere"]
        merged = validate_plan(broken, path)
        self.assertFalse(merged["valid"])
        self.assertTrue(any(e["path"].startswith("$.knowledge") for e in merged["errors"]))

    def test_expression_ids_and_pack_must_agree(self):
        path = ROOT / "examples" / "tcp-handshake.plan.json"
        missing = copy.deepcopy(self.plan)
        del missing["knowledge"]
        result = validate_plan(missing, path)
        self.assertIn("knowledge_pack_missing", codes(result, "warnings"))
        self.assertTrue(result["valid"])
        self.assertFalse(validate_plan(missing, path, strict_knowledge=True)["valid"])
        unrecorded = copy.deepcopy(self.plan)
        unrecorded["design"]["expression_ids"] = [x for x in unrecorded["design"]["expression_ids"] if not x.startswith("knowledge.")]
        self.assertIn("knowledge_expression_unrecorded", codes(validate_plan(unrecorded, path), "warnings"))

    def test_plans_without_knowledge_are_untouched(self):
        for name in ("knowledge-explainer", "news-brief", "product-demo", "brand-film"):
            path = ROOT / "examples" / f"{name}.plan.json"
            result = validate_plan(load_json(path), path, strict_knowledge=True)
            self.assertNotIn("knowledge", result, name)
            self.assertTrue(result["valid"], (name, result["errors"]))

    def test_cli_accepts_a_plan_or_a_standalone_pack(self):
        run = subprocess.run([sys.executable, "-B", str(SCRIPTS / "knowledge_pack.py"), str(ROOT / "examples" / "tcp-handshake.plan.json"),
                              "--strict", "--today", "2026-10-19"], capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stdout)
        run = subprocess.run([sys.executable, "-B", str(SCRIPTS / "knowledge_pack.py"), str(ROOT / "templates" / "knowledge-pack.json"),
                              "--strict", "--today", "2026-10-19"], capture_output=True, text=True)
        self.assertEqual(run.returncode, 1)
        self.assertIn("template_text", run.stdout)


class ScriptLintTests(unittest.TestCase):
    """lint_script: the standalone counterpart of the plan-text check, used by presenter projects."""

    def pack(self):
        pack = base_pack()
        pack["expression"] = {"profile": "ste-zh-spoken", "pronunciations": {}}
        pack["truth"]["claims"][0]["text"] = "两边液面最终一样高，差 25 毫米"
        return pack

    def test_numbers_in_a_script_must_come_from_the_ledger(self):
        pack = self.pack()
        self.assertNotIn("number_not_in_ledger", codes(lint_script(pack, lint.parse_script("液面差 25 毫米。")), "warnings"))
        loose = lint_script(pack, lint.parse_script("液面差 99 毫米。"))
        self.assertIn("number_not_in_ledger", codes(loose, "warnings"))
        self.assertTrue(loose["valid"])
        strict = lint_script(pack, lint.parse_script("液面差 99 毫米。"), strict=True)
        self.assertFalse(strict["valid"])
        self.assertEqual(strict["status"], "failed")
        self.assertIn("number_not_in_ledger", codes(strict))
        self.assertEqual(strict["errors"][0]["line"], 1)

    def test_single_digits_and_unspoken_paragraphs_are_exempt(self):
        pack = self.pack()
        text = "一共有 3 个部分。\n\n<!-- speak=off -->\n\n备注：99 号文件。\n\n<!-- lint=off -->\n\n液面差 77 毫米。"
        self.assertNotIn("number_not_in_ledger", codes(lint_script(pack, lint.parse_script(text)), "warnings"))

    def test_the_profile_comes_from_the_pack_with_a_spoken_default(self):
        units = lint.parse_script("连通器的 TCP 很重要。")
        pack = self.pack()
        self.assertIn("missing_pronunciation", codes(lint_script(pack, units), "warnings"))
        pack["expression"]["profile"] = "ste-zh-v1"
        self.assertNotIn("missing_pronunciation", codes(lint_script(pack, units), "warnings"))
        pack["expression"] = {}
        self.assertEqual(lint_script(pack, units)["profile"], "ste-zh-spoken")

    def test_malformed_lint_options_do_not_crash_the_pack_check(self):
        pack = self.pack()
        pack["expression"]["vague_extra"] = [1]
        with self.assertRaises((ValueError, TypeError)):
            lint_script(pack, lint.parse_script("液面一样高。"))
        plan = load_json(ROOT / "examples" / "tcp-handshake.plan.json")
        plan["knowledge"]["expression"]["vague_extra"] = [1]
        result = validate_knowledge(plan["knowledge"], plan=plan, base="$.knowledge", today=TODAY)
        self.assertIn("string_array", codes(result))


class ExampleAndCatalogTests(unittest.TestCase):
    def test_example_plans_validate_strictly(self):
        for name in ("tcp-handshake", "evidence-board"):
            path = ROOT / "examples" / f"{name}.plan.json"
            plan = load_json(path)
            result = validate_plan(plan, path)
            self.assertTrue(result["valid"], (name, result["errors"]))
            self.assertEqual(plan["example"]["actual_video"], False, name)
            self.assertEqual(plan["delivery"]["status"], "not_run", name)
            knowledge = validate_knowledge(plan["knowledge"], plan=plan, strict=True, base="$.knowledge", today=TODAY)
            self.assertTrue(knowledge["valid"], (name, knowledge["errors"]))

    def test_the_news_example_is_fictional_and_dated(self):
        plan = load_json(ROOT / "examples" / "evidence-board.plan.json")
        self.assertEqual(plan["example"]["classification"], "fictional-structure-only")
        self.assertEqual(plan["knowledge"]["relation_type"], "event")
        sourced = [c for c in plan["knowledge"]["truth"]["claims"] if c["kind"] == "sourced"]
        self.assertTrue(sourced and all(c.get("as_of") for c in sourced))
        self.assertTrue(plan["knowledge"]["truth"]["unknown"])
        self.assertTrue(any(c["kind"] == "illustrative" and "虚构" in c["text"] for c in plan["knowledge"]["truth"]["claims"]))

    def test_the_standalone_example_checks_on_its_own_and_against_an_existing_plan(self):
        pack = load_json(ROOT / "examples" / "correlation-common-cause.knowledge-pack.json")
        alone = validate_knowledge(pack, standalone=True, strict=True, today=TODAY)
        self.assertTrue(alone["valid"], alone["errors"])
        self.assertEqual(codes(alone, "warnings"), set())
        plan = load_json(ROOT / "examples" / "knowledge-explainer.plan.json")
        result = validate_knowledge(pack, plan=plan, standalone=True, today=TODAY)
        self.assertTrue(result["valid"], result["errors"])
        self.assertEqual(codes(result, "warnings"), {"semicolon"})
        self.assertEqual(pack["carrier"]["kind"], "diagram")

    def test_template_only_complains_about_unfilled_text(self):
        result = validate_knowledge(load_json(ROOT / "templates" / "knowledge-pack.json"), standalone=True, today=TODAY)
        self.assertTrue(result["valid"], result["errors"])
        self.assertEqual(codes(result, "warnings"), {"template_text"})

    def test_catalog_has_the_knowledge_layer(self):
        expressions = catalog("expression")
        knowledge = {k for k, v in expressions.items() if v["layer"] == "knowledge"}
        self.assertEqual(knowledge, {k for k in expressions if k.startswith("knowledge.")})
        self.assertEqual(len(knowledge), 11)
        for ident in knowledge:
            self.assertEqual(expressions[ident]["status"], "guidance")
            self.assertTrue(expressions[ident]["source_refs"], ident)
        scenarios = catalog("scenario")
        self.assertEqual(knowledge - {"knowledge.evidence-board"} - set(scenarios["knowledge-explainer"]["expression_ids"]), set())
        self.assertTrue({"knowledge.evidence-board", "knowledge.truth-ledger", "knowledge.controlled-register",
                         "knowledge.layered-reveal", "knowledge.model-boundary"} <= set(scenarios["news-brief"]["expression_ids"]))
        recipes = catalog("recipe")
        for ident in ("object-explainer", "layered-concept-reveal", "evidence-board-brief"):
            self.assertIn(ident, recipes)
            self.assertTrue(set(recipes[ident]["expression_ids"]) & knowledge, ident)
        self.assertIn("evidence-board-brief", scenarios["news-brief"]["recipe_ids"])
        self.assertTrue({"object-explainer", "layered-concept-reveal"} <= set(scenarios["knowledge-explainer"]["recipe_ids"]))

    def test_counts_in_the_docs_match_the_catalog(self):
        expressions, recipes = len(catalog("expression")), len(catalog("recipe"))
        method = (ROOT / "references" / "expression-method.md").read_text(encoding="utf-8")
        self.assertIn(f"expression 目录提供{expressions}项", method)
        self.assertIn(f"recipe目录提供{recipes}类", method)
        self.assertIn(f"{expressions}项不等于", method)
        self.assertIn(f"{recipes}类配方", method)

    def test_evals_are_well_formed_and_not_claimed_as_run(self):
        data = load_json(ROOT / "evals" / "knowledge-method-evals.json")
        self.assertEqual(data["status"], "authored-not-run")
        ids = [e["id"] for e in data["evals"]]
        self.assertEqual(len(ids), len(set(ids)))
        for item in data["evals"]:
            self.assertTrue(item["prompt"] and item["expected_output"] and item["assertions"], item["id"])


class DocumentationDriftTests(unittest.TestCase):
    def test_every_pack_check_code_is_documented(self):
        source = (SCRIPTS / "knowledge_pack.py").read_text(encoding="utf-8")
        found = set(re.findall(r'r\.(?:error|warning)\(\s*"([a-z_]+)"', source)) | {"string_array"}
        doc = (ROOT / "references" / "knowledge-pack.md").read_text(encoding="utf-8")
        missing = sorted(c for c in found if f"`{c}`" not in doc)
        self.assertEqual(missing, [], "document these check codes in references/knowledge-pack.md")

    def test_every_lint_code_is_documented(self):
        doc = (ROOT / "references" / "domain-standards.md").read_text(encoding="utf-8")
        missing = sorted(c for c in lint.DEFAULT_SEVERITY if c not in doc)
        self.assertEqual(missing, [], "document these lint codes in references/domain-standards.md")

    def test_relative_links_resolve(self):
        pages = [ROOT / "SKILL.md", *sorted((ROOT / "references").glob("*.md"))]
        broken = []
        for page in pages:
            for target in re.findall(r"\]\(([^)\s]+)\)", page.read_text(encoding="utf-8")):
                if re.match(r"[a-z]+:", target) or target.startswith("#"):
                    continue
                if not (page.parent / target.split("#")[0]).exists():
                    broken.append(f"{page.name}: {target}")
        self.assertEqual(broken, [])

    def test_shared_kernel_matches_the_sibling_skill(self):
        if not SIBLING.is_dir():
            self.skipTest("sibling skill is not installed next to this one")
        for name in ("controlled_lint.py", "knowledge_pack.py"):
            twin = SIBLING / name
            if not twin.exists():
                self.skipTest(f"sibling copy not installed yet: {name}")
            self.assertEqual((SCRIPTS / name).read_bytes(), twin.read_bytes(), f"{name} drifted from the sibling skill; change both copies together")


if __name__ == "__main__":
    unittest.main()
