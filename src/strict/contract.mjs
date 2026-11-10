import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { analyzeFrames, measureHeroCandidate, hashBytes, hashJson, hexColor } from '../stage0/heroFrameDeconstructor.ts';

const fail = message => {throw new Error(message);};
export function exactKeys(value, allowed, label) {
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(`${label}: object required`);
  for(const k of Object.keys(value))if(!allowed.includes(k))fail(`${label}: unsupported field ${k}`);
}
export async function loadCore() {
  let core;
  try{core=await import('cavalry-mcp/core');}catch(e){fail(`CORE_UNAVAILABLE: cavalry-mcp/core (${e.code??e.message})`);}
  for(const k of ['compileMgDsl','MG_HELPERS_SOURCE','MG_MANIFEST_RUNTIME','PRESET_PACKS'])if(core[k]==null)fail(`CORE_CONTRACT_MISSING: ${k}`);
  return core;
}
async function checkedFile(file,hash){
  if(typeof file!=='string'||!path.isAbsolute(file)||!/^[a-f0-9]{64}$/.test(hash))fail('INSPECTION_FILE_RECORD_INVALID');
  const bytes=await fs.readFile(file);if(hashBytes(bytes)!==hash)fail(`INSPECTION_HASH_MISMATCH: ${file}`);return bytes;
}

/** Inspection flags/coordinates are never trusted; replay CV from hash-bound pixels. */
export async function loadInspection(inspectionPath) {
  if(typeof inspectionPath!=='string'||!path.isAbsolute(inspectionPath))fail('INSPECTION_ABSOLUTE_PATH_REQUIRED');
  const bytes=await fs.readFile(inspectionPath);if(bytes.length>2*1024*1024)fail('INSPECTION_TOO_LARGE');
  const artifact=JSON.parse(bytes);
  if(artifact.version!=='strict-inspection/1.0'||path.basename(inspectionPath)!==`inspection-${hashJson(artifact)}.json`)fail('INSPECTION_SEAL_MISMATCH');
  await checkedFile(artifact.source?.path,artifact.source?.sha256);
  if(!Array.isArray(artifact.frames)||artifact.frames.length<4||artifact.frames.length>64)fail('INSPECTION_FRAME_COVERAGE');
  const m=artifact.media;
  if(!m||!Number.isInteger(m.width)||!Number.isInteger(m.height)||m.width<8||m.height<8||m.width*m.height>1048576||!Number.isFinite(m.fps)||m.fps<=0||m.fps>120)fail('INSPECTION_MEDIA_INVALID');
  const frames=[];
  const used=new Set();
  for(let i=0;i<artifact.frames.length;i++){
    const f=artifact.frames[i];
    if(f.frame!==i||!Number.isFinite(f.timestamp)||used.has(f.path)||!Number.isInteger(f.sourceFrame)||(i>0&&(f.sourceFrame!==artifact.frames[i-1].sourceFrame+1||Math.abs(f.timestamp-artifact.frames[i-1].timestamp-1/m.fps)>1e-4)))fail('INSPECTION_TIMESTAMPS_INVALID');
    used.add(f.path);
    const image=PNG.sync.read(await checkedFile(f.path,f.sha256));
    if(image.width!==m.width||image.height!==m.height)fail('INSPECTION_DIMENSIONS');
    frames.push({...f,image});
  }
  if(!Array.isArray(artifact.assets)||!artifact.assets.length)fail('INSPECTION_ASSETS_MISSING');
  for(const asset of artifact.assets)await checkedFile(asset.file,asset.sha256);
  await checkedFile(artifact.heroRaster?.path,artifact.heroRaster?.sha256);
  // Inspection seals only the Stage0 candidate static measurement. Replay it
  // from hash-bound pixels; tracks/beats are never trusted from the artifact.
  const candidate=measureHeroCandidate(frames),{reconstruction,...measurements}=candidate;
  if(hashJson(measurements)!==hashJson(artifact.measurements))fail('INSPECTION_MEASUREMENTS_CHANGED_OR_HERO_UNLOCKED');
  if(hashBytes(PNG.sync.write(reconstruction))!==artifact.heroRaster.sha256)fail('INSPECTION_HERO_RECONSTRUCTION_CHANGED');
  return {artifact,candidate,frames};
}

/** BeatSpec v1: semantic routing only. No params, coordinates, code or lock flag. */
export function validateBeatShape(beatSpec) {
  exactKeys(beatSpec,['version','inspectionPath','layers'],'BEATSPEC');
  if(beatSpec.version!=='1.0'||typeof beatSpec.inspectionPath!=='string'||!Array.isArray(beatSpec.layers)||beatSpec.layers.length<1||beatSpec.layers.length>8)fail('BEATSPEC_SCHEMA');
  const seen=new Set();
  for(const l of beatSpec.layers){
    exactKeys(l,['layerId','rig','motionId','presetId'],'BEATSPEC_LAYER');
    if(typeof l.layerId!=='string'||!/^layer_[1-8]$/.test(l.layerId)||seen.has(l.layerId)||!['static','translation'].includes(l.rig))fail('BEATSPEC_DUPLICATE_UNKNOWN_OR_INVALID_LAYER');
    seen.add(l.layerId);
    if(l.motionId!=null&&typeof l.motionId!=='string')fail('BEATSPEC_MOTION_ID');
    if(l.presetId!=null&&typeof l.presetId!=='string')fail('BEATSPEC_PRESET_ID');
  }
}

/** All data in this manifest is measured; correction offsets are bounded local residuals. */
export function measuredManifest(artifact,analysis,{staticOnly=false,corrections={}}={}) {
  const {width,height}=artifact.media;
  const pos=(box)=>({'position.x':box.x+box.width/2-width/2,'position.y':height/2-box.y-box.height/2});
  const layers=analysis.layers.map(l=>{
    const c=corrections[l.layerId]??{x:0,y:0};
    if(!Number.isFinite(c.x)||!Number.isFinite(c.y)||Math.abs(c.x)>2||Math.abs(c.y)>2)fail('CORRECTION_BUDGET');
    const box=staticOnly?l.box:l.boxes[0];
    return {as:l.layerId,kind:'shape',shape:'rectangle',name:l.layerId,attrs:{'generator.dimensions':{x:box.width,y:box.height},'material.materialColor':hexColor(l.color),...pos({...box,x:box.x+c.x,y:box.y+c.y})}};
  });
  const ops=[];
  if(!staticOnly)for(const l of analysis.layers)for(const [axis,a] of Object.entries(l.axes??{})){
    const sign=axis==='x'?1:-1, base=axis==='x'?l.box.width/2-width/2:height/2-l.box.height/2;
    const attr=`position.${axis}`, correction=corrections[l.layerId]?.[axis]??0;
    ops.push({op:'keyframe',target:`$${l.layerId}`,frames:[{frame:0,attrs:{[attr]:base+sign*(a.from+correction)}},{frame:artifact.frames.length-1,attrs:{[attr]:base+sign*(a.to+correction)}}]});
    ops.push({op:'easing',target:`$${l.layerId}`,attr,frame:0,easing:'Custom',expression:a.curve.expression});
  }
  return {layers,ops};
}

/** Fail closed: the only accepted language is the exact generated semantic tree. */
export function validateGeneratedManifest(manifest,expected) {
  exactKeys(manifest,['layers','ops'],'MANIFEST');
  if(hashJson(manifest)!==hashJson(expected))fail('MANIFEST_NOT_MEASURED: unknown attributes, expressions, layer or operation');
  if(!Array.isArray(manifest.layers)||manifest.layers.length<1||!Array.isArray(manifest.ops))fail('MANIFEST_COVERAGE');
  return true;
}
export function assertCompilerResult(result) {
  if(!result||result.ok!==true||!Array.isArray(result.ops)||!Array.isArray(result.errors)||result.errors.length||result.ops.some(o=>o.ok!==true))fail('COMPILER_NESTED_FAILURE');
}

export async function prepareStrict(beatSpec) {
  validateBeatShape(beatSpec);
  const loaded=await loadInspection(beatSpec.inspectionPath),{artifact,candidate,frames}=loaded;
  if(beatSpec.layers.length!==candidate.layers.length)fail('BEATSPEC_MISSING_LAYER');
  for(const route of beatSpec.layers)if(!candidate.layers.some(l=>l.layerId===route.layerId))fail(`BEATSPEC_UNMEASURED_LAYER: ${route.layerId}`);
  const core=await loadCore();
  const registry=core.PRESET_PACKS.flatMap(pack=>pack.presets);
  for(const route of beatSpec.layers)if(route.presetId!=null){
    if(!registry.some(p=>p.id===route.presetId))fail(`PRESET_UNKNOWN: ${route.presetId}`);
    // Registry availability is not fidelity qualification. These packs add text,
    // default geometry/deformers; none is equivalent to the supported solid rig.
    fail(`PRESET_FIDELITY_UNSUPPORTED: ${route.presetId}; use the measured static/translation rig without presetId`);
  }
  // Only the static candidate manifest exists before the host static gate.
  const manifest=measuredManifest(artifact,candidate,{staticOnly:true});validateGeneratedManifest(manifest,measuredManifest(artifact,candidate,{staticOnly:true}));
  return {...loaded,core,manifest};
}

/**
 * Stage1 tracking + route verification. The caller MUST have passed the verified
 * static batch gate first (compileAndConverge), or be a zero-HTTP local validator
 * (validateStage35). Tracks are re-measured from sealed pixels, never read from
 * the inspection artifact, and the animation manifest is hash-bound to them.
 */
export function unlockStage1(prepared,beatSpec) {
  const {artifact,frames}=prepared;
  const analysis=analyzeFrames(frames);
  if(beatSpec.layers.length!==analysis.layers.length)fail('BEATSPEC_MISSING_LAYER');
  for(const route of beatSpec.layers){
    const measured=analysis.layers.find(l=>l.layerId===route.layerId);
    if(!measured||route.rig!==measured.rig||(route.motionId??null)!==(measured.motionId??null))fail(`BEATSPEC_UNMEASURED_RIG_OR_MOTION: ${route.layerId}`);
  }
  const manifest=measuredManifest(artifact,analysis);validateGeneratedManifest(manifest,measuredManifest(artifact,analysis));
  return {...prepared,analysis,manifest};
}

export async function validateStage35(input) {
  try {
    let payload=input;
    if(input?.tool_name!=null||input?.toolName!=null){
      const name=input.tool_name??input.toolName;
      if(typeof name!=='string')fail('HOOK_TOOL_NAME');
      if(!/^(?:cavalry|refclone)_.*(?:compile|converge|clone_beat|exec_mg)/.test(name))return {ok:true,status:'irrelevant'};
      payload=input.tool_input??input.toolInput??input.arguments;
      if(typeof payload==='string')payload=JSON.parse(payload);
    }
    let beatSpec=payload;
    if(payload?.beatSpec!=null){exactKeys(payload,['beatSpec','outputDir','maxIterations'],'STRICT_COMPILE');beatSpec=payload.beatSpec;validateRunOptions(payload);}
    const prepared=unlockStage1(await prepareStrict(beatSpec),beatSpec);
    // Exercise generated JS in a local contract harness. No HTTP or host API.
    const {compileCandidate,exerciseCandidate}=await import('./execution.mjs');
    const code=compileCandidate(prepared,{jobName:'validation',staticOnly:false});
    exerciseCandidate(code,prepared);
    return {ok:true,status:'valid',inspectionPath:beatSpec.inspectionPath,manifestHash:hashJson(prepared.manifest),stage1Ran:prepared.analysis.stage1Ran,hostStaticGate:'not-run (local contract validation only)',tokens:{local:0,stage2Caller:null}};
  }catch(error){return {ok:false,status:'blocked',reason:String(error.message??error)};}
}
export function validateRunOptions(input){
  if(input.outputDir!=null&&(typeof input.outputDir!=='string'||!input.outputDir))fail('OUTPUT_DIRECTORY_INVALID');
  if(input.maxIterations!=null&&(!Number.isInteger(input.maxIterations)||input.maxIterations<1||input.maxIterations>8))fail('ITERATION_BUDGET: 1..8');
}
