/**
 * Stage 3.5 — the _mg contract gate.
 *
 * Between Stage 4 (compile) and Stage 5 (render + perceptual diff) the pipeline
 * holds a JavaScript string that is about to be evaluated inside Cavalry. Until
 * this stage existed, the only way to learn that the string was wrong was to
 * dispatch it: a mis-emitted macro surfaced as a half-built scene (the runtime
 * applies macros in order and stops at the first throw) or as a silent
 * substitution, because an unrecognized easing name resolves to SlowInSlowOut
 * without any error at all.
 *
 * So this stage checks the script before it is sent, in two layers:
 *
 * 1. A structural scan of the text for constructs that must never appear in a
 *    compiled promotion script (dynamic evaluation, `debugger`).
 * 2. A dry run of the script in a `node:vm` context whose `_mg` is a recording
 *    stub. The stubs enforce the same preconditions the runtime documents, but
 *    they record instead of throwing, so one pass reports every violation
 *    rather than only the first one. No scene state is touched and no Cavalry
 *    process is involved.
 *
 * On top of the dry run it checks the two things a script cannot check itself:
 * every bound preset is in the verified catalog (and inside the configured
 * allowlist, which `loadProceduralConfig` has always parsed and never enforced),
 * and the set of macros the compiler emitted is exactly the set of promotions
 * the artifact describes — the drift between Stage 3 and Stage 4 that a hash
 * comparison cannot see.
 *
 * Violations carry a severity. Only `error` severity fails the gate; `warning`
 * means the script runs but not as described, `info` means it runs as described
 * with a vocabulary the contract does not know. A caller that wants the honest
 * full picture reads `report.violations`; a caller that wants a decision calls
 * `assertMgContract`.
 */

import vm from 'node:vm';
import { WorkflowError, hashObject } from '../core.mjs';
import { VERIFIED_PRESETS } from './mg-compiler.mjs';

export const MG_CONTRACT_VERSION = '1.0.0';

/**
 * Helper names published by the verified `_mg` runtime contract. A compiled
 * script may only call these; anything else is a name that does not exist at
 * dispatch time.
 */
export const MG_PUBLISHED_HELPERS = Object.freeze([
  'comp', 'set', 'shape', 'layer', 'text', 'wire', 'deform', 'subMesh', 'subMeshLevel',
  'duplicator', 'stagger', 'kf', 'rig', 'ease', 'patch', 'patchSelected', 'patchKeyframeSafe',
  'svg', 'theme', 'applyTheme', 'applySceneTheme', 'modulate', 'connectDynamic', 'semantic', 'semantics', 'find',
  'presetRoots', 'syncToFrames', 'undoGroup', 'keyframe', 'keyframes', 'behavior',
  'trim', 'mask', 'blend', 'typography', 'filter', 'corner', 'selection', 'sel',
  'fromRaster', 'fitToBounds'
]);

/** Read-only tables a script may legitimately read off `_mg`. */
export const MG_PUBLISHED_TABLES = Object.freeze(['EASE_CURVES', 'EASE_ALIASES', 'ASTRYX_THEMES']);

/** The macros refclone's Stage 4 compiler is allowed to emit. */
export const MG_EMITTABLE_MACROS = Object.freeze([
  'undoGroup', 'keyframe', 'keyframes', 'behavior', 'duplicator', 'fromRaster', 'fitToBounds'
]);

/** Macros that change the scene, so they must be inside an undo group. */
export const MG_MUTATION_MACROS = Object.freeze(['keyframe', 'keyframes', 'behavior', 'duplicator']);

/**
 * Property aliases understood by the runtime's `__propertyAttrs` mapping, with
 * the concrete attribute paths each expands to.
 */
export const MG_PROPERTY_ALIASES = Object.freeze({
  x: Object.freeze(['position.x']),
  y: Object.freeze(['position.y']),
  scale_x: Object.freeze(['scale.x']),
  scale_y: Object.freeze(['scale.y']),
  position: Object.freeze(['position.x', 'position.y']),
  scale: Object.freeze(['scale.x', 'scale.y'])
});

/**
 * Attribute paths this build has actually written through the `_mg` surface.
 * The runtime forwards any other property verbatim, so an unknown path is
 * reported as `info`, never as a gate failure.
 */
export const MG_KNOWN_ATTRIBUTE_PATHS = Object.freeze([
  'position.x', 'position.y', 'position.z', 'rotation', 'rotation.x', 'rotation.y', 'rotation.z',
  'scale.x', 'scale.y', 'opacity', 'trimStart', 'trimEnd', 'trimOffset', 'strokeWidth',
  'fill', 'stroke', 'color', 'blur', 'text'
]);

/** Magic-easing curves this Cavalry build accepts verbatim. */
export const MG_EASE_CURVES = Object.freeze([
  'None', 'SlowIn', 'SlowOut', 'SlowInSlowOut', 'VerySlowIn', 'VerySlowOut',
  'VerySlowInVerySlowOut', 'SpringIn', 'SpringOut', 'SpringInSpringOut', 'AnticipateIn',
  'OvershootOut', 'AnticipateInOvershootOut', 'BounceOut'
]);

/** Friendly names refclone emits that this build spells differently. */
export const MG_EASE_ALIASES = Object.freeze({
  QuarticIn: 'SlowIn', QuarticOut: 'SlowOut', QuarticInOut: 'SlowInSlowOut',
  CubicIn: 'SlowIn', CubicOut: 'SlowOut', CubicInOut: 'SlowInSlowOut',
  ExpoIn: 'VerySlowIn', ExpoOut: 'VerySlowOut', ExpoInOut: 'VerySlowInVerySlowOut',
  BackIn: 'AnticipateIn', BackOut: 'OvershootOut', BackInOut: 'AnticipateInOvershootOut',
  Linear: 'None'
});

/** Easing names the lower-level `_rb.ease` table accepts. */
export const MG_RB_EASE_NAMES = Object.freeze([
  'SlowIn', 'SlowOut', 'SlowInSlowOut', 'VerySlowIn', 'VerySlowOut', 'VerySlowInVerySlowOut',
  'SpringIn', 'SpringOut', 'SpringInSpringOut', 'SmallSpringIn', 'SmallSpringOut',
  'SmallSpringInSmallSpringOut', 'AnticipateIn', 'OvershootOut', 'AnticipateInOvershootOut',
  'BounceIn', 'BounceOut', 'BounceInBounceOut', 'None', 'Custom'
]);

/** Easing names `_rb.ease` translates to a curve. */
export const MG_RB_EASE_MAP = Object.freeze({
  Linear: 'None', QuartIn: 'SlowIn', QuartOut: 'SlowOut', QuartInOut: 'SlowInSlowOut',
  QuintIn: 'VerySlowIn', QuintOut: 'VerySlowOut', QuintInOut: 'VerySlowInVerySlowOut',
  ExpoIn: 'VerySlowIn', ExpoOut: 'VerySlowOut', ExpoInOut: 'VerySlowInVerySlowOut',
  CircIn: 'SlowIn', CircOut: 'SlowOut', CircInOut: 'SlowInSlowOut',
  SineIn: 'SlowIn', SineOut: 'SlowOut', SineInOut: 'SlowInSlowOut'
});

/** Stagger/falloff vocabularies, as fixed by procedural-promotion.schema.json. */
export const MG_STAGGER_TYPES = Object.freeze(['temporal', 'spatial']);
export const MG_FALLOFF_TYPES = Object.freeze(['linear']);

const fail = (code, message, details = {}) => {
  throw new WorkflowError(code, message, details);
};

const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);
const isNonEmptyString = value => typeof value === 'string' && value.trim() !== '';
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Resolve a `_mg` property alias to concrete attribute paths.
 *
 * @param {string} property
 * @returns {{attrs: string[], alias: boolean, known: boolean}}
 */
export function resolveMgProperty(property) {
  const key = String(property);
  if (Object.prototype.hasOwnProperty.call(MG_PROPERTY_ALIASES, key)) {
    return { attrs: [...MG_PROPERTY_ALIASES[key]], alias: true, known: true };
  }
  return {
    attrs: [key],
    alias: false,
    known: MG_KNOWN_ATTRIBUTE_PATHS.includes(key)
  };
}

/**
 * Resolve an easing name the way the runtime will, including the silent
 * fallback that makes an unknown name dangerous rather than merely invalid.
 *
 * @param {string|null|undefined} name
 * @returns {{resolved: string, source: 'curve'|'alias'|'rb'|'mapped'|'unmapped'}}
 */
export function resolveMgEasing(name) {
  if (name === null || name === undefined || name === '') {
    return { resolved: 'SlowInSlowOut', source: 'unmapped' };
  }
  const key = String(name);
  if (MG_EASE_CURVES.includes(key)) return { resolved: key, source: 'curve' };
  if (Object.prototype.hasOwnProperty.call(MG_EASE_ALIASES, key)) {
    return { resolved: MG_EASE_ALIASES[key], source: 'alias' };
  }
  if (MG_RB_EASE_NAMES.includes(key)) return { resolved: key, source: 'rb' };
  if (Object.prototype.hasOwnProperty.call(MG_RB_EASE_MAP, key)) {
    return { resolved: MG_RB_EASE_MAP[key], source: 'mapped' };
  }
  return { resolved: 'SlowInSlowOut', source: 'unmapped' };
}

/**
 * Flatten a configured preset allowlist. Accepts the
 * `config.proceduralPromotion.presets` shape (an object of category arrays),
 * a bare array, or a set.
 *
 * @param {Array|Object|null|undefined} presets
 * @returns {string[]|null} Ids, or null when nothing was configured
 */
export function normalizePresetAllowlist(presets) {
  if (presets === null || presets === undefined) return null;
  if (Array.isArray(presets)) return presets.map(String);
  if (presets instanceof Set) return [...presets].map(String);
  if (isPlainObject(presets)) {
    const flat = [];
    for (const value of Object.values(presets)) {
      if (Array.isArray(value)) flat.push(...value.map(String));
      else if (typeof value === 'string') flat.push(value);
    }
    return flat;
  }
  fail('MG_CONTRACT_INVALID', 'presets allowlist must be an array, object of arrays or Set.', { presets });
}

/**
 * Describe one easing block from a keyframe macro.
 *
 * @param {*} easing - raw `spec.easing` value
 * @returns {Array<{code: string, severity: string, message: string}>}
 */
function easingViolations(easing) {
  const found = [];
  if (easing === null || easing === undefined) return found;

  if (typeof easing === 'string') {
    const ease = resolveMgEasing(easing);
    if (ease.source === 'unmapped') {
      found.push({
        severity: 'warning',
        code: 'MG_CONTRACT_EASING_UNMAPPED',
        message: `Easing "${easing}" is not in the verified easing vocabulary; the runtime substitutes ${ease.resolved} without an error.`,
        details: { requested: easing, substituted: ease.resolved }
      });
    }
    return found;
  }

  if (!isPlainObject(easing)) {
    found.push({
      severity: 'error',
      code: 'MG_CONTRACT_EASING_INVALID',
      message: 'Easing must be a name or an object.',
      details: { type: typeof easing }
    });
    return found;
  }

  const weighted = easing.type === 'weighted-bezier'
    || easing.inWeight !== undefined || easing.inAngle !== undefined
    || easing.outWeight !== undefined || easing.outAngle !== undefined;

  if (weighted) {
    const missing = ['inWeight', 'inAngle', 'outWeight', 'outAngle']
      .filter(key => !isFiniteNumber(easing[key]));
    if (missing.length > 0) {
      found.push({
        severity: 'error',
        code: 'MG_CONTRACT_TANGENT_HANDLES_INVALID',
        message: 'Weighted Bézier handles write NaN tangents; every handle must be a finite number.',
        details: { missing }
      });
    }
    return found;
  }

  if (easing.type === 'cubic-bezier' || easing.y1 !== undefined) {
    const missing = ['y1', 'y2'].filter(key => !isFiniteNumber(easing[key]));
    if (missing.length > 0) {
      found.push({
        severity: 'error',
        code: 'MG_CONTRACT_EASING_BEZIER_INCOMPLETE',
        message: 'A cubic-bezier easing block is missing control values; the runtime coerces them to 0 without an error.',
        details: { missing }
      });
    }
    return found;
  }

  if (isNonEmptyString(easing.name)) {
    const ease = resolveMgEasing(easing.name);
    if (ease.source === 'unmapped') {
      found.push({
        severity: 'warning',
        code: 'MG_CONTRACT_EASING_UNMAPPED',
        message: `Easing "${easing.name}" is not in the verified easing vocabulary; the runtime substitutes ${ease.resolved} without an error.`,
        details: { requested: easing.name, substituted: ease.resolved }
      });
    }
    return found;
  }

  found.push({
    severity: 'error',
    code: 'MG_CONTRACT_EASING_INVALID',
    message: 'Easing object carries a shape the runtime ignores: no name, no cubic-bezier pair and no weighted handles.',
    details: { keys: Object.keys(easing) }
  });
  return found;
}

/** Shared head checks for the three element/property macros. */
function elementPropertyViolations(spec, macro) {
  const found = [];
  if (!isPlainObject(spec)) {
    found.push({
      severity: 'error',
      code: `MG_CONTRACT_${macro.toUpperCase()}_INVALID`,
      message: `_mg.${macro} expects a single object spec.`,
      details: { type: typeof spec }
    });
    return { found, attrs: [] };
  }
  if (!isNonEmptyString(spec.element)) {
    found.push({
      severity: 'error',
      code: `MG_CONTRACT_${macro.toUpperCase()}_INVALID`,
      message: `_mg.${macro} needs a non-empty element id.`,
      details: { element: spec.element }
    });
  }
  if (!isNonEmptyString(spec.property)) {
    found.push({
      severity: 'error',
      code: `MG_CONTRACT_${macro.toUpperCase()}_INVALID`,
      message: `_mg.${macro} needs a non-empty property.`,
      details: { property: spec.property }
    });
    return { found, attrs: [] };
  }
  const resolved = resolveMgProperty(spec.property);
  if (!resolved.known) {
    found.push({
      severity: 'info',
      code: 'MG_CONTRACT_ATTRIBUTE_UNKNOWN',
      message: `Property "${spec.property}" is not an alias and not an attribute path this build has written; it is forwarded verbatim.`,
      details: { property: spec.property, attr: resolved.attrs[0] }
    });
  }
  return { found, attrs: resolved.attrs, element: spec.element, property: spec.property };
}

/**
 * Validate a compiled `_mg` script against the runtime contract.
 *
 * @param {Object} params
 * @param {string} params.script - Compiled script text (the dispatch payload)
 * @param {Object} [params.compiled] - Output from `compilePromotionScript`
 * @param {Object} [params.promotion] - Promotion artifact the script was built from
 * @param {Array|Object} [params.presets] - Configured preset allowlist, if any
 * @param {Object} [params.options]
 * @param {number} [params.options.timeoutMs=1000] - Dry-run wall-clock budget
 * @param {number} [params.options.maxCalls=5000] - Macro-call budget
 * @returns {{version: string, ok: boolean, scriptHash: string, violations: Array,
 *   calls: Object, helpers: string[], macros: Array, presets: Object,
 *   atomic: Object, counts: Object}}
 */
export function validateMgContract({ script, compiled, promotion, presets, options = {} }) {
  const violations = [];
  const record = violation => {
    violations.push({ ...violation, macro: violation.macro ?? null, element: violation.element ?? null });
  };

  if (!isNonEmptyString(script)) {
    record({
      severity: 'error',
      code: 'MG_CONTRACT_SCRIPT_MISSING',
      message: 'A compiled script is required before dispatch.'
    });
    return finish({ violations, calls: {}, helpers: [], macros: [], presets: {}, atomic: {}, script: '' });
  }

  const scriptHash = hashObject({ script });

  // ---- Layer 1: structural scan -------------------------------------------
  const DYNAMIC = [
    [/\brequire\s*\(/, 'require()'],
    [/\bimport\s*\(/, 'import()'],
    [/\beval\s*\(/, 'eval()'],
    [/\bnew\s+Function\s*\(/, 'new Function()'],
    [/\bdebugger\b/, 'debugger'],
    [/\bfetch\s*\(/, 'fetch()'],
    [/\bglobalThis\b/, 'globalThis']
  ];
  for (const [pattern, label] of DYNAMIC) {
    if (pattern.test(script)) {
      record({
        severity: 'error',
        code: 'MG_CONTRACT_DYNAMIC_EVAL',
        message: `A compiled promotion script must stay inside the _mg macro surface; it references ${label}.`
      });
    }
  }

  const referencedHelpers = new Set();
  for (const match of script.matchAll(/_mg\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) referencedHelpers.add(match[1]);
  for (const name of referencedHelpers) {
    if (name.startsWith('__')) {
      record({
        severity: 'error',
        code: 'MG_CONTRACT_INTERNAL_HELPER',
        message: `_mg.${name} is an internal helper, not part of the published contract.`,
        details: { helper: name }
      });
    } else if (!MG_PUBLISHED_HELPERS.includes(name) && !MG_PUBLISHED_TABLES.includes(name)) {
      record({
        severity: 'error',
        code: 'MG_CONTRACT_UNKNOWN_HELPER',
        message: `_mg.${name} does not exist in the verified runtime contract.`,
        details: { helper: name }
      });
    }
  }
  if (/\bapi\s*\./.test(script)) {
    record({
      severity: 'warning',
      code: 'MG_CONTRACT_DIRECT_API_USE',
      message: 'The script calls the raw `api` surface; scene changes are expected to ride the _mg macro contract.'
    });
  }
  if (/\b_rb\s*\./.test(script)) {
    record({
      severity: 'warning',
      code: 'MG_CONTRACT_LOWER_LAYER_USE',
      message: 'The script calls `_rb` builders directly, bypassing the _mg macro validation this gate mirrors.'
    });
  }

  // ---- Layer 2: dry run against recording stubs ---------------------------
  const calls = {};
  const macros = [];
  const state = {
    undoDepth: 0,
    undoGroups: 0,
    outsideUndo: 0,
    budgetExceeded: false
  };
  const budget = new Error('MG_CONTRACT_CALL_BUDGET');
  const totalCalls = () => Object.values(calls).reduce((sum, n) => sum + n, 0);

  const bump = name => {
    calls[name] = (calls[name] ?? 0) + 1;
    if (totalCalls() > (options.maxCalls ?? 5000)) {
      if (!state.budgetExceeded) {
        state.budgetExceeded = true;
        record({
          severity: 'error',
          code: 'MG_CONTRACT_CALL_BUDGET',
          message: `The dry run passed ${options.maxCalls ?? 5000} macro calls; a compiled promotion is a bounded script, so this is a runaway loop.`,
          fatal: true
        });
      }
      throw budget;
    }
  };

  const note = (macro, spec, head) => {
    const entry = {
      macro,
      element: head.element ?? spec?.base ?? null,
      property: head.property ?? null,
      undoDepth: state.undoDepth
    };
    macros.push(entry);
    return entry;
  };

  const atomicCheck = macro => {
    if (state.undoDepth === 0) {
      state.outsideUndo += 1;
      record({
        severity: 'error',
        code: 'MG_CONTRACT_NOT_ATOMIC',
        message: `_mg.${macro} changes the scene outside an _mg.undoGroup envelope, so a failure cannot be reverted as one unit.`,
        macro
      });
    }
  };

  const classifyEvaluationError = error => {
    // The dry run raises its errors in the vm realm, so `instanceof` against the
    // host constructors is always false. Classify by the error's own name.
    const name = error && typeof error.name === 'string' ? error.name : '';
    if (name === 'SyntaxError') {
      record({
        severity: 'error',
        code: 'MG_CONTRACT_SCRIPT_SYNTAX',
        message: `The compiled script does not parse: ${error.message}`,
        fatal: true
      });
      return;
    }
    if (name === 'ReferenceError') {
      record({
        severity: 'error',
        code: 'MG_CONTRACT_UNKNOWN_GLOBAL',
        message: `${error.message} — a dispatched promotion script may only reference _mg, api and _rb.`,
        details: { script: script.slice(0, 200) },
        fatal: true
      });
      return;
    }
    record({
      severity: 'error',
      code: 'MG_CONTRACT_EVAL_FAILURE',
      message: `The dry run stopped: ${error && error.message ? error.message : String(error)}`,
      fatal: true
    });
  };

  const stubs = {
    fromRaster(x, y, compWidth, compHeight) {
      bump('fromRaster');
      let rx = x;
      let ry = y;
      let cw = compWidth;
      let ch = compHeight;
      if (x && typeof x === 'object') {
        if (Array.isArray(x)) { rx = x[0]; ry = x[1]; } else { rx = x.x; ry = x.y; }
        cw = y;
        ch = compWidth;
      }
      const px = Number(rx);
      const py = Number(ry);
      if (!Number.isFinite(px) || !Number.isFinite(py)) {
        record({
          severity: 'error',
          code: 'MG_CONTRACT_FROMRASTER_INVALID',
          message: '_mg.fromRaster needs finite x/y video pixels; a NaN would silently move the layer.',
          macro: 'fromRaster'
        });
        return { x: 0, y: 0 };
      }
      const width = Number(cw) > 0 ? Number(cw) : 1920;
      const height = Number(ch) > 0 ? Number(ch) : 1080;
      return { x: px - width / 2, y: height / 2 - py };
    },
    fitToBounds(layerId, targetBox, options) {
      bump('fitToBounds');
      const handle = String(layerId == null ? '' : layerId);
      const entry = note('fitToBounds', null, { element: handle });
      entry.space = isPlainObject(options) ? String(options.space ?? 'comp') : 'comp';
      atomicCheck('fitToBounds');
      const opts = isPlainObject(options) ? options : {};
      let spec = targetBox;
      if (Array.isArray(spec)) spec = { x: spec[0], y: spec[1], width: spec[2], height: spec[3] };
      const width = Number(spec?.width);
      const height = Number(spec?.height);
      if (!isNonEmptyString(handle)) {
        record({
          severity: 'error',
          code: 'MG_CONTRACT_FITTOBOUNDS_INVALID',
          message: '_mg.fitToBounds needs a non-empty layer id or alias.',
          macro: 'fitToBounds'
        });
      }
      if (!isPlainObject(spec) || !(width > 0) || !(height > 0)) {
        record({
          severity: 'error',
          code: 'MG_CONTRACT_FITTOBOUNDS_INVALID',
          message: '_mg.fitToBounds needs a target box with positive width and height.',
          macro: 'fitToBounds'
        });
      }
      if (opts.tolerance !== undefined) {
        const tolerance = Number(opts.tolerance);
        if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 0.5) {
          record({
            severity: 'error',
            code: 'MG_CONTRACT_LAYOUT_TOLERANCE',
            message: 'Layout tolerance is capped at 0.5 px; a looser fit starts Stage 5 outside its bbox gate.',
            macro: 'fitToBounds',
            details: { tolerance: opts.tolerance }
          });
        }
      }
      return {
        ok: true,
        layerId: handle,
        space: opts.space ?? 'comp',
        target: spec && typeof spec === 'object'
          ? { x: Number(spec.x), y: Number(spec.y), width, height }
          : null
      };
    },
    undoGroup(spec) {
      bump('undoGroup');
      if (!isPlainObject(spec) || typeof spec.operations !== 'function') {
        record({
          severity: 'error',
          code: 'MG_CONTRACT_UNDOGROUP_INVALID',
          message: '_mg.undoGroup requires an object spec with an operations function.'
        });
        return null;
      }
      state.undoGroups += 1;
      if (!isNonEmptyString(spec.name) && !isNonEmptyString(spec.id)) {
        record({
          severity: 'warning',
          code: 'MG_CONTRACT_UNDOGROUP_UNNAMED',
          message: 'The atomic undo group has no id or name, so the scene history cannot identify it.'
        });
      }
      state.undoDepth += 1;
      try {
        return spec.operations();
      } catch (error) {
        if (error === budget) throw error;
        // An error thrown by the script itself (not by a macro) stops the group
        // part-way, which is exactly the half-built scene this gate exists to
        // prevent. Report the cause and the abort.
        classifyEvaluationError(error);
        record({
          severity: 'error',
          code: 'MG_CONTRACT_UNDOGROUP_ABORTED',
          message: 'The atomic undo group stopped part-way through its operations.',
          fatal: true
        });
        return null;
      } finally {
        state.undoDepth -= 1;
      }
    },

    keyframe(spec) {
      bump('keyframe');
      const head = elementPropertyViolations(spec, 'keyframe');
      head.found.forEach(record);
      if (!isPlainObject(spec)) return null;
      atomicCheck('keyframe');
      note('keyframe', spec, head);

      const startFrame = Math.round(Number(spec.startFrame));
      const endFrame = Math.round(Number(spec.endFrame));
      if (!Number.isFinite(startFrame) || !Number.isFinite(endFrame) || startFrame === endFrame) {
        record({
          severity: 'error',
          code: 'MG_CONTRACT_KEYFRAME_INVALID',
          message: '_mg.keyframe needs two distinct finite frame boundaries.',
          macro: 'keyframe',
          element: spec.element,
          details: { startFrame: spec.startFrame, endFrame: spec.endFrame }
        });
      }
      if (startFrame < 0 || endFrame < 0) {
        record({
          severity: 'error',
          code: 'MG_CONTRACT_KEYFRAME_INVALID',
          message: 'Keyframe frames must be non-negative.',
          macro: 'keyframe',
          element: spec.element,
          details: { startFrame, endFrame }
        });
      }
      const startValue = Number(spec.startValue);
      const endValue = Number(spec.endValue);
      if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) {
        record({
          severity: 'error',
          code: 'MG_CONTRACT_KEYFRAME_INVALID',
          message: '_mg.keyframe requires finite startValue and endValue.',
          macro: 'keyframe',
          element: spec.element,
          details: { startValue: spec.startValue, endValue: spec.endValue }
        });
      }
      easingViolations(spec.easing).forEach(violation => record({ ...violation, element: spec.element }));
      return null;
    },

    keyframes(spec) {
      bump('keyframes');
      const head = elementPropertyViolations(spec, 'keyframes');
      head.found.forEach(record);
      if (!isPlainObject(spec)) return null;
      atomicCheck('keyframes');
      note('keyframes', spec, head);

      const points = Array.isArray(spec.points) ? spec.points : null;
      if (!points || points.length < 2) {
        record({
          severity: 'error',
          code: 'MG_CONTRACT_KEYFRAMES_INVALID',
          message: '_mg.keyframes requires at least two points.',
          macro: 'keyframes',
          element: spec.element,
          details: { count: points ? points.length : null }
        });
        return null;
      }
      const seen = new Set();
      points.forEach((point, index) => {
        if (!isPlainObject(point)) {
          record({
            severity: 'error',
            code: 'MG_CONTRACT_KEYFRAMES_INVALID',
            message: `Point ${index} is not an object.`,
            macro: 'keyframes',
            element: spec.element
          });
          return;
        }
        const frame = Math.round(Number(point.frame));
        if (!Number.isFinite(frame) || frame < 0) {
          record({
            severity: 'error',
            code: 'MG_CONTRACT_KEYFRAMES_INVALID',
            message: `Point ${index} needs a non-negative integer frame.`,
            macro: 'keyframes',
            element: spec.element,
            details: { frame: point.frame }
          });
        }
        if (!Number.isFinite(point.value)) {
          record({
            severity: 'error',
            code: 'MG_CONTRACT_KEYFRAMES_INVALID',
            message: `Point ${index} has a non-finite value.`,
            macro: 'keyframes',
            element: spec.element,
            details: { value: point.value }
          });
        }
        if (seen.has(frame)) {
          record({
            severity: 'warning',
            code: 'MG_CONTRACT_KEYFRAME_DUPLICATE',
            message: `Frame ${frame} is keyed twice for ${spec.element}.${spec.property}; the later write wins.`,
            macro: 'keyframes',
            element: spec.element
          });
        }
        seen.add(frame);
        if (point.handles !== undefined && point.handles !== null) {
          easingViolations({ ...point.handles }).forEach(violation => record({ ...violation, element: spec.element }));
        }
      });
      easingViolations(spec.easing).forEach(violation => record({ ...violation, element: spec.element }));
      return null;
    },

    behavior(spec) {
      bump('behavior');
      const head = elementPropertyViolations(spec, 'behavior');
      head.found.forEach(record);
      if (!isPlainObject(spec)) return null;
      atomicCheck('behavior');
      note('behavior', spec, head);

      const type = String(spec.type ?? 'spring').toLowerCase();
      if (type !== 'spring') {
        record({
          severity: 'error',
          code: 'MG_CONTRACT_BEHAVIOR_INVALID',
          message: `_mg.behavior only supports type "spring" (got "${type}"), and the runtime throws at dispatch.`,
          macro: 'behavior',
          element: spec.element
        });
        return null;
      }
      const params = isPlainObject(spec.parameters) ? spec.parameters : {};
      const zeta = Number(params.dampingRatio);
      const omega0 = Number(params.naturalFrequency);
      if (!Number.isFinite(zeta) || zeta < 0) {
        record({
          severity: 'error',
          code: 'MG_CONTRACT_BEHAVIOR_INVALID',
          message: 'A spring behavior needs a finite dampingRatio >= 0.',
          macro: 'behavior',
          element: spec.element,
          details: { dampingRatio: params.dampingRatio }
        });
      }
      if (!Number.isFinite(omega0) || omega0 <= 0) {
        record({
          severity: 'error',
          code: 'MG_CONTRACT_BEHAVIOR_INVALID',
          message: 'A spring behavior needs a finite naturalFrequency > 0.',
          macro: 'behavior',
          element: spec.element,
          details: { naturalFrequency: params.naturalFrequency }
        });
      }
      for (const key of ['initialValue', 'targetValue']) {
        if (!Number.isFinite(params[key])) {
          record({
            severity: 'error',
            code: 'MG_CONTRACT_BEHAVIOR_INVALID',
            message: `A spring behavior needs a finite ${key}.`,
            macro: 'behavior',
            element: spec.element,
            details: { [key]: params[key] }
          });
        }
      }
      const duration = Number(spec.duration);
      if (!Number.isFinite(duration) || duration <= 0) {
        record({
          severity: 'warning',
          code: 'MG_CONTRACT_SPRING_DURATION_UNSPECIFIED',
          message: 'Without a positive duration the runtime samples the spring to the active comp end frame, which is scene state this pipeline does not control.',
          macro: 'behavior',
          element: spec.element,
          details: { duration: spec.duration }
        });
      }
      return null;
    },

    duplicator(spec) {
      bump('duplicator');
      if (!isPlainObject(spec)) {
        record({
          severity: 'error',
          code: 'MG_CONTRACT_DUPLICATOR_INVALID',
          message: '_mg.duplicator needs an object spec with a base layer.'
        });
        return null;
      }
      atomicCheck('duplicator');
      macros.push({ macro: 'duplicator', element: spec.base ?? null, property: null, undoDepth: state.undoDepth });
      if (!isNonEmptyString(spec.base)) {
        record({
          severity: 'error',
          code: 'MG_CONTRACT_DUPLICATOR_INVALID',
          message: '_mg.duplicator requires a non-empty base layer id.',
          macro: 'duplicator'
        });
      }
      const count = spec.count;
      const countOk = Array.isArray(count)
        ? count.length === 2 && count.every(value => Number.isFinite(value) && value >= 1)
        : Number.isFinite(count) && count >= 1;
      if (!countOk) {
        record({
          severity: 'error',
          code: 'MG_CONTRACT_DUPLICATOR_INVALID',
          message: 'A duplicator needs a count of at least one (a number or an [x, y] pair).',
          macro: 'duplicator',
          element: spec.base,
          details: { count }
        });
      }
      if (spec.distribution !== undefined && !['linear', 'grid', 'circle', 'point'].includes(String(spec.distribution))) {
        record({
          severity: 'warning',
          code: 'MG_CONTRACT_DUPLICATOR_DISTRIBUTION',
          message: `Distribution "${spec.distribution}" is not in the runtime vocabulary; it falls back to linear.`,
          macro: 'duplicator'
        });
      }
      if (spec.stagger !== undefined && spec.stagger !== null) {
        const stagger = isPlainObject(spec.stagger) ? spec.stagger : {};
        if (!isPlainObject(spec.stagger)) {
          record({
            severity: 'error',
            code: 'MG_CONTRACT_DUPLICATOR_INVALID',
            message: 'Stagger must be an object spec.',
            macro: 'duplicator'
          });
        }
        if (stagger.type !== undefined && !MG_STAGGER_TYPES.includes(String(stagger.type))) {
          record({
            severity: 'error',
            code: 'MG_CONTRACT_DUPLICATOR_STAGGER_TYPE',
            message: `Stagger type "${stagger.type}" is outside the promotion schema vocabulary [${MG_STAGGER_TYPES.join(', ')}].`,
            macro: 'duplicator'
          });
        }
        for (const key of ['lagFrames', 'offset']) {
          if (stagger[key] !== undefined && !Number.isFinite(stagger[key])) {
            record({
              severity: 'error',
              code: 'MG_CONTRACT_DUPLICATOR_INVALID',
              message: `Stagger ${key} must be a finite number.`,
              macro: 'duplicator',
              details: { [key]: stagger[key] }
            });
          }
        }
      }
      if (spec.falloff !== undefined && spec.falloff !== null) {
        const falloff = isPlainObject(spec.falloff) ? spec.falloff : {};
        if (falloff.type !== undefined && !MG_FALLOFF_TYPES.includes(String(falloff.type))) {
          record({
            severity: 'error',
            code: 'MG_CONTRACT_DUPLICATOR_FALLOFF_TYPE',
            message: `Falloff type "${falloff.type}" is outside the promotion schema vocabulary [${MG_FALLOFF_TYPES.join(', ')}].`,
            macro: 'duplicator'
          });
        }
        if (falloff.influence !== undefined
          && (!Number.isFinite(falloff.influence) || falloff.influence < 0 || falloff.influence > 1)) {
          record({
            severity: 'error',
            code: 'MG_CONTRACT_DUPLICATOR_INVALID',
            message: 'Falloff influence must be a number between 0 and 1.',
            macro: 'duplicator',
            details: { influence: falloff.influence }
          });
        }
      }
      return null;
    }
  };

  const inert = name => (...args) => {
    bump(name);
    if (!MG_EMITTABLE_MACROS.includes(name)) {
      record({
        severity: 'warning',
        code: 'MG_CONTRACT_MACRO_NOT_EMITTABLE',
        message: `_mg.${name} is a published helper but not one of the macros the Stage 4 compiler emits; its contract is not checked here.`,
        macro: name
      });
    }
    return { helper: name, args: args.length };
  };

  const table = { ...stubs };
  for (const name of MG_PUBLISHED_HELPERS) if (!table[name]) table[name] = inert(name);

  const mg = new Proxy(table, {
    get(target, property) {
      if (typeof property !== 'string') return undefined;
      if (MG_PUBLISHED_TABLES.includes(property)) return Object.freeze({});
      if (!Object.prototype.hasOwnProperty.call(target, property)) {
        // Layer 1 already reported an unknown or internal name; keep the dry run
        // going so it can check the rest of the script.
        return inert(property);
      }
      return target[property];
    }
  });

  const api = new Proxy({}, {
    get: () => () => undefined,
    set: () => true,
    has: () => true
  });
  const rb = new Proxy(table, {
    get: (target, property) => (typeof property === 'string' ? inert(property) : undefined)
  });
  const consoleSink = { warn() {}, error() {}, log() {}, info() {} };

  const sandbox = { _mg: mg, api, _rb: rb, console: consoleSink };
  vm.createContext(sandbox);

  let evaluated = true;
  try {
    vm.runInContext(script, sandbox, {
      timeout: options.timeoutMs ?? 1000,
      filename: 'mg-contract-dry-run.js'
    });
  } catch (error) {
    evaluated = false;
    if (error !== budget) classifyEvaluationError(error);
  }

  // ---- Layer 3: the two things the script cannot check about itself --------
  const presetList = normalizePresetAllowlist(presets);
  const bindings = [];
  for (const binding of compiled?.presetBindings ?? []) {
    const presetId = binding?.presetId;
    if (presetId === null || presetId === undefined) continue;
    bindings.push(String(presetId));
    if (!Object.prototype.hasOwnProperty.call(VERIFIED_PRESETS, String(presetId))) {
      record({
        severity: 'error',
        code: 'MG_CONTRACT_UNVERIFIED_PRESET',
        message: `Preset "${presetId}" is not in the verified catalog, so its runtime behaviour is unproven.`,
        details: { presetId }
      });
    } else if (presetList && !presetList.includes(String(presetId))) {
      record({
        severity: 'error',
        code: 'MG_CONTRACT_PRESET_NOT_ALLOWED',
        message: `Preset "${presetId}" is verified but outside config.proceduralPromotion.presets.`,
        details: { presetId, allowed: presetList }
      });
    }
  }
  for (const expression of compiled?.expressions ?? []) {
    const presetId = expression?.presetBinding;
    if (isNonEmptyString(presetId) && !bindings.includes(presetId)) {
      bindings.push(presetId);
      if (!Object.prototype.hasOwnProperty.call(VERIFIED_PRESETS, presetId)) {
        record({
          severity: 'error',
          code: 'MG_CONTRACT_UNVERIFIED_PRESET',
          message: `Expression preset "${presetId}" is not in the verified catalog.`,
          details: { presetId, kind: expression?.kind ?? null }
        });
      }
    }
  }

  const drift = promotion ? promotionDrift(promotion, macros) : null;
  if (drift) {
    for (const missing of drift.missing) {
      record({
        severity: 'error',
        code: 'MG_CONTRACT_PROMOTION_NOT_EMITTED',
        message: `Stage 3 promoted ${missing} but the compiled script has no macro for it.`,
        details: missing
      });
    }
    for (const extra of drift.extra) {
      record({
        severity: 'error',
        code: 'MG_CONTRACT_UNPROMOTED_MACRO',
        message: `The compiled script writes ${extra}, which Stage 3 did not promote.`,
        details: extra
      });
    }
    for (const label of drift.duplicatorMissing) {
      record({
        severity: 'error',
        code: 'MG_CONTRACT_DUPLICATOR_NOT_EMITTED',
        message: `Stage 3 detected duplicator group ${label} but no _mg.duplicator writes it.`,
        details: { base: label }
      });
    }
    for (const label of drift.duplicatorExtra) {
      record({
        severity: 'error',
        code: 'MG_CONTRACT_UNDETECTED_DUPLICATOR',
        message: `The script writes a duplicator on ${label}, which Stage 3 did not detect.`,
        details: { base: label }
      });
    }
  }

  return finish({
    violations,
    calls,
    helpers: [...referencedHelpers],
    macros,
    presets: { bindings, allowlist: presetList },
    atomic: {
      groups: state.undoGroups,
      mutationsOutsideUndo: state.outsideUndo,
      envelope: state.undoGroups > 0 ? (state.undoGroups === 1 ? 'single' : 'multiple') : (macros.length > 0 ? 'none' : 'empty')
    },
    evaluated,
    script,
    drift,
    scriptHash
  });
}

/**
 * Compare the promotion set the artifact describes with the macros the script
 * actually writes. `none` and `static` promotions are deliberately not emitted.
 *
 * @param {Object} promotion - procedural-promotion artifact
 * @param {Array<{macro: string, element: string|null, property: string|null}>} macros
 * @returns {{missing: string[], extra: string[], duplicatorMissing: string[], duplicatorExtra: string[]}}
 */
function promotionDrift(promotion, macros) {
  const expected = new Map();
  for (const element of promotion.elements ?? []) {
    for (const item of element.promotions ?? []) {
      if (item.promotion === 'none' || item.promotion === 'static') continue;
      const key = `${item.elementId}.${item.property}`;
      expected.set(key, (expected.get(key) ?? 0) + 1);
    }
  }
  const emitted = new Map();
  const emittedBases = new Map();
  for (const entry of macros) {
    if (entry.macro === 'duplicator') {
      emittedBases.set(String(entry.element), (emittedBases.get(String(entry.element)) ?? 0) + 1);
      continue;
    }
    if (!MG_MUTATION_MACROS.includes(entry.macro)) continue;
    const key = `${entry.element}.${entry.property}`;
    emitted.set(key, (emitted.get(key) ?? 0) + 1);
  }

  const missing = [];
  const extra = [];
  for (const [key, count] of expected) {
    const got = emitted.get(key) ?? 0;
    if (got < count) missing.push(`${key} (${count - got} macro(s))`);
  }
  for (const [key, count] of emitted) {
    const want = expected.get(key) ?? 0;
    if (count > want) extra.push(`${key} (${count - want} macro(s))`);
  }

  const duplicatorMissing = [];
  const duplicatorExtra = [];
  for (const group of promotion.duplicatorGroups ?? []) {
    const base = String(group.baseElementId);
    const got = emittedBases.get(base) ?? 0;
    if (got === 0) duplicatorMissing.push(base);
  }
  const expectedBases = new Set((promotion.duplicatorGroups ?? []).map(group => String(group.baseElementId)));
  for (const base of emittedBases.keys()) {
    if (!expectedBases.has(base)) duplicatorExtra.push(base);
  }

  return { missing, extra, duplicatorMissing, duplicatorExtra };
}

function finish({ violations, calls, helpers, macros, presets, atomic, evaluated = true, script, drift = null, scriptHash = null }) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const violation of violations) counts[violation.severity] += 1;
  return {
    version: MG_CONTRACT_VERSION,
    ok: counts.error === 0,
    evaluated,
    scriptHash,
    scriptLength: script.length,
    calls,
    helpers,
    macros,
    presets,
    atomic,
    drift,
    layout: {
      ops: macros.filter(entry => entry.macro === 'fitToBounds').length,
      rasterConversions: calls.fromRaster ?? 0
    },
    counts,
    violations
  };
}

/**
 * Turn a failing contract report into the error the pipeline surfaces. The
 * message names the codes rather than dumping payloads: whoever reads it is
 * deciding what to fix, and the full report stays on `report.violations`.
 *
 * @param {Object} report - Output from `validateMgContract`
 * @param {Object} [context] - Extra fields attached to the WorkflowError details
 * @returns {Object} the same report, for chaining
 * @throws {WorkflowError} MG_CONTRACT_INVALID when the report has errors
 */
export function assertMgContract(report, context = {}) {
  if (!report || typeof report !== 'object') {
    fail('MG_CONTRACT_INVALID', 'A contract report is required.', context);
  }
  if (report.ok) return report;
  const errors = report.violations.filter(violation => violation.severity === 'error');
  const codes = [...new Set(errors.map(violation => violation.code))];
  const first = errors[0];
  fail(
    'MG_CONTRACT_INVALID',
    `Compiled _mg script fails the Stage 3.5 contract gate (${errors.length} error(s): ${codes.join(', ')}). `
      + `First: ${first.message}`,
    { ...context, codes, violations: errors, scriptHash: report.scriptHash }
  );
  return report;
}
