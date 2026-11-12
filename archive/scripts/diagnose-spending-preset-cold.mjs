/** Private diagnosis only. Instrument generated bundles; never edit consumer or qualification sources. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import inspector from "node:inspector";
import { relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import ts from "typescript";

const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const put = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1];
export function instrumentShell(source) {
	const file = ts.createSourceFile(
		"shell.ts",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const fn = file.statements.find(
		(s) => ts.isFunctionDeclaration(s) && s.name?.text === "graphArm",
	);
	assert.ok(fn?.body, "exact graphArm declaration required");
	const labels = [],
		edits = [];
	for (const statement of fn.body.statements) {
		// Function declarations have no runtime work at this location.
		if (ts.isFunctionDeclaration(statement)) continue;
		const text = statement.getText(file);
		let label;
		if (text.startsWith("const graph =")) label = "graph-and-sources";
		else if (text.startsWith("const names =")) label = "names";
		else if (text.startsWith("const scope =")) label = "prepare-and-startup-source";
		else if (ts.isTryStatement(statement)) label = "consumer-builder";
		else if (text.startsWith("const owner =")) label = "seal";
		else if (text.startsWith("scope.transferToGraph(")) label = "transfer";
		else if (text.startsWith("startConstruction(")) label = "start";
		else if (text.startsWith("const latest:")) label = "observer-setup";
		else if (text === "connect();") label = "subscribe";
		else if (ts.isReturnStatement(statement)) label = "return-shell";
		if (label) {
			labels.push(label);
			edits.push({
				at: statement.getStart(file),
				text: `globalThis.__spendingColdMark(${JSON.stringify(label)});\n`,
			});
		}
	}
	assert.deepEqual(labels, [
		"graph-and-sources",
		"names",
		"prepare-and-startup-source",
		"consumer-builder",
		"seal",
		"transfer",
		"start",
		"observer-setup",
		"subscribe",
		"return-shell",
	]);
	for (const edit of edits.sort((a, b) => b.at - a.at))
		source = source.slice(0, edit.at) + edit.text + source.slice(edit.at);
	return { source, labels };
}
async function child(config) {
	const { bundle, output, mode, kind, arm } = config;
	const mod = await import(pathToFileURL(bundle).href);
	const scenario = JSON.parse(readFileSync(config.fixture, "utf8"));
	let marks = [];
	globalThis.__spendingColdMark = (label) => marks.push({ label, at: performance.now() });
	const row = { id: `diagnostic-P2-${mode}`, group: "cold", profile: "P2", mode };
	put(`${output}/preflight.json`, mod.preflight(row, scenario));
	if (kind === "stages") {
		const samples = [];
		for (let batch = 0; batch < config.orders.length; batch++)
			for (const arm of config.orders[batch]) {
				for (let i = 0; i < config.warmup + config.measured; i++) {
					marks = [];
					let run;
					const start = performance.now();
					try {
						run = mod.graphArm(arm, mode);
						const end = performance.now();
						marks.push({ label: "end", at: end });
						const stages = marks
							.slice(0, -1)
							.map((m, j) => ({ label: m.label, ms: marks[j + 1].at - m.at }));
						assert.equal(stages.length, 10);
						const sample = {
							batch,
							arm,
							index: i,
							phase: i < config.warmup ? "warmup" : "measured",
							start,
							end,
							ms: end - start,
							stages,
						};
						samples.push(sample);
						appendFileSync(`${output}/samples.jsonl`, `${JSON.stringify(sample)}\n`);
					} finally {
						run?.cleanup();
					}
				}
			}
		put(`${output}/samples.json`, samples);
		const summary = {};
		for (const arm of ["candidate", "reference"]) {
			const rows = samples.filter((s) => s.arm === arm && s.phase === "measured");
			summary[arm] = {
				meanMs: rows.reduce((n, s) => n + s.ms, 0) / rows.length,
				p50Ms: quantile(
					rows.map((s) => s.ms),
					0.5,
				),
				p95Ms: quantile(
					rows.map((s) => s.ms),
					0.95,
				),
				stages: Object.fromEntries(
					rows[0].stages.map(({ label }, index) => {
						const values = rows.map((s) => s.stages[index].ms);
						return [
							label,
							{
								meanMs: values.reduce((a, b) => a + b, 0) / values.length,
								p50Ms: quantile(values, 0.5),
								p95Ms: quantile(values, 0.95),
							},
						];
					}),
				),
			};
		}
		put(`${output}/summary.json`, summary);
	} else {
		// Unmodified source bundle; only sampling profiler and outer instance interval clocks.
		const session = new inspector.Session();
		session.connect();
		const post = (method, params = {}) =>
			new Promise((ok, no) => session.post(method, params, (e, r) => (e ? no(e) : ok(r))));
		const intervals = [];
		let active = false,
			failure;
		try {
			for (let i = 0; i < config.warmup; i++) {
				const run = mod.graphArm(arm, mode);
				run.cleanup();
			}
			await post("Profiler.enable");
			await post("Profiler.setSamplingInterval", { interval: config.samplingUs });
			await post("Profiler.start");
			active = true;
			for (let i = 0; i < config.measured; i++) {
				let run;
				const start = Number(process.hrtime.bigint() / 1000n);
				try {
					run = mod.graphArm(arm, mode);
					const interval = { start, end: Number(process.hrtime.bigint() / 1000n) };
					intervals.push(interval);
					appendFileSync(`${output}/intervals.jsonl`, `${JSON.stringify(interval)}\n`);
				} finally {
					run?.cleanup();
				}
			}
		} catch (error) {
			failure = error;
		} finally {
			try {
				if (active) {
					const { profile } = await post("Profiler.stop");
					put(`${output}/cpu.cpuprofile`, profile);
					put(`${output}/intervals.json`, intervals);
					put(`${output}/profile-scope.json`, {
						partial: failure !== undefined,
						constructionAttribution:
							"JS sample stacks containing graphArm; excludes cleanup stacks; native/GC samples without graphArm remain unattributed",
						intervalClock:
							"raw hrtime microseconds; no clock-alignment claim and no time-based profile filtering",
					});
				}
			} catch (stopError) {
				failure = new AggregateError(
					failure ? [failure, stopError] : [stopError],
					"profiler stop failure",
				);
			} finally {
				session.disconnect();
			}
		}
		if (failure !== undefined) throw failure;
	}
	delete globalThis.__spendingColdMark;
	put(`${output}/completion.json`, {
		completed: true,
		qualification: false,
		kind,
		mode,
		arm: arm ?? null,
	});
	console.log("COLD_DIAGNOSTIC_CHILD_DONE", kind, mode, arm ?? "paired");
}
async function main(output) {
	assert.ok(output && !existsSync(output), "fresh output directory required");
	mkdirSync(output, { recursive: true });
	const receiptPath =
		"packages/ts/qualification/causal-occurrence/preset-performance-v1/receipt.json";
	const prior = JSON.parse(readFileSync(receiptPath, "utf8"));
	for (const [path, digest] of Object.entries(prior.sourceBindings))
		assert.equal(hash(readFileSync(path)), digest, `frozen source drift ${path}`);
	assert.equal(hash(readFileSync(prior.rawEvidence.path)), prior.rawEvidence.digest);
	const indexBytes = readFileSync(prior.rawEvidence.indexPath);
	assert.equal(hash(indexBytes), prior.rawEvidence.indexDigest);
	const index = JSON.parse(indexBytes),
		fixtureName = "attempt-01/P2-inputs.json";
	const fixtureBytes = execFileSync("tar", ["-xOf", prior.rawEvidence.path, fixtureName], {
		maxBuffer: 16 * 1024 * 1024,
	});
	assert.equal(hash(fixtureBytes), index.files[fixtureName]);
	writeFileSync(`${output}/P2-inputs.json`, fixtureBytes);
	const entry =
		'export {graphArm} from "./scripts/fixtures/spending-preset-performance.ts"; export {preflight} from "./scripts/fixtures/spending-preset-performance-worker.ts";';
	const bindings = {},
		snapshots = new Map();
	let labels = [];
	for (const instrumented of [false, true]) {
		const result = await build({
			stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" },
			bundle: true,
			format: "esm",
			platform: "node",
			write: false,
			metafile: true,
			sourcemap: "inline",
			plugins: [
				{
					name: "verified-snapshot-and-diagnostic-marks",
					setup(build) {
						build.onLoad({ filter: /\.(ts|js|mjs|json)$/ }, (args) => {
							const path = relative(process.cwd(), args.path);
							let contents = snapshots.get(path);
							if (contents === undefined) {
								contents = readFileSync(args.path, "utf8");
								assert.ok(prior.sourceBindings[path], `unbound source ${path}`);
								assert.equal(
									hash(contents),
									prior.sourceBindings[path],
									`source drift at load ${path}`,
								);
								snapshots.set(path, contents);
								bindings[path] = hash(contents);
							}
							if (instrumented && path === "scripts/fixtures/spending-preset-performance.ts") {
								const result = instrumentShell(contents);
								labels = result.labels;
								contents = result.source;
							}
							return {
								contents,
								loader: path.endsWith(".ts") ? "ts" : path.endsWith(".json") ? "json" : "js",
							};
						});
					},
				},
			],
		});
		const name = instrumented ? "stages" : "unmodified";
		writeFileSync(`${output}/${name}.mjs`, result.outputFiles[0].contents);
		put(`${output}/${name}-metafile.json`, result.metafile);
		for (const path of Object.keys(result.metafile.inputs).filter((p) => p !== "<stdin>"))
			assert.equal(hash(readFileSync(path)), bindings[path], `post-build source drift ${path}`);
	}
	bindings["scripts/diagnose-spending-preset-cold.mjs"] = hash(
		readFileSync("scripts/diagnose-spending-preset-cold.mjs"),
	);
	const jobs = [];
	for (const mode of ["off", "summary"])
		jobs.push({
			kind: "stages",
			mode,
			warmup: 100,
			measured: 300,
			orders: [
				["candidate", "reference"],
				["reference", "candidate"],
				["candidate", "reference"],
			],
		});
	for (const [batch, arms] of [
		[0, ["candidate", "reference"]],
		[1, ["reference", "candidate"]],
	])
		for (const arm of arms)
			jobs.push({
				kind: "profile",
				mode: "summary",
				arm,
				batch,
				warmup: 500,
				measured: 3000,
				samplingUs: 100,
			});
	put(`${output}/freeze.json`, {
		kind: "private-cold-diagnosis",
		qualification: false,
		priorReceipt: hash(readFileSync(receiptPath)),
		priorFormalResultUnchanged: true,
		jobs,
		labels,
		sourceBindings: bindings,
		bundles: Object.fromEntries(
			["stages", "unmodified"].map((n) => [n, hash(readFileSync(`${output}/${n}.mjs`))]),
		),
		node: process.version,
		platform: process.platform,
		arch: process.arch,
		jobTimeoutMs: 120000,
		noThresholdEvaluation: true,
		scope:
			"phase instrumentation and sampling only; no consumer/source mutation, ablation or qualification rerun",
	});
	for (const [i, job] of jobs.entries()) {
		const dir = `${output}/job-${i}-${job.kind}-${job.mode}-${job.arm ?? "paired"}`;
		mkdirSync(dir);
		const config = {
			...job,
			output: dir,
			bundle: `${output}/${job.kind === "stages" ? "stages" : "unmodified"}.mjs`,
			fixture: `${output}/P2-inputs.json`,
		};
		put(`${dir}/config.json`, config);
		const result = spawnSync(
			process.execPath,
			[fileURLToPath(import.meta.url), "--child", `${dir}/config.json`],
			{ timeout: 120000, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" },
		);
		writeFileSync(`${dir}/process.txt`, `${result.stdout ?? ""}${result.stderr ?? ""}`);
		put(`${dir}/process.json`, {
			exitCode: result.status,
			signal: result.signal,
			error: result.error?.message ?? null,
		});
		assert.equal(result.status, 0, `diagnostic job ${i} failed; preserved ${dir}`);
		console.log("COLD_DIAGNOSTIC_JOB_DONE", i, job.kind, job.arm ?? job.mode);
	}
	put(`${output}/completion.json`, { completed: true, qualification: false, jobs: jobs.length });
	console.log("COLD_DIAGNOSTIC_DONE");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv[2] === "--child") await child(JSON.parse(readFileSync(process.argv[3], "utf8")));
	else await main(process.argv[2] && resolve(process.argv[2]));
}
