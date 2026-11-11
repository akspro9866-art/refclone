"""Standard-library contract helpers. Never invokes a producer or renderer."""
import hashlib
import json
import math
import re
from pathlib import Path

CATALOG_DIR = Path(__file__).resolve().parent.parent / "catalog"
KINDS = {"scenario": "scenarios", "style": "styles", "motion": "motions",
         "expression": "expressions", "recipe": "recipes"}
ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$")
CATALOG_ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$")


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
    return json.loads(Path(path).read_text(encoding="utf-8"),
                      parse_constant=reject, object_pairs_hook=pairs)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_path(base, value):
    path = Path(value).expanduser()
    return path if path.is_absolute() else Path(base) / path


def is_number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def catalog(kind, root=None, _check_refs=True, style_roots=None):
    path = Path(root or CATALOG_DIR) / (KINDS[kind] + ".json")
    if kind == "style" and (root is None or Path(root).resolve() == CATALOG_DIR.resolve()) and (CATALOG_DIR.parent / "styles").is_dir():
        from _stylepacks import load_registry
        data = dict(schema_version=1, items=list(load_registry(extra=style_roots)[0].values()))
    else:
        data = load_json(path)
    if (not isinstance(data, dict) or type(data.get("schema_version")) is not int
            or data.get("schema_version") != 1 or not isinstance(data.get("items"), list)):
        raise ValueError(f"invalid catalog envelope: {path}")

    def require(condition, field, message):
        if not condition:
            raise ValueError(f"invalid catalog {path} {field}: {message}")

    def strings(value, field, stable_ids=False):
        require(isinstance(value, list) and all(nonempty(x) for x in value), field,
                "expected an explicit array of nonempty strings")
        require(len(value) == len(set(value)), field, "duplicate values")
        if stable_ids:
            require(all(CATALOG_ID_RE.fullmatch(x) for x in value), field, "expected stable catalog IDs")

    def finite(value, field):
        if isinstance(value, (float, int)) and not isinstance(value, bool):
            require(is_number(value), field, "numbers must be finite")
        elif isinstance(value, dict):
            for key, child in value.items():
                finite(child, field + "." + key)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                finite(child, f"{field}[{index}]")

    def present(value):
        return nonempty(value) or isinstance(value, (dict, list)) and bool(value)

    result = {}
    for index, item in enumerate(data["items"]):
        where = f"items[{index}]"
        id_pattern = CATALOG_ID_RE if kind == "expression" else ID_RE
        if not isinstance(item, dict) or not nonempty(item.get("id")) or not id_pattern.fullmatch(item["id"]):
            raise ValueError(f"invalid catalog item ID: {path}")
        if item["id"] in result:
            raise ValueError(f"duplicate catalog ID: {item['id']}")
        finite(item, where)
        for field in ["name", "intent", "fallback"]:
            require(nonempty(item.get(field)), where + "." + field, "expected nonempty string")
        strings(item.get("constraints"), where + ".constraints")
        verification = item.get("verification")
        require(isinstance(verification, dict), where + ".verification", "expected object")
        for stage in ["design", "preview", "exported"]:
            field = where + ".verification." + stage
            record = verification.get(stage)
            require(isinstance(record, dict), field, "expected explicit record")
            statuses = ["authored", "reviewed"] if stage == "design" else ["not_run", "passed", "partial", "failed"]
            require(record.get("status") in statuses, field + ".status", "invalid verification status")
            evidence = record.get("evidence")
            require(isinstance(evidence, list), field + ".evidence", "expected explicit array")
            require(all(nonempty(e) or isinstance(e, dict) and bool(e) for e in evidence),
                    field + ".evidence", "empty or invalid evidence record")
            if record["status"] == "passed":
                require(bool(evidence), field + ".evidence", "passed requires nonempty evidence")
                # Metadata describes recorded work only. It is never executed or treated as reproduction.
                complete = all(present(record.get(k)) for k in ["environment", "scope", "artifact"])
                complete_entries = all(isinstance(e, dict) and all(present(e.get(k))
                                       for k in ["environment", "scope", "artifact"]) for e in evidence)
                require(complete or complete_entries, field,
                        "passed needs environment, scope and artifact on the stage or each evidence record")
        if kind == "scenario":
            for field in ["required_inputs", "narrative_options", "layouts", "style_ids", "motion_ids"]:
                strings(item.get(field), where + "." + field, field.endswith("_ids"))
        elif kind == "style":
            require(isinstance(item.get("tokens"), dict) and bool(item["tokens"]), where + ".tokens", "expected nonempty object")
            require(isinstance(item.get("motion_character"), dict) and bool(item["motion_character"]),
                    where + ".motion_character", "expected nonempty object")
            strings(item.get("avoid"), where + ".avoid")
        elif kind == "motion":
            strings(item.get("channels"), where + ".channels")
            strings(item.get("required_capabilities"), where + ".required_capabilities")
            require(item["channels"] or item["id"] == "hold" or item.get("non_mutating") is True,
                    where + ".channels", "empty channels require hold or explicit non_mutating=true")
            if "non_mutating" in item:
                require(type(item["non_mutating"]) is bool, where + ".non_mutating", "expected boolean")
            parameters = item.get("parameters")
            require(isinstance(parameters, dict), where + ".parameters", "expected explicit object")
            for name, spec in parameters.items():
                field = where + ".parameters." + name
                require(nonempty(name) and isinstance(spec, dict) and "default" in spec,
                        field, "parameter schema needs a default")
                default = spec["default"]
                type_checks = {"number": is_number, "integer": lambda v: type(v) is int,
                               "string": lambda v: isinstance(v, str), "boolean": lambda v: type(v) is bool,
                               "object": lambda v: isinstance(v, dict), "array": lambda v: isinstance(v, list),
                               "null": lambda v: v is None}
                if "type" in spec:
                    typ = spec["type"]
                    require(isinstance(typ, str) and typ in type_checks, field + ".type", "unknown parameter type")
                    require(type_checks[typ](default), field + ".default", "default does not match declared type")
                for bound in ["min", "max"]:
                    if bound in spec:
                        require(is_number(spec[bound]) and is_number(default), field + "." + bound,
                                "numeric bounds require a finite numeric default and bound")
                if "min" in spec and "max" in spec:
                    require(spec["min"] <= spec["max"], field, "min exceeds max")
                if "min" in spec:
                    require(default >= spec["min"], field + ".default", "default below minimum")
                if "max" in spec:
                    require(default <= spec["max"], field + ".default", "default above maximum")
                if "values" in spec:
                    require(isinstance(spec["values"], list) and bool(spec["values"]), field + ".values", "expected nonempty choices")
                    require(default in spec["values"], field + ".default", "default outside allowed choices")
                if "unit" in spec:
                    require(nonempty(spec["unit"]), field + ".unit", "expected nonempty unit")
        elif kind == "expression":
            for field in ["inputs", "composition", "verification_questions", "source_refs",
                          "existing_motion_ids", "required_capabilities"]:
                strings(item.get(field), where + "." + field, field.endswith("_ids"))
            for field in ["layer", "tier"]:
                require(nonempty(item.get(field)), where + "." + field, "expected nonempty string")
            require(item.get("status") == "guidance", where + ".status", "expected guidance; not an executable implementation")
            parameters = item.get("parameters")
            require(isinstance(parameters, dict), where + ".parameters", "expected design controls object")
            for name, spec in parameters.items():
                require(nonempty(name) and isinstance(spec, dict) and spec.get("type") == "design-control"
                        and nonempty(spec.get("description")), where + ".parameters." + name,
                        "expected design-control with a description, not executable numeric bounds")
        elif kind == "recipe":
            for field in ["scenario_ids", "style_ids", "motion_ids", "expression_ids"]:
                strings(item.get(field), where + "." + field, True)
            if "music_policy" in item:
                from _recipe_music import validate_policy
                errors = validate_policy(item["music_policy"])
                require(not errors, where + ".music_policy", "; ".join(errors))
            steps = item.get("story_steps")
            require(isinstance(steps, list) and bool(steps), where + ".story_steps", "expected nonempty steps")
            step_ids = set()
            for j, step in enumerate(steps):
                field = f"{where}.story_steps[{j}]"
                require(isinstance(step, dict), field, "expected object")
                for key in ["id", "shot_purpose", "visual_action", "sound_role"]:
                    require(nonempty(step.get(key)), field + "." + key, "expected nonempty string")
                require(ID_RE.fullmatch(step["id"]) and step["id"] not in step_ids,
                        field + ".id", "expected unique stable step ID")
                step_ids.add(step["id"])
                strings(step.get("checks"), field + ".checks")
        if kind in ["expression", "recipe"]:
            require(nonempty(item.get("source_relation")), where + ".source_relation",
                    "expected an explicit nonempty source relationship")
            require(item.get("status") == "guidance", where + ".status",
                    "expected guidance; not an executable implementation")
            for field in ["source_refs", "verification_questions"]:
                strings(item.get(field), where + "." + field)
        # Optional reference arrays remain optional for old schema-1 catalogs.
        for field in ["scenario_ids", "style_ids", "motion_ids", "existing_motion_ids", "expression_ids", "recipe_ids"]:
            if field in item:
                strings(item[field], where + "." + field, True)
        result[item["id"]] = item
    if _check_refs:
        # Optional music policy is recipe-owned; legacy recipes need no music catalog.
        music_owners = [item for item in result.values() if kind == "recipe" and "music_policy" in item]
        if music_owners:
            from _recipe_music import validate_policy
            music_data = load_json(Path(root or CATALOG_DIR) / "music.json")
            music_ids = {row["id"] for row in music_data["items"]}
            for item in music_owners:
                errors = validate_policy(item["music_policy"], music_ids)
                require(not errors, item["id"] + ".music_policy", "; ".join(errors))
        reference_kinds = {"scenario_ids": "scenario", "style_ids": "style", "motion_ids": "motion",
                           "existing_motion_ids": "motion", "expression_ids": "expression", "recipe_ids": "recipe"}
        cache = {kind: result}
        for item in result.values():
            for field, target_kind in reference_kinds.items():
                if not item.get(field):
                    continue
                if target_kind not in cache:
                    cache[target_kind] = catalog(target_kind, root, _check_refs=False, style_roots=style_roots)
                for ident in item[field]:
                    require(ident in cache[target_kind], item["id"] + "." + field,
                            "unresolved " + target_kind + " ID: " + ident)
    return result


class Report:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, code, path, message):
        self.errors.append(dict(code=code, path=path, message=message))

    def warning(self, code, path, message, strict=False):
        (self.error if strict else self._warning)(code, path, message)

    def _warning(self, code, path, message):
        self.warnings.append(dict(code=code, path=path, message=message))

    def result(self, **extra):
        return dict(schema_version=1, valid=not self.errors,
                    status="failed" if self.errors else "partial" if self.warnings else "passed",
                    errors=self.errors, warnings=self.warnings, **extra)


def finite_tree(value, report, path="$ "):
    if isinstance(value, float) and not math.isfinite(value):
        report.error("non_finite", path, "all numbers must be finite")
    elif isinstance(value, dict):
        for key, item in value.items():
            finite_tree(item, report, path + "." + key)
    elif isinstance(value, list):
        for i, item in enumerate(value):
            finite_tree(item, report, f"{path}[{i}]")


def required_text(obj, keys, report, path):
    for key in keys:
        if not nonempty(obj.get(key)):
            report.error("required_string", path + "." + key, "expected a nonempty string")


def object_field(obj, key, report, path):
    value = obj.get(key)
    if not isinstance(value, dict):
        report.error("object_type", path + "." + key, "expected an object")
        return {}
    return value


def list_field(obj, key, report, path, required=False):
    value = obj.get(key, None if required else [])
    if not isinstance(value, list):
        report.error("array_type", path + "." + key, "expected an array")
        return []
    return value


def string_list(value, report, path):
    if not isinstance(value, list) or any(not nonempty(x) for x in value):
        report.error("string_array", path, "expected an array of nonempty strings")
        return []
    return value
