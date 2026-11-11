"""Data-only style packages. Loading never imports or executes package code."""
import copy
import hashlib
import json
import math
import os
import re
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
ID = re.compile(r"^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$")
SECTIONS = ("essence", "material", "colour", "type", "motion", "camera", "sound", "native_moves", "pitfalls")


def read_json(path):
    def pairs(items):
        out = {}
        for key, value in items:
            if key in out:
                raise ValueError(f"duplicate JSON key {key}: {path}")
            out[key] = value
        return out
    def reject(value):
        raise ValueError(f"non-finite JSON {value}: {path}")
    def number(value):
        result=float(value)
        if not math.isfinite(result):
            reject(value)
        return result
    return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=pairs, parse_constant=reject, parse_float=number)


def inside(folder, relative):
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        raise ValueError(f"expected a relative package file: {relative!r}")
    target = (folder / relative).resolve()
    if not target.is_relative_to(folder.resolve()) or not target.is_file():
        raise ValueError(f"missing or escaping package file: {folder}/{relative}")
    return target


def merge(base, change):
    """Only dictionaries merge. Arrays replace, so an override remains explicit."""
    out = copy.deepcopy(base)
    for key, value in change.items():
        out[key] = merge(out[key], value) if isinstance(value, dict) and isinstance(out.get(key), dict) else copy.deepcopy(value)
    return out


def roots(extra=None, bundled=None):
    paths = [Path(bundled or ROOT / "styles")]
    paths.extend(Path(p).expanduser() for p in (extra if extra is not None else filter(None, os.environ.get("CJF_VIDEO_STYLE_PATH", "").split(os.pathsep))))
    out = []
    for path in paths:
        path = path.resolve()
        if path not in out:
            if not path.is_dir():
                raise ValueError(f"style root does not exist: {path}")
            out.append(path)
    return out


def load_registry(extra=None, bundled=None):
    raw, locations = {}, {}
    for root in roots(extra, bundled):
        for path in sorted(root.glob("*/style.json")):
            if path.is_symlink() or path.parent.is_symlink():
                raise ValueError(f"symlink package is not supported; pass its real collection explicitly: {path}")
            item = read_json(path)
            if not isinstance(item, dict) or type(item.get("pack_version")) is not int or item["pack_version"] != 1:
                raise ValueError(f"unsupported style package: {path}")
            ident = item.get("id")
            if not isinstance(ident, str) or not ID.fullmatch(ident) or ident == "custom" or path.parent.name != ident:
                raise ValueError(f"package folder must equal a stable non-reserved ID: {path}")
            if ident in raw:
                raise ValueError(f"duplicate style ID {ident}: {locations[ident]} and {path.parent}")
            inside(path.parent, item.get("guide", "STYLE.md"))
            for key in ("aliases", "borrows", "required_capabilities", "scenario_ids"):
                values = item.get(key, [])
                if not isinstance(values, list) or any(not isinstance(v, str) or not v.strip() for v in values) or len(values) != len(set(values)):
                    raise ValueError(f"{ident}.{key}: expected unique nonempty strings")
            if "extends" in item and (not isinstance(item["extends"], str) or not ID.fullmatch(item["extends"])):
                raise ValueError(f"{ident}.extends: expected a stable ID")
            implementation = item.get("implementation", {})
            if not isinstance(implementation, dict):
                raise ValueError(f"{ident}.implementation: expected an object")
            entrypoints = implementation.get("entrypoints", [])
            references = item.get("reference_files", [])
            if not isinstance(entrypoints, list) or not isinstance(references, list):
                raise ValueError(f"{ident}: file declarations must be arrays")
            for relative in entrypoints:
                inside(path.parent, relative)
            for relative in references:
                inside(path.parent, relative)
            if 'gallery' in item:
                gallery=item['gallery']
                if not isinstance(gallery,dict):
                    raise ValueError(f'{ident}.gallery: expected an object')
                if gallery.get('poster'):
                    poster=inside(path.parent,gallery['poster'])
                    if poster.suffix.lower() not in {'.jpg','.jpeg','.png','.webp','.gif'}:
                        raise ValueError(f'{ident}.gallery.poster: unsupported image format')
                if gallery.get('video'):
                    video=gallery['video']
                    parsed=urlparse(video) if isinstance(video,str) else None
                    if parsed is None:
                        raise ValueError(f'{ident}.gallery.video: expected string')
                    if parsed.scheme:
                        if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password:
                            raise ValueError(f'{ident}.gallery.video: expected HTTPS without userinfo')
                    else:
                        local_video=inside(path.parent,video)
                        if local_video.suffix.lower() not in {'.mp4','.webm','.mov'}:
                            raise ValueError(f'{ident}.gallery.video: unsupported video format')
                for key in ['poster_sha256','video_sha256']:
                    if key in gallery and (not isinstance(gallery[key],str) or not re.fullmatch(r'[0-9a-f]{64}',gallery[key])):
                        raise ValueError(f'{ident}.gallery.{key}: expected SHA-256 hex digest')
                if 'attribution' in gallery:
                    credit=gallery['attribution']
                    if not isinstance(credit,dict) or not isinstance(credit.get('name'),str) or not credit['name'].strip() or not isinstance(credit.get('url'),str):
                        raise ValueError(f'{ident}.gallery.attribution: expected name and HTTPS url')
                    parsed=urlparse(credit['url'])
                    if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password:
                        raise ValueError(f'{ident}.gallery.attribution.url: expected HTTPS without userinfo')
                if gallery.get('source_url'):
                    parsed=urlparse(gallery['source_url'])
                    if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password:
                        raise ValueError(f'{ident}.gallery.source_url: expected an HTTPS source page')
            raw[ident], locations[ident] = item, path.parent
    resolved, visiting = {}, []

    def visit(ident):
        if ident in visiting:
            raise ValueError("style dependency cycle: " + " -> ".join([*visiting, ident]))
        if ident not in raw:
            raise ValueError(f"unknown style dependency: {ident}")
        if ident in resolved:
            return resolved[ident]
        visiting.append(ident)
        item = raw[ident]
        parent = item.get("extends")
        base = visit(parent) if parent else {}
        for borrowed in item.get("borrows", []):
            visit(borrowed)
        # Inherit appearance and constraints, never identity, source paths or evidence.
        inherited = {k: base[k] for k in ("tokens", "motion_character", "constraints", "fallback", "avoid", "scenario_ids", "required_capabilities") if k in base}
        result = merge(inherited, item)
        for key in ("name", "intent", "fallback"):
            if not isinstance(result.get(key), str) or not result[key].strip():
                raise ValueError(f"{ident}.{key}: expected a nonempty string")
        for key in ("tokens", "motion_character"):
            if not isinstance(result.get(key), dict) or not result[key]:
                raise ValueError(f"{ident}.{key}: expected a nonempty object")
        for key in ("constraints", "avoid"):
            if not isinstance(result.get(key), list) or any(not isinstance(v, str) or not v.strip() for v in result[key]):
                raise ValueError(f"{ident}.{key}: expected an array of strings")
        verify = result.get("verification")
        if not isinstance(verify, dict):
            raise ValueError(f"{ident}: explicit verification is required; evidence is never inherited")
        for stage, statuses in (("design", ["authored", "reviewed"]), ("preview", ["not_run", "partial", "passed", "failed"]), ("exported", ["not_run", "partial", "passed", "failed"])):
            v = verify.get(stage)
            if not isinstance(v, dict) or v.get("status") not in statuses or not isinstance(v.get("evidence"), list):
                raise ValueError(f"{ident}.{stage}: invalid verification record")
            if v["status"] == "passed" and (not v["evidence"] or not all(v.get(k) for k in ("environment", "scope", "artifact"))):
                raise ValueError(f"{ident}.{stage}: passed needs evidence, environment, scope and artifact")
        resolved[ident] = result
        visiting.pop()
        return result

    for ident in raw:
        visit(ident)
    aliases = {}
    for ident, item in resolved.items():
        # Aliases are package-owned; a derived style cannot steal its parent's names.
        for name in [ident, item["name"], *item.get("aliases", [])]:
            key = name.strip().casefold()
            if key in aliases and aliases[key] != ident:
                raise ValueError(f"ambiguous style name {name!r}: {aliases[key]} and {ident}")
            aliases[key] = ident
    return resolved, aliases, locations


def resolve(name, extra=None, bundled=None):
    registry, aliases, locations = load_registry(extra, bundled)
    key = name.strip().casefold()
    if key not in aliases:
        raise ValueError(f"unknown style: {name}")
    ident = aliases[key]
    return registry[ident], locations[ident]


def fresh_verification():
    return {stage: {"status": "authored" if stage == "design" else "not_run", "evidence": []} for stage in ("design", "preview", "exported")}


def package_digest(folder):
    """Hash all package files, including reference code, without following links."""
    if not folder.is_dir():
        raise ValueError(f'missing package or shared source folder: {folder}')
    h = hashlib.sha256()
    for f in sorted(folder.rglob('*')):
        if f.is_file() and '__pycache__' not in f.parts:
            if f.is_symlink():
                raise ValueError(f"symlink package file: {f}")
            h.update(str(f.relative_to(folder)).encode('utf-8')+b'\0')
            h.update(hashlib.sha256(f.read_bytes()).digest())
    return h.hexdigest()


def style_lock(ident, extra=None, bundled=None):
    registry, _, locations = load_registry(extra, bundled)
    selected = set()
    def add(key):
        if key in selected:
            return
        selected.add(key)
        item=registry[key]
        if item.get('extends'):
            add(item['extends'])
        for key in item.get('borrows',[]):
            add(key)
    if ident not in registry:
        raise ValueError(f'unknown style ID: {ident}')
    add(ident)
    result={'packages':{key:package_digest(locations[key]) for key in sorted(selected)}}
    if any(registry[key].get('origin',{}).get('repository')=='lemomo-ai/lemo-opuscar' for key in selected):
        result['shared_runtime_sha256']=package_digest(ROOT/'vendor/lemo-opuscar')
    return result
