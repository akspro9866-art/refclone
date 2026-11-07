import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createStallionClient } from '../cavalry/stallion-batch.mjs';
import { createContractHost, registerMockClient } from '../strict/execution.mjs';

/** Ephemeral loopback server. Real POST ack/GET seq and freshly rendered PNGs. */
export async function startMockStallionServer(options = {}) {
  const host=createContractHost(options);
  const checkpointFiles=new Set();
  const heartbeat={kind:'status',ok:true,stallion:'fixture',cavalry:'2.8.0-fixture',
    capabilities:{batchEvalAndCapture:true,batchEvalAndCaptureRollback:false,batchEvalAndCaptureCheckpoint:options.checkpoint===true}};
  let latest=options.checkpoint?heartbeat:{kind:'status',ok:true},posts=0;
  const transactions=new Set(),requests=[];
  const server=http.createServer(async(req,res)=>{
    try {
      if(req.method==='GET'&&req.url==='/get'){res.setHeader('content-type','application/json');res.end(JSON.stringify(latest));return;}
      if(req.method!=='POST'||req.url!=='/post'){res.writeHead(404);res.end();return;}
      let body='';for await(const chunk of req){body+=chunk;if(body.length>2000000)throw new Error('request too large');}
      const input=JSON.parse(body);posts++;requests.push(input);
      // Read-only state introspection for qualification fingerprints.
      if(input.type==='state'){
        const compId=host.api.getActiveComp(),comp=host.comps.get(compId);
        const layers=[...(comp?.layers.values()??[])].map(l=>({id:l.id,type:'basicShape'}));
        latest={kind:'state',ok:true,seq:input.seq,compId,frame:0,total:layers.length,layers};
        res.setHeader('content-type','text/plain');res.end('Success');return;
      }
      const envelope={seq:input.seq,kind:'batchEvalAndCapture',ok:false,transactionId:input.transactionId,executionTimeMs:0};
      const checkpointStrategy=input.rollbackStrategy==='checkpoint';
      let checkpointSaved=false;
      try {
        if(input.type!=='batchEvalAndCapture'||input.rollbackOnError!==true||options.undoUnavailable)throw new Error('rollback API unavailable before mutation');
        if(transactions.has(input.transactionId))throw new Error('duplicate mutation transaction');
        transactions.add(input.transactionId);
        if(checkpointStrategy){
          if(options.checkpoint!==true)throw new Error('Checkpoint rollback is unavailable on this fixture.');
          if(typeof input.checkpointPath!=='string'||!input.checkpointPath.endsWith('.cv'))throw new Error('checkpointPath must name a .cv file');
          if(checkpointFiles.has(input.checkpointPath))throw new Error('Checkpoint path already exists; refusing to overwrite: '+input.checkpointPath);
          const originalScenePath=host.api.getSceneFilePath();
          if(host.api.saveSceneAs(input.checkpointPath)!==true)throw new Error('saveSceneAs did not confirm the checkpoint save.');
          checkpointFiles.add(input.checkpointPath);checkpointSaved=true;
          envelope.rollbackStrategy='checkpoint';
          envelope.checkpoint={path:input.checkpointPath,saved:true,originalScenePath,scenePathAfterSave:host.api.getSceneFilePath()};
        }
        const {layerMap}=host.execute(input.code,{assertResult:Array.isArray(input.inspectLayerIds)&&input.inspectLayerIds.length>0});
        const aliases=Object.fromEntries(input.inspectLayerIds.map(id=>{if(!layerMap[id])throw new Error('requested alias absent');return [id,layerMap[id]];}));
        const frames={};let compInfo;
        for(const frame of input.sampleFrames){
          const capture=host.capture(frame,aliases);compInfo=capture.compInfo;
          // Host capture contract: frame_<n>.png inside the transaction outputDir.
          const file=path.join(input.renderConfig.outputDir,`frame_${frame}.png`);
          await fs.mkdir(input.renderConfig.outputDir,{recursive:true});
          if(options.fault!=='missingPixels')await fs.writeFile(file,PNG.sync.write(capture.image),{flag:'wx'});
          frames[frame]={renderedPngPath:file,layerMetrics:capture.layerMetrics};
          if(options.fault==='missingMetrics')delete frames[frame].layerMetrics[input.inspectLayerIds[0]];
          if(options.fault==='stalePixels')frames[frame].renderedPngPath=requests[0].renderConfig.outputDir+'/stale.png';
        }
        Object.assign(envelope,{ok:true,frames,compInfo,layerMap});
        if(options.fault==='transaction')envelope.transactionId='wrong-transaction';
        if(options.fault==='kind')envelope.kind='batch-step';
      }catch(error){
        envelope.error={message:String(error.message??error)};
        if(checkpointStrategy&&checkpointSaved){
          // Truthful fixture restore from the saved checkpoint, mirroring the
          // live openScene contract; a refused restore stays visible.
          const restored=host.api.openScene(input.checkpointPath,true)===true&&host.api.getSceneFilePath()===input.checkpointPath;
          envelope.checkpoint={...envelope.checkpoint,restored,scenePathAfterRestore:host.api.getSceneFilePath(),...(!restored?{sceneStateUnknown:true}:{})};
        }else if(!checkpointStrategy){
          try{host.api.undo();}catch{/* no open transaction to roll back */}
        }
      }
      if(options.fault!=='timeout')latest=envelope;
      res.setHeader('content-type','text/plain');res.end('Success');
    }catch(error){res.writeHead(400);res.end(String(error.message??error));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address(),baseUrl=`http://127.0.0.1:${address.port}`;
  const client=registerMockClient(createStallionClient({baseUrl,pollMs:1,maxPollMs:2,timeoutMs:options.timeoutMs??2000}));
  return {baseUrl,client,host,requests,get posts(){return posts;},async close(){await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}
