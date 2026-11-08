/**
 * End-to-end loop: verified Stage 4/5 output -> Stage 6 style preset + Qoder
 * skill -> MCP instantiate (new SaaS idea, new duration/palette) -> live
 * Cavalry render -> reverse rig sync.
 *
 * Run:
 *   node scripts/test_cloned_style_loop.ts
 *
 * What it proves, in order:
 *   1. Stage 6 accepts a verified `_mg` manifest and writes BOTH artifacts to
 *      the real preset directory and the refclone skill directory.
 *   2. The built cavalry-mcp server (loaded from the workspace, not a copy)
 *      lists the runtime style immediately — no rebuild or restart.
 *   3. `instantiate_cloned_style` hydrates new copy/palette into a 6 s comp,
 *      posts ONE atomic batch-step to the live Stallion bridge, and captures
 *      the hero frame (norm 0.5) as a real PNG.
 *   4. `sync_active_comp_to_cloned_style` reads the live comp back (native
 *      handler when the bridge has it, batch-step fallback otherwise) and
 *      folds manual tweaks into the preset: unanimous rethemes move palette
 *      slots, mixed edits stay per-layer rig overrides, font sizes persist.
 *
 * The user's open reference project is never saved or overwritten: the test
 * creates a NEW composition, and restores the previously active comp at the
 * end. All live mutations are listed in the report.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import pngjs from 'pngjs';
import { extractStylePreset } from '../src/stages/stage6_extract_style.ts';

const { PNG } = pngjs as unknown as { PNG: { sync: { read(buffer: Buffer): { width: number; height: number; data: Buffer } } } };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REFCLONE_ROOT = path.resolve(HERE, '..');
const CAVALRY_MCP_ROOT = path.resolve(REFCLONE_ROOT, '..', 'cavalry-mcp');
const OUTPUT_DIR = path.join(HERE, 'output');
const STYLE_ID = 'smoke_test_style';
const BRIDGE = process.env.STALLION_URL ?? 'http://127.0.0.1:8080';
const PRESET_PATH = path.join(CAVALRY_MCP_ROOT, 'src', 'presets', 'cloned', `${STYLE_ID}.json`);
const SKILL_PATH = path.join(REFCLONE_ROOT, '.qoder', 'skills', `style-${STYLE_ID}.md`);
const REPORT_PATH = path.join(OUTPUT_DIR, 'cloned_style_loop_report.json');

const failures: string[] = [];
let activeCompBefore: string | null = null;
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------------------
// 1. Mock verified Stage 4 `_mg` manifest (a small SaaS kinetic promo).
//    Geometry is in Cavalry comp space (y up); Stage 6 normalizes it.
// ---------------------------------------------------------------------------
const COMP = { width: 1920, height: 1080, fps: 30, endFrame: 120, bg: '#0B0C10' };
const PRIMARY = '#4F5DFF';
const ACCENT = '#2AD8C5';
const TEXT = '#F4F6FF';
const BG = '#0B0C10';

const manifest = {
  comp: COMP,
  layers: [
    { as: 'background', kind: 'shape', shape: 'rectangle', name: 'Background', attrs: { position: [0, 0], 'generator.dimensions': [1920, 1080], 'material.materialColor': BG } },
    { as: 'badge_fill', kind: 'shape', shape: 'rectangle', name: 'Badge Fill', attrs: { position: [0, 330], 'generator.dimensions': [300, 56], 'material.materialColor': PRIMARY } },
    { as: 'badge_label', kind: 'text', name: 'Badge Label', text: 'NEW · 2026', size: 22, color: TEXT, attrs: { position: [0, 330], autoWidth: true, autoHeight: true } },
    { as: 'headline', kind: 'text', name: 'Headline', text: 'Build faster with Northstar', size: 96, color: TEXT, attrs: { position: [0, 170], autoWidth: true, autoHeight: true } },
    { as: 'subhead', kind: 'text', name: 'Subhead', text: 'The workspace for product teams that ship weekly', size: 32, color: TEXT, attrs: { position: [0, 60], autoWidth: true, autoHeight: true } },
    { as: 'accent_rule', kind: 'shape', shape: 'rectangle', name: 'Accent Rule', attrs: { position: [0, 110], 'generator.dimensions': [220, 8], 'material.materialColor': ACCENT } },
    { as: 'cta_fill', kind: 'shape', shape: 'rectangle', name: 'CTA Fill', attrs: { position: [0, -210], 'generator.dimensions': [400, 92], 'material.materialColor': PRIMARY } },
    { as: 'cta_label', kind: 'text', name: 'CTA Label', text: 'Start free', size: 30, color: TEXT, attrs: { position: [0, -210], autoWidth: true, autoHeight: true } },
    { as: 'card_1', kind: 'text', name: 'Card1', text: 'SOC 2 Type II', size: 24, color: TEXT, attrs: { position: [-560, -360], autoWidth: true, autoHeight: true } },
    { as: 'card_2', kind: 'text', name: 'Card2', text: '99.99% uptime', size: 24, color: TEXT, attrs: { position: [0, -360], autoWidth: true, autoHeight: true } },
    { as: 'card_3', kind: 'text', name: 'Card3', text: '5-min setup', size: 24, color: TEXT, attrs: { position: [560, -360], autoWidth: true, autoHeight: true } },
  ],
  ops: [
    { op: 'keyframe', target: '$badge_fill', frames: [0, 12].map((frame, i) => ({ frame, attrs: { 'position.x': 0, 'position.y': i === 0 ? 360 : 330, opacity: i === 0 ? 0 : 100 } })), easing: [{ frame: 12, attr: 'opacity', easing: 'SlowOut' }] },
    { op: 'keyframe', target: '$badge_label', frames: [0, 12].map((frame, i) => ({ frame, attrs: { 'position.x': 0, 'position.y': i === 0 ? 360 : 330, opacity: i === 0 ? 0 : 100 } })), easing: [{ frame: 12, attr: 'opacity', easing: 'SlowOut' }] },
    { op: 'keyframe', target: '$headline', frames: [{ frame: 0, attrs: { 'position.x': 0, 'position.y': 260 } }, { frame: 18, attrs: { 'position.x': 0, 'position.y': 170 } }], easing: [{ frame: 18, attr: 'position', easing: 'SpringOut' }] },
    { op: 'keyframe', target: '$subhead', frames: [{ frame: 6, attrs: { 'position.x': 0, 'position.y': 110, opacity: 0 } }, { frame: 24, attrs: { 'position.x': 0, 'position.y': 60, opacity: 100 } }], easing: [{ frame: 24, attr: 'position', easing: 'SlowOut' }, { frame: 24, attr: 'opacity', easing: 'SlowOut' }] },
    { op: 'keyframe', target: '$accent_rule', frames: [{ frame: 14, attrs: { 'position.x': 0, 'position.y': 110, 'scale.x': 0.15, 'scale.y': 1 } }, { frame: 30, attrs: { 'position.x': 0, 'position.y': 110, 'scale.x': 1, 'scale.y': 1 } }], easing: [{ frame: 30, attr: 'scale', easing: 'SpringOut' }] },
    { op: 'keyframe', target: '$cta_fill', frames: [{ frame: 16, attrs: { 'position.x': 0, 'position.y': -250, 'scale.x': 0.92, 'scale.y': 0.92 } }, { frame: 30, attrs: { 'position.x': 0, 'position.y': -210, 'scale.x': 1, 'scale.y': 1 } }], easing: [{ frame: 30, attr: 'scale', easing: 'SpringOut' }, { frame: 30, attr: 'position', easing: 'SpringOut' }] },
    { op: 'keyframe', target: '$cta_label', frames: [{ frame: 16, attrs: { 'position.x': 0, 'position.y': -250 } }, { frame: 30, attrs: { 'position.x': 0, 'position.y': -210 } }], easing: [{ frame: 30, attr: 'position', easing: 'SpringOut' }] },
    { op: 'keyframe', target: '$card_1', frames: [{ frame: 30, attrs: { 'position.x': -560, 'position.y': -420 } }, { frame: 46, attrs: { 'position.x': -560, 'position.y': -360 } }], easing: [{ frame: 46, attr: 'position', easing: 'SlowOut' }] },
    { op: 'keyframe', target: '$card_2', frames: [{ frame: 34, attrs: { 'position.x': 0, 'position.y': -420 } }, { frame: 50, attrs: { 'position.x': 0, 'position.y': -360 } }], easing: [{ frame: 50, attr: 'position', easing: 'SlowOut' }] },
    { op: 'keyframe', target: '$card_3', frames: [{ frame: 38, attrs: { 'position.x': 560, 'position.y': -420 } }, { frame: 54, attrs: { 'position.x': 560, 'position.y': -360 } }], easing: [{ frame: 54, attr: 'position', easing: 'SlowOut' }] },
  ],
};

const stage5Report = { stage: 'gate', complete: true, ssim: 0.987, iou: 0.973 };

// ---------------------------------------------------------------------------
// 2. Live bridge helpers (direct HTTP for setup/verification scripts).
// ---------------------------------------------------------------------------
async function bridgeBatchStep(script: string, label: string): Promise<Record<string, any>> {
  const seq = `cloned-loop-${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const post = await fetch(`${BRIDGE}/post`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'batch-step', seq, script, sampleFrames: [] }),
  });
  if (!post.ok) throw new Error(`${label}: bridge POST ${post.status}: ${await post.text()}`);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${BRIDGE}/get`);
    if (res.ok) {
      const doc = (await res.json()) as Record<string, any>;
      if (doc.kind === 'batch-step' && doc.seq === seq) {
        if (doc.ok !== true) throw new Error(`${label}: batch-step failed: ${JSON.stringify(doc.error ?? doc)}`);
        return doc;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label}: no batch-step result from ${BRIDGE} within 30 s`);
}

interface PngStats { path: string; bytes: number; width: number; height: number; magic: boolean; mean: number; stddev: number; unique_sampled_colors: number }
function inspectPng(file: string): PngStats {
  const bytes = fs.readFileSync(file);
  const magic = bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!magic) return { path: file, bytes: bytes.length, width: 0, height: 0, magic, mean: 0, stddev: 0, unique_sampled_colors: 0 };
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const png = PNG.sync.read(bytes);
  const values: number[] = [];
  const colors = new Set<number>();
  const step = 13 * 4;
  for (let i = 0; i + 3 < png.data.length; i += step) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    values.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
    colors.add((r << 16) | (g << 8) | b);
  }
  const mean = values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / Math.max(1, values.length);
  return { path: file, bytes: bytes.length, width, height, magic, mean: Math.round(mean * 100) / 100, stddev: Math.round(Math.sqrt(variance) * 100) / 100, unique_sampled_colors: colors.size };
}

// ---------------------------------------------------------------------------
// 3. Run Stage 6, then drive the built MCP server over an in-memory transport.
// ---------------------------------------------------------------------------
async function main() {
  await fsp.mkdir(OUTPUT_DIR, { recursive: true });

  const extraction = await extractStylePreset({
    stage4DslAst: { manifest },
    stage5Report,
    options: {
      styleId: STYLE_ID,
      description: 'Smoke-test SaaS kinetic promo: badge, headline, accent rule, CTA and three feature cards.',
    },
  });
  check(extraction.status === 'ok', 'Stage 6 did not return ok');
  check(fs.existsSync(PRESET_PATH), `preset missing at ${PRESET_PATH}`);
  check(fs.existsSync(SKILL_PATH), `skill missing at ${SKILL_PATH}`);
  const skillText = fs.readFileSync(SKILL_PATH, 'utf8');
  check(skillText.includes('Single-Shot Execution Rule'), 'skill lacks the single-shot execution rule');

  // The built server is the workspace dist (refclone/node_modules/cavalry-mcp
  // is a symlink). Suppress its stdio bootstrap and pin the compact surface.
  process.env.NODE_TEST_CONTEXT = '1';
  delete process.env.MCP_MODE;
  delete process.env.ENABLE_LEGACY_TOOLS;
  delete process.env.CAVALRY_MCP_LEGACY_CRUD;
  delete process.env.CAVALRY_MCP_STRICT_DSL;
  const { createServer } = await import('cavalry-mcp');

  const env: NodeJS.ProcessEnv = { ...process.env };
  const server = createServer({ env, argv: [] });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'cloned-style-loop-test', version: '1.0.0' });
  await client.connect(clientTransport);

  const toolNames = ['list_cloned_styles', 'instantiate_cloned_style', 'sync_active_comp_to_cloned_style'];
  let toolSchemas: Array<Record<string, unknown>> = [];
  try {
    const listed = await client.listTools();
    toolSchemas = listed.tools
      .filter((tool) => toolNames.includes(tool.name))
      .map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }));
    check(toolSchemas.length === 3, `expected 3 cloned tools, got ${toolSchemas.map((t) => t.name).join(', ')}`);

    const call = async (name: string, args: Record<string, unknown>) => {
      const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
      const text = (res.content ?? []).filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n');
      let json: Record<string, any> | null = null;
      try { json = JSON.parse(text); } catch { /* non-JSON error text */ }
      return { isError: res.isError === true, text, json };
    };

    // Capture the user's active comp so the scene ends where it started.
    const before = await bridgeBatchStep('return { compId: String(api.getActiveComp()), scene: String(api.getSceneFilePath() || "") };', 'before');
    activeCompBefore = String((before.scriptResult as Record<string, any>)?.compId ?? '') || null;

    const listedStyles = await call('list_cloned_styles', {});
    check(!listedStyles.isError && Array.isArray(listedStyles.json), `list_cloned_styles failed: ${listedStyles.text}`);
    const styleEntry = (listedStyles.json as Array<Record<string, any>>).find((entry) => entry.id === STYLE_ID);
    check(styleEntry, `list_cloned_styles does not expose ${STYLE_ID}`);
    check(Array.isArray(styleEntry.slot_keys) && styleEntry.slot_keys.includes('items'), 'listed style lost the items slot');

    // New SaaS idea: new copy, new palette, 6 s at 30 fps.
    const instantiate = await call('instantiate_cloned_style', {
      style_id: STYLE_ID,
      comp_name: `Cloned ${STYLE_ID} — Northstar 6s`,
      duration_sec: 6,
      fps: 30,
      width: 1920,
      height: 1080,
      slots: {
        headline: 'Launch your roadmap this week',
        subhead: 'The fastest way to align product, design and engineering',
        cta_text: 'Book a demo',
        text_0: 'NEW · 6s',
        bg_color: '#071018',
        text_color: '#EAF2FF',
        primary_color: '#2563EB',
        accent_color: '#F59E0B',
        items: [{ text: 'ISO 27001' }, { text: '99.99% SLA' }, { text: '1-click setup' }],
      },
    });
    check(!instantiate.isError, `instantiate_cloned_style failed: ${instantiate.text}`);
    const inst = instantiate.json!;
    check(inst.status === 'ok', `instantiate status=${inst.status} render_error=${inst.render_error ?? 'n/a'}`);
    check(String(inst.compId || '').length > 0, 'instantiate returned no compId');
    check(inst.layers_created >= 11, `expected >= 11 layers, got ${inst.layers_created}`);
    check(inst.ops_applied >= 10, `expected >= 10 ops, got ${inst.ops_applied}`);
    const previewPath = String(inst.rendered_frame_preview_path || '');
    check(previewPath && fs.existsSync(previewPath), `hero preview missing (${previewPath || 'null'})`);
    const png = inspectPng(previewPath);
    check(png.magic, 'hero preview is not a PNG');
    check(png.width === 1920 && png.height === 1080, `hero preview is ${png.width}x${png.height}`);
    check(png.stddev > 2, `hero preview looks flat (stddev ${png.stddev})`);
    check(png.unique_sampled_colors > 20, `hero preview has only ${png.unique_sampled_colors} sampled colours`);

    // Dry run before any manual tweak: no disk writes, but the instantiation's
    // retheme must already be recognised as four unanimous palette moves.
    const dry = await call('sync_active_comp_to_cloned_style', { style_id: STYLE_ID, dry_run: true });
    check(!dry.isError, `sync dry run failed: ${dry.text}`);
    const dryJson = dry.json!;
    check(dryJson.status === 'dry_run', `sync dry-run status=${dryJson.status}`);
    check(dryJson.route === 'handler' || dryJson.route === 'batch-step', `unknown sync route ${dryJson.route}`);
    check((dryJson.palette_updates ?? []).length === 4, `dry run expected 4 palette updates, got ${(dryJson.palette_updates ?? []).length}`);
    check((dryJson.updated_layers ?? []).length === 0, 'dry run should not emit rig overrides before any tweak');

    const presetCleanBytes = fs.readFileSync(PRESET_PATH);
    const presetBefore = JSON.parse(fs.readFileSync(PRESET_PATH, 'utf8'));
    check(presetBefore.rig_overrides && Object.keys(presetBefore.rig_overrides).length === 0, 'dry run wrote rig_overrides to disk');
    check(presetBefore.slots.bg_color === BG, 'dry run changed the preset palette');

    // Locate the renamed layers (alias == preset `as`), then simulate manual UI
    // tweaks on the NEW comp only: headline font size, accent rule colour, and
    // one of the two primary-coloured layers.
    const locate = await bridgeBatchStep(
      `var ids = api.getCompLayers(false) || []; var out = {};
       for (var i = 0; i < ids.length; i++) { var n = String(api.getNiceName(ids[i]) || ""); if (n) out[n] = String(ids[i]); }
       return out;`,
      'locate',
    );
    const names = (locate.scriptResult ?? {}) as Record<string, string>;
    for (const needed of ['headline', 'accent_rule', 'badge_fill', 'cta_fill', 'background']) {
      check(names[needed], `created comp has no layer named "${needed}" (aliases not applied?)`);
    }
    const tweak = await bridgeBatchStep(
      `api.set(${JSON.stringify(names.headline)}, { fontSize: 120 });
       api.set(${JSON.stringify(names.accent_rule)}, { "material.materialColor": "#FF7A18" });
       api.set(${JSON.stringify(names.badge_fill)}, { "material.materialColor": "#22C55E" });
       return { headlineFont: api.get(${JSON.stringify(names.headline)}, "fontSize") };`,
      'tweak',
    );
    check(Number((tweak.scriptResult as Record<string, any>)?.headlineFont) === 120, 'fontSize tweak did not apply');

    const write = await call('sync_active_comp_to_cloned_style', { style_id: STYLE_ID, dry_run: false });
    check(!write.isError, `sync write failed: ${write.text}`);
    const writeJson = write.json!;
    check(writeJson.status === 'ok', `sync write status=${writeJson.status}`);
    const paletteRoles = (writeJson.palette_updates ?? []).map((entry: any) => entry.role).sort();
    check(JSON.stringify(paletteRoles) === JSON.stringify(['accent_color', 'bg_color', 'text_color']), `palette roles: ${paletteRoles.join(',')}`);
    const font = (writeJson.font_size_updates ?? []).find((entry: any) => entry.layer === 'headline');
    check(font && font.px === 120 && font.stored === 120, `headline font update missing: ${JSON.stringify(writeJson.font_size_updates)}`);
    const overrideAliases = (writeJson.updated_layers ?? []).map((entry: any) => entry.layer).sort();
    check(JSON.stringify(overrideAliases) === JSON.stringify(['badge_fill', 'cta_fill']), `override aliases: ${overrideAliases.join(',')}`);

    const presetAfter = JSON.parse(fs.readFileSync(PRESET_PATH, 'utf8'));
    check(presetAfter.slots.bg_color === '#071018', `preset bg slot ${presetAfter.slots.bg_color}`);
    check(presetAfter.slots.text_color === '#EAF2FF', `preset text slot ${presetAfter.slots.text_color}`);
    check(presetAfter.slots.accent_color === '#FF7A18', `preset accent slot ${presetAfter.slots.accent_color}`);
    check(presetAfter.rig_overrides.badge_fill?.['material.materialColor'] === '#22C55E', 'badge override not persisted');
    check(presetAfter.rig_overrides.cta_fill?.['material.materialColor'] === '#2563EB', 'cta override not persisted');
    const headlineLayer = (presetAfter.scene?.layers ?? []).find((layer: any) => (layer.as ?? '') === 'headline');
    check(headlineLayer?.font_size === 120, `preset headline font_size ${headlineLayer?.font_size}`);
    check(presetAfter.palette?.bg_color === '#071018', 'preset palette mirror not updated');

    // The sync write is proven above; put the reusable preset back so the
    // smoke-test style is not left wearing throwaway demo tweaks.
    const restoreTmp = `${PRESET_PATH}.tmp-${process.pid}-${Date.now().toString(36)}`;
    fs.writeFileSync(restoreTmp, presetCleanBytes);
    fs.renameSync(restoreTmp, PRESET_PATH);
    const presetRestored = JSON.parse(fs.readFileSync(PRESET_PATH, 'utf8'));

    const report = {
      status: 'ok',
      generated_at: new Date().toISOString(),
      bridge: { url: BRIDGE, sync_route: writeJson.route, native_export_kind: writeJson.route === 'handler' },
      style: {
        id: STYLE_ID,
        preset_path: PRESET_PATH,
        skill_path: SKILL_PATH,
        preset_bytes: fs.statSync(PRESET_PATH).size,
        skill_bytes: fs.statSync(SKILL_PATH).size,
        slots: extraction.slots,
        defaults: extraction.defaults,
        archetype: extraction.archetype,
        gate: extraction.gate,
      },
      tool_schemas: toolSchemas,
      list_cloned_styles: styleEntry,
      instantiate: {
        status: inst.status,
        compId: inst.compId,
        hero_frame: inst.hero_frame,
        duration_sec: inst.duration_sec,
        fps: inst.fps,
        width: inst.width,
        height: inst.height,
        layers_created: inst.layers_created,
        ops_applied: inst.ops_applied,
        slot_warnings: inst.slot_warnings ?? [],
        unknown_tokens: inst.unknown_tokens ?? [],
        rendered_frame_preview_path: previewPath,
      },
      png,
      sync: {
        dry_run: {
          status: dryJson.status,
          route: dryJson.route,
          palette_updates: dryJson.palette_updates,
          updated_layers: dryJson.updated_layers,
          font_size_updates: dryJson.font_size_updates,
        },
        write: {
          status: writeJson.status,
          route: writeJson.route,
          palette_updates: writeJson.palette_updates,
          updated_layers: writeJson.updated_layers,
          font_size_updates: writeJson.font_size_updates,
          unmatched_layers: writeJson.unmatched_layers,
          skipped: writeJson.skipped ?? [],
        },
        preset_after: {
          slots: {
            bg_color: presetAfter.slots.bg_color,
            text_color: presetAfter.slots.text_color,
            primary_color: presetAfter.slots.primary_color,
            accent_color: presetAfter.slots.accent_color,
          },
          rig_overrides: presetAfter.rig_overrides,
          headline_font_size: headlineLayer?.font_size,
        },
        preset_cleanup: {
          restored: true,
          slots: {
            bg_color: presetRestored.slots.bg_color,
            text_color: presetRestored.slots.text_color,
            primary_color: presetRestored.slots.primary_color,
            accent_color: presetRestored.slots.accent_color,
          },
          rig_overrides: presetRestored.rig_overrides,
          headline_font_size: (presetRestored.scene?.layers ?? []).find((layer: any) => (layer.as ?? '') === 'headline')?.font_size,
        },
      },
      scene: {
        active_comp_before: (before.scriptResult as Record<string, any>)?.compId ?? null,
        scene_file_before: (before.scriptResult as Record<string, any>)?.scene ?? null,
        created_comp: inst.compId,
        saved_reference_project: false,
        live_mutations: [
          'created a new composition (atomic batch-step undo group)',
          'set headline fontSize 120 on the cloned comp',
          'set accent_rule material colour #FF7A18 on the cloned comp',
          'set badge_fill material colour #22C55E on the cloned comp',
        ],
      },
      created_files: [PRESET_PATH, SKILL_PATH, previewPath, REPORT_PATH].filter(Boolean),
    };

    // Put the user back on the composition they had open.
    if (report.scene.active_comp_before) {
      try {
        await bridgeBatchStep(`api.setActiveComp(${JSON.stringify(report.scene.active_comp_before)}); return { active: String(api.getActiveComp()) };`, 'restore');
        report.scene.active_comp_after = report.scene.active_comp_before;
      } catch (err) {
        report.scene.restore_error = err instanceof Error ? err.message : String(err);
      }
    }

    await fsp.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
    return report;
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

try {
  await main();
  process.exitCode = 0;
} catch (error) {
  failures.push(error instanceof Error ? `${error.message}` : String(error));
  // A failed assertion must not leave the user parked on the test comp.
  if (activeCompBefore) {
    await bridgeBatchStep(
      `api.setActiveComp(${JSON.stringify(activeCompBefore)}); return { active: String(api.getActiveComp()) };`,
      'restore-after-failure',
    ).catch(() => undefined);
  }
  console.error(`FAILED: ${failures[0]}`);
  process.exitCode = 1;
}
