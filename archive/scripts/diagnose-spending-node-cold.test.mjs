import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { account, canonical, instrumentNode } from "./diagnose-spending-node-cold.mjs";

test("generated wrappers preserve original bytes and reject missing seams", () => {
	for (const [file, name] of [
		["packages/ts/src/graph/graph.ts", "Graph"],
		["packages/ts/src/graph/construction-scope.ts", "ConstructionScope"],
	]) {
		const s = readFileSync(file, "utf8"),
			r = instrumentNode(s, name);
		assert.equal(r.source.replace(r.begin, "").replace(r.end, ""), s);
	}
	assert.throws(() => instrumentNode("class Other {}", "Graph"));
	assert.throws(() => instrumentNode("class Graph { node(a,b,wrong){} }", "Graph"));
});
test("wrapper preserves return/throw/this and records exceptional exits", () => {
	const s =
		"class Graph { node(deps=[],fn=null,opts={}) { if(opts.fail) throw opts.fail; return this; } }";
	const transformed = ts.transpile(instrumentNode(s, "Graph").source, {
		target: ts.ScriptTarget.ES2022,
	});
	const records = [];
	globalThis.__spendingNodeRecord = (...a) => records.push(a);
	try {
		const G = new Function(`${transformed};return Graph;`)(),
			g = new G();
		assert.equal(g.node([], null, { name: "ok" }), g);
		const error = new Error("expected");
		assert.throws(
			() => g.node([], null, { name: "bad", fail: error }),
			(e) => e === error,
		);
		assert.deepEqual(
			records.map((r) => r[1]),
			["ok", "bad"],
		);
	} finally {
		delete globalThis.__spendingNodeRecord;
	}
});
test("accounting rejects duplicate/missing/overlapping node identities", () => {
	const s = {
		start: 0,
		end: 11,
		nodes: [{ id: "x", start: 1.2, end: 1.4 }],
		marks: Array.from({ length: 10 }, (_, i) => ({ label: String(i), at: i + 1 })),
	};
	const a = account(s, ["x"]);
	assert.equal(a.stages["shell-entry"].residualMs, 1);
	assert.equal(
		Object.values(a.stages).reduce((n, s) => n + s.totalMs, 0),
		a.totalMs,
	);
	assert.ok(Math.abs(a.nodeMs - 0.2) < 1e-9);
	assert.ok(Math.abs(a.residualMs - 10.8) < 1e-9);
	assert.throws(() => account(s, ["x", "y"]));
	assert.throws(() => account({ ...s, nodes: [...s.nodes, ...s.nodes] }, ["x", "x"]));
	assert.throws(() => account({ ...s, nodes: [{ id: "x", start: 1.2, end: 2.2 }] }, ["x"]));
	assert.throws(() => account({ ...s, nodes: [{ id: "x", start: 2, end: 1 }] }, ["x"]));
});
test("explicit semantic mapping rejects unseen reference identities", () => {
	assert.equal(canonical("spending/reference/moments"), "spending/vendorStats");
	assert.equal(canonical("spending/causal/authority"), "spending/causal/authority");
	assert.throws(() => canonical("spending/reference/unknown"));
});
