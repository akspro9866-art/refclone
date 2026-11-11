#!/usr/bin/env python3
"""Import the 59 pinned reference frames into their style packages; no video download."""
import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path
from import_opuscar import REVISION, URL
from _stylepacks import ROOT, read_json


def import_frames(source):
    revision=subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
    if revision!=REVISION:
        raise ValueError('gallery checkout must match the inspected source revision')
    dirty=subprocess.check_output(['git','-C',str(source),'status','--porcelain','--untracked-files=no'],text=True)
    if dirty.strip():
        raise ValueError('gallery checkout has modified tracked files')
    tracked=set(subprocess.check_output(['git','-C',str(source),'ls-files'],text=True).splitlines())
    records=[]
    for path in sorted((ROOT/'styles').glob('*/style.json')):
        item=read_json(path);origin=item.get('origin',{})
        if origin.get('repository')!='lemomo-ai/lemo-opuscar':continue
        rel=f"styleboard/img/{origin['slug']}_0.jpg";image=source/rel
        if rel not in tracked or not image.is_file() or not image.read_bytes().startswith(b'\xff\xd8\xff'):
            raise ValueError('missing tracked JPEG reference frame: '+rel)
        if image.stat().st_size>2_000_000:
            raise ValueError('reference frame is unexpectedly large: '+rel)
        target=path.parent/'preview.jpg'
        records.append((path,item,image,target,rel))
    if len(records)!=59:
        raise ValueError('the pinned gallery must contain 59 reference frames')
    manifest=[]
    for path,item,image,target,rel in records:
        shutil.copyfile(image,target)
        sha=hashlib.sha256(target.read_bytes()).hexdigest()
        # A poster refresh must retain the integrated film, never restore a hotlink.
        media=item.get('gallery',{})
        media.update(poster='preview.jpg',poster_sha256=sha,poster_source=f'{URL}/blob/{REVISION}/{rel}')
        media.pop('source_url',None)
        if (path.parent/'sample.mp4').is_file():
            media['video']='sample.mp4'
            if not media.get('video_sha256'):
                media['video_sha256']=hashlib.sha256((path.parent/'sample.mp4').read_bytes()).hexdigest()
        else:
            media.pop('video',None)
            media.pop('video_sha256',None)
        item['gallery']=media
        path.write_text(json.dumps(item,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        manifest.append(dict(style_id=item['id'],path=str(target.relative_to(ROOT)),sha256=sha,upstream_path=rel,revision=REVISION))
    out=ROOT/'assets/gallery/reference-frames.json'
    out.write_text(json.dumps(dict(schema_version=1,source=URL,revision=REVISION,frames=manifest),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(reference_frames=len(manifest),bytes=sum(p[3].stat().st_size for p in records),videos_downloaded=0)))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',type=Path,required=True)
    args=parser.parse_args();import_frames(args.source.resolve())
