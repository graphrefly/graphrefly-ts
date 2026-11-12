/** Loaded private driver/cleanup tests: all factories and clocks are fake. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import timers from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createGaps, finishBoth } from "./causal-cleanup-observer.mjs";
import { createObserver } from "./causal-cpu-observer.mjs";
import { driver, worker } from "./derive-causal-cleanup.mjs";

const material = process.argv[2];
assert.ok(material);
const original = fs.readFileSync(path.join(material, "position.mjs"), "utf8");
const bundle = fs.readFileSync(path.join(material, "worker.mjs"), "utf8");
const fixed = JSON.parse(original.match(/const originalRecipe = (.*);/)[1]);
const self = fileURLToPath(import.meta.url);
const derivedWorker = worker(bundle);
const match = derivedWorker.match(/cleanup: \(diagnostic\) => \{([\s\S]*?)\n {4}\}/);
assert.ok(match);
if (process.argv[3] === "--stub") {
	const [root, mode, orientation, fault] = process.argv.slice(4);
	const job = path.join(root, "job");
	fs.mkdirSync(job);
	let source = mode === "B" ? original : driver(original),
		body = match[1];
	if (fault === "getter-inside")
		source = source.replace(
			'if (row.group === "cold") run = makeArm(arm, row.mode);',
			'if (row.group === "cold") { performance2.now(); run = makeArm(arm, row.mode); }',
		);
	if (fault === "drop-cleanup")
		source = source.replace(
			"if (run !== shared) cleanupAll([run], sampleFailure, deep);",
			"if (false) cleanupAll([run], sampleFailure, deep);",
		);
	if (fault === "drop-release") body = body.replace("group.release();", "");
	if (fault === "swap-deep")
		body = body
			.replace("diagnostic.d1 =", "diagnostic.d9 =")
			.replace("diagnostic.d2 =", "diagnostic.d1 =")
			.replace("diagnostic.d9 =", "diagnostic.d2 =");
	if (fault === "missing-d4")
		body = body.replace("if (diagnostic) diagnostic.d4 = diagnostic.now(); // GAP", "");
	if (fault === "coordinate")
		source = source.replace(
			"gaps.begin({batch:batch2, arm, index,",
			"gaps.begin({batch:batch2, arm, index:index+1,",
		);
	if (fault === "swallow-primary")
		source = source.replace("sampleFailure = error;", "sampleFailure = undefined;");
	fs.writeFileSync(path.join(root, "position.mjs"), source);
	fs.writeFileSync(path.join(root, "observed.mjs"), source);
	fs.mkdirSync(path.join(root, "source/scripts"), { recursive: true });
	for (const name of ["causal-cpu-observer.mjs", "causal-cleanup-observer.mjs"])
		fs.copyFileSync(path.resolve("scripts", name), path.join(root, "source/scripts", name));
	const config = {
		row: { id: "cold-P2-summary", group: "cold", profile: "P2", mode: "summary" },
		kind: "control",
		control: true,
		orientation,
		output: job,
		scenarioPath: path.join(root, "P2-inputs.json"),
		mode: mode === "B" ? "B" : "Q",
		gapMode: fault === "mode-mismatch" ? "S" : mode,
		profile: "consumer",
		run: "fake",
		sourceDigest: "a".repeat(64),
	};
	let afterRecord = -1;
	let now = 0,
		cpu = 0,
		count = 0,
		release = 0,
		disconnects = 0,
		roots = 0,
		describes = 0,
		members = 0;
	const events = [],
		outputs = {},
		samples = [],
		loads = [],
		preflights = [];
	const cleanupFactory = new Function(
		"disconnect",
		"owner",
		"graph",
		`return (diagnostic)=>{${body}\n}`,
	);
	const modules = [0, 1].map((id) => ({
		RECIPE: structuredClone(fixed),
		preflight() {
			preflights.push(id);
			return { passed: true };
		},
		measurementArm(arm, m) {
			assert.equal(arm, "reference");
			assert.equal(m, "summary");
			count++;
			events.push("factory");
			const group = {
				add() {
					members++;
				},
				release() {
					release++;
					if (["dual", "swallow-primary", "cleanup"].includes(fault)) throw Error("cleanup");
				},
			};
			const cleanup = cleanupFactory(
				() => {
					disconnects++;
				},
				{
					roots: [
						{
							unsubscribe() {
								roots++;
							},
						},
					],
				},
				{
					topologyGroup() {
						return group;
					},
					describe() {
						describes++;
						return { nodes: [{ id: "one" }, { id: "two" }] };
					},
					find(id) {
						return id;
					},
				},
			);
			return { cleanup };
		},
	}));
	globalThis.cleanupStubModules = modules;
	for (const [i, name] of ["worker.mjs", "worker-copy.mjs"].entries()) {
		const stub = `const m=globalThis.cleanupStubModules[${i}];export const RECIPE=m.RECIPE;export const preflight=(...a)=>m.preflight(...a);export const measurementArm=(...a)=>m.measurementArm(...a);`;
		fs.writeFileSync(path.join(root, name), stub);
		fs.writeFileSync(path.join(root, "derived-" + name), stub);
	}
	const entry = spawnSync(
		"python3",
		[
			"-B",
			"-c",
			"import importlib.util,sys;from pathlib import Path;s=importlib.util.spec_from_file_location('c',sys.argv[1]);c=importlib.util.module_from_spec(s);s.loader.exec_module(c);print(c.entry(Path(sys.argv[2]),Path(sys.argv[3]),sys.argv[4]),end='')",
			path.resolve("scripts/causal-cleanup-diagnostic.py"),
			root,
			job,
			mode,
		],
		{ encoding: "utf8", timeout: 15000 },
	);
	assert.equal(entry.status, 0, entry.stderr);
	fs.writeFileSync(path.join(job, "entry.mjs"), entry.stdout);
	const realRead = fs.readFileSync,
		realWrite = fs.writeFileSync;
	fs.readFileSync = (p, ...args) =>
		p === path.join(job, "config.json")
			? JSON.stringify(config)
			: p === config.scenarioPath
				? "{}"
				: realRead(p, ...args);
	fs.writeFileSync = (p, s) => {
		if (fault === "write-failure" && p.endsWith("evidence.json")) throw Error("evidence-write");
		outputs[path.basename(p)] = JSON.parse(s);
	};
	fs.appendFileSync = (p, s) => {
		if (p.endsWith("entry-events.jsonl")) {
			loads.push(JSON.parse(s));
			return;
		}
		events.push("record");
		afterRecord = 0;
		if (["dual", "swallow-primary", "c0-dual", "d0-dual", "c1-dual"].includes(fault))
			throw Error("record");
		samples.push(JSON.parse(s));
	};
	timers.setImmediate = async () => {
		events.push("yield");
	};
	Object.defineProperty(performance, "now", {
		configurable: true,
		value: () => {
			events.push("clock");
			if (afterRecord >= 0) {
				const n = afterRecord++;
				if (
					(fault === "c0-dual" && n === 0) ||
					(fault === "d0-dual" && n === 1) ||
					(fault === "c1-dual" && n === 6)
				)
					throw Error("clock-failure");
			}
			return ++now;
		},
	});
	process.memoryUsage = () => {
		events.push("memory");
		return { heapUsed: 10, rss: 20 };
	};
	process.threadCpuUsage = () => {
		events.push("thread");
		return { user: ++cpu * 1000, system: cpu * 100 };
	};
	process.resourceUsage = () => {
		events.push("process");
		return {
			userCPUTime: cpu * 3000,
			systemCPUTime: cpu * 100,
			voluntaryContextSwitches: cpu,
			involuntaryContextSwitches: 0,
			minorPageFault: 0,
			majorPageFault: 0,
		};
	};
	syncBuiltinESMExports();
	let error = null;
	try {
		await import(pathToFileURL(path.join(job, "entry.mjs")).href);
	} catch (e) {
		error = e;
	}
	const messages = (e) => [String(e), ...(e?.errors ?? []).flatMap(messages)];
	if (
		[
			"dual",
			"cleanup",
			"write-failure",
			"swallow-primary",
			"c0-dual",
			"d0-dual",
			"c1-dual",
		].includes(fault)
	) {
		assert.ok(error);
		const msg = messages(error).join("\n");
		if (["dual", "swallow-primary"].includes(fault)) {
			assert.match(msg, /record/);
			assert.match(msg, /cleanup/);
		}
		if (["c0-dual", "d0-dual", "c1-dual"].includes(fault)) {
			assert.match(msg, /record/);
			assert.match(msg, /clock-failure/);
			assert.equal(release, 1);
		}
		if (fault === "write-failure") assert.match(msg, /evidence-write/);
		assert.ok(outputs["gaps.json"]);
		assert.equal(outputs["gaps.json"].complete, fault === "write-failure");
	} else {
		assert.equal(error, null, error?.stack);
		assert.equal(count, 2400);
		assert.equal(release, 2400);
		assert.equal(disconnects, 2400);
		assert.equal(roots, 2400);
		assert.equal(describes, 2400);
		assert.equal(members, 4800);
		assert.deepEqual(preflights, [0, 1]);
		assert.deepEqual(
			loads.map((x) => x.module),
			["n", "m0", "m1"],
		);
		assert.equal(samples.length, 2400);
		assert.ok(samples.every((s) => s.ms === 1));
		for (let i = 0; i < events.length; i++)
			if (events[i] === "factory")
				assert.deepEqual(events.slice(i - 2, i + 3), [
					"memory",
					"clock",
					"factory",
					"clock",
					"memory",
				]);
		if (mode === "B") {
			assert.equal(outputs["gaps.json"], undefined);
			assert.equal(outputs["evidence.json"], undefined);
		} else {
			const g = outputs["gaps.json"],
				e = outputs["evidence.json"];
			assert.equal(g.gapMode, mode);
			assert.equal(g.samples.length, 2400);
			assert.equal(g.complete, true);
			assert.equal(e.windows.length, 12);
			for (let i = 0; i < 2400; i++) {
				const r = g.samples[i],
					s = samples[i];
				for (const k of ["batch", "arm", "index", "phase", "start", "end"])
					assert.equal(r[k], s[k]);
				const ts = ["y0", "y1", "m0", "start", "end", "m1", "r0", "r1", "c0", "c1"].map(
					(k) => r[k],
				);
				assert.ok(ts.every(Number.isFinite));
				assert.deepEqual(
					ts,
					[...ts].sort((a, b) => a - b),
				);
				if (mode === "D") {
					assert.deepEqual(Object.keys(r.deep), ["d0", "d1", "d2", "d3", "d4"]);
					const d = Object.values(r.deep);
					assert.deepEqual(
						d,
						[...d].sort((a, b) => a - b),
					);
					assert.ok(r.c0 < d[0] && d[4] < r.c1);
				} else assert.equal(r.deep, undefined);
			}
			assert.equal(events.filter((x) => x === "thread").length, 24);
			assert.equal(events.filter((x) => x === "process").length, 24);
			assert.equal(
				events.filter((x) => x === "clock").length,
				1 + 2400 * (2 + 8 + (mode === "D" ? 5 : 0)) + 48,
			);
			realWrite(path.join(root, "synthetic.json"), JSON.stringify({ g, samples, e, mode }));
		}
	}
	console.log("CLEANUP_LOADED_OK", mode, orientation, fault);
} else {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-offline-"));
	let positives = 0,
		mutants = 0;
	try {
		for (const mode of ["B", "S", "D"])
			for (const orientation of ["U", "V"]) {
				const dir = path.join(root, mode + orientation);
				fs.mkdirSync(dir);
				const r = spawnSync(
					process.execPath,
					[self, material, "--stub", dir, mode, orientation, "none"],
					{ encoding: "utf8", timeout: 20000 },
				);
				assert.equal(r.status, 0, r.stdout + r.stderr);
				positives++;
				if (mode !== "B") {
					const v = spawnSync(
						"python3",
						[
							"-B",
							"scripts/causal-cleanup.test.py",
							"--synthetic",
							path.join(dir, "synthetic.json"),
						],
						{ encoding: "utf8", timeout: 20000 },
					);
					assert.equal(v.status, 0, v.stdout + v.stderr);
				}
			}
		for (const fault of [
			"getter-inside",
			"drop-cleanup",
			"drop-release",
			"swap-deep",
			"missing-d4",
			"coordinate",
			"mode-mismatch",
			"swallow-primary",
			"dual",
			"cleanup",
			"write-failure",
			"c0-dual",
			"d0-dual",
			"c1-dual",
		]) {
			const dir = path.join(root, fault);
			fs.mkdirSync(dir);
			const r = spawnSync(process.execPath, [self, material, "--stub", dir, "D", "U", fault], {
				encoding: "utf8",
				timeout: 20000,
			});
			if (["dual", "cleanup", "write-failure", "c0-dual", "d0-dual", "c1-dual"].includes(fault)) {
				assert.equal(r.status, 0, r.stdout + r.stderr);
				positives++;
			} else {
				assert.notEqual(r.status, 0, fault + " survived");
				mutants++;
			}
		}
		assert.throws(() => driver(original + " "));
		assert.throws(() => worker(bundle.replace("group.release();", "group.noRelease();")));
		const errors = [];
		assert.throws(
			() =>
				finishBoth(
					{
						finish() {
							errors.push("cpu");
							throw Error("cpu-write");
						},
					},
					{
						finish() {
							errors.push("gap");
							throw Error("gap-write");
						},
					},
					Error("primary"),
				),
			(e) => e.errors.length === 3,
		);
		assert.deepEqual(errors, ["cpu", "gap"]);
		console.log(
			JSON.stringify({
				passed: true,
				loadedPositives: positives,
				loadedMutants: mutants,
				newConsumerSamples: 0,
			}),
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}
