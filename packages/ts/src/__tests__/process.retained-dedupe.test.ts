/**
 * A ProcessBundle and its effect runner are retained for the graph's life and keep their
 * sequences, counts and dedupe ids in their working state (graphrefly-ts:D180: a retained runtime
 * declares no ledger state); within that life sequences continue and duplicates are rejected.
 */

import { describe, expect, it } from "vitest";
import { graph } from "../graph/index.js";
import {
	type ProcessEffectOutcome,
	processBundle,
	processEffectRunner,
} from "../orchestration/index.js";

describe("process sequences and dedupe while retained (D180)", () => {
	it("continues sequences and rejects a duplicate effect id", () => {
		const g = graph();
		const process = processBundle<{ id: string }, { count: number }, never, { task: string }>(g, {
			name: "p",
			initialState: { count: 0 },
			reduce: (command, state) => ({
				state: { count: state.count + 1 },
				effects: [{ id: command.payload.id, type: "work", payload: { task: "t" } }],
			}),
		});
		const outcomes = g.node<ProcessEffectOutcome<string>>([], null, { name: "w/outcomeFacts" });
		const runner = processEffectRunner(g, process, { name: "w", outcomes: [outcomes] });

		process.dispatch({ id: "c1", type: "run", payload: { id: "e1" } });
		process.dispatch({ id: "c2", type: "run", payload: { id: "e1" } });
		expect(process.errors.cache).toMatchObject({
			code: "malformed-effect",
			message: "processBundle: duplicate effect 'e1'",
			commandId: "c2",
		});
		process.dispatch({ id: "c3", type: "run", payload: { id: "e2" } });
		expect(process.effectRequests.cache).toMatchObject({ id: "e2", seq: 2 });
		expect(process.state.cache).toEqual({ count: 2 });
		expect(process.cursor.cache).toEqual({
			eventSeq: 0,
			effectSeq: 2,
			commandCount: 3,
			errorCount: 1,
			auditSeq: 3,
		});
		expect(runner.status.cache).toMatchObject({ state: "requested", effectId: "e2", requested: 2 });
	});
});
