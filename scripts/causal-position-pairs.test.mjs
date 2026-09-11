/** D169 loaded qualification. Timing loops use fake clocks and stub factories. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import timers from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { check } from "./check-causal-position-source.mjs";
import { derive } from "./derive-causal-position-driver.mjs";

const self = fileURLToPath(import.meta.url);
const material = process.argv[2];
assert.ok(material, "explicit offline material directory required");
const original = fs.readFileSync(path.join(material, "worker.mjs"), "utf8");
const fixed = {
	revision: "spending-preset-performance-v1",
	coldRows: 12,
	steadyRows: 60,
	recoveryRows: 12,
	warmup: 100,
	measured: 300,
	orders: [
		["candidate", "reference"],
		["reference", "candidate"],
		["candidate", "reference"],
	],
	coldLimit: 1.2,
	steadyLimit: 1.1,
	recoveryCycles: 20,
	stopAfterFailedRow: true,
	childTimeoutMs: 900000,
	totalTimeoutMs: 7200000,
	freshBasis: "distinct evaluation identities absent before the whole wave",
	doubleData:
		"two exact copies of the same arrival frame in one source.down; second copy is intra-wave replay",
	memory:
		"raw process heap/RSS before and after action; GC may make deltas negative, not retained-size proof",
};
if (process.argv[3] === "--stub") {
	const [driver, kind, orientation, mutation] = process.argv.slice(4);
	const n = await import(pathToFileURL(driver));
	const orders =
		orientation === "P"
			? [["plain"], ["plain"], ["plain"]]
			: fixed.orders.map((row) => (orientation === "U" ? row : [...row].reverse()));
	const config = {
		row: { id: "cold-P2-summary", group: "cold", profile: "P2", mode: "summary" },
		kind,
		orientation,
		control: kind === "control",
		output: "/stub",
		scenarioPath: "scenario",
	};
	if (mutation === "row") config.row.group = "recovery";
	if (mutation === "kind") config.kind = "other";
	if (mutation === "orientation") config.orientation = "X";
	if (mutation === "plain-order") config.orientation = "P";
	if (mutation === "control") config.control = !config.control;
	const freeze = (x) => {
		if (x && typeof x === "object") {
			Object.values(x).forEach(freeze);
			Object.freeze(x);
		}
		return x;
	};
	freeze(fixed);
	let now = 0,
		serial = 0;
	const events = [],
		samples = [],
		outputs = {};
	const modules = [0, 1].map((id) => ({
		RECIPE: fixed,
		preflight() {
			events.push(["preflight", id]);
			return { passed: true };
		},
		measurementArm(arm, mode) {
			assert.equal(mode, "summary");
			const instance = ++serial;
			events.push(["factory", id, arm, instance]);
			if (mutation === "factory-failure") throw Error("factory");
			return {
				cleanup() {
					events.push(["cleanup", instance]);
					if (mutation === "dual-failure" || mutation === "extra-cleanup") throw Error("cleanup");
				},
			};
		},
	}));
	let configPath = "config",
		entryPath;
	const loads = [];
	if (mutation === "entry") {
		const parent = path.dirname(driver),
			job = path.join(parent, "entry-job");
		fs.mkdirSync(job, { recursive: true });
		config.output = job;
		config.scenarioPath = path.join(parent, "P2-inputs.json");
		configPath = path.join(job, "config.json");
		entryPath = path.join(job, "entry.mjs");
		globalThis.positionStubModules = modules;
		for (const [id, name] of [
			[0, "worker.mjs"],
			[1, "worker-copy.mjs"],
		]) {
			fs.writeFileSync(
				path.join(parent, name),
				`const m = globalThis.positionStubModules[${id}]; export const RECIPE=m.RECIPE; export const preflight=(...args)=>m.preflight(...args); export const measurementArm=(...args)=>m.measurementArm(...args);`,
			);
		}
		const generated = spawnSync(
			"python3",
			[
				"-c",
				"import importlib.util,sys; from pathlib import Path; s=importlib.util.spec_from_file_location('r',sys.argv[1]); r=importlib.util.module_from_spec(s); s.loader.exec_module(r); print(r.entry_source(Path(sys.argv[2]),dict(kind=sys.argv[3],orientation=sys.argv[4])),end='')",
				path.resolve("scripts/causal-position-pairs.py"),
				job,
				kind,
				orientation,
			],
			{ encoding: "utf8", timeout: 15000 },
		);
		assert.equal(generated.status, 0, generated.stderr);
		fs.writeFileSync(entryPath, generated.stdout);
	}
	const realRead = fs.readFileSync;
	fs.readFileSync = (p, ...args) =>
		p === configPath
			? JSON.stringify(config)
			: p === config.scenarioPath
				? "{}"
				: realRead(p, ...args);
	fs.writeFileSync = (p, s) => {
		outputs[p] = JSON.parse(s);
	};
	fs.appendFileSync = (_p, s) => {
		if (_p.endsWith("entry-events.jsonl")) {
			loads.push(JSON.parse(s).module);
			return;
		}
		events.push(["record"]);
		if (mutation === "dual-failure") throw Error("record");
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
	syncBuiltinESMExports();
	let failure;
	try {
		if (entryPath) await import(pathToFileURL(entryPath));
		else await n.runRow(configPath, mutation === "namespace" ? [modules[0], modules[0]] : modules);
	} catch (e) {
		failure = e;
	}
	if (["row", "kind", "orientation", "plain-order", "control", "namespace"].includes(mutation)) {
		assert.ok(failure);
		assert.deepEqual(events, []);
	} else if (mutation === "dual-failure") {
		assert.ok(failure instanceof AggregateError);
		assert.deepEqual(
			failure.errors.map((e) => e.message),
			["record", "cleanup"],
		);
		assert.equal(serial, 1);
	} else if (mutation === "extra-cleanup") {
		assert.ok(failure);
		assert.equal(serial, 1);
		assert.deepEqual(events.slice(-2), [
			["factory", 1, "reference", 1],
			["cleanup", 1],
		]);
	} else if (mutation === "factory-failure") {
		assert.equal(failure?.message, "factory");
		assert.equal(serial, 1);
	} else {
		assert.equal(failure, undefined);
		assert.deepEqual(
			events.slice(0, kind === "plain" ? 1 : 2),
			kind === "plain"
				? [["preflight", 0]]
				: [
						["preflight", 0],
						["preflight", 1],
					],
		);
		let cursor = events.findIndex((e) => e[0] === "tick"),
			id = 0;
		for (const arms of orders)
			for (const arm of arms)
				for (let i = 0; i < 400; i++) {
					const expected = [["tick"], ["memory"], ["clock"]];
					const slot = arm === "candidate" ? 1 : 0;
					const selected =
						arm === "plain"
							? "plain"
							: arm === "candidate" && kind === "main"
								? "candidate"
								: "reference";
					if (kind === "mutation" && arm === "candidate") {
						expected.push(["factory", slot, selected, ++id], ["cleanup", id]);
					}
					expected.push(
						["factory", slot, selected, ++id],
						["clock"],
						["memory"],
						["record"],
						["cleanup", id],
					);
					assert.deepEqual(events.slice(cursor, cursor + expected.length), expected);
					cursor += expected.length;
				}
		assert.equal(cursor, events.length);
		assert.equal(serial, kind === "mutation" ? 3600 : kind === "plain" ? 1200 : 2400);
		assert.equal(samples.length, kind === "plain" ? 1200 : 2400);
		assert.ok(samples.every((s) => s.ms === 1 && s.constructionMs === 0 && s.preparationMs === 0));
		assert.deepEqual(outputs[`${config.output}/completion.json`], {
			completed: true,
			samples: samples.length,
		});
		assert.deepEqual(outputs[`${config.output}/worker.json`].recipe, { ...fixed, orders });
		if (entryPath) {
			assert.deepEqual(loads, ["N", "M0", "M1"]);
			assert.deepEqual(outputs[`${config.output}/recipe-after.json`].recipe, fixed);
		}
	}
	console.log(
		JSON.stringify({
			kind,
			orientation,
			mutation,
			passed: true,
			instances: serial,
			samples: samples.length,
			fakeClock: true,
		}),
	);
} else {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "causal-position-qualification-"));
	try {
		const { output, manifest } = derive(original);
		check(original, output);
		const driver = path.join(tmp, "position.mjs");
		fs.writeFileSync(driver, output);
		let negatives = 0;
		const mutations = [
			["const arms = RECIPE.orders[batch2];", "const arms = [...RECIPE.orders[batch2]].reverse();"],
			['const slot = arm === "candidate" ? 1 : 0;', 'const slot = arm === "candidate" ? 0 : 1;'],
			['kind === "mutation" && arm === "candidate"', "false"],
			["cleanupAll([extra]);", "void extra;"],
			[
				"const extra = modules[slot].measurementArm(selected,mode);",
				"const extra = {cleanup(){}};",
			],
			[
				"return modules[slot].measurementArm(selected,mode);",
				"return modules[0].measurementArm(selected,mode);",
			],
			['const selected = arm === "plain"', 'const selected = arm === "reference"'],
			["assert.deepEqual(modules[0].RECIPE,originalRecipe);", ""],
			["assert.deepEqual(modules[1].RECIPE,originalRecipe);", ""],
			[
				"const RECIPE = {...originalRecipe,orders:orders[config.orientation]};",
				"const RECIPE = modules[0].RECIPE;",
			],
			[
				"const checked3 = modules[0].preflight(row,scenario);",
				"const checked3 = modules[1].preflight(row,scenario);",
			],
			['config.kind !== "plain"', "false"],
			["const start = performance2.now();", "const start = 0;"],
			["const end = performance2.now();", "const end = start;"],
			["ms: end - start", "ms: 2"],
			["if (run !== shared) cleanupAll([run], sampleFailure);", ""],
			["appendFileSync(samplesPath,", "writeFileSync(samplesPath,"],
			["batch2 < RECIPE.orders.length", "batch2 < 2"],
			["index < total", "index < total - 1"],
			["await setImmediate();", ""],
		];
		for (const [from, to] of mutations) {
			assert.ok(output.includes(from), from);
			assert.throws(() => check(original, output.replace(from, to)));
			negatives++;
		}
		assert.throws(() => check(original, output + 'console.log("extra");'));
		negatives++;
		const cases = [
			["control", "U", "none"],
			["control", "V", "none"],
			["main", "U", "none"],
			["main", "V", "none"],
			["mutation", "U", "none"],
			["mutation", "V", "none"],
			["plain", "P", "none"],
			...[
				"row",
				"kind",
				"orientation",
				"plain-order",
				"control",
				"namespace",
				"dual-failure",
				"factory-failure",
			].map((m) => ["control", "U", m]),
			["mutation", "U", "extra-cleanup"],
		];
		cases.push(
			...[
				["control", "U"],
				["control", "V"],
				["main", "U"],
				["main", "V"],
				["mutation", "U"],
				["mutation", "V"],
				["plain", "P"],
			].map(([kind, orientation]) => [kind, orientation, "entry"]),
		);
		const loaded = [];
		for (const args of cases) {
			const result = spawnSync(process.execPath, [self, material, "--stub", driver, ...args], {
				encoding: "utf8",
				timeout: 15000,
			});
			assert.equal(result.status, 0, result.stderr);
			loaded.push(JSON.parse(result.stdout.trim().split("\n").at(-1)));
		}
		const runtimeFaults = [
			mutations[1],
			mutations[2],
			mutations[3],
			mutations[4],
			mutations[5],
			mutations[14],
			mutations[17],
		];
		for (let i = 0; i < runtimeFaults.length; i++) {
			const [from, to] = runtimeFaults[i],
				file = path.join(tmp, `mutant-${i}.mjs`);
			fs.writeFileSync(file, output.replace(from, to));
			const run = spawnSync(
				process.execPath,
				[self, material, "--stub", file, "mutation", "U", "none"],
				{ encoding: "utf8", timeout: 15000 },
			);
			assert.notEqual(run.status, 0, `loaded mutant ${i} escaped`);
		}
		const moved = output
			.replace('kind === "mutation" && arm === "candidate"', "false")
			.replace(
				"const memoryBefore = process.memoryUsage();",
				'if (config.kind === "mutation" && arm === "candidate") { const extra=modules[1].measurementArm("reference",row.mode); cleanupAll([extra]); }\nconst memoryBefore = process.memoryUsage();',
			);
		const swallowed = output.replace(
			"cleanupAll([extra]);",
			"try { cleanupAll([extra]); } catch {}",
		);
		for (const [name, source, fault] of [
			["outside-timer", moved, "none"],
			["swallowed-cleanup", swallowed, "extra-cleanup"],
		]) {
			assert.notEqual(source, output);
			assert.throws(() => check(original, source));
			negatives++;
			const file = path.join(tmp, `${name}.mjs`);
			fs.writeFileSync(file, source);
			const run = spawnSync(
				process.execPath,
				[self, material, "--stub", file, "mutation", "U", fault],
				{ encoding: "utf8", timeout: 15000 },
			);
			assert.notEqual(run.status, 0, `${name} loaded source escaped`);
		}
		// Append read-only qualification exports to immutable bytes; no mutation of factory/oracle bodies.
		const appended =
			"\nexport {graphSnapshot as qualificationSnapshot,verifyBusiness as qualificationOracle,sorted as qualificationSorted};\n";
		const modules = [];
		for (let i = 0; i < 2; i++) {
			const file = path.join(tmp, `real-${i}.mjs`);
			fs.writeFileSync(file, original + appended);
			assert.equal(fs.readFileSync(file, "utf8").slice(0, original.length), original);
			modules.push(await import(pathToFileURL(file)));
		}
		const n = await import(pathToFileURL(driver));
		const scenario = JSON.parse(fs.readFileSync(path.join(material, "P2-inputs.json"), "utf8"));
		const real = [];
		for (const kind of ["control", "main", "mutation"]) {
			let created = 0,
				cleaned = 0;
			const live = new Set();
			const wrapped = modules.map((m) => ({
				RECIPE: m.RECIPE,
				measurementArm(arm, mode) {
					const run = m.measurementArm(arm, mode);
					created++;
					live.add(run);
					return {
						...run,
						cleanup() {
							assert.ok(live.delete(run), "one cleanup per instance");
							run.cleanup();
							cleaned++;
							assert.equal(run.graph?.describe().nodes.length ?? 0, 0, "released graph topology");
						},
					};
				},
			}));
			const make = n.makeFactory(wrapped, kind);
			let a, b, p;
			try {
				a = make("candidate", "summary");
				assert.equal(created, kind === "mutation" ? 2 : 1);
				assert.equal(cleaned, kind === "mutation" ? 1 : 0);
				assert.equal(live.size, 1);
				b = make("reference", "summary");
				p = make("plain", "summary");
				for (const step of scenario.steps) {
					for (const run of [a, b, p]) run.send(step);
					const sa = modules[0].qualificationSnapshot(a);
					assert.deepEqual(modules[0].qualificationSnapshot(b), sa);
					assert.deepEqual(p.plain.snapshot(), sa.effects);
					assert.deepEqual(modules[0].qualificationSorted(p.plain.evidenceSnapshot()), sa.evidence);
					assert.deepEqual(
						modules[0].qualificationSorted(p.plain.obligationSnapshot()),
						sa.obligations,
					);
				}
				const assessment = a.latest.assessment;
				for (const e of scenario.evaluations) {
					const observed = assessment.rows.find(
						(r) => r.evaluation.evaluationRef === e.evaluationRef,
					);
					assert.ok(observed && modules[0].qualificationOracle(e, observed.value));
				}
				for (const run of [a, b]) {
					const before = modules[0].qualificationSnapshot(run);
					run.disconnect();
					assert.deepEqual(modules[0].qualificationSnapshot(run), before);
					run.connect();
					assert.deepEqual(modules[0].qualificationSnapshot(run).obligations, before.obligations);
				}
			} finally {
				for (const run of [a, b, p]) run?.cleanup();
			}
			assert.equal(live.size, 0);
			assert.equal(created, cleaned);
			real.push({ kind, created, cleaned, oraclePassed: true });
		}
		console.log(
			JSON.stringify({
				passed: true,
				manifest,
				staticNegatives: negatives,
				loadedCases: loaded,
				loadedSourceMutants: runtimeFaults.length + 2,
				realAdapterQualification: real,
				consumerPerformanceSamples: 0,
			}),
		);
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}
