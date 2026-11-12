/** Loaded complete workload with fake factories/clocks only. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import timers from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { check } from "./check-causal-aligned-source.mjs";
import { derive } from "./derive-causal-aligned-driver.mjs";

const original = fs.readFileSync(process.argv[2], "utf8"),
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aligned-stubs-"));
const drivers = {};
let mutations = 0;
for (const c of ["CONTROL", "GC", "GC_CPU"]) {
	const s = derive(original, c);
	check(original, s, c);
	for (const [a, b] of [
		["const total =", "const total = 1 +"],
		["await setImmediate();", "/* missing yield */"],
		["const arms = RECIPE.orders[batch2];", "const arms = [...RECIPE.orders[batch2]].reverse();"],
		["appendFileSync(samplesPath,", "writeFileSync(samplesPath,"],
	]) {
		assert.ok(s.includes(a), a);
		assert.throws(() => check(original, s.replace(a, b), c));
		mutations++;
	}
	const file = path.join(tmp, c + ".mjs");
	fs.writeFileSync(file, s);
	drivers[c] = await import(pathToFileURL(file));
}
const recipe = JSON.parse(derive(original, "CONTROL").match(/const originalRecipe = (.*);/)[1]);
const real = {
	read: fs.readFileSync,
	write: fs.writeFileSync,
	append: fs.appendFileSync,
	now: performance.now,
	cpu: process.cpuUsage,
	memory: process.memoryUsage,
	tick: timers.setImmediate,
};
let runs = 0,
	total = 0;
try {
	for (let round = 0; round < 2; round++)
		for (const c of ["CONTROL", "GC", "GC_CPU"])
			for (const orientation of ["U", "V"]) {
				const events = [],
					samples = [],
					outputs = {};
				let clock = 0,
					n = 0;
				const config = {
					row: { id: "cold-P2-summary", group: "cold", profile: "P2", mode: "summary" },
					kind: "control",
					control: true,
					condition: c,
					orientation,
					output: "/stub",
					scenarioPath: "scenario",
				};
				fs.readFileSync = (p) => JSON.stringify(p === "config" ? config : {});
				fs.writeFileSync = (p, s) => {
					outputs[p] = JSON.parse(s);
				};
				fs.appendFileSync = (_p, s) => {
					events.push("record");
					samples.push(JSON.parse(s));
				};
				timers.setImmediate = async () => {
					events.push("tick");
				};
				process.memoryUsage = () => {
					events.push("memory");
					return {};
				};
				Object.defineProperty(performance, "now", {
					configurable: true,
					value: () => {
						events.push("clock");
						return ++clock;
					},
				});
				syncBuiltinESMExports();
				const obs = {
					check: () => {},
					checkpoint: () => {
						events.push("checkpoint");
					},
				};
				const mods = [0, 1].map((_slot) => ({
					RECIPE: recipe,
					preflight() {
						events.push("preflight");
						return true;
					},
					measurementArm(arm, mode) {
						assert.equal(arm, "reference");
						assert.equal(mode, "summary");
						n++;
						events.push("factory");
						return {
							cleanup() {
								events.push("cleanup");
							},
						};
					},
				}));
				assert.equal(await drivers[c].runRow("config", mods, obs), 2400);
				assert.equal(n, 2400);
				assert.equal(samples.length, 2400);
				assert.equal(events.filter((x) => x === "checkpoint").length, 18);
				assert.equal(events.filter((x) => x === "cleanup").length, 2400);
				assert.deepEqual(events.slice(0, 2), ["preflight", "preflight"]);
				for (let i = 0; i < events.length; i++)
					if (events[i] === "factory")
						assert.deepEqual(events.slice(i - 3, i + 5), [
							"tick",
							"memory",
							"clock",
							"factory",
							"clock",
							"memory",
							"record",
							"cleanup",
						]);
				assert.ok(
					!outputs["/stub/completion.json"],
					"entry owns completion after observer cleanup",
				);
				runs++;
				total += n;
			}
} finally {
	fs.readFileSync = real.read;
	fs.writeFileSync = real.write;
	fs.appendFileSync = real.append;
	process.memoryUsage = real.memory;
	timers.setImmediate = real.tick;
	Object.defineProperty(performance, "now", { configurable: true, value: real.now });
	syncBuiltinESMExports();
	fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(
	JSON.stringify({ runs, stubInstances: total, sourceMutations: mutations, consumerExecutions: 0 }),
);
