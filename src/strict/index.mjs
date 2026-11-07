import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import { heroFrameDeconstructor, hashBytes, hashJson, writeJson } from '../stage0/heroFrameDeconstructor.ts';
import { hybridLoss, cavalryBoxToRaster } from '../optimizer/hybridLoss.ts';
import { createStallionClient } from '../cavalry/stallion-batch.mjs';
import { exactKeys, prepareStrict, unlockStage1, validateRunOptions } from './contract.mjs';
import { compileCandidate, exerciseCandidate, isMockClient } from './execution.mjs';
import { isQualifiedClient, qualifyLiveHost } from './qualification.mjs';
export { validateStage35 } from './contract.mjs';
export { qualifyLiveHost } from './qualification.mjs';

const tokens=()=>({local:0,stage2Caller:null});
const blocked=error=>({ok:false,status:'blocked',reason:String(error.message??error),tokens:tokens()});

/** Resolve the public transport from the environment when no client is injected. */
function publicClient(){
  const host=process.env.STALLION_HOST;
  const target=process.env.STALLION_URL??(host?(host.includes('://')?host:`http://${host}`):undefined);
  if(target!=null){
    let url;try{url=new URL(target);}catch{throw new Error('STALLION_TARGET_INVALID: STALLION_URL/STALLION_HOST must be an http(s) URL');}
    if(url.protocol!=='http:'&&url.protocol!=='https:')throw new Error('STALLION_TARGET_INVALID: STALLION_URL/STALLION_HOST must be an http(s) URL');
  }
  return createStallionClient({baseUrl:target});
}

export async function inspectReference(input,dependencies={}) {
  try {
    exactKeys(input,['videoPath','startSec','endSec','fps','outputDir'],'STRICT_INSPECT');
    exactKeys(dependencies,[],'STRICT_INSPECT_DEPENDENCIES');
    validateRunOptions(input);
    return await heroFrameDeconstructor(input);
  }catch(error){return blocked(error);}
}

/** No backend interpretation hook. Only a measured, sealed BeatSpec can reach transport. */
export async function compileAndConverge(input,dependencies={}) {
  const started=Date.now();
  let jobDir,reportPath,stage1Ran=false;
  try {
    exactKeys(input,['beatSpec','outputDir','maxIterations'],'STRICT_COMPILE');
    exactKeys(dependencies,['client'],'STRICT_COMPILE_DEPENDENCIES');
    validateRunOptions(input);
    let prepared=await prepareStrict(input.beatSpec);
    const root=path.resolve(input.outputDir??path.join(path.dirname(input.beatSpec.inspectionPath),'convergence'));
    await fs.mkdir(root,{recursive:true});jobDir=await fs.mkdtemp(path.join(root,'run-'));reportPath=path.join(jobDir,'report.json');
    const {artifact,candidate,frames}=prepared;
    const firstCode=compileCandidate(prepared,{jobName:'strict-validation',staticOnly:true});exerciseCandidate(firstCode,prepared,{staticOnly:true});
    // Resolve transport BEFORE any mutation. An injected client must be a
    // registered test mock or a client that completed the real checkpoint
    // qualification probes. The default path stays fail-closed with zero HTTP;
    // REFCLONE_LIVE_QUALIFICATION=checkpoint explicitly authorizes running the
    // guarded probes (which themselves save the scene before any mutation).
    // No user `safe`/`locked`/`live`/`mock` flag turns into permission.
    const client=dependencies.client??publicClient();
    let qualificationPath=null;
    if(!isMockClient(client)&&!isQualifiedClient(client)){
      if(process.env.REFCLONE_LIVE_QUALIFICATION!=='checkpoint')throw new Error('LIVE_HOST_UNQUALIFIED: run qualifyLiveHost (or set REFCLONE_LIVE_QUALIFICATION=checkpoint) to prove a real save/openScene round trip; no HTTP sent');
      const qualification=await qualifyLiveHost(client,{directory:path.join(jobDir,'qualification')});
      qualificationPath=qualification.evidencePath;
    }
    const live=!isMockClient(client);
    const rollbackStrategy=live?'checkpoint':'undo';
    const evidenceKind=live?'live-cavalry-checkpoint':'synthetic-http-mock';
    const maxIterations=input.maxIterations??4,history=[],usedPaths=new Set();
    // Stage1 stays locked until the verified static batch gate passes.
    let analysis=null;
    const reference=()=>Object.fromEntries(frames.map((f,i)=>[i,{image:f.image,boxes:Object.fromEntries(analysis.layers.map(l=>[l.layerId,l.boxes[i]]))}]));
    const compare=(cand,staticOnly)=>{
      const scene=staticOnly?candidate:analysis;
      const ref=staticOnly?Object.fromEntries(Object.keys(cand).map(f=>[f,{image:frames[candidate.heroFrame].image,boxes:Object.fromEntries(candidate.layers.map(l=>[l.layerId,l.box]))}])):reference();
      const critical=staticOnly?Object.fromEntries(['start','peakVelocity','overshoot','settle'].map(k=>[k,candidate.heroFrame])):analysis.criticalFrames;
      const loss=hybridLoss({reference:ref,candidate:cand,criticalFrames:critical,layers:scene.layers,background:scene.background});
      // The four critical events do not excuse missing/intermediate frame failures.
      const allRows=Object.keys(cand).flatMap(f=>hybridLoss({reference:ref,candidate:cand,criticalFrames:{start:+f,peakVelocity:+f,overshoot:+f,settle:+f},layers:scene.layers,background:scene.background}).rows.slice(0,scene.layers.length));
      const pass=loss.loss<=.015&&allRows.every(r=>r.ssim>=.99&&r.rgbMae<=.005&&r.giou>=.98&&r.alphaIoU>=.98);
      const allFrameMinimums={ssim:Math.min(...allRows.map(r=>r.ssim)),giou:Math.min(...allRows.map(r=>r.giou)),alphaIoU:Math.min(...allRows.map(r=>r.alphaIoU))};
      return {...loss,pass,worstFrameLoss:Math.max(...allRows.map(r=>r.loss)),allFrameCoverage:allRows.length,allFrameMinimums};
    };
    async function capture(label,corrections,staticOnly=false){
      const scene=staticOnly?candidate:analysis;
      const transactionId=`strict-${randomUUID()}`,directory=path.join(jobDir,transactionId);await fs.mkdir(directory);
      const code=compileCandidate(prepared,{jobName:transactionId,corrections,staticOnly,rollbackStrategy});exerciseCandidate(code,prepared,{staticOnly});
      const codePath=path.join(directory,'candidate.js');await fs.writeFile(codePath,code,{flag:'wx'});
      const sampleFrames=staticOnly?[candidate.heroFrame]:frames.map(f=>f.frame);
      // scaleFactor is the host render multiplier (1 == full resolution), not a percent.
      const envelope=await client.batchEvalAndCapture({transactionId,undoGroupName:transactionId,code,sampleFrames,inspectLayerIds:scene.layers.map(l=>l.layerId),renderConfig:{enabled:true,outputDir:directory,scaleFactor:1},rollbackOnError:true,...(live?{rollbackStrategy:'checkpoint',checkpointPath:path.join(directory,'checkpoint.cv')}: {})});
      const comp=envelope.compInfo,m=artifact.media;
      if(comp.width!==m.width||comp.height!==m.height||Math.abs(comp.fps-m.fps)>1e-6||comp.startFrame!==0||comp.endFrame!==frames.length-1)throw new Error('CAPTURE_COMPOSITION_MISMATCH');
      const cand={},evidence=[];
      for(const frame of sampleFrames){
        const entry=envelope.frames[frame],file=path.resolve(entry.renderedPngPath);
        // Host capture contract: fresh frame_<n>.png inside this transaction dir.
        if(path.dirname(file)!==directory||path.basename(file)!==`frame_${frame}.png`||usedPaths.has(file)||frames.some(f=>f.path===file))throw new Error('CAPTURE_STALE_OR_REFERENCE_PATH');
        usedPaths.add(file);
        const bytes=await fs.readFile(file),image=PNG.sync.read(bytes);
        if(image.width!==m.width||image.height!==m.height)throw new Error('CAPTURE_PIXEL_DIMENSIONS');
        const boxes={};
        for(const l of scene.layers){
          const metric=entry.layerMetrics[l.layerId],t=metric.worldTransform;
          if(Math.abs(t.scaleX-1)>1e-6||Math.abs(t.scaleY-1)>1e-6||t.rotation!==0||t.opacity!==100)throw new Error('CAPTURE_UNSUPPORTED_TRANSFORM');
          boxes[l.layerId]=cavalryBoxToRaster(metric.bbox,m.width,m.height);
        }
        cand[frame]={image,boxes};evidence.push({frame,path:file,sha256:hashBytes(bytes),layerMetrics:entry.layerMetrics});
      }
      const score=compare(cand,staticOnly);
      const evidencePath=path.join(directory,'capture.json');await writeJson(evidencePath,{transactionId,label,evidenceKind,compInfo:comp,evidence,score});
      history.push({label,transactionId,evidencePath,loss:score.loss,pass:score.pass,corrections:structuredClone(corrections)});
      return {candidate:cand,score,evidencePath,corrections:structuredClone(corrections)};
    }
    function residualPatch(evaluation,staticOnly){
      const scene=staticOnly?candidate:analysis;
      const patch=structuredClone(evaluation.corrections);
      for(const layer of scene.layers){
        const keys=Object.keys(evaluation.candidate);let dx=0,dy=0;
        for(const f of keys){const a=staticOnly?layer.box:layer.boxes[+f],b=evaluation.candidate[f].boxes[layer.layerId];dx+=a.x-b.x;dy+=a.y-b.y;}
        const old=patch[layer.layerId]??{x:0,y:0};
        patch[layer.layerId]={x:Math.max(-2,Math.min(2,old.x+dx/keys.length)),y:Math.max(-2,Math.min(2,old.y+dy/keys.length))};
      }
      return patch;
    }
    // Static lock first. These are bounded bbox residual corrections, not guesses.
    let hero=await capture('hero-static',{},true);
    for(let i=1;!hero.score.pass&&i<Math.min(3,maxIterations);i++){
      const patch=residualPatch(hero,true);if(hashJson(patch)===hashJson(hero.corrections))break;
      const next=await capture('hero-bbox-correction',patch,true);if(next.score.loss<hero.score.loss)hero=next;else break;
    }
    if(!hero.score.pass)throw new Error('HERO_RENDER_GATE_FAILED: animated application not run');
    // Verified static batch gate passed: unlock Stage1 tracking from sealed
    // pixels, verify the semantic routes, then exercise the animated manifest.
    prepared=unlockStage1(prepared,input.beatSpec);analysis=prepared.analysis;stage1Ran=analysis.stage1Ran;
    const fullCode=compileCandidate(prepared,{jobName:'strict-validation',rollbackStrategy});exerciseCandidate(fullCode,prepared);
    let best=await capture('measured-analytical-rig',hero.corrections);
    // No qualified preset mapping is silently ignored. Pure local multi-layer
    // residual patching follows the measured curve fit; bounded by maxIterations.
    for(let i=1;!best.score.pass&&i<maxIterations;i++){
      const patch=residualPatch(best,false);if(hashJson(patch)===hashJson(best.corrections))break;
      const cand=await capture('analytical-multilayer-patch',patch);
      if(cand.score.loss<best.score.loss)best=cand;else break;
    }
    // Reapply the best candidate in a fresh job comp; never accept stale best scores.
    const finalHero=await capture('fresh-final-hero',best.corrections,true);
    const final=await capture('fresh-final-best-reapply',best.corrections);
    const ok=finalHero.score.pass&&final.score.pass;
    const metrics={staticSsim:finalHero.score.allFrameMinimums.ssim,motionGiou:final.score.allFrameMinimums.giou,alphaIoU:final.score.allFrameMinimums.alphaIoU,hybridLoss:final.score.loss,worstFrameLoss:final.score.worstFrameLoss};
    const report={ok,status:ok?(live?'live-converged':'synthetic-converged'):'blocked',...(!ok?{reason:'FINAL_FIDELITY_GATE_FAILED'}:{}),evidenceKind,rollbackStrategy,...(qualificationPath?{qualificationPath}:{}),inspectionPath:input.beatSpec.inspectionPath,jobDir,reportPath,finalEvidencePath:final.evidencePath,heroEvidencePath:finalHero.evidencePath,loss:final.score.loss,metrics,executionTimeMs:Date.now()-started,stage1Ran,staticScene:analysis.staticScene,history,tokens:tokens(),limitations:['No live Cavalry fidelity or perfect arbitrary-video extraction claim.','Qualified isolated solid rectangles, static or one analytical translation beat.','Preset fidelity mappings are not qualified; presetId requests block.','Global grayscale SSIM plus RGB error; foreground masks, not opaque-frame alpha.',...(live?['Checkpoint rollback restores content, but the session may remain associated with the newest checkpoint .cv file; reopen the original scene after review.']:[])]};
    await writeJson(reportPath,report);return report;
  }catch(error){const report={...blocked(error),stage1Ran,metrics:null,executionTimeMs:Date.now()-started,...(jobDir?{jobDir,reportPath}:{})};if(reportPath)await writeJson(reportPath,report);return report;}
}
