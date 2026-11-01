// Motion-fitting tests: every series here is generated from an analytically known curve,
// so "the fit recovered it" is a checkable claim rather than a plausible-looking number.
//
// The two properties worth pinning down are the ladder ordering (a move that a preset
// already reproduces must be reported as that preset, not as a bespoke curve nobody
// recognises) and the honesty of the refusal paths (a band the measurement distrusts has
// to come back `rejected`, never a confident curve fitted to noise).
import test from 'node:test';
import assert from 'node:assert/strict';
import BezierEasing from 'bezier-easing';
import {
  DEFAULT_FIT_OPTIONS, MOTION_FITTING_SCHEMA, classifyCurve, closedFormHandles, curveError,
  customExpression, easeCurve, fitBands, fitCurveHandles, fitMotion, fitSeries, matchPreset,
  optimalYHandles, parameterAt, segmentFit
} from '../src/stages/motionFitting.mjs';
import { MOTION_PRESETS } from '../src/stages/proceduralPromotion.mjs';

/** Normalised samples of a bezier easing at integer frame times. */
function seriesFrom(handles, frames, travel = 1, offset = 0) {
  const easing = BezierEasing(...handles);
  const last = frames[frames.length - 1];
  return frames.map(frame => ({
    frame,
    value: offset + travel * easing((frame - frames[0]) / (last - frames[0]))
  }));
}

test('easeCurve samples a bezier easing and curveError turns it into pixels', () => {
  const identity = easeCurve([0, 0, 1, 1], [0, 0.5, 1]);
  assert.deepEqual(identity, [0, 0.5, 1]);
  // An unusable curve is a failed candidate, not a thrown error.
  assert.equal(easeCurve([2, 0, -1, 1], [0, 1]), null);

  const handles = MOTION_PRESETS.ExpoOut;
  const samples = [0, 0.25, 0.5, 0.75, 1];
  const values = easeCurve(handles, samples);
  assert.equal(curveError(handles, samples, values, 40).maxPx, 0);
  assert.equal(curveError(handles, samples, values, 40).max, 0);
  // The same normalised residual is a different visible error at a different travel, which
  // is exactly why tolerance is expressed in pixels here.
  const offset = values.map(value => value + 0.01);
  assert.equal(curveError(handles, samples, offset, 10).maxPx, 0.1);
  assert.equal(curveError(handles, samples, offset, 100).maxPx, 1);
  assert.equal(curveError(handles, samples, offset, 10).rmsPx, 0.1);
  assert.deepEqual(curveError(handles, samples, offset, 0).residuals.map(() => 0), [0, 0, 0, 0, 0]);
});

test('closedFormHandles seeds the search and fitCurveHandles recovers the curve', () => {
  const handles = [0.16, 1, 0.3, 1];
  const frames = Array.from({ length: 17 }, (_, index) => index);
  const series = seriesFrom(handles, frames, 30);
  const times = series.map(record => record.frame / 16);
  const values = series.map(record => (record.value - series[0].value) / 30);
  const seed = closedFormHandles(times, values);
  assert.equal(seed.length, 4);
  assert.ok(seed.every(Number.isFinite), 'the closed form returns four finite handles');
  assert.deepEqual([seed[0], seed[2]], [1 / 3, 2 / 3]);

  const fitted = fitCurveHandles(times, values, 30);
  assert.ok(fitted.maxPx < 0.05, `a dense exact-bezier series fits to under 0.05 px, got ${fitted.maxPx}`);
  assert.deepEqual(fitted.handles.map(handle => Math.round(handle * 10) / 10), [0.2, 1, 0.3, 1]);
  assert.ok(fitted.handles.every(handle => Number.isFinite(handle)));

  // A series of two points cannot determine four handles; the fit still has to report the
  // error it achieved rather than pretend the shape is known.
  const sparse = fitCurveHandles([0, 1], [0, 1], 10);
  assert.ok(sparse.maxPx <= 1e-6);
});

test('matchPreset only names a curve Stage 3 already emits, and only inside the pixel tolerance', () => {
  const frames = Array.from({ length: 13 }, (_, index) => index * 4);
  for (const [name, handles] of Object.entries(MOTION_PRESETS)) {
    const series = seriesFrom(handles, frames, 25);
    const times = series.map(record => record.frame / 48);
    const values = series.map(record => (record.value - series[0].value) / 25);
    const match = matchPreset(times, values, 25, { tolerancePx: 0.25 });
    assert.ok(match, `${name} matches one of the table's presets`);
    assert.equal(match.maxPx <= DEFAULT_FIT_OPTIONS.tolerancePx, true);
    assert.ok(Object.keys(MOTION_PRESETS).includes(match.name), 'the name is never invented');
    assert.deepEqual(match.handles, [...MOTION_PRESETS[match.name]]);
  }
  // A curve that belongs to no preset is not forced into the nearest one.
  const odd = seriesFrom([0.9, 0.05, 0.1, 0.95], frames, 25);
  const times = odd.map(record => record.frame / 48);
  const values = odd.map(record => (record.value - odd[0].value) / 25);
  assert.equal(matchPreset(times, values, 25, { tolerancePx: 0.25 }), null);
  assert.equal(matchPreset(times, values, 25, { presets: false }), null, '--no-presets disables the rung');
  // A wide tolerance does let a named curve cover a near miss, and says which one.
  const loose = matchPreset(times, values, 25, { tolerancePx: 50 });
  assert.ok(loose && loose.maxPx <= 50);
});

test('customExpression is an easing: exact at both endpoints and close to its own curve', () => {
  const handles = [0.22, 1.4, 0.36, 1];
  const frames = Array.from({ length: 21 }, (_, index) => index);
  const series = seriesFrom(handles, frames, 8);
  const times = series.map(record => record.frame / 20);
  const values = series.map(record => (record.value - series[0].value) / 8);
  const expression = customExpression(times, values, handles, { travel: 8 });
  assert.deepEqual(expression.endpointsExact, [0, 1]);
  assert.equal(expression.variable, 't');
  assert.match(expression.expression, /^t \+ t \* \(1 - t\) \* \(/);
  assert.ok(typeof expression.caveat === 'string' && expression.caveat.length > 0, 'the unverified form is flagged');

  // The emitted text is what a builder pastes into magicEasing(..., "Custom", ...), so it
  // has to evaluate to the endpoints-preserving curve it claims to be.
  const evaluate = new Function('t', `return ${expression.expression}`);
  assert.equal(evaluate(0), 0);
  assert.equal(evaluate(1), 1);
  let versusText = 0;
  for (let index = 0; index < times.length; index += 1) {
    versusText = Math.max(versusText, Math.abs(evaluate(times[index]) - values[index]));
  }
  assert.ok(Math.abs(versusText - expression.maxVsMeasurement) < 1e-5,
    `reported ${expression.maxVsMeasurement} against recomputed ${versusText}`);
  assert.ok(versusText * 8 < 0.5, `the expression tracks the measurement to under half a pixel, got ${versusText * 8}`);
  assert.equal(expression.maxVsFittedCurve === null, false, 'the bezier it approximates is compared too');

  // Endpoints are exact whatever the coefficients turn out to be; a fit to a straight line
  // must not shift the move, which is the failure the t(1-t) basis exists to prevent.
  const linearish = customExpression(times, times.slice(), [0, 0, 1, 1], { travel: 12 });
  assert.deepEqual(linearish.endpointsExact, [0, 1]);
  const straight = new Function('t', `return ${linearish.expression}`);
  assert.equal(straight(0), 0);
  assert.equal(straight(1), 1);
});

test('fitSeries keeps what was measured and drops what was refused, never interpolating a hole', () => {
  const band = {
    series: [
      { frame: 4, dxPx: 0, score: 1, marginPx: null },
      { frame: 2, dxPx: -3, score: 0.99, marginPx: 0.02 },
      { frame: 3, dxPx: null, score: 0.4, marginPx: 0.02, reason: 'no-overlap' },
      { frame: 5, dxPx: -8, score: 0.55, marginPx: 0.02 },
      { frame: 6, dxPx: -10, score: 0.99, marginPx: 0.001 },
      { frame: 7, dxPx: 250, score: 0.99, marginPx: 0.2 },
      { frame: null, dxPx: 1, score: 0.99, marginPx: 0.2 }
    ]
  };
  const { points, dropped, reason } = fitSeries(band, DEFAULT_FIT_OPTIONS);
  assert.equal(reason, null);
  assert.deepEqual(points.map(point => point.frame), [2, 4, 7]);
  assert.deepEqual(dropped.map(record => record.frame), [3, 5, 6, null]);
  assert.match(dropped[0].why, /no-overlap/, 'a refusal carries the measurement\'s own reason');
  assert.match(dropped[1].why, /score 0.55 below 0.9/);
  assert.match(dropped[2].why, /margin 0.001 px below 0.005/);
  assert.deepEqual(dropped[3], { frame: null, why: 'frame-not-integer' });

  // A generic {frame, value} series is the same stage without the band wrapper.
  const generic = fitSeries([{ frame: 0, value: 5 }, { frame: 1, value: 7 }]);
  assert.deepEqual(generic.points.map(point => point.value), [5, 7]);
  assert.deepEqual(generic.dropped, []);
  assert.deepEqual(fitSeries([], DEFAULT_FIT_OPTIONS), { points: [], dropped: [], reason: 'no-frames' });
  assert.deepEqual(fitSeries({ series: [] }, DEFAULT_FIT_OPTIONS).reason, 'no-frames');
});

test('fitMotion walks the ladder from the cheapest representation that meets the tolerance', () => {
  const frames = Array.from({ length: 13 }, (_, index) => index);

  const straight = fitMotion(seriesFrom([0, 0, 1, 1], frames, 18));
  assert.equal(straight.status, 'fit');
  assert.equal(straight.representation, 'linear');
  assert.equal(straight.class, 'linear');
  assert.equal(straight.keyCount, 2);
  assert.equal(straight.maxErrorPx, 0);
  assert.deepEqual(straight.curve.keys.map(key => [key.frame, key.easing]), [[0, 'None'], [12, 'None']]);
  assert.deepEqual(straight.curve.keys.map(key => key.value), [0, 18]);
  assert.equal(straight.curve.expression, undefined, 'a linear move needs no expression');

  const presetted = fitMotion(seriesFrom(MOTION_PRESETS.QuarticOut, frames, 18));
  assert.equal(presetted.representation, 'preset', 'a named curve is preferred over a bespoke one');
  assert.equal(presetted.curve.presetName, 'QuarticOut');
  assert.equal(presetted.curve.keys[1].easing, 'Custom');
  assert.ok(presetted.maxErrorPx <= DEFAULT_FIT_OPTIONS.tolerancePx);

  const bespoke = fitMotion(seriesFrom([0.9, 0.05, 0.1, 0.95], frames, 18), { presets: false });
  assert.equal(bespoke.representation, 'custom');
  assert.equal(bespoke.keyCount, 2);
  assert.ok(bespoke.curve.expression, 'a custom curve ships the expression text with it');
  assert.deepEqual(bespoke.curve.expression.endpointsExact, [0, 1]);
  assert.equal(bespoke.class, classifyCurve(bespoke.curve.handles, 18));

  // The candidate table is reported even when it loses, so "why not a preset?" is answerable.
  assert.deepEqual(bespoke.candidates.map(candidate => candidate.representation), ['linear', 'custom']);
  assert.equal(bespoke.candidates[0].maxPx > DEFAULT_FIT_OPTIONS.tolerancePx, true);
});

test('fitMotion reports static and rejected instead of inventing motion', () => {
  // Movement at the measurement quantum is not motion this pipeline can commit to.
  const still = fitMotion([{ frame: 0, value: 1 }, { frame: 5, value: 1.05 }], { tolerancePx: 0.25 });
  assert.equal(still.status, 'fit');
  assert.equal(still.class, 'static');
  assert.equal(still.representation, 'none');
  assert.deepEqual([still.keyCount, still.keys.length, still.curve], [0, 0, null]);
  assert.equal(still.maxErrorPx, 0);
  assert.match(still.reason, /at or below the 0\.125 px floor/);

  const minTravel = fitMotion([{ frame: 0, value: 0 }, { frame: 5, value: 4 }], { minTravelPx: 6 });
  assert.equal(minTravel.class, 'static');

  const refused = fitMotion([
    { frame: 0, dxPx: null, reason: 'flat-reference' },
    { frame: 1, dxPx: null, reason: 'flat-reference' }
  ]);
  assert.equal(refused.status, 'rejected');
  assert.equal(refused.class, 'unresolved');
  assert.equal(refused.frames, 0);
  assert.deepEqual(refused.droppedFrames.map(record => record.why), ['flat-reference', 'flat-reference']);

  const single = fitMotion([{ frame: 3, value: 12 }]);
  assert.equal(single.status, 'rejected');
  assert.match(single.reason, /fewer than two measured frames/);
  // One measured position repeated at the same frame cannot span a curve.
  const stalled = fitMotion([{ frame: 3, value: 1 }, { frame: 3, value: 9 }]);
  assert.equal(stalled.status, 'rejected');
  assert.match(stalled.reason, /frames do not advance/);
});

test('a move one curve cannot follow becomes breakpoints, not a lie', () => {
  // Accelerate, hold, accelerate, hold: a two-phase move. No single bezier gets inside a
  // quarter pixel of it, so the fit has to add keys at the phase boundaries rather than
  // smooth through them and report a curve that provably misses.
  const measured = [0, 0, 3, 6, 9, 12, 12, 12, 12, 12, 15, 21, 27, 30, 30, 30, 30];
  const series = measured.map((value, frame) => ({ frame, value }));

  const starved = fitMotion(series, { tolerancePx: 0.25, maxKeys: 2 });
  assert.equal(starved.status, 'approximated', 'the key budget is honoured rather than silently exceeded');
  assert.match(starved.reason, /no representation inside 0\.25 px with at most 2 keys/);
  assert.ok(starved.maxErrorPx > 0.25);
  assert.equal(starved.curve.segments.every(segment => segment.exceeded === true), true);
  assert.equal(starved.keyCount, 2);

  const phased = fitMotion(series, { tolerancePx: 0.25 });
  assert.equal(phased.status, 'fit');
  assert.equal(phased.class, 'piecewise');
  assert.equal(phased.representation, 'piecewise');
  assert.ok(phased.keyCount > 2 && phased.keyCount <= DEFAULT_FIT_OPTIONS.maxKeys, `keys ${phased.keyCount}`);
  assert.ok(phased.maxErrorPx <= 0.25, `every segment inside tolerance, got ${phased.maxErrorPx}`);
  const keyFrames = phased.curve.keys.map(key => key.frame);
  assert.deepEqual([keyFrames[0], keyFrames[keyFrames.length - 1]], [0, 16]);
  assert.equal(new Set(keyFrames).size, keyFrames.length, 'no frame is keyed twice');
  // Breakpoint keys are measured values, so the model passes through the reference at every
  // boundary it invented and the split cannot introduce a discontinuity.
  for (const key of phased.curve.keys) {
    assert.equal(key.value, measured[key.frame], `frame ${key.frame} is a measured position`);
  }
  assert.ok(phased.curve.segments.every(segment => segment.maxPx <= 0.25));
  assert.equal(phased.curve.segments.length, phased.keyCount - 1);
  for (let index = 1; index < phased.curve.segments.length; index += 1) {
    assert.equal(phased.curve.segments[index].fromFrame, phased.curve.segments[index - 1].toFrame,
      'segments butt against each other with no gap');
  }
  // A wider tolerance buys fewer keys: this is the knob that trades keys against error.
  const loose = fitMotion(series, { tolerancePx: 3 });
  assert.ok(loose.keyCount < phased.keyCount, `3 px needs ${loose.keyCount} keys, 0.25 px needs ${phased.keyCount}`);

  // segmentFit is callable directly with an already-normalised series.
  const times = series.map(record => record.frame / 16);
  const normalised = series.map(record => record.value / 30);
  const split = segmentFit(series, times, normalised, 30, { ...DEFAULT_FIT_OPTIONS, tolerancePx: 0.25 });
  assert.equal(split.every, true);
  assert.equal(split.keys.length, split.segments.length + 1);
});

test('the search seeds itself from a cheap model and reports the shared evaluator', () => {
  // parameterAt solves x(tau) = t for the same cubic the dependency evaluates, which is what
  // lets a two-dimensional seed sweep stand in for a four-dimensional blind search.
  const axis = (t, first, second) => 3 * (1 - t) ** 2 * t * first + 3 * (1 - t) * t * t * second + t ** 3;
  for (const [x1, x2] of [[0.16, 0.3], [0.5, 0.5], [0.9, 0.1], [0.22, 1], [0.98, 0.02]]) {
    for (let step = 0; step <= 12; step += 1) {
      const time = step / 12;
      const tau = parameterAt(time, x1, x2);
      assert.ok(Math.abs(axis(tau, x1, x2) - time) < 1e-6,
        `x(${tau}) = ${axis(tau, x1, x2)} should be ${time} for handles ${x1},${x2}`);
    }
  }
  // The endpoints are pinned whatever the handles say, because an easing has to be.
  assert.equal(parameterAt(0, 0.9, 0.1), 0);
  assert.equal(parameterAt(1, 0.9, 0.1), 1);

  // optimalYHandles is exact for the y axis once x is fixed: feed it the true curve's own
  // x handles and it returns the true y handles.
  const truth = [0.34, 1.56, 0.64, 1];
  const times = Array.from({ length: 25 }, (_, index) => index / 24);
  const values = times.map(time => BezierEasing(...truth)(time));
  const [y1, y2] = optimalYHandles(times, values, truth[0], truth[2], [-0.6, 1.6]);
  assert.ok(Math.abs(y1 - truth[1]) < 1e-3, `y1 ${y1} against ${truth[1]}`);
  assert.ok(Math.abs(y2 - truth[3]) < 1e-3, `y2 ${y2} against ${truth[3]}`);

  // And the error a fit reports is the error of the curve it returns, recomputed here
  // through the dependency rather than through the search's own model.
  const fit = fitCurveHandles(times, values, 20);
  const easing = BezierEasing(...fit.handles);
  const recomputed = Math.max(...times.map((time, index) => Math.abs(easing(time) - values[index]))) * 20;
  assert.ok(Math.abs(recomputed - fit.maxPx) < 1e-3, `reported ${fit.maxPx} px against ${recomputed} px`);
  assert.ok(fit.maxPx < 0.02, `an exact series fits to ${fit.maxPx} px`);
});

test('sub-quantum measurement jitter does not buy extra keys', () => {
  // A real band carries antialiasing-level noise. If every wiggle cost a breakpoint the
  // stage would emit a sampled table dressed up as a fit, which is the outcome the ladder
  // exists to avoid.
  const truth = MOTION_PRESETS.ExpoOut;
  const easing = BezierEasing(...truth);
  const frames = Array.from({ length: 21 }, (_, index) => index);
  const travel = 24;
  const jittered = frames.map((frame, index) => ({
    frame,
    dxPx: travel * easing(frame / 20) + (index % 2 === 0 ? 0.06 : -0.06),
    score: 0.98,
    marginPx: 0.05
  }));
  const fit = fitMotion({ id: 'wall', quantumPx: 0.125, series: jittered }, { tolerancePx: 0.25 });
  assert.equal(fit.status, 'fit');
  assert.equal(fit.keyCount, 2, `noise inside the quantum stays a two-key move, got ${fit.keyCount} keys`);
  assert.ok(['preset', 'custom'].includes(fit.representation));
  assert.ok(fit.maxErrorPx <= 0.25);
  // The reported error really is the worst deviation from the jittered measurement.
  const curveEasing = BezierEasing(...fit.curve.handles);
  const start = jittered[0].dxPx;
  const fittedTravel = jittered[jittered.length - 1].dxPx - start;
  const worst = Math.max(...jittered.map(record => {
    const time = record.frame / 20;
    return Math.abs((start + fittedTravel * curveEasing(time)) - record.dxPx);
  }));
  assert.ok(worst - fit.maxErrorPx < 0.02, `worst recomputed ${worst} against reported ${fit.maxErrorPx}`);
});

test('classifyCurve names the shape from the curve geometry', () => {
  const cases = [
    [[1 / 3, 1 / 3, 2 / 3, 2 / 3], 'linear'],
    [[0, 0, 1, 1], 'linear'],
    [[0.16, 1, 0.3, 1], 'ease-out'],
    [[0.7, 0.1, 0.9, 0.4], 'ease-in'],
    [[0.34, 1.56, 0.64, 1], 'overshoot'],
    [[0.25, -0.3, 0.6, 1], 'anticipate'],
    [[0.2, 0.9, 0.8, 0.2], 'ease-in-out'],
    [[0.2, 0.5, 0.8, 0.55], 'asymmetric']
  ];
  for (const [handles, expected] of cases) {
    assert.equal(classifyCurve(handles, 20), expected, `${handles.join(',')} is ${expected}`);
  }
  // Below the quantum there is no direction to classify.
  assert.equal(classifyCurve([0.16, 1, 0.3, 1], 0.1), 'static');
  assert.equal(classifyCurve([0.16, 1, 0.3, 1], 0.5, { quantumPx: 1 }), 'static');
  assert.equal(classifyCurve([0.16, 1, 0.3, 1], 0.5), 'ease-out');
});

test('fitBands turns a track-bands report into per-band fits with an honest summary', () => {
  const frames = Array.from({ length: 9 }, (_, index) => index + 28);
  const moving = {
    id: 'wall',
    quantumPx: 0.125,
    anchorFrame: 28,
    maxAnchorSpreadPx: 0.125,
    series: seriesFrom([0.22, 1.4, 0.36, 1], frames, -16).map(record => ({
      ...record, dxPx: record.value, score: 0.99, marginPx: 0.05
    }))
  };
  // The two word-gap edges disagree by 6 px: that band is not one layer moving, and no set
  // of position keys on one layer reproduces it.
  const reflowing = {
    id: 'caption',
    quantumPx: 0.125,
    anchorFrame: 28,
    maxAnchorSpreadPx: 6,
    series: frames.map(frame => ({ frame, dxPx: frame * 0.4, score: 0.98, marginPx: 0.04 }))
  };
  const dead = { id: 'empty', quantumPx: 0.125, series: frames.map(frame => ({ frame, dxPx: null, reason: 'flat-reference' })) };
  const report = {
    schema: 'refclone/band-motion@1',
    anchorFrame: 28,
    bands: [moving, reflowing, dead]
  };
  const artifact = fitBands(report, { tolerancePx: 0.25 });
  assert.equal(artifact.schema, MOTION_FITTING_SCHEMA);
  assert.equal(artifact.sourceSchema, 'refclone/band-motion@1');
  assert.equal(artifact.anchorFrame, 28);
  assert.deepEqual(artifact.parameters, {
    tolerancePx: 0.25, maxKeys: 9, minScore: 0.9, minMarginPx: 0.005, presets: true
  });
  assert.equal(artifact.summary.bands, 3);
  assert.equal(artifact.summary.fitted, 2);
  assert.equal(artifact.summary.approximated, 0);
  assert.equal(artifact.summary.rejected, 1);
  assert.equal(artifact.summary.staticBands, 0);
  assert.deepEqual(artifact.summary.unbuildableBands, ['caption'], 'spread beyond the quantum is not a layer move');
  assert.ok(artifact.summary.maxErrorPx <= 0.25, `the worst reported fit is inside tolerance, got ${artifact.summary.maxErrorPx}`);
  assert.deepEqual(Object.keys(artifact.summary.byClass).sort(), ['linear', 'overshoot', 'unresolved']);
  assert.equal(artifact.summary.twoKeyFits, 2);
  assert.equal(artifact.fits.length, 3);
  assert.deepEqual(artifact.fits.map(fit => fit.id), ['wall', 'caption', 'empty']);
  assert.equal(artifact.fits[0].status, 'fit');
  assert.equal(artifact.fits[2].status, 'rejected');
  assert.ok(artifact.limitations.some(line => /Custom easing expression/.test(line)));
  assert.ok(artifact.limitations.some(line => /not a claim that a render matches/.test(line)));

  // A single band object, not wrapped in a report, is the same call.
  const solo = fitBands(moving, { tolerancePx: 0.25 });
  assert.equal(solo.summary.bands, 1);
  assert.equal(solo.anchorFrame, 28, 'the band carries its own anchor frame');
  assert.equal(solo.fits[0].source, 28);

  // Tolerance is the knob that decides keys-vs-curve, and the summary follows it.
  const loose = fitBands(report, { tolerancePx: 4 });
  assert.equal(loose.summary.twoKeyFits >= 2, true);
  assert.ok(loose.summary.maxErrorPx <= 4);
  assert.equal(loose.fits[1].representation, 'linear', 'a steady reflow is cheap at 4 px');

  // A band fitted from a bare series was fitted on trust: no score means no gate can reject
  // it, and the artifact has to say so rather than look like measured evidence.
  const blind = fitBands({ bands: [{ id: 'hand', series: frames.map(frame => ({ frame, value: frame * 0.5 })) }] });
  assert.equal(blind.fits[0].status, 'fit');
  assert.deepEqual([blind.fits[0].frames, blind.fits[0].scoredFrames], [9, 0]);
  assert.deepEqual(blind.unscoredBands, [{ id: 'hand', frames: 9, scoredFrames: 0 }]);
  assert.deepEqual(artifact.unscoredBands, [], 'a measured report does not raise the flag');
});
