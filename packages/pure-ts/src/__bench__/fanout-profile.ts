/**
 * Fan-out sink-notification profiling harness (docs/optimizations.md Item 1).
 *
 * Not a vitest bench — run with `pnpm tsx src/__bench__/fanout-profile.ts`
 * (or the equivalent node invocation). Prints a structured table of
 * per-sub-notification cost across the scale curve, cross-checked via the
 * built-in per-node `v.version` counter (spec §7, V0) and `graphProfile()`.
 *
 * Goal: expose whether per-emit cost scales linearly with subscriber count
 * or has a super-linear component — the optimization doc's hypothesis is
 * that `_deliverToSinks`' `[...this._sinks]` snapshot allocation dominates
 * past ~100 subs. The harness makes the snapshot-array allocation count
 * explicit (2 per emit, since downWithBatch splits DIRTY (tier 1) and DATA
 * (tier 3) into separate `sink()` calls even outside batch — confirmed via
 * notifyCount === 2 * subs * emits).
 */

import { node } from "../core/node.js";
import { Graph } from "../graph/graph.js";
import { graphProfile } from "../graph/profile.js";

const SUB_COUNTS = [1, 10, 50, 100, 500, 1000, 5000];
const EMITS = 20_000;
const WARMUP_EMITS = 2_000;

interface Sample {
	subs: number;
	emits: number;
	elapsedMs: number;
	hz: number;
	nsPerEmit: number;
	nsPerNotify: number;
	nsPerSubAmortized: number;
	versionDelta: number;
	notifyCount: number;
}

function sample(subs: number): Sample {
	const src = node<number>([], { initial: 0, versioning: 0 });
	let notifyCount = 0;
	const unsubs: (() => void)[] = [];
	for (let i = 0; i < subs; i++) {
		unsubs.push(
			src.subscribe(() => {
				notifyCount++;
			}),
		);
	}

	// Structural sanity check via graphProfile — confirms the harness
	// actually built the topology we think we built.
	const g = new Graph("fanout-probe");
	g.add(src, { name: "src" });
	const profile = graphProfile(g);
	const target = profile.nodes.find((n) => n.path === "src");
	if (!target || target.subscriberCount !== subs) {
		throw new Error(
			`graphProfile mismatch: expected ${subs} subs, got ${target?.subscriberCount ?? "missing"}`,
		);
	}

	const versionBefore = src.v?.version ?? 0;

	// Warmup (skip the first batch of emits to let v8 stabilize).
	for (let i = 0; i < WARMUP_EMITS; i++) src.emit(i);
	notifyCount = 0;

	const t0 = process.hrtime.bigint();
	for (let i = 0; i < EMITS; i++) src.emit(WARMUP_EMITS + i);
	const t1 = process.hrtime.bigint();

	for (const u of unsubs) u();

	const elapsedNs = Number(t1 - t0);
	const versionDelta = (src.v?.version ?? 0) - versionBefore;
	const hz = (EMITS / elapsedNs) * 1e9;

	return {
		subs,
		emits: EMITS,
		elapsedMs: elapsedNs / 1e6,
		hz,
		nsPerEmit: elapsedNs / EMITS,
		nsPerNotify: elapsedNs / Math.max(notifyCount, 1),
		nsPerSubAmortized: elapsedNs / EMITS / Math.max(subs, 1),
		versionDelta,
		notifyCount,
	};
}

function fmtNum(n: number, digits = 0): string {
	return n.toLocaleString("en-US", {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
	});
}

function main(): void {
	console.log("Fan-out scaling probe — docs/optimizations.md Item 1");
	console.log(`Emits per sample: ${EMITS} (after ${WARMUP_EMITS} warmup emits, discarded)`);
	console.log("Expected notifyCount per sample = 2 × subs × emits (DIRTY + DATA tier groups).");
	console.log("Expected versionDelta = emits + warmup (all unique values).");
	console.log();

	const samples = SUB_COUNTS.map(sample);

	console.log("| subs  |        hz |  ns/emit | ns/notify | ns/sub (amort) | notifyCount | vΔ |");
	console.log("|-------|-----------|----------|-----------|----------------|-------------|----|");
	for (const s of samples) {
		const vSentinel =
			s.versionDelta === EMITS + WARMUP_EMITS ? "" : ` ✗expected ${EMITS + WARMUP_EMITS}`;
		const expectNotify = 2 * s.subs * EMITS;
		const notifyOk = s.notifyCount === expectNotify ? "" : ` ✗expected ${fmtNum(expectNotify)}`;
		console.log(
			`| ${s.subs.toString().padStart(5)} | ${fmtNum(s.hz).padStart(9)} | ${s.nsPerEmit
				.toFixed(0)
				.padStart(8)} | ${s.nsPerNotify.toFixed(2).padStart(9)} | ${s.nsPerSubAmortized
				.toFixed(2)
				.padStart(
					14,
				)} | ${fmtNum(s.notifyCount).padStart(11)}${notifyOk} | ${s.versionDelta}${vSentinel} |`,
		);
	}

	console.log();
	console.log("Per-notify cost vs. 1-sub baseline (constant = linear scaling):");
	const base = samples[0].nsPerNotify;
	for (const s of samples) {
		const ratio = s.nsPerNotify / base;
		console.log(
			`  ${s.subs.toString().padStart(5)} subs: ${s.nsPerNotify.toFixed(2)} ns/notify (${ratio.toFixed(2)}× baseline)`,
		);
	}

	console.log();
	console.log("Interpretation key:");
	console.log(
		"  - Linear scaling → ns/notify ≈ constant across sub counts. Any rise reveals per-emit overhead that doesn't amortize per sink.",
	);
	console.log(
		"  - Prime suspect: `NodeImpl._deliverToSinks` allocates `[...this._sinks]` on every sink() call. With N subs × 2 sink() calls/emit × M emits, that's 2NM array slots allocated.",
	);
	console.log(
		"  - Secondary suspect: `downWithBatch` allocates `messages.slice(...)` per tier split and wraps deferred phases in closures. Closure cost does NOT depend on sub count — it's per-emit, not per-notify.",
	);
}

main();
