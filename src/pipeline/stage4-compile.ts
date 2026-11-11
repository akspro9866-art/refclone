/**
 * Stage 4 — DSL Compilation Orchestrator (`src/pipeline/stage4-compile.ts`).
 * Translates SceneSpecV2 structures into atomic _mg DSL scripts with _mg.patch.
 */
import type { SceneSpecV2Doc } from "./stage3-promote.ts";

export interface Stage4CompileResult {
  script: string;
  groupName: string;
  operationsCount: number;
}

export function compileSceneSpecV2ToDsl(
  spec: SceneSpecV2Doc,
  options: { groupName?: string } = {},
): Stage4CompileResult {
  const groupName = options.groupName ?? `refclone_batch_${Date.now().toString(36)}`;
  const patchLines: string[] = [];

  for (const layer of spec.layers) {
    const patchPayload = {
      type: layer.type,
      name: layer.name,
      attrs: layer.attrs,
      keyframes: layer.keyframes,
      connections: layer.connections,
    };
    patchLines.push(`    _mg.patch(${JSON.stringify(layer.id)}, ${JSON.stringify(patchPayload)});`);
  }

  const script = `(function() {
  const _mg = globalThis.__mg_init
    ? globalThis.__mg_init()
    : (typeof createMgRuntime === "function"
        ? createMgRuntime()
        : (globalThis._mg || { patch: function() { return null; } }));
  cavalry.beginUndoGroup(${JSON.stringify(groupName)});
  try {
${patchLines.join("\n")}
  } finally {
    cavalry.endUndoGroup();
  }
})();`;

  return {
    script,
    groupName,
    operationsCount: spec.layers.length,
  };
}
