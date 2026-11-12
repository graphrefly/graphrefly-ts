/** Fixed diagnostic before/after experiment; not D168/D169 performance qualification. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
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
	const target = "packages/ts/src/solutions/causal-occurrence/identity.ts";
	const before = execFileSync("git", ["show", `586fa795:${target}`], { encoding: "utf8" });
	const after = readFileSync(target, "utf8");
	assert.notEqual(before, after);
	const entry = "scripts/fixtures/spending-preset-performance-worker.ts";
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
							contents: adaptWorker(readFileSync(entry, "utf8")),
							loader: "ts",
							resolveDir: resolve("scripts/fixtures"),
						}));
						api.onLoad({ filter: /causal-occurrence\/identity\.ts$/ }, () => ({
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
		["recomputeCurrentness"],
	);
	for (const name of Object.keys(sources)) {
		const path = resolve(root, "source", name);
		mkdirSync(resolve(path, ".."), { recursive: true });
		writeFileSync(path, readFileSync(name));
	}
	writeFileSync(resolve(root, "identity-before.ts"), before);
	writeFileSync(resolve(root, "tool.mjs"), readFileSync(new URL(import.meta.url)));
	const inputs = {};
	for (const p of ["P1", "P3", "P4"]) {
		const bytes = readFileSync(
			`archive/evals/causal-coverage-profile-current-v2/run/${p}-inputs.json`,
		);
		writeFileSync(resolve(root, `${p}-inputs.json`), bytes);
		inputs[p] = sha(bytes);
	}
	const jobs = [];
	for (const p of ["P1", "P3", "P4"])
		for (const count of [1, 2])
			for (let repeat = 0; repeat < 3; repeat++)
				jobs.push({
					id: jobs.length,
					profile: p,
					count,
					repeat,
					control: false,
					order: repeat % 2 ? ["after", "before"] : ["before", "after"],
				});
	for (const p of ["P1", "P3", "P4"])
		jobs.push({
			id: jobs.length,
			profile: p,
			count: 2,
			repeat: 0,
			control: true,
			order: ["before", "before"],
		});
	put("freeze.json", {
		scope: "fixed-action optimization diagnostic, no formal qualification",
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
	const row = {
		id: `steady-${job.profile}-off-duplicate-${job.count}`,
		group: "steady",
		profile: job.profile,
		mode: "off",
		change: "duplicate",
		dataCount: job.count,
	};
	const records = [];
	let prior;
	for (let position = 0; position < job.order.length; position++) {
		const variant = job.order[position];
		assert.equal(sha(readFileSync(resolve(root, variant + ".mjs"))), f.bundles[variant]);
		const worker = await import(pathToFileURL(resolve(root, variant + ".mjs")).href);
		assert.equal(worker.preflight(row, input).passed, true);
		const run = worker.measurementArm("candidate", "off");
		try {
			for (const step of input.steps) run.send(step);
			const baseline = structuredClone(run.state());
			if (prior !== undefined) assert.deepEqual(baseline, prior, "before/after retained state");
			prior = baseline;
			const step = {
				lane: "arrivals",
				values: Array.from({ length: job.count }, () => ({
					...input.arrivals,
					evaluationRefs: input.arrivals.evaluationRefs,
				})),
			};
			for (let i = 0; i < f.warmup; i++) run.send(step);
			const samples = [];
			for (let i = 0; i < f.measured; i++) {
				const start = performance.now();
				run.send(step);
				samples.push(performance.now() - start);
				assert.deepEqual(run.state(), baseline, "duplicate state unchanged");
			}
			records.push({ variant, position, samples });
		} finally {
			run.cleanup();
		}
	}
	put(`job-${job.id}.json`, {
		job,
		records,
		pid: process.pid,
		timeOrigin: performance.timeOrigin,
		preflights: 2,
		stateComparison: true,
		formalQualification: false,
	});
	console.log("DONE", job.id);
}
