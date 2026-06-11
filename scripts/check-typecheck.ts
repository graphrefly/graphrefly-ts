/**
 * Typecheck gate for legacy workspace packages that nothing else typechecks.
 *
 * `packages/parity-tests/` runs via vitest, which strips types through esbuild,
 * so `tsc` does not otherwise run on it in `pnpm test`, `pnpm build`, or CI.
 * This script closes that gap by running `tsc --noEmit` and hard-failing on
 * any error.
 *
 * **No baseline.** The checked package was driven to **zero** errors. A new
 * type error fails `pnpm lint`; do not add a baseline to silence it.
 *
 * B65 note: `evals/` still imports the retired root `src/` implementation and
 * is no longer part of the active clean-slate lint gate. Migrate or retire it
 * in a dedicated B64/B66 cleanup slice before re-adding it here.
 */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const TSC = resolve(ROOT, "node_modules/.bin/tsc");

/** Previously-ungated packages this gate now enforces. */
const TARGETS: readonly { name: string; project: string }[] = [
	{ name: "parity-tests", project: "packages/parity-tests/tsconfig.json" },
];

let failed = false;

for (const { name, project } of TARGETS) {
	try {
		execFileSync(TSC, ["--noEmit", "-p", project], {
			cwd: ROOT,
			stdio: "pipe",
			encoding: "utf8",
			// QA-P5: tsc on a large pre-existing-error dump can exceed
			// Node's default 1 MB pipe buffer → ENOBUFS truncates output
			// and the `error TS\d+` count under-reports (a misleading
			// "0 error(s)"). 64 MB headroom.
			maxBuffer: 64 * 1024 * 1024,
		});
		console.log(`typecheck: ${name} (${project}) — clean`);
	} catch (e) {
		failed = true;
		const err = e as { stdout?: string; stderr?: string; code?: string };
		const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
		const count = (out.match(/error TS\d+/g) ?? []).length;
		// QA-P5: discriminate "tsc failed to RUN" (ENOENT — fresh checkout
		// pre-install, bad path) from "tsc ran and found type errors".
		// The old message ("fix the error, do not silence it") misdirects
		// when the real problem is a missing toolchain / bad project path.
		if (count === 0 && (err.code === "ENOENT" || !out)) {
			console.error(
				`\ntypecheck: ${name} (${project}) — tsc FAILED TO RUN ` +
					`(code=${err.code ?? "unknown"}). Not a type error: check ` +
					`that \`node_modules/.bin/tsc\` exists (\`pnpm install\`) and ` +
					`the tsconfig path is valid.\n`,
			);
		} else {
			console.error(
				`\ntypecheck: ${name} (${project}) — ${count} error(s). ` +
					`This gate has NO baseline: fix the error, do not silence it.\n`,
			);
		}
		console.error(out);
	}
}

if (failed) {
	process.exit(1);
}
console.log(`typecheck: ${TARGETS.length} package(s) checked, all clean.`);
