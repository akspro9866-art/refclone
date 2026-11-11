#!/usr/bin/env python3
"""Import the reviewed web-release films serially; remove excluded voice tracks.

The input is an inspected release asset list, never arbitrary download URLs.
Interrupted runs reuse verified files recorded in the task-local receipt.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import urllib.request

from _stylepacks import ROOT, read_json
from import_opuscar import REVISION, URL

SILENT = {'game-show', 'paper-lantern', 'news-package'}
DOWNLOAD = 'https://github.com/lemomo-ai/lemo-opuscar/releases/download/web/'
MIRROR = 'https://lemomo-ai.github.io/lemo-opuscar/films/'


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def probe(path):
    data = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_format', '-show_streams',
        '-of', 'json', str(path)], text=True))
    videos = [s for s in data['streams'] if s['codec_type'] == 'video']
    if len(videos) != 1 or float(data['format']['duration']) <= 0:
        raise ValueError(f'expected one nonempty video: {path}')
    return dict(duration=float(data['format']['duration']),
                width=videos[0]['width'], height=videos[0]['height'],
                video_codec=videos[0]['codec_name'],
                has_audio=any(s['codec_type'] == 'audio' for s in data['streams']))


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def import_samples(release_manifest, cache):
    source = read_json(release_manifest)
    if source['repository'] != 'lemomo-ai/lemo-opuscar' or source['tag'] != 'web':
        raise ValueError('expected the reviewed Opuscar web release')
    assets = {}
    for asset in source['assets']:
        name = asset['name']
        if not re.fullmatch(r'[a-z0-9-]+\.mp4', name) or name in assets:
            raise ValueError('invalid or duplicate release filename')
        if asset['download_url'] != DOWNLOAD + name:
            raise ValueError('unexpected release download URL')
        if not re.fullmatch(r'sha256:[0-9a-f]{64}', asset.get('digest') or ''):
            raise ValueError('release asset needs a GitHub SHA-256 digest')
        if not 0 < asset['size'] < 50_000_000:
            raise ValueError('release asset exceeds the reviewed size budget')
        assets[name] = asset
    packages = []
    for path in sorted((ROOT / 'styles').glob('*/style.json')):
        item = read_json(path)
        if item.get('origin', {}).get('repository') == source['repository']:
            packages.append((path, item))
    names = {item['origin']['slug'] + '.mp4' for _, item in packages}
    if len(packages) != 59 or set(assets) != names:
        raise ValueError('release list must match the 59 bundled film styles')
    cache.mkdir(parents=True, exist_ok=True)
    receipt_path = cache / 'receipt.json'
    receipt = read_json(receipt_path) if receipt_path.is_file() else {}
    records = []
    for number, (path, item) in enumerate(packages, 1):
        slug = item['origin']['slug']
        asset = assets[slug + '.mp4']
        target = path.parent / 'sample.mp4'
        old = receipt.get(slug)
        if old and old['source_asset'] == asset and target.is_file() and digest(target) == old['sha256']:
            records.append(old)
            print(json.dumps(dict(completed=number, total=59, style=item['id'], reused=True)), flush=True)
            continue
        temporary = cache / (slug + '.download')
        # Pages serves these exact release bytes through its CDN. The release's
        # size and SHA-256 below still pin every download independently of it.
        offset=temporary.stat().st_size if temporary.is_file() else 0
        headers={'User-Agent': 'chaojifeng-video-design'}
        if offset:headers['Range']=f'bytes={offset}-'
        request = urllib.request.Request(MIRROR + asset['name'], headers=headers)
        with urllib.request.urlopen(request, timeout=90) as response:
            append=response.status==206 and offset>0
            if response.status==206 and not response.headers.get('Content-Range','').startswith(f'bytes {offset}-'):
                raise ValueError('unexpected partial download range: '+slug)
            with temporary.open('ab' if append else 'wb') as stream:
                shutil.copyfileobj(response, stream, 1024 * 1024)
        if temporary.stat().st_size != asset['size'] or digest(temporary) != asset['digest'].split(':')[1]:
            raise ValueError('release asset integrity mismatch: ' + slug)
        with temporary.open('rb') as stream:
            if stream.read(12)[4:8] != b'ftyp':
                raise ValueError('release asset is not an MP4: ' + slug)
        original = probe(temporary)
        if slug in SILENT:
            converted = cache / (slug + '.silent.mp4')
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(temporary),
                            '-map', '0:v:0', '-c:v', 'copy', '-an', '-map_metadata', '-1',
                            '-movflags', '+faststart', '-y', str(converted)], check=True)
            final = probe(converted)
            if final['has_audio'] or abs(final['duration'] - original['duration']) > 0.2:
                raise ValueError('silent remux did not preserve the film: ' + slug)
            # Verify the compressed video packets themselves were not changed.
            def video_hash(p):
                return subprocess.check_output(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(p),
                    '-map', '0:v:0', '-c', 'copy', '-f', 'hash', '-hash', 'sha256', '-'], text=True).strip()
            if video_hash(temporary) != video_hash(converted):
                raise ValueError('video stream changed during silent remux: ' + slug)
            converted.replace(target)
            temporary.unlink()
        else:
            final = original
            temporary.replace(target)
        record = dict(style_id=item['id'], path=str(target.relative_to(ROOT)),
                      sha256=digest(target), bytes=target.stat().st_size, **final,
                      changes='audio removed' if slug in SILENT else 'none',
                      source_asset=asset, credit_file=f'styles/{item["id"]}/demo/CREDITS')
        receipt[slug] = record
        save(receipt_path, receipt)
        records.append(record)
        print(json.dumps(dict(completed=number, total=59, style=item['id'], bytes=record['bytes'],
                              has_audio=record['has_audio'])), flush=True)
    for (path, item), record in zip(packages, records):
        item['gallery'].update(video='sample.mp4', video_sha256=record['sha256'])
        item['gallery']['attribution']=dict(name='LemoLab · Lemo-Opuscar',url=URL)
        item['gallery'].pop('source_url', None)
        save(path, item)
    manifest = dict(schema_version=1, source=URL, style_revision=REVISION,
                    release_id=source['release_id'], release_tag='web', samples=records)
    save(ROOT / 'assets/gallery/samples.json', manifest)
    print(json.dumps(dict(status='passed', samples=59, silent_samples=len(SILENT),
                          bytes=sum(r['bytes'] for r in records))), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-manifest', type=Path, required=True)
    parser.add_argument('--cache', type=Path, default=ROOT / 'Output/gallery-downloads')
    args = parser.parse_args()
    import_samples(args.release_manifest, args.cache.resolve())
