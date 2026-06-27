/**
 * Runnable entry for the hello-world harness + refineExecutor demo.
 *
 * Run:
 *   pnpm --filter @graphrefly-examples/harness-refine-hello start
 *
 * Or with npx:
 *   npx tsx examples/harness-refine-hello/index.ts
 *
 * What this exercises end-to-end:
 *   1. `validateGraphObservability` preflight — mirrors what a dry-run
 *      would check without paying for the real adapter call.
 *   2. INTAKE → TRIAGE (dryRunAdapter canned JSON) → QUEUE → GATE.
 *   3. EXECUTE via `refineExecutor` — mounts a fresh `refineLoop` for
 *      the triaged item, converges on a catalog description containing
 *      every required keyword.
 *   4. VERIFY via `evalVerifier` — re-runs the SAME evaluator against
 *      the artifact emitted by EXECUTE. Consistent scoring means we
 *      never have the "LLM said it looks fine" gap.
 *   5. `graph.explain` prints the causal chain from intake → verify
 *      result so you can read the pipeline's reasoning.
 */

import { DATA, validateGraphObservability } from "@graphrefly/graphrefly";
import { graphSpecToPretty } from "@graphrefly/graphrefly/extra/render";
import type { VerifyResult } from "@graphrefly/graphrefly/patterns/harness";

import { helloHarness, REQUIRED_KEYWORDS } from "./pipeline.js";

const RULE = "─".repeat(60);
const HEAVY = "═".repeat(60);

const harness = helloHarness();

// --- Preflight: validate observability before paying for anything --------
const report = validateGraphObservability(harness, {
	formats: ["pretty", "mermaid"],
});
console.log(`${HEAVY}\nvalidateGraphObservability preflight`);
console.log(HEAVY);
console.log(report.summary());
if (!report.ok) {
	console.error("\nObservability preflight failed — aborting before harness run.");
	process.exit(1);
}

// --- Subscribe to verify results BEFORE publishing ----------------------
// Sources push lazily on activation; wiring the sink first avoids races.
let resolveVerify!: (v: VerifyResult) => void;
const verifyPromise = new Promise<VerifyResult>((resolve) => {
	resolveVerify = resolve;
});

const verifyUnsub = harness.verifyResults.latest.subscribe((msgs) => {
	for (const [type, value] of msgs) {
		if (type !== DATA || !value) continue;
		resolveVerify(value as VerifyResult);
	}
});

// --- Publish a synthetic intake item ------------------------------------
console.log(`\n${HEAVY}\nPublishing intake item\n${HEAVY}`);
harness.intake.publish({
	source: "eval",
	summary: `Catalog description missing keywords: ${REQUIRED_KEYWORDS.join(", ")}`,
	evidence:
		"Eval run 4 flagged that the shipped catalog entry for the GraphReFly protocol omits the terms the LLM relied on.",
	affectsAreas: ["catalog"],
	affectsEvalTasks: [...REQUIRED_KEYWORDS],
	severity: "high",
});

// --- Await the verify wave ----------------------------------------------
const TIMEOUT_MS = 2_000;
let timeoutId: ReturnType<typeof setTimeout> | undefined;
const timeout = new Promise<never>((_, reject) => {
	timeoutId = setTimeout(
		() => reject(new Error(`No VerifyResult emitted within ${TIMEOUT_MS}ms`)),
		TIMEOUT_MS,
	);
});

try {
	const verify = await Promise.race([verifyPromise, timeout]);
	if (timeoutId !== undefined) clearTimeout(timeoutId);

	console.log(`\n${RULE}\nVerifyResult received\n${RULE}`);
	console.log(`  verified:    ${verify.verified}`);
	console.log(`  findings:    ${verify.findings.join(" | ")}`);
	console.log(`  outcome:     ${verify.execution.outcome}`);
	console.log(`  detail:      ${verify.execution.detail}`);
	console.log(`  eval tasks:  ${JSON.stringify(verify.execution.item.affectsEvalTasks)}`);

	// The executor stashed the refined string on exec.artifact — dig it out.
	if (typeof verify.execution.artifact === "string") {
		console.log(`\n  refined text: "${verify.execution.artifact}"`);
	}

	// Topology snapshot — proves every wiring decision is inspectable.
	// The full causal trace lives in `graphSpecToMermaid(harness.describe())`;
	// we print the pretty text form here so the output stays terminal-friendly.
	console.log(`\n${HEAVY}\nTopology — graphSpecToPretty(graph.describe())\n${HEAVY}`);
	console.log(graphSpecToPretty(harness.describe()));

	verifyUnsub();
	harness.destroy();

	const exitCode = verify.verified ? 0 : 1;
	if (!verify.verified) {
		console.error(`\nVERIFY reported unverified — exiting ${exitCode}`);
	}
	process.exit(exitCode);
} catch (err) {
	if (timeoutId !== undefined) clearTimeout(timeoutId);
	console.error(err);
	verifyUnsub();
	harness.destroy();
	process.exit(2);
}
