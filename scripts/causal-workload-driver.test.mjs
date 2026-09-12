/** Loaded diagnostic qualification: fake clocks and factories, no consumer measurements. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import timers from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createObservation } from "./causal-workload-observation.mjs";
import { derive } from "./derive-causal-workload-driver.mjs";

const original = fs.readFileSync(process.argv[2], "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "causal-workload-stubs-"));
fs.copyFileSync(
	new URL("./causal-workload-observation.mjs", import.meta.url),
	path.join(tmp, "observation.mjs"),
);
const source = derive(original, "BASE").output;
const recipe = JSON.parse(source.match(/const originalRecipe = (.*);/)[1]);
const modules = {};
for (const condition of ["BASE", "CPU", "CPU_GC"]) {
	const p = path.join(tmp, condition + ".mjs");
	fs.writeFileSync(p, derive(original, condition).output);
	modules[condition] = await import(pathToFileURL(p));
}
const real = {
	read: fs.readFileSync,
	write: fs.writeFileSync,
	append: fs.appendFileSync,
	tick: timers.setImmediate,
	memory: process.memoryUsage,
	cpu: process.cpuUsage,
	now: performance.now,
};
let checks = 0,
	totalInstances = 0,
	totalSamples = 0;
try {
	for (let round = 0; round < 4; round++)
		for (const condition of ["BASE", "CPU", "CPU_GC"])
			for (const orientation of ["U", "V"]) {
				const events = [],
					samples = [],
					outputs = {};
				let serial = 0,
					clock = 0;
				const config = {
					row: { id: "cold-P2-summary", group: "cold", profile: "P2", mode: "summary" },
					kind: "control",
					control: true,
					condition,
					orientation,
					output: "/stub",
					scenarioPath: "scenario",
				};
				const arms = [0, 1].map((id) => ({
					RECIPE: recipe,
					preflight() {
						events.push(["preflight", id]);
						return { passed: true };
					},
					measurementArm(arm, mode) {
						assert.equal(arm, "reference");
						assert.equal(mode, "summary");
						const n = ++serial;
						events.push(["factory", id, n]);
						return {
							cleanup() {
								events.push(["cleanup", n]);
							},
						};
					},
				}));
				fs.readFileSync = (p) => JSON.stringify(p === "config" ? config : {});
				fs.writeFileSync = (p, s) => {
					outputs[p] = JSON.parse(s);
				};
				fs.appendFileSync = (_p, s) => {
					events.push(["record"]);
					samples.push(JSON.parse(s));
				};
				timers.setImmediate = async () => {
					events.push(["tick"]);
				};
				process.memoryUsage = () => {
					events.push(["memory"]);
					return {};
				};
				process.cpuUsage = () => {
					events.push(["cpu"]);
					return { user: clock * 2000, system: clock * 1000 };
				};
				Object.defineProperty(performance, "now", {
					configurable: true,
					value: () => {
						events.push(["clock"]);
						return ++clock;
					},
				});
				syncBuiltinESMExports();
				await modules[condition].runRow("config", arms);
				assert.equal(serial, 2400);
				assert.equal(samples.length, 2400);
				assert.deepEqual(outputs["/stub/completion.json"], { completed: true, samples: 2400 });
				assert.equal(
					outputs["/stub/diagnostic.json"].checkpoints.length,
					condition === "BASE" ? 0 : 18,
				);
				assert.equal(events.filter((x) => x[0] === "cpu").length, condition === "BASE" ? 0 : 18);
				assert.deepEqual(events.slice(0, 2), [
					["preflight", 0],
					["preflight", 1],
				]);
				let n = 0;
				for (const order of recipe.orders)
					for (const arm of orientation === "U" ? order : [...order].reverse())
						for (let i = 0; i < 400; i++) {
							const id = ++n,
								pos = events.findIndex((x) => x[0] === "factory" && x[2] === id);
							assert.deepEqual(events.slice(pos - 3, pos + 5), [
								["tick"],
								["memory"],
								["clock"],
								["factory", arm === "candidate" ? 1 : 0, id],
								["clock"],
								["memory"],
								["record"],
								["cleanup", id],
							]);
							assert.equal(samples[id - 1].ms, 1);
						}
				const samplePath = path.join(tmp, "samples.jsonl"),
					diagPath = path.join(tmp, "diagnostic.json");
				real.write(samplePath, samples.map((x) => JSON.stringify(x)).join("\n") + "\n");
				real.write(diagPath, JSON.stringify(outputs["/stub/diagnostic.json"]));
				const independently = JSON.parse(
					execFileSync(
						"python3",
						["scripts/verify-causal-workload-diagnostic.py", samplePath, diagPath],
						{ encoding: "utf8", timeout: 5000 },
					),
				);
				assert.ok(independently);
				totalInstances += serial;
				totalSamples += samples.length;
				checks++;
			}
	// Error paths use loaded CPU driver: original record + cleanup failure must both survive.
	for (const variant of ["dual", "factory", "condition", "kind", "namespace"]) {
		let made = 0;
		const outputs = {};
		const config = {
			row: { id: "cold-P2-summary", group: "cold", profile: "P2", mode: "summary" },
			kind: variant === "kind" ? "main" : "control",
			control: true,
			condition: variant === "condition" ? "BASE" : "CPU",
			orientation: "U",
			output: "/stub",
			scenarioPath: "scenario",
		};
		fs.readFileSync = (p) => JSON.stringify(p === "config" ? config : {});
		fs.writeFileSync = (p, s) => (outputs[p] = JSON.parse(s));
		fs.appendFileSync = () => {
			throw Error("record");
		};
		const ms = [0, 1].map(() => ({
			RECIPE: recipe,
			preflight: () => ({ ok: true }),
			measurementArm() {
				made++;
				if (variant === "factory") throw Error("factory");
				return {
					cleanup() {
						throw Error("cleanup");
					},
				};
			},
		}));
		syncBuiltinESMExports();
		let error;
		try {
			await modules.CPU.runRow("config", variant === "namespace" ? [ms[0], ms[0]] : ms);
		} catch (e) {
			error = e;
		}
		assert.ok(error);
		assert.equal(outputs["/stub/completion.json"], undefined);
		if (variant === "dual")
			assert.deepEqual(
				error.errors.map((x) => x.message),
				["record", "cleanup"],
			);
		assert.equal(made, ["dual", "factory"].includes(variant) ? 1 : 0);
		checks++;
	}
} finally {
	fs.readFileSync = real.read;
	fs.writeFileSync = real.write;
	fs.appendFileSync = real.append;
	timers.setImmediate = real.tick;
	process.memoryUsage = real.memory;
	process.cpuUsage = real.cpu;
	Object.defineProperty(performance, "now", { configurable: true, value: real.now });
	syncBuiltinESMExports();
	fs.rmSync(tmp, { recursive: true, force: true });
}
// Deterministic observer channel: overlap, late delivery, buffer overflow and invalid events.
for (const variant of ["valid", "overflow", "future", "nonfinite", "kind"]) {
	let callback,
		disconnects = 0,
		now = 100;
	class Observer {
		static supportedEntryTypes = ["gc"];
		constructor(fn) {
			callback = fn;
		}
		observe() {}
		takeRecords() {
			return [];
		}
		disconnect() {
			disconnects++;
		}
	}
	const io = {
		now: () => now++,
		cpu: () => ({ user: 1000, system: 2000 }),
		Observer,
		tick: async () => {},
	};
	const obs = createObservation("CPU_GC", "U", io);
	const event = { startTime: 1, duration: 2, detail: { kind: 1, flags: 0 } };
	if (variant === "future") event.startTime = 100000;
	if (variant === "nonfinite") event.duration = NaN;
	if (variant === "kind") event.detail.kind = -1;
	callback({ getEntries: () => (variant === "overflow" ? Array(100001).fill(event) : [event]) });
	if (variant === "valid") obs.check();
	else assert.throws(() => obs.check());
	const result = await obs.finish();
	assert.ok(disconnects > 0);
	assert.equal(Boolean(result.fault), variant !== "valid");
	checks++;
}
for (const stage of ["tick", "take", "disconnect"]) {
	class Observer {
		static supportedEntryTypes = ["gc"];
		observe() {}
		takeRecords() {
			if (stage === "take") throw Error("take");
			return [];
		}
		disconnect() {
			if (stage === "disconnect") throw Error("disconnect");
		}
	}
	const obs = createObservation("CPU_GC", "U", {
		now: () => 100,
		cpu: () => ({ user: 0, system: 0 }),
		Observer,
		tick: async () => {
			if (stage === "tick") throw Error("tick");
		},
	});
	const result = await obs.finish();
	assert.ok(result.fault);
	checks++;
}
console.log(
	JSON.stringify({
		passed: true,
		checks,
		plannedCoordinates: 24,
		stubInstances: totalInstances,
		stubSamples: totalSamples,
		consumerExecutions: 0,
		fakeClocks: true,
	}),
);
