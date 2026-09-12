/** Loaded failure qualification. Fake factories/clocks; zero consumer executions. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import timers from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { check } from "./check-causal-recording-source.mjs";
import { derive } from "./derive-causal-recording-driver.mjs";

const source = fs.readFileSync(process.argv[2], "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "recording-faults-"));
fs.copyFileSync(
	new URL("./causal-workload-observation.mjs", import.meta.url),
	path.join(tmp, "observation.mjs"),
);
const modules = {};
let mutations = 0;
for (const c of ["EAGER", "DEFERRED"]) {
	const d = derive(source, c).output;
	check(source, d, c);
	for (const [a, b] of [
		["samples.push(v);", "samples.unshift(v);"],
		["const end = performance.now();", "const end = start;"],
		["cleanupAll([run], sampleFailure);", "void run;"],
		['boundary("end");', 'boundary("begin");'],
		["appendFileSync(samplesPath,", "writeFileSync(samplesPath,"],
		["JSON.stringify(v)", "JSON.stringify({})"],
		["let flushFailure;", "let flushFailure = null;"],
		[
			"for (const v of samples) appendFileSync",
			"for (const v of [...samples,...samples]) appendFileSync",
		],
	]) {
		if (!d.includes(a)) continue;
		assert.throws(() => check(source, d.replace(a, b), c));
		mutations++;
	}
	fs.writeFileSync(path.join(tmp, c + ".mjs"), d);
	modules[c] = await import(pathToFileURL(path.join(tmp, c + ".mjs")));
}
const recipe = JSON.parse(derive(source, "EAGER").output.match(/const originalRecipe = (.*);/)[1]);
const real = {
	read: fs.readFileSync,
	write: fs.writeFileSync,
	append: fs.appendFileSync,
	tick: timers.setImmediate,
	cpu: process.cpuUsage,
	memory: process.memoryUsage,
	now: performance.now,
	stringify: JSON.stringify,
	push: Array.prototype.push,
};
let cases = 0;
const flatten = (e) => (e instanceof AggregateError ? e.errors.flatMap(flatten) : [e?.message]);
try {
	for (const c of ["EAGER", "DEFERRED"])
		for (const failure of [
			"serialize",
			"write",
			"cleanup",
			"dual",
			"business",
			"business-dual",
			"none",
		])
			for (const at of [1, 1200, 2400]) {
				let made = 0,
					cleaned = 0,
					writes = 0,
					serializations = 0,
					clock = 0;
				const outputs = {},
					lines = [],
					objects = [],
					snapshots = [],
					retained = new Map();
				Array.prototype.push = function (...vs) {
					for (const v of vs)
						if (v?.phase && typeof v.index === "number") retained.set(v, real.stringify(v));
					return real.push.apply(this, vs);
				};
				const config = {
					row: { id: "cold-P2-summary", group: "cold", profile: "P2", mode: "summary" },
					kind: "control",
					control: true,
					condition: c,
					orientation: "U",
					output: "/stub",
					scenarioPath: "scenario",
				};
				fs.readFileSync = (p) => real.stringify(p === "config" ? config : {});
				fs.writeFileSync = (p, s) => (outputs[p] = JSON.parse(s));
				fs.appendFileSync = (_p, s) => {
					writes++;
					if (
						((failure === "write" || failure === "dual") && writes === at) ||
						(failure === "business-dual" && writes === 1)
					)
						throw Error("write");
					lines.push(s);
				};
				JSON.stringify = (v, ...args) => {
					if (v?.phase && typeof v.index === "number") {
						serializations++;
						objects.push(v);
						snapshots.push(real.stringify(v));
						if (failure === "serialize" && serializations === at) throw Error("serialize");
					}
					return real.stringify(v, ...args);
				};
				timers.setImmediate = async () => {};
				process.cpuUsage = () => ({ user: clock * 2000, system: clock * 1000 });
				process.memoryUsage = () => ({ rss: 123, heapUsed: 45 });
				Object.defineProperty(performance, "now", { configurable: true, value: () => ++clock });
				const arms = [0, 1].map(() => ({
					RECIPE: recipe,
					preflight: () => ({ ok: true }),
					measurementArm() {
						const n = ++made;
						if ((failure === "business" || failure === "business-dual") && n === at)
							throw Error("business");
						const local = { state: [n] };
						return {
							cleanup() {
								cleaned++;
								local.state.length = 0;
								if ((failure === "cleanup" || failure === "dual") && n === at)
									throw Error("cleanup");
							},
						};
					},
				}));
				syncBuiltinESMExports();
				let error;
				try {
					await modules[c].runRow("config", arms);
				} catch (e) {
					error = e;
				}
				assert.equal(
					cleaned,
					made -
						(["business", "business-dual"].includes(failure) &&
						!(failure === "business-dual" && c === "EAGER" && at > 1)
							? 1
							: 0),
				);
				for (const [object, snapshot] of retained)
					assert.equal(
						real.stringify(object),
						snapshot,
						"original push content stable through cleanup and later iterations",
					);
				for (let i = 0; i < objects.length; i++)
					assert.equal(
						real.stringify(objects[i]),
						snapshots[i],
						"record object stable after cleanup and later iterations",
					);
				if (failure === "none") {
					assert.equal(error, undefined);
					assert.equal(writes, 2400);
					assert.equal(serializations, 2400);
					assert.equal(lines.length, 2400);
					assert.ok(outputs["/stub/completion.json"]);
				} else {
					assert.ok(error);
					assert.equal(outputs["/stub/completion.json"], undefined);
					if (failure === "business" || failure === "business-dual") {
						const businessReached = !(failure === "business-dual" && c === "EAGER" && at > 1);
						if (businessReached) assert.ok(flatten(error).includes("business"));
						const count = businessReached ? at - 1 : 1;
						assert.equal(writes, failure === "business-dual" && count > 0 ? 1 : count);
						assert.equal(lines.length, failure === "business-dual" ? 0 : count);
						if (failure === "business-dual" && count > 0)
							assert.ok(flatten(error).includes("write"));
					} else {
						assert.ok(flatten(error).includes(failure === "dual" ? "cleanup" : failure));
						if (failure === "dual") assert.ok(flatten(error).includes("write"));
						assert.equal(lines.length, failure === "cleanup" ? at : at - 1);
						assert.equal(writes, failure === "serialize" ? at - 1 : at);
						assert.equal(serializations, at);
						assert.equal(
							made,
							c === "DEFERRED" && !["cleanup", "dual"].includes(failure) ? 2400 : at,
						);
					}
				}
				cases++;
			}
} finally {
	fs.readFileSync = real.read;
	fs.writeFileSync = real.write;
	fs.appendFileSync = real.append;
	timers.setImmediate = real.tick;
	process.cpuUsage = real.cpu;
	process.memoryUsage = real.memory;
	JSON.stringify = real.stringify;
	Array.prototype.push = real.push;
	Object.defineProperty(performance, "now", { configurable: true, value: real.now });
	syncBuiltinESMExports();
	fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(
	JSON.stringify({
		passed: true,
		cases,
		sourceMutationsRejected: mutations,
		consumerExecutions: 0,
	}),
);
