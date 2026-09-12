/** Fixed bare-Node tool probe: two forced GC calls, no Graph/consumer import. */
import assert from "node:assert/strict";
import { createObservation } from "./causal-workload-observation.mjs";

assert.equal(process.version, "v24.18.0");
assert.equal(typeof globalThis.gc, "function");
const o = createObservation("CPU_GC", "U");
o.checkpoint(0, "candidate", "warmup");
let allocation = Array.from({ length: 100000 }, (_, i) => ({ i }));
assert.equal(allocation.length, 100000);
allocation = null;
globalThis.gc();
globalThis.gc();
o.checkpoint(0, "candidate", "measured");
const { data, fault } = await o.finish();
if (fault) throw fault;
assert.ok(data.gc.length > 0, "GC tool channel unverified; no consumer capture allowed");
console.log(
	JSON.stringify({
		passed: true,
		toolOnly: true,
		consumerInstances: 0,
		forcedGcCalls: 2,
		allocatedObjects: 100000,
		finiteDrainTurns: 2,
		data,
	}),
);
