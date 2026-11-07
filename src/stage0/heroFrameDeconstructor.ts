import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { extractTokenFingerprint } from '../decomp/token_fingerprinter.ts';
import { traceAsset } from '../decomp/svg_tracer.ts';
import { computeSSIM } from '../vision/perceptual.mjs';
import { fitCurve } from '../math/curveFitter.ts';

export const STAGE0_LIMITS = Object.freeze({maxFrames:64,maxPixels:1048576,maxLayers:8,maxDurationSec:8});
export const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
export const hashJson = value => hashBytes(JSON.stringify(value));
export const hexColor = rgb => '#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('');
export async function writeJson(file,value){await fs.writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
const fail = message => {throw new Error(message);};

/** Narrow, exact palette geometry. No OCR, guessed fonts, hidden layers or soft mattes. */
export function measureSolidScene(image) {
  const {width:w,height:h,data}=image;
  if(w<8||h<8||w*h>STAGE0_LIMITS.maxPixels||data?.length!==w*h*4)fail('STAGE0_DIMENSIONS');
  const keyAt=i=>`${data[i*4]},${data[i*4+1]},${data[i*4+2]}`;
  const bg=keyAt(0), regions=new Map();
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,key=keyAt(i);
    if(data[i*4+3]!==255)fail('STAGE0_AMBIGUOUS_ALPHA');
    if((x===0||y===0||x===w-1||y===h-1)&&key!==bg)fail('STAGE0_OCCLUDED_OR_NONUNIFORM_BORDER');
    if(key===bg)continue;
    if(!regions.has(key)){if(regions.size>=STAGE0_LIMITS.maxLayers)fail('STAGE0_AMBIGUOUS_PALETTE_GRADIENT_OR_COMPRESSION');regions.set(key,{x,y,right:x,bottom:y,count:0});}
    const b=regions.get(key); b.x=Math.min(b.x,x);b.y=Math.min(b.y,y);b.right=Math.max(b.right,x);b.bottom=Math.max(b.bottom,y);b.count++;
  }
  if(!regions.size)fail('STAGE0_NO_FOREGROUND');
  const layers=[...regions].sort(([a],[b])=>a.localeCompare(b,'en')).map(([key,b],i)=>{
    const box={x:b.x,y:b.y,width:b.right-b.x+1,height:b.bottom-b.y+1};
    if(b.count!==box.width*box.height || b.count<16)fail('STAGE0_AMBIGUOUS_SHAPE_TEXT_OVERLAP_OR_VECTOR: only isolated solid rectangles are qualified');
    return {layerId:`layer_${i+1}`,color:key.split(',').map(Number),box,radius:0,kind:'rectangle'};
  });
  return {background:bg.split(',').map(Number),layers};
}
/** Independent geometry raster, NOT a copied reference frame. Pixel-center coverage. */
export function rasterizeScene(width,height,background,layers) {
  const out=new PNG({width,height});
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let color=background;
    for(const l of layers)if(x+.5>=l.box.x&&x+.5<l.box.x+l.box.width&&y+.5>=l.box.y&&y+.5<l.box.y+l.box.height)color=l.color;
    const i=(y*width+x)*4;out.data[i]=color[0];out.data[i+1]=color[1];out.data[i+2]=color[2];out.data[i+3]=255;
  }
  return out;
}
export function adjacentMotion(a,b){let sum=0;for(let i=0;i<a.data.length;i++)if(i%4!==3)sum+=Math.abs(a.data[i]-b.data[i]);return sum/(a.width*a.height*3*255);}

/** One contiguous beat only. Both adjacent differences count, including at t0. */
export function selectHero(frames) {
  if(frames.length<4||frames.length>64)fail('STAGE0_FRAME_BUDGET: need 4..64 native frames');
  const diffs=frames.slice(1).map((f,i)=>adjacentMotion(frames[i].image,f.image));
  const candidates=[];
  for(let i=0;i<frames.length;i++){
    try {candidates.push({index:i,motion:Math.max(diffs[i-1]??diffs[0],diffs[i]??diffs.at(-1)),scene:measureSolidScene(frames[i].image)});}catch{/* ineligible occluded/ambiguous hero */}
  }
  candidates.sort((a,b)=>a.motion-b.motion||b.index-a.index);
  if(!candidates.length)fail('STAGE0_NO_UNOCCLUDED_SOLID_HERO');
  return candidates[0];
}

/**
 * Stage0 candidate static measurement only: pick the least-motion unoccluded
 * frame and prove it against an independent geometry raster. This is a LOCAL
 * synthetic gate, not a Stallion render. No tracking, curve fitting or Stage1
 * claim happens here; those wait for the verified static batch gate at compile.
 */
export function measureHeroCandidate(frames) {
  const hero=selectHero(frames), image=frames[hero.index].image;
  const reconstruction=rasterizeScene(image.width,image.height,hero.scene.background,hero.scene.layers);
  const ssim=computeSSIM(image,reconstruction);
  if(ssim<.99)fail('HERO_GATE_FAILED: Stage1 not run');
  return {heroFrame:hero.index,heroMotion:hero.motion,heroSsim:ssim,heroMethod:'independent solid-geometry raster; global grayscale SSIM (not Cavalry)',background:hero.scene.background,layers:hero.scene.layers,stage1Ran:false,stage1Status:'pending-static-batch-gate',staticScene:null,detectedBeats:null,layerTrajectories:null,reconstruction};
}

/** Stage1 tracking. Callers must own a verified static gate before animating. */
export function analyzeFrames(frames) {
  const candidate=measureHeroCandidate(frames);
  const {heroFrame,background,layers,reconstruction}=candidate;
  const scenes=frames.map(f=>measureSolidScene(f.image));
  for(const scene of scenes){
    if(hashJson(scene.background)!==hashJson(background)||scene.layers.length!==layers.length)fail('STAGE1_CUT_OR_OCCLUSION');
    for(let i=0;i<layers.length;i++)if(hashJson(scene.layers[i].color)!==hashJson(layers[i].color)||scene.layers[i].box.width!==layers[i].box.width||scene.layers[i].box.height!==layers[i].box.height)fail('STAGE1_UNSUPPORTED_SCALE_COLOR_OR_OCCLUSION');
  }
  const heroScene={background,layers};
  const staticScene=scenes.every(s=>hashJson(s)===hashJson(heroScene));
  // A static dispatch does not run tracking or curve fitting.
  const measured=layers.map((layer,i)=>{
    const boxes=scenes.map(s=>s.layers[i].box);
    if(boxes.every(b=>hashJson(b)===hashJson(boxes[0])))return {...layer,rig:'static',boxes};
    const axes={};
    for(const axis of ['x','y']){
      const values=boxes.map(b=>b[axis]);
      if(values.every(v=>v===values[0]))continue;
      const curve=fitCurve(values.map((y,t)=>({t,y})));
      if(!curve.accepted)fail(`STAGE1_CURVE_FIT_FAILED: ${layer.layerId}.${axis}, rmse=${curve.rmse}`);
      axes[axis]={from:values[0],to:values.at(-1),curve};
    }
    return {...layer,rig:'translation',motionId:`motion_${layer.layerId}`,boxes,axes};
  });
  const speeds=frames.map((_,f)=>f===0?0:Math.max(...measured.map(l=>Math.hypot(l.boxes[f].x-l.boxes[f-1].x,l.boxes[f].y-l.boxes[f-1].y))));
  const peakVelocity=speeds.indexOf(Math.max(...speeds));
  const peaks=measured.flatMap(l=>Object.values(l.axes??{}).map(a=>a.curve.overshootPeak)).sort((a,b)=>b.value-a.value);
  return {heroFrame,heroMotion:candidate.heroMotion,heroSsim:candidate.heroSsim,heroMethod:candidate.heroMethod,staticScene,stage1Ran:!staticScene,background,layers:measured,criticalFrames:{start:0,peakVelocity,overshoot:peaks[0]?.value>0?peaks[0].t:frames.length-1,settle:frames.length-1},reconstruction};
}

/** Decode native frames and PTS, refusing VFR/resampling instead of inventing timestamps. */
export async function decodeReference(input,jobDir) {
  const sourcePath=path.resolve(input.videoPath), sourceBytes=await fs.readFile(sourcePath);
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_streams','-show_format','-of','json',sourcePath],{maxBuffer:4*1024*1024,timeout:20000}).toString());
  const s=probe.streams?.[0];if(!s)fail('STAGE0_NO_VIDEO_STREAM');
  const rate=value=>{const [a,b]=String(value).split('/').map(Number);return a/(b??1);};
  const fps=rate(s.avg_frame_rate), width=s.width,height=s.height,duration=Number(s.duration??probe.format?.duration);
  if(!Number.isFinite(fps)||fps<=0||fps>120||!Number.isFinite(duration)||duration<=0||duration>8||width*height>STAGE0_LIMITS.maxPixels)fail('STAGE0_SOURCE_BUDGET: <=8 sec, <=1M pixels, <=120 fps');
  if(input.fps!=null && (!Number.isFinite(input.fps)||Math.abs(input.fps-fps)>1e-6))fail('STAGE0_RESAMPLING_UNSUPPORTED: fps must equal native rate');
  const start=input.startSec??0,end=input.endSec??duration;
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>duration+1/fps||(end-start)*fps>64.01)fail('STAGE0_RANGE_BUDGET');
  const detail=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',sourcePath],{maxBuffer:4*1024*1024,timeout:20000}).toString());
  const timestamps=detail.frames.map(f=>Number(f.best_effort_timestamp_time));
  const selected=timestamps.map((time,index)=>({time,index})).filter(f=>f.time>=start-1e-7&&f.time<end-1e-7);
  if(selected.length<4||selected.length>64)fail('STAGE0_FRAME_BUDGET');
  for(let i=0;i<selected.length;i++)if(!Number.isFinite(selected[i].time)||(i>0&&Math.abs(selected[i].time-selected[i-1].time-1/fps)>1e-4))fail('STAGE0_VFR_UNSUPPORTED');
  const framesDir=path.join(jobDir,'frames');await fs.mkdir(framesDir);
  execFileSync('ffmpeg',['-v','error','-nostdin','-i',sourcePath,'-map','0:v:0','-vf',`select=between(n\\,${selected[0].index}\\,${selected.at(-1).index})`,'-fps_mode','passthrough','-frames:v',String(selected.length),path.join(framesDir,'%04d.png')],{timeout:60000,maxBuffer:4*1024*1024});
  const frames=[];
  for(let i=0;i<selected.length;i++){
    const file=path.join(framesDir,`${String(i+1).padStart(4,'0')}.png`),bytes=await fs.readFile(file),image=PNG.sync.read(bytes);
    if(image.width!==width||image.height!==height)fail('STAGE0_ROTATION_OR_DIMENSION_MISMATCH');
    frames.push({frame:i,sourceFrame:selected[i].index,timestamp:selected[i].time,path:file,sha256:hashBytes(bytes),image});
  }
  return {source:{path:sourcePath,sha256:hashBytes(sourceBytes)},media:{width,height,fps,startSec:start,endSec:end,timestamps:selected.map(f=>f.time)},frames};
}

export async function heroFrameDeconstructor(input) {
  if(!input||typeof input.videoPath!=='string')fail('STAGE0_VIDEO_PATH_REQUIRED');
  const root=path.resolve(input.outputDir??path.join(process.cwd(),'.refclone-cache'));await fs.mkdir(root,{recursive:true});
  const sourceHash=hashBytes(await fs.readFile(path.resolve(input.videoPath)));
  const jobDir=await fs.mkdtemp(path.join(root,`strict-${sourceHash.slice(0,16)}-`));
  try {
    const decoded=await decodeReference(input,jobDir),candidate=measureHeroCandidate(decoded.frames),hero=decoded.frames[candidate.heroFrame];
    const heroRasterPath=path.join(jobDir,'hero-reconstruction.png');await fs.writeFile(heroRasterPath,PNG.sync.write(candidate.reconstruction),{flag:'wx'});
    const assets=[];
    for(const layer of candidate.layers){
      const fingerprint=extractTokenFingerprint(hero.image,layer.box);
      const traced=await traceAsset({assetId:layer.layerId,raster:hero.image,box:layer.box,sourceFrame:hero.sourceFrame,options:{outDir:path.join(jobDir,'assets'),backgroundColor:candidate.background,backgroundTolerance:0,alsoPng:true}});
      if('reason' in traced)fail(`STAGE0_ASSET_TRACE_FAILED: ${traced.reason}`);
      assets.push({...traced,sha256:hashBytes(await fs.readFile(traced.file)),fingerprint});
    }
    const {reconstruction,...measurements}=candidate;
    const artifact={version:'strict-inspection/1.0',source:decoded.source,media:decoded.media,frames:decoded.frames.map(({image,...f})=>f),measurements,heroRaster:{path:heroRasterPath,sha256:hashBytes(await fs.readFile(heroRasterPath))},assets,uncertainties:['Only isolated opaque, exact-color rectangles and one contiguous beat are qualified.','Fonts, gradients, antialiasing, occlusion, scaling, cuts and arbitrary vectors are not inferred.','SVG traces are provenance evidence, not a qualified editable-vector fidelity route.','Hero lock is local synthetic geometry, not live Cavalry evidence.','Stage1 tracking and beats stay pending until the compile-time static batch gate passes; inspection never claims them.']};
    const inspectionPath=path.join(jobDir,`inspection-${hashJson(artifact)}.json`);await writeJson(inspectionPath,artifact);
    const heroFrameSpec={frame:candidate.heroFrame,sourceFrame:hero.sourceFrame,timestamp:hero.timestamp,path:hero.path,sha256:hero.sha256,ssim:candidate.heroSsim,motion:candidate.heroMotion,method:candidate.heroMethod,background:candidate.background,layers:candidate.layers.map(l=>({layerId:l.layerId,color:l.color,box:l.box}))};
    return {ok:true,status:'inspected',inspectionPath,heroPath:hero.path,heroReconstructionPath:heroRasterPath,jobDir,stage1Ran:false,stage1Status:'pending-static-batch-gate',staticScene:null,recommendedPresetPacks:[],detectedBeats:null,heroFrameSpec,layerTrajectories:null,layers:candidate.layers.map(l=>({layerId:l.layerId,color:l.color,box:l.box,rig:null,motionId:null})),tokens:{local:0,stage2Caller:null},limitations:artifact.uncertainties};
  }catch(error){const reportPath=path.join(jobDir,'blocked.json');const report={ok:false,status:'blocked',reason:String(error.message??error),jobDir,reportPath,stage1Ran:false,stage1Status:'not-run',recommendedPresetPacks:[],detectedBeats:null,heroFrameSpec:null,layerTrajectories:null,tokens:{local:0,stage2Caller:null}};await writeJson(reportPath,report);return report;}
}
