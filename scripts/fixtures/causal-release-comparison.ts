/** Identical private wrapper for both frozen git closures. No action clocks here. */
import assert from "node:assert/strict";
import { Graph } from "../../packages/ts/src/graph/graph.js";
import { graphArm, type Scenario, schedule } from "./spending-preset-performance.js";
// Exact build transform exports snapshot and adds plain/reference-checked expected data.
import { graphSnapshot, preflight } from "./spending-preset-performance-worker.js";
export const duplicateRow = {
	id: "steady-P2-summary-duplicate-1",
	group: "steady",
	profile: "P2",
	mode: "summary",
	change: "duplicate",
	dataCount: 1,
} as const;
export const coldRow = {
	id: "cold-P2-summary",
	group: "cold",
	profile: "P2",
	mode: "summary",
} as const;
export { graphSnapshot };
export function candidate() {
	return graphArm("candidate", "summary");
}
export function duplicate(scenario: Scenario) {
	return schedule(duplicateRow, scenario).action;
}
export function occurrence(run: ReturnType<typeof candidate>) {
	return run.state()?.byRevision.size ?? 0;
}
export function preflights(scenario: Scenario) {
	const cold = preflight(coldRow, scenario);
	const steady = preflight(duplicateRow, scenario);
	return { cold, steady, expected: steady.expected };
}
export function validate(
	run: ReturnType<typeof candidate>,
	snapshot: unknown,
	expected: unknown,
	before: number,
	after: number,
) {
	assert.equal(before, 1);
	assert.equal(after, before);
	assert.deepEqual(snapshot, expected);
	assert.equal(run.owner.nodes.length, 54);
	assert.equal(run.owner.roots.length, 2);
	assert.equal(run.graph.describe().nodes.length, 0);
}
export function micro(row: string) {
	const graph = new Graph({ name: row });
	const group = graph.topologyGroup({ name: row });
	let disconnect: (() => void) | undefined;
	if (row === "active-diamond-5") {
		const a = group.state(2, { name: "a" }),
			b = group.state(3, { name: "b" });
		const left = group.derived([a, b], (x, y) => x + y, { name: "left" });
		const right = group.derived([a, b], (x, y) => x * y, { name: "right" });
		const join = group.derived([left, right], (x, y) => x + y, { name: "join" });
		const messages: unknown[] = [];
		disconnect = join.subscribe((m) => messages.push(m));
		assert.ok(messages.some((m) => Array.isArray(m) && m[0] === "DATA" && m[1] === 11));
	} else if (row === "inactive-2") {
		const a = group.state(2, { name: "a" });
		group.derived([a], (x) => x + 1, { name: "b" });
	} else {
		assert.ok(row === "inactive-60" || row === "inactive-1");
		for (let i = 0; i < (row === "inactive-60" ? 60 : 1); i++) group.state(i, { name: `n${i}` });
	}
	const before = graph.describe();
	return {
		release() {
			group.release();
		},
		validate(error: unknown) {
			if (row === "active-diamond-5") {
				assert.match(String(error), /'join' still has live subscribers/);
				assert.equal(group.released, false);
				assert.deepEqual(graph.describe(), before);
			} else {
				assert.equal(error, undefined);
				assert.equal(group.released, true);
			}
		},
		cleanup() {
			disconnect?.();
			if (!group.released) group.release();
		},
		finished() {
			assert.equal(graph.describe().nodes.length, 0);
		},
	};
}
