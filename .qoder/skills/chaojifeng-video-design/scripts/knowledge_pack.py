#!/usr/bin/env python3
"""Validate a knowledge pack: domain standards, terms, carrier mapping, truth ledger and layered reveal.

Contract-only. It checks structure, references and mechanical language rules. It cannot judge whether a
metaphor is apt, a fact is true or an audience understood; those stay in the review checks. Standard
library only; no network. Shared byte-for-byte by chaojifeng-video-design and ai-avatar-narration
(each Skill must stay installable alone). Change both copies together; both test suites fail on drift.

Embedded in a plan as plan["knowledge"] (references into scenes are then resolved), or standalone as a
JSON file (ai-avatar-narration keeps one per project).
"""
import argparse
import datetime
import json
import math
import re
import sys
from pathlib import Path

import controlled_lint as lint

LEVELS = ("L0", "L1", "L2", "L3", "L4", "L5", "L6")
RELATION_TYPES = ("process", "condition", "capacity", "hierarchy", "comparison", "feedback", "transform",
                  "concurrency", "probability", "growth", "causal", "event", "definition", "other")
AUDIENCE_LEVELS = ("novice", "practitioner", "expert")
STANDARD_KINDS = ("standard", "terminology", "style-guide", "convention", "official-doc", "consensus", "none")
STANDARD_STATUS = ("verified", "seed", "not_found", "none")
CARRIER_KINDS = ("object", "spatial", "process", "data", "diagram", "none")
MIN_MAPPINGS = {"object": 3, "spatial": 2, "process": 2, "data": 2, "diagram": 0}
FIDELITY = ("exact", "structural", "illustrative")
CLAIM_KINDS = ("sourced", "derived", "illustrative")
CHECK_STATUS = ("not_run", "passed", "partial", "failed")
CHECK_KEYS = ("terminology", "accuracy", "novice_read", "peer_read", "expert_read")
UNKNOWN_STATUS = ("unconfirmed", "disputed", "unknown")
QUESTION_KEYS = ("what", "happening", "why", "use")
ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$")
NUMBER_RE = re.compile(r"\d+(?:\.\d+)?")
TEMPLATE_RE = re.compile(r"^\s*替换为")
STALE_DAYS = 365


class _Report:
    def __init__(self, strict=False):
        self.strict = strict
        self.errors, self.warnings = [], []

    def error(self, code, path, message):
        self.errors.append(dict(code=code, path=path, message=message))

    def warning(self, code, path, message):
        (self.error if self.strict else self._warn)(code, path, message)

    def _warn(self, code, path, message):
        self.warnings.append(dict(code=code, path=path, message=message))

    def result(self, **extra):
        return dict(schema_version=1, valid=not self.errors,
                    status="failed" if self.errors else "partial" if self.warnings else "passed",
                    errors=self.errors, warnings=self.warnings, **extra)


def _text(value):
    return isinstance(value, str) and bool(value.strip())


def _id(value):
    return isinstance(value, str) and bool(ID_RE.fullmatch(value))


def _number(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def _need(obj, keys, r, path):
    for key in keys:
        if not _text(obj.get(key)):
            r.error("required_string", f"{path}.{key}", "expected a nonempty string")


def _strings(value, r, path, code="string_array"):
    if not isinstance(value, list) or any(not _text(x) for x in value):
        r.error(code, path, "expected an array of nonempty strings")
        return []
    return value


def _date(value):
    try:
        return datetime.date.fromisoformat(value) if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) else None
    except ValueError:
        return None


def _object(parent, key, r, path, required=True):
    value = parent.get(key)
    if value is None and not required:
        return None
    if not isinstance(value, dict):
        r.error("object_type", f"{path}.{key}", "expected an object")
        return None
    return value


def _placeholders(value, r, path, seen):
    if isinstance(value, str):
        if lint.PLACEHOLDER_RE.search(value) and len(seen) < 20:
            seen.add(path)
            r.error("placeholder_text", path, "unfinished placeholder (TODO / 待填写 / 待补充 / TBD)")
        elif TEMPLATE_RE.match(value) and len(seen) < 20:
            seen.add(path)
            r.warning("template_text", path, "unfilled template text (starts with 替换为); write the real content before relying on this pack")
    elif isinstance(value, dict):
        for key, child in value.items():
            _placeholders(child, r, f"{path}.{key}", seen)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _placeholders(child, r, f"{path}[{index}]", seen)


def _standards(items, r, base, today):
    found = {}
    if not isinstance(items, list) or not items:
        r.error("standards_required", base + ".standards",
                "list at least one standard, or one entry with kind none and a reason explaining why none applies")
        return found
    for i, std in enumerate(items):
        path = f"{base}.standards[{i}]"
        if not isinstance(std, dict):
            r.error("object_type", path, "expected an object")
            continue
        if not _id(std.get("id")):
            r.error("stable_id", path + ".id", "use a stable lowercase ID")
        elif std["id"] in found:
            r.error("duplicate_id", path + ".id", "duplicate standard ID: " + std["id"])
        else:
            found[std["id"]] = std
        _need(std, ["title"], r, path)
        kind, status = std.get("kind"), std.get("status")
        if kind not in STANDARD_KINDS:
            r.error("standard_kind", path + ".kind", "expected one of " + ", ".join(STANDARD_KINDS))
        if status not in STANDARD_STATUS:
            r.error("standard_status", path + ".status", "expected one of " + ", ".join(STANDARD_STATUS))
        if "url" in std and not _text(std["url"]):
            r.error("required_string", path + ".url", "expected a nonempty string")
        if kind == "none":
            if status not in ("none", "not_found"):
                r.error("standard_none_status", path + ".status", "kind none requires status none or not_found")
            _need(std, ["reason"], r, path)
        elif status == "none":
            r.error("standard_none_status", path + ".status", "status none requires kind none")
        if kind == "consensus":
            sources = std.get("sources")
            if not isinstance(sources, list) or len([s for s in sources if _text(s)]) < 2:
                r.error("consensus_sources", path + ".sources", "historical industry consensus needs at least two independent authoritative sources")
        if status == "verified":
            for key in ("version", "locator", "checked_on"):
                if not _text(std.get(key)):
                    r.error("verified_incomplete", f"{path}.{key}", f"verified requires {key} (what was checked, where, when)")
            checked = _date(std.get("checked_on"))
            if _text(std.get("checked_on")) and checked is None:
                r.error("checked_on_format", path + ".checked_on", "expected a real YYYY-MM-DD date")
            elif checked and checked > today:
                r.error("checked_on_future", path + ".checked_on", "checked_on is in the future")
            elif checked and (today - checked).days > STALE_DAYS:
                r.warning("stale_standard_check", path + ".checked_on", f"checked more than {STALE_DAYS} days ago; standards are revised, recheck the current edition")
        elif status == "seed":
            r.warning("standard_unverified", path + ".status", "seed source is a starting point only; verify edition, clause and current status before production")
        elif status == "not_found":
            _need(std, ["reason"], r, path)
    if found and not any(s.get("status") == "verified" or s.get("kind") == "none" for s in found.values()):
        r.warning("no_verified_standard", base + ".standards", "no standard is verified; verify one or state explicitly that none applies (kind none)")
    return found


def _terms(items, standards, r, base):
    found, names = {}, {}
    if items is None:
        r.warning("no_terms", base + ".terms", "no term cards: one-term-one-meaning cannot be enforced")
        return found
    if not isinstance(items, list):
        r.error("array_type", base + ".terms", "expected an array")
        return found
    if not items:
        r.warning("no_terms", base + ".terms", "no term cards: one-term-one-meaning cannot be enforced")
    for i, term in enumerate(items):
        path = f"{base}.terms[{i}]"
        if not isinstance(term, dict):
            r.error("object_type", path, "expected an object")
            continue
        if not _id(term.get("id")):
            r.error("stable_id", path + ".id", "use a stable lowercase ID")
        elif term["id"] in found:
            r.error("duplicate_id", path + ".id", "duplicate term ID: " + term["id"])
        else:
            found[term["id"]] = term
        _need(term, ["preferred"], r, path)
        if term.get("known_to_audience") is not True:
            _need(term, ["definition"], r, path)
        for key in ("abbr", "spoken_as", "definition", "source"):
            if key in term and not _text(term[key]):
                r.error("required_string", f"{path}.{key}", "expected a nonempty string")
        for key in ("define_on_first_use", "known_to_audience"):
            if key in term and type(term[key]) is not bool:
                r.error("boolean_type", f"{path}.{key}", "expected true or false")
        if "aliases_forbidden" in term:
            aliases = _strings(term["aliases_forbidden"], r, path + ".aliases_forbidden")
            if any(a.casefold() == str(term.get("preferred", "")).casefold() for a in aliases):
                r.error("alias_is_preferred", path + ".aliases_forbidden", "a forbidden alias equals the preferred term")
        ref = term.get("standard_ref")
        if ref is not None:
            if not isinstance(ref, str) or ref not in standards:
                r.error("term_standard_reference", path + ".standard_ref", "unresolved standard ID: " + str(ref))
        elif not _text(term.get("source")):
            r.error("term_source_required", path, "give standard_ref or a source for the term's wording")
        for name in (term.get("preferred"), term.get("abbr")):
            if _text(name):
                key = name.casefold()
                if key in names and names[key] != term.get("id"):
                    r.error("duplicate_term", path, f"term or abbreviation already used by {names[key]}: {name}")
                names.setdefault(key, term.get("id"))
    for term in found.values():
        for alias in term.get("aliases_forbidden", []) if isinstance(term.get("aliases_forbidden"), list) else []:
            if _text(alias) and alias.casefold() in names and names[alias.casefold()] != term["id"]:
                r.error("alias_conflict", base + ".terms", f"forbidden alias of {term['id']} is another term's preferred wording: {alias}")
    return found


def _expression(ex, r, base):
    if not isinstance(ex, dict):
        r.error("object_type", base + ".expression", "expected an object")
        return {}
    profile = ex.get("profile")
    if profile not in lint.PROFILES and profile != "none":
        r.error("expression_profile", base + ".expression.profile", "expected one of " + ", ".join(sorted(lint.PROFILES) + ["none"]))
    if profile == "none":
        _need(ex, ["reason"], r, base + ".expression")
    try:
        lint.merge_limits(ex.get("limits"))
    except ValueError as exc:
        r.error("expression_limits", base + ".expression.limits", str(exc))
    if "pronunciations" in ex:
        pron = ex["pronunciations"]
        if not isinstance(pron, dict) or any(not _text(k) or not _text(v) for k, v in pron.items()):
            r.error("pronunciations", base + ".expression.pronunciations", "expected an object of nonempty token -> spoken form")
    for key in ("allow", "vague_extra"):
        if key in ex:
            _strings(ex[key], r, f"{base}.expression.{key}")
    return ex


def _carrier(c, r, base):
    mappings = {}
    if not isinstance(c, dict):
        r.error("object_type", base + ".carrier", "expected an object")
        return mappings
    path = base + ".carrier"
    kind = c.get("kind")
    if kind not in CARRIER_KINDS:
        r.error("carrier_kind", path + ".kind", "expected one of " + ", ".join(CARRIER_KINDS))
        return mappings
    if kind == "none":
        _need(c, ["reason"], r, path)
        return mappings
    _need(c, ["object", "mechanism", "fallback"], r, path)
    if "limits" in c:
        _strings(c["limits"], r, path + ".limits")
    items = c.get("mappings", [])
    if not isinstance(items, list):
        r.error("array_type", path + ".mappings", "expected an array")
        items = []
    if len(items) < MIN_MAPPINGS[kind]:
        r.error("mapping_count", path + ".mappings", f"a {kind} carrier needs at least {MIN_MAPPINGS[kind]} concept-to-part mappings")
    concepts, parts = {}, {}
    for i, m in enumerate(items):
        mp = f"{path}.mappings[{i}]"
        if not isinstance(m, dict):
            r.error("object_type", mp, "expected an object")
            continue
        if not _id(m.get("id")):
            r.error("stable_id", mp + ".id", "use a stable lowercase ID")
        elif m["id"] in mappings:
            r.error("duplicate_id", mp + ".id", "duplicate mapping ID: " + m["id"])
        else:
            mappings[m["id"]] = m
        _need(m, ["concept", "part", "breaks_at"], r, mp)
        if m.get("fidelity") not in FIDELITY:
            r.error("mapping_fidelity", mp + ".fidelity", "expected one of " + ", ".join(FIDELITY))
        for key in ("element_id", "layer_id"):
            if key in m and not _text(m[key]):
                r.error("required_string", f"{mp}.{key}", "expected a nonempty string")
        questions = m.get("questions")
        if not isinstance(questions, dict):
            r.error("mapping_questions", mp + ".questions", "answer at least what and why for every part (the four questions)")
        else:
            for key in ("what", "why"):
                if not _text(questions.get(key)):
                    r.error("mapping_questions", f"{mp}.questions.{key}", "required: what is it / why is it there")
            for key in questions:
                if key not in QUESTION_KEYS:
                    r.warning("unknown_question", f"{mp}.questions.{key}", "expected what, happening, why or use")
                elif not _text(questions[key]):
                    r.error("required_string", f"{mp}.questions.{key}", "expected a nonempty string")
        for label, table, value in (("concept", concepts, m.get("concept")), ("part", parts, m.get("part"))):
            if _text(value):
                key = value.strip().casefold()
                if key in table:
                    r.error("mapping_not_one_to_one", f"{mp}.{label}", f"{label} already mapped in mappings[{table[key]}]; one concept element maps to exactly one part and back")
                table.setdefault(key, i)
    return mappings


def _truth(t, standards, ids, r, base, event=False):
    claims = {}
    if not isinstance(t, dict):
        r.error("object_type", base + ".truth", "expected an object")
        return claims
    items = t.get("claims")
    if not isinstance(items, list) or not items:
        r.error("claims_required", base + ".truth.claims", "list every number and fact the film states, each marked sourced, derived or illustrative")
        return claims
    for i, c in enumerate(items):
        path = f"{base}.truth.claims[{i}]"
        if not isinstance(c, dict):
            r.error("object_type", path, "expected an object")
            continue
        if not _id(c.get("id")):
            r.error("stable_id", path + ".id", "use a stable lowercase ID")
        elif c["id"] in claims:
            r.error("duplicate_id", path + ".id", "duplicate claim ID: " + c["id"])
        else:
            claims[c["id"]] = c
        _need(c, ["text"], r, path)
        kind = c.get("kind")
        if kind not in CLAIM_KINDS:
            r.error("claim_kind", path + ".kind", "expected one of " + ", ".join(CLAIM_KINDS))
        if kind == "sourced":
            ref = c.get("standard_ref")
            if ref is not None:
                if not isinstance(ref, str) or ref not in standards:
                    r.error("claim_standard_reference", path + ".standard_ref", "unresolved standard ID: " + str(ref))
                elif standards[ref].get("status") == "seed":
                    r.warning("claim_on_unverified_standard", path + ".standard_ref", "claim rests on a seed standard that is not verified yet")
            if ref is None and not _text(c.get("source")):
                r.error("claim_source_required", path, "a sourced claim needs standard_ref or source (and a locator when the source is long)")
        elif kind == "derived":
            _need(c, ["derivation"], r, path)
            if not isinstance(c.get("from"), list) or not c.get("from") or any(not _text(x) for x in c["from"]):
                r.error("claim_from_required", path + ".from", "a derived claim lists the claim IDs it is computed from")
        elif kind == "illustrative":
            _need(c, ["disclosure"], r, path)
        if "value" in c:
            if not _number(c["value"]):
                r.error("claim_value", path + ".value", "expected a finite number")
            elif not _text(c.get("unit")):
                r.error("claim_unit", path + ".unit", "a numeric value needs an explicit unit (use 个, 次, 倍 … for counts)")
        if "as_of" in c and _date(c["as_of"]) is None:
            r.error("claim_as_of", path + ".as_of", "expected a real YYYY-MM-DD date")
        if "used_in" in c:
            for ident in _strings(c["used_in"], r, path + ".used_in"):
                if ids is not None and ident not in ids:
                    r.error("claim_used_in_reference", path + ".used_in", "unresolved plan ID: " + ident)
    if event:
        _unknowns(t, claims, r, base)
    graph = {}
    for ident, c in claims.items():
        if c.get("kind") == "derived" and isinstance(c.get("from"), list):
            for src in c["from"]:
                if _text(src) and src not in claims:
                    r.error("claim_from_reference", f"{base}.truth.claims", f"{ident} is derived from unknown claim {src}")
            graph[ident] = [s for s in c["from"] if s in claims]
    state = {}

    def cyclic(node):
        if state.get(node) == "done":
            return False
        if state.get(node) == "visiting":
            return True
        state[node] = "visiting"
        if any(cyclic(nxt) for nxt in graph.get(node, [])):
            return True
        state[node] = "done"
        return False
    for ident in graph:
        if cyclic(ident):
            r.error("claim_cycle", f"{base}.truth.claims", f"derived claims depend on each other in a cycle (found at {ident}); a derived number must trace back to sourced facts")
            break
    return claims


def _unknowns(t, claims, r, base):
    """News and information packs: every sourced fact is dated and the open questions are listed."""
    for ident, c in claims.items():
        if c.get("kind") == "sourced" and not _text(c.get("as_of")):
            r.error("event_claim_as_of", f"{base}.truth.claims", f"{ident}: a news fact needs as_of, the date its source was read or published")
    unknown = t.get("unknown")
    path = base + ".truth.unknown"
    if not isinstance(unknown, list):
        r.error("unknown_required", path, "list what is still unconfirmed, disputed or unknown; an empty list needs truth.unknown_none_reason")
        return
    if not unknown and not _text(t.get("unknown_none_reason")):
        r.error("unknown_required", path, "an empty unknown list needs truth.unknown_none_reason explaining why nothing is open")
    seen = set()
    for i, item in enumerate(unknown):
        item_path = f"{path}[{i}]"
        if not isinstance(item, dict):
            r.error("object_type", item_path, "expected an object")
            continue
        if not _id(item.get("id")):
            r.error("stable_id", item_path + ".id", "use a stable lowercase ID")
        elif item["id"] in seen:
            r.error("duplicate_id", item_path + ".id", "duplicate unknown ID: " + item["id"])
        else:
            seen.add(item["id"])
        _need(item, ["text"], r, item_path)
        if item.get("status") not in UNKNOWN_STATUS:
            r.error("unknown_status", item_path + ".status", "expected one of " + ", ".join(UNKNOWN_STATUS))


def _plan_index(plan):
    ids, scene_elements, scene_ids = set(), {}, set()
    for scene in plan.get("scenes", []) if isinstance(plan.get("scenes"), list) else []:
        if not isinstance(scene, dict) or not _text(scene.get("id")):
            continue
        scene_ids.add(scene["id"])
        local = set()
        ids.add(scene["id"])
        for key in ("elements", "beats", "narration"):
            for item in scene.get(key, []) if isinstance(scene.get(key), list) else []:
                if isinstance(item, dict) and _text(item.get("id")):
                    ids.add(item["id"])
                    if key == "elements":
                        local.add(item["id"])
        scene_elements[scene["id"]] = local
    return ids, scene_elements, scene_ids


def _layers(items, claims, mappings, plan_info, r, base):
    ids = {}
    if not isinstance(items, list) or len(items) < 2:
        r.error("layers_required", base + ".layers", "plan at least two layers; the last one must be L6 (recap, extension pointers, model boundary)")
        return ids
    previous, chapter = -1, None
    for i, layer in enumerate(items):
        path = f"{base}.layers[{i}]"
        if not isinstance(layer, dict):
            r.error("object_type", path, "expected an object")
            continue
        if "chapter" in layer and not _text(layer["chapter"]):
            r.error("required_string", path + ".chapter", "expected a nonempty string")
        elif layer.get("chapter") != chapter:
            chapter, previous = layer.get("chapter"), -1  # a new chapter restarts the climb from L2
        if not _id(layer.get("id")):
            r.error("stable_id", path + ".id", "use a stable lowercase ID")
        elif layer["id"] in ids:
            r.error("duplicate_id", path + ".id", "duplicate layer ID: " + layer["id"])
        else:
            ids[layer["id"]] = layer
        _need(layer, ["goal", "new_load", "exit_test"], r, path)
        level = layer.get("level")
        if level not in LEVELS:
            r.error("layer_level", path + ".level", "expected one of " + ", ".join(LEVELS))
        else:
            index = LEVELS.index(level)
            if index < previous:
                r.error("layer_order", path + ".level", "layers must not step back to a lower level; start a new chapter (layer.chapter) to climb again")
            previous = max(previous, index)
            if i == 0 and level not in ("L0", "L1"):
                r.error("first_layer", path + ".level", "start with L0 (hook) or L1 (black box)")
        if i > 0:
            if not _text(layer.get("bridge_from_previous")):
                r.error("bridge_required", path + ".bridge_from_previous",
                        "say which part of the previous layer becomes which part of this one")
        elif "bridge_from_previous" in layer and not _text(layer["bridge_from_previous"]):
            r.error("required_string", path + ".bridge_from_previous", "expected a nonempty string")
        load = layer.get("new_load")
        if _text(load) and (re.search(r"[；;]", load) or len(re.findall(r"、", load)) >= 2):
            r.warning("multiple_new_loads", path + ".new_load", "one layer adds one new cognitive load; split a list of new things across layers")
        for key in ("claim_ids",):
            if key in layer:
                for ident in _strings(layer[key], r, f"{path}.{key}"):
                    if ident not in claims:
                        r.error("layer_claim_reference", f"{path}.{key}", "unresolved claim ID: " + ident)
        if level == "L6":
            if not _text(layer.get("model_boundary")):
                r.error("closing_incomplete", path + ".model_boundary", "L6 must say what the carrier does not show or where the metaphor breaks")
            pointers = layer.get("extension_pointers")
            if not isinstance(pointers, list) or not [x for x in pointers if _text(x)] or any(not _text(x) for x in pointers):
                r.error("closing_incomplete", path + ".extension_pointers", "L6 must point at where to go next (an array of nonempty strings)")
        if "script_ref" in layer and not _text(layer["script_ref"]):
            r.error("required_string", path + ".script_ref", "expected a nonempty string")
        if plan_info is not None:
            _, scene_elements, scene_ids = plan_info
            scenes = layer.get("scene_ids")
            if not isinstance(scenes, list) or not scenes or any(not _text(s) for s in scenes):
                r.error("layer_scene_required", path + ".scene_ids", "anchor the layer to one or more scenes of this plan")
                scenes = []
            local = set()
            for scene in scenes:
                if scene not in scene_ids:
                    r.error("layer_scene_reference", path + ".scene_ids", "unresolved scene ID: " + str(scene))
                else:
                    local |= scene_elements.get(scene, set())
            focus = layer.get("focus_element_id")
            if focus is None:
                if level in ("L2", "L3", "L4", "L5"):
                    r.error("focus_required", path + ".focus_element_id", "name the one element lit for this layer; the rest step down")
            elif focus not in local:
                r.error("focus_reference", path + ".focus_element_id", "focus must be an element of this layer's scenes")
            for key in ("element_ids",):
                if key in layer:
                    for ident in _strings(layer[key], r, f"{path}.{key}"):
                        if ident not in local:
                            r.error("layer_element_reference", f"{path}.{key}", "element is not in this layer's scenes: " + ident)
        elif not _text(layer.get("script_ref")):
            r.error("layer_unanchored", path + ".script_ref", "standalone pack: point the layer at its script part (for example the layer tag in SCRIPT.md)")
    levels = [x.get("level") for x in items if isinstance(x, dict)]
    if levels and levels[-1] != "L6":
        r.error("closing_layer_required", base + ".layers", "the last layer must be L6: recap, extension pointers and the model's boundary")
    for i, layer in enumerate(items):
        if isinstance(layer, dict) and layer.get("level") == "L4":
            related = [claims[c] for c in layer.get("claim_ids", []) if isinstance(layer.get("claim_ids"), list) and c in claims]
            if not related:
                r.warning("run_without_numbers", f"{base}.layers[{i}]", "the one full run (L4) should show real numbers; link claim_ids")
            elif all(c.get("kind") == "illustrative" for c in related):
                r.warning("run_not_grounded", f"{base}.layers[{i}]", "every claim in the full run is illustrative; ground at least one in a source or derivation")
    for ident, mapping in mappings.items():
        layer_ref = mapping.get("layer_id")
        if layer_ref is not None and layer_ref not in ids:
            r.error("mapping_layer_reference", f"{base}.carrier.mappings", f"mapping {ident} points at unknown layer {layer_ref}")
    if plan_info is not None:
        _, _, scene_ids = plan_info
        used = {s for x in items if isinstance(x, dict) and isinstance(x.get("scene_ids"), list) for s in x["scene_ids"]}
        for scene in sorted(scene_ids - used):
            r.warning("scene_without_layer", base + ".layers", f"scene {scene} serves no layer; give it a layer or remove it")
    return ids


def _checks(ch, r, base):
    if not isinstance(ch, dict):
        r.error("object_type", base + ".checks", "expected an object")
        return
    for key, record in ch.items():
        path = f"{base}.checks.{key}"
        if key not in CHECK_KEYS:
            r.warning("unknown_check", path, "expected one of " + ", ".join(CHECK_KEYS))
        if not isinstance(record, dict) or record.get("status") not in CHECK_STATUS:
            r.error("check_status", path, "expected {status: not_run|passed|partial|failed, evidence: []}")
            continue
        evidence = record.get("evidence", [])
        if not isinstance(evidence, list) or any(not (_text(e) or isinstance(e, dict) and e) for e in evidence):
            r.error("check_evidence", path + ".evidence", "expected an array of nonempty strings or objects")
        elif record["status"] == "passed" and not evidence:
            r.error("check_evidence", path + ".evidence", "passed needs evidence of what was actually done")


def _ledger_numbers(pack, claims):
    pool = []
    for key in ("topic", "claim"):
        pool.append(str(pack.get(key, "")))
    domain = pack.get("domain") if isinstance(pack.get("domain"), dict) else {}
    carrier = pack.get("carrier") if isinstance(pack.get("carrier"), dict) else {}
    for std in domain.get("standards") if isinstance(domain.get("standards"), list) else []:
        if isinstance(std, dict):
            pool += [str(std.get(k, "")) for k in ("title", "version", "locator", "checked_on")]
    for term in domain.get("terms") if isinstance(domain.get("terms"), list) else []:
        if isinstance(term, dict):
            pool += [str(term.get(k, "")) for k in ("preferred", "abbr", "definition")]
    for claim in claims.values():
        pool += [str(claim.get(k, "")) for k in ("text", "value", "as_of", "source", "unit")]
    for m in carrier.get("mappings") if isinstance(carrier.get("mappings"), list) else []:
        if isinstance(m, dict):
            pool += [str(m.get(k, "")) for k in ("concept", "part")]
    numbers = set()
    for chunk in pool:
        numbers.update(NUMBER_RE.findall(chunk))
    return numbers


def _claims_by_id(pack):
    truth = pack.get("truth") if isinstance(pack.get("truth"), dict) else {}
    items = truth.get("claims") if isinstance(truth.get("claims"), list) else []
    return {c["id"]: c for c in items if isinstance(c, dict) and isinstance(c.get("id"), str)}


def _lint_options(pack):
    """Lint options taken from a pack, tolerating malformed values (the pack checks report those separately)."""
    expression = pack.get("expression") if isinstance(pack.get("expression"), dict) else {}
    domain = pack.get("domain") if isinstance(pack.get("domain"), dict) else {}
    audience = pack.get("audience") if isinstance(pack.get("audience"), dict) else {}
    return dict(
        terms=domain.get("terms") if isinstance(domain.get("terms"), list) else [],
        pronunciations=expression.get("pronunciations") if isinstance(expression.get("pronunciations"), dict) else None,
        allow=expression.get("allow") if isinstance(expression.get("allow"), list) else [],
        limits=expression.get("limits") if isinstance(expression.get("limits"), dict) else None,
        vague_extra=expression.get("vague_extra") if isinstance(expression.get("vague_extra"), list) else None,
        audience_level=audience.get("level", "novice"))


def _stray_numbers(text, ledger):
    return sorted({n for n in NUMBER_RE.findall(lint.strip_markup(text)) if len(n.replace(".", "")) >= 2 and n not in ledger})


def lint_script(pack, units, strict=False, default_profile="ste-zh-spoken"):
    """Lint script units (controlled_lint.parse_script output) against a pack.

    The standalone counterpart of the plan-text check: controlled expression plus numbers of two or more digits that the
    truth ledger does not contain. Raises ValueError or TypeError when the pack supplies lint options the linter cannot use.
    """
    expression = pack.get("expression") if isinstance(pack.get("expression"), dict) else {}
    profile = expression.get("profile")
    report = lint.lint_units(units, profile=profile if profile in lint.PROFILES else default_profile, strict=strict,
                             **_lint_options(pack))
    ledger = _ledger_numbers(pack, _claims_by_id(pack))
    for unit in units:
        if unit.get("lint") is False or unit.get("speak") is False:
            continue
        for number in _stray_numbers(unit["text"], ledger):
            item = dict(code="number_not_in_ledger", path=unit.get("path") or unit["id"],
                        message=f"number {number} is not in the truth ledger; add a claim (sourced, derived or illustrative) before saying it")
            if unit.get("line"):
                item["line"] = unit["line"]
            report["errors" if strict else "warnings"].append(item)
    for key in ("errors", "warnings"):
        report[key].sort(key=lambda f: (f.get("line", 0), f["path"], f["code"]))
    report["valid"] = not report["errors"]
    report["status"] = "failed" if report["errors"] else "partial" if report["warnings"] else "passed"
    return report


def _lint_plan(plan, pack, claims, r, base):
    expression = pack.get("expression") if isinstance(pack.get("expression"), dict) else {}
    profile = expression.get("profile")
    if profile not in lint.PROFILES:
        return
    units = []
    for si, scene in enumerate(plan.get("scenes", []) if isinstance(plan.get("scenes"), list) else []):
        if not isinstance(scene, dict):
            continue
        for ni, nar in enumerate(scene.get("narration", []) if isinstance(scene.get("narration"), list) else []):
            if not isinstance(nar, dict):
                continue
            same = _text(nar.get("spoken")) and _text(nar.get("display")) and nar["spoken"].strip() == nar["display"].strip()
            for key, spoken in (("spoken", True), ("display", False)):
                if _text(nar.get(key)) and not (same and key == "display"):
                    units.append(dict(id=f"{si}.{ni}.{key}", path=f"$.scenes[{si}].narration[{ni}].{key}", text=nar[key],
                                      kind="description", spoken=spoken))
        for ei, el in enumerate(scene.get("elements", []) if isinstance(scene.get("elements"), list) else []):
            if isinstance(el, dict) and _text(el.get("content")):
                units.append(dict(id=f"{si}.e{ei}", path=f"$.scenes[{si}].elements[{ei}].content", text=el["content"],
                                  kind="note", spoken=False))
    try:
        report = lint.lint_units(units, profile=profile, **_lint_options(pack))
    except (ValueError, TypeError):
        return
    for item in report["errors"]:
        r.error(item["code"], item["path"], item["message"])
    for item in report["warnings"]:
        r.warning(item["code"], item["path"], item["message"])
    ledger = _ledger_numbers(pack, claims)
    for unit in units:
        for number in _stray_numbers(unit["text"], ledger):
            r.warning("number_not_in_ledger", unit["path"], f"number {number} is not in the truth ledger; add a claim (sourced, derived or illustrative) before showing or saying it")


def validate_knowledge(pack, plan=None, strict=False, standalone=False, today=None, base="$"):
    """Validate one knowledge pack. With a plan, scene/element references and plan text are checked too."""
    r = _Report(strict)
    today = today or datetime.date.today()
    if not isinstance(pack, dict):
        r.error("pack_type", base, "knowledge pack must be an object")
        return r.result(scope="knowledge-pack-contract-only")
    version = pack.get("schema_version")
    if standalone and (type(version) is not int or version != 1):
        r.error("schema_version", base + ".schema_version", "expected integer 1")
    elif "schema_version" in pack and (type(version) is not int or version != 1):
        r.error("schema_version", base + ".schema_version", "expected integer 1")
    _placeholders(pack, r, base, set())
    _need(pack, ["topic", "claim"], r, base)
    if pack.get("relation_type") not in RELATION_TYPES:
        r.error("relation_type", base + ".relation_type", "expected one of " + ", ".join(RELATION_TYPES))
    audience = _object(pack, "audience", r, base)
    if audience is not None:
        if audience.get("level") not in AUDIENCE_LEVELS:
            r.error("audience_level", base + ".audience.level", "expected one of " + ", ".join(AUDIENCE_LEVELS))
        for key in ("known", "unknown"):
            if key in audience:
                _strings(audience[key], r, f"{base}.audience.{key}")
    standards, terms = {}, {}
    domain = _object(pack, "domain", r, base)
    if domain is not None:
        _need(domain, ["field"], r, base + ".domain")
        standards = _standards(domain.get("standards"), r, base + ".domain", today)
        terms = _terms(domain.get("terms"), standards, r, base + ".domain")
        if "notation" in domain:
            notation = domain["notation"]
            if not isinstance(notation, dict) or any(not _text(v) for v in notation.values()):
                r.error("notation", base + ".domain.notation", "expected an object of nonempty strings")
    expression = pack.get("expression")
    _expression(expression, r, base)
    mappings = _carrier(pack.get("carrier"), r, base)
    plan_info = _plan_index(plan) if isinstance(plan, dict) else None
    claims = _truth(pack.get("truth"), standards, plan_info[0] if plan_info else None, r, base,
                    event=pack.get("relation_type") == "event")
    layers = _layers(pack.get("layers"), claims, mappings, plan_info, r, base)
    if plan_info is not None:
        _, scene_elements, _ = plan_info
        known_elements = set().union(*scene_elements.values()) if scene_elements else set()
        for ident, mapping in mappings.items():
            ref = mapping.get("element_id")
            if ref is not None and ref not in known_elements:
                r.error("mapping_element_reference", f"{base}.carrier.mappings", f"mapping {ident} points at unknown element {ref}")
    if "checks" in pack:
        _checks(pack["checks"], r, base)
    if plan_info is not None and isinstance(pack.get("expression"), dict):
        _lint_plan(plan, pack, claims, r, base)
    return r.result(scope="knowledge-pack-contract-only", media_verified=False, summary=dict(
        standards={s: sum(1 for x in standards.values() if x.get("status") == s) for s in STANDARD_STATUS},
        terms=len(terms), mappings=len(mappings), layers=len(layers),
        claims={k: sum(1 for x in claims.values() if x.get("kind") == k) for k in CLAIM_KINDS}))


def load_json(path):
    def reject(value):
        raise ValueError("non-finite JSON constant: " + value)

    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                raise ValueError("duplicate JSON key: " + key)
            result[key] = value
        return result
    return json.loads(Path(path).read_text(encoding="utf-8"), parse_constant=reject, object_pairs_hook=pairs)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("file", help="knowledge pack JSON, or a plan JSON that embeds a knowledge block")
    parser.add_argument("--plan", help="resolve scene/element references and lint plan text against this plan")
    parser.add_argument("--strict", action="store_true", help="treat warnings as errors")
    parser.add_argument("--today", help="YYYY-MM-DD, for reproducible checked_on tests")
    args = parser.parse_args()
    try:
        data = load_json(args.file)
        today = datetime.date.fromisoformat(args.today) if args.today else None
        if isinstance(data, dict) and "knowledge" in data and "scenes" in data:
            result = validate_knowledge(data["knowledge"], plan=data, strict=args.strict, today=today, base="$.knowledge")
        else:
            plan = load_json(args.plan) if args.plan else None
            result = validate_knowledge(data, plan=plan, strict=args.strict, standalone=True, today=today)
    except (OSError, ValueError, TypeError) as exc:
        result = dict(schema_version=1, valid=False, status="failed",
                      errors=[dict(code="read_error", path=args.file, message=str(exc))], warnings=[])
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0 if result["valid"] else 1


if __name__ == "__main__":
    sys.exit(main())
