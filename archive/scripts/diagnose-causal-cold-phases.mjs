/** Bounded construction diagnostics; no CSP-11 evaluation or replacement qualification. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const index = process.argv.indexOf("--output-dir");
assert.ok(index >= 0 && process.argv[index + 1], "fresh --output-dir required");
const out = resolve(process.argv[index + 1]);
assert.equal(existsSync(out), false, "preserve previous attempts");
mkdirSync(out, { recursive: true });
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const read = (path) => readFileSync(resolve(root, path), "utf8");
const put = (name, value) => writeFileSync(join(out, name), `${JSON.stringify(value, null, 2)}\n`);
const paths = {
	"packages/ts/src/solutions/causal-occurrence.ts": ["buildCausalComposition"],
	"packages/ts/src/solutions/causal-occurrence/construction.ts": [
		"prepareCausalOptions",
		"causalColdNodeNames",
		"buildCausalNodes",
		"assertCausalOccurrenceTopology",
		"causalOccurrenceRequiredEdges",
	],
	"packages/ts/src/graph/construction-scope.ts": [
		"prepareConstruction",
		"readIncoming",
		"seal",
		"transferToGraph",
		"startConstruction",
	],
};
const harnessPaths = [
	fileURLToPath(import.meta.url),
	"scripts/compare-causal-authority.mjs",
	"scripts/compare-causal-construction.mjs",
];
const before = Object.fromEntries(harnessPaths.map((p) => [p, digest(read(p))]));
const fixtureText = read("scripts/compare-causal-authority.mjs");
const fixture = fixtureText.slice(
	fixtureText.indexOf("const lanes ="),
	fixtureText.indexOf("function graphRun(make, scenario)"),
);
const original = read("scripts/compare-causal-construction.mjs");
const run = original.slice(
	original.indexOf("function run(candidate,"),
	original.indexOf("const scenarios=["),
);
assert.ok(fixture.includes("function trace("));
assert.ok(run.includes("return {events,shape,constructionNs,timings};"));
const sourceHashes = {};
const transforms = {};
function transform(text, path, mode) {
	if (mode === "plain") return text;
	const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
	const edits = [];
	const found = [];
	function visit(node) {
		if (
			(ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
			node.body &&
			paths[path].includes(node.name?.getText(sf))
		) {
			const name = node.name.getText(sf);
			found.push(name);
			const body = node.body;
			edits.push([
				body.getStart(sf) + 1,
				`\nconst __probe = globalThis.__coldProbe; const __token = __probe.enter(${JSON.stringify(name)}); try {\n`,
			]);
			edits.push([body.end - 1, "\n} finally { __probe.leave(__token); }\n"]);
		}
		ts.forEachChild(node, visit);
	}
	visit(sf);
	assert.deepEqual(found.sort(), [...paths[path]].sort(), `exact anchors: ${path}`);
	for (const [position, value] of edits.sort((a, b) => b[0] - a[0]))
		text = text.slice(0, position) + value + text.slice(position);
	if (mode === "counts" && path.endsWith("/causal-occurrence/construction.ts")) {
		const anchor = "description.edges.filter((edge) => edge.to === target)";
		assert.equal(text.split(anchor).length, 2);
		text = text.replace(
			anchor,
			'description.edges.filter((edge) => { globalThis.__coldProbe.bump("sourceFilterPredicate"); return edge.to === target; })',
		);
	}
	transforms[`${mode}:${path}`] = digest(text);
	return text;
}
put("scope.json", {
	qualification: false,
	owner: "graphrefly-ts",
	work: "CAUSAL-COMMITTED-VIEW-TS",
	request: "询问 CSP11 与 ad hoc 测试来源，并继续下一步",
	layout:
		"plain then phases then counts; each 200 empty warmups and 500 measured constructions; no background; one full 1-effect trace and one 1000-background count control",
	budgetsChanged: false,
	productionChanges: false,
	modes: ["plain", "phases", "counts"],
	meaning:
		"Nested phase times are intrusive descriptive measurements, not heap allocation bytes, causal attribution of the old p95, or qualification ratios.",
});
const results = {};
for (const mode of ["plain", "phases", "counts"]) {
	const runner = `
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
import {Graph, Graph as ReferenceGraph} from '${root}/packages/ts/src/graph/graph.ts';
import {causalOccurrenceBundle, causalOccurrenceBundle as referenceBundle, causalOccurrenceDigest} from '${root}/packages/ts/src/solutions/causal-occurrence.ts';
import {constructionOf} from '${root}/packages/ts/src/graph/construction-scope.ts';
const originalPorts=['released','currentness','terminals','conservation','coverage','quiescence','issues'];
const mode=${JSON.stringify(mode)};
const probe=globalThis.__coldProbe={active:false,records:[],stack:[],counts:{},
 enter(name){if(!this.active)return null;this.counts[name]=(this.counts[name]??0)+1;if(mode!=='phases')return null;const token={name,start:performance.now(),children:0};this.stack.push(token);return token;},
 leave(token){if(!token)return;const end=performance.now();assert.equal(this.stack.pop(),token);const inclusiveMs=end-token.start;const parent=this.stack.at(-1);if(parent)parent.children+=inclusiveMs;this.records.push({name:token.name,inclusiveMs,selfMs:inclusiveMs-token.children});},
 bump(name){if(this.active)this.counts[name]=(this.counts[name]??0)+1;},
 reset(){assert.equal(this.stack.length,0);this.records=[];this.counts={};}
};
${fixture}
${run}
const scenario=trace(1,0,false),empty={...scenario,arrivals:[]};
for(let i=0;i<200;i++)run(true,empty);
const samples=[];for(let i=0;i<500;i++){probe.reset();probe.active=true;const x=run(true,empty);probe.active=false;samples.push({constructionNs:x.constructionNs,counts:probe.counts,phases:probe.records});}
probe.reset();probe.active=true;const behavior=run(true,scenario);probe.active=false;const traceCounts=probe.counts;
probe.reset();probe.active=true;const background=run(true,empty,1000);probe.active=false;
assert.equal(probe.stack.length,0);
writeFileSync(${JSON.stringify(join(out, `${mode}-result.json`))},JSON.stringify({samples,behavior:{events:behavior.events,shape:behavior.shape},traceCounts,backgroundCounts:probe.counts,backgroundNodes:background.shape.length}));
console.log('COLD_PHASE_CHILD_DONE '+mode);
`;
	writeFileSync(join(out, `${mode}-runner.ts`), runner);
	const compiledSources = {};
	const compiled = await build({
		stdin: { contents: runner, loader: "ts", resolveDir: root },
		outfile: join(out, `${mode}-bundle.mjs`),
		bundle: true,
		format: "esm",
		platform: "node",
		metafile: true,
		define: { __GRAPHREFLY_TS_PACKAGE_REVISION__: '"graphrefly-ts:0.9.0"' },
		plugins: [
			{
				name: "diagnostic-only-shadow-source",
				setup(builder) {
					builder.onLoad({ filter: /\.ts$/ }, (args) => {
						const path = args.path.slice(root.length + 1);
						const text = read(path);
						compiledSources[path] = digest(text);
						return { contents: paths[path] ? transform(text, path, mode) : text, loader: "ts" };
					});
				},
			},
		],
	});
	for (const path of Object.keys(compiled.metafile.inputs).filter((p) => p !== "<stdin>")) {
		const hash = compiledSources[path];
		assert.ok(hash, `all compiled sources must be captured by the loader: ${path}`);
		assert.equal(digest(read(path)), hash, `source drift during compilation: ${path}`);
		if (sourceHashes[path]) assert.equal(hash, sourceHashes[path]);
		sourceHashes[path] = hash;
	}
	put(`${mode}-before.json`, {
		sourceHashes,
		before,
		transforms,
		bundle: digest(readFileSync(join(out, `${mode}-bundle.mjs`))),
	});
	const started = new Date().toISOString();
	const child = spawnSync(process.execPath, [join(out, `${mode}-bundle.mjs`)], {
		encoding: "utf8",
		timeout: 60000,
		maxBuffer: 10e6,
	});
	writeFileSync(join(out, `${mode}.log`), child.stdout + child.stderr);
	put(`${mode}-check.json`, {
		started,
		ended: new Date().toISOString(),
		status: child.status,
		error: child.error?.message ?? null,
	});
	assert.ifError(child.error);
	assert.equal(child.status, 0, child.stdout + child.stderr);
	results[mode] = JSON.parse(readFileSync(join(out, `${mode}-result.json`), "utf8"));
	for (const [path, hash] of Object.entries({ ...sourceHashes, ...before }))
		assert.equal(digest(read(path)), hash, `source/harness drift: ${path}`);
}
assert.deepEqual(results.phases.behavior, results.plain.behavior);
assert.deepEqual(results.counts.behavior, results.plain.behavior);
const percentile = (xs, p) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * p) - 1];
const phases = {};
for (const name of Object.values(paths).flat()) {
	const rows = results.phases.samples.flatMap((x) => x.phases.filter((v) => v.name === name));
	assert.equal(rows.length, 500, `one call per measured construction: ${name}`);
	phases[name] = {
		samples: rows.length,
		medianInclusiveUs: percentile(
			rows.map((x) => x.inclusiveMs * 1000),
			0.5,
		),
		medianSelfUs: percentile(
			rows.map((x) => x.selfMs * 1000),
			0.5,
		),
	};
}
for (const row of results.counts.samples)
	assert.deepEqual(row.counts, results.counts.samples[0].counts);
assert.deepEqual(results.counts.backgroundCounts, results.counts.samples[0].counts);
put("report.json", {
	schema: "graphrefly-ts/causal-cold-phase-diagnosis/v1",
	qualification: false,
	sourceHashes,
	harnessHashes: before,
	transforms,
	phases,
	counts: results.counts.samples[0].counts,
	backgroundCounts: results.counts.backgroundCounts,
	behaviorEquivalent: true,
	observedPorts: 7,
	traceEvents: results.plain.behavior.events.length,
	construction: Object.fromEntries(
		Object.entries(results).map(([mode, x]) => [
			mode,
			{
				medianUs: percentile(
					x.samples.map((s) => s.constructionNs / 1000),
					0.5,
				),
				p95Us: percentile(
					x.samples.map((s) => s.constructionNs / 1000),
					0.95,
				),
			},
		]),
	),
	limitations:
		"Separate fixed-order processes; phase probes change costs and JIT history. Self times exclude only instrumented child intervals. No meaningful cross-mode speedup or old-gate attribution can be inferred. Predicate counts measure executed work, not allocation bytes. No production optimization applied.",
});
console.log("COLD_PHASE_DIAGNOSIS_DONE");
