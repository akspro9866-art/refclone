#!/usr/bin/env node
import { fixtureArgs } from './brief-test-fixture.mjs';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { MATERIAL_SFX } from './material-sfx.mjs';
import os from 'node:os';
import path from 'node:path';
import { selectMotion } from './motion-pairing.mjs';
import { choosePair, makeScenePlan, parseMotionArgs } from './motion-planning.mjs';
import { SKILL_ROOT, loadStoryboards } from './storyboard-library.mjs';
import { STYLE_INDEX } from './style-index.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-planning-'));
const script = (name) => path.join(SKILL_ROOT, 'scripts', name);
const run = (name, args) => execFileSync(process.execPath, [script(name), ...fixtureArgs(temp, args)], { encoding: 'utf8' });
const summary = (brief, overrides) => {
  const pair = selectMotion(brief, overrides);
  return [pair.style.id, pair.storyboard.id, pair.aspect];
};

try {
  const brief = 'Pakai motion-craft. Buatkan saya video motion graphics menggunakan Remotion tentang cara install Linux.';
  const out = path.join(temp, 'gui plan');
  const result = JSON.parse(run('plan-motion.mjs', ['--brief', brief, '--duration', '30', '--out', out]));
  assert.deepEqual([result.chosen.id, result.pairing.storyboardId], [12, 'T023']);
  assert.match(result.pairing.adaptation, /Asumsi awal: installer grafis/);
  const plan = JSON.parse(fs.readFileSync(result.planPath, 'utf8'));
  assert.equal(plan.selectedStyleId, result.chosen.id);
  assert.equal(plan.totalFrames, 900);
  assert.deepEqual(plan.pairing.soundPalette, result.pairing.soundPalette);
  assert.match(fs.readFileSync(result.selectedSfxGuidePath, 'utf8'), /#12 Swiss Internasional[\s\S]+click-soft/);
  assert.equal(plan.scenes.length, 5);
  assert.deepEqual(plan.scenes.map(({ startFrame }) => startFrame), [0, 120, 330, 540, 750]);
  assert.match(plan.scenes[1].visualHeroCenter, /installer grafis/i);
  assert.ok(plan.scenes.every((scene) => scene.exitOverlapFrames === 0));
  assert.doesNotMatch(plan.scenes.map((scene) => scene.visualHeroCenter).join(' '), /terminal|chatapp|bento/i);
  assert.equal(
    fs.readFileSync(result.selectedStyleGuidePath, 'utf8'),
    fs.readFileSync(path.join(SKILL_ROOT, result.chosen.styleGuide), 'utf8'),
  );
  assert.match(fs.readFileSync(result.styleBiblePath, 'utf8'), /Gaya #12 Swiss Internasional/);
  assert.match(fs.readFileSync(result.storyboardPath, 'utf8'), /#12 Swiss Internasional \+ T023/);

  assert.deepEqual(summary('Tutorial install Ubuntu via GUI, tanpa terminal.'), [12, 'T023', '16:9']);
  assert.deepEqual(summary('Install paket nginx di Linux lewat terminal dan tampilkan hasil apt install.'), [26, 'T036', '16:9']);
  assert.deepEqual(summary('Buat video cara install VS Code di Linux.'), [12, 'T023', '16:9']);
  assert.deepEqual(summary('Buat video Reels jadwal kereta cepat.'), [10, 'T093', '9:16']);
  assert.deepEqual(summary('Buat video cara install Linux, gaya #14.'), [14, 'T023', '16:9']);
  assert.deepEqual(summary('Reels 15 detik memperkenalkan Kopisusu 3% dengan gaya 14 Risograph.'), [14, 'T001', '9:16']);
  assert.deepEqual(summary('Promo restoran dengan menu spesial.'), [21, 'T082', '9:16']);
  assert.deepEqual(summary('Tutorial installer grafis Ubuntu, gaya Terminal CLI.'), [26, 'T023', '16:9']);
  assert.deepEqual(summary('Demo Linux Reels.', { styleId: 5, templateId: 'T097', aspect: '1:1' }), [5, 'T097', '1:1']);

  assert.deepEqual(summary('Buat cinematic intro Apple untuk brand kopi gue.'), [44, 'T102', '16:9']);
  assert.deepEqual(summary('Gaya Apple untuk tutorial cara pakai dashboard.'), [44, 'T101', '16:9']);
  assert.deepEqual(summary('Edukasi gaya Apple tentang gravitasi buat Reels.'), [44, 'T103', '9:16']);
  assert.equal(selectMotion('Buat tutorial', { templateId: 'T101' }).style.id, 44);
  assert.equal(selectMotion('Gaya Apple untuk video kopi').style.id, 44);
  const interactiveOut = path.join(temp, 'interactive');
  const interactive = JSON.parse(run('plan-motion.mjs', ['--brief', 'Edukasi gaya Apple tentang gravitasi', '--out', interactiveOut]));
  assert.equal(interactive.pairing.templateComponent, 'AppleInteractiveEducation');
  assert.match(fs.readFileSync(interactive.motionPlanPath, 'utf8'), /AppleInteractiveStarter/);
  run('scaffold-remotion.mjs', ['--target', interactiveOut, '--style', '44', '--template', 'T103', '--duration', '2', '--aspect', '9:16']);
  const starter = fs.readFileSync(path.join(interactiveOut, 'src/antislop/AppleInteractiveStarter.tsx'), 'utf8');
  const interactivePlan = JSON.parse(fs.readFileSync(path.join(interactiveOut, 'research/scenes-plan.json'), 'utf8'));
  assert.match(starter, /<AppleInteractiveEducation/);
  assert.equal(fs.existsSync(path.join(interactiveOut, 'public/words.json')), false);
  assert.ok(starter.includes(`cuts={${JSON.stringify(interactivePlan.scenes.map(({ startFrame }) => startFrame))}}`));
  assert.equal(selectMotion('Buat promo apple pie.').style.id === 44, false);
  const reveal = choosePair(parseMotionArgs(['--style', '44', '--template', 'T004']));
  const revealPlan = makeScenePlan({ fps: 30, overlap: 10 }, reveal);
  assert.match(revealPlan.scenes[1].visualHeroCenter, /Close-up/);
  assert.equal(revealPlan.scenes[2].camera, 'PULL');
  assert.ok(revealPlan.scenes.every(({ exitOverlapFrames }) => exitOverlapFrames === 0));
  assert.match(revealPlan.scenes.at(-1).visualHeroCenter, /logo.*brand user/);

  const manual = ['--brief', 'Tutorial installer grafis Ubuntu', '--style', '14', '--storyboard', 'T023', '--out', temp];
  const draw = JSON.parse(run('draw-style.mjs', manual));
  run('scenes.mjs', manual);
  const separate = JSON.parse(fs.readFileSync(path.join(temp, 'scenes-plan.json'), 'utf8'));
  assert.equal(separate.selectedStyleId, draw.chosen.id);
  assert.equal(separate.selectedStoryboardId, draw.pairing.storyboardId);

  const invalidOutput = path.join(temp, 'invalid');
  const invalid = spawnSync(process.execPath, [script('plan-motion.mjs'), ...fixtureArgs(temp, ['--duration', '0.01', '--out', invalidOutput])], { encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /needs at least/);
  assert.equal(fs.existsSync(invalidOutput), false);

  const storyboards = loadStoryboards();
  assert.equal(new Set(storyboards.map(({ id }) => id)).size, 103);
  assert.equal(new Set(STYLE_INDEX.map(({ id }) => id)).size, STYLE_INDEX.length);
  assert.deepEqual(
    new Set(STYLE_INDEX.flatMap(({ storyboards: picks }) => picks)),
    new Set(storyboards.map(({ id }) => id)),
  );
  const cueType = fs.readFileSync(path.join(SKILL_ROOT, 'templates/components/Transitions.tsx'), 'utf8')
    .split('export type StudioSfxName =')[1].split(';')[0];
  for (const style of STYLE_INDEX) {
    assert.ok(style.storyboards.length >= 2, `Style #${style.id} needs several suitable storyboards`);
    const opts = parseMotionArgs(['--style', String(style.id), '--template', style.storyboards[0]]);
    const picked = choosePair(opts);
    assert.equal(picked.chosen.id, style.id);
    const palette = picked.summary.soundPalette;
    assert.equal(new Set(palette.map(({ sfx }) => sfx)).size, 3);
    for (const { sfx, volume, action } of palette) {
      assert.ok(cueType.includes(`'${sfx}'`), `Unsupported SfxCue ID ${sfx}`);
      assert.ok(Object.hasOwn(MATERIAL_SFX, sfx) || fs.existsSync(path.join(SKILL_ROOT, 'assets/audio/sfx', `${sfx}.wav`)));
      assert.ok(volume > 0 && volume <= 1 && action.trim());
    }
    assert.match(picked.guide.split('\n')[0], new RegExp(`#${String(style.id).padStart(2, '0')} ·`));
  }

  for (const board of storyboards) {
    const opts = parseMotionArgs(['--template', board.id, '--duration', '0.35', '--fps', '30']);
    const selected = choosePair(opts);
    const { totalFrames, scenes } = makeScenePlan(opts, selected);
    assert.equal(scenes[0].startFrame, 0, board.id);
    assert.equal(scenes.at(-1).endFrame, totalFrames, board.id);
    assert.ok(scenes.every(({ durationInFrames }) => durationInFrames >= 1), board.id);
    assert.equal(scenes.reduce((sum, scene) => sum + scene.durationInFrames - scene.exitOverlapFrames, 0), totalFrames, board.id);
    for (let index = 1; index < scenes.length; index++) {
      const previous = scenes[index - 1];
      const current = scenes[index];
      assert.equal(previous.endFrame - current.startFrame, current.enterOverlapFrames, board.id);
      assert.equal(previous.exitOverlapFrames, current.enterOverlapFrames, board.id);
      assert.equal(previous.exitTransition, current.enterTransition, board.id);
    }
  }

  console.log(`Verified ${STYLE_INDEX.length} style guides and SFX palettes, all 103 storyboard timings, CLI and GUI intent, explicit selections, and aligned output.`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
