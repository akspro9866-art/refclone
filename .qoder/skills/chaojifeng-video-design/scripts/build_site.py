#!/usr/bin/env python3
"""Build the existing gallery as a static Pages site, with bundled playable media."""
import argparse
import json
from pathlib import Path
import shutil
from build_gallery import build, ROOT


def main():
    p=argparse.ArgumentParser();p.add_argument('--into',type=Path,required=True);args=p.parse_args()
    dest=args.into.resolve()
    if dest.exists():raise ValueError('site destination exists; use a fresh task-owned directory')
    if ROOT==dest or ROOT.is_relative_to(dest):raise ValueError('site cannot contain or replace source')
    build(check=True);dest.mkdir(parents=True)
    shutil.copytree(ROOT/'assets/gallery',dest/'assets/gallery')
    # Keep relative guide and playback URLs valid without shipping source caches.
    for folder in (ROOT/'styles').iterdir():
        if not folder.is_dir():continue
        out=dest/'styles'/folder.name;out.mkdir(parents=True)
        for f in folder.iterdir():
            if f.is_file() and f.suffix in ('.md','.json','.jpg','.png','.mp4'):shutil.copy2(f,out/f.name)
    shutil.copytree(ROOT/'references',dest/'references')
    for name in ('README.md','MAINTAINING.md','LICENSE','THIRD_PARTY_NOTICES.md'):
        if (ROOT/name).exists():shutil.copy2(ROOT/name,dest/name)
    (dest/'index.html').write_text('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=assets/gallery/index.html"><title>超级峰的视频设计方法论</title><a href="assets/gallery/index.html">进入视频风格与作品图册</a></html>')
    (dest/'.nojekyll').touch()
    print(json.dumps(dict(site=str(dest),gallery='assets/gallery/index.html'),ensure_ascii=False))


if __name__=='__main__':main()
