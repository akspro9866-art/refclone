import { computeSSIM } from '../vision/perceptual.mjs';

export interface Box { x: number; y: number; width: number; height: number }
export interface Raster { width: number; height: number; data: Uint8Array }
export function assertRaster(image: Raster): void {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width<1 || image.height<1 || image.data?.length!==image.width*image.height*4) throw new Error('LOSS_PIXELS_MISSING');
}
export function assertBox(b: Box): void {
  if (!b || !['x','y','width','height'].every(k=>Number.isFinite(b[k])) || b.width<=0 || b.height<=0) throw new Error('LOSS_BOX_MISSING');
}
export function giou(a: Box,b: Box): number {
  assertBox(a);assertBox(b);
  const intersection=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  const union=a.width*a.height+b.width*b.height-intersection;
  const enclosing=(Math.max(a.x+a.width,b.x+b.width)-Math.min(a.x,b.x))*(Math.max(a.y+a.height,b.y+b.height)-Math.min(a.y,b.y));
  return intersection/union-(enclosing-union)/enclosing;
}
/** Cavalry comp-space y is up; raster-space y is down, origin at top-left. */
export function cavalryBoxToRaster(b: Box & {centreX: number; centreY: number}, width: number,height: number): Box {
  assertBox(b);
  if(!Number.isFinite(b.centreX)||!Number.isFinite(b.centreY)) throw new Error('LOSS_CENTRE_MISSING');
  return {x:width/2+b.centreX-b.width/2,y:height/2-b.centreY-b.height/2,width:b.width,height:b.height};
}
/** Composite opacity is not object alpha. Extract foreground against measured background. */
export function foregroundMask(image: Raster, background: number[], color?: number[]): Uint8Array {
  assertRaster(image);
  if(background.length!==3 || !background.every(Number.isFinite)) throw new Error('LOSS_BACKGROUND_MISSING');
  const mask=new Uint8Array(image.width*image.height);
  for(let i=0;i<mask.length;i++) {
    const rgb=Array.from(image.data.subarray(i*4,i*4+3));
    const foreground=Math.max(...rgb.map((v,c)=>Math.abs(v-background[c])))>3;
    const selected=!color || Math.max(...rgb.map((v,c)=>Math.abs(v-color[c])))<=3;
    mask[i]=foreground && selected && image.data[i*4+3]>0 ? 1:0;
  }
  return mask;
}
export function maskIoU(a: Uint8Array,b: Uint8Array): number {
  if(!a?.length || a.length!==b?.length) throw new Error('LOSS_MASK_MISSING');
  let union=0,intersection=0;
  for(let i=0;i<a.length;i++){if(a[i]||b[i])union++;if(a[i]&&b[i])intersection++;}
  if(!union) throw new Error('LOSS_EMPTY_FOREGROUND');
  return intersection/union;
}
export interface LossFrame {image: Raster; boxes: Record<string,Box>}
export interface HybridInput {
  reference: Record<string,LossFrame>; candidate: Record<string,LossFrame>;
  criticalFrames: Record<'start'|'peakVelocity'|'overshoot'|'settle',number>;
  layers: {layerId: string; color: number[]}[]; background: number[];
}
/** Exact requested weights; every event and layer must have all three channels. */
export function hybridLoss(input: HybridInput) {
  if(!input.layers?.length)throw new Error('LOSS_LAYERS_MISSING');
  const rows=[];
  for(const event of ['start','peakVelocity','overshoot','settle']) {
    const frame=input.criticalFrames?.[event];
    if(!Number.isInteger(frame))throw new Error(`LOSS_FRAME_MISSING: ${event}`);
    const a=input.reference[frame], b=input.candidate[frame];
    if(!a||!b)throw new Error(`LOSS_FRAME_MISSING: ${frame}`);
    assertRaster(a.image);assertRaster(b.image);
    if(a.image===b.image || a.image.data===b.image.data)throw new Error('LOSS_SELF_COMPARISON');
    if(a.image.width!==b.image.width||a.image.height!==b.image.height)throw new Error('LOSS_DIMENSIONS');
    const ssim=computeSSIM(a.image,b.image);
    // Global grayscale SSIM does not detect isoluminant color errors. RGB MAE is
    // also part of the explicitly named perceptual channel, not called LPIPS.
    let rgbMae=0;
    for(let i=0;i<a.image.data.length;i++)if(i%4!==3)rgbMae+=Math.abs(a.image.data[i]-b.image.data[i]);
    rgbMae/=a.image.width*a.image.height*3*255;
    const perceptual=Math.max(1-ssim,rgbMae);
    for(const layer of input.layers){
      const g=giou(a.boxes[layer.layerId],b.boxes[layer.layerId]);
      const alphaIoU=maskIoU(foregroundMask(a.image,input.background,layer.color),foregroundMask(b.image,input.background,layer.color));
      rows.push({event,frame,layerId:layer.layerId,giou:g,alphaIoU,ssim,rgbMae,perceptual,loss:.55*(1-g)+.25*(1-alphaIoU)+.20*perceptual});
    }
  }
  return {loss:rows.reduce((s,r)=>s+r.loss,0)/rows.length,rows,perceptualMethod:'max(1-global-grayscale-SSIM, RGB-MAE)',alphaMethod:'measured-color foreground mask (not composite alpha)'};
}
