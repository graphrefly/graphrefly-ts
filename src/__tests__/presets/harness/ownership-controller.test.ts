/**
 * DS-14.5.A delta #8 — `ownershipController()` preset tests.
 *
 * Covers: TTL expiry, heartbeat renew/miss, supervisor override arbitration
 * by level, and the Q7 reactive-options Guard auto-mount (non-owner write
 * hard-blocked).
 */

import { DATA, GuardDenied, node } from "@graphrefly/pure-ts/core";
import { Graph } from "@graphrefly/pure-ts/graph";
import { describe, expect, it } from "vitest";
import {
	type OwnershipState,
	ownershipController,
} from "../../../presets/harness/ownership-controller.js";

/** Read the resolved owner by subscribing (activates the lazy derivation). */
function ownerOf(oc: ReturnType<typeof ownershipController>): string | null {
	let last: OwnershipState | undefined;
	const unsub = oc.current.subscribe((msgs) => {
		for (const m of msgs) if (m[0] === DATA) last = m[1] as OwnershipState;
	});
	unsub();
	return last?.owner ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("ownershipController — claim / release", () => {
	it("claim makes the actor the resolved owner; release clears it", () => {
		const oc = ownershipController("g", { ttl: 60_000 });
		expect(ownerOf(oc)).toBeNull();
		oc.claim("agent-a");
		expect(ownerOf(oc)).toBe("agent-a");
		oc.release("agent-a");
		expect(ownerOf(oc)).toBeNull();
	});

	it("release by a non-owner does not clear ownership", () => {
		const oc = ownershipController("g", { ttl: 60_000 });
		oc.claim("agent-a");
		oc.release("agent-b"); // not the owner
		expect(ownerOf(oc)).toBe("agent-a");
	});
});

describe("ownershipController — L1 TTL expiry (Q4 strict)", () => {
	it("a claim auto-releases once TTL elapses (evaluated reactively)", async () => {
		const clock = node<number>([], { initial: 0 });
		const oc = ownershipController("g", { ttl: 30, clock });
		oc.claim("agent-a");
		expect(ownerOf(oc)).toBe("agent-a");
		await sleep(50); // exceed the 30ms TTL
		// Tick the reactive clock → `current` recomputes and sees expiry.
		clock.down([[DATA, 1]]);
		expect(ownerOf(oc)).toBeNull();
	});

	it("within the TTL window the claim stays live", async () => {
		const clock = node<number>([], { initial: 0 });
		const oc = ownershipController("g", { ttl: 200, clock });
		oc.claim("agent-a");
		await sleep(20);
		clock.down([[DATA, 1]]);
		expect(ownerOf(oc)).toBe("agent-a"); // still inside 200ms
	});
});

describe("ownershipController — L2 heartbeat renew / miss", () => {
	it("a heartbeat emission resets the TTL countdown (renew)", async () => {
		const heartbeat = node<number>([], { initial: 0 });
		const oc = ownershipController("g", { ttl: 60, heartbeat });
		oc.claim("agent-a", "L2");
		await sleep(40);
		heartbeat.down([[DATA, 1]]); // sign of life — resets countdown
		await sleep(40); // 80ms since claim, but only 40ms since heartbeat
		heartbeat.down([[DATA, 2]]);
		expect(ownerOf(oc)).toBe("agent-a");
	});

	it("a missed heartbeat past TTL expires the claim", async () => {
		const heartbeat = node<number>([], { initial: 0 });
		const oc = ownershipController("g", { ttl: 30, heartbeat });
		oc.claim("agent-a", "L2");
		await sleep(60); // no heartbeat for > TTL
		heartbeat.down([[DATA, 1]]); // late beat triggers recompute → expired
		expect(ownerOf(oc)).toBeNull();
	});
});

describe("ownershipController — L3 supervisor override (Q10 level priority)", () => {
	it("supervisor override wins regardless of an existing live claim", () => {
		const oc = ownershipController("g", { ttl: 60_000, supervisor: "lead" });
		oc.claim("agent-a", "L2");
		expect(ownerOf(oc)).toBe("agent-a");
		oc.override("lead", "agent-a", "rebalance");
		expect(ownerOf(oc)).toBe("lead");
	});

	it("a lower-level claim cannot displace a higher-level (L3) owner", () => {
		const oc = ownershipController("g", { ttl: 60_000, supervisor: "lead" });
		oc.override("lead", "none", "seed");
		expect(ownerOf(oc)).toBe("lead");
		oc.claim("agent-b", "L1"); // L1 < L3 → ignored
		expect(ownerOf(oc)).toBe("lead");
	});
});

describe("ownershipController — Q7 Guard auto-mount (reactive policyAllowing)", () => {
	it("non-owner write is hard-blocked; owner write succeeds; re-points on claim", () => {
		const oc = ownershipController("g", { ttl: 60_000 });
		const owned = new Graph("owned");
		owned.add(node<number>([], { initial: 0, guard: oc.guard }), { name: "doc" });

		const agentA = { type: "llm" as const, id: "agent-a" };
		const agentB = { type: "llm" as const, id: "agent-b" };

		// Unclaimed → deny-all (closed, not open).
		expect(() => owned.set("doc", 1, { actor: agentA })).toThrow(GuardDenied);

		oc.claim("agent-a");
		// Owner writes succeed; non-owner is hard-blocked.
		expect(() => owned.set("doc", 2, { actor: agentA })).not.toThrow();
		expect(() => owned.set("doc", 3, { actor: agentB })).toThrow(GuardDenied);

		// Hand-off re-points the allow-set with NO rewire.
		oc.override("anyone", "agent-a", "handoff to b");
		// override hands ownership to `anyone` (the override actor). Claim by b:
		oc.release("anyone");
		oc.claim("agent-b");
		expect(() => owned.set("doc", 4, { actor: agentB })).not.toThrow();
		expect(() => owned.set("doc", 5, { actor: agentA })).toThrow(GuardDenied);
	});

	it("observe is always allowed (ownership gates writes, not reads)", () => {
		const oc = ownershipController("g", { ttl: 60_000 });
		oc.claim("agent-a");
		// A non-owner reading the allow-set guard for observe → true.
		expect(oc.guard({ type: "llm", id: "agent-z" }, "observe")).toBe(true);
		expect(oc.guard({ type: "llm", id: "agent-z" }, "write")).toBe(false);
	});
});
