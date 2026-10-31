// _mg DSL compiler for the procedural route.
//
// The compiler is pure Node: it records a scene, then emits ONE Cavalry script that
// calls the existing _mg helpers (comp, text, layer, set, wire, kf, patchSelected) and
// four additive primitives (svg, ease, stagger, patch). The additive runtime shims are
// installed only when used and only when the live helper is missing, so an existing
// _mg implementation is never overwritten.
//
// Legacy helpers kept for backward compatibility: comp, measure, cut, bg, text,
// splitRow, inlineRow. They keep the positional signatures of the injected runtime
// where one exists (comp, text) and add record-style equivalents where none did.
import path from 'node:path';

export const DSL_VERSION = '1.0.0';

/** Conservative token estimate: four characters per token, rounded up. */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4);
}

function sanitizeId(value) {
  return String(value ?? 'layer').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40) || 'layer';
}

function compact(value) {
  return JSON.stringify(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(Number(value) * factor) / factor;
}

function frame(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new TypeError(`${label} must be an integer frame.`);
  return parsed;
}

const RUNTIME = {
  // The live cavalry-mcp prelude owns the real implementation; these shims only
  // fill in when an older prelude is loaded. Bezier handles map to the nearest
  // accepted Cavalry curve by overshoot/slope, never to the Custom preset.
  ease: `_mg.ease=_mg.ease||function(i,a,o){if(a==="scale"){var s=Object.assign({},o);_mg.ease(i,"scale.x",s);return _mg.ease(i,"scale.y",s)}var n=o.magicEasing||(o.easing&&o.easing.kind==="preset"?o.easing.name:null),b=o.bezier||(o.easing&&o.easing.kind==="bezier"?o.easing.handles:null);if(!n)n=b?(b[1]>1.2?"OvershootOut":b[1]<-0.2?"AnticipateIn":b[2]<0.5?"VerySlowOut":b[0]>0.6?"VerySlowIn":"SlowInSlowOut"):"SlowInSlowOut";_mg.kf(i,a,[[o.inFrame,o.from],[o.outFrame,o.to]],n)};`,
  svg: `_mg.svg=_mg.svg||function(p,o){var id;if(o.path){id=api.addAssetToComp(api.loadAsset(o.path,false))}else if(typeof api.createEditable==="function"){id=api.createEditable(o.d,o.name||"Vector")}else{throw new Error("_mg.svg: no editable-path API; pass an .svg path")}if(o.name){try{api.rename(id,o.name)}catch(e){}}if(p&&p!==C){try{api.parent(id,p)}catch(e){}}if(o.pos)_mg.set(id,{position:o.pos});if(o.scale!=null)_mg.set(id,{scale:o.scale});return id};`,
  stagger: `_mg.stagger=_mg.stagger||function(ids,o){ids=[].concat(ids);ids.forEach(function(id,i){_mg.ease(id,o.attr,{inFrame:o.inFrame+i*o.delayFrames,outFrame:o.outFrame+i*o.delayFrames,from:o.from,to:o.to,magicEasing:o.magicEasing,bezier:o.bezier,easing:o.easing})});return ids};`,
  patch: `_mg.patch=_mg.patch||function(p){var r=(Array.isArray(p)?p:[p]).map(function(s){var t=s.ids||(s.target?[s.target]:null),a=Object.assign({},s.attrs||{}),k,i;if(s.delta)for(k in s.delta)for(i=0;i<t.length;i++)a[k]=(Number(api.get(t[i],k))||0)+s.delta[k];for(i=0;i<t.length;i++){if(s.frame!=null)api.keyframe(t[i],s.frame,a);else _mg.set(t[i],a)}return{patched:t.length}});return r.length===1?r[0]:r};`,
  cut: `_mg.cut=_mg.cut||function(f){try{if(api.addCompMarker)api.addCompMarker(f,"cut")}catch(e){}};`,
  bg: `_mg.bg=_mg.bg||function(c){_mg.set(C,{backgroundColor:c})};`,
  measure: `_mg.measure=_mg.measure||function(id){try{return api.getBoundingBox(id,false)}catch(e){return null}};`,
  splitRow: `_mg.splitRow=_mg.splitRow||function(w,o){o=o||{};var g=o.gap==null?24:o.gap,z=o.size||80,y=o.y==null?0:o.y,ids=[],ws=[];w.forEach(function(t){ids.push(_mg.text(t,z,o.color||"#FFFFFF",o.attrs||{}))});ids.forEach(function(id,i){var b=null;try{b=api.getBoundingBox(id,false)}catch(e){}ws.push(b&&b.size?b.size.x:String(w[i]).length*z*0.55)});var total=ws.reduce(function(a,b){return a+b},0)+g*(ids.length-1),x=(o.x==null?0:o.x)-total/2;ids.forEach(function(id,i){_mg.set(id,{position:{x:x+ws[i]/2,y:y}});x+=ws[i]+g});return ids};`,
  inlineRow: `_mg.inlineRow=_mg.inlineRow||function(items,o){o=o||{};return _mg.splitRow(items.map(function(v){return typeof v==="string"?v:v.text}),o)};`
};

export class MgScript {
  constructor(options = {}) {
    this.project = {
      width: Math.round(number(options.width, 1920)),
      height: Math.round(number(options.height, 1080)),
      fps: number(options.fps, 60),
      endFrame: Math.round(number(options.endFrame, 180)),
      background: options.background ?? options.bg ?? '#0B0C10'
    };
    this.lines = [];
    this.layers = [];
    this.groups = [];
    this.patches = [];
    this.cuts = [];
    this.measurements = {};
    this.uses = new Set();
    this.stats = { layers: 0, texts: 0, paths: 0, moves: 0, groups: 0, patches: 0, cuts: 0 };
  }

  /** Existing signature: comp(width, height, fps, endFrame, bgColor). */
  comp(width = 1920, height = 1080, fps = 60, endFrame = 180, background = '#0B0C10') {
    if (isPlainObject(width)) {
      const options = width;
      this.project = {
        width: Math.round(number(options.width, 1920)),
        height: Math.round(number(options.height, 1080)),
        fps: number(options.fps, 60),
        endFrame: Math.round(number(options.endFrame, 180)),
        background: options.background ?? options.bg ?? '#0B0C10'
      };
    } else {
      this.project = { width: Math.round(number(width, 1920)), height: Math.round(number(height, 1080)), fps: number(fps, 60), endFrame: Math.round(number(endFrame, 180)), background };
    }
    return this;
  }

  /** Register a reference measurement. The value is returned for layout math. */
  measure(name, value) {
    this.measurements[sanitizeId(name)] = value;
    return value;
  }

  /** A composition cut marker; kept out of the payload unless explicitly requested. */
  cut(atFrame) {
    const parsed = frame(atFrame, 'cut frame');
    this.cuts.push(parsed);
    this.uses.add('cut');
    this.stats.cuts += 1;
    return this;
  }

  bg(color) {
    this.project.background = color;
    return this;
  }

  /** Existing signature: text(str, size, color, extraAttrs). */
  text(str, size = 80, color = '#FFFFFF', extraAttrs = {}) {
    let options = {};
    if (isPlainObject(size)) { options = size; size = options.size ?? 80; color = options.color ?? '#FFFFFF'; extraAttrs = options.attrs ?? {}; }
    const id = options.id ?? `text-${this.layers.length + 1}`;
    const variable = `L${this.layers.length}`;
    const attrs = { ...extraAttrs };
    if (options.pos) attrs.position = { x: round(options.pos.x, 2), y: round(options.pos.y, 2) };
    if (options.scale != null && options.scale !== 1) attrs.scale = round(options.scale, 4);
    if (options.rotation != null && options.rotation !== 0) attrs.rotation = round(options.rotation, 3);
    if (options.opacity != null && options.opacity !== 100) attrs.opacity = round(options.opacity, 2);
    const attrText = Object.keys(attrs).length ? `,${compact(attrs)}` : '';
    this.lines.push(`${variable}=_mg.text(${compact(String(str))},${round(Number(size), 2)},${compact(String(color))}${attrText});`);
    this.layers.push({ id, variable, kind: 'text' });
    this.stats.layers += 1; this.stats.texts += 1;
    return variable;
  }

  /** A basic shape layer; the generic counterpart of text. */
  shape(name, options = {}) {
    const variable = `L${this.layers.length}`;
    const attrs = { ...(options.attrs ?? {}) };
    if (options.pos) attrs.position = { x: round(options.pos.x, 2), y: round(options.pos.y, 2) };
    if (options.scale != null && options.scale !== 1) attrs.scale = round(options.scale, 4);
    if (options.rotation != null && options.rotation !== 0) attrs.rotation = round(options.rotation, 3);
    if (options.opacity != null && options.opacity !== 100) attrs.opacity = round(options.opacity, 2);
    this.lines.push(`${variable}=_mg.layer(${compact(options.type ?? 'basicShape')},${compact(String(name))},${compact(attrs)});`);
    this.layers.push({ id: options.id ?? name, variable, kind: 'shape' });
    this.stats.layers += 1;
    return variable;
  }

  /**
   * Import a VTracer SVG file or build an inline editable shape from `d`.
   * parent is a layer variable, or "comp" for the active composition.
   */
  svg(parent, options = {}) {
    const variable = `L${this.layers.length}`;
    const parentRef = !parent || parent === 'comp' ? 'C' : String(parent);
    const spec = {
      ...(options.d ? { d: options.d } : {}),
      ...(options.path ? { path: path.resolve(String(options.path)) } : {}),
      ...(options.name ? { name: String(options.name) } : {}),
      ...(options.pos ? { pos: { x: round(options.pos.x, 2), y: round(options.pos.y, 2) } } : {}),
      ...(options.scale != null && options.scale !== 1 ? { scale: round(options.scale, 4) } : {}),
      ...(options.type ? { type: options.type } : {})
    };
    if (!spec.d && !spec.path) throw new TypeError('svg requires path or d.');
    this.lines.push(`${variable}=_mg.svg(${parentRef},${compact(spec)});`);
    this.layers.push({ id: options.name ?? `svg-${this.layers.length + 1}`, variable, kind: 'svg' });
    this.uses.add('svg');
    this.stats.layers += 1; this.stats.paths += 1;
    return variable;
  }

  /** Existing intent: a measured row of words, laid out at runtime. */
  splitRow(words, options = {}) {
    const list = Array.isArray(words) ? words.map(String) : [String(words)];
    const variable = `L${this.layers.length}`;
    const o = { ...options };
    if (o.pos) { o.x = o.pos.x; o.y = o.pos.y; delete o.pos; }
    this.lines.push(`${variable}=_mg.splitRow(${compact(list)},${compact(o)});`);
    this.layers.push({ id: o.id ?? `row-${this.layers.length + 1}`, variable, kind: 'row', count: list.length });
    this.uses.add('splitRow');
    this.stats.layers += list.length; this.stats.texts += list.length;
    return variable;
  }

  /** Mixed text/shape row driven by the same runtime measurement pass. */
  inlineRow(items, options = {}) {
    const list = Array.isArray(items) ? items : [items];
    const variable = `L${this.layers.length}`;
    const o = { ...options };
    if (o.pos) { o.x = o.pos.x; o.y = o.pos.y; delete o.pos; }
    this.lines.push(`${variable}=_mg.inlineRow(${compact(list)},${compact(o)});`);
    this.layers.push({ id: o.id ?? `inline-${this.layers.length + 1}`, variable, kind: 'row', count: list.length });
    this.uses.add('inlineRow');
    this.stats.layers += list.length;
    return variable;
  }

  /**
   * Two boundary keyframes plus either a magicEasing preset or cubic-bezier tangents.
   * spec.easing {kind:'preset',name} or {kind:'bezier',handles} is also accepted.
   */
  ease(layerRef, attr, spec = {}) {
    const inFrame = frame(spec.inFrame, 'ease.inFrame');
    const outFrame = frame(spec.outFrame, 'ease.outFrame');
    if (outFrame === inFrame) throw new TypeError('ease requires distinct inFrame and outFrame.');
    const from = round(spec.from, 3);
    const to = round(spec.to, 3);
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new TypeError('ease requires finite from and to values.');
    const easing = spec.easing ?? null;
    let magicEasing = spec.magicEasing ?? null;
    let bezier = spec.bezier ?? null;
    if (!magicEasing && easing?.kind === 'preset') magicEasing = easing.name;
    if (!bezier && easing?.kind === 'bezier') bezier = easing.handles;
    const payload = { inFrame, outFrame, from, to };
    if (magicEasing) payload.magicEasing = magicEasing;
    else if (Array.isArray(bezier) && bezier.length === 4) payload.bezier = bezier.map(value => round(value, 3));
    this.lines.push(`_mg.ease(${String(layerRef)},${compact(String(attr))},${compact(payload)});`);
    this.uses.add('ease');
    this.stats.moves += 1;
    return this;
  }

  /** One native stagger rule for a set of layer variables sharing a profile. */
  stagger(memberRefs, spec = {}) {
    const refs = (Array.isArray(memberRefs) ? memberRefs : [memberRefs]).map(String);
    if (refs.length < 2) throw new TypeError('stagger needs at least two member layers.');
    const inFrame = frame(spec.inFrame, 'stagger.inFrame');
    const outFrame = frame(spec.outFrame, 'stagger.outFrame');
    const delayFrames = Math.round(number(spec.delayFrames ?? spec.staggerOffset, 4));
    if (delayFrames < 1) throw new TypeError('stagger delayFrames must be at least 1.');
    const easing = spec.easing ?? null;
    const magicEasing = spec.magicEasing ?? (easing?.kind === 'preset' ? easing.name : null);
    const bezier = spec.bezier ?? (easing?.kind === 'bezier' ? easing.handles : null);
    const payload = {
      attr: spec.attr,
      inFrame, outFrame,
      from: round(spec.from, 3), to: round(spec.to, 3),
      delayFrames,
      ...(magicEasing ? { magicEasing } : {}),
      ...(!magicEasing && Array.isArray(bezier) ? { bezier: bezier.map(value => round(value, 3)) } : {})
    };
    this.lines.push(`_mg.stagger([${refs.join(',')}],${compact(payload)});`);
    this.uses.add('stagger');
    this.uses.add('ease');
    this.stats.groups += 1;
    return this;
  }

  /** Minimal delta update. Accepts one spec or an array; attrs or delta. */
  patch(spec) {
    const list = Array.isArray(spec) ? spec : [spec];
    const refs = [];
    const payload = list.map(entry => {
      // targetRef is raw JavaScript (a compiled layer variable); target is a live id.
      const targetRef = entry.targetRef ?? null;
      if (targetRef) refs.push(targetRef);
      return {
        ...(targetRef ? { target: `@@REF${refs.length - 1}@@` } : entry.target ? { target: String(entry.target) } : {}),
        ...(entry.attrs ? { attrs: entry.attrs } : {}),
        ...(entry.delta ? { delta: entry.delta } : {}),
        // A live bbox correction is written at the frame the render failed on.
        ...(Number.isInteger(entry.frame) ? { frame: entry.frame } : {}),
        ...(entry.shiftKeyframes != null ? { shiftKeyframes: entry.shiftKeyframes } : {}),
        ...(entry.easing ? { easing: entry.easing } : {})
      };
    });
    let encoded = compact(list.length === 1 ? payload[0] : payload);
    refs.forEach((ref, index) => { encoded = encoded.replace(compact(`@@REF${index}@@`), String(ref)); });
    this.lines.push(`_mg.patch(${encoded});`);
    this.uses.add('patch');
    this.stats.patches += list.length;
    return this;
  }

  /** Compile to one batched `_mg` script. The shim only defines missing helpers. */
  compile(options = {}) {
    const shimOrder = ['ease', 'svg', 'stagger', 'patch', 'cut', 'bg', 'measure', 'splitRow', 'inlineRow'];
    const shim = options.runtime === false ? '' : shimOrder.filter(name => this.uses.has(name)).map(name => RUNTIME[name]).join('');
    const header = options.header === false
      ? ''
      : `var C=_mg.comp(${this.project.width},${this.project.height},${this.project.fps},${this.project.endFrame},${compact(this.project.background)}),L={};`;
    const cutLines = this.cuts.map(atFrame => `_mg.cut(${atFrame});`).join('');
    const script = `${shim}${header}${this.lines.join('')}${cutLines}`;
    return { script, tokenEstimate: estimateTokens(script), bytes: Buffer.byteLength(script), stats: { ...this.stats } };
  }
}

/** Build a compiler from a promoted Stage 3 scene. */
export function compilePromotion(promotion, options = {}) {
  const beats = promotion.beats ?? [];
  const lastFrame = beats.length ? Math.max(...beats.map(beat => beat.outFrame)) : 180;
  const script = new MgScript({
    width: options.width ?? promotion.width ?? 1920,
    height: options.height ?? promotion.height ?? 1080,
    fps: options.fps ?? promotion.fps ?? 60,
    endFrame: options.endFrame ?? lastFrame,
    background: options.background ?? promotion.background ?? '#0B0C10'
  });
  const byId = new Map();
  for (const layer of promotion.layers ?? []) {
    const attrs = layer.attrs ?? {};
    let ref;
    if (layer.vector?.d || layer.vector?.path) {
      ref = script.svg('comp', {
        d: layer.vector.d ?? undefined, path: layer.vector.path ?? undefined,
        name: layer.name ?? layer.id, pos: layer.base?.position, scale: layer.base?.scale
      });
    } else if (layer.type === 'text' || layer.text != null) {
      ref = script.text(layer.text ?? layer.name ?? layer.id, {
        size: attrs.fontSize ?? attrs.size ?? 80,
        color: attrs.color ?? attrs.fill ?? '#FFFFFF',
        id: layer.id, name: layer.name,
        pos: layer.base?.position,
        scale: layer.base?.scale, rotation: layer.base?.rotation, opacity: layer.base?.opacity,
        attrs: Object.fromEntries(Object.entries(attrs).filter(([key]) => !['fontSize', 'size', 'color', 'fill'].includes(key)))
      });
    } else {
      ref = script.shape(layer.name ?? layer.id, {
        pos: layer.base?.position, scale: layer.base?.scale,
        rotation: layer.base?.rotation, opacity: layer.base?.opacity,
        attrs
      });
    }
    byId.set(layer.id, ref);
    for (const move of layer.moves ?? []) {
      if (move.from === move.to) continue;
      script.ease(ref, move.attr, {
        inFrame: move.inFrame, outFrame: move.outFrame,
        from: move.from, to: move.to, easing: move.easing
      });
    }
  }
  for (const group of promotion.groups ?? []) {
    const refs = group.memberIds.map(id => byId.get(id)).filter(Boolean);
    if (refs.length < 2) continue;
    script.stagger(refs, {
      attr: group.attr, inFrame: group.inFrame, outFrame: group.outFrame,
      from: group.from, to: group.to, delayFrames: group.delayFrames, easing: group.easing
    });
  }
  // The script returns its created layer ids in creation order, so a live run can
  // map compiled references (L0, L1, ...) back to real ids for Stage 5 patches
  // without guessing from comp order or telemetry.
  const refs = [...byId.values()];
  if (refs.length) script.lines.push(`return [${refs.join(',')}];`);
  const compiled = script.compile();
  return {
    ...compiled,
    project: script.project,
    layers: script.layers.length,
    groups: script.stats.groups,
    layerRefs: Object.fromEntries(byId),
    limitations: [
      ...(compiled.stats.moves > 0 ? [] : ['No promoted moves: the scene is static.']),
      'Custom cubic-bezier tangents resolve to the nearest supported Cavalry magic-easing curve; the prelude contract is tested, but no render was exercised without a live Cavalry session.'
    ]
  };
}

/** Patch-only script, small enough for a <150-token refinement pass. */
export function compilePatch(patches) {
  const list = Array.isArray(patches) ? patches : [patches];
  const script = new MgScript();
  script.patch(list);
  // A refinement pass must not re-emit the comp header: that would reset the live
  // composition's resolution, fps and range on every pass. Patches touch only ids.
  return script.compile({ header: false }).script;
}

/** Convenience for tests and agents that want a scene from a plain description. */
export function compileScene(scene) {
  const script = new MgScript(scene);
  for (const layer of scene.layers ?? []) {
    if (layer.kind === 'svg') script.svg(layer.parent ?? 'comp', layer);
    else if (layer.kind === 'row') script.splitRow(layer.words ?? [], layer);
    else if (layer.kind === 'inline') script.inlineRow(layer.items ?? [], layer);
    else if (layer.kind === 'shape') script.shape(layer.name ?? layer.id, layer);
    else script.text(layer.text ?? layer.name ?? layer.id, layer);
  }
  for (const move of scene.moves ?? []) {
    const ref = script.layers.find(entry => entry.id === move.layerId)?.variable ?? move.layerRef;
    script.ease(ref, move.attr, move);
  }
  for (const group of scene.groups ?? []) script.stagger(group.refs, group);
  for (const patch of scene.patches ?? []) script.patch(patch);
  for (const cutFrame of scene.cuts ?? []) script.cut(cutFrame);
  return script.compile();
}
