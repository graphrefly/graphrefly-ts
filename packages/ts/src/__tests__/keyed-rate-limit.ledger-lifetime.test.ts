/**
 * graphrefly-ts:D180: the keyed rate limit's ledger (D649 replay suppression) across lifetimes.
 * The runtime's private state is the working copy within a lifetime; the ledger state is written
 * when a lifetime closes. A restored working copy wins over the older ledger, and a lifetime that
 * ends abnormally still writes back.
 */

import { describe, expect, it } from "vitest";
import { graph } from "../graph/index.js";
import { defaultRestoreRegistry, restoreGraph } from "../graph/restore.js";
import type { Node } from "../node/node.js";
import {
	assertKeyedRateLimitRequest,
	createKeyedRateLimitOutcome,
	type KeyedRateLimitAdmission,
	type KeyedRateLimitOutcome,
	type KeyedRateLimitRequest,
	keyedRateLimitAdmissionBundle,
	keyedRateLimitRestoreRegistry,
} from "../rate-limit/index.js";
import { asState } from "./helpers/as-state.js";

function request(requestId: string): KeyedRateLimitRequest {
	return assertKeyedRateLimitRequest({
		format: "graphrefly.keyedRateLimitRequest",
		version: 1,
		requestId,
		key: { kind: "network-key", id: `key-${requestId}`, revision: "opaque-v1" },
		policy: {
			id: "public-session",
			revision: "policy-v3",
			algorithm: { kind: "fixed-window", revision: "algorithm-v1" },
		},
		authority: { kind: "quota-store", id: "primary", revision: "schema-v2" },
		operation: { kind: "public-session", id: `operation-${requestId}`, revision: "intent-v1" },
		units: 1,
	});
}

function allowed(req: KeyedRateLimitRequest): KeyedRateLimitOutcome {
	return createKeyedRateLimitOutcome(req, {
		outcomeId: `outcome-${req.requestId}`,
		result: "allowed",
		remainingUnits: 4,
		resetAtMs: 10_000,
		retryAfterMs: 0,
		provenance: [{ kind: "transaction", id: "consume", revision: "tx-v1" }, req.authority],
	});
}

function build(name = "limit") {
	const g = graph({ name: "ledger-lifetime" });
	const requests = g.state<KeyedRateLimitRequest>(undefined as never, { name: "requests" });
	const outcomes = g.state<KeyedRateLimitOutcome>(undefined as never, { name: "outcomes" });
	const bundle = keyedRateLimitAdmissionBundle(g, { name, requests, outcomes });
	const admitted: KeyedRateLimitAdmission[] = [];
	const watch = () =>
		bundle.admissions.subscribe((msgs) => {
			if (msgs[0]?.[0] === "START") return;
			for (const m of msgs) if (m[0] === "DATA") admitted.push(m[1] as KeyedRateLimitAdmission);
		});
	return { g, requests, outcomes, bundle, admitted, watch };
}

describe("keyed rate-limit ledger across lifetimes (D180)", () => {
	it("a mid-lifetime checkpoint restores through its recipes, and the working copy wins (R-checkpoint@1)", () => {
		// Admit twice in one lifetime; the ledger state has not been written yet.
		const a = build();
		a.watch();
		for (const id of ["one", "two"]) {
			a.requests.set(request(id));
			a.outcomes.set(allowed(request(id)));
		}
		expect(a.admitted).toHaveLength(2);
		const checkpoint = a.g.checkpoint();
		const ledger = checkpoint.nodes.find((n) => n.id === "limit/ledger");
		expect(JSON.stringify(ledger?.values)).not.toContain('"one"'); // still the old ledger
		expect(checkpoint.nodes.find((n) => n.id === "limit/runtime")?.recipe?.ref).toBe(
			"keyedRateLimit.runtime",
		);

		const restored = restoreGraph(checkpoint, {
			registry: { ...defaultRestoreRegistry, ...keyedRateLimitRestoreRegistry },
		});
		const admissions = restored.find("limit/admissions") as Node<KeyedRateLimitAdmission>;
		const requests = asState(restored.find("requests") as Node<KeyedRateLimitRequest>);
		const outcomes = asState(restored.find("outcomes") as Node<KeyedRateLimitOutcome>);
		const admitted: KeyedRateLimitAdmission[] = [];
		admissions.subscribe((msgs) => {
			if (msgs[0]?.[0] === "START") return;
			for (const m of msgs) if (m[0] === "DATA") admitted.push(m[1] as KeyedRateLimitAdmission);
		});
		// A replay of an admitted correlation is not admitted again (D649); a new one is.
		requests.set(request("one"));
		outcomes.set(allowed(request("one")));
		expect(admitted).toEqual([]);
		requests.set(request("three"));
		outcomes.set(allowed(request("three")));
		expect(admitted.map((x) => x.requestId)).toEqual(["three"]);
	});

	it("an input's ERROR does not end the runtime; its lifetime still writes back at close", () => {
		// The runtime's terminal policies are manual and its function catches every malformed
		// input, so it never ends by ERROR: an input's ERROR is input, and its lifetime closes when
		// its last subscriber leaves, which writes the ledger.
		const a = build();
		const stop = a.watch();
		a.requests.set(request("one"));
		a.outcomes.set(allowed(request("one")));
		expect(a.admitted).toHaveLength(1);
		a.requests.error({ message: "source failed" });
		expect(a.bundle.admissions.status.output).toBe("open");
		stop();
		const ledger = a.g.checkpoint().nodes.find((n) => n.id === "limit/ledger");
		expect(JSON.stringify(ledger?.values)).toContain('"one"');
		// A new lifetime is seeded from it, so the replay is suppressed.
		a.watch();
		a.outcomes.set(allowed(request("one")));
		expect(a.admitted).toHaveLength(1);
	});
});
