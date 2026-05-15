#!/usr/bin/env node

/**
 * fix-cleave-A-imports.ts — Fix broken imports after cleave A2 live execution.
 *
 * The codemod's Phase 2 (delete shims) ran BEFORE Phase 4 (rewrite imports),
 * so substrate tests that imported deleted shims were not updated. This script
 * fixes the remaining broken imports:
 *
 * Category A: shim → real substrate path (deleted shim → data-structures / storage)
 * Category B: substrate tests importing moved presentation files → relative path to root src
 * Category C: patterns/index.ts barrel fix → delete or stub since all patterns moved
 *
 * Usage: pnpm tsx scripts/fix-cleave-A-imports.ts [--dry]
 */

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const DRY = process.argv.includes("--dry");

// ---------------------------------------------------------------------------
// Per-file import fix table
// ---------------------------------------------------------------------------
// Each entry: { file: absolute path, replacements: [old, new][] }

const FIXES: Array<{ file: string; replacements: [string, string][] }> = [
	// -------------------------------------------------------------------------
	// Category A: shim → real substrate path (data-structures, storage)
	// -------------------------------------------------------------------------
	{
		file: `${ROOT}/packages/pure-ts/src/__tests__/extra/reactive-data-structures.test.ts`,
		replacements: [
			// pubsub moved to root src/base/composition/pubsub.ts
			[`from "../../extra/pubsub.js"`, `from "../../../../src/base/composition/pubsub.js"`],
			[
				`from "../../extra/reactive-index.js"`,
				`from "../../extra/data-structures/reactive-index.js"`,
			],
			[
				`from "../../extra/reactive-list.js"`,
				`from "../../extra/data-structures/reactive-list.js"`,
			],
			[`from "../../extra/reactive-log.js"`, `from "../../extra/data-structures/reactive-log.js"`],
		],
	},
	{
		file: `${ROOT}/packages/pure-ts/src/__tests__/extra/reactive-list-stress.test.ts`,
		replacements: [
			[
				`from "../../extra/reactive-list.js"`,
				`from "../../extra/data-structures/reactive-list.js"`,
			],
		],
	},
	{
		file: `${ROOT}/packages/pure-ts/src/__tests__/extra/reactive-map-stress.test.ts`,
		replacements: [
			[`from "../../extra/reactive-map.js"`, `from "../../extra/data-structures/reactive-map.js"`],
		],
	},
	{
		file: `${ROOT}/packages/pure-ts/src/__tests__/extra/reactive-map.test.ts`,
		replacements: [
			[`from "../../extra/reactive-map.js"`, `from "../../extra/data-structures/reactive-map.js"`],
		],
	},
	{
		file: `${ROOT}/packages/pure-ts/src/__tests__/extra/storage-wal.test.ts`,
		replacements: [[`from "../../extra/storage-tiers.js"`, `from "../../extra/storage/tiers.js"`]],
	},
	{
		file: `${ROOT}/packages/pure-ts/src/__tests__/extra/storage.test.ts`,
		replacements: [
			// storage-browser moved to root src/base/sources/browser/idb.ts
			[
				`from "../../extra/storage-browser.js"`,
				`from "../../../../src/base/sources/browser/idb.js"`,
			],
			// storage-tiers-browser stays in substrate
			[
				`from "../../extra/storage-tiers-browser.js"`,
				`from "../../extra/storage/tiers-browser.js"`,
			],
			// storage-tiers-node stays in substrate
			[`from "../../extra/storage-tiers-node.js"`, `from "../../extra/storage/tiers-node.js"`],
		],
	},

	// -------------------------------------------------------------------------
	// Category B: substrate tests importing moved presentation files
	// Relative paths from packages/pure-ts/src/__tests__/... to root src/
	// -------------------------------------------------------------------------
	{
		// session1-foundation: imports from adapters (→ base/io/index), http-error (→ base/io/http-error),
		// reactive-map (→ data-structures/reactive-map), sources (→ sources/index), storage-tiers (→ storage/tiers)
		// content-addressed-storage (→ storage/content-addressed)
		file: `${ROOT}/packages/pure-ts/src/__tests__/extra/session1-foundation.test.ts`,
		replacements: [
			[`from "../../extra/adapters.js"`, `from "../../../../src/base/io/index.js"`],
			[`from "../../extra/http-error.js"`, `from "../../../../src/base/io/http-error.js"`],
			[`from "../../extra/reactive-map.js"`, `from "../../extra/data-structures/reactive-map.js"`],
			[`from "../../extra/sources.js"`, `from "../../extra/sources/index.js"`],
			[`from "../../extra/storage-tiers.js"`, `from "../../extra/storage/tiers.js"`],
			// content-addressed-storage shim → storage/content-addressed (substrate)
			[
				`from "../../extra/content-addressed-storage.js"`,
				`from "../../extra/storage/content-addressed.js"`,
			],
		],
	},
	{
		// describe-ascii test: extra/render/index.js moved to src/base/render/index.ts
		file: `${ROOT}/packages/pure-ts/src/__tests__/graph/describe-ascii.test.ts`,
		replacements: [
			[`from "../../extra/render/index.js"`, `from "../../../../src/base/render/index.js"`],
		],
	},
	{
		// explain-cross-mount: patterns/messaging/index.js moved to src/utils/messaging/index.ts
		file: `${ROOT}/packages/pure-ts/src/__tests__/graph/explain-cross-mount.test.ts`,
		replacements: [
			[
				`from "../../patterns/messaging/index.js"`,
				`from "../../../../src/utils/messaging/index.js"`,
			],
		],
	},
	{
		// graph.test.ts: patterns/graphspec/index.js moved to src/utils/graphspec/index.ts
		file: `${ROOT}/packages/pure-ts/src/__tests__/graph/graph.test.ts`,
		replacements: [
			[
				`from "../../patterns/graphspec/index.js"`,
				`from "../../../../src/utils/graphspec/index.js"`,
			],
		],
	},
	{
		// phase-13-6-b9: extra/mutation/index.js moved to src/base/mutation/index.ts
		//                extra/sources/settled.js moved to src/base/sources/settled.ts
		file: `${ROOT}/packages/pure-ts/src/__tests__/core/phase-13-6-b9.test.ts`,
		replacements: [
			[`from "../../extra/mutation/index.js"`, `from "../../../../src/base/mutation/index.js"`],
			[`from "../../extra/sources/settled.js"`, `from "../../../../src/base/sources/settled.js"`],
		],
	},
	{
		// phase-13-6-qa: same as b9
		file: `${ROOT}/packages/pure-ts/src/__tests__/core/phase-13-6-qa.test.ts`,
		replacements: [
			[`from "../../extra/mutation/index.js"`, `from "../../../../src/base/mutation/index.js"`],
			[`from "../../extra/sources/settled.js"`, `from "../../../../src/base/sources/settled.js"`],
		],
	},
];

// -------------------------------------------------------------------------
// Category C: patterns/index.ts barrel — delete since all patterns moved
// We leave a minimal stub that redirects to the root src.
// -------------------------------------------------------------------------
const PATTERNS_INDEX_STUB = `/**
 * patterns/index.ts — stub after cleave A2.
 *
 * All pattern modules moved to root src/{utils,presets}/ (cleave A2).
 * This file is intentionally empty. The root shim re-exports everything
 * from @graphrefly/graphrefly.
 *
 * @internal
 * @deprecated use @graphrefly/graphrefly imports instead.
 */

// (intentionally empty — patterns moved to root src/)
`;

async function fixPatternIndex(): Promise<void> {
	const patternsIndex = `${ROOT}/packages/pure-ts/src/patterns/index.ts`;
	if (!existsSync(patternsIndex)) {
		console.log("  SKIP: patterns/index.ts not found");
		return;
	}
	if (!DRY) {
		await writeFile(patternsIndex, PATTERNS_INDEX_STUB, "utf8");
		console.log("  STUB: patterns/index.ts → intentionally empty stub");
	} else {
		console.log("  [DRY] STUB: patterns/index.ts → intentionally empty stub");
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	console.log(`\n=== fix-cleave-A-imports ${DRY ? "(DRY RUN)" : "(LIVE)"} ===\n`);

	let fixed = 0;
	let skipped = 0;

	for (const { file, replacements } of FIXES) {
		if (!existsSync(file)) {
			console.log(`  SKIP (missing): ${file.replace(ROOT + "/", "")}`);
			skipped++;
			continue;
		}

		let content = await readFile(file, "utf8");
		let changed = false;

		for (const [oldStr, newStr] of replacements) {
			if (content.includes(oldStr)) {
				content = content.replaceAll(oldStr, newStr);
				changed = true;
				console.log(
					`  ${DRY ? "[DRY] " : ""}FIX ${file.replace(ROOT + "/", "")}: ${JSON.stringify(oldStr)} → ${JSON.stringify(newStr)}`,
				);
			} else {
				console.log(
					`  SKIP (not found): "${oldStr.slice(0, 50)}..." in ${file.replace(ROOT + "/", "")}`,
				);
			}
		}

		if (changed && !DRY) {
			await writeFile(file, content, "utf8");
			fixed++;
		} else if (changed) {
			fixed++;
		}
	}

	console.log("\n[Category C] Fixing patterns/index.ts...");
	await fixPatternIndex();

	console.log(`\n=== SUMMARY ===`);
	console.log(`  Files fixed: ${fixed} (${skipped} skipped/missing)`);
	console.log(`\n=== DONE ===\n`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
