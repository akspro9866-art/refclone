/**
 * Resolver for cavalry-mcp's direct-import library (`cavalry-mcp/lib`).
 *
 * refclone depends on the sibling checkout through the `file:../cavalry-mcp`
 * dependency, so `import('cavalry-mcp/lib')` normally resolves through
 * node_modules. The resolver keeps working in three other layouts:
 *
 *   1. the package link is missing (a plain refclone clone without install) —
 *      the sibling checkout's built `dist/lib/index.js` is loaded directly;
 *   2. the sibling exists but was never built — the loader reports null so
 *      callers skip gracefully instead of crashing the run;
 *   3. CAVALRY_MCP_DIR points somewhere else entirely (CI layouts).
 *
 * The result is cached: one resolution per process, so a pipeline stage can
 * call `loadCavalryLib()` cheaply in a loop.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let cached = undefined;

/**
 * Resolve the library module, or null when neither the package link nor a
 * built sibling checkout is available.
 *
 * @returns {Promise<Record<string, unknown> | null>} the `cavalry-mcp/lib` namespace
 */
export async function loadCavalryLib() {
	if (cached !== undefined) return cached;
	try {
		cached = await import('cavalry-mcp/lib');
		return cached;
	} catch {
		// fall through to the sibling layout
	}
	const candidates = [
		path.resolve(repoRoot, '..', 'cavalry-mcp'),
		process.env.CAVALRY_MCP_DIR || '',
	].filter(Boolean);
	for (const sibling of candidates) {
		const built = path.join(sibling, 'dist', 'lib', 'index.js');
		if (!existsSync(built)) continue;
		try {
			cached = await import(pathToFileURL(built).href);
			return cached;
		} catch {
			// a broken build is as good as a missing one; keep looking
		}
	}
	cached = null;
	return null;
}

/** True when the library (and therefore the 120-preset compiler) is usable. */
export async function cavalryLibAvailable() {
	return (await loadCavalryLib()) !== null;
}
