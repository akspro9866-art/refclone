#!/usr/bin/env python3
"""List, resolve, scaffold and validate data-only style packages; no producers run."""
import argparse
import json
import sys
from pathlib import Path
from _stylepacks import ROOT, ID, load_registry, resolve, fresh_verification, package_digest, style_lock


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["list", "resolve", "init", "validate", "build"])
    parser.add_argument("name", nargs="?")
    parser.add_argument("--style-root", action="append", default=None, help="additional package collection, repeatable")
    parser.add_argument("--into", type=Path, help="collection for init; never overwrites a package")
    parser.add_argument("--extends", dest="base", help="base style ID for init")
    parser.add_argument("--check", action="store_true", help="build: compare generated catalog without writing")
    parser.add_argument("--sources", action="store_true", help="validate: hash imported reference sources")
    args = parser.parse_args()
    try:
        if args.action == "init":
            if not args.name or not ID.fullmatch(args.name) or args.name == "custom" or args.into is None:
                raise ValueError("init requires a stable ID and --into COLLECTION")
            registry, _, _ = load_registry(args.style_root)
            if args.name in registry:
                raise ValueError("style ID already exists: " + args.name)
            item = dict(pack_version=1, id=args.name, name=args.name, intent="为当前受众建立清晰、可修改的视觉表达。", aliases=[], borrows=[], guide="STYLE.md", verification=fresh_verification(), source_refs=[])
            if args.base:
                if args.base not in registry:
                    raise ValueError("unknown base: " + args.base)
                item["extends"] = args.base
            else:
                item.update(tokens={"background":"#F5F7FA", "foreground":"#172033", "accent":"#2463EB", "font_stack":["system-ui", "sans-serif"]}, motion_character={"tempo":"动作后稳定阅读"}, constraints=["按本次画幅检查文字、主体和安全区。"], fallback="取消装饰，保留主体与清晰文字。", avoid=["多个焦点同时抢占注意力"], scenario_ids=[], required_capabilities=["time-control"])
            target = args.into.expanduser().resolve() / args.name
            target.mkdir(parents=True, exist_ok=False)
            (target / "style.json").write_text(json.dumps(item, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
            (target / "STYLE.md").write_text(f"# {args.name}\n\n从本次受众、品牌和素材明确材质、色彩、字体、运动、镜头与声音规则。\n\n先在项目中验证关键画面，再按实际结果登记证据。故事、台词与音乐时间属于具体作品。\n", encoding="utf-8")
            print(json.dumps(dict(status="created", path=str(target), validation="not_run"), ensure_ascii=False))
            return 0
        registry, _, locations = load_registry([] if args.action == "build" else args.style_root)
        if args.action == "resolve":
            if not args.name:
                raise ValueError("resolve requires a name or ID")
            item, location = resolve(args.name, args.style_root)
            result = dict(item=item, package=str(location), guide=str(location/item.get("guide","STYLE.md")), style_lock=style_lock(item['id'],args.style_root), executes_code=False)
        elif args.action == "build":
            if args.style_root:
                raise ValueError("generated bundled catalog must not include project/private roots")
            # A generation must be independent of the current process's extra roots.
            registry, _, _ = load_registry(extra=[])
            data = dict(schema_version=1, items=list(registry.values()))
            content = json.dumps(data, ensure_ascii=False, indent=2)+"\n"
            target = ROOT / "catalog/styles.json"
            matches = target.is_file() and target.read_text(encoding="utf-8") == content
            if args.check and not matches:
                raise ValueError("catalog/styles.json is stale; run stylepacks.py build")
            if not args.check:
                target.write_text(content, encoding="utf-8")
            lines = ['# 视频风格包', '', '由 style.json 自动生成。新增或修改包后运行 `python3 scripts/stylepacks.py build`。', '', '导航色板用于检索；完整材质、运动、镜头与声音规则在各包 STYLE.md。', '']
            groups = {}
            for ident, item in registry.items():
                groups.setdefault(item.get('category','其他'), []).append((ident,item))
            for category, items in groups.items():
                lines.extend(['## '+category, '', '| 风格 | ID | 实现状态 |', '| --- | --- | --- |'])
                lines.extend(f"| [{v['name']}]({k}/STYLE.md) | `{k}` | {v.get('implementation',{}).get('status','guidance')} |" for k,v in items)
                lines.append('')
            index = ROOT/'styles/README.md'
            index_content = '\n'.join(lines).rstrip()+'\n'
            if args.check and (not index.is_file() or index.read_text(encoding='utf-8') != index_content):
                raise ValueError('styles/README.md is stale; run stylepacks.py build')
            if not args.check:
                index.write_text(index_content,encoding='utf-8')
            result = dict(status="passed", styles=len(registry), output=str(target), checked_only=args.check)
        elif args.action == "validate":
            # Reuse the established catalog field/reference validator.
            from _contracts import catalog
            entries = catalog("style", style_roots=args.style_root)
            result = dict(status="passed", styles=len(entries), scope="package-contract-only", executes_code=False)
            if args.sources:
                from _source_integrity import verify_sources
                result['sources'] = verify_sources()
        else:
            result = dict(styles=[dict(id=k, name=v["name"], category=v.get("category",""), package=str(locations[k])) for k,v in registry.items()])
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (ValueError, OSError, TypeError, KeyError) as exc:
        print(json.dumps(dict(status="failed", error=str(exc)), ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
