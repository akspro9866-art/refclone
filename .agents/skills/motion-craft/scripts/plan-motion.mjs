#!/usr/bin/env node
import { choosePair, makeScenePlan, parseMotionArgs, writeSceneOutputs, writeStyleOutputs } from './motion-planning.mjs';

import { requireResolvedBrief } from './brief-contract.mjs';

try {
  const options = parseMotionArgs(process.argv.slice(2));
  requireResolvedBrief(options, process.argv.slice(2));
  const selection = choosePair(options);
  const plan = makeScenePlan(options, selection);
  const style = writeStyleOutputs(options, selection);
  const paths = writeSceneOutputs(options, selection, plan);
  console.log(JSON.stringify({ ...style, ...paths, totalFrames: plan.totalFrames, fps: plan.fps }, null, 2));
} catch (error) {
  console.error(`[plan-motion] ${error.message}`);
  process.exitCode = 1;
}
