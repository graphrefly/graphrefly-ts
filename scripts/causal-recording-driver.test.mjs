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
import { derive } from "./derive-causal-recording-driver.mjs";

const original = fs.readFileSync(process.argv[2], "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "causal-workload-stubs-"));
fs.copyFileSync(
	new URL("./causal-workload-observation.mjs", import.meta.url),
	path.join(tmp, "observation.mjs"),
);
const source = derive(original, "EAGER").output;
const recipe = JSON.parse(source.match(/const originalRecipe = (.*);/)[1]);
const modules = {};
for (const condition of ["EAGER", "DEFERRED"]) {
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
const equalOutputs = new Map();
let checks = 0,
	totalInstances = 0,
	totalSamples = 0;
try {
	for (let round = 0; round < 4; round++)
		for (const condition of ["EAGER", "DEFERRED"])
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
				const key = round + orientation;
				if (condition === "EAGER") equalOutputs.set(key, JSON.stringify(samples));
				else
					assert.equal(
						JSON.stringify(samples),
						equalOutputs.get(key),
						"identical JSONL values/order under identical fake inputs",
					);
				assert.equal(serial, 2400);
				assert.equal(samples.length, 2400);
				assert.deepEqual(outputs["/stub/completion.json"], { completed: true, samples: 2400 });
				assert.equal(outputs["/stub/diagnostic.json"].checkpoints.length, 18);
				assert.equal(events.filter((x) => x[0] === "cpu").length, condition === "EAGER" ? 20 : 22);
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
							assert.deepEqual(events.slice(pos - 3, pos + (condition === "EAGER" ? 5 : 4)), [
								["tick"],
								["memory"],
								["clock"],
								["factory", arm === "candidate" ? 1 : 0, id],
								["clock"],
								["memory"],
								...(condition === "EAGER" ? [["record"]] : []),
								["cleanup", id],
							]);
							assert.equal(samples[id - 1].ms, 1);
						}
				const samplePath = path.join(tmp, "samples.jsonl"),
					diagPath = path.join(tmp, "diagnostic.json");
				real.write(samplePath, samples.map((x) => JSON.stringify(x)).join("\n") + "\n");
				real.write(diagPath, JSON.stringify(outputs["/stub/diagnostic.json"]));
				real.write(
					path.join(tmp, "recording.json"),
					JSON.stringify(outputs["/stub/recording.json"]),
				);
				if (condition === "DEFERRED")
					assert.ok(
						events.findIndex((x) => x[0] === "record") >
							events.findLastIndex((x) => x[0] === "cleanup"),
					);
				const independently = JSON.parse(
					execFileSync("python3", ["scripts/verify-causal-recording-child.py", tmp], {
						encoding: "utf8",
						timeout: 5000,
					}),
				);
				assert.ok(independently);
				totalInstances += serial;
				totalSamples += samples.length;
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
console.log(
	JSON.stringify({
		passed: true,
		checks,
		plannedCoordinates: 16,
		stubInstances: totalInstances,
		stubSamples: totalSamples,
		consumerExecutions: 0,
		fakeClocks: true,
	}),
);
