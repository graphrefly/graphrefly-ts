import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.argv[2],
	out = process.argv[3];
const mod = await import(pathToFileURL(path.join(root, "B.mjs")));
const input = JSON.parse(readFileSync(path.join(root, "P2-inputs.json")));
const result = { instances: 1, performanceSamples: 0 };
let run,
	cleaned = false;
function frozenTree(v) {
	if (v === null || typeof v !== "object") return true;
	return (
		Object.isFrozen(v) &&
		Reflect.ownKeys(v).every((k) => {
			const d = Object.getOwnPropertyDescriptor(v, k);
			return "value" in d && frozenTree(d.value);
		})
	);
}
try {
	run = mod.candidate();
	for (const step of input.steps) run.send(step);
	const state = run.state(),
		entry = [...state.byRevision.values()][0],
		current = [...state.currentness.values()][0];
	assert.equal(current.occurrence, entry.value);
	assert(frozenTree(entry.value));
	result.live = {
		sameOccurrence: true,
		deepFrozen: true,
		payloadPresent: Object.hasOwn(entry.value, "value"),
	};
	for (const step of mod.duplicate(input)) run.send(step);
	const next = run.state();
	assert.notEqual(state, next);
	assert.notEqual(state.byRevision, next.byRevision);
	assert.equal([...next.byRevision.values()][0].value, entry.value);
	result.transition = { newState: true, newMap: true, sameRetainedOccurrence: true };
	run.disconnect();
	assert.equal([...run.state().byRevision.values()][0].value, entry.value);
	run.connect();
	assert.equal([...run.state().byRevision.values()][0].value, entry.value);
	result.resubscribeRetainsOccurrence = true;
	try {
		run.graph.checkpoint();
		result.checkpoint = { accepted: true };
	} catch (e) {
		result.checkpoint = { accepted: false, message: String(e), cause: String(e.cause) };
	}
	assert.equal(result.checkpoint.accepted, false);
	const shallow = Object.freeze({ nested: { x: 1 } });
	assert(!frozenTree(shallow));
	result.shallowFreezeNegative = true;
	run.cleanup();
	cleaned = true;
	assert.equal(run.graph.describe().nodes.length, 0);
	result.cleanup = true;
	result.passed = true;
} catch (e) {
	result.passed = false;
	result.error = { message: String(e), stack: e.stack };
	process.exitCode = 1;
} finally {
	if (run && !cleaned) run.cleanup();
	writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
}
