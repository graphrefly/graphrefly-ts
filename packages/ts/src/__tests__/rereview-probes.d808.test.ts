import { describe, expect, it } from "vitest";
import {
	runCheckpointReasonProbes,
	runRereviewProbes,
} from "../../../../scripts/fixtures/d797-rereview-probes.js";
import { type Ctx, graph } from "../index.js";

/** The CLI compares these same traces against root spec/fixtures/d797-rereview.v1.json. */
describe("D808 cross-runtime rereview traces", () => {
	it("keeps quiet final output in one wave, request boundaries, cleanup and exact refusals", () => {
		expect(runRereviewProbes()).toEqual({
			quietTerminal: { runs: 1, waves: [[99]], terminal: "COMPLETE" },
			observeStop: [1],
			subscribeStop: [1, 2],
			emptyDown: { arrays: 0 },
			lateAfterCommitFailure: [42],
			replaceCleanup: [42],
			endedBatch: { updaterRuns: 0, otherValue: 0, reports: 1 },
			checkpointMissingRecipe: "not restorable: n: missing recipe",
		});
	});
});

// A retained ctx does not become run output again when the same node runs later.
it("queues an old invocation's output separately from a newer invocation", () => {
	const g = graph();
	const source = g.state(0);
	let old: Ctx | undefined;
	const n = g.node([source], (ctx) => {
		if (old === undefined) {
			old = ctx;
			return;
		}
		old.emit(42);
		ctx.emit(7);
	});
	const seen: unknown[] = [];
	const stop = n.subscribe((msgs) => {
		for (const m of msgs) if (m[0] === "DATA") seen.push(m[1]);
	});
	source.set(1);
	expect(seen).toEqual([7, 42]);
	stop();
});

it("uses exact node-level checkpoint refusal reasons", () => {
	expect(runCheckpointReasonProbes()).toEqual({
		missingRecipe: "not restorable: n: missing recipe",
		retainedValues: "not restorable: n: its retained values are not JSON",
		receivedValues: "not restorable: n: its received values are not JSON",
		privateState: "not restorable: n: its private state is not JSON",
		recipeConfig: "not restorable: n: its recipe config is not JSON",
		errorPayload: "not restorable: n: its ERROR payload is not JSON",
		localOnly: "not restorable: n: local-only, built or replaced without a recipe",
		missingReceived: "not restorable: n: missing received records",
	});
});
