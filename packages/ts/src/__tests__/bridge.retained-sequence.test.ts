/**
 * The wire bridge's event fold is retained for the graph's life and keeps its outbound sequence
 * and inbound cursors in its working state (graphrefly-ts:D180: a retained runtime declares no
 * ledger state); within that life the sequence continues and inbound replays are reported.
 */

import { describe, expect, it } from "vitest";
import { wireBridge, wireBridgeEnvelope } from "../adapters/index.js";
import { graph } from "../graph/graph.js";

describe("wireBridge sequence and cursor while retained (D180)", () => {
	it("continues the outbound sequence and reports inbound replays", () => {
		const g = graph({ name: "bridge-ledger" });
		const bridge = wireBridge<string, string>(g, {
			name: "bridge",
			sessionId: "session-a",
			now: () => 1,
		});
		const kinds: string[] = [];
		const seqs: number[] = [];
		bridge.events.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] !== "DATA") continue;
				const event = m[1] as { kind: string; envelope?: { metadata: { seq: number } } };
				kinds.push(event.kind);
				if (event.kind === "outbound" && event.envelope) seqs.push(event.envelope.metadata.seq);
			}
		});

		bridge.send("one");
		bridge.send("two");
		expect(seqs).toEqual([1, 2]);

		const inbound = (seq: number) =>
			wireBridgeEnvelope<string>({
				sessionId: "session-a",
				type: "data",
				seq,
				payload: { kind: "data", value: `in-${seq}` },
			});
		bridge.inbound.set(inbound(1));
		bridge.inbound.set(inbound(1));
		bridge.inbound.set(inbound(3));
		expect(kinds.filter((k) => k === "cursor")).toHaveLength(1);
		expect(kinds).toContain("duplicate");
		expect(kinds).toContain("out-of-order");

		bridge.send("three");
		expect(seqs).toEqual([1, 2, 3]);
	});
});
