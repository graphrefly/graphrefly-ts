/**
 * R-checkpoint@1: a wire bridge's command and envelope values are strict JSON: absent options are
 * omitted, not undefined, so they no longer stop a capture. The retained event fold's working copy
 * (pending envelopes in a Map) is still not JSON; capturing a graph-life runtime while it runs is
 * graphrefly-ts:CHECKPOINT-COVERAGE-TS, so the capture now stops there and nowhere else.
 */

import { describe, expect, it } from "vitest";
import { wireBridge } from "../adapters/index.js";
import { toCheckpointJson } from "../graph/checkpoint.js";
import { graph } from "../graph/graph.js";

describe("wireBridge command values after send, ack, nack and close", () => {
	it("keeps every command and envelope strict JSON", () => {
		const g = graph({ name: "bridge-checkpoint" });
		const bridge = wireBridge<string, string>(g, { name: "bridge", sessionId: "s", now: () => 1 });
		const outbound: unknown[] = [];
		const stop = bridge.outbound.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === "DATA") outbound.push(m[1]);
		});
		const commands: unknown[] = [];
		bridge.send("one");
		commands.push(bridge.command.cache);
		bridge.ack(1);
		commands.push(bridge.command.cache);
		bridge.nack(2, { message: "no" });
		commands.push(bridge.command.cache);
		bridge.close();
		commands.push(bridge.command.cache);
		expect(commands[0]).toEqual({ kind: "send", payload: "one" });
		for (const value of [...commands, ...outbound])
			expect(() => toCheckpointJson(value, "bridge value")).not.toThrow();
		// The only value a capture still refuses is the retained fold's working copy.
		expect(() => g.checkpoint()).toThrow(/bridge\/events\.lifetime\.state/);
		stop();
	});
});
