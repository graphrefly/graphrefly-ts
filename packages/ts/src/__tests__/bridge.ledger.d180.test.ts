/**
 * graphrefly-ts:D180: the wire bridge's ledger (its outbound sequence and inbound cursors) is a
 * state the bundle owns and the event fold declares, so the relation is a drawable edge and a
 * checkpoint holds it as strict JSON. The fold is retained for the graph's life, so within it the
 * bridge state is the working copy and the ledger keeps its seed until the lifetime closes.
 */

import { describe, expect, it } from "vitest";
import { wireBridge, wireBridgeEnvelope } from "../adapters/index.js";
import { graph } from "../graph/graph.js";

describe("wireBridge ledger (D180)", () => {
	it("declares the ledger as the event fold's last dependency and keeps its sequence and cursor", () => {
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

		expect(g.describe().find((n) => n.id === "bridge/events")?.deps).toEqual([
			"bridge/command",
			"bridge/inbound",
			"bridge/ledger",
		]);

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

		const ledger = g.describe().find((n) => n.id === "bridge/ledger");
		expect(ledger?.kind).toBe("state");
		// Mid-lifetime the ledger still holds its seed: the bridge state is the working copy.
		const value = g.find("bridge/ledger")?.cache;
		expect(value).toEqual({ nextSeq: 1, cursor: 0, remoteCursor: 0 });
		expect(JSON.parse(JSON.stringify(value))).toEqual(value);
	});
});
