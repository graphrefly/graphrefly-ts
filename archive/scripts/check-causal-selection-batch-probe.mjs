/** Loaded selector-only semantic comparison; no real Graph construction or performance samples. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const [baseline, probe, input] = process.argv.slice(2);
assert.ok(baseline && probe && input);
const a = readFileSync(baseline, "utf8"),
	b = readFileSync(probe, "utf8");
const funcs = (s) => {
	const t = ts.createSourceFile("x.mjs", s, 99, true, ts.ScriptKind.JS);
	return Object.fromEntries(
		t.statements.filter((n) => ts.isFunctionDeclaration(n)).map((n) => [n.name.text, n.getText(t)]),
	);
};
const fa = funcs(a),
	fb = funcs(b);
assert.deepEqual(Object.keys(fa), Object.keys(fb));
const changed = Object.keys(fa).filter((n) => fa[n] !== fb[n]);
assert.deepEqual(changed, ["buildBusiness"]);
const tmp = mkdtempSync(join(tmpdir(), "selector-grouping-"));
const modules = [];
try {
	for (const [i, source] of [a, b].entries()) {
		const cut = source.lastIndexOf("// profile-entry.ts");
		assert.ok(cut > 0);
		const path = join(tmp, `module-${i}.mjs`);
		writeFileSync(path, source.slice(0, cut) + "\nexport {buildBusiness,presetBinding};\n");
		modules.push(await import(pathToFileURL(path).href));
	}
	const scenario = JSON.parse(readFileSync(input, "utf8"));
	const pack = scenario.setup.find((s) => s.lane === "pack").values[0];
	const arrival = scenario.arrivals;
	const cases = [
		["duplicates", [[pack], []], [[], [arrival, arrival]]],
		["pending", [[], [arrival, arrival]], [[pack], []]],
		["invalid-middle", [[pack], []], [[], [arrival, null, arrival]]],
		["unknown", [[pack], []], [[], [{ ...arrival, evaluationRefs: ["missing"] }]]],
		["empty", [[pack], []], [[], []]],
	];
	const results = [];
	for (const [name, ...steps] of cases) {
		const states = modules.map((m) => {
			let selected;
			m.buildBusiness(
				(n, _d, fn) => {
					if (n === "evaluationSelections") selected = fn;
					return {};
				},
				{ evaluations: { pack: {}, arrivals: {} } },
				m.presetBinding,
			);
			assert.equal(typeof selected, "function");
			return { selected, value: undefined, latest: [undefined, undefined] };
		});
		const records = [];
		for (const [packs, arrivals] of steps) {
			const got = [];
			for (const s of states) {
				const groups = [];
				if (packs.length) s.latest[0] = packs.at(-1);
				if (arrivals.length) s.latest[1] = arrivals.at(-1);
				const ctx = {
					waveData: [packs.length ? [packs] : [], arrivals.length ? [arrivals] : []],
					[Symbol.for("graphrefly.ctx.depCache")]: { latest: s.latest },
					state: {
						get: () => s.value,
						set: (v) => {
							s.value = v;
						},
					},
					down: (msgs) => {
						assert.ok(msgs.length);
						groups.push(structuredClone(msgs));
					},
				};
				s.selected(ctx);
				got.push({ groups, state: structuredClone(s.value) });
			}
			assert.deepEqual(got[0].groups.flat(), got[1].groups.flat(), name + " ordered contents");
			assert.deepEqual(got[0].state, got[1].state, name + " state");
			records.push({
				originalGroups: got[0].groups.length,
				groupedGroups: got[1].groups.length,
				messages: got[0].groups.flat().length,
			});
		}
		results.push({ name, records });
	}
	assert.deepEqual(results[0].records[1], { originalGroups: 2, groupedGroups: 1, messages: 2 });
	console.log(
		JSON.stringify({
			passed: true,
			changedFunctions: changed,
			referenceByteIdentical: true,
			cases: results,
			performanceSamples: 0,
		}),
	);
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
