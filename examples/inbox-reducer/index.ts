/**
 * Inbox reducer — runnable entry.
 *
 * Orchestration only. The pipeline topology lives in [pipeline.ts](./pipeline.ts)
 * (the copy-paste target); provider wiring in [adapter-stack.ts](./adapter-stack.ts);
 * dry-run mock in [dry-run-mock.ts](./dry-run-mock.ts); config in [config.ts](./config.ts).
 *
 * Flow:
 *   1. DRY RUN    — mock adapter, real prompts. Reports exact token counts,
 *                   USD estimate (if pricing in config), and exercises the
 *                   full observability surface (`graph.explain`, diagram link).
 *   2. CONFIRM    — prompt user (--yes to skip).
 *   3. REAL RUN   — resilientAdapter(withReplayCache(observableAdapter(provider))).
 *                   Stage log, budget stream, morning brief, causal chain.
 *   4. DELTA DEMO — push a 51st email, watch ONLY downstream-of-change re-fire.
 *                   Shows reactive recompute: fewer LLM calls than a full rerun.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import {
	awaitSettled,
	DATA,
	type Messages,
	TimeoutError,
	type TokenUsage,
	validateGraphObservability,
} from "@graphrefly/graphrefly";
import { computePrice, observableAdapter } from "@graphrefly/graphrefly/patterns/ai";

import { assertApiKey, buildAdapterStack } from "./adapter-stack.js";
import { config } from "./config.js";
import { buildDryRunMock } from "./dry-run-mock.js";
import { EMAILS, type Email } from "./emails.js";
import { inboxReducerGraph } from "./pipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, ".cache");
const BRIEF_TIMEOUT_MS = Number(process.env.INBOX_TIMEOUT_MS ?? "120000");

// ---------------------------------------------------------------------------
// Small I/O helpers
// ---------------------------------------------------------------------------

const hr = (char = "─", width = 72): string => char.repeat(width);

async function confirm(question: string): Promise<boolean> {
	if (process.argv.includes("--yes") || process.argv.includes("-y")) return true;
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(`${question} [y/N] `, (ans) => {
			rl.close();
			resolve(ans.trim().toLowerCase() === "y");
		});
	});
}

// (Flowchart rendering — `graph.describe({ format: "ascii" })` produces a
// stdout-native DAG diagram with Unicode box-drawing glyphs. For clickable
// mermaid, `describe({ format: "mermaid-url" })` encodes a mermaid.live
// deep link; for bare mermaid text use `format: "mermaid"`.)

// ---------------------------------------------------------------------------
// Stage-log formatter for subscribers
// ---------------------------------------------------------------------------

function stageLog(name: string, tag = "stage"): (msgs: Messages) => void {
	return (msgs) => {
		for (const [type, value] of msgs) {
			if (type !== DATA) continue;
			let preview: string;
			if (Array.isArray(value)) preview = `${value.length} items`;
			else if (typeof value === "string") preview = `${value.length} chars`;
			else if (value == null) preview = "null";
			else preview = typeof value;
			console.log(`[${tag}]     ${name.padEnd(16)} → ${preview}`);
		}
	};
}

// ---------------------------------------------------------------------------
// DRY RUN — mock adapter, full observability surface
// ---------------------------------------------------------------------------

async function dryRun(): Promise<void> {
	console.log(`\n${hr("═")}`);
	console.log("DRY RUN — no API calls, no spend");
	console.log(hr("═"));
	console.log(`Provider:   ${config.primary.kind}    Model: ${config.primary.model}`);
	console.log(`Cache dir:  ${CACHE_DIR}`);
	console.log(`Timeout:    ${BRIEF_TIMEOUT_MS}ms (INBOX_TIMEOUT_MS)`);

	const { adapter, stats } = observableAdapter(
		buildDryRunMock(config.primary.kind, config.primary.model),
		{ name: `${config.primary.model}::dryrun` },
	);
	const { graph, brief } = inboxReducerGraph(adapter, EMAILS);

	try {
		await awaitSettled(brief, {
			predicate: (v) => typeof v === "string",
			timeoutMs: BRIEF_TIMEOUT_MS,
		});

		// Smoke-exercise every observability surface the real run touches —
		// if describe / explain / ascii renderers regress, we fail loud HERE
		// instead of after any wire spend (CLAUDE.md "Dry-run equivalence rule").
		const smoke = validateGraphObservability(graph, {
			pairs: [["emails", "brief"]],
			formats: ["ascii", "pretty"],
		});
		if (!smoke.ok) {
			console.error(`\n!! ${smoke.summary()}. Aborting before any spend.`);
			for (const f of smoke.failures) console.error(JSON.stringify(f));
			process.exit(3);
		}
		const chain = graph.explain("emails", "brief");
		console.log(
			`Causal chain: ${chain.steps.length} hops (${chain.steps.map((s) => s.path).join(" → ")})`,
		);
		// Exercise the `.text` render too — the real run prints it.
		if (chain.text.length < 10) {
			console.error(`\n!! graph.explain().text render is degenerate. Aborting.`);
			process.exit(3);
		}
		// Path 1B — stdout-native DAG flowchart via `describe({ format: "ascii" })`.
		console.log("\nFlowchart:");
		console.log(graph.describe({ format: "ascii" }));
	} finally {
		graph.destroy();
	}

	const inputTokens = stats.totalInputTokens.cache ?? 0;
	const outputTokens = stats.totalOutputTokens.cache ?? 0;
	const calls = stats.totalCalls.cache ?? 0;

	console.log(`\nLLM calls this run:  ${calls}`);
	console.log(`Input tokens:        ${inputTokens.toLocaleString()}`);
	console.log(`Output tokens (mock): ${outputTokens.toLocaleString()}`);

	const pricing = config.primary.capabilities?.pricing;
	if (pricing) {
		const usage: TokenUsage = {
			input: { regular: inputTokens },
			output: { regular: outputTokens },
		};
		const price = computePrice(usage, pricing);
		console.log(
			`Estimated cost:      $${price.total.toFixed(4)} ${price.currency} (from config.ts pricing).`,
		);
	} else {
		console.log(
			"Estimated cost:      not computed — add `capabilities.pricing` in config.ts for USD.",
		);
	}
	console.log();
}

// ---------------------------------------------------------------------------
// REAL RUN — full safety stack, stage log, causal chain, then DELTA demo
// ---------------------------------------------------------------------------

async function realRun(): Promise<void> {
	assertApiKey(config.primary);
	if (config.fallback) assertApiKey(config.fallback);
	if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

	console.log(`\n${hr("═")}`);
	console.log("REAL RUN");
	console.log(hr("═"));

	const { adapter, stats, onBudget } = buildAdapterStack(config, CACHE_DIR);
	onBudget?.((line) => console.log(`[budget]    ${line}`));

	const { graph, emails, classifications, actionable, extractions, ranked, top3, brief } =
		inboxReducerGraph(adapter, EMAILS);

	// Wire stage logs. `graph.destroy` will TEARDOWN these subscribers, so
	// we don't need to collect unsub tokens.
	emails.subscribe(stageLog("emails"));
	classifications.subscribe(stageLog("classifications"));
	actionable.subscribe(stageLog("actionable"));
	extractions.subscribe(stageLog("extractions"));
	ranked.subscribe(stageLog("ranked"));
	top3.subscribe(stageLog("top3"));
	brief.subscribe(stageLog("brief"));

	try {
		const briefText = await awaitSettled(brief, {
			predicate: (v) => typeof v === "string",
			timeoutMs: BRIEF_TIMEOUT_MS,
		});

		console.log(`\n${hr("═")}`);
		console.log("MORNING BRIEF");
		console.log(hr("═"));
		console.log(briefText);

		console.log(`\n${hr("═")}`);
		console.log("CAUSAL CHAIN — graph.explain('emails', 'brief')");
		console.log(hr("═"));
		console.log(graph.explain("emails", "brief").text);

		// --- Path 2: reactive delta demo --------------------------------------
		console.log(`\n${hr("═")}`);
		console.log("REACTIVE DELTA — push a 51st email, wait for pipeline to re-fire");
		console.log(hr("═"));
		console.log("Resetting call counter, pushing a 51st email...\n");
		// Reference `briefText` to silence the unused-variable warning — we
		// used to compare against it; the counter-based gate below is more
		// robust, but keeping the capture documents that we saw a prior value.
		void briefText;
		stats.reset();

		const newEmail: Email = {
			id: "e51",
			from: "carol@acme.co",
			subject: "Can you approve the Q3 budget by tomorrow?",
			snippet: "Finance needs sign-off on the attached line items before tomorrow's board meeting.",
			receivedAt: "2026-04-22T08:00:00Z",
		};
		emails.emit([...EMAILS, newEmail]);

		// Count-based gate: wait for classify + extract + brief to all fire
		// once on the new input (3 total delta calls). Avoids both the
		// push-on-subscribe race (stale cached brief) AND the false-timeout
		// when the model happens to return an identical brief for similar
		// inputs. `stats.totalCalls` was reset above, so this counts only
		// delta-triggered calls.
		await awaitSettled(stats.totalCalls, {
			predicate: (n) => n >= 3,
			timeoutMs: BRIEF_TIMEOUT_MS,
		});

		const deltaCalls = stats.totalCalls.cache ?? 0;
		const deltaIn = stats.totalInputTokens.cache ?? 0;
		const deltaOut = stats.totalOutputTokens.cache ?? 0;
		console.log(
			`\nDelta complete: ${deltaCalls} LLM calls · ${deltaIn.toLocaleString()}t in · ${deltaOut.toLocaleString()}t out.`,
		);
		console.log("");
		console.log("Honest read of this topology:");
		console.log("  classify/extract/brief ALL re-fire because the classify prompt batches");
		console.log("  every email — a single-email delta still rebuilds every stage.");
		console.log("  The reactive topology DID save work on the deterministic nodes (actionable,");
		console.log("  ranked, top3 — pure recompute, no LLM), but LLM spend is driven by the prompt");
		console.log("  shape, not reactivity alone.");
		console.log("");
		console.log("To get a real reactive-savings win, split classify into a per-email `map` —");
		console.log("then a 1-email delta is 1 classify + 1 extract + 1 brief = 3 small calls vs.");
		console.log("50+1+1 = 52 for a full rerun. Topology determines the savings.");
	} finally {
		const finalStats = `${stats.totalCalls.cache ?? 0} wire calls · ${(stats.totalInputTokens.cache ?? 0).toLocaleString()}t in · ${(stats.totalOutputTokens.cache ?? 0).toLocaleString()}t out`;
		console.log(`\n${hr("─")}`);
		console.log(`Final delta stats: ${finalStats}`);
		console.log(`Replay cache at ${CACHE_DIR} — delete to force fresh API calls.`);
		graph.destroy();
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
	await dryRun();
	const ok = await confirm("Proceed to real run?");
	if (!ok) {
		console.log("Cancelled — no API calls made.");
		process.exit(0);
	}
	await realRun();
})().catch((err) => {
	if (err instanceof TimeoutError) {
		console.error(
			`\nBrief did not settle within ${BRIEF_TIMEOUT_MS}ms (INBOX_TIMEOUT_MS).` +
				"\nCheck the [adapter] lines above for the real cause; raise INBOX_TIMEOUT_MS" +
				"\nfor slow local models, or drop resilience.timeoutMs in config.ts if a" +
				"\nper-call timeout is aborting individual HTTP calls too quickly.",
		);
	} else {
		console.error("\nRun failed:", err);
	}
	process.exit(1);
});
