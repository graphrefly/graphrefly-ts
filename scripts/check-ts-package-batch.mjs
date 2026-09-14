/** Behavioral batch gate across installed public subpaths, independently for ESM and CJS. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Optional preserved package directory permits exact historical before/after checks.
const pkg = process.argv[2] ? resolve(process.argv[2]) : join(root, "packages/ts");
const temp = mkdtempSync(join(tmpdir(), "graphrefly-package-batch-"));
const installed = join(temp, "node_modules/@graphrefly/ts");
const body = `
function fixture(Graph) {
 const graph = new Graph();
 const left = graph.node([], null, { name: "left" });
 const right = graph.node([], null, { name: "right" });
 const total = graph.derived([left, right], (a, b) => a + b, { name: "total" });
 const values = [];
 const stop = total.subscribe(m => { if (m[0] === "DATA") values.push(m[1]); });
 left.down([["DATA", 1]]); right.down([["DATA", 2]]); values.length = 0;
 return { graph, left, right, values, stop };
}
const results = [];
function check(name, Graph, exercise) {
 const f = fixture(Graph);
 try { exercise(f); results.push({ name, passed: true }); }
 catch (error) { results.push({ name, passed: false, error: String(error), actual: error.actual, expected: error.expected }); }
 finally { f.stop(); }
}
function update(f, a, b) { f.left.down([["DATA", a]]); f.right.down([["DATA", b]]); }
function assertRolledBack(f) {
 assert.equal(f.left.cache, 1); assert.equal(f.right.cache, 2);
 // RESOLVED may recompute the unchanged derived value; rollback must not publish proposed data.
 assert.ok(f.values.every(value => value === 3), "rollback published changed value: " + JSON.stringify(f.values));
 f.values.length = 0;
}
for (const [name, Graph, batch] of [
 ["root-control", root.Graph, root.batch],
 ["graph-core", graph.Graph, core.batch],
 ["root-core", root.Graph, core.batch]
]) {
 check(name + "/commit", Graph, f => {
  const result = batch(() => { update(f, 10, 20); assert.deepEqual(f.values, []); return "committed"; });
  assert.equal(result, "committed"); assert.deepEqual(f.values, [30]);
 });
 check(name + "/explicit-rollback-recovery", Graph, f => {
  batch(ctx => { update(f, 10, 20); ctx.rollback(); });
  assertRolledBack(f);
  batch(() => update(f, 100, 200)); assert.deepEqual(f.values, [300]);
 });
 check(name + "/throw-recovery", Graph, f => {
  const failure = new Error("abort batch");
  assert.throws(() => batch(() => { update(f, 10, 20); throw failure; }), error => error === failure);
  assertRolledBack(f);
  batch(() => update(f, 100, 200)); assert.deepEqual(f.values, [300]);
 });
 check(name + "/invalidate-commit-recovery", Graph, f => {
  const events = []; const unsubscribe = f.left.subscribe(message => events.push(message[0])); events.length = 0;
  try {
   batch(() => { f.left.down([["INVALIDATE"]]); assert.equal(f.left.cache, 1); assert.ok(!events.includes("INVALIDATE")); });
   assert.equal(f.left.cache, undefined); assert.ok(events.includes("INVALIDATE"));
   f.values.length = 0; batch(() => update(f, 100, 200)); assert.deepEqual(f.values, [300]);
  } finally { unsubscribe(); }
 });
 check(name + "/invalidate-rollback-recovery", Graph, f => {
  batch(ctx => { f.left.down([["INVALIDATE"]]); ctx.rollback(); });
  assertRolledBack(f); batch(() => update(f, 100, 200)); assert.deepEqual(f.values, [300]);
 });
 for (const mode of ["commit", "rollback", "throw"]) {
  check(name + "/deferred-rewire-" + mode, Graph, f => {
   const request = f.graph.node([], null, { name: "rewire-request" });
   const added = f.graph.node([], null, { name: "added", initial: 42 });
   let requests = 0; let insideCallback = false; const values = [];
   const op = f.graph.node([request], function opFn(ctx) {
    if (core.depBatch(ctx, 0) && requests === 0) {
     assert.equal(insideCallback, false, "reactive function ran before batch commit");
     requests++; ctx.rewireNext.subscribeDep(added, opFn);
     assert.equal(op.deps.length, 1, "rewire applied inside requesting function");
    }
    for (const value of core.depBatch(ctx, 1) ?? []) ctx.down([["DATA", value]]);
   }, { name: "rewire-op" });
   const stop = op.subscribe(message => { if (message[0] === "DATA") values.push(message[1]); });
   const failure = new Error("rewire abort");
   try {
    const action = () => batch(ctx => {
     insideCallback = true;
     try {
      request.down([["DATA", 1]]); assert.deepEqual(op.deps, [request]); assert.equal(requests, 0);
      if (mode === "rollback") ctx.rollback();
      if (mode === "throw") throw failure;
     } finally { insideCallback = false; }
    });
    if (mode === "throw") assert.throws(action, error => error === failure); else action();
    if (mode !== "commit") {
     assert.deepEqual(op.deps, [request]); assert.equal(requests, 0); assert.deepEqual(values, []);
     added.down([["DATA", 43]]); assert.deepEqual(values, []);
     batch(() => request.down([["DATA", 2]]));
     assert.deepEqual(values, [43]);
    } else assert.deepEqual(values, [42]);
    assert.deepEqual(op.deps, [request, added]); assert.equal(requests, 1);
    values.length = 0; added.down([["DATA", 44]]); assert.deepEqual(values, [44]);
   } finally { stop(); }
  });
 }

}
for (const [name, outer, inner] of [
 ["core-outer-root-inner", core.batch, root.batch],
 ["root-outer-core-inner", root.batch, core.batch]
]) {
 for (const [origin, Graph] of [["root", root.Graph], ["graph", graph.Graph]]) {
  check(name + "/" + origin + "/nested-commit", Graph, f => {
   outer(() => {
    f.left.down([["DATA", 10]]);
    const nested = inner(() => { f.right.down([["DATA", 20]]); return "inner"; });
    assert.equal(nested, "inner"); assert.deepEqual(f.values, []);
   });
   assert.deepEqual(f.values, [30]);
  });
  check(name + "/" + origin + "/nested-rollback-recovery", Graph, f => {
   outer(() => {
    f.left.down([["DATA", 10]]);
    inner(ctx => { f.right.down([["DATA", 20]]); ctx.rollback(); });
   });
   assertRolledBack(f);
   outer(() => update(f, 100, 200)); assert.deepEqual(f.values, [300]);
  });
 }
}
console.log(JSON.stringify({ results }));
if (results.some(result => !result.passed)) process.exitCode = 1;
`;
let failed = false;
try {
	mkdirSync(installed, { recursive: true });
	cpSync(join(pkg, "dist"), join(installed, "dist"), { recursive: true });
	cpSync(join(pkg, "package.json"), join(installed, "package.json"));
	for (const format of ["esm", "cjs"]) {
		const imports =
			format === "esm"
				? "import assert from 'node:assert/strict';\nimport * as root from '@graphrefly/ts';\nimport * as graph from '@graphrefly/ts/graph';\nimport * as core from '@graphrefly/ts/core';\n"
				: "const assert=require('node:assert/strict');\nconst root=require('@graphrefly/ts'), graph=require('@graphrefly/ts/graph'), core=require('@graphrefly/ts/core');\n";
		const file = join(temp, format === "esm" ? "consumer.mjs" : "consumer.cjs");
		writeFileSync(file, imports + body);
		const worker = spawnSync(process.execPath, [file], {
			cwd: temp,
			encoding: "utf8",
			timeout: 30000,
			maxBuffer: 4 * 1024 * 1024,
		});
		if (worker.error || worker.signal || !worker.stdout.trim()) {
			throw new Error(
				`${format} worker did not complete: ${worker.error ?? worker.signal ?? worker.stderr}`,
			);
		}
		const report = JSON.parse(worker.stdout);
		assert.equal(report.results.length, 32, `${format}: incomplete behavioral matrix`);
		const failures = report.results.filter((result) => !result.passed);
		assert.equal(worker.status, failures.length ? 1 : 0, `${format}: inconsistent worker exit`);
		if (failures.length) failed = true;
		console.log(
			JSON.stringify({
				format,
				passed: report.results.length - failures.length,
				total: report.results.length,
				results: report.results,
			}),
		);
	}
	if (failed) process.exitCode = 1;
	else
		console.log(
			"check-ts-package-batch: installed ESM/CJS commit, nesting, rollback and recovery passed (64 cases)",
		);
} finally {
	rmSync(temp, { recursive: true, force: true });
}
