import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { roundDet, roundDetPoint, roundDetBbox } from "../src/utils/math-det.ts";
import { safeRm } from "../src/utils/ffmpeg-safe.ts";
import { layersForBeat } from "../src/compiler/layersForBeat.ts";
import { trackElementTrajectory } from "../src/pipeline/stage2-track.ts";
import { promoteTracksToSceneSpecV2 } from "../src/pipeline/stage3-promote.ts";
import { compileSceneSpecV2ToDsl } from "../src/pipeline/stage4-compile.ts";
import { refineCoordinatesLocally } from "../src/pipeline/stage4_5-refine.ts";
import { computeBoxIoU, evaluateDiffGate } from "../src/pipeline/stage5-diff.ts";

describe("refclone: unit tests for math, stages, and compiler", () => {
  test("roundDet handles float precision, rounding, scientific notation, and normalizes -0 to 0", () => {
    assert.equal(roundDet(0.123456, 4), 0.1235);
    assert.equal(roundDet(0.12344, 4), 0.1234);
    assert.equal(roundDet(1e-7, 4), 0);
    assert.equal(roundDet(-1e-7, 4), 0);
    assert.equal(Object.is(roundDet(-0.00001, 2), 0), true);
    assert.equal(roundDet(NaN), 0);

    const pt = roundDetPoint({ x: 10.55555, y: -0.000001 }, 3);
    assert.equal(pt.x, 10.556);
    assert.equal(Object.is(pt.y, 0), true);

    const box = roundDetBbox({ x: 1.11111, y: 2.22222, width: 100.99999, height: 50.00001 }, 2);
    assert.equal(box.x, 1.11);
    assert.equal(box.y, 2.22);
    assert.equal(box.width, 101.0);
    assert.equal(box.height, 50.0);
  });

  test("safeRm removes directories and does not throw for non-existent targets", () => {
    assert.doesNotThrow(() => safeRm("non_existent_dir_12345"));
  });

  test("layersForBeat emits valid _mg.patch operations", () => {
    const patches = layersForBeat({
      startFrame: 10,
      endFrame: 40,
      elementIds: ["card_alpha"],
    });
    assert.equal(patches.length, 1);
    assert.equal(patches[0].layerId, "card_alpha");
    assert.ok(patches[0].dsl.includes('_mg.patch("card_alpha"'));
  });

  test("stage2 tracking, stage3 promotion, and stage4 compilation work end-to-end", () => {
    const track = trackElementTrajectory("hero_card", [
      { frame: 0, x: 100, y: 200, width: 300, height: 180 },
      { frame: 30, x: 150, y: 200, width: 300, height: 180 },
    ]);
    assert.equal(track.elementId, "hero_card");
    assert.equal(track.motionClass, "rigid");
    assert.equal(track.points.length, 2);

    const spec = promoteTracksToSceneSpecV2([track], { fps: 60 });
    assert.equal(spec.version, "2.0");
    assert.equal(spec.layers.length, 1);
    assert.equal(spec.layers[0].id, "hero_card");

    const compilation = compileSceneSpecV2ToDsl(spec, { groupName: "test_undo" });
    assert.ok(compilation.script.includes('cavalry.beginUndoGroup("test_undo");'));
    assert.ok(compilation.script.includes('_mg.patch("hero_card"'));
    assert.ok(compilation.script.includes('cavalry.endUndoGroup();'));
  });

  test("stage4.5 numerical refinement converges within tolerance", () => {
    const result = refineCoordinatesLocally({
      elementId: "card_1",
      currentBbox: { x: 95, y: 98, width: 200, height: 100 },
      targetBbox: { x: 100, y: 100, width: 200, height: 100 },
    }, { maxIterations: 8, tolerancePx: 1.5 });
    assert.equal(result.converged, true);
    assert.ok(result.iterations <= 8);
  });

  test("stage5 perceptual diff gating checks IoU and thresholds", async () => {
    const iou = computeBoxIoU(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 100, height: 100 },
    );
    assert.equal(iou, 1.0);

    const gate = await evaluateDiffGate(0.97, 0.96, { ssimThreshold: 0.95, iouThreshold: 0.95 });
    assert.equal(gate.passed, true);
  });
});
