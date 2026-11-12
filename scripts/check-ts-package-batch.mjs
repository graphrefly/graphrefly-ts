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
function fixture(graphFactory) {
 const g = graphFactory();
 const left = g.state(1, { name: "left" });
 const right = g.state(2, { name: "right" });
 const total = g.derived([left, right], (a, b) => a + b, { name: "total" });
 const values = [];
 const stop = total.subscribe(msgs => { for (const m of msgs) if (m[0] === "DATA") values.push(m[1]); });
 values.length = 0;
 return { g, left, right, values, stop };
}
const results = [];
function check(name, graphFactory, exercise) {
 const f = fixture(graphFactory);
 try { exercise(f); results.push({ name, passed: true }); }
 catch (error) { results.push({ name, passed: false, error: String(error), actual: error.actual, expected: error.expected }); }
 finally { f.stop(); }
}
function update(f, a, b) { f.left.set(a); f.right.set(b); }
function assertRolledBack(f) {
 assert.equal(f.left.cache, 1); assert.equal(f.right.cache, 2);
 assert.deepEqual(f.values, [], "a discarded batch published a value: " + JSON.stringify(f.values));
}
for (const [origin, graphFactory] of [["root", root.graph], ["graph", graphLayer.graph]]) {
 check(origin + "/commit", graphFactory, f => {
  const result = f.g.batch(() => { update(f, 10, 20); assert.deepEqual(f.values, []); return "committed"; });
  assert.equal(result, "committed"); assert.deepEqual(f.values, [30]);
 });
 check(origin + "/throw-recovery", graphFactory, f => {
  const failure = new Error("abort batch");
  assert.throws(() => f.g.batch(() => { update(f, 10, 20); throw failure; }), error => error === failure);
  assertRolledBack(f);
  f.g.batch(() => update(f, 100, 200)); assert.deepEqual(f.values, [300]);
 });
 check(origin + "/invalidate-commit-recovery", graphFactory, f => {
  const types = []; const unsubscribe = f.left.subscribe(msgs => { for (const m of msgs) types.push(m[0]); }); types.length = 0;
  try {
   f.g.batch(() => { f.left.invalidate(); assert.equal(f.left.cache, 1); assert.ok(!types.includes("INVALIDATE")); });
   assert.equal(f.left.cache, undefined); assert.ok(types.includes("INVALIDATE"));
   f.values.length = 0; f.g.batch(() => update(f, 100, 200)); assert.deepEqual(f.values, [300]);
  } finally { unsubscribe(); }
 });
 check(origin + "/invalidate-throw-recovery", graphFactory, f => {
  const failure = new Error("abort invalidate");
  assert.throws(() => f.g.batch(() => { f.left.invalidate(); throw failure; }), error => error === failure);
  assertRolledBack(f); f.g.batch(() => update(f, 100, 200)); assert.deepEqual(f.values, [300]);
 });
 for (const mode of ["commit", "throw"]) {
  check(origin + "/deferred-rewire-" + mode, graphFactory, f => {
   const request = f.g.state(0, { name: "rewire-request" });
   const added = f.g.state(42, { name: "added" });
   let requests = 0; let insideBody = false; const values = [];
   const op = f.g.node([request], ctx => {
    if (ctx.deps[0].waves.length > 0 && ctx.deps[0].value === 1 && requests === 0) {
     assert.equal(insideBody, false, "the function ran before the batch committed");
     requests++; ctx.rewire([request, added]);
     assert.equal(op.deps.length, 1, "rewire applied inside the requesting function");
    }
    // Dependency 1 exists only once the rewire above has applied.
    for (const value of ctx.deps[1]?.waves.flat() ?? []) ctx.down([["DATA", value]]);
   }, { name: "rewire-op" });
   const stop = op.subscribe(msgs => { for (const m of msgs) if (m[0] === "DATA") values.push(m[1]); });
   const failure = new Error("rewire abort");
   try {
    const action = () => f.g.batch(() => {
     insideBody = true;
     try {
      request.set(1); assert.deepEqual(op.deps, [request]); assert.equal(requests, 0);
      if (mode === "throw") throw failure;
     } finally { insideBody = false; }
    });
    if (mode === "throw") assert.throws(action, error => error === failure); else action();
    if (mode !== "commit") {
     assert.deepEqual(op.deps, [request]); assert.equal(requests, 0); assert.deepEqual(values, []);
     f.g.batch(() => request.set(1));
    }
    assert.deepEqual(values, [42]);
    assert.deepEqual(op.deps, [request, added]); assert.equal(requests, 1);
    values.length = 0; added.set(44); assert.deepEqual(values, [44]);
   } finally { stop(); }
  });
 }
 check(origin + "/nested-commit", graphFactory, f => {
  f.g.batch(() => {
   f.left.set(10);
   const nested = f.g.batch(() => { f.right.set(20); return "inner"; });
   assert.equal(nested, "inner"); assert.deepEqual(f.values, []);
  });
  assert.deepEqual(f.values, [30]);
 });
 check(origin + "/nested-throw-recovery", graphFactory, f => {
  const failure = new Error("abort nested");
  assert.throws(() => f.g.batch(() => {
   f.left.set(10);
   f.g.batch(() => f.right.set(20));
   throw failure;
  }), error => error === failure);
  assertRolledBack(f);
  f.g.batch(() => update(f, 100, 200)); assert.deepEqual(f.values, [300]);
 });
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
				? "import assert from 'node:assert/strict';\nimport * as root from '@graphrefly/ts';\nimport * as graphLayer from '@graphrefly/ts/graph';\n"
				: "const assert=require('node:assert/strict');\nconst root=require('@graphrefly/ts'), graphLayer=require('@graphrefly/ts/graph');\n";
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
		assert.equal(report.results.length, 16, `${format}: incomplete behavioral matrix`);
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
			"check-ts-package-batch: installed ESM/CJS commit, nesting, discard-by-throw and recovery passed (32 cases)",
		);
} finally {
	rmSync(temp, { recursive: true, force: true });
}
