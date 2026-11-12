/**
 * graphrefly-ts:D180: a ProcessBundle's sequences, counts and dedupe ids are a declared ledger
 * state the runtime depends on; the effect runner's status counts are a ledger its status node
 * depends on. The reducer state stays in the runtime's lifetime.
 */

import { describe, expect, it } from "vitest";
import { graph } from "../graph/index.js";
import {
	type ProcessEffectOutcome,
	processBundle,
	processEffectRunner,
} from "../orchestration/index.js";

describe("process ledger (D180)", () => {
	it("declares the ledgers as dependencies and keeps sequence and dedupe behaviour", () => {
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

		const byId = Object.fromEntries(g.describe().map((n) => [n.id, n]));
		expect(byId["p/runtime"]?.deps).toEqual(["p/command", "p/ledger"]);
		expect(byId["p/ledger"]).toMatchObject({ kind: "state", deps: [] });
		expect(byId["w/status"]?.deps).toEqual(["w/requests", "w/runtime", "w/ledger"]);
		expect(byId["w/ledger"]).toMatchObject({ kind: "state", deps: [] });

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

		runner.release();
		process.release();
		expect(g.find("p/ledger")).toBeUndefined();
		expect(g.find("w/ledger")).toBeUndefined();
	});
});
