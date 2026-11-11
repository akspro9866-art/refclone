#!/usr/bin/env python3
"""Generate a portable visual style gallery and the retained expression directory.

Posters embed into the HTML. Videos load from their bundled path only when
the viewer clicks play. Generation never fetches media or changes evidence.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse
from _contracts import KINDS, catalog
from _stylepacks import inside, load_registry

ROOT=Path(__file__).resolve().parents[1]
FEATURED=['opuscar-ink-wash','opuscar-swiss-motion','opuscar-glass-product']
FIRST=['opuscar-watercolor','opuscar-glass-product','opuscar-swiss-motion','opuscar-ink-wash','opuscar-paper-popup','opuscar-pixel-rpg']


def image_url(path, expected=None):
    data=path.read_bytes()
    if expected and hashlib.sha256(data).hexdigest()!=expected:
        raise ValueError(f'poster hash mismatch: {path}')
    if data.startswith(b'\xff\xd8\xff'):mime='image/jpeg'
    elif data.startswith(b'\x89PNG\r\n\x1a\n'):mime='image/png'
    elif data.startswith((b'GIF87a',b'GIF89a')):mime='image/gif'
    elif data[:4]==b'RIFF' and data[8:12]==b'WEBP':mime='image/webp'
    else:raise ValueError(f'unsupported poster image: {path}')
    if len(data)>4_000_000:raise ValueError(f'poster exceeds the gallery image budget: {path}')
    return 'data:'+mime+';base64,'+base64.b64encode(data).decode('ascii')


def gallery_data(root=ROOT):
    # The portable bundle never discovers or exports a private project collection.
    registry,_,locations=load_registry(extra=[],bundled=root/'styles')
    scenario_items=list(catalog('scenario',root/'catalog',style_roots=[]).values())
    sample_manifest=root/'assets/gallery/samples.json'
    samples={s['style_id']:s for s in json.loads(sample_manifest.read_text())['samples']} if sample_manifest.is_file() else {}
    items=[]
    for ident,item in registry.items():
        folder=locations[ident];media=item.get('gallery',{})
        sample=json.loads((folder/'style.upstream.json').read_text()) if (folder/'style.upstream.json').is_file() else {}
        media_info=samples.get(ident,{})
        poster=image_url(inside(folder,media['poster']),media.get('poster_sha256')) if media.get('poster') else ''
        video=media.get('video','')
        if video and not urlparse(video).scheme:
            inside(folder,video)
            video=f'../../styles/{ident}/{video}'
        category='基础风格' if item.get('category')=='超级峰原有风格' else item.get('category','其他风格')
        row=dict(id=ident,name=item['name'],english_name=item.get('english_name',''),category=category,
            intent=item['intent'],tokens=item['tokens'],scenario_ids=item.get('scenario_ids',[]),
            native_moves=item.get('native_moves',[]),poster=poster,video=video,
            attribution=media.get('attribution'),
            film=sample.get('film',''),story=sample.get('line_cn',''),duration=media_info.get('duration',sample.get('dur')),
            has_audio=media_info.get('has_audio'),
            guide=f'../../styles/{ident}/'+item.get('guide','STYLE.md'),
            verification=item['verification'])
        row['search']=json.dumps([ident,item['name'],item.get('english_name',''),category,item.get('aliases',[]),item['intent'],sample.get('uses',[]),row['native_moves'],[s['name'] for s in scenario_items if s['id'] in row['scenario_ids']]],ensure_ascii=False).casefold()
        items.append(row)
    items.sort(key=lambda x:(FIRST.index(x['id']) if x['id'] in FIRST else len(FIRST),not bool(x['poster']),x['category'],x['id']))
    by_id={x['id']:x for x in items}
    original_manifest=root/'assets/gallery/originals.json'
    originals=json.loads(original_manifest.read_text())['samples'] if original_manifest.is_file() else []
    for work in originals:
        for key,hash_key in [('video','sha256'),('poster','poster_sha256')]:
            path=inside(root/'assets/gallery',work[key])
            if hashlib.sha256(path.read_bytes()).hexdigest()!=work[hash_key]:
                raise ValueError(f'original work hash mismatch: {work["id"]} {key}')
        work['poster']=image_url(inside(root/'assets/gallery',work['poster']),work['poster_sha256'])
    return dict(styles=items,originals=originals,scenarios=[dict(id=x['id'],name=x['name']) for x in scenario_items],
        categories=sorted({x['category'] for x in items},key=lambda x:(x!='基础风格',x)),
        featured=[ident for ident in FEATURED if ident in by_id],
        photoReference=by_id.get('opuscar-city-symphony',{}).get('poster',''))


def encode(data):
    return json.dumps(data,ensure_ascii=False,separators=(',',':')).replace('</','<\\/').replace('\u2028','\\u2028').replace('\u2029','\\u2029')


def render(template, marker, data):
    text=template.read_text(encoding='utf-8')
    if text.count(marker)!=1:raise ValueError(f'{template}: expected exactly one {marker}')
    return text.replace(marker,encode(data))


def build(root=ROOT,check=False):
    gallery=root/'assets/gallery'
    payload={kind:list(catalog(kind,root/'catalog',style_roots=[]).values()) for kind in KINDS}
    data=gallery_data(root)
    outputs={gallery/'index.html':render(gallery/'styles-template.html','__GALLERY_JSON__',data),
             gallery/'expressions.html':render(gallery/'template.html','__CATALOG_JSON__',payload)}
    for path,content in outputs.items():
        if check:
            if not path.is_file() or path.read_text(encoding='utf-8')!=content:raise ValueError(f'stale generated page: {path}; run build_gallery.py')
        else:path.write_text(content,encoding='utf-8')
    return dict(styles=len(data['styles']),posters=sum(bool(x['poster']) for x in data['styles']),
                bundled_videos=sum(bool(x['video']) and not urlparse(x['video']).scheme for x in data['styles']),
                pages=[str(p) for p in outputs],portable_posters=True,video_preload=False,
                checked_only=check,catalog_verification_mutated=False)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--check',action='store_true');args=parser.parse_args()
    print(json.dumps(build(check=args.check),ensure_ascii=False))


if __name__=='__main__':main()
