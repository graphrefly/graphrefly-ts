/**
 * Cross-Worker bench — the unique structural Rust-side win.
 *
 * Phase 13.7 follow-up: confirms (or refutes) the rust-port session doc's
 * claim that "Rust core via napi-rs enables cross-Worker shared state that
 * TS literally cannot do."
 *
 * Run as a standalone Node script (vitest bench's `bench()` doesn't compose
 * cleanly with Worker spawning + async timing):
 *
 *   pnpm tsx src/__bench__/cross-worker.bench.ts
 *
 * Or:
 *   node --import tsx src/__bench__/cross-worker.bench.ts
 *
 * Three scenarios:
 *
 * 1. **Rust shared core, N Workers** — N Worker threads, all calling into
 *    one process-global Rust `BenchCore` via napi-rs. Mutation visible to
 *    all Workers. Concurrency: serialized through `parking_lot::Mutex`
 *    inside Core; multiple Workers contend for the lock.
 *
 * 2. **TS parallel isolated, N Workers** — N Worker threads, each with its
 *    own HandleRuntime. No shared state. Each Worker emits independently.
 *    This is the closest TS-only approximation of "parallel emission";
 *    state cannot be shared across Workers.
 *
 * 3. **TS single-thread sequential** — main thread emitting N×M times in a
 *    single loop. The "what if we just don't try to parallelize" baseline.
 *
 * The scaling story: scenario 1 shows whether shared-state contention
 * is acceptable for the win of "every Worker can read every Worker's
 * latest emission." Scenarios 2 and 3 are baselines.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
	type MessagePort,
	Worker,
	isMainThread,
	parentPort,
	workerData,
} from "node:worker_threads";

const require = createRequire(import.meta.url);

const BINDING_PATH =
	"/Users/davidchenallio/src/graphrefly-rs/target/release/graphrefly_bindings_js.node";

// biome-ignore lint/suspicious/noExplicitAny: native binding has no .d.ts in v0
type Binding = any;

interface RustWorkerData {
	mode: "rust";
	stateId: number;
	emits: number;
	startSignal: number;
}

interface TsWorkerData {
	mode: "ts";
	emits: number;
	startSignal: number;
}

type WorkerInit = RustWorkerData | TsWorkerData;

const NUM_WORKERS = 4;
const EMITS_PER_WORKER = 250_000;

if (isMainThread) {
	main();
} else {
	worker();
}

async function main() {
	console.log("=".repeat(70));
	console.log("Cross-Worker bench");
	console.log(
		`  Workers: ${NUM_WORKERS}, emits per Worker: ${EMITS_PER_WORKER.toLocaleString()}`,
	);
	console.log(`  Total emits: ${(NUM_WORKERS * EMITS_PER_WORKER).toLocaleString()}`);
	console.log("=".repeat(70));

	// Scenario 3: TS single-thread sequential (baseline).
	{
		const { HandleRuntime } = await import(
			"../__experiments__/handle-core/bindings.js"
		);
		const rt = new HandleRuntime();
		const s = rt.state(0);
		rt.subscribe(s, () => undefined);
		const total = NUM_WORKERS * EMITS_PER_WORKER;
		const t0 = process.hrtime.bigint();
		for (let i = 0; i < total; i++) {
			s.set(i);
		}
		const elapsed = Number(process.hrtime.bigint() - t0) / 1e6; // ms
		const throughput = total / (elapsed / 1000);
		console.log(
			`\n[3] TS single-thread sequential ${total.toLocaleString()} emits:`,
		);
		console.log(`    elapsed: ${elapsed.toFixed(1)}ms`);
		console.log(
			`    throughput: ${Math.round(throughput).toLocaleString()} emits/sec`,
		);
	}

	// Scenario 1: Rust shared core, N Workers.
	{
		// biome-ignore lint/suspicious/noExplicitAny: native binding
		const binding: Binding = require(BINDING_PATH);
		const stateId = binding.globalRegisterStateInt(0);
		binding.globalSubscribeNoop(stateId);
		const t0 = process.hrtime.bigint();
		const workers: Worker[] = [];
		const promises: Promise<number>[] = [];
		for (let i = 0; i < NUM_WORKERS; i++) {
			const workerFile = fileURLToPath(import.meta.url);
			const w = new Worker(workerFile, {
				workerData: {
					mode: "rust",
					stateId,
					emits: EMITS_PER_WORKER,
					startSignal: i,
				} satisfies RustWorkerData,
			});
			workers.push(w);
			promises.push(
				new Promise<number>((resolve, reject) => {
					w.once("message", (ms: number) => resolve(ms));
					w.once("error", reject);
				}),
			);
		}
		const workerElapsedMs = await Promise.all(promises);
		const wallElapsed = Number(process.hrtime.bigint() - t0) / 1e6;
		const total = NUM_WORKERS * EMITS_PER_WORKER;
		const throughput = total / (wallElapsed / 1000);
		console.log(`\n[1] Rust shared core, ${NUM_WORKERS} Workers:`);
		console.log(
			`    per-Worker elapsed (ms): ${workerElapsedMs.map((v) => v.toFixed(1)).join(", ")}`,
		);
		console.log(`    wall elapsed: ${wallElapsed.toFixed(1)}ms`);
		console.log(
			`    throughput: ${Math.round(throughput).toLocaleString()} emits/sec`,
		);
		const finalCache = binding.globalCacheInt(stateId);
		console.log(`    final cache value (last winner of contention): ${finalCache}`);
		await Promise.all(workers.map((w) => w.terminate()));
	}

	// Scenario 2: TS parallel isolated, N Workers (each with its own HandleRuntime).
	{
		const t0 = process.hrtime.bigint();
		const workers: Worker[] = [];
		const promises: Promise<number>[] = [];
		for (let i = 0; i < NUM_WORKERS; i++) {
			const workerFile = fileURLToPath(import.meta.url);
			const w = new Worker(workerFile, {
				workerData: {
					mode: "ts",
					emits: EMITS_PER_WORKER,
					startSignal: i,
				} satisfies TsWorkerData,
				// tsx loader so the Worker can resolve .ts imports.
				execArgv: ["--import", "tsx"],
			});
			workers.push(w);
			promises.push(
				new Promise<number>((resolve, reject) => {
					w.once("message", (ms: number) => resolve(ms));
					w.once("error", reject);
				}),
			);
		}
		const workerElapsedMs = await Promise.all(promises);
		const wallElapsed = Number(process.hrtime.bigint() - t0) / 1e6;
		const total = NUM_WORKERS * EMITS_PER_WORKER;
		const throughput = total / (wallElapsed / 1000);
		console.log(`\n[2] TS parallel isolated, ${NUM_WORKERS} Workers (NOT shared):`);
		console.log(
			`    per-Worker elapsed (ms): ${workerElapsedMs.map((v) => v.toFixed(1)).join(", ")}`,
		);
		console.log(`    wall elapsed: ${wallElapsed.toFixed(1)}ms`);
		console.log(
			`    throughput: ${Math.round(throughput).toLocaleString()} emits/sec`,
		);
		console.log(
			"    (note: each Worker has its OWN state — no cross-Worker visibility)",
		);
		await Promise.all(workers.map((w) => w.terminate()));
	}

	console.log("\n=".repeat(35));
	console.log("Interpretation:");
	console.log(
		"  - Scenario 1 (Rust shared) is the unique Rust-only capability:",
	);
	console.log(
		"    every Worker reads every Worker's latest emission. TS Workers",
	);
	console.log("    cannot share state without SharedArrayBuffer + Atomics.");
	console.log(
		"  - Scenario 2 throughput vs Scenario 3 shows TS parallel scaling",
	);
	console.log("    (limited by V8 isolate startup + Worker overhead).");
}

function worker() {
	const init = workerData as WorkerInit;
	if (init.mode === "rust") {
		// biome-ignore lint/suspicious/noExplicitAny: native binding
		const binding: Binding = require(BINDING_PATH);
		// Use the tight-loop FFI variant — measures Rust-core throughput
		// under contention, not per-emit napi-rs overhead.
		const t0 = process.hrtime.bigint();
		binding.globalRustEmitLoop(init.stateId, init.emits);
		const elapsed = Number(process.hrtime.bigint() - t0) / 1e6;
		(parentPort as MessagePort).postMessage(elapsed);
	} else {
		// Worker imports the COMPILED handle-core prototype (compile via:
		// tsc --module nodenext --moduleResolution nodenext --target esnext
		//   --outDir /tmp/handle-core-compiled <core.ts> <bindings.ts>
		// before running this bench).
		import("/tmp/handle-core-compiled/bindings.js")
			.then(({ HandleRuntime }) => {
				const rt = new HandleRuntime();
				const s = rt.state(0);
				rt.subscribe(s, () => undefined);
				const t0 = process.hrtime.bigint();
				for (let i = 0; i < init.emits; i++) {
					s.set(i);
				}
				const elapsed = Number(process.hrtime.bigint() - t0) / 1e6;
				(parentPort as MessagePort).postMessage(elapsed);
			})
			.catch((err) => {
				console.error("[worker] import failed:", err);
				(parentPort as MessagePort).postMessage(-1);
			});
	}
}
