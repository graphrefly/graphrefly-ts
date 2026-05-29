/**
 * R-no-raw-async enforcement for the clean-slate @graphrefly/ts package (B21 / D43).
 *
 * Raw async primitives must live ONLY at the sanctioned async boundary: sources
 * (`graph/sources.ts`) and the pool/runner layer (R-no-raw-async / F-SYNC-CORE —
 * "async boundaries live only in sources and the pool/runner layer"). The sync wave
 * core and the rest of the graph layer must stay sync. This catches a raw
 * `setTimeout`/`Promise`/`for await`/`async` leaking outside that boundary.
 *
 * Biome's GritQL can't express this (same reason `check-layer-boundary.ts` is a
 * script), and `noRestrictedGlobals` can't cover `new Promise`/`Promise.resolve`/
 * `for await` (not globals) — so the full R-no-raw-async surface lives here, wired
 * into `pnpm lint`.
 *
 * Comment-aware: strips `//` and block comments (newlines preserved) so prose
 * mentions ("kicks off async work") don't trip the scan. Test files are exempt.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "packages/ts/src");

/**
 * Files where raw async IS the sanctioned boundary (R-no-raw-async). Keep this set
 * as small as possible — every entry is a hole in the guard. When a real async pool
 * (WorkerPool/RemotePool, D20) lands, add the pool/runner file here.
 */
const ALLOW = new Set<string>(["packages/ts/src/graph/sources.ts"]);

/** Risky code patterns, matched AFTER comment-stripping. */
const PATTERNS: Array<[RegExp, string]> = [
	[/\bsetTimeout\s*\(/, "setTimeout("],
	[/\bsetInterval\s*\(/, "setInterval("],
	[/\bsetImmediate\s*\(/, "setImmediate("],
	[/\bqueueMicrotask\s*\(/, "queueMicrotask("],
	[/\bprocess\s*\.\s*nextTick\b/, "process.nextTick"],
	[/\bnew\s+Promise\b/, "new Promise"],
	[/\bPromise\s*\.\s*(?:resolve|reject|all|race|allSettled|any)\s*\(/, "Promise.<combinator>()"],
	[/\bfor\s+await\b/, "for await"],
	[/\basync\s+(?:function|\*|\(|[A-Za-z_$])/, "async function/method/arrow"],
	[/\bawait\s/, "await"],
];

/** Strip `//` line comments and `/* *\/` block comments, preserving newlines for line numbers. */
function stripComments(text: string): string {
	let out = "";
	let state: "code" | "line" | "block" = "code";
	for (let i = 0; i < text.length; i++) {
		const two = text.slice(i, i + 2);
		if (state === "code") {
			if (two === "//") {
				state = "line";
				i++;
			} else if (two === "/*") {
				state = "block";
				i++;
			} else {
				out += text[i];
			}
		} else if (state === "line") {
			if (text[i] === "\n") {
				state = "code";
				out += "\n";
			}
		} else {
			// block
			if (two === "*/") {
				state = "code";
				i++;
			} else if (text[i] === "\n") {
				out += "\n";
			}
		}
	}
	return out;
}

function walk(dir: string, out: string[]): void {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === "node_modules" || e.name === "dist" || e.name === "__tests__") continue;
		const p = join(dir, e.name);
		if (e.isDirectory()) walk(p, out);
		else if (/\.(ts|tsx|mts|cts)$/.test(e.name)) out.push(p);
	}
}

const files: string[] = [];
try {
	if (statSync(SRC).isDirectory()) walk(SRC, files);
} catch {
	console.error("check-no-raw-async: packages/ts/src not found");
	process.exit(1);
}

let violations = 0;
for (const fileAbs of files) {
	const repoRel = relative(ROOT, fileAbs).split("\\").join("/");
	if (ALLOW.has(repoRel)) continue;
	const lines = stripComments(readFileSync(fileAbs, "utf8")).split("\n");
	for (let i = 0; i < lines.length; i++) {
		for (const [re, label] of PATTERNS) {
			if (re.test(lines[i])) {
				violations++;
				console.error(
					`check-no-raw-async: ${repoRel}:${i + 1} uses raw async \`${label}\` — ` +
						"async boundaries live ONLY in sources / the pool-runner layer (R-no-raw-async / F-SYNC-CORE). " +
						"Move it into a source (graph/sources.ts), or add this file to the ALLOW set if it IS the pool/runner boundary.",
				);
			}
		}
	}
}

if (violations > 0) {
	console.error(`\ncheck-no-raw-async: ${violations} violation(s).`);
	process.exit(1);
}
console.log(
	`check-no-raw-async: ${files.length} files checked, no raw async outside the sanctioned boundary ` +
		`(${ALLOW.size} allowlisted).`,
);
