/**
 * Memory bench — the third axis the user asked about ("performance / memory /
 * correctness"). Phase 13.7 follow-up to `rust-bench-v0-results.md`.
 *
 * Methodology:
 *   1. Build a large graph (state + N derived passthrough chain).
 *   2. Force GC if available; record `process.memoryUsage()`.
 *   3. Emit M times.
 *   4. Force GC again; record memoryUsage.
 *   5. Compare TS-only vs Rust-via-FFI: which holds less retained heap, which
 *      has lower peak heap during emission?
 *
 * Run with --expose-gc for honest GC-controlled numbers:
 *   pnpm tsx --expose-gc src/__bench__/memory.bench.ts
 *
 * Without --expose-gc the bench still runs but `gc()` calls are no-ops; peaks
 * are measured at whatever moment we sample. Rust-side state is OUTSIDE the
 * V8 heap, so the JS heap-usage delta IS the cleanest "GC pressure" signal.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const binding: any = require("/Users/davidchenallio/src/graphrefly-rs/target/release/graphrefly_bindings_js.node");

const GRAPH_SIZE = 1000; // 1000-node chain — large enough that Rust state is non-trivial
const EMITS = 1_000_000;

interface MemSnapshot {
	rss: number;
	heapTotal: number;
	heapUsed: number;
	external: number;
	arrayBuffers: number;
}

function snapshot(): MemSnapshot {
	const m = process.memoryUsage();
	return {
		rss: m.rss,
		heapTotal: m.heapTotal,
		heapUsed: m.heapUsed,
		external: m.external,
		arrayBuffers: m.arrayBuffers,
	};
}

function gcIfAvailable() {
	if (typeof globalThis.gc === "function") {
		globalThis.gc();
	}
}

function fmt(bytes: number): string {
	const mb = bytes / 1024 / 1024;
	return mb >= 1 ? `${mb.toFixed(2)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;
}

function delta(before: MemSnapshot, after: MemSnapshot, key: keyof MemSnapshot): string {
	const d = after[key] - before[key];
	const sign = d >= 0 ? "+" : "";
	return `${sign}${fmt(d)}`;
}

console.log("=".repeat(70));
console.log(`Memory bench — graph size ${GRAPH_SIZE}, ${EMITS.toLocaleString()} emits`);
const gcReady = typeof globalThis.gc === "function";
console.log(
	`  GC control: ${gcReady ? "enabled (--expose-gc)" : "DISABLED — run with --expose-gc for clean numbers"}`,
);
console.log("=".repeat(70));

// ---------------------------------------------------------------------------
// 1. TS-only baseline
// ---------------------------------------------------------------------------
async function tsOnlyBench() {
	const { HandleRuntime } = await import("/tmp/handle-core-compiled/bindings.js");
	gcIfAvailable();
	const before = snapshot();

	const rt = new HandleRuntime();
	const s = rt.state(0);
	let prev: { _id: unknown; current: () => unknown } = s as unknown as {
		_id: unknown;
		current: () => unknown;
	};
	for (let i = 0; i < GRAPH_SIZE; i++) {
		prev = rt.derived([prev as any], (v: unknown) => v as number);
	}
	rt.subscribe(prev as never, () => undefined);

	const afterBuild = snapshot();
	const t0 = process.hrtime.bigint();
	for (let i = 0; i < EMITS; i++) {
		s.set(i);
	}
	const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
	const peak = snapshot();

	gcIfAvailable();
	const afterGc = snapshot();

	console.log(`\n[TS-only] ${GRAPH_SIZE}-node chain + ${EMITS.toLocaleString()} emits`);
	console.log(
		`  graph build:    heapUsed ${delta(before, afterBuild, "heapUsed")}, rss ${delta(before, afterBuild, "rss")}`,
	);
	console.log(
		`  during emits:   heapUsed ${delta(afterBuild, peak, "heapUsed")} (peak), rss ${delta(afterBuild, peak, "rss")} (peak)`,
	);
	console.log(
		`  after gc:       heapUsed ${delta(afterBuild, afterGc, "heapUsed")} (retained), rss ${delta(afterBuild, afterGc, "rss")}`,
	);
	console.log(`  elapsed:        ${elapsedMs.toFixed(1)}ms`);
	console.log(
		`  TOTAL rss growth: ${delta(before, afterGc, "rss")} (V8 heap dominates here — pure JS)`,
	);
	return {
		elapsedMs,
		peakHeap: peak.heapUsed - afterBuild.heapUsed,
		peakRss: peak.rss - afterBuild.rss,
		totalRss: afterGc.rss - before.rss,
	};
}

// ---------------------------------------------------------------------------
// 2. Rust core via FFI
// ---------------------------------------------------------------------------
function rustViaFfiBench() {
	gcIfAvailable();
	const before = snapshot();

	const core = new binding.BenchCore();
	const s = core.registerStateInt(0);
	let prev = s;
	for (let i = 0; i < GRAPH_SIZE; i++) {
		prev = core.registerDerived([prev], "Identity");
	}
	core.subscribeNoop(prev);

	const afterBuild = snapshot();
	const t0 = process.hrtime.bigint();
	for (let i = 0; i < EMITS; i++) {
		core.emitInt(s, i);
	}
	const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
	const peak = snapshot();

	gcIfAvailable();
	const afterGc = snapshot();

	console.log(`\n[Rust via FFI] ${GRAPH_SIZE}-node chain + ${EMITS.toLocaleString()} emits`);
	console.log(
		`  graph build:    heapUsed ${delta(before, afterBuild, "heapUsed")}, rss ${delta(before, afterBuild, "rss")}`,
	);
	console.log(
		`  during emits:   heapUsed ${delta(afterBuild, peak, "heapUsed")} (peak), rss ${delta(afterBuild, peak, "rss")} (peak)`,
	);
	console.log(
		`  after gc:       heapUsed ${delta(afterBuild, afterGc, "heapUsed")} (retained), rss ${delta(afterBuild, afterGc, "rss")}`,
	);
	console.log(`  elapsed:        ${elapsedMs.toFixed(1)}ms`);
	console.log(`  TOTAL rss growth: ${delta(before, afterGc, "rss")} (this IS Rust+JS combined)`);
	return {
		elapsedMs,
		peakHeap: peak.heapUsed - afterBuild.heapUsed,
		peakRss: peak.rss - afterBuild.rss,
		totalRss: afterGc.rss - before.rss,
	};
}

(async () => {
	const ts = await tsOnlyBench();
	const rust = rustViaFfiBench();

	console.log(`\n${"=".repeat(70)}`);
	console.log("Comparison");
	console.log("=".repeat(70));
	console.log(`  Peak JS heap during emits (V8 only):`);
	console.log(`    TS-only:      ${fmt(ts.peakHeap)}`);
	console.log(`    Rust via FFI: ${fmt(rust.peakHeap)}`);
	const heapRatio = ts.peakHeap / Math.max(rust.peakHeap, 1);
	console.log(`    Ratio:        TS uses ${heapRatio.toFixed(1)}× more JS heap during emit loop`);
	console.log("");
	console.log("  Peak RSS during emits (TOTAL process memory — JS + Rust + everything):");
	console.log(`    TS-only:      ${fmt(ts.peakRss)}`);
	console.log(`    Rust via FFI: ${fmt(rust.peakRss)}`);
	const rssRatio = ts.peakRss / Math.max(rust.peakRss, 1);
	console.log(`    Ratio:        TS uses ${rssRatio.toFixed(1)}× more TOTAL memory at peak`);
	console.log("");
	console.log("  Total RSS growth (post-GC; what the process holds long-term):");
	console.log(`    TS-only:      ${fmt(ts.totalRss)}`);
	console.log(`    Rust via FFI: ${fmt(rust.totalRss)}`);
	if (ts.totalRss > 0 && rust.totalRss > 0) {
		console.log(
			`    Ratio:        TS holds ${(ts.totalRss / rust.totalRss).toFixed(1)}× more total memory after GC`,
		);
	}
	console.log("");
	console.log(`  Throughput:`);
	console.log(`    TS-only:      ${(EMITS / (ts.elapsedMs / 1000)).toFixed(0)} emits/sec`);
	console.log(`    Rust via FFI: ${(EMITS / (rust.elapsedMs / 1000)).toFixed(0)} emits/sec`);
	console.log(
		`    Ratio:        Rust ${(ts.elapsedMs / rust.elapsedMs).toFixed(2)}× faster end-to-end`,
	);
})();
