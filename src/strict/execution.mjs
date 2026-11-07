import vm from 'node:vm';
import { PNG } from 'pngjs';
import { assertCompilerResult, measuredManifest, validateGeneratedManifest } from './contract.mjs';
import { hexColor } from '../stage0/heroFrameDeconstructor.ts';

const mockClients=new WeakSet();
/** Internal test transport registry. A caller-provided `mock`/`live` flag is not evidence. */
export function registerMockClient(client){mockClients.add(client);return client;}
export function isMockClient(client){return mockClients.has(client);}

export function compileCandidate(prepared,{jobName,staticOnly=false,corrections={},rollbackStrategy='undo'}={}) {
  const {artifact,core}=prepared;
  if(rollbackStrategy!=='undo'&&rollbackStrategy!=='checkpoint')throw new Error('INVALID_ROLLBACK_STRATEGY: '+rollbackStrategy);
  // Before the host static gate only the Stage0 candidate exists; the animated
  // manifest requires the unlocked, re-measured Stage1 analysis.
  const scene=staticOnly?prepared.candidate:prepared.analysis;
  if(!scene)throw new Error('STAGE1_LOCKED: animated manifest requested before the static batch gate');
  const manifest=measuredManifest(artifact,scene,{staticOnly,corrections});
  validateGeneratedManifest(manifest,measuredManifest(artifact,scene,{staticOnly,corrections}));
  const compiled=core.compileMgDsl(manifest);
  if(typeof compiled!=='string'||!compiled.trim())throw new Error('COMPILER_OUTPUT_INVALID');
  const m=artifact.media;
  // The checkpoint contract replaces the api.undo requirement with the verified
  // save/openScene surface; the batch host (not this code) drives the restore.
  const baseRequired=['createComp','setActiveComp','getActiveComp','getCompLayers','set','setInFrame','setOutFrame','primitive','keyframe','magicEasing'];
  const required=rollbackStrategy==='checkpoint'?[...baseRequired,'saveSceneAs','openScene','getSceneFilePath','sceneHasUnsavedChanges']:['undo',...baseRequired];
  const code=`(function(){
var required=${JSON.stringify(required)};
for(var i=0;i<required.length;i++)if(typeof api[required[i]]!=='function')throw new Error('SAFE_HOST_API_UNAVAILABLE: '+required[i]);
var comp=api.createComp(${JSON.stringify(jobName)});
if(typeof comp!=='string'||!comp)throw new Error('JOB_COMP_CREATION_FAILED');
api.setActiveComp(comp);
if(api.getActiveComp()!==comp||api.getCompLayers(true).length)throw new Error('JOB_COMP_NOT_EMPTY');
api.set(comp,{'resolution.x':${m.width},'resolution.y':${m.height},fps:${m.fps},backgroundColor:${JSON.stringify(hexColor(scene.background))}});
// Live-verified Cavalry 2.8: setInFrame/setOutFrame on a composition leave its
// range unchanged; the startFrame/endFrame attributes are authoritative.
api.set(comp,{'startFrame':0,'endFrame':${artifact.frames.length-1}});
globalThis.__mgAliases={};globalThis.__refcloneLayerMap={};
${core.MG_HELPERS_SOURCE}
${core.MG_MANIFEST_RUNTIME}
var __result;
${compiled}
if(!__result||__result.ok!==true||!Array.isArray(__result.errors)||__result.errors.length||!Array.isArray(__result.ops)||__result.ops.some(function(o){return o.ok!==true;}))throw new Error('COMPILER_NESTED_FAILURE');
globalThis.__refcloneLayerMap=__result.created;
return __result;
})()`;
  new vm.Script(code);
  return code;
}

/** A deliberately narrow API contract emulator, not evidence of a real Cavalry API. */
export function createContractHost({geometryOffset={x:0,y:0},failSet=false}={}) {
  let serial=0, active='user_comp', undoSnapshot=null, scenePath='';
  const checkpoints=new Map();
  const comps=new Map([['user_comp',{id:'user_comp',name:'Unrelated user composition',attrs:{},layers:new Map()}]]);
  const getComp=()=>comps.get(active);
  const find=id=>comps.get(id)??[...comps.values()].flatMap(c=>[...c.layers.values()]).find(l=>l.id===id);
  const api={
    // Truthful fixture rollback: restore the exact pre-transaction emulator
    // state. This is bounded in-memory emulation, NOT live Cavalry undo
    // qualification; live hosts qualify through real checkpoint round trips.
    undo(){if(!undoSnapshot)throw new Error('MOCK_UNDO_WITHOUT_TRANSACTION');comps.clear();for(const [id,comp] of undoSnapshot.comps)comps.set(id,comp);active=undoSnapshot.active;undoSnapshot=null;},
    // Checkpoint-strategy surface for exercising compiled candidates. The
    // candidate only typeof-checks these; the batch host drives save/restore.
    saveSceneAs(p){checkpoints.set(p,{comps:structuredClone(comps),active});scenePath=p;return true;},
    openScene(p){const s=checkpoints.get(p);if(!s)return false;comps.clear();for(const [id,comp] of s.comps)comps.set(id,comp);active=s.active;scenePath=p;return true;},
    getSceneFilePath:()=>scenePath,
    sceneHasUnsavedChanges:()=>false,
    createComp(name){const id=`composition#${++serial}`;comps.set(id,{id,name,attrs:{},layers:new Map()});return id;},
    setActiveComp(id){if(!comps.has(id))throw new Error('unknown composition');active=id;},
    getActiveComp:()=>active,
    getCompLayers:()=>[...getComp().layers.keys()],
    select(){},
    set(id,attrs){if(failSet)throw new Error('injected set failure');const layer=find(id);if(!layer)throw new Error('unknown id');const spec=structuredClone(attrs);
      // Live Cavalry exposes a composition's range as startFrame/endFrame
      // attributes; mirror that so captured compInfo matches the real host.
      if(comps.has(id))for(const key of ['startFrame','endFrame'])if(key in spec)layer[key]=Number(spec[key]);
      Object.assign(layer.attrs,spec);},
    setInFrame(id,n){find(id).startFrame=n;},setOutFrame(id,n){find(id).endFrame=n;},
    primitive(type,name){if(type!=='rectangle')throw new Error('unqualified primitive');const id=`basicShape#${++serial}`;getComp().layers.set(id,{id,name,attrs:{},keys:{},easings:{}});return id;},
    create(type){const id=`${type}#${++serial}`;getComp().layers.set(id,{id,name:String(type),attrs:{},keys:{},easings:{}});return id;},
    keyframe(id,frame,attrs){const l=find(id);if(!l?.keys)throw new Error('unknown keyframe target');for(const [attr,value] of Object.entries(attrs)){l.keys[attr]??=[];l.keys[attr].push({frame,value});l.keys[attr].sort((a,b)=>a.frame-b.frame);}},
    magicEasing(id,attr,frame,kind,expression){if(kind!=='Custom'||typeof expression!=='string')throw new Error('unqualified easing');find(id).easings[attr]={frame,expression};}
  };
  function execute(code,{assertResult=true}={}){
    undoSnapshot={comps:structuredClone(comps),active};
    const context=vm.createContext({api},{codeGeneration:{strings:false,wasm:false}});
    const result=new vm.Script(code).runInContext(context,{timeout:2000});
    if(assertResult)assertCompilerResult(result);
    const layerMap=context.__refcloneLayerMap?JSON.parse(JSON.stringify(context.__refcloneLayerMap)):{};
    return {result,layerMap};
  }
  function valueAt(l,attr,frame){
    const keys=l.keys[attr];if(!keys?.length)return l.attrs[attr]??0;
    if(frame<=keys[0].frame)return keys[0].value;if(frame>=keys.at(-1).frame)return keys.at(-1).value;
    const a=keys[0],b=keys.at(-1);let t=(frame-a.frame)/(b.frame-a.frame);
    if(l.easings[attr])t=new vm.Script(l.easings[attr].expression).runInNewContext({t},{timeout:100,contextCodeGeneration:{strings:false,wasm:false}});
    return a.value+(b.value-a.value)*t;
  }
  function capture(frame,aliases){
    const comp=getComp(),width=comp.attrs['resolution.x'],height=comp.attrs['resolution.y'];
    if(!Number.isInteger(width)||!Number.isInteger(height))throw new Error('invalid mock comp');
    const bg=comp.attrs.backgroundColor.match(/[a-f0-9]{2}/gi).map(x=>parseInt(x,16));
    const image=new PNG({width,height});
    for(let i=0;i<width*height;i++){image.data[i*4]=bg[0];image.data[i*4+1]=bg[1];image.data[i*4+2]=bg[2];image.data[i*4+3]=255;}
    const metrics={};
    for(const [alias,id] of Object.entries(aliases)){
      const l=comp.layers.get(id);if(!l)throw new Error('alias is not job-owned');
      const dims=l.attrs['generator.dimensions'];
      const x=valueAt(l,'position.x',frame)+geometryOffset.x,y=valueAt(l,'position.y',frame)+geometryOffset.y;
      const box={x:x-dims.x/2,y:y-dims.y/2,width:dims.x,height:dims.y,centreX:x,centreY:y};
      metrics[alias]={bbox:box,worldTransform:{posX:x,posY:y,scaleX:1,scaleY:1,rotation:0,opacity:100}};
      const left=width/2+x-dims.x/2,top=height/2-y-dims.y/2,color=l.attrs['material.materialColor'];
      // Render from evaluated scene geometry; never read any reference pixels.
      for(let py=Math.max(0,Math.ceil(top-.5));py<Math.min(height,Math.ceil(top+dims.y-.5));py++)for(let px=Math.max(0,Math.ceil(left-.5));px<Math.min(width,Math.ceil(left+dims.x-.5));px++){
        const i=(py*width+px)*4;image.data[i]=color.r;image.data[i+1]=color.g;image.data[i+2]=color.b;
      }
    }
    return {image,layerMetrics:metrics,compInfo:{width,height,fps:comp.attrs.fps,startFrame:comp.startFrame,endFrame:comp.endFrame}};
  }
  return {execute,capture,comps,api};
}
export function exerciseCandidate(code,prepared,{staticOnly=false}={}) {
  const scene=staticOnly?prepared.candidate:prepared.analysis;
  if(!scene)throw new Error('STAGE1_LOCKED: animated exercise requested before the static batch gate');
  const host=createContractHost();const executed=host.execute(code);
  if(Object.keys(executed.layerMap).length!==scene.layers.length)throw new Error('COMPILER_LAYER_COVERAGE');
  for(const l of scene.layers)if(typeof executed.layerMap[l.layerId]!=='string')throw new Error('COMPILER_ALIAS_MISSING');
  const sample=staticOnly?[prepared.candidate.heroFrame]:[...new Set(Object.values(scene.criticalFrames))];
  for(const frame of sample)host.capture(frame,executed.layerMap);
  return true;
}
