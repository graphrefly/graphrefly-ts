/** Adapter-only lifecycle tests. No actual Session/GC/consumer. */
import assert from "node:assert/strict";
import { create, execute } from "./causal-aligned-observation.mjs";

let cases = 0;
for (const condition of ["CONTROL", "GC", "GC_CPU"])
	for (const fault of [
		null,
		"connect",
		"Profiler.enable",
		"Profiler.setSamplingInterval",
		"Profiler.start",
		"Profiler.stop",
		"disconnect",
		"base.finish",
		"load",
		"write",
	]) {
		let time = 0;
		const calls = [],
			files = {};
		const step = (name) => {
			calls.push(name);
			if (name === fault) throw new Error(name);
		};
		const io = {
			pid: 1,
			now: () => ++time,
			hr: () => BigInt(time),
			tick: async () => step("tick"),
			base: () => ({
				check() {},
				checkpoint() {},
				async finish() {
					step("base.finish");
					return { data: { checkpoints: [], gc: [] } };
				},
			}),
			session: () => ({
				connect() {
					step("connect");
				},
				post(name, _args, callback) {
					try {
						step(name);
						callback(null, name === "Profiler.stop" ? { profile: { nodes: [], samples: [] } } : {});
					} catch (e) {
						callback(e);
					}
				},
				disconnect() {
					step("disconnect");
				},
			}),
		};
		const relevant =
			fault === null || ["base.finish", "load", "write"].includes(fault) || condition === "GC_CPU";
		try {
			await execute(
				condition,
				"U",
				async () => {
					step("load");
					return 2400;
				},
				(name, value) => {
					if (fault === "write") throw new Error("write");
					files[name] = value;
				},
				(c, o) => create(c, o, io),
			);
			assert.ok(!relevant || fault === null);
			assert.ok(files["completion.json"]);
		} catch (e) {
			assert.ok(relevant && fault !== null);
			assert.ok(e instanceof AggregateError);
			assert.ok(!files["completion.json"]);
		}
		assert.ok(calls.includes("base.finish"));
		if (condition === "GC_CPU") assert.ok(calls.includes("disconnect"));
		if (condition === "CONTROL") assert.equal(calls.filter((x) => x === "tick").length, 2);
		if (condition === "GC_CPU" && fault === "Profiler.start")
			assert.ok(files["alignment.json"], "retain setup prefix");
		cases++;
	}
const io = {
	pid: 1,
	now: () => 1,
	hr: () => 1n,
	tick: async () => {},
	base: () => ({ check() {}, checkpoint() {}, finish: async () => ({ data: {} }) }),
};
const obs = await create("CONTROL", "U", io);
await obs.finish();
await assert.rejects(() => obs.finish());
console.log(JSON.stringify({ cases: cases + 1, consumerExecutions: 0, realObservers: 0 }));
