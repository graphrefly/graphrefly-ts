/** Loaded private-driver qualification. All factories are stubs; no consumer sampling. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import timers from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { check } from "./check-causal-block-source.mjs";
import { derive } from "./derive-causal-block-driver.mjs";

const self = fileURLToPath(import.meta.url);
if (process.argv[2] === "--stub") {
	const [driver, cell, mutation] = process.argv.slice(3);
	const { runRow } = await import(pathToFileURL(driver));
	const reference = 0;
	const order = [0, 1];
	const orders = {
		S00: [
			["candidate", "reference"],
			["reference", "candidate"],
			["candidate", "reference"],
		],
		S01: [
			["candidate", "reference"],
			["reference", "candidate"],
			["reference", "candidate"],
		],
		S10: [
			["candidate", "reference"],
			["candidate", "reference"],
			["candidate", "reference"],
		],
		S11: [
			["candidate", "reference"],
			["candidate", "reference"],
			["reference", "candidate"],
		],
	}[cell];
	const config = {
		row: { id: "cold-P2-summary", group: "cold", profile: "P2", mode: "summary" },
		control: true,
		output: "/stub",
		scenarioPath: "scenario",
		copyModule: pathToFileURL(
			path.join(path.dirname(driver), reference === 0 ? "worker-copy.mjs" : "worker.mjs"),
		).href,
		diagnostic: { cell, referenceModule: reference, preflightOrder: order, orders },
	};
	if (mutation === "wrong-row") config.row.group = "recovery";
	if (mutation === "wrong-control") config.control = false;
	if (mutation === "wrong-slot") config.diagnostic.referenceModule = 1 - reference;
	if (mutation === "wrong-cell") config.diagnostic.cell = "H0";
	if (mutation === "copy-self")
		config.copyModule = pathToFileURL(
			path.join(path.dirname(driver), reference === 0 ? "worker.mjs" : "worker-copy.mjs"),
		).href;
	const events = [],
		samples = [],
		outputs = {};
	let now = 0,
		serial = 0;
	const recipe = {
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
	const freeze = (x) => {
		if (x && typeof x === "object") {
			Object.values(x).forEach(freeze);
			Object.freeze(x);
		}
		return x;
	};
	freeze(recipe);
	const modules = [0, 1].map((id) => ({
		RECIPE: recipe,
		preflight() {
			events.push(["preflight", id]);
			return { passed: true };
		},
		measurementArm(arm, mode) {
			assert.equal(arm, "reference");
			assert.equal(mode, "summary");
			const instance = ++serial;
			events.push(["factory", id, instance]);
			return {
				cleanup() {
					events.push(["cleanup", instance]);
					if (mutation === "dual-failure") throw Error("cleanup");
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
		await runRow("config", mutation === "same-namespace" ? [modules[0], modules[0]] : modules);
	} catch (e) {
		failure = e;
	}
	const invalid = [
		"wrong-row",
		"wrong-control",
		"wrong-slot",
		"wrong-cell",
		"copy-self",
		"same-namespace",
	].includes(mutation);
	if (invalid) {
		assert.ok(failure);
		assert.deepEqual(events, []);
	} else if (mutation === "dual-failure") {
		assert.ok(failure instanceof AggregateError);
		assert.deepEqual(
			failure.errors.map((e) => e.message),
			["record", "cleanup"],
		);
		assert.equal(serial, 1);
	} else {
		assert.equal(failure, undefined);
		assert.deepEqual(
			events.slice(0, 2),
			order.map((id) => ["preflight", id]),
		);
		const start = events.findIndex((e) => e[0] === "tick");
		assert.equal(events.slice(2, start).filter((e) => e[0] === "preflight").length, 0);
		let cursor = start,
			instance = 0;
		for (const arms of orders)
			for (const arm of arms)
				for (let i = 0; i < 400; i++) {
					instance++;
					assert.deepEqual(events.slice(cursor, cursor + 8), [
						["tick"],
						["memory"],
						["clock"],
						["factory", arm === "reference" ? reference : 1 - reference, instance],
						["clock"],
						["memory"],
						["record"],
						["cleanup", instance],
					]);
					cursor += 8;
				}
		assert.equal(cursor, events.length);
		assert.equal(samples.length, 2400);
		for (const s of samples) {
			assert.equal(s.ms, 1);
			assert.equal(s.end - s.start, 1);
			assert.equal(s.constructionMs, 0);
			assert.equal(s.preparationMs, 0);
		}
		assert.deepEqual(outputs["/stub/worker.json"].recipe, { ...recipe, orders });
		assert.deepEqual(outputs["/stub/completion.json"], { completed: true, samples: 2400 });
	}
	console.log("STUB_QUALIFIED", cell, mutation);
} else {
	const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "neutral-qual-")));
	const receipt = {
		kind: "loaded-block-history-qualification-v1",
		positiveCells: [],
		staticMutations: [],
		loadedMutations: [],
		realConsumerMeasurements: 0,
	};
	try {
		const extracted = spawnSync(
			"python3",
			[
				"-c",
				'import tarfile,hashlib; t=tarfile.open("archive/evals/causal-performance-repetition-v2/evidence.tar.gz"); print(next(b.decode() for m in t.getmembers() if m.isfile() for b in [t.extractfile(m).read()] if hashlib.sha256(b).hexdigest()=="d9d8606d73e1bcfad66097f027d63c99fc409571042c5f1e7efffaa645356fb2"),end="")',
			],
			{ encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
		);
		assert.equal(extracted.status, 0, extracted.stderr);
		const source = extracted.stdout;
		const { output } = derive(source);
		assert.equal(check(source, output).valid, true);
		const driver = path.join(tmp, "block-history.mjs");
		const run = (text, cell, mutation) => {
			fs.writeFileSync(driver, text);
			return spawnSync(process.execPath, [self, "--stub", driver, cell, mutation], {
				encoding: "utf8",
				timeout: 15000,
				env: { PATH: process.env.PATH },
			});
		};
		for (const cell of ["S00", "S01", "S10", "S11"]) {
			const r = run(output, cell, "none");
			assert.equal(r.status, 0, r.stderr);
			receipt.positiveCells.push(cell);
		}
		for (const mutation of [
			"wrong-row",
			"wrong-control",
			"wrong-slot",
			"wrong-cell",
			"copy-self",
			"same-namespace",
			"dual-failure",
		]) {
			const r = run(output, "S01", mutation);
			assert.equal(r.status, 0, r.stderr);
			receipt.loadedMutations.push({ mutation, detected: true });
		}
		const replacements = {
			"wrong-factory-slot": [
				'arm === "reference" ? diagnostic.referenceModule',
				'arm === "candidate" ? diagnostic.referenceModule',
			],
			"reversed-preflight": [
				"modules[diagnostic.preflightOrder[0]].preflight",
				"modules[diagnostic.preflightOrder[1]].preflight",
			],
			"missing-preflight": [
				"modules[diagnostic.preflightOrder[1]].preflight(row, scenario)",
				"checked3",
			],
			"missing-cleanup": [
				"if (run !== shared) cleanupAll([run], sampleFailure);",
				"if (false) cleanupAll([run], sampleFailure);",
			],
			"cached-instance": [
				"const makeArm = (arm, mode) => modules[",
				"let cached; const makeArm = (arm, mode) => cached ??= modules[",
			],
			"outside-clock": [
				"const start = performance2.now();",
				"if(row.group === 'cold') run = makeArm(arm,row.mode); const start = performance2.now();",
			],
			generator: ["export async function runRow", "export async function* runRow"],
			"wrong-duration": ["ms: end - start,", "ms: 0,"],
			"ignored-orders": ["orders:diagnostic.orders", "orders:originalRecipe.orders"],
			"metadata-only": ["recipe: RECIPE,", "recipe: originalRecipe,"],
			"wrong-batch": [
				"orders:diagnostic.orders",
				"orders:[diagnostic.orders[1],diagnostic.orders[0],diagnostic.orders[2]]",
			],
			"double-flip": [
				"orders:diagnostic.orders",
				"orders:originalRecipe.orders.map(p=>[...p].reverse().reverse())",
			],
			"duplicate-slot": [
				"orders:diagnostic.orders",
				"orders:diagnostic.orders.map(p=>[p[0],p[0]])",
			],
			"missing-slot": ["orders:diagnostic.orders", "orders:diagnostic.orders.map(p=>[p[0]])"],
			"extra-batch": [
				"orders:diagnostic.orders",
				"orders:[...diagnostic.orders,diagnostic.orders[0]]",
			],
			"missing-batch": ["orders:diagnostic.orders", "orders:diagnostic.orders.slice(0,2)"],
			"mutate-original": [
				"const checked3 =",
				"modules[0].RECIPE.orders[0].reverse(); const checked3 =",
			],
		};
		for (const [mutation, [from, to]] of Object.entries(replacements)) {
			assert.ok(output.includes(from), mutation);
			const altered = output.replace(from, to);
			assert.throws(() => check(source, altered));
			receipt.staticMutations.push({ mutation, detected: true });
			const r = run(altered, "S01", "none");
			assert.notEqual(r.status, 0, mutation);
			receipt.loadedMutations.push({ mutation, detected: true });
		}
		assert.throws(() => check(source, output + "\nconsole.log('extra');"));
		receipt.staticMutations.push({ mutation: "extra-top-level", detected: true });
		console.log(JSON.stringify(receipt, null, 2));
		if (process.env.BLOCK_JS_RECEIPT)
			fs.writeFileSync(process.env.BLOCK_JS_RECEIPT, JSON.stringify(receipt, null, 2) + "\n", {
				flag: "wx",
			});
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}
