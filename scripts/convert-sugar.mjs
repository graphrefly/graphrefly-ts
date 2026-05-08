/**
 * Script to convert sugar function usages to raw node() calls.
 *
 * Transformations:
 *   state(v, opts) → node([], { ...opts, initial: v })
 *   state<T>(v)    → node<T>([], { initial: v })
 *   state()        → node([])
 *   derived/derivedT([deps], fn, opts) → node([deps], (batchData, actions, ctx) => { ... }, { describeKind: "derived", ...opts })
 *   effect/effectT([deps], fn, opts) → node([deps], (batchData, actions, ctx) => { ... }, { describeKind: "effect" })
 *   producer(fn, opts) → node((_data, actions, ctx) => { ... }, { describeKind: "producer" })
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// All files to transform, relative to repo root
const FILES = [
	"src/__tests__/core/sugar.test.ts",
	"src/__tests__/core/node.test.ts",
	"src/__tests__/core/protocol.test.ts",
	"src/__tests__/core/perf-smoke.test.ts",
	"src/__tests__/core/lifecycle.test.ts",
	"src/__tests__/core/regressions.test.ts",
	"src/__tests__/core/versioning.test.ts",
	"src/__tests__/core/multi-message-delivery.test.ts",
	"src/__tests__/extra/backpressure.test.ts",
	"src/__tests__/extra/resilience.test.ts",
	"src/__tests__/extra/reactive-log-stress.test.ts",
	"src/__tests__/extra/edge-cases.test.ts",
	"src/__tests__/extra/operator-protocol-matrix.test.ts",
	"src/__tests__/extra/operators.test.ts",
	"src/__tests__/extra/reactive-map-stress.test.ts",
	"src/__tests__/extra/reactive-index-stress.test.ts",
	"src/__tests__/extra/sources.test.ts",
	"src/__tests__/extra/mutation/mutation.test.ts",
	"src/__tests__/extra/session1-foundation.test.ts",
	"src/__tests__/extra/composite.test.ts",
	"src/__tests__/extra/worker.test.ts",
	"src/__tests__/extra/reactive-sink.test.ts",
	"src/__tests__/extra/reactive-list-stress.test.ts",
	"src/__tests__/phase5-llm-composition.test.ts",
	"src/__tests__/exports.test.ts",
	"src/__tests__/patterns/ai.test.ts",
	"src/__tests__/patterns/domain-templates.test.ts",
	"src/__tests__/patterns/harness-default-bridges.test.ts",
	"src/__tests__/patterns/harness.test.ts",
	"src/__tests__/patterns/reduction.test.ts",
	"src/__tests__/patterns/memory.test.ts",
	"src/__tests__/patterns/lens.test.ts",
	"src/__tests__/patterns/guarded-execution.test.ts",
	"src/__tests__/patterns/refine-loop.test.ts",
	"src/__tests__/patterns/refine-executor.test.ts",
	"src/__tests__/patterns/actuator-executor.test.ts",
	"src/__tests__/patterns/surface/surface.test.ts",
	"src/__tests__/patterns/messaging.test.ts",
	"src/__tests__/patterns/orchestration.test.ts",
	"src/__tests__/patterns/inspect-preset.test.ts",
	"src/__tests__/patterns/auto-solidify.test.ts",
	"src/__tests__/patterns/ai/agents/tool-execution.test.ts",
	"src/__tests__/patterns/demo-shell.test.ts",
	"src/__tests__/patterns/graphspec.test.ts",
	"src/__tests__/patterns/audit.test.ts",
	"src/__tests__/patterns/resilient-pipeline.test.ts",
	"src/__tests__/graph/graph.test.ts",
	"src/__tests__/graph/validate-observability.test.ts",
	"src/__tests__/graph/describe-ascii.test.ts",
	"src/__tests__/graph/validate-no-islands.test.ts",
	"src/__tests__/graph/codec.test.ts",
	"src/__tests__/graph/topology.test.ts",
	"src/__tests__/graph/explain.test.ts",
	"src/__tests__/graph/reactive-changesets.test.ts",
	"src/__tests__/graphspec/spec-roundtrip.test.ts",
	"src/__tests__/graphspec/factory-tags-audit.test.ts",
	"src/__tests__/graphspec/factory-tags-bundles.test.ts",
	"src/__tests__/evals/catalog-aware-evaluator.test.ts",
	"src/__tests__/compat/nestjs.test.ts",
	"src/__tests__/compat/zustand.test.ts",
	"src/__tests__/properties/_invariants.ts",
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

function processFile(relPath) {
	const filePath = resolve(REPO_ROOT, relPath);
	let src;
	try {
		src = readFileSync(filePath, "utf8");
	} catch (_e) {
		console.warn(`SKIP (not found): ${relPath}`);
		return;
	}

	// Check if file actually imports from sugar
	const hasSugarImport = src.includes("core/sugar.js");
	if (!hasSugarImport) {
		console.log(`SKIP (no sugar import): ${relPath}`);
		return;
	}

	const _original = src;

	// Determine which sugar symbols are imported
	const sugarImportMatch = src.match(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*core\/sugar\.js["']/);
	if (!sugarImportMatch) {
		console.warn(`No sugar import block found in ${relPath}`);
		return;
	}

	const importedSymbols = sugarImportMatch[1]
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const removedSymbols = [
		"state",
		"derived",
		"effect",
		"effectT",
		"derivedT",
		"producer",
		"DerivedFn",
		"EffectFn",
	];
	const keptSymbols = importedSymbols.filter((s) => !removedSymbols.includes(s));
	const removedFromThisFile = importedSymbols.filter((s) => removedSymbols.includes(s));

	if (removedFromThisFile.length === 0) {
		console.log(`SKIP (no sugar functions to remove): ${relPath}`);
		return;
	}

	console.log(`Processing: ${relPath}`);
	console.log(`  Removing: ${removedFromThisFile.join(", ")}`);

	// We'll track if we need to add `node` import
	const hasNodeImport = /from\s+["'][^"']*core\/node\.js["']/.test(src);
	const nodeImportHasNode =
		hasNodeImport &&
		/\bnode\b/.test(
			src.match(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*core\/node\.js["']/)?.[1] ?? "",
		);

	// We'll do replacement manually per file - return info for manual processing
	return {
		filePath,
		relPath,
		src,
		importedSymbols,
		keptSymbols,
		removedFromThisFile,
		hasNodeImport,
		nodeImportHasNode,
	};
}

// Analyze all files
for (const f of FILES) {
	const info = processFile(f);
	if (info) {
		console.log(`  Kept sugar symbols: ${info.keptSymbols.join(", ") || "(none)"}`);
		console.log(
			`  Has node import: ${info.hasNodeImport}, node already in it: ${info.nodeImportHasNode}`,
		);
	}
}
