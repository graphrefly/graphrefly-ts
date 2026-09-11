/** Offline qualification: only stub factories/fake clocks; no native observer captures. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import timers from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createObserver } from "./causal-cpu-observer.mjs";
import { correlateCpuTrace } from "./causal-cpu-trace.mjs";
import { correlateTrace, hash, relation } from "./causal-event-correlation.mjs";
import { derive } from "./derive-causal-cpu-driver.mjs";
import { phases, report } from "./report-causal-cpu.mjs";

const self = fileURLToPath(import.meta.url),
	material = process.argv[2];
assert.ok(material, "explicit frozen material directory");
const original = fs.readFileSync(path.join(material, "position.mjs"), "utf8");
const fixed = JSON.parse(original.match(/const originalRecipe = (.*);/)[1]);
const names = Array.from({ length: 6 }, (_, b) =>
	["warmup", "measured"].map((p) => `b${Math.floor(b / 2)}s${b % 2}-${p}`),
).flat();
if (process.argv[3] === "--stub") {
	const [root, mode, orientation, fault] = process.argv.slice(4);
	const job = path.join(root, "job");
	fs.mkdirSync(job);
	const config = {
		row: { id: "cold-P2-summary", group: "cold", profile: "P2", mode: "summary" },
		kind: "control",
		control: true,
		orientation,
		output: job,
		scenarioPath: path.join(root, "P2-inputs.json"),
		mode,
		profile: "consumer",
		run: "fake",
		sourceDigest: "a".repeat(64),
	};
	const events = [],
		samples = [],
		outputs = {},
		loads = [];
	let serial = 0,
		now = 0,
		cpu = 0;
	const modules = [0, 1].map((id) => ({
		RECIPE: structuredClone(fixed),
		preflight() {
			events.push(["preflight", id]);
			return { passed: true };
		},
		measurementArm(arm, m) {
			assert.equal(m, "summary");
			events.push(["factory", id, arm, ++serial]);
			if (fault === "factory") throw Error("factory");
			return {
				cleanup() {
					events.push(["cleanup", serial]);
					if (["cleanup", "dual"].includes(fault)) throw Error("cleanup");
				},
			};
		},
	}));
	globalThis.cpuStubModules = modules;
	for (const [i, name] of ["worker.mjs", "worker-copy.mjs"].entries())
		fs.writeFileSync(
			path.join(root, name),
			`const m=globalThis.cpuStubModules[${i}];export const RECIPE=m.RECIPE;export const preflight=(...a)=>m.preflight(...a);export const measurementArm=(...a)=>m.measurementArm(...a);`,
		);
	const generated = spawnSync(
		"python3",
		[
			"-B",
			"-c",
			"import importlib.util,sys;from pathlib import Path;s=importlib.util.spec_from_file_location('r',sys.argv[1]);r=importlib.util.module_from_spec(s);s.loader.exec_module(r);print(r.entry(Path(sys.argv[2]),Path(sys.argv[3]),sys.argv[4]),end='')",
			path.resolve("scripts/causal-cpu-diagnostic.py"),
			root,
			job,
			mode,
		],
		{ encoding: "utf8", timeout: 15000 },
	);
	assert.equal(generated.status, 0, generated.stderr);
	fs.writeFileSync(path.join(job, "entry.mjs"), generated.stdout);
	const realRead = fs.readFileSync;
	fs.readFileSync = (p, ...args) =>
		p === path.join(job, "config.json")
			? JSON.stringify(config)
			: p === config.scenarioPath
				? "{}"
				: realRead(p, ...args);
	fs.writeFileSync = (p, s) => {
		outputs[p] = JSON.parse(s);
	};
	fs.appendFileSync = (p, s) => {
		if (p.endsWith("entry-events.jsonl")) {
			loads.push(JSON.parse(s));
			return;
		}
		events.push(["record"]);
		if (fault === "dual") throw Error("record");
		samples.push(JSON.parse(s));
	};
	timers.setImmediate = async () => {
		events.push(["tick"]);
	};
	Object.defineProperty(performance, "now", {
		configurable: true,
		value: () => {
			events.push(["clock"]);
			return ++now;
		},
	});
	process.memoryUsage = () => {
		events.push(["memory"]);
		return {};
	};
	process.threadCpuUsage = () => {
		events.push(["thread"]);
		return { user: ++cpu * 1000, system: cpu * 100 };
	};
	process.resourceUsage = () => {
		events.push(["resources"]);
		return {
			userCPUTime: cpu * 3000,
			systemCPUTime: cpu * 100,
			voluntaryContextSwitches: cpu,
			involuntaryContextSwitches: 0,
			minorPageFault: 0,
			majorPageFault: 0,
		};
	};
	process.hrtime.bigint = () => {
		events.push(["hr"]);
		return BigInt(++now) * 1000000n;
	};
	console.time = (name) => {
		events.push(["begin", name]);
	};
	console.timeEnd = (name) => {
		events.push(["end", name]);
	};
	syncBuiltinESMExports();
	let failure;
	try {
		await import(pathToFileURL(path.join(job, "entry.mjs")));
	} catch (e) {
		failure = e;
	}
	assert.deepEqual(
		loads.map((x) => x.module),
		["n", "m0", "m1"],
	);
	if (["factory", "cleanup", "dual"].includes(fault)) {
		assert.ok(failure);
		assert.equal(serial, 1);
		if (fault === "dual") {
			assert.ok(failure instanceof AggregateError);
			assert.deepEqual(
				failure.errors.map((e) => e.message),
				["record", "cleanup"],
			);
		}
		if (mode !== "B") {
			const e = outputs[`${job}/evidence.json`];
			assert.equal(e.complete, false);
			assert.equal(e.windows.length, 0);
			assert.equal(e.active.name, names[0]);
			assert.ok(e.error);
		}
	} else {
		assert.equal(failure, undefined);
		assert.equal(serial, 2400);
		assert.equal(samples.length, 2400);
		assert.deepEqual(events.slice(0, 3), [["preflight", 0], ["preflight", 1], ["clock"]]);
		let cursor = 3,
			id = 0;
		const take = (e) => {
			assert.deepEqual(events.slice(cursor, cursor + e.length), e);
			cursor += e.length;
		};
		const snap = [["clock"], ["thread"], ["resources"], ["clock"]],
			anchor = [["clock"], ["hr"], ["clock"]];
		for (let block = 0; block < 6; block++)
			for (let i = 0; i < 400; i++) {
				const phase = block * 2 + (i >= 100 ? 1 : 0),
					name = `fake:${names[phase]}`;
				if (mode !== "B" && (i === 0 || i === 100)) {
					if (mode === "T") {
						if (phase === 0) take(anchor);
						take([["hr"], ["begin", name], ["hr"]]);
					}
					take(snap);
				}
				const batch = Math.floor(block / 2),
					slot = block % 2,
					arms = orientation === "U" ? fixed.orders[batch] : [...fixed.orders[batch]].reverse(),
					arm = arms[slot];
				take([
					["tick"],
					["memory"],
					["clock"],
					["factory", arm === "candidate" ? 1 : 0, "reference", ++id],
					["clock"],
					["memory"],
					["record"],
					["cleanup", id],
				]);
				if (mode !== "B" && (i === 99 || i === 399)) {
					take(snap);
					if (mode === "T") {
						take([["hr"], ["end", name], ["hr"]]);
						if ([5, 11].includes(phase)) take(anchor);
					}
				}
			}
		assert.equal(cursor, events.length);
		assert.ok(samples.every((s) => s.ms === 1));
		if (mode === "B") assert.equal(outputs[`${job}/evidence.json`], undefined);
		else {
			const e = outputs[`${job}/evidence.json`];
			assert.equal(e.complete, true);
			assert.equal(e.windows.length, 12);
			assert.equal(events.filter((x) => x[0] === "thread").length, 24);
			assert.equal(e.anchors.length, mode === "T" ? 3 : 0);
			assert.equal(events.filter((x) => x[0] === "begin").length, mode === "T" ? 12 : 0);
			assert.deepEqual(
				e.windows.map((w) => w.name),
				names,
			);
			const rows = phases(e, samples);
			assert.equal(rows.length, 12);
			for (const w of e.windows) {
				assert.equal(w.before.process.userCPUTime, w.before.thread.user * 3);
				assert.equal(w.after.process.userCPUTime, w.after.thread.user * 3);
			}
		}
	}
	console.log(
		JSON.stringify({
			mode,
			orientation,
			fault,
			passed: true,
			stubSamples: samples.length,
			nativeConsumerSamples: 0,
		}),
	);
} else {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpu-offline-"));
	let positive = 0,
		mutants = 0,
		negative = 0;
	try {
		const observed = derive(original);
		assert.throws(() => derive(original + " "));
		const run = (
			mode,
			orientation,
			fault = "none",
			driver = observed,
			observer = fs.readFileSync("scripts/causal-cpu-observer.mjs", "utf8"),
		) => {
			const root = fs.mkdtempSync(path.join(tmp, "stub-"));
			fs.mkdirSync(path.join(root, "source/scripts"), { recursive: true });
			fs.writeFileSync(path.join(root, "position.mjs"), original);
			fs.writeFileSync(path.join(root, "observed.mjs"), driver);
			fs.writeFileSync(path.join(root, "source/scripts/causal-cpu-observer.mjs"), observer);
			return spawnSync(
				process.execPath,
				[self, material, "--stub", root, mode, orientation, fault],
				{ encoding: "utf8", timeout: 15000 },
			);
		};
		for (const mode of ["B", "Q", "T"])
			for (const orientation of ["U", "V"]) {
				const r = run(mode, orientation);
				assert.equal(r.status, 0, r.stderr);
				positive++;
			}
		for (const mode of ["B", "Q", "T"])
			for (const fault of ["factory", "cleanup", "dual"]) {
				const r = run(mode, "U", fault);
				assert.equal(r.status, 0, r.stderr);
				positive++;
			}
		for (const [a, b] of [
			["if (index === 0 || index === 100) observer.start(observationName);", ""],
			[
				"if (run !== shared) cleanupAll([run], sampleFailure);",
				"if (index !== 399 && run !== shared) cleanupAll([run], sampleFailure);",
			],
			[
				"if (index === 99 || index === 399) observer.end(observationName);",
				"if (index === 99) observer.end(observationName);",
			],
			["await setImmediate();", ""],
		]) {
			assert.ok(observed.includes(a));
			assert.notEqual(run("T", "U", "none", observed.replace(a, b)).status, 0);
			mutants++;
		}
		const moved = observed
			.replace("if (index === 0 || index === 100) observer.start(observationName);", "")
			.replace(
				"const start = performance2.now();",
				"const start = performance2.now();if (index===0||index===100)observer.start(observationName);",
			);
		assert.notEqual(moved, observed);
		assert.notEqual(run("Q", "U", "none", moved).status, 0);
		mutants++;
		const obs = fs.readFileSync("scripts/causal-cpu-observer.mjs", "utf8");
		for (const [a, b] of [
			[
				"thread: () => process.threadCpuUsage()",
				"thread: () => { const t=process.threadCpuUsage();return {user:t.user/1000,system:t.system/1000};}",
			],
			[
				"thread: () => process.threadCpuUsage()",
				"thread: () => { const t=process.resourceUsage();return {user:t.userCPUTime,system:t.systemCPUTime};}",
			],
			[
				"resources: () => process.resourceUsage()",
				"resources: () => { const t=process.threadCpuUsage();return {userCPUTime:t.user,systemCPUTime:t.system};}",
			],
		]) {
			assert.ok(obs.includes(a));
			assert.notEqual(run("Q", "U", "none", observed, obs.replace(a, b)).status, 0);
			mutants++;
		}
		// Nonzero hand vectors: P > W, negative W-T are retained; no fake scheduler attribution.
		const e = {
			identity: {
				run: "synthetic",
				pid: 42,
				node: "v24.18.0",
				v8: "13.6.233.17-node.50",
				sourceDigest: "a".repeat(64),
			},
			profile: "fixture",
			mode: "Q",
			orientation: null,
			units: "performance-ms/hrtime-ns/trace-us",
			cpuUnits: "microseconds",
			thread: { isMainThread: true, threadId: 0 },
			complete: true,
			active: null,
			error: null,
			anchors: [],
			windows: [],
		};
		const snapshot = (p0, p1, user, system, pu, ps) => ({
			p0,
			p1,
			thread: { user, system },
			process: {
				userCPUTime: pu,
				systemCPUTime: ps,
				voluntaryContextSwitches: user,
				minorPageFault: 0,
				majorPageFault: 0,
				involuntaryContextSwitches: 0,
			},
		});
		for (let i = 0; i < 3; i++)
			e.windows.push({
				name: ["empty", "cpu", "yield"][i],
				before: snapshot(
					10 + i * 200,
					11 + i * 200,
					1000 + i * 200000,
					2000,
					3000 + i * 400000,
					4000,
				),
				after: snapshot(
					110 + i * 200,
					111 + i * 200,
					111000 + i * 200000,
					2000,
					203000 + i * 400000,
					4000,
				),
				start: 11 + i * 200,
				end: 110 + i * 200,
			});
		const p = phases(e);
		assert.equal(p[0].T, 110);
		assert.equal(p[0].P, 200);
		assert.equal(p[0].Wpoint, 100);
		assert.equal(p[0].unaccountedElapsed, -10);
		for (const mutate of [
			(x) => (x.cpuUnits = "milliseconds"),
			(x) => (x.thread.threadId = 1),
			(x) => delete x.windows[2].after,
			(x) => (x.windows[1].before.thread.user = 0),
			(x) => (x.windows[0].name = "wrong"),
			(x) => (x.windows[0].after.thread.user = 1.5),
		]) {
			const c = structuredClone(e);
			mutate(c);
			assert.throws(() => phases(c));
			negative++;
		}
		const missing = path.join(tmp, "missing");
		fs.mkdirSync(missing);
		fs.writeFileSync(path.join(missing, "evidence.json"), JSON.stringify({ ...e, mode: "T" }));
		const salvaged = report(missing);
		assert.equal(salvaged.trace.status, "unknown");
		assert.deepEqual(salvaged.cpu, p);
		// Fixed synthetic profiles with real-format fragments: empty GC/deopt is valid.
		const retained = JSON.parse(
			fs.readFileSync("archive/evals/causal-event-clock-repair-v1/capture/trace-1.json", "utf8"),
		).traceEvents;
		const fragment = (name, ph) => {
			const x = retained.find(
				(e) =>
					(name === "console" ? e.cat === "node,node.console" : e.name === name) && e.ph === ph,
			);
			assert.ok(x);
			return structuredClone(x);
		};
		function traceCase(profile = "consumer", withEvents = false) {
			const wnames = profile === "fixture" ? ["empty", "cpu", "yield"] : names;
			const evidence = {
				identity: e.identity,
				profile,
				units: e.units,
				anchors: [],
				windows: wnames.map((name, i) => ({
					name,
					start: 10 + i * 20,
					end: 20 + i * 20,
					begin: [String((9 + i * 20 + 100) * 1e6), String(Math.round((9.1 + i * 20 + 100) * 1e6))],
					finish: [
						String((21 + i * 20 + 100) * 1e6),
						String(Math.round((21.1 + i * 20 + 100) * 1e6)),
					],
				})),
			};
			const middle = profile === "fixture" ? 2 : 6;
			evidence.anchors = [1, 5 + middle * 20, 25 + (wnames.length - 1) * 20].map((p) => ({
				p0: p,
				p1: p + 0.1,
				h: String(Math.round((p + 0.05 + 100) * 1e6)),
			}));
			const trace = {
				traceEvents: [
					{ ph: "M", pid: 42, tid: 7, name: "thread_name", args: { name: "JavaScriptMainThread" } },
					...evidence.windows.flatMap((w) => [
						{
							...fragment("console", "b"),
							pid: 42,
							tid: 7,
							ph: "b",
							name: `time::synthetic:${w.name}`,
							cat: "node,node.console",
							id: "0x0",
							ts: Number(w.begin[0]) / 1000 + 50,
						},
						{
							...fragment("console", "e"),
							pid: 42,
							tid: 7,
							ph: "e",
							name: `time::synthetic:${w.name}`,
							cat: "node,node.console",
							id: "0x0",
							ts: Number(w.finish[0]) / 1000 + 50,
						},
					]),
				],
			};
			if (withEvents) {
				evidence.anchors[0] = { p0: 1.001, p1: 1.001, h: "101001000" };
				trace.traceEvents.push(
					{ ...fragment("MajorGC", "B"), pid: 42, tid: 7, ts: 114000 },
					{ ...fragment("MajorGC", "E"), pid: 42, tid: 7, ts: 116000 },
					{ ...fragment("V8.DeoptimizeCode", "X"), pid: 42, tid: 7, ts: 117000, dur: 1000 },
					{ ...fragment("V8.DeoptimizeCode", "X"), pid: 42, tid: 8, ts: 117000, dur: 1000 },
				);
				trace.traceEvents.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
			}
			return { evidence, trace };
		}
		const bound = (f) => {
			const et = JSON.stringify(f.evidence),
				tt = JSON.stringify(f.trace);
			return [
				tt,
				et,
				{
					identity: f.evidence.identity,
					traceFiles: ["trace-1.json"],
					exitCode: 0,
					timedOut: false,
					traceDigest: hash(tt),
					evidenceDigest: hash(et),
				},
			];
		};
		for (const profile of ["fixture", "consumer"]) {
			const f = traceCase(profile),
				r = correlateCpuTrace(...bound(f));
			assert.equal(r.status, "calibrated", r.reason);
			assert.deepEqual(Object.values(r.categories), [
				"not-observed",
				"not-observed",
				"not-observed",
			]);
			assert.equal(correlateTrace(...bound(f)).status, "unknown");
			positive++;
		}
		const f = traceCase();
		for (const mutate of [
			(x) => x.evidence.anchors.pop(),
			(x) => (x.evidence.anchors[1] = { p0: 25, p1: 25.1, h: "125050000" }),
			(x) => (x.trace.traceEvents[1].pid = 43),
			(x) => (x.trace.traceEvents[2].id = "0x1"),
			(x) => x.trace.traceEvents.push({ ...x.trace.traceEvents[1] }),
			(x) => (x.evidence.anchors[0].h = "999999999999"),
			(x) =>
				x.trace.traceEvents.push({
					ph: "i",
					pid: 42,
					tid: 7,
					cat: "v8",
					name: "MajorGC",
					ts: 400000,
				}),
		]) {
			const c = structuredClone(f);
			mutate(c);
			assert.equal(correlateCpuTrace(...bound(c)).status, "unknown");
			negative++;
		}
		const b = bound(f);
		assert.equal(
			correlateCpuTrace(
				...[b[0].slice(0, -1), b[1], { ...b[2], traceDigest: hash(b[0].slice(0, -1)) }],
			).status,
			"unknown",
		);
		assert.equal(
			correlateCpuTrace(b[0], b[1], { ...b[2], traceFiles: ["trace-1.json", "trace-2.json"] })
				.status,
			"unknown",
		);
		negative += 2;
		const event = { ph: "X", pid: 42, tid: 7, cat: "v8", name: "MajorGC", ts: 115000, dur: 1000 };
		f.trace.traceEvents.push(event);
		f.trace.traceEvents.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
		assert.equal(correlateCpuTrace(...bound(f)).samples[0].events[0].status, "overlap");
		assert.equal(
			relation([110000, 110000], { start: 10, end: 20 }, [100000, 100000]).status,
			"possible",
		);
		// Actual adapter/report loaded mutants, rehashed evidence stays under the same semantic oracle.
		const adapter = fs.readFileSync("scripts/causal-cpu-trace.mjs", "utf8"),
			reporter = fs.readFileSync("scripts/report-causal-cpu.mjs", "utf8");
		fs.copyFileSync(
			"scripts/causal-event-correlation.mjs",
			path.join(tmp, "causal-event-correlation.mjs"),
		);
		fs.writeFileSync(path.join(tmp, "causal-cpu-trace.mjs"), adapter);
		for (const [a, b, test] of [
			[
				'status: "unknown"',
				'status: "calibrated"',
				(m) => {
					const c = bound(traceCase());
					c[2].traceFiles = [];
					assert.equal(m.correlateCpuTrace(...c).status, "unknown");
				},
			],
			[
				'"not-observed"',
				'"no-cost"',
				(m) =>
					assert.ok(
						Object.values(m.correlateCpuTrace(...bound(traceCase())).categories).every(
							(x) => x === "not-observed",
						),
					),
			],
		]) {
			assert.ok(adapter.includes(a));
			const file = path.join(tmp, `adapter-${mutants}.mjs`);
			fs.writeFileSync(file, adapter.replaceAll(a, b));
			const m = await import(pathToFileURL(file));
			assert.throws(() => test(m));
			mutants++;
		}
		for (const [a, b] of [
			["const Wlo =", "assert.ok(P<=b.p0-a.p1);const Wlo ="],
			["/ 1000;", "/ 1;"],
		]) {
			assert.ok(reporter.includes(a));
			const file = path.join(tmp, `report-${mutants}.mjs`);
			fs.writeFileSync(file, reporter.replace(a, b));
			const m = await import(pathToFileURL(file));
			assert.throws(() => assert.deepEqual(m.phases(e), p));
			mutants++;
		}
		fs.writeFileSync(
			path.join(tmp, "vectors.json"),
			JSON.stringify({
				evidence: e,
				expected: p,
				traceCases: [traceCase("fixture", true), traceCase("consumer", true)],
			}),
		);
		// Python independently checks these raw vectors, not JS arithmetic or labels.
		const py = spawnSync(
			"python3",
			["-B", "scripts/causal-cpu.test.py", path.join(tmp, "vectors.json"), material],
			{ encoding: "utf8", timeout: 30000 },
		);
		assert.equal(py.status, 0, py.stderr + py.stdout);
		console.log(
			JSON.stringify({
				passed: true,
				positive,
				negative,
				loadedMutants: mutants,
				python: JSON.parse(py.stdout),
				nativeConsumerSamples: 0,
				nativeObserverCaptures: 0,
			}),
		);
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}
