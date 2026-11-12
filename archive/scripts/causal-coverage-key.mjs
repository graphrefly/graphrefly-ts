/** Fixed diagnostic before/after experiment; not D168/D169 performance qualification. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build, version as esbuildVersion } from "esbuild";
import ts from "typescript";
import { adaptWorker } from "./spending-preset-repetition.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const [mode, dir, jobArg] = process.argv.slice(2);
const root = resolve(dir);
const read = (n) => JSON.parse(readFileSync(resolve(root, n), "utf8"));
const put = (n, x) =>
	writeFileSync(resolve(root, n), JSON.stringify(x, null, 2) + "\n", { flag: "wx" });
if (mode === "prepare") {
	mkdirSync(root, { recursive: false });
	const target = "packages/ts/src/solutions/causal-occurrence/evidence.ts";
	const before = execFileSync("git", ["show", `5ce56737:${target}`], { encoding: "utf8" });
	const after = readFileSync(target, "utf8");
	assert.notEqual(before, after);
	const entry = "scripts/fixtures/spending-preset-performance-worker.ts";
	const adapter = readFileSync(new URL("./spending-preset-repetition.mjs", import.meta.url));
	const transformedWorker = adaptWorker(readFileSync(entry, "utf8"));
	writeFileSync(resolve(root, "worker-adapter.mjs"), adapter);
	writeFileSync(resolve(root, "transformed-worker.ts"), transformedWorker);
	const sources = {};
	const bundles = {};
	for (const variant of ["before", "after"]) {
		const b = await build({
			entryPoints: [entry],
			bundle: true,
			platform: "node",
			format: "esm",
			write: false,
			metafile: true,
			plugins: [
				{
					name: "controlled-source",
					setup(api) {
						api.onLoad({ filter: /spending-preset-performance-worker\.ts$/ }, () => ({
							contents: transformedWorker,
							loader: "ts",
							resolveDir: resolve("scripts/fixtures"),
						}));
						api.onLoad({ filter: /causal-occurrence\/evidence\.ts$/ }, () => ({
							contents: variant === "before" ? before : after,
							loader: "ts",
							resolveDir: resolve("packages/ts/src/solutions/causal-occurrence"),
						}));
					},
				},
			],
		});
		const bytes = b.outputFiles[0].contents;
		writeFileSync(resolve(root, variant + ".mjs"), bytes, { flag: "wx" });
		bundles[variant] = sha(bytes);
		for (const name of Object.keys(b.metafile.inputs)) sources[name] = sha(readFileSync(name));
	}
	const functions = (s) => {
		const f = ts.createSourceFile("x.mjs", s, 99, true, ts.ScriptKind.JS);
		return Object.fromEntries(
			f.statements.filter(ts.isFunctionDeclaration).map((n) => [n.name.text, n.getText(f)]),
		);
	};
	const a = functions(readFileSync(resolve(root, "before.mjs"), "utf8")),
		b = functions(readFileSync(resolve(root, "after.mjs"), "utf8"));
	assert.deepEqual(Object.keys(a), Object.keys(b));
	assert.deepEqual(
		Object.keys(a).filter((k) => a[k] !== b[k]),
		["emitCoverage"],
	);
	for (const name of Object.keys(sources)) {
		const path = resolve(root, "source", name);
		mkdirSync(resolve(path, ".."), { recursive: true });
		writeFileSync(path, readFileSync(name));
	}
	writeFileSync(resolve(root, "evidence-before.ts"), before);
	writeFileSync(resolve(root, "tool.mjs"), readFileSync(new URL(import.meta.url)));
	const inputs = {};
	for (const p of ["P1", "P6"]) {
		const bytes = readFileSync(`latency-inputs/${p}-inputs.json`);
		writeFileSync(resolve(root, `${p}-inputs.json`), bytes);
		inputs[p] = sha(bytes);
	}
	const jobs = [];
	for (const profile of ["P1", "P6"])
		for (const recipe of ["initial", "verification", "sparse", "missing-material"])
			for (let repeat = 0; repeat < 3; repeat++)
				jobs.push({
					id: jobs.length,
					profile,
					recipe,
					repeat,
					order: repeat % 2 ? ["after", "before"] : ["before", "after"],
				});
	put("freeze.json", {
		scope: "fixed-action optimization diagnostic, no formal qualification",
		adapter: sha(adapter),
		transformedWorker: sha(transformedWorker),
		esbuildVersion,
		typescriptVersion: ts.version,
		sources,
		bundles,
		inputs,
		tool: sha(readFileSync(new URL(import.meta.url))),
		beforeSource: sha(before),
		afterSource: sha(after),
		jobs,
		warmup: 1,
		measured: 3,
		childSeconds: 120,
		totalSeconds: 900,
	});
	console.log("PREPARED", jobs.length);
} else {
	assert.equal(mode, "run");
	const f = read("freeze.json");
	const job = f.jobs[Number(jobArg)];
	assert.equal(job.id, Number(jobArg));
	assert.equal(sha(readFileSync(new URL(import.meta.url))), f.tool);
	const input = read(`${job.profile}-inputs.json`);
	assert.equal(
		sha(readFileSync(resolve(root, `${job.profile}-inputs.json`))),
		f.inputs[job.profile],
	);
	const records = [];
	let expected;
	let expectedTrace;
	for (const variant of job.order) {
		assert.equal(sha(readFileSync(resolve(root, variant + ".mjs"))), f.bundles[variant]);
		const worker = await import(pathToFileURL(resolve(root, variant + ".mjs")).href);
		assert.equal(
			worker.preflight(
				{ id: `cold-${job.profile}-off`, group: "cold", profile: job.profile, mode: "off" },
				input,
			).passed,
			true,
		);
		const samples = [];
		for (let i = -1; i < 4; i++) {
			const run = worker.measurementArm("candidate", "off");
			const trace = [];
			const stops = [];
			try {
				let action;
				if (job.recipe === "initial") action = input.steps;
				else if (job.recipe === "verification") {
					for (const step of input.steps) if (step.lane !== "verification") run.send(step);
					action = input.steps.filter((s) => s.lane === "verification");
				} else if (job.recipe === "sparse") {
					for (const step of input.steps) if (step.lane !== "arrivals") run.send(step);
					action = [
						{
							lane: "arrivals",
							values: [
								{ ...input.arrivals, evaluationRefs: [input.arrivals.evaluationRefs.at(-1)] },
							],
						},
					];
				} else {
					for (const step of input.steps) run.send(step);
					const material = run.graph.find("spending/materialStore");
					assert.ok(material);
					material.down([["DATA", { ...material.cache, rows: [], valid: false }]]);
					assert.equal(material.cache.valid, false);
					assert.equal(run.graph.find("spending/evaluationSelections").cache.valid, true);
					action = input.steps.filter((s) => s.lane === "verification");
				}
				assert.ok(action.length);
				if (i === -1)
					for (const name of ["spending/evidence", "spending/causal/authority"])
						stops.push(
							run.graph.find(name).subscribe((m) => {
								if (m[0] === "DATA") trace.push([name, structuredClone(m[1])]);
							}),
						);
				const begin = performance.now();
				for (const step of action) run.send(step);
				const elapsed = performance.now() - begin;
				const state = structuredClone(run.state());
				if (i === -1) {
					if (job.recipe === "missing-material")
						assert.equal(
							trace.filter(
								([name, value]) =>
									name === "spending/evidence" && value.evidenceKind === "spending-verification",
							).length,
							0,
							"missing material defers verification",
						);
					if (expected !== undefined) {
						assert.deepEqual(state, expected, "holdout state parity");
						assert.deepEqual(trace, expectedTrace, "holdout exact action facts");
					} else {
						expected = state;
						expectedTrace = trace;
					}
				} else {
					assert.deepEqual(state, expected, "timed state parity");
					if (i > 0) samples.push(elapsed);
				}
			} finally {
				for (const stop of stops) stop();
				run.cleanup();
			}
		}
		records.push({ variant, samples });
	}
	put(`job-${job.id}.json`, {
		job,
		records,
		pid: process.pid,
		timeOrigin: performance.timeOrigin,
		preflights: 2,
		actionTraceCompared: true,
		stateComparison: true,
		formalQualification: false,
	});
	console.log("DONE", job.id);
}
