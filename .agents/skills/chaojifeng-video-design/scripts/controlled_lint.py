#!/usr/bin/env python3
"""Offline controlled-expression lint for explainer text (Chinese first).

Profiles are Skill-defined adaptations inspired by ASD-STE100 writing rules. They are NOT the
official ASD-STE100 standard and the numeric limits are NOT ASD numbers. A passing lint does
not prove clarity, accuracy or audience understanding; it only catches mechanical problems.
Standard library only; never reads credentials or the network.

This file is shared byte-for-byte by chaojifeng-video-design and ai-avatar-narration
(each Skill must stay installable alone). Change both copies together; both test suites fail
when the copies drift apart.
"""
import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

PROFILE_ORIGIN = "Skill-defined adaptation inspired by ASD-STE100 writing rules; not the official standard"
KINDS = ("description", "procedure", "warning", "note")
SEVERITIES = ("error", "warning", "note", "off")

# Length is counted in characters after removing punctuation, symbols, spaces and controls.
# Chinese has no word spaces, so ASD's 20/25-word caps do not transfer directly. These caps follow
# listenability: roughly 4-5 characters per second means a hard cap of 30 is a sentence that
# takes about 6-7 seconds to say. Projects may override them in knowledge.expression.limits.
BASE_LIMITS = {
    "description_target": 22, "description_hard": 30,
    "procedure_target": 18, "procedure_hard": 24,
    "warning_target": 18, "warning_hard": 24,
    "note_target": 22, "note_hard": 30,
    "max_sentences": 6,
}

DEFAULT_SEVERITY = {
    "sentence_over_target": "note",
    "sentence_too_long": "warning",
    "too_many_sentences": "warning",
    "semicolon": "warning",
    "vague_word": "warning",
    "passive_marker": "warning",
    "unclear_reference": "note",
    "colloquial": "off",
    "multiple_instructions": "warning",
    "forbidden_alias": "error",
    "undefined_on_first_use": "warning",
    "missing_pronunciation": "off",
    "symbol_in_speech": "off",
    "placeholder_text": "error",
}

PROFILES = {
    "ste-zh-v1": {
        "label": "技术文字、字幕、铭牌与图注",
        "spoken": False,
        "severity": {"colloquial": "warning"},
    },
    "ste-zh-spoken": {
        "label": "口播与旁白：允许亲切口语，但术语、句长和读音仍受控",
        "spoken": True,
        "severity": {"passive_marker": "note", "missing_pronunciation": "warning", "symbol_in_speech": "note"},
    },
}

VAGUE_WORDS = ("大概", "大约", "也许", "或许", "差不多", "等等", "之类", "什么的", "若干", "诸多",
               "相当", "基本上", "在一定程度上")
COLLOQUIAL_WORDS = ("啥", "咋", "玩意", "搞定", "搞一个", "贼", "咱们", "咱", "呗", "嘛", "哈哈", "超级", "巨好")
UNCLEAR_STARTS = ("它们", "它", "其", "该", "此", "这些", "那些", "他们", "她们")
CONNECTORS = ("然后", "接着", "随后", "并且", "之后", "，再", "，并", "，同时", ",再", ",并")
DEFINE_CUES = ("是指", "指的是", "就是", "叫做", "叫作", "称为", "称作", "即", "意思是", "代表", "表示",
               "用来", "用于", "负责", "是一个", "是一种", "是一份", "是由")
DEFINE_POINTERS = ("它", "其", "该", "此", "这")
SPEECH_SYMBOLS = "=+%/\\<>→←↔#@~^*_|"
PLACEHOLDER_RE = re.compile(r"TODO|待填写|待补充|\bTBD\b")
VAGUE_RE = re.compile("|".join("相当(?!于)" if w == "相当" else re.escape(w) for w in VAGUE_WORDS))
PASSIVE_RE = re.compile(r"被(?![告子动迫])")
TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9\-]*")
QUOTE_RE = re.compile(r"「[^」]*」|『[^』]*』|“[^”]*”|\"[^\"]*\"")


def length_units(sentence):
    """Characters left after dropping punctuation, symbols, separators and controls."""
    return sum(1 for ch in sentence if unicodedata.category(ch)[0] not in "PZSC")


def strip_markup(text):
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("**", "").replace("`", "")
    return text


def split_sentences(text):
    parts, buf = [], []
    for ch in text.replace("\r", ""):
        if ch == "\n":
            part = "".join(buf).strip()
            if part:
                parts.append(part)
            buf = []
            continue
        buf.append(ch)
        if ch in "。！？!?；;":
            part = "".join(buf).strip()
            if part:
                parts.append(part)
            buf = []
    part = "".join(buf).strip()
    if part:
        parts.append(part)
    return [p for p in parts if length_units(p) > 0]


def mask_quotes(text):
    return QUOTE_RE.sub("□", text)


def _positive_int(value):
    return type(value) is int and value > 0


def merge_limits(overrides):
    limits = dict(BASE_LIMITS)
    if overrides is None:
        return limits
    if not isinstance(overrides, dict):
        raise ValueError("limits must be an object")
    for key, value in overrides.items():
        if key not in BASE_LIMITS:
            raise ValueError("unknown limit: " + str(key))
        if not _positive_int(value):
            raise ValueError("limit must be a positive integer: " + str(key))
        limits[key] = value
    for kind in KINDS:
        if limits[kind + "_target"] > limits[kind + "_hard"]:
            raise ValueError(f"{kind}_target exceeds {kind}_hard")
    return limits


def build_lexicon(pronunciations, terms):
    """Token -> spoken form. Explicit pronunciations win over term cards."""
    lexicon = {}
    for term in terms or []:
        spoken = term.get("spoken_as")
        if isinstance(spoken, str) and spoken.strip():
            for name in (term.get("abbr"), term.get("preferred")):
                if isinstance(name, str) and name.strip():
                    lexicon[name] = spoken
    if isinstance(pronunciations, dict):
        for key, value in pronunciations.items():
            if isinstance(key, str) and isinstance(value, str) and key.strip() and value.strip():
                lexicon[key] = value
    return lexicon


def to_speech(text, lexicon):
    """Replace Latin tokens with their spoken form. Pure function; never guesses missing readings."""
    if not lexicon:
        return text
    keys = sorted(lexicon, key=len, reverse=True)
    folded = {k.lower(): lexicon[k] for k in keys}
    pattern = re.compile(r"(?<![A-Za-z0-9])(?:" + "|".join(re.escape(k) for k in keys) + r")(?![A-Za-z0-9])", re.I)
    return pattern.sub(lambda m: folded[m.group(0).lower()], text)


def _directive(body):
    return {key: value for key, value in re.findall(r"(\w+)=([^\s;]+)", body)}


def parse_script(text):
    """Spoken paragraphs of a Markdown-ish script.

    Skipped: headings, blockquotes, tables, rules, fenced code. A standalone HTML comment such as
    <!-- kind=procedure layer=L2 id=seg-03 defines=term-a,term-b lint=off speak=off -->
    applies to the next paragraph only. List items become one unit each.
    """
    units, para, directive = [], [], {}
    state = {"fence": False, "count": 0, "start": 0}

    def flush():
        nonlocal para, directive
        if not para:
            return
        body = "\n".join(para).strip()
        para = []
        if not body:
            return
        state["count"] += 1
        units.append(dict(
            id=directive.get("id") or f"p{state['count']}", text=body,
            kind=directive.get("kind", "description"), layer=directive.get("layer"),
            defines=[x for x in directive.get("defines", "").split(",") if x],
            lint=directive.get("lint", "on") != "off", speak=directive.get("speak", "on") != "off",
            line=state["start"]))
        directive = {}

    for number, raw in enumerate(text.splitlines(), 1):
        stripped = raw.strip()
        if stripped.startswith("```"):
            flush()
            state["fence"] = not state["fence"]
            continue
        if state["fence"]:
            continue
        comment = re.fullmatch(r"<!--(.*?)-->", stripped)
        if comment:
            flush()
            directive = {**directive, **_directive(comment.group(1))}
            continue
        if not stripped:
            flush()
            continue
        if stripped.startswith(("#", ">", "|")) or re.fullmatch(r"[-*_=]{3,}", stripped):
            flush()
            continue
        item = re.match(r"(?:[-*+]|\d+[.)、])\s+(.*)", stripped)
        if item:
            flush()
            state["start"] = number
            para = [item.group(1)]
            flush()
            continue
        if not para:
            state["start"] = number
        para.append(stripped)
    flush()
    return units


def _severity(profile, code):
    return {**DEFAULT_SEVERITY, **PROFILES[profile]["severity"]}[code]


def lint_units(units, profile="ste-zh-v1", terms=None, pronunciations=None, allow=None, limits=None,
               audience_level="novice", strict=False, vague_extra=None):
    """Lint ordered text units: dict(id, text, kind, [spoken, layer, defines, lint, path, line])."""
    if profile not in PROFILES:
        raise ValueError("unknown profile: " + str(profile))
    limits = merge_limits(limits)
    terms = [t for t in (terms or []) if isinstance(t, dict) and isinstance(t.get("preferred"), str)]
    allowed = {str(w) for w in (allow or [])}
    lexicon = build_lexicon(pronunciations, terms)
    known_tokens = {k.lower() for k in lexicon} | {a.lower() for a in allowed}
    vague = VAGUE_RE
    if vague_extra:
        vague = re.compile(VAGUE_RE.pattern + "|" + "|".join(re.escape(w) for w in vague_extra))
    findings = []
    stats = dict(units=0, sentences=0, max_length=0, over_target=0, over_hard=0, layers={})
    ordered = []

    def add(code, unit, message, sentence=None):
        level = _severity(profile, code)
        if level == "off":
            return
        item = dict(code=code, path=unit.get("path") or unit["id"], message=message, level=level)
        if unit.get("line"):
            item["line"] = unit["line"]
        if sentence:
            item["excerpt"] = sentence[:30]
        findings.append(item)

    for unit in units:
        if unit.get("lint") is False or unit.get("speak") is False and PROFILES[profile]["spoken"]:
            continue
        raw = unit.get("text")
        if not isinstance(raw, str) or not raw.strip():
            continue
        kind = unit.get("kind", "description")
        if kind not in KINDS:
            raise ValueError("unknown text kind: " + str(kind))
        spoken = PROFILES[profile]["spoken"] if unit.get("spoken") is None else bool(unit["spoken"])
        text = strip_markup(raw)
        sentences = split_sentences(text)
        ordered.append((unit, sentences))
        stats["units"] += 1
        stats["sentences"] += len(sentences)
        layer = unit.get("layer")
        if layer:
            row = stats["layers"].setdefault(layer, dict(units=0, sentences=0, chars=0))
            row["units"] += 1
            row["sentences"] += len(sentences)
            row["chars"] += sum(length_units(s) for s in sentences)
        if PLACEHOLDER_RE.search(text):
            add("placeholder_text", unit, "仍含占位文字（TODO/待填写/待补充/TBD）；写完再检查")
        target, hard = limits[kind + "_target"], limits[kind + "_hard"]
        for sentence in sentences:
            size = length_units(sentence)
            stats["max_length"] = max(stats["max_length"], size)
            if size > hard:
                stats["over_hard"] += 1
                add("sentence_too_long", unit, f"{size} 字，超过硬上限 {hard}；拆成两句，每句一个意思", sentence)
            elif size > target:
                stats["over_target"] += 1
                add("sentence_over_target", unit, f"{size} 字，超过目标 {target}（硬上限 {hard}）", sentence)
        if len(sentences) > limits["max_sentences"]:
            add("too_many_sentences", unit, f"{len(sentences)} 句，超过每段 {limits['max_sentences']} 句；按主题拆段")
        masked = mask_quotes(text)
        if re.search(r"[；;]", masked):
            add("semicolon", unit, "避免分号；拆成独立句子")
        for word in sorted({m.group(0) for m in vague.finditer(masked)} - allowed):
            add("vague_word", unit, f"“{word}”含糊；改成数值、条件或删去")
        if PASSIVE_RE.search(masked):
            add("passive_marker", unit, "含“被”字句；尽量改主动句并写出施动者")
        for sentence in sentences:
            head = mask_quotes(sentence).lstrip("，,、 ")
            if head.startswith(UNCLEAR_STARTS):
                add("unclear_reference", unit, "句首代词需指向上一句明确的名词；必要时改写成术语", sentence)
        for word in sorted({w for w in COLLOQUIAL_WORDS if w in masked} - allowed):
            add("colloquial", unit, f"口语词“{word}”；技术文字与字幕改用规范词")
        if kind in ("procedure", "warning") and any(c in masked for c in CONNECTORS):
            add("multiple_instructions", unit, "一句含多个动作；拆成一句一个指令")
        if spoken:
            tokens = {t for t in TOKEN_RE.findall(masked) if len(t) >= 2}
            for token in sorted(tokens, key=str.lower):
                parts = [p for p in token.lower().split("-") if p]
                if token.lower() not in known_tokens and not (len(parts) > 1 and all(p in known_tokens for p in parts)):
                    add("missing_pronunciation", unit, f"口播含“{token}”但没有读音；补进 expression.pronunciations 或术语卡 spoken_as")
            if any(c in masked for c in SPEECH_SYMBOLS):
                add("symbol_in_speech", unit, "口播含符号（= + % / → 等）；写成实际要说的话")
        low = masked.lower()
        for term in terms:
            for name in sorted({n for n in (term.get("preferred"), term.get("abbr")) if isinstance(n, str) and n}, key=len, reverse=True):
                low = low.replace(name.lower(), "\x00" * len(name))
        for term in terms:
            for alias in term.get("aliases_forbidden") or []:
                if isinstance(alias, str) and alias.strip() and alias.lower() in low:
                    add("forbidden_alias", unit, f"出现禁用别名“{alias}”；本片统一写“{term['preferred']}”")

    for term in terms:
        if term.get("define_on_first_use") is False or term.get("known_to_audience") is True:
            continue
        if audience_level == "expert" and term.get("define_on_first_use") is not True:
            continue
        names = [n for n in (term.get("preferred"), term.get("abbr")) if isinstance(n, str) and n]
        done = False
        for unit, sentences in ordered:
            for index, sentence in enumerate(sentences):
                folded = mask_quotes(sentence).lower()
                if not any(n.lower() in folded for n in names):
                    continue
                following = sentences[index + 1] if index + 1 < len(sentences) else ""
                declared = term.get("id") in unit.get("defines", [])
                cue = any(c in sentence for c in DEFINE_CUES)
                if not cue and following:
                    # The definition may follow, but only in a sentence that opens with the term or a pointer to it.
                    head = mask_quotes(following).lstrip("，,、 ").lower()
                    cue = (head.startswith(tuple(n.lower() for n in names)) or head.startswith(DEFINE_POINTERS)) \
                        and any(c in following for c in DEFINE_CUES)
                bracket = any(re.search(re.escape(n) + r"[（(]", sentence) for n in names)
                if not (declared or cue or bracket):
                    add("undefined_on_first_use", unit,
                        f"术语“{term['preferred']}”首次出现时没有定义；先用一句话说明它是什么", sentence)
                done = True
                break
            if done:
                break

    order = {"error": 0, "warning": 1, "note": 2}
    findings.sort(key=lambda f: (order[f["level"]], f.get("line", 0), f["path"], f["code"]))
    errors = [f for f in findings if f["level"] == "error"]
    warnings = [f for f in findings if f["level"] == "warning"]
    notes = [f for f in findings if f["level"] == "note"]
    if strict:
        errors, warnings = errors + warnings, []
    for bucket in (errors, warnings, notes):
        for f in bucket:
            f.pop("level", None)
    return dict(schema_version=1, scope="controlled-expression-lint-only", profile=profile,
                profile_origin=PROFILE_ORIGIN, valid=not errors,
                status="failed" if errors else "partial" if warnings else "passed",
                errors=errors, warnings=warnings, notes=notes, stats=stats, limits=limits)


def lint_text(text, kind="description", **options):
    return lint_units([dict(id="text", text=text, kind=kind)], **options)


def emit_speech(units, lexicon):
    """One paragraph per spoken unit with pronunciations applied. Does not decide what is read correctly."""
    lines = []
    for unit in units:
        if unit.get("speak") is False:
            continue
        text = ""
        for sentence in split_sentences(strip_markup(unit["text"])):
            text += sentence if not text or text[-1] in "。！？；…" else " " + sentence
        if text:
            lines.append(to_speech(text, lexicon))
    return "\n\n".join(lines) + ("\n" if lines else "")


def glossary_options(data):
    """Pull lint options out of a knowledge pack or a plan that embeds one."""
    root = data.get("knowledge", data) if isinstance(data, dict) else {}
    expression = root.get("expression", {}) if isinstance(root, dict) else {}
    domain = root.get("domain", {}) if isinstance(root, dict) else {}
    audience = root.get("audience", {}) if isinstance(root, dict) else {}
    profile = expression.get("profile") if isinstance(expression, dict) else None
    return dict(
        profile=profile if profile in PROFILES else None,
        terms=domain.get("terms", []) if isinstance(domain, dict) else [],
        pronunciations=expression.get("pronunciations") if isinstance(expression, dict) else None,
        allow=expression.get("allow", []) if isinstance(expression, dict) else [],
        limits=expression.get("limits") if isinstance(expression, dict) else None,
        vague_extra=expression.get("vague_extra") if isinstance(expression, dict) else None,
        audience_level=audience.get("level", "novice") if isinstance(audience, dict) else "novice")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--text")
    source.add_argument("--text-file")
    parser.add_argument("--profile", choices=sorted(PROFILES))
    parser.add_argument("--kind", choices=KINDS, default="description")
    parser.add_argument("--glossary", help="knowledge pack JSON, or a plan JSON that embeds knowledge")
    parser.add_argument("--strict", action="store_true", help="treat warnings as errors")
    parser.add_argument("--emit-speech", help="write pronunciation-applied spoken text to this file (never overwrites)")
    args = parser.parse_args()
    options = glossary_options(json.loads(Path(args.glossary).read_text(encoding="utf-8"))) if args.glossary else {}
    profile = args.profile or options.pop("profile", None) or "ste-zh-v1"
    options.pop("profile", None)
    if args.text is not None:
        units = [dict(id="text", text=args.text, kind=args.kind)]
    else:
        units = parse_script(Path(args.text_file).read_text(encoding="utf-8"))
        for unit in units:
            if unit["kind"] == "description":
                unit["kind"] = args.kind
    try:
        result = lint_units(units, profile=profile, strict=args.strict, **options)
    except ValueError as exc:
        result = dict(schema_version=1, valid=False, status="failed", errors=[dict(code="bad_options", path="$", message=str(exc))],
                      warnings=[], notes=[])
    if args.emit_speech and result["valid"]:
        out = Path(args.emit_speech)
        if out.exists():
            result["valid"] = False
            result["status"] = "failed"
            result["errors"].append(dict(code="output_exists", path=str(out), message="refusing to overwrite an existing speech file"))
        else:
            out.write_text(emit_speech(units, build_lexicon(options.get("pronunciations"), options.get("terms"))), encoding="utf-8")
            result["speech_file"] = str(out)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0 if result["valid"] else 1


if __name__ == "__main__":
    sys.exit(main())
