/**
 * Layer-boundary enforcement (D201). Zero-dep standalone check — wired into
 * `pnpm lint`. GritQL (Biome's plugin language) cannot express a computed
 * import-path-rank comparison, so D201's "Biome custom rule" is realized as
 * this script (D201 mechanism note amended 2026-05-15).
 *
 * Rule: inside `@graphrefly/graphrefly` (root `src/`), imports must flow
 * strictly top-down:
 *
 *   substrate(0) ◄ base(1) ◄ utils(2) ◄ presets(3) ◄ solutions(4) ◄ compat(5)
 *
 * A file at rank R may import substrate (rank 0), its own layer (rank R), and
 * any lower rank. Importing a HIGHER rank is a violation. Substrate
 * (`@graphrefly/pure-ts` / `@graphrefly/native`) is always importable.
 *
 * Test files under `src/__tests__/<layer>/` take that layer's rank.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "src");

/**
 * Baseline ratchet: known violations deferred to the next batch (cleave class
 * A + C). A baselined violation warns instead of failing; a NEW violation
 * fails; a baseline entry that no longer matches ALSO fails (forces removal as
 * fixes land). Key format: `<repoRelFile> -> <importSpec>`.
 */
const baselineFile = join(ROOT, "scripts/layer-boundary-baseline.json");
let baseline = new Set<string>();
try {
	baseline = new Set<string>(
		(JSON.parse(readFileSync(baselineFile, "utf8")).baseline as string[]) ?? [],
	);
} catch {
	/* no baseline file — treat all violations as hard failures */
}
const seenBaseline = new Set<string>();

const RANK: Record<string, number> = {
	base: 1,
	utils: 2,
	presets: 3,
	solutions: 4,
	compat: 5,
};

/**
 * Layer rank for a repo-relative path, or null if not layer-scoped.
 *
 * `src/__tests__/**` is intentionally unranked: integration tests legitimately
 * cross layers (a `base/` test exercising a `compat` adapter must import
 * compat). Test files aren't shipped, so they're not part of the dependency
 * DAG. The rule enforces the SHIPPED-source DAG only. (Supersedes the A1 doc's
 * "rule applies to tests too" — that produced 10 false positives.)
 */
function rankOf(repoRelPath: string): number | null {
	const m = repoRelPath.match(/^src\/([^/]+)\//);
	if (!m || m[1] === "__tests__") return null; // root barrels / test files
	return RANK[m[1]] ?? null;
}

/** Rank of an import specifier as seen from `fromFile` (repo-relative). */
function targetRank(spec: string, fromFileAbs: string): number | null {
	// Substrate peers — always rank 0 (importable from anywhere).
	if (spec === "@graphrefly/pure-ts" || spec.startsWith("@graphrefly/pure-ts/")) return 0;
	if (spec === "@graphrefly/native" || spec.startsWith("@graphrefly/native/")) return 0;
	// Only relative imports can cross internal layers.
	if (!spec.startsWith(".")) return null; // npm dep / node: builtin / vitest — ignore
	const resolvedAbs = resolve(dirname(fromFileAbs), spec);
	const repoRel = relative(ROOT, resolvedAbs).split("\\").join("/");
	return rankOf(repoRel);
}

const IMPORT_RE =
	/(?:^|\n)\s*(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']|(?:^|[^.\w])import\(\s*["']([^"']+)["']\s*\)/g;

function walk(dir: string, out: string[]): void {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === "node_modules" || e.name === "dist") continue;
		const p = join(dir, e.name);
		if (e.isDirectory()) walk(p, out);
		else if (/\.(ts|tsx|mts|cts)$/.test(e.name)) out.push(p);
	}
}

let violations = 0;
const files: string[] = [];
try {
	if (statSync(SRC).isDirectory()) walk(SRC, files);
} catch {
	console.error("layer-boundary: src/ not found");
	process.exit(1);
}

for (const fileAbs of files) {
	const repoRel = relative(ROOT, fileAbs).split("\\").join("/");
	const srcRank = rankOf(repoRel);
	if (srcRank == null) continue; // composition root / shared test helpers — unranked
	const text = readFileSync(fileAbs, "utf8");
	for (const m of text.matchAll(IMPORT_RE)) {
		const spec = m[1] ?? m[2];
		if (!spec) continue;
		const tRank = targetRank(spec, fileAbs);
		if (tRank == null) continue; // unranked target — not a layer edge
		if (tRank > srcRank) {
			const key = `${repoRel} -> ${spec}`;
			if (baseline.has(key)) {
				seenBaseline.add(key);
				continue; // deferred to next batch — tracked, not a hard fail
			}
			violations++;
			console.error(
				`layer-boundary: ${repoRel} (rank ${srcRank}) imports "${spec}" (rank ${tRank}) — ` +
					`imports must flow top-down: substrate < base < utils < presets < solutions < compat`,
			);
		}
	}
}

// Ratchet integrity: a baseline entry that no longer fires has been fixed —
// it MUST be removed so the baseline can only shrink.
const stale = [...baseline].filter((k) => !seenBaseline.has(k));
if (stale.length > 0) {
	console.error(
		`\nlayer-boundary: ${stale.length} baseline entr(y/ies) no longer violated — ` +
			`remove from scripts/layer-boundary-baseline.json (the layering was fixed):`,
	);
	for (const k of stale) console.error(`  - ${k}`);
	process.exit(1);
}

if (violations > 0) {
	console.error(`\nlayer-boundary: ${violations} NEW violation(s) (not in baseline).`);
	process.exit(1);
}
console.log(
	`layer-boundary: ${files.length} files checked, no new violations ` +
		`(${seenBaseline.size} baselined — deferred to next batch).`,
);
