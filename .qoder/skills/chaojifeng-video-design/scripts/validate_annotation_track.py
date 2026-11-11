#!/usr/bin/env python3
"""Check authored video callout geometry at bounded, explicit time samples.

No image recognition, tracking, rendering, font shaping or perceptual review.
Supports axis-aligned uniform scale/translation and linear interpolation only.
"""
import argparse
import bisect
import math
from pathlib import Path
from _contracts import load_json, sha256, is_number, nonempty
import json

EPS=1e-7

def rect(v):
    return (isinstance(v,list) and len(v)==4 and all(is_number(x) for x in v)
            and v[2]>v[0] and v[3]>v[1])

def inside(a,b,tolerance=0):
    return a[0]>=b[0]-tolerance and a[1]>=b[1]-tolerance and a[2]<=b[2]+tolerance and a[3]<=b[3]+tolerance

def overlap(a,b):
    return min(a[2],b[2])-max(a[0],b[0])>EPS and min(a[3],b[3])-max(a[1],b[1])>EPS

def inflate(r,d):return [r[0]-d,r[1]-d,r[2]+d,r[3]+d]

def clipped(r,bounds):
    result=[max(r[0],bounds[0]),max(r[1],bounds[1]),min(r[2],bounds[2]),min(r[3],bounds[3])]
    return result if result[2]>result[0] and result[3]>result[1] else None

def stroke_overlaps(frame,r,width):
    # Conservative rectangle border, including rounded-corner empty areas.
    return overlap(inflate(frame,width/2),r) and not inside(r,inflate(frame,-width/2))

def interpolate(frames,t,keys):
    pos=bisect.bisect_right([f['time'] for f in frames],t)
    if pos==0:return {k:frames[0][k] for k in keys}
    if pos==len(frames):return {k:frames[-1][k] for k in keys}
    a,b=frames[pos-1],frames[pos];u=(t-a['time'])/(b['time']-a['time'])
    out={}
    for k in keys:
        out[k]=[x+(y-x)*u for x,y in zip(a[k],b[k])] if isinstance(a[k],list) else a[k]+(b[k]-a[k])*u
    return out

def project(r,transform):
    s=transform['scale'];x=transform['translate_x'];y=transform['translate_y']
    return [r[0]*s+x,r[1]*s+y,r[2]*s+x,r[3]*s+y]

def connector_points(target,label):
    tc=[(target[0]+target[2])/2,(target[1]+target[3])/2]
    lc=[(label[0]+label[2])/2,(label[1]+label[3])/2]
    clamp=lambda p,r:[max(r[0],min(r[2],p[0])),max(r[1],min(r[3],p[1]))]
    return clamp(lc,target),clamp(tc,label)

def segment_hits(a,b,r):
    low,high=0.0,1.0
    for dim in (0,1):
        delta=b[dim]-a[dim]
        if abs(delta)<EPS:
            if a[dim]<=r[dim] or a[dim]>=r[dim+2]:return False
        else:
            x,y=(r[dim]-a[dim])/delta,(r[dim+2]-a[dim])/delta
            low=max(low,min(x,y));high=min(high,max(x,y))
            if low>=high:return False
    return low<high

def region_active(region,t,duration):
    return region.get('start',0)<=t<region.get('end',duration)

def letters(n):
    out=''
    while n:n,r=divmod(n-1,26);out=chr(65+r)+out
    return out

def _check(data,plan=None,step=.1,max_samples=12000):
    errors=[];warnings=[];resolved=[]
    def err(code,path,message,time=None):
        v={'code':code,'path':path,'message':message}
        if time is not None:v['time']=round(time,6)
        # Report earliest observation per issue and pair, not thousands of repeats.
        if not any(x['code']==code and x['path']==path for x in errors):errors.append(v)
    def warn(code,message):
        if not any(w['code']==code for w in warnings):warnings.append({'code':code,'message':message})
    def num(v,path,positive=False):
        if not is_number(v) or positive and v<=0:err('number',path,'expected finite '+('positive ' if positive else '')+'number');return False
        return True
    if not isinstance(data,dict):return {'status':'failed','errors':[{'code':'schema','message':'expected object'}]}
    if type(data.get('schema_version')) is not int or data.get('schema_version')!=1:err('schema','schema_version','expected 1')
    if data.get('rect_format')!='xyxy':err('rect_format','rect_format','explicit source-pixel xyxy required')
    if not nonempty(data.get('project_id')):err('project','project_id','required')
    duration=data.get('duration_seconds');canvas=data.get('canvas',{})
    if not num(duration,'duration_seconds',True):duration=0
    width=canvas.get('width');height=canvas.get('height')
    num(width,'canvas.width',True);num(height,'canvas.height',True)
    if not num(step,'sample_step',True) or type(max_samples) is not int or max_samples<=0:
        err('sampling','sampling','positive step and positive integer budget required')
    if errors:return {'status':'failed','errors':errors,'warnings':warnings,'visual_status':'not_run'}
    screen=[0,0,width,height]
    if not isinstance(data.get('sources'),list) or not isinstance(data.get('tracks'),list) or not data.get('tracks'):
        err('collections','sources/tracks','explicit arrays and at least one track required')
        return {'status':'failed','errors':errors,'warnings':warnings,'visual_status':'not_run'}
    sources={};knots={0.0,duration};groups={};track_ids=set()
    def keyframes(frames,path,keys,begin,end):
        if not isinstance(frames,list) or not frames:err('keyframes',path,'nonempty keyframes required');return
        last=-math.inf
        for i,f in enumerate(frames):
            p=f'{path}[{i}]'
            if not isinstance(f,dict):err('keyframe',p,'expected object');continue
            if set(f)-({'time'}|set(keys)):err('unsupported_transform',p,'only declared linear rectangle/scale/translation keys supported')
            t=f.get('time')
            if not num(t,p+'.time') or t<0 or t>duration or t<=last:err('keyframe_time',p,'times must strictly increase within film');continue
            last=t;knots.add(t)
            for k in keys:
                v=f.get(k)
                if k=='rect':
                    if not rect(v):err('rect',p+'.rect','expected finite xyxy rectangle')
                else:num(v,p+'.'+k,k=='scale')
        if any(not isinstance(f,dict) or not is_number(f.get('time')) for f in frames):return
        if frames[0]['time']>begin+EPS or frames[-1]['time']<end-EPS:err('keyframe_coverage',path,'keyframes must cover active interval, no implicit extrapolation')
    def regions(values,path,bounds):
        if not isinstance(values,list):err('regions',path,'explicit region array required');return
        ids=set()
        for i,v in enumerate(values):
            p=f'{path}[{i}]'
            if not isinstance(v,dict):err('region',p,'expected region object');continue
            if not nonempty(v.get('id')) or v['id'] in ids:err('region_id',p,'missing/duplicate region ID')
            ids.add(v.get('id'))
            if not rect(v.get('rect')):err('rect',p,'invalid protected region')
            elif not inside(v['rect'],bounds):err('region_bounds',p,'region outside declared coordinate canvas')
            s,e=v.get('start',0),v.get('end',duration)
            if not is_number(s) or not is_number(e) or not 0<=s<e<=duration:err('region_time',p,'region time must lie within film')
            else:knots.update([s,e])
    for i,s in enumerate(data['sources']):
        p=f'sources[{i}]'
        if not isinstance(s,dict):err('source',p,'expected object');continue
        sid=s.get('id')
        if not nonempty(sid) or sid in sources:err('source_id',p,'missing/duplicate source ID')
        sources[sid]=s
        sw,sh=s.get('width'),s.get('height')
        if not num(sw,p+'.width',True) or not num(sh,p+'.height',True):continue
        bounds=[0,0,sw,sh];crop=s.get('crop_rect',bounds)
        if not rect(crop) or not inside(crop,bounds):err('crop',p+'.crop_rect','crop must stay in original source pixels')
        va,vb=s.get('visible_start',0),s.get('visible_end',duration)
        if not is_number(va) or not is_number(vb) or not 0<=va<vb<=duration:err('source_visibility',p,'source visible interval must lie within film')
        else:knots.update([va,vb])
        tr=s.get('source_to_screen',{})
        if not isinstance(tr,dict) or tr.get('interpolation')!='linear':err('interpolation',p,'only explicit linear interpolation supported');continue
        if set(tr)-{'interpolation','keyframes'}:err('unsupported_transform',p,'rotation, perspective, easing and clipping paths need a separate implementation')
        keyframes(tr.get('keyframes'),p+'.source_to_screen',['scale','translate_x','translate_y'],0,duration)
        regions(s.get('protected_regions'),p+'.protected_regions',bounds)
        if s.get('text_regions_status')!='reviewed':warn('text_coverage_unknown','Text protection is incomplete/unreviewed; geometry cannot certify no text occlusion.')
    regions(data.get('screen_protected_regions'), 'screen_protected_regions',screen)
    for i,t in enumerate(data['tracks']):
        p=f'tracks[{i}]'
        if not isinstance(t,dict):err('track',p,'expected object');continue
        tid=t.get('id')
        if not nonempty(tid) or tid in track_ids:err('track_id',p,'missing/duplicate track ID')
        track_ids.add(tid)
        s=sources.get(t.get('source_id'))
        if not s:err('source_ref',p,'unknown source_id');continue
        a,b=t.get('start'),t.get('end')
        if not is_number(a) or not is_number(b) or not 0<=a<b<=duration:err('track_time',p,'invalid active interval');continue
        if not s.get('visible_start',0)<=a<b<=s.get('visible_end',duration):err('source_visibility',p,'annotation visible while source is absent')
        knots.update([a,b])
        target=t.get('target_rect')
        if not rect(target):err('target_rect',p,'target must use original-source xyxy');continue
        crop=s.get('crop_rect',[0,0,s.get('width',0),s.get('height',0)])
        if rect(crop) and not inside(target,crop):err('target_crop',p,'target lost by crop; split/hide/relayout track, do not shift source target')
        contract=t.get('target_contract',{})
        if not isinstance(contract,dict) or not contract.get('must_include'):err('target_contract',p,'declare complete visual unit with must_include')
        else:
            for k in ('must_include','must_exclude'):
                values=contract.get(k,[])
                if not isinstance(values,list):err('target_contract',p,'include/exclude must be arrays');continue
                for j,v in enumerate(values):
                    path=f'{p}.target_contract.{k}[{j}]'
                    if not isinstance(v,dict) or not nonempty(v.get('id')) or not rect(v.get('rect')):err('target_contract',path,'named xyxy region required');continue
                    if k=='must_include' and not inside(v['rect'],target):err('incomplete_target',path,'target omits a necessary icon/text/container part')
                    if k=='must_exclude' and overlap(v['rect'],target):err('unrelated_target',path,'target includes an unrelated control')
        label=t.get('label',{})
        if not isinstance(label,dict) or not nonempty(label.get('text')):err('label',p,'short user-facing label required');continue
        if label.get('space')!='screen':err('label_space',p,'label must explicitly use output-screen pixels')
        if label.get('role') not in ('action','result','explanation'):err('label_role',p,'declare action/result/explanation')
        keyframes(label.get('keyframes'),p+'.label.keyframes',['rect'],a,b)
        num(label.get('font_size_px'),p+'.label.font_size_px',True)
        num(t.get('frame_stroke_px'),p+'.frame_stroke_px',True)
        rd=t.get('reading_window',{})
        if not isinstance(rd,dict) or not is_number(rd.get('start')) or not is_number(rd.get('end')) or not a<=rd['start']<rd['end']<=b:
            err('reading_window',p,'stable reading window must lie inside active interval')
        else:knots.update([rd['start'],rd['end']])
        if not nonempty(t.get('purpose')):err('purpose',p,'declare the information/action this emphasis serves')
        if t.get('target_geometry')!='static_source':err('tracking_scope',p,'checker supports a static source target transformed with its source; changing UI layout needs remeasured split tracks')
        role=t.get('semantic_role');marker=t.get('marker',{})
        if not isinstance(marker,dict):err('marker',p,'marker must be object');continue
        allowed={'single':{'none','auto'},'sequence':{'number','auto'},'alternative':{'letter','auto'}}
        if role not in allowed or marker.get('kind') not in allowed.get(role,set()):err('marker_semantics',p,'single has no number; sequence uses number; alternative uses letter')
        if role in ('sequence','alternative'):
            group=t.get('group_id');idx=t.get('index')
            if not nonempty(group) or type(idx) is not int or idx<=0:err('marker_group',p,'explicit group_id and positive index required')
            else:
                groups.setdefault((role,group),[]).append((idx,a))
                expected=str(idx) if role=='sequence' else letters(idx)
                if str(marker.get('value',''))!=expected:err('marker_value',p,'marker must match semantic index')
            if not rect(marker.get('rect')):err('marker_rect',p,'number/letter needs resolved screen rectangle')
        elif marker.get('value') not in (None,'') or marker.get('rect') is not None:err('single_marker',p,'single point must not carry a marker value/rectangle')
        connector=t.get('connector')
        if not isinstance(connector,dict) or type(connector.get('enabled')) is not bool:
            err('connector',p,'declare connector.enabled; use false for a directly attached label')
        else:
            num(connector.get('max_gap_px'),p+'.connector.max_gap_px',True)
            if connector['enabled']:
                num(connector.get('stroke_width_px'),p+'.connector.stroke_width_px',True)
    for key,indices in groups.items():
        nums=sorted(x[0] for x in indices)
        if nums!=list(range(1,len(nums)+1)):err('marker_sequence',str(key),'numbers/letters must be unique and continuous per semantic group')
        if key[0]=='sequence' and [x[0] for x in sorted(indices,key=lambda x:x[1])]!=list(range(1,len(nums)+1)):
            err('temporal_sequence',str(key),'numbering contradicts actual time order')
    read=data.get('readability',{})
    if not isinstance(read,dict) or not is_number(read.get('view_width_px')) or read['view_width_px']<=0 or not is_number(read.get('minimum_label_px')) or read['minimum_label_px']<=0:
        err('readability','readability','declare intended display width and project-specific minimum label size')
    elif any(isinstance(t,dict) and is_number(t.get('label',{}).get('font_size_px')) and t['label']['font_size_px']*read['view_width_px']/width<read['minimum_label_px'] for t in data['tracks']):
        err('readability','readability','label below chosen minimum at intended display width')
    if plan is not None:
        out=plan.get('output',{})
        if plan.get('project_id')!=data.get('project_id') or out.get('width')!=width or out.get('height')!=height or out.get('duration_seconds')!=duration:
            err('plan_mismatch','plan','project/canvas/duration must match film plan')
        scenes={s['id']:s for s in plan.get('scenes',[])}
        for i,t in enumerate(data['tracks']):
            scene=scenes.get(t.get('scene_id'))
            if not scene or t.get('element_id') not in [x.get('id') for x in scene.get('elements',[])]:err('plan_ref',f'tracks[{i}]','scene_id/element_id must resolve')
            elif not scene['start']<=t.get('start',-1)<t.get('end',duration+1)<=scene['end']:err('scene_range',f'tracks[{i}]','annotation outside its scene')
    if errors:return {'status':'failed','errors':errors,'warnings':warnings,'visual_status':'not_run','playback_status':'not_run'}
    count=math.ceil(duration/step)+1
    if count+len(knots)*3>max_samples:
        err('sample_budget','sampling','sample budget exceeded; split requested film range, do not silently skip times')
        return {'status':'failed','errors':errors,'warnings':warnings,'visual_status':'not_run'}
    times={min(duration,i*step) for i in range(count)}|knots
    for k in list(knots):times.update([max(0,k-1e-6),min(duration,k+1e-6)])
    for time in sorted(times):
        active=[];protected=[(r['id'],r['rect']) for r in data['screen_protected_regions'] if region_active(r,time,duration)]
        transforms={sid:interpolate(s['source_to_screen']['keyframes'],time,['scale','translate_x','translate_y']) for sid,s in sources.items()}
        for sid,s in sources.items():
            if not s.get('visible_start',0)<=time<s.get('visible_end',duration):continue
            crop=s.get('crop_rect',[0,0,s['width'],s['height']])
            for r in s['protected_regions']:
                visible_rect=clipped(r['rect'],crop)
                if visible_rect and region_active(r,time,duration):protected.append((sid+'/'+r['id'],project(visible_rect,transforms[sid])))
        for i,t in enumerate(data['tracks']):
            if not t['start']<=time<t['end']:continue
            p='tracks/'+t['id'];target=project(t['target_rect'],transforms[t['source_id']]);label=interpolate(t['label']['keyframes'],time,['rect'])['rect'];marker=t['marker'].get('rect')
            if not inside(inflate(target,t['frame_stroke_px']/2),screen):err('target_offscreen',p,'hide/split/relayout emphasis before target leaves frame',time)
            if not inside(label,screen):err('label_offscreen',p,'label exceeds final video canvas',time)
            if marker and not inside(marker,screen):err('marker_offscreen',p,'marker exceeds final video canvas',time)
            for rid,r in protected:
                if overlap(label,r):err('label_protected',p+'/'+rid,'label covers protected text/content',time)
                if marker and overlap(marker,r):err('marker_protected',p+'/'+rid,'marker covers protected text/content',time)
                if stroke_overlaps(target,r,t['frame_stroke_px']):err('frame_protected',p+'/'+rid,'frame stroke crosses protected text/content',time)
            line_a,line_b=connector_points(target,label)
            gap=math.dist(line_a,line_b)
            if gap>t['connector']['max_gap_px']:
                err('detached_label',p,'label is too far from its target for project attachment limit',time)
            if t['connector']['enabled']:
                for rid,r in protected:
                    if segment_hits(line_a,line_b,inflate(r,t['connector']['stroke_width_px']/2)):
                        err('connector_protected',p+'/'+rid,'leader line crosses protected content',time)
            if marker and overlap(marker,label):err('marker_label',p,'marker collides with its label',time)
            active.append((t,target,label,marker))
            if time in knots:resolved.append({'time':round(time,6),'track_id':t['id'],'target_rect':target,'label_rect':label,'marker_rect':marker,'connector':{'enabled':t['connector']['enabled'],'from':line_a,'to':line_b}})
        for i,(t,target,label,marker) in enumerate(active):
            for other,ot,ol,om in active[i+1:]:
                path='tracks/'+t['id']+'/'+other['id']
                if overlap(label,ol) or marker and overlap(marker,ol) or om and overlap(label,om) or marker and om and overlap(marker,om):err('callout_collision',path,'labels/markers collide',time)
                if overlap(label,ot) or overlap(ol,target):err('unrelated_target_cover',path,'label covers another emphasis target',time)
    warn('sampled_only','Only explicit linear geometry at listed sample times was checked; this is not all-frame tracking or rendered glyph verification.')
    warn('review_required','Open actual first/mid/extreme/transition frames, crops and continuous video at final viewing size. Semantic accuracy, privacy, text shaping and aesthetics remain unverified.')
    return {'schema_version':1,'status':'failed' if errors else 'awaiting_visual_review',
        'geometry_status':'failed' if errors else 'sampled_checks_passed','errors':errors,'warnings':warnings,
        'visual_status':'not_run','playback_status':'not_run','source_asset_status':'not_checked','tracking_implemented':False,
        'sampling':{'step_seconds':step,'sample_count':len(times),'max_samples':max_samples,'method':'uniform samples + keyframes/visibility/reading boundaries and adjacent instants'},
        'resolved_keyframes':resolved}

def check(data,plan=None,step=.1,max_samples=12000):
    try:return _check(data,plan,step,max_samples)
    except (AttributeError,IndexError,TypeError,ValueError,OverflowError) as e:
        return {'status':'failed','errors':[{'code':'malformed_input','message':str(e)}],
            'visual_status':'not_run','playback_status':'not_run'}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('track');p.add_argument('--plan')
    p.add_argument('--sample-step',type=float,default=.1);p.add_argument('--max-samples',type=int,default=12000);p.add_argument('--output')
    a=p.parse_args()
    try:
        result=check(load_json(a.track),load_json(a.plan) if a.plan else None,a.sample_step,a.max_samples)
        result['input_sha256']=sha256(a.track)
        if a.plan:result['plan_sha256']=sha256(a.plan)
    except (OSError,ValueError,KeyError,TypeError,OverflowError) as e:
        result={'status':'failed','errors':[{'code':'input','message':str(e)}],'visual_status':'not_run'}
    text=json.dumps(result,ensure_ascii=False,indent=2)
    if a.output:Path(a.output).write_text(text+'\n',encoding='utf-8')
    print(text);return 2 if result['status']=='failed' else 0

if __name__=='__main__':raise SystemExit(main())
