#!/usr/bin/env python3
"""Embed music metadata and optional explicit machine-local media registry.
No server, network, browser, copying or decoding of media.
"""
import argparse, json
from pathlib import Path
from music_library import load, validate_catalog

def main():
    root=Path(__file__).resolve().parents[1]
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--catalog',default=str(root/'catalog/music.json'))
    p.add_argument('--registry',help='Use only for a private local output, not the bundled portable atlas')
    p.add_argument('--output',default=str(root/'assets/music/index.html'))
    a=p.parse_args(); c=load(a.catalog);errors=validate_catalog(c)
    if errors:raise ValueError('; '.join(errors))
    registry=load(a.registry) if a.registry else None
    if registry and registry.get('library_id')!=c['library_id']:raise ValueError('registry library mismatch')
    if registry and Path(a.output).resolve().is_relative_to(root):raise ValueError('machine-local registry must be written outside Skill')
    template=(root/'assets/music/template.html').read_text()
    for token,value in [('__MUSIC_JSON__',c),('__REGISTRY_JSON__',registry)]:
        if template.count(token)!=1:raise ValueError('expected one '+token)
        template=template.replace(token,json.dumps(value,ensure_ascii=False).replace('</','<\\/'))
    dest=Path(a.output);dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(template)
    print(json.dumps({'output':str(dest),'tracks':c['track_count'],'cues':c['cue_count'],'local_paths_embedded':registry is not None},ensure_ascii=False))

if __name__=='__main__':main()
