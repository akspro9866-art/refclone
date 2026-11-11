"""Verify the imported text-source snapshot without executing it."""
import hashlib
from pathlib import Path
from _stylepacks import ROOT, inside, read_json


def verify_sources(root=ROOT):
    root=Path(root)
    common=root/'vendor/lemo-opuscar'
    manifest=read_json(common/'manifest.json')
    checked=0
    def verify(folder, relative, expected):
        nonlocal checked
        path=inside(folder,relative)
        actual=hashlib.sha256(path.read_bytes()).hexdigest()
        if actual!=expected:
            raise ValueError(f"source hash mismatch: {path}")
        checked+=1
    for item in manifest['common_files']:
        verify(common,item['path'],item['sha256'])
    for style in manifest['styles']:
        folder=root/'styles'/style['id']
        origin=style['origin']
        verify(folder,'STYLE.upstream.md',origin['style_sha256'])
        verify(folder,'DEMO.md',origin['demo_sha256'])
        verify(folder,'style.upstream.json',origin['metadata_sha256'])
        if (folder/'LICENSE').read_bytes()!=(common/'LICENSE').read_bytes():
            raise ValueError(f"upstream license mismatch: {folder}")
        for item in style['files']:
            verify(folder,item['path'],item['sha256'])
    frames=root/'assets/gallery/reference-frames.json'
    frame_count=0
    if frames.is_file():
        frame_manifest=read_json(frames)
        if frame_manifest.get('revision')!=manifest['revision']:
            raise ValueError('gallery reference frame revision mismatch')
        if len({f['style_id'] for f in frame_manifest['frames']})!=len(frame_manifest['frames']):
            raise ValueError('duplicate gallery reference frame')
        for frame in frame_manifest['frames']:
            verify(root,frame['path'],frame['sha256'])
            frame_count+=1
    sample_manifest=root/'assets/gallery/samples.json'
    sample_count=0
    if sample_manifest.is_file():
        films=read_json(sample_manifest)
        if films.get('style_revision')!=manifest['revision']:
            raise ValueError('gallery sample style revision mismatch')
        ids={s['id'] for s in manifest['styles']}
        if {s['style_id'] for s in films['samples']}!=ids or len(films['samples'])!=len(ids):
            raise ValueError('gallery samples must match all imported styles once')
        for sample in films['samples']:
            if sample['path']!=f"styles/{sample['style_id']}/sample.mp4":
                raise ValueError('gallery sample path does not match its style')
            verify(root,sample['path'],sample['sha256'])
            if (root/sample['path']).stat().st_size!=sample['bytes']:
                raise ValueError('gallery sample size mismatch: '+sample['style_id'])
            item=read_json(root/'styles'/sample['style_id']/'style.json')
            if item.get('gallery',{}).get('video')!='sample.mp4' or item['gallery'].get('video_sha256')!=sample['sha256']:
                raise ValueError('gallery sample binding mismatch: '+sample['style_id'])
            sample_count+=1
    return dict(status='passed',files=checked,styles=len(manifest['styles']),reference_frames=frame_count,samples=sample_count,revision=manifest['revision'],scope='source-integrity-only')
