#!/usr/bin/env python3
"""Search measured music excerpt candidates; validate source and film clocks.

Standard library only. Does not copy songs, render, certify rights or listen.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
from _recipe_music import select_music, select_source_file, source_info, validate_policy

ROOT = Path(__file__).resolve().parents[1]

def load(path):
    def reject(v): raise ValueError('non-finite JSON: '+v)
    return json.loads(Path(path).read_text(encoding='utf-8'), parse_constant=reject)

def number(x):
    return type(x) in (int,float) and math.isfinite(x)

def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()

def validate_catalog(c):
    errors=[]; tracks={}; cues={}
    if c.get('schema_version')!=1 or not isinstance(c.get('items'),list):
        return ['invalid library envelope']
    for t in c['items']:
        tid=t.get('id')
        if not tid or tid in tracks:errors.append('duplicate/missing track ID: '+str(tid))
        tracks[tid]=t
        d=t.get('duration_seconds')
        if not number(d) or d<=0:errors.append(str(tid)+': invalid duration');continue
        for key,tax in [('emotion_ids','emotions'),('scenario_ids','scenarios'),('narrative_roles','roles')]:
            if not t.get(key) or any(v not in c['taxonomy'][tax] for v in t[key]):errors.append(str(tid)+': invalid '+key)
        if len(t.get('sha256',''))!=64:errors.append(str(tid)+': invalid source hash')
        if not t.get('cues'):errors.append(str(tid)+': no candidate cues')
        for cue in t.get('cues',[]):
            cid=cue.get('id');s=cue.get('source_in');e=cue.get('source_out')
            if not cid or cid in cues:errors.append('duplicate/missing cue ID: '+str(cid))
            cues[cid]=cue
            if cue.get('track_id')!=tid:errors.append(str(cid)+': wrong track')
            if not number(s) or not number(e) or not 0<=s<e<=d+.001:errors.append(str(cid)+': invalid source range')
            elif abs((e-s)-cue.get('duration_seconds',-1))>.002:errors.append(str(cid)+': duration mismatch')
    if c.get('track_count')!=len(tracks) or c.get('cue_count')!=len(cues):errors.append('declared count mismatch')
    return errors

def registry(args,c):
    path=args.registry or os.environ.get('CJF_VIDEO_MUSIC_REGISTRY')
    if not path:
        data=Path(os.environ.get('XDG_DATA_HOME',str(Path.home()/'.local/share')))
        default=data/'chaojifeng-video-design/music-registries'/(c['library_id']+'.json')
        if default.is_file():path=str(default)
    if not path:return None
    r=load(path)
    if r.get('library_id')!=c['library_id']:raise ValueError('registry library_id mismatch')
    return r

def search(c,args):
    # Hard scene/emotion/role constraints; then relative preference ranking.
    def canonical(value,tax):
        if not value:return None
        if value in c['taxonomy'][tax]:return value
        found=[k for k,v in c['taxonomy'][tax].items() if v==value]
        if not found:raise ValueError('unknown '+tax+': '+value)
        return found[0]
    scenario=canonical(args.scenario,'scenarios');emotion=canonical(args.emotion,'emotions');role=canonical(args.role,'roles')
    out=[]
    for t in c['items']:
        for cue in t['cues']:
            if scenario and scenario not in cue['scenario_ids']:continue
            if emotion and emotion not in cue['emotion_ids']:continue
            if role and role not in cue['role_ids']:continue
            if args.energy and cue['arousal']!=args.energy:continue
            if cue['duration_seconds']<args.min_duration:continue
            if args.query and args.query.casefold() not in json.dumps(t,ensure_ascii=False).casefold():continue
            score=0.;reasons=[]
            if scenario:score+=4;reasons.append('scene match')
            if emotion:score+=4;reasons.append('inferred emotion match')
            if role:score+=3;reasons.append('candidate narrative role match')
            if t['semantic_confidence']=='low':score-=2;reasons.append('weak semantic evidence')
            if args.narration:
                score+=2 if cue['kind']=='support' else -1
                score-=cue['presence_2_5k_ratio']*6
                reasons.append('prefer support and lower measured presence-band energy; speech masking unverified')
            if args.avoid_bright:
                score-=cue['high_4k_ratio']*10+cue['presence_2_5k_ratio']*5
                reasons.append('prefer lower high/presence-band ratio; comfort unverified')
            out.append(dict(track_id=t['id'],title=t['title'],cue_id=cue['id'],
                source_in=cue['source_in'],source_out=cue['source_out'],duration_seconds=cue['duration_seconds'],
                emotion_ids=cue['emotion_ids'],role_ids=cue['role_ids'],arousal=cue['arousal'],
                score=round(score,4),reasons=reasons,tag_status=t['tag_status'],
                audition_status=cue['audition_status'],rights_status=t['rights']['status']))
    return sorted(out,key=lambda x:(-x['score'],x['track_id'],x['cue_id']))[:args.limit]

def validate_sheet(sheet,c,r=None):
    errors=[];warnings=[];tracks={t['id']:t for t in c['items']};seen=set();ordered=[]
    if sheet.get('schema_version')!=1 or sheet.get('library_id')!=c['library_id']:errors.append('sheet schema/library mismatch')
    duration=sheet.get('duration_seconds')
    if not number(duration) or duration<=0:errors.append('invalid film duration')
    if not sheet.get('cues'):errors.append('empty cue sheet')
    for row in sheet.get('cues',[]):
        id=row.get('id');tid=row.get('track_id');t=tracks.get(tid)
        if not id or id in seen:errors.append('duplicate/missing placement ID: '+str(id))
        seen.add(id)
        if not t:errors.append(str(id)+': unknown track');continue
        s,e,ts,te=[row.get(k) for k in ('source_in','source_out','timeline_start','timeline_end')]
        if not all(number(x) for x in [s,e,ts,te]):errors.append(str(id)+': nonfinite/missing times');continue
        if not 0<=s<e<=t['duration_seconds']+.001:errors.append(str(id)+': source range outside song')
        if not 0<=ts<te or number(duration) and te>duration+.001:errors.append(str(id)+': film range invalid')
        if abs((e-s)-(te-ts))>.01:errors.append(str(id)+': source/film duration mismatch; only playback_rate=1 supported')
        if row.get('playback_rate',1)!=1:errors.append(str(id)+': time stretch requires separate implementation and review')
        if row.get('source_sha256')!=t['sha256']:errors.append(str(id)+': source hash missing/mismatch')
        base=next((v for v in t['cues'] if v['id']==row.get('cue_id')),None)
        if row.get('cue_id') and base is None:errors.append(str(id)+': cue does not belong to track')
        if base and (s<base['source_in']-.001 or e>base['source_out']+.001) and not row.get('edit_rationale'):errors.append(str(id)+': adjusted candidate range needs edit_rationale')
        if not row.get('narrative_purpose'):errors.append(str(id)+': missing narrative purpose')
        for key in ('fade_in_seconds','fade_out_seconds'):
            v=row.get(key,0)
            if not number(v) or v<0 or v>max(0,te-ts):errors.append(str(id)+': invalid '+key)
        if t['rights']['status']!='verified_for_project' and row.get('rights',{}).get('status')!='verified_for_project':warnings.append(str(id)+': item/project usage scope not verified; do not assume external editing permitted')
        elif not row.get('rights',{}).get('evidence') and not t['rights'].get('evidence'):errors.append(str(id)+': rights verification requires evidence')
        if r:
            asset=r.get('assets',{}).get(tid,{})
            if not Path(asset.get('path','/missing')).is_file():errors.append(str(id)+': source asset missing')
            elif digest(asset['path'])!=t['sha256']:errors.append(str(id)+': actual source file hash changed')
        ordered.append(row)
        if row.get('audition_status')!='passed':warnings.append(str(id)+': subjective audition pending')
    for prev,row in zip(sorted(ordered,key=lambda x:x['timeline_start']),sorted(ordered,key=lambda x:x['timeline_start'])[1:]):
        overlap=prev['timeline_end']-row['timeline_start']
        if overlap>0:
            if not row.get('transition_reason'):errors.append(str(row['id'])+': overlap needs transition_reason')
            elif overlap>=min(prev['timeline_end']-prev['timeline_start'],row['timeline_end']-row['timeline_start']):errors.append(str(row['id'])+': full containment/overlap needs separate layered sound design')
        elif overlap<-.01:warnings.append(str(row['id'])+': music gap '+str(round(-overlap,3))+' seconds; confirm intentional silence/bridge')
    return dict(status='failed' if errors else 'structure_valid',errors=errors,warnings=list(dict.fromkeys(warnings)),
        audio_aesthetic_verified=False,rights_cleared_for_render=not any('usage scope' in w for w in warnings))

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('action',choices=['search','get','select','health','validate-catalog','validate-sheet'])
    p.add_argument('id_or_path',nargs='?');p.add_argument('--catalog',default=str(ROOT/'catalog/music.json'))
    p.add_argument('--registry');p.add_argument('--scenario');p.add_argument('--emotion');p.add_argument('--role')
    p.add_argument('--energy',choices=['low','mid','high']);p.add_argument('--query',default='')
    p.add_argument('--min-duration',type=float,default=0);p.add_argument('--narration',action='store_true')
    p.add_argument('--avoid-bright',action='store_true');p.add_argument('--limit',type=int,default=10)
    p.add_argument('--recipe',help='recipe ID: filter search to its pool or resolve select')
    p.add_argument('--recipes',default=str(ROOT/'catalog/recipes.json'),help='recipe catalog for select')
    choice=p.add_mutually_exclusive_group()
    choice.add_argument('--track',help='explicit selected track ID, including tracks outside the recipe pool')
    choice.add_argument('--source-file',help='explicit local audio file; project-only, no catalog/default mutation')
    choice.add_argument('--silent',action='store_true',help='preserve explicit no-music choice')
    choice.add_argument('--original-audio',action='store_true',help='preserve explicit original-audio choice')
    p.add_argument('--project-track',help='previously selected project track ID')
    args=p.parse_args()
    try:
        if args.limit<=0 or not math.isfinite(args.min_duration) or args.min_duration<0:raise ValueError('invalid limit/min-duration')
        c=load(args.catalog);errors=validate_catalog(c)
        if errors:raise ValueError('; '.join(errors))
        r=registry(args,c) if args.action != 'select' else None
        recipe=None
        if args.recipe and args.action in ('search','select'):
            recipes=load(args.recipes)
            matches=[row for row in recipes['items'] if row['id']==args.recipe]
            if len(matches)!=1:raise ValueError('unknown or duplicate recipe ID')
            recipe=matches[0]
        if args.action=='search':
            view=c
            if recipe:
                errors=validate_policy(recipe.get('music_policy'),{row['id'] for row in c['items']})
                if errors:raise ValueError('; '.join(errors))
                pool=set(recipe['music_policy']['candidate_track_ids'])
                view=dict(c,items=[row for row in c['items'] if row['id'] in pool])
            out={'library_id':c['library_id'],'items':search(view,args)}
            if recipe:out.update(recipe_id=recipe['id'],default_track_id=recipe['music_policy']['default_track_id'])
        elif args.action=='select':
            if not args.recipe:raise ValueError('--recipe is required for select')
            if args.source_file:
                out=select_source_file(recipe,c,args.source_file)
            else:
                mode='silent' if args.silent else 'original' if args.original_audio else 'auto'
                out=select_music(recipe,c,args.track,args.project_track,mode)
                tid=out['selected_track_id']
                if tid is None:
                    out['status']='ready'
                else:
                    r=registry(args,c)
                    asset=(r or {}).get('assets',{}).get(tid,{})
                    if not asset.get('path'):
                        out.update(status='blocked',source_state='missing',error='selected track has no registered local source; no automatic substitution')
                    else:
                        try:
                            info=source_info(asset['path'])
                            state='hash_mismatch' if info['sha256']!=out['source_sha256'] else 'duration_mismatch' if abs(info['duration_seconds']-out['duration_seconds'])>.01 else 'ready'
                            out.update(local_asset=info,source_state=state,status='ready' if state=='ready' else 'blocked')
                            if state!='ready':out['error']='selected source does not match catalog; no automatic substitution'
                        except (OSError,ValueError) as exc:
                            out.update(status='blocked',source_state='unavailable',error=str(exc))
            out['library_id']=c['library_id']
        elif args.action=='get':
            matches=[t for t in c['items'] if t['id']==args.id_or_path]
            if not matches:raise ValueError('unknown track ID')
            out={'item':matches[0]}
            if r:out['local_asset']=r.get('assets',{}).get(args.id_or_path)
        elif args.action=='validate-catalog':out={'status':'structure_valid','tracks':c['track_count'],'cues':c['cue_count'],'subjective_listening':'not_run'}
        elif args.action=='validate-sheet':
            if not args.id_or_path:raise ValueError('sheet path required')
            out=validate_sheet(load(args.id_or_path),c,r)
        else:
            if not r:raise ValueError('no local registry registered; provide --registry or CJF_VIDEO_MUSIC_REGISTRY')
            health=[]
            for t in c['items']:
                a=r.get('assets',{}).get(t['id'],{});path=Path(a.get('path','/missing'))
                state='missing' if not path.is_file() else 'ready' if digest(path)==t['sha256'] else 'hash_mismatch'
                health.append({'track_id':t['id'],'state':state})
            out={'status':'ready' if all(x['state']=='ready' for x in health) else 'partial','assets':health}
        print(json.dumps(out,ensure_ascii=False,indent=2))
        return 2 if out.get('status') in ('failed','blocked') else 0
    except (OSError,ValueError,KeyError,TypeError) as e:
        print(json.dumps({'status':'failed','error':str(e)},ensure_ascii=False));return 2

if __name__=='__main__':raise SystemExit(main())
