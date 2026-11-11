#!/usr/bin/env python3
"""Import an inspected local Opuscar checkout at a pinned revision; never run its code.

Text sources only. Fonts, samples, models, footage, data sets and generated media
are not copied. Existing packages require --replace, so a refresh is explicit.
"""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path
from _stylepacks import ROOT, fresh_verification

REVISION = "413a6bd6d78ebd3bdd5abaec9538a26867f890df"
URL = "https://github.com/lemomo-ai/lemo-opuscar"
CATEGORY = {
    "剪辑与纪实": (["news-brief","story-video","image-story"], "cinematic-photo", "media-composite"),
    "实证影像": (["knowledge-explainer","news-brief","product-demo"], "mono-diagram", "graphics-3d"),
    "手绘与绘画": (["story-video","knowledge-explainer","brand-film","music-visual"], "paper-editorial", "graphics-2d"),
    "东方传统": (["story-video","brand-film","music-visual"], "paper-editorial", "graphics-2d"),
    "印刷与版画": (["news-brief","story-video","brand-film"], "paper-editorial", "graphics-2d"),
    "图形与排版": (["knowledge-explainer","feature-motion","brand-film","music-visual"], "mono-diagram", "graphics-2d"),
    "信息与发布": (["product-demo","knowledge-explainer","news-brief","feature-motion"], "dark-tech", "graphics-2d"),
    "卡通与动画": (["story-video","knowledge-explainer","music-visual"], "vivid-collage", "graphics-2d"),
    "游戏": (["story-video","knowledge-explainer","music-visual"], "vivid-collage", "graphics-2d"),
    "电影与时代": (["story-video","brand-film","music-visual"], "cinematic-photo", "graphics-2d"),
    "材质与 3D": (["product-demo","brand-film","music-visual","feature-motion"], "dark-tech", "graphics-3d"),
}
EXTENSIONS = {".js", ".mjs", ".cjs", ".py", ".sh", ".html", ".glsl", ".frag", ".vert"}
OMIT = {"vendor", "assets", "out", "frames", "stills", "fonts", "textures", "models", "node_modules", "__pycache__"}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")


def sections(text):
    return re.findall(r"^##\s+(?:\d+\.\s*)?(.+)$", text, re.M)


def native_moves(text):
    match = re.search(r"^##[^\n]*Native moves[^\n]*\n(.*?)(?=^##|\Z)", text, re.M|re.S|re.I)
    return list(dict.fromkeys(re.findall(r"^\s*(?:[-*]|\d+\.)\s+\*\*([^*]+)\*\*", match.group(1) if match else '', re.M)))


def import_checkout(source, replace=False):
    actual = subprocess.check_output(["git","-C",str(source),"rev-parse","HEAD"], text=True).strip()
    if actual != REVISION:
        raise ValueError(f"expected inspected commit {REVISION}, got {actual}")
    # Check the supplied files themselves, not just HEAD: uncommitted edits must not
    # be laundered into the pinned source record. Sparse checkouts are supported.
    dirty = subprocess.check_output(["git","-C",str(source),"status","--porcelain","--untracked-files=no"], text=True)
    if dirty.strip():
        raise ValueError("upstream checkout has modified tracked files")
    tracked=set(subprocess.check_output(["git","-C",str(source),"ls-files"],text=True).splitlines())
    rows = json.loads((source/"styleboard/catalog.json").read_text(encoding="utf-8"))
    if len(rows) != 59 or len({r['slug'] for r in rows}) != 59:
        raise ValueError("pinned catalog must contain 59 unique styles")
    existing = json.loads((ROOT/"catalog/styles.json").read_text(encoding="utf-8"))["items"]
    originals = [r for r in existing if not r['id'].startswith('opuscar-')]
    for row in originals:
        path = ROOT/"styles"/row['id']
        if path.exists():
            continue  # preserve locally maintained packages on repeat imports
        path.mkdir(parents=True)
        scenarios = json.loads((ROOT/"catalog/scenarios.json").read_text(encoding="utf-8"))["items"]
        item = dict(row, pack_version=1, guide="STYLE.md", aliases=[], borrows=[], category="超级峰原有风格", scenario_ids=[s['id'] for s in scenarios if row['id'] in s['style_ids']], implementation={"status":"guidance", "entrypoints":[]})
        write_json(path/"style.json", item)
        (path/"STYLE.md").write_text(f"# {row['name']}\n\n{row['intent']}\n\n## 风格规则\n\n"+'\n'.join('- '+v for v in row['constraints'])+"\n\n## 运动与节奏\n\n"+'\n'.join('- '+v for v in row['motion_character'].values())+"\n\n## 调整与回退\n\n"+row['fallback']+"\n\n避免："+'；'.join(row['avoid'])+"。\n\n颜色、字形与尺寸见本包 style.json；按真实品牌、画幅与中文阅读检查后使用。\n", encoding="utf-8")
    license_text = (source/"LICENSE").read_text(encoding="utf-8")
    inventory = []
    for row in rows:
        slug = row['slug']; ident = "opuscar-"+slug
        src = source/"styles"/slug; dst = ROOT/"styles"/ident
        if dst.exists() and not replace:
            raise ValueError(f"package exists; use --replace after reviewing changes: {ident}")
        dst.mkdir(parents=True, exist_ok=True)
        style = (src/"STYLE.md").read_text(encoding="utf-8")
        for old,new in (("STYLE.md","STYLE.upstream.md"),("DEMO.md","DEMO.md"),("style.json","style.upstream.json")):
            shutil.copyfile(src/old, dst/new)
        (dst/"LICENSE").write_text(license_text, encoding="utf-8")
        files=[]
        for f in sorted((src/"demo").rglob('*')):
            rel=f.relative_to(src)
            if not f.is_file() or f.is_symlink() or set(rel.parts)&OMIT or str(f.relative_to(source)) not in tracked:
                continue
            if f.suffix not in EXTENSIONS and f.name != "CREDITS":
                continue
            target=dst/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(f,target)
            files.append(dict(path=str(rel), sha256=digest(target), upstream_path=f"styles/{slug}/{rel}"))
        scenarios, palette_base, capability = CATEGORY[row['cat']]
        # Category recommendations are ours. Required rendering capabilities follow
        # the actual selected engine; evidence styles aren't all 3D.
        code = '\n'.join((src/f['path']).read_text(encoding='utf-8') for f in files if Path(f['path']).suffix in {'.js','.mjs','.html'})
        if re.search(r"THREE\.|from\s+['\"][^'\"]*three|three\.module|WebGLRenderer",code):
            capability='graphics-3d'
        elif row['cat']=='实证影像':
            capability='graphics-2d'
        # Swatches are navigation hints; exact material and colour logic is in the
        # full upstream guide. They are not a claim of a rendered style preview.
        base=next(v for v in originals if v['id']==palette_base)
        aliases=list(dict.fromkeys([slug,row['en']]))
        if row['cn'] in aliases: aliases.remove(row['cn'])
        item=dict(pack_version=1,id=ident,name=row['cn'],english_name=row['en'],category=row['cat'],aliases=aliases,guide="STYLE.md",borrows=[],scenario_ids=scenarios,
            intent=f"采用{row['cn']}的材质、构图、运动与声画语法组织当前题材。",
            applicable_inputs=["本片受众、事实和真实素材","品牌、语言与画幅","已选声音和可用制作环境"],
            constraints=["先读本包 STYLE.md 与完整 STYLE.upstream.md，再按镜头任务选择原生动作。","故事、产品、台词、音乐和时间线属于当前作品；上游案例仅用于学习技术。","上游的模型、BPM、语言、画幅和次数要求按本片需求适配，必要事实和素材授权继续核对。"],
            fallback="按同一镜头目的降低材质或运动复杂度，保留主体、证据与阅读窗；能力缺口记 unresolved。",
            tokens={"source":"STYLE.upstream.md", "navigation_only":True, "preview_swatch":base['tokens']},motion_character={"tempo":"依本片内容、实际声音与阅读窗编排", "material":"见完整风格规则", "emphasis":"保留选中风格的原生动作和材质关系"},
            avoid=["仅替换示例字幕或照搬示例故事","把导航色板当作完整材质效果","沿用来源作品的通过状态"],
            required_capabilities=["time-control",capability],verification=fresh_verification(),
            source_refs=[f"{URL}/blob/{REVISION}/styles/{slug}/STYLE.md"],
            native_moves=native_moves(style),section_index=[dict(title=line.lstrip('# ').strip(),line=i+1) for i,line in enumerate(style.splitlines()) if line.startswith('## ')],
            origin=dict(repository="lemomo-ai/lemo-opuscar",revision=REVISION,slug=slug,license="MIT",style_sha256=digest(src/'STYLE.md'),demo_sha256=digest(src/'DEMO.md'),metadata_sha256=digest(src/'style.json')),
            reference_files=["STYLE.upstream.md","DEMO.md","style.upstream.json","LICENSE"],
            implementation=dict(status="reference-source",entrypoints=[f['path'] for f in files if f['path'].count('/')==1 and Path(f['path']).name in ['index.html','main.js','engine.js','scene.js','build.sh','render.mjs']], shared_runtime="vendor/lemo-opuscar", assets="第三方素材按 demo/CREDITS 查找，具体项目另行准备与核验。"))
        write_json(dst/"style.json",item)
        headings=sections(style)
        guide=f"# {row['cn']}\n\n{item['intent']}\n\n## 使用顺序\n\n先确定本片主线与镜头目的，再完整读取 [上游风格规则](STYLE.upstream.md)。选用其中的材质、色彩、文字、运动、镜头、声音、原生动作与失败修复；本包收录章节为"+'、'.join(headings)+"。\n\n本片的事实、品牌、用户指定音乐、语言、画幅和交付节奏优先。固定模型、120 BPM、双语字幕、必须虚构产品、指定开头结尾、固定静默或运镜数量属于来源约束，按本片明确需求判断；改变风格核心时记录覆盖理由。原生材质与动作需要对应实现，导航色板不代表本风格外观。\n\n## 实现与案例\n\n本片结构确定后再读 [案例说明](DEMO.md)，按其 Engine 章节定位 `demo/` 中的代码；从中复用笔刷、遮罩、材质、角色、相机或声画排程。源代码保留原状，先复制到项目并修正资源路径，不能直接运行库内的 build.sh。共享工具位于 `../../vendor/lemo-opuscar/`；这是源码参考，需要本片环境实际探测与接入。\n\n读取 [素材来源](demo/CREDITS) 后，先复用本片授权资产，再补字体、声音或模型。源码、素材就绪、关键帧、成片导出、观看和听审分别登记；本包当前未通过本机整片制作验收。\n\n## 组合与扩展\n\n单片颜色与音色写 plan.design.style_overrides；稳定个人风格在项目外置集合中用新 ID 和 extends 登记。borrows 只声明借用来源，具体借用的动作和冲突处理写入镜头，不自动合并场景或覆盖声音。\n"
        if not (dst/'demo/CREDITS').exists():
            guide=guide.replace("读取 [素材来源](demo/CREDITS) 后", "按案例说明核对素材来源后")
        (dst/"STYLE.md").write_text(guide,encoding="utf-8")
        inventory.append(dict(id=ident,origin=item['origin'],files=files))
    common=ROOT/"vendor/lemo-opuscar"; common.mkdir(parents=True,exist_ok=True)
    common_files=[]
    for f in sorted(source.rglob('*')):
        rel=f.relative_to(source)
        if not f.is_file() or f.is_symlink() or str(rel) not in tracked or rel.parts[0]=='styles':continue
        core_text=rel.parts[0]=='core' and f.suffix in EXTENSIONS|{'.md','.json','.txt'} and not set(rel.parts)&OMIT
        if core_text or str(rel) in ['LICENSE','AGENTS.md','DIRECTOR.md','TECHNIQUE.md','MY-STYLES.md','MAINTAINING.md','package.json','package-lock.json','styleboard/catalog.json']:
            local_rel=Path('AGENTS.upstream.md') if str(rel)=='AGENTS.md' else rel
            target=common/local_rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(f,target)
            common_files.append(dict(path=str(local_rel),upstream_path=str(rel),sha256=digest(target)))
    manifest=dict(schema_version=1,repository=URL,revision=REVISION,license="MIT",style_count=len(rows),policy="text-source-only; no automatic execution, installation or upstream workflow activation",common_files=common_files,styles=inventory)
    write_json(common/"manifest.json",manifest)
    print(json.dumps(dict(styles=len(rows),files=sum(len(v['files']) for v in inventory)+len(common_files),source=REVISION,scope="source-import-only")))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',required=True,type=Path)
    parser.add_argument('--replace',action='store_true')
    args=parser.parse_args()
    import_checkout(args.source.resolve(),args.replace)
