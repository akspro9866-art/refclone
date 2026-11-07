import { fitEasing } from '../solver/bezierCurveFitter.ts';

export interface Sample { t: number; y: number }
export interface Curve {
  kind: 'bezier' | 'spring'; params: number[]; rmse: number; maxError: number;
  overshootPeak: { t: number; value: number }; expression: string; accepted: boolean;
}
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** Invert x with bisection, including vertical/degenerate endpoint handles. */
export function bezierAt(t: number, p: number[]): number {
  const cube = (u: number, a: number, b: number) => 3 * (1-u)**2*u*a + 3*(1-u)*u*u*b + u**3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 45; i++) { const u = (lo+hi)/2; if (cube(u,p[0],p[2]) < t) lo=u; else hi=u; }
  return cube((lo+hi)/2,p[1],p[3]);
}
export function curveAt(curve: Pick<Curve, 'kind' | 'params'>, t: number): number {
  t = clamp(t, 0, 1);
  if (curve.kind === 'bezier') return bezierAt(t, curve.params);
  const [z,w,a] = curve.params, wd = w*Math.sqrt(1-z*z);
  return a*(1-Math.exp(-z*w*t)*(Math.cos(wd*t)+z*w/wd*Math.sin(wd*t)));
}

/** Generated only from bounded numeric parameters; includes spring amplitude. */
export function curveExpression(curve: Pick<Curve, 'kind' | 'params'>): string {
  const p = JSON.stringify(curve.params);
  if (curve.kind === 'spring') return `(function(){var p=${p},z=p[0],w=p[1],a=p[2],wd=w*Math.sqrt(1-z*z),u=Math.max(0,Math.min(1,t));return a*(1-Math.exp(-z*w*u)*(Math.cos(wd*u)+z*w/wd*Math.sin(wd*u)));})()`;
  return `(function(){var p=${p},lo=0,hi=1,u,x;for(var i=0;i<45;i++){u=(lo+hi)/2;x=3*(1-u)*(1-u)*u*p[0]+3*(1-u)*u*u*p[2]+u*u*u;if(x<t)lo=u;else hi=u;}u=(lo+hi)/2;return 3*(1-u)*(1-u)*u*p[1]+3*(1-u)*u*u*p[3]+u*u*u;})()`;
}

/** One analytical curve, never frame baking. Poor/closed-loop trajectories block. */
export function fitCurve(samples: Sample[], tolerance = 0.015): Curve {
  if (!Array.isArray(samples) || samples.length < 4 || samples.length > 512 || !Number.isFinite(tolerance) || tolerance <= 0 || tolerance > .05) throw new Error('CURVE_SAMPLES: need 4..512 samples and bounded tolerance');
  for (let i=0;i<samples.length;i++) if (!Number.isFinite(samples[i].t) || !Number.isFinite(samples[i].y) || (i>0 && samples[i].t<=samples[i-1].t)) throw new Error('CURVE_SAMPLES: finite strictly increasing times required');
  const first=samples[0], last=samples.at(-1)!, delta=last.y-first.y;
  if (Math.abs(delta)<1e-8) throw new Error('CURVE_CLOSED_OR_STATIC: no endpoint displacement');
  const u=samples.map(s=>(s.t-first.t)/(last.t-first.t)), y=samples.map(s=>(s.y-first.y)/delta);
  const seed=fitEasing(samples);
  const kind = Math.max(...y)>1.01 ? 'spring' : 'bezier';
  const bounds=kind==='bezier' ? [[0,1],[-.5,1.5],[0,1],[-.5,1.5]] : [[.05,.95],[.5,40],[.7,1.3]];
  const bounded=(p: number[])=>p.map((v,i)=>clamp(v,bounds[i][0],bounds[i][1]));
  const seeds=kind==='bezier' ? [[.33,.33,.67,.67],[.42,0,.58,1],[.22,1,.36,1]] : [[.3,6,1],[.5,10,1],[.2,14,1],[.7,8,1]];
  if (seed?.kind==='bezier' && kind==='bezier') seeds.unshift(seed.points);
  if (seed?.kind==='spring' && kind==='spring') seeds.unshift([seed.dampingRatio,seed.naturalFrequency,seed.amplitude]);
  const cost=(p: number[])=>y.reduce((sum,v,i)=>sum+(curveAt({kind,params:p},u[i])-v)**2,0)/y.length;
  let best=bounded(seeds[0]), bestCost=cost(best);
  for (const s of seeds) {
    let p=bounded(s), c=cost(p), step=bounds.map(([a,b])=>(b-a)/8);
    for (let round=0;round<100;round++) {
      let changed=false;
      for (let i=0;i<p.length;i++) for (const sign of [-1,1]) {
        const q=p.slice(); q[i]+=sign*step[i]; const b=bounded(q), next=cost(b);
        if(next<c-1e-15){p=b;c=next;changed=true;}
      }
      if(!changed) step=step.map(v=>v/2);
      if(Math.max(...step)<1e-7) break;
    }
    if(c<bestCost){best=p;bestCost=c;}
  }
  const maxError=Math.max(...y.map((v,i)=>Math.abs(curveAt({kind,params:best},u[i])-v)));
  const peak=y.indexOf(Math.max(...y));
  const result: Curve={kind,params:best,rmse:Math.sqrt(bestCost),maxError,overshootPeak:{t:samples[peak].t,value:Math.max(0,y[peak]-1)},expression:'',accepted:Math.sqrt(bestCost)<=tolerance && maxError<=tolerance*2};
  result.expression=curveExpression(result);
  return result;
}
