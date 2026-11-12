/** D171 offline preparation only. This launcher has no real-inbox execution mode. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, version as esbuildVersion } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
assert.equal(process.argv.length, 2, "No execution flags accepted: preparation is memory-only");
const base = join(root, "archive/evals/causal-host-proof-preparation");
const attempt = join(base, `attempt-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(attempt, { recursive: true });
const sha = (v) => createHash("sha256").update(v).digest("hex");
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
assert.equal(git.status, 0);
const context = {
	baseline: git.stdout.trim(),
	node: process.version,
	nodeExecutable: process.execPath,
	nodeExecutableSha256: sha(readFileSync(process.execPath)),
	platform: process.platform,
	arch: process.arch,
	esbuildVersion,
	lockSha256: sha(readFileSync(join(root, "pnpm-lock.yaml"))),
	launcherSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
};
const worker = "scripts/fixtures/spending-proof-worker.ts";
const plainNumeric = "scripts/fixtures/spending-numeric-plain.ts";
const bundleReports = [];
async function bundle(label, entryPoints, mutations = []) {
	const replacements = Array.isArray(mutations) ? mutations : [mutations];
	for (const edit of replacements)
		assert.ok(!/oracle|verifier/.test(edit.path), "Never mutate verifier dependencies");
	const outfile = join(attempt, `${label}.mjs`),
		loaded = new Map(),
		edits = [];
	const result = await build({
		absWorkingDir: root,
		entryPoints,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node22",
		outfile,
		metafile: true,
		sourcemap: true,
		write: true,
		plugins: [
			{
				name: "actual-source-mutation",
				setup(b) {
					b.onLoad({ filter: /\.[cm]?[jt]s$/ }, (args) => {
						const raw = readFileSync(args.path, "utf8"),
							path = relative(root, args.path);
						let contents = raw;
						for (const mutation of replacements.filter((m) => m.path === path)) {
							assert.equal(contents.split(mutation.from).length - 1, 1, `unique mutation ${path}`);
							contents = contents.replace(mutation.from, mutation.to);
							edits.push({
								path,
								from: mutation.from,
								to: mutation.to,
								rawSha256: sha(raw),
								loadedSha256: sha(contents),
								attribution: "agent-authored isolated build transform; not a human edit",
							});
						}
						loaded.set(path, { rawSha256: sha(raw), loadedSha256: sha(contents) });
						return { contents, loader: args.path.endsWith(".ts") ? "ts" : "js" };
					});
				},
			},
		],
	});
	assert.equal(
		edits.length,
		replacements.length,
		"Every mutation must occur in actual build closure",
	);
	const inputs = Object.keys(result.metafile.inputs)
		.sort()
		.map((path) => ({
			path,
			...(loaded.get(path) ?? {
				rawSha256: sha(readFileSync(resolve(root, path))),
				loadedSha256: sha(readFileSync(resolve(root, path))),
			}),
		}));
	const report = {
		label,
		outfile: relative(root, outfile),
		sourceDigest: `sha256:${sha(JSON.stringify(inputs))}`,
		runtimeDigest: `sha256:${sha(readFileSync(outfile))}`,
		sourcemapSha256: sha(readFileSync(outfile + ".map")),
		inputs,
		edits,
		context,
	};
	json(join(attempt, `${label}.metafile.json`), result.metafile);
	json(join(attempt, `${label}.binding.json`), report);
	bundleReports.push(report);
	return report;
}
const summary = {
	kind: "offline-preparation",
	realInboxIO: 0,
	formalQualification: false,
	attempt: relative(root, attempt),
	context,
	bundles: bundleReports,
	runs: [],
	failures: [],
};
try {
	const scenariosBundle = await bundle("frozen-scenarios", [
		"scripts/fixtures/spending-proof-scenarios.ts",
	]);
	const { proofScenarios, proofMutationTargets } = await import(
		pathToFileURL(resolve(root, scenariosBundle.outfile)).href
	);
	const verifierBundle = await bundle("frozen-verifier", [
		"scripts/fixtures/spending-proof-verifier.ts",
	]);
	const verifierAllowlist = new Set([
		"scripts/fixtures/spending-proof-verifier.ts",
		"scripts/fixtures/spending-numeric-oracle.ts",
	]);
	assert.ok(
		verifierBundle.inputs.every((input) => verifierAllowlist.has(input.path)),
		"Independent verifier closure changed; inspect before allowing",
	);
	const { verifyProofTrace } = await import(
		pathToFileURL(resolve(root, verifierBundle.outfile)).href
	);
	summary.verifier = verifierBundle;
	const baseline = await bundle("baseline", [worker]);
	const variants = {
		none: { graph: baseline, plain: baseline },
		"cli-title": { graph: baseline, plain: baseline },
	};
	for (const kind of Object.keys(proofMutationTargets).filter((kind) => kind !== "cli-title")) {
		variants[kind] = {};
		for (const arm of ["graph", "plain"]) {
			const target = proofMutationTargets[kind];
			const mutation =
				target.arms?.[arm] ??
				(arm === "graph"
					? target
					: {
							path: plainNumeric,
							from: "delta * delta * (n - 1n)",
							to:
								kind === "sample-to-population"
									? "delta * delta * n"
									: "delta * delta * n - delta * delta",
						});
			assert.ok(
				target.arms || ["sample-to-population", "equivalent-score"].includes(kind),
				"Every added mutation needs explicit per-arm targets",
			);
			variants[kind][arm] = await bundle(`${kind}-${arm}`, [worker], mutation);
		}
	}
	const cli = proofMutationTargets["cli-title"],
		raw = readFileSync(join(root, cli.path), "utf8");
	assert.equal(raw.split(cli.from).length - 1, 1, "Unique CLI title edit");
	const changed = raw.replace(cli.from, cli.to);
	writeFileSync(join(attempt, "cli-title.before.ts"), raw);
	writeFileSync(join(attempt, "cli-title.after.ts"), changed);
	summary.cliTitle = {
		...cli,
		beforeSha256: sha(raw),
		afterSha256: sha(changed),
		executingClosureContainsFile: baseline.inputs.some((x) => x.path === cli.path),
		attribution:
			"agent-authored retained isolated source edit, not applied to workspace and not a human edit",
	};
	assert.equal(summary.cliTitle.executingClosureContainsFile, false);
	const dummy = {
		packRef: { kind: "offline-pack", id: "proof" },
		sourceDigest: baseline.sourceDigest,
		runtimeDigest: baseline.runtimeDigest,
		destinationRef: { kind: "local-inbox", id: "/unused" },
		compositionEpoch: 1,
		hostEpoch: 1,
		runRef: "proof",
		evidenceMode: "fixture-observations",
	};
	const scenarios = proofScenarios(dummy);
	assert.equal(scenarios.length, 23, "Frozen finite 23-case batch");
	const futureRoot = join(root, "latency-inputs", `proof-${sha(attempt).slice(0, 16)}`);
	assert.equal(existsSync(futureRoot), false);
	const manifest = [];
	for (const scenario of scenarios)
		for (const arm of ["graph", "plain"]) {
			const artifact = variants[scenario.mutation][arm],
				id = `${scenario.id}-${arm}`,
				path = join(futureRoot, `${manifest.length + 1}-${arm}.jsonl`);
			assert.ok(
				Buffer.byteLength(path) <= 128,
				"Destination must satisfy existing bounded reference schema",
			);
			const binding = {
				...dummy,
				sourceDigest: artifact.sourceDigest,
				runtimeDigest: artifact.runtimeDigest,
				packRef: { kind: "offline-pack", id },
				destinationRef: { kind: "local-inbox", id: path },
				runRef: id,
			};
			const config = { arm, caseId: scenario.id, binding, path, mode: "memory" };
			const frozen = proofScenarios(binding).find((s) => s.id === scenario.id);
			json(join(attempt, `${id}.scenario.json`), frozen);
			json(join(attempt, `${id}.config.json`), config);
			const started = Date.now();
			const run = spawnSync(
				process.execPath,
				[resolve(root, artifact.outfile), JSON.stringify(config)],
				{ cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024 },
			);
			writeFileSync(join(attempt, `${id}.stdout.log`), run.stdout ?? "");
			writeFileSync(join(attempt, `${id}.stderr.log`), run.stderr ?? "");
			let report;
			try {
				report = JSON.parse(run.stdout.trim());
			} catch {}
			if (report) json(join(attempt, `${id}.report.json`), report);
			let independentVerdict;
			try {
				assert.ok(
					report && report.caseId === scenario.id && report.arm === arm,
					"Report identity mismatch",
				);
				assert.equal(
					report.mode,
					"in-memory-local-file-proof",
					"Preparation must use injected memory transport",
				);
				const expectedTransports = frozen.steps
					.filter((step) => step.kind === "settle" && step.result !== "reject")
					.map((step) => ({
						call: step.call,
						bytes:
							step.result === "short"
								? 1
								: Buffer.byteLength(report.trace.attemptedPayloads[step.call]),
					}));
				assert.deepEqual(
					report.transportAttempts,
					expectedTransports,
					"Underlying transport events must match frozen settlement schedule",
				);
				assert.ok(report.transportAttempts.length <= 64);
				for (const call of report.transportAttempts) assert.ok(call.bytes <= 4096);
				for (const bytes of [report.readback.before, report.readback.after])
					assert.ok(
						Array.isArray(bytes) && bytes.every((x) => Number.isInteger(x) && x >= 0 && x <= 255),
						"Malformed readback bytes",
					);
				independentVerdict = verifyProofTrace(
					frozen.evaluations,
					binding,
					frozen.expected,
					report.trace,
					{
						before: Uint8Array.from(report.readback.before),
						after: Uint8Array.from(report.readback.after),
					},
				);
			} catch (error) {
				independentVerdict = { passed: false, errors: [String(error)] };
			}
			json(join(attempt, `${id}.independent-verdict.json`), independentVerdict);
			const passed = run.status === 0 && independentVerdict.passed === true;
			summary.runs.push({
				id,
				caseId: scenario.id,
				arm,
				mutation: scenario.mutation,
				passed,
				status: run.status,
				signal: run.signal,
				error: run.error?.message,
				elapsedMs: Date.now() - started,
				sourceDigest: artifact.sourceDigest,
				runtimeDigest: artifact.runtimeDigest,
				lockSha256: context.lockSha256,
				node: context.node,
				configSha256: sha(JSON.stringify(config)),
				reportSha256: report ? sha(JSON.stringify(report)) : null,
				independentVerdict,
				verifierRuntimeDigest: verifierBundle.runtimeDigest,
				verifierSourceDigest: verifierBundle.sourceDigest,
			});
			if (!passed)
				summary.failures.push({
					id,
					classification: run.error
						? "execution-error"
						: report
							? "verifier-rejection"
							: "worker-failure",
					detail: independentVerdict,
					workerVerdict: report?.verdict ?? run.stderr,
				});
			manifest.push({
				id,
				caseId: scenario.id,
				arm,
				path,
				binding,
				bundle: artifact.outfile,
				sourceBindingPath: artifact.outfile.replace(/\.mjs$/, ".binding.json"),
				bundleSha256: artifact.runtimeDigest,
				verifier: {
					bundle: verifierBundle.outfile,
					sha256: verifierBundle.runtimeDigest,
					sourceDigest: verifierBundle.sourceDigest,
				},
				nodeExecutableSha256: context.nodeExecutableSha256,
				sourceDigest: artifact.sourceDigest,
				lockSha256: context.lockSha256,
				node: context.node,
				scenarioSha256: sha(JSON.stringify(frozen)),
				maximumCalls: 64,
				maximumBytes: 64 * 4096,
				maximumWallTimeMs: 30000,
				expectedCalls: frozen.expected.attempts.length,
				scope: frozen.scope,
				mutation: scenario.mutation,
			});
			process.stdout.write(`${id}: ${passed ? "offline passed" : "FAILED"}\n`);
		}
	const graphReports = summary.runs
		.filter((r) => r.arm === "graph" && r.passed)
		.map((r) => ({
			id: r.id,
			topology: JSON.parse(readFileSync(join(attempt, `${r.id}.report.json`), "utf8")).topology,
		}));
	const first = graphReports[0]?.topology;
	summary.topology = {
		compared: graphReports.length,
		exactEqual:
			graphReports.length > 0 &&
			graphReports.every((r) => JSON.stringify(r.topology) === JSON.stringify(first)),
		scope:
			"Stable node IDs/factory names and edges from actual Graph runs; plain has no Graph topology",
	};
	if (!summary.topology.exactEqual) summary.failures.push({ classification: "topology-mismatch" });
	for (const b of bundleReports)
		for (const input of b.inputs)
			assert.equal(
				sha(readFileSync(resolve(root, input.path))),
				input.rawSha256,
				`Source changed during preparation: ${input.path}`,
			);
	assert.equal(
		sha(readFileSync(join(root, cli.path))),
		summary.cliTitle.beforeSha256,
		"CLI source changed during preparation",
	);
	assert.equal(sha(readFileSync(join(root, "pnpm-lock.yaml"))), context.lockSha256);
	assert.equal(sha(readFileSync(fileURLToPath(import.meta.url))), context.launcherSha256);
	const executorPath = "scripts/execute-spending-host-proof.mjs";
	const executorSha256 = sha(readFileSync(join(root, executorPath)));
	summary.executor = { path: executorPath, sha256: executorSha256 };
	json(join(attempt, "source-binding.json"), {
		context,
		executor: summary.executor,
		bundles: bundleReports,
	});
	json(join(attempt, "future-execution-manifest.json"), {
		context,
		executor: summary.executor,
		sourceBindingPath: relative(root, join(attempt, "source-binding.json")),
		preparationSummaryPath: relative(root, join(attempt, "summary.json")),
		verifier: { bundle: verifierBundle.outfile, sha256: verifierBundle.runtimeDigest },
		scenarios: { bundle: scenariosBundle.outfile, sha256: scenariosBundle.runtimeDigest },
		proofFaultInjectionMode:
			"Same frozen held transport schedule in memory and local modes; full/short/reject/unreturned are proof injections, not naturally observed storage failures. Local mode still awaits separate approval.",
		authorized: false,
		executionPerformed: false,
		mode: "local-file-append",
		freshDirectory: futureRoot,
		precondition:
			"Separate explicit approval of this exact manifest; directory absent and every file must be created exclusively empty, bound resource held until case ends.",
		maximumCalls: manifest.length * 64,
		maximumBytes: manifest.length * 64 * 4096,
		maximumWallTimeMs: manifest.length * 30000,
		cleanup:
			"Close owned resources; retain exact per-case files and independent readback receipts for review. No automatic deletion or reuse.",
		boundsScope:
			"Per-request 4096 bytes, lifetime 64 attempts, one in-flight. Pending/unknown remains unresolved; process teardown is not normal end. No fsync/crash durability claim.",
		cases: manifest,
	});
	summary.passed = summary.failures.length === 0;
} catch (error) {
	summary.passed = false;
	summary.failures.push({
		classification: "preparation-failure-not-business-kill",
		message: String(error),
		stack: error.stack,
	});
}
json(join(attempt, "summary.json"), summary);
console.log(
	JSON.stringify({
		attempt: summary.attempt,
		passed: summary.passed,
		runs: summary.runs.length,
		failures: summary.failures.length,
		realInboxIO: 0,
	}),
);
if (!summary.passed) process.exitCode = 1;
