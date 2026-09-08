/** D163 isolated runtime mutation qualification; structural checks are counted separately. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const i = process.argv.indexOf("--output");
assert.ok(i >= 0 && process.argv[i + 1], "fresh --output required");
const output = resolve(process.argv[i + 1]);
assert.equal(existsSync(output), false);
const src = join(root, "packages/ts/src"),
	temp = mkdtempSync(join(tmpdir(), "committed-mutations-"));
const names = ["construction", "committed-view", "transition", "lifecycle"];
const files = Object.fromEntries(
	names.map((n) => [n, readFileSync(join(src, `solutions/causal-occurrence/${n}.ts`), "utf8")]),
);
const test = readFileSync(join(src, "__tests__/causal-committed-view.d163.test.ts"), "utf8");
const digest = (s) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
const escaped = (s) =>
	s
		.trim()
		.split(/\s+/u)
		.map((x) => x.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
		.join("\\s+");
const replace = (text, from, to) => {
	const re = new RegExp(escaped(from), "gu");
	assert.equal([...text.matchAll(re)].length, 1, from);
	return text.replace(re, () => to);
};
const mutation = (id, file, from, to, pattern = "", kind = "runtime-output") => ({
	id,
	file,
	from,
	to,
	pattern,
	kind,
});
const markers = [
	mutation(
		"proposal-marker",
		"lifecycle",
		"state.effects.set(key, { proposal, key: dataKey(proposal) }); context.committedViewChanged = true;",
		"state.effects.set(key, { proposal, key: dataKey(proposal) });",
		"rebuilds on every direct",
	),
	mutation(
		"direct-admission-marker",
		"lifecycle",
		"state.effects.set(key, { ...record, admission: canonical.snapshot }); context.committedViewChanged = true;",
		"state.effects.set(key, { ...record, admission: canonical.snapshot });",
		"rebuilds on every direct",
	),
	mutation(
		"direct-outcome-marker",
		"lifecycle",
		"state.effects.set(key, { ...record, outcome: canonical.snapshot }); context.committedViewChanged = true;",
		"state.effects.set(key, { ...record, outcome: canonical.snapshot });",
		"rebuilds on every direct",
	),
	mutation(
		"reuse-stale-view",
		"committed-view",
		"if (!changed && (state.committedEffects !== undefined || !hasFacts))",
		"if (state.committedEffects !== undefined || !hasFacts)",
		"rebuilds on every direct",
	),
	mutation(
		"rebuild-replay",
		"committed-view",
		"if (!changed && (state.committedEffects !== undefined || !hasFacts))",
		"if (!hasFacts && !changed)",
		"rebuilds on every direct",
		"work-count",
	),
	mutation(
		"mutable-array",
		"committed-view",
		"const effects = Object.freeze( Array.from(state.effects.values(), (record) => Object.freeze({ proposal: record.proposal, ...(record.admission === undefined ? {} : { admission: record.admission }), ...(record.outcome === undefined ? {} : { outcome: record.outcome }), }), ), );",
		"const effects = Array.from(state.effects.values(), record => Object.freeze({proposal:record.proposal,...(record.admission === undefined ? {} : {admission:record.admission}),...(record.outcome === undefined ? {} : {outcome:record.outcome})}));",
		"does not mutate old views",
		"immutability",
	),
	mutation(
		"expose-mutable-record",
		"committed-view",
		"Object.freeze({ proposal: record.proposal, ...(record.admission === undefined ? {} : { admission: record.admission }), ...(record.outcome === undefined ? {} : { outcome: record.outcome }), })",
		"record",
		"does not mutate old views",
		"immutability",
	),
	mutation(
		"last-kind-only",
		"construction",
		"committedEffects: committedEffects!,",
		"committedEffects: output.kind === 'conservation' ? committedEffects! : undefined,",
		"late subscriber recovers",
	),
	mutation(
		"invalidation-reset-lost",
		"construction",
		"slot.view = undefined;",
		"void slot;",
		"after INVALIDATE",
	),
	mutation(
		"drop-retention",
		"committed-view",
		"...state.retentionFloorByDomain.keys(), ...state.retentionGapThroughByDomain.keys(),",
		"",
		"updates legal eviction",
	),
];
// Locate the one field in the fact envelope; the view-change field is intentionally separate.
markers.find((m) => m.id === "last-kind-only").from =
	"fact: Object.freeze(output), committedEffects: committedEffects!,";
markers.find((m) => m.id === "last-kind-only").to =
	'fact: Object.freeze(output), committedEffects: output.kind === "conservation" ? committedEffects! : undefined,';
cpSync(src, join(temp, "src"), { recursive: true });
symlinkSync(join(root, "node_modules"), join(temp, "node_modules"), "dir");
writeFileSync(join(temp, "package.json"), '{"type":"module"}');
const config = join(temp, "vitest.config.mts");
writeFileSync(
	config,
	`export default {define:{__GRAPHREFLY_TS_PACKAGE_REVISION__:'"graphrefly-ts:0.9.0"'},test:{include:['src/__tests__/causal-committed-view.d163.test.ts']}};`,
);
const report = {
	schema: "graphrefly-ts/causal-committed-view-mutations/v1",
	runnerDigest: digest(readFileSync(fileURLToPath(import.meta.url))),
	source: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, digest(v)])),
	testDigest: digest(test),
	baseline: [],
	mutations: [],
	structural: [],
	complete: false,
};
function run(id, changes, pattern = "", kind = "baseline") {
	for (const [name, text] of Object.entries(files))
		writeFileSync(join(temp, `src/solutions/causal-occurrence/${name}.ts`), changes[name] ?? text);
	const path = join(temp, "result.json");
	rmSync(path, { force: true });
	const child = spawnSync(
		process.execPath,
		[
			join(root, "node_modules/vitest/vitest.mjs"),
			"run",
			"--root",
			temp,
			"--config",
			config,
			"--testNamePattern",
			pattern || ".",
			"--reporter=json",
			`--outputFile=${path}`,
		],
		{ cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
	);
	assert.ifError(child.error);
	assert.equal(child.signal, null);
	assert.ok(existsSync(path), child.stderr);
	const result = JSON.parse(readFileSync(path, "utf8"));
	assert.equal(result.numRuntimeErrorTestSuites ?? 0, 0);
	assert.equal(result.unhandledErrors?.length ?? 0, 0);
	const checks = result.testResults
		.flatMap((x) => x.assertionResults)
		.filter((x) => ["passed", "failed"].includes(x.status));
	assert.ok(checks.length > 0);
	const failed = checks.filter((x) => x.status === "failed");
	if (kind === "baseline") assert.equal(child.status, 0, JSON.stringify(failed));
	else {
		assert.equal(child.status, 1, id + ": survived");
		assert.ok(failed.length > 0);
		for (const f of failed)
			assert.match(
				f.failureMessages.join("\n"),
				/AssertionError/u,
				id + ": not assertion-detected",
			);
	}
	const record = {
		id,
		kind,
		executed: checks.length,
		failed: failed.map((x) => ({
			name: x.fullName,
			reason: x.failureMessages.join("\n").split("\n")[0],
		})),
		outcome: kind === "baseline" ? "passed" : "killed",
		changed: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, digest(v)])),
	};
	console.log(id, record.outcome);
	return record;
}
try {
	report.baseline.push(run("unchanged", {}));
	const bypass = replace(
		files.construction,
		"assertCausalOccurrenceTopology(graph.readIncoming(), opts.name);",
		"/* bypass for isolated dependency probe */",
	);
	report.baseline.push(run("topology-bypass-only", { construction: bypass }));
	for (const m of markers)
		report.mutations.push(
			run(m.id, { [m.file]: replace(files[m.file], m.from, m.to) }, m.pattern, m.kind),
		);
	const cut = replace(
		bypass,
		"const committedEffects = graph.node<CommittedEffectsView>( [authority],",
		"const committedEffects = graph.node<CommittedEffectsView>( [],",
	);
	report.mutations.push(
		run(
			"actual-authority-view-edge-cut",
			{ construction: cut },
			"recovers exact records",
			"runtime-output",
		),
	);
	// Deferred writes co-occur with another marked accepted write in these reachable traces.
	// Keep their adjacency audit separate; do not manufacture a runtime business kill.
	for (const fragment of ["admission", "outcome"]) {
		const anchor = `state.effects.set(key, { ...record, ${fragment} }); context.committedViewChanged = true;`;
		assert.equal([...files.lifecycle.matchAll(new RegExp(escaped(anchor), "gu"))].length, 1);
		report.structural.push({
			id: `deferred-${fragment}-marker`,
			passed: true,
			meaning:
				"write-site adjacency audit; redundant within currently exercised commits, not a runtime mutation kill",
		});
	}
	report.complete = true;
} finally {
	rmSync(temp, { recursive: true, force: true });
	for (const [name, text] of Object.entries(files))
		assert.equal(readFileSync(join(src, `solutions/causal-occurrence/${name}.ts`), "utf8"), text);
	writeFileSync(
		output,
		JSON.stringify(
			{ ...report, cleanup: { temporaryRemoved: !existsSync(temp), childrenExited: true } },
			null,
			2,
		) + "\n",
	);
	console.log("COMMITTED_MUTATIONS_DONE", report.complete);
}
