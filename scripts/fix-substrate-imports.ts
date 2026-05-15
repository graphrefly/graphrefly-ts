#!/usr/bin/env node

/**
 * fix-substrate-imports.ts — Convert relative substrate imports in root src/ to @graphrefly/pure-ts.
 *
 * After the cleave A2, presentation files moved from packages/pure-ts/src/ to root src/.
 * Their imports that pointed at substrate (core/, graph/, extra/operators/, etc.)
 * via relative paths now need to use @graphrefly/pure-ts package imports.
 *
 * Mapping:
 *   ../../core/messages.js → @graphrefly/pure-ts/core (or specific subpath)
 *   ../../graph/graph.js → @graphrefly/pure-ts/graph
 *   ../../extra/operators/... → @graphrefly/pure-ts/extra
 *   ../../extra/data-structures/... → @graphrefly/pure-ts/extra
 *   ../../extra/storage/... → @graphrefly/pure-ts/extra (or specific subpath)
 *   ../../extra/composition/stratify.js → @graphrefly/pure-ts/extra
 *   ../../extra/sources/... → @graphrefly/pure-ts/extra
 *   ../../testing/... → @graphrefly/pure-ts/testing
 *
 * Usage: pnpm tsx scripts/fix-substrate-imports.ts [--dry]
 */

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ROOT_SRC = join(ROOT, "src");
const PURE_TS_SRC = join(ROOT, "packages/pure-ts/src");
const DRY = process.argv.includes("--dry");

// ---------------------------------------------------------------------------
// Substrate path detection
// ---------------------------------------------------------------------------
// Given a relative import spec from a file in root src/, determine if it
// points to a substrate path (still in pure-ts) and return the package import.

// Substrate subdirectories in pure-ts (paths must start with one of these)
const SUBSTRATE_DIRS = [
	"core/",
	"graph/",
	"extra/operators",
	"extra/data-structures",
	"extra/storage",
	"extra/composition/stratify",
	"extra/sources/sync",
	"extra/sources/event/timer",
	"extra/sources/_internal",
	"extra/sources/index",
	"testing/",
];

// Deleted shim → package import mapping
// These shims re-exported substrate content and were deleted in Phase 2.
const SHIM_REMAP: Record<string, string> = {
	"extra/adapters.js": "@graphrefly/pure-ts/extra", // → io/index (now in root, use @graphrefly/pure-ts/extra for NodeInput etc.)
	"extra/adapters": "@graphrefly/pure-ts/extra",
	"extra/backoff.js": "@graphrefly/pure-ts/extra", // → resilience/backoff (now in root)
	"extra/backoff": "@graphrefly/pure-ts/extra",
	"extra/backpressure.js": "@graphrefly/pure-ts/extra", // → composition/backpressure (now in root)
	"extra/backpressure": "@graphrefly/pure-ts/extra",
	"extra/cascading-cache.js": "@graphrefly/pure-ts/extra", // → storage/cascading-cache (substrate)
	"extra/cascading-cache": "@graphrefly/pure-ts/extra",
	"extra/composite.js": "@graphrefly/pure-ts/extra", // → composition/composite (now in root)
	"extra/composite": "@graphrefly/pure-ts/extra",
	"extra/content-addressed-storage.js": "@graphrefly/pure-ts/extra", // → storage/content-addressed (substrate)
	"extra/content-addressed-storage": "@graphrefly/pure-ts/extra",
	"extra/external-register.js": "@graphrefly/pure-ts/extra",
	"extra/external-register": "@graphrefly/pure-ts/extra",
	"extra/http-error.js": "@graphrefly/pure-ts/extra", // → io/http-error (now in root)
	"extra/http-error": "@graphrefly/pure-ts/extra",
	"extra/observable.js": "@graphrefly/pure-ts/extra",
	"extra/observable": "@graphrefly/pure-ts/extra",
	"extra/operators.js": "@graphrefly/pure-ts/extra", // → operators/index (substrate)
	"extra/operators": "@graphrefly/pure-ts/extra",
	"extra/pubsub.js": "@graphrefly/pure-ts/extra", // → composition/pubsub (now in root)
	"extra/pubsub": "@graphrefly/pure-ts/extra",
	"extra/reactive-index.js": "@graphrefly/pure-ts/extra", // → data-structures/reactive-index (substrate)
	"extra/reactive-index": "@graphrefly/pure-ts/extra",
	"extra/reactive-list.js": "@graphrefly/pure-ts/extra", // → data-structures/reactive-list (substrate)
	"extra/reactive-list": "@graphrefly/pure-ts/extra",
	"extra/reactive-log.js": "@graphrefly/pure-ts/extra", // → data-structures/reactive-log (substrate)
	"extra/reactive-log": "@graphrefly/pure-ts/extra",
	"extra/reactive-map.js": "@graphrefly/pure-ts/extra", // → data-structures/reactive-map (substrate)
	"extra/reactive-map": "@graphrefly/pure-ts/extra",
	"extra/reactive.js": "@graphrefly/pure-ts/extra",
	"extra/reactive": "@graphrefly/pure-ts/extra",
	"extra/resilience.js": "@graphrefly/pure-ts/extra", // → resilience/index (now in root)
	"extra/resilience": "@graphrefly/pure-ts/extra",
	"extra/sources.js": "@graphrefly/pure-ts/extra", // → sources/index (substrate, trimmed)
	"extra/sources": "@graphrefly/pure-ts/extra",
	"extra/storage-core.js": "@graphrefly/pure-ts/extra", // → storage/core (substrate)
	"extra/storage-core": "@graphrefly/pure-ts/extra",
	"extra/storage-node.js": "@graphrefly/pure-ts/extra", // → storage/tiers-node (substrate)
	"extra/storage-node": "@graphrefly/pure-ts/extra",
	"extra/storage-tiers.js": "@graphrefly/pure-ts/extra", // → storage/tiers (substrate)
	"extra/storage-tiers": "@graphrefly/pure-ts/extra",
	"extra/storage-tiers-node.js": "@graphrefly/pure-ts/extra",
	"extra/storage-tiers-node": "@graphrefly/pure-ts/extra",
	"extra/storage-tiers-browser.js": "@graphrefly/pure-ts/extra",
	"extra/storage-tiers-browser": "@graphrefly/pure-ts/extra",
	"extra/storage-wal.js": "@graphrefly/pure-ts/extra", // → storage/wal (substrate)
	"extra/storage-wal": "@graphrefly/pure-ts/extra",
	"extra/stratify.js": "@graphrefly/pure-ts/extra", // → composition/stratify (substrate)
	"extra/stratify": "@graphrefly/pure-ts/extra",
	// Also: extra/cron.ts was merged into base/sources/event/cron.ts (presentation)
	// extra/timer.ts moved to core/_internal/timer.ts (substrate)
	"extra/timer.js": "@graphrefly/pure-ts/extra",
	"extra/timer": "@graphrefly/pure-ts/extra",
	// extra/index.ts barrel (substrate, trimmed)
	"extra/index.js": "@graphrefly/pure-ts/extra",
	"extra/index": "@graphrefly/pure-ts/extra",
};

function isSubstratePath(relPath: string): boolean {
	// relPath is like "../../core/messages.js" — strip leading dots
	const normalPath = relPath.replace(/^(\.\.\/)+/, "");
	// Check substrate dirs
	if (SUBSTRATE_DIRS.some((sub) => normalPath.startsWith(sub))) return true;
	// Check deleted shims
	if (normalPath in SHIM_REMAP) return true;
	return false;
}

function relToPackagePath(relPath: string): string | null {
	const normalPath = relPath.replace(/^(\.\.\/)+/, "");

	// Check shim remap first
	if (normalPath in SHIM_REMAP) return SHIM_REMAP[normalPath]!;

	if (normalPath.startsWith("core/")) {
		// e.g., core/messages.js → @graphrefly/pure-ts/core/messages.js
		// or core/index.js → @graphrefly/pure-ts/core
		const rest = normalPath.slice("core/".length);
		if (rest === "index.js" || rest === "index") return "@graphrefly/pure-ts/core";
		return `@graphrefly/pure-ts/core/${rest}`;
	}

	if (normalPath.startsWith("graph/")) {
		const rest = normalPath.slice("graph/".length);
		if (rest === "index.js" || rest === "index") return "@graphrefly/pure-ts/graph";
		return `@graphrefly/pure-ts/graph/${rest}`;
	}

	if (
		normalPath.startsWith("extra/operators") ||
		normalPath.startsWith("extra/data-structures") ||
		normalPath.startsWith("extra/storage") ||
		normalPath.startsWith("extra/composition/stratify") ||
		normalPath.startsWith("extra/sources/sync") ||
		normalPath.startsWith("extra/sources/event/timer") ||
		normalPath.startsWith("extra/sources/_internal") ||
		normalPath.startsWith("extra/sources/index")
	) {
		// All substrate extra → @graphrefly/pure-ts/extra/... (specific subpath)
		// or just @graphrefly/pure-ts/extra for the barrel
		if (normalPath === "extra/index.js" || normalPath === "extra/index")
			return "@graphrefly/pure-ts/extra";
		if (normalPath === "extra/sources/index.js" || normalPath === "extra/sources/index")
			return "@graphrefly/pure-ts/extra";
		// Return specific path for submodule imports
		return `@graphrefly/pure-ts/${normalPath}`;
	}

	if (normalPath.startsWith("testing/")) {
		const rest = normalPath.slice("testing/".length);
		if (rest === "index.js" || rest === "index") return "@graphrefly/pure-ts/testing";
		return `@graphrefly/pure-ts/testing/${rest}`;
	}

	return null;
}

// ---------------------------------------------------------------------------
// Walk files in root src/
// ---------------------------------------------------------------------------

async function walk(dir: string): Promise<string[]> {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	const entries = await readdir(dir, { withFileTypes: true });
	for (const e of entries) {
		const p = join(dir, e.name);
		if (e.name === "node_modules" || e.name === "dist") continue;
		if (e.isDirectory()) out.push(...(await walk(p)));
		else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts")) {
			out.push(p);
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Fix a single file
// ---------------------------------------------------------------------------

let totalFixed = 0;
let totalFiles = 0;

async function fixFile(absFile: string): Promise<void> {
	const src = await readFile(absFile, "utf8");

	const importRe = /^((?:import|export)[^"'`\n]*from\s+)(["'])(\.[^"'`]+)\2/gm;

	let changed = false;
	let result = src;
	const edits: Array<{ from: number; to: number; replacement: string }> = [];

	importRe.lastIndex = 0;
	for (let m = importRe.exec(src); m !== null; m = importRe.exec(src)) {
		const spec = m[3];
		if (!spec.startsWith(".")) continue;

		if (!isSubstratePath(spec)) continue;

		const packagePath = relToPackagePath(spec);
		if (!packagePath) continue;

		if (packagePath !== spec) {
			const newFull = m[1] + m[2] + packagePath + m[2];
			edits.push({ from: m.index, to: m.index + m[0].length, replacement: newFull });
			changed = true;
		}
	}

	if (changed) {
		edits.sort((a, b) => b.from - a.from);
		for (const edit of edits) {
			result = result.slice(0, edit.from) + edit.replacement + result.slice(edit.to);
		}

		if (!DRY) {
			await writeFile(absFile, result, "utf8");
		}

		totalFixed++;
		const relFile = absFile.replace(ROOT + "/", "");
		console.log(`  ${DRY ? "[DRY] " : ""}FIXED: ${relFile} (${edits.length} imports)`);
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	console.log(`\n=== fix-substrate-imports ${DRY ? "(DRY RUN)" : "(LIVE)"} ===\n`);
	console.log("Scanning root src/ for relative substrate imports...\n");

	const files = await walk(ROOT_SRC);
	totalFiles = files.length;

	for (const f of files) {
		await fixFile(f);
	}

	console.log(`\n=== SUMMARY ===`);
	console.log(`  Files scanned: ${totalFiles}`);
	console.log(`  Files fixed:   ${totalFixed}`);
	console.log(`\n=== DONE ===\n`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
