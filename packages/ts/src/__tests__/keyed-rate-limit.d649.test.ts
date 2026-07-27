import { describe, expect, it } from "vitest";

import { attachKeyedRateLimitAuthority, type KeyedRateLimitAuthority } from "../adapters/index.js";
import { graph } from "../graph/index.js";
import { strictCanonicalJsonBytes, strictJsonCodec } from "../json/codec.js";
import type { Node } from "../node/node.js";
import {
	assertKeyedRateLimitOutcome,
	assertKeyedRateLimitRequest,
	assertKeyedRateLimitRequestIdentity,
	createKeyedRateLimitOutcome,
	type KeyedRateLimitAdmission,
	type KeyedRateLimitAuditEntry,
	type KeyedRateLimitCursor,
	type KeyedRateLimitDenial,
	type KeyedRateLimitIssue,
	type KeyedRateLimitOutcome,
	type KeyedRateLimitRequest,
	type KeyedRateLimitStatus,
	keyedRateLimitAdmissionBundle,
	keyedRateLimitRequestIdentity,
} from "../rate-limit/index.js";

function request(
	requestId: string,
	overrides: Partial<KeyedRateLimitRequest> = {},
): KeyedRateLimitRequest {
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
		...overrides,
	});
}

function outcome(
	req: KeyedRateLimitRequest,
	result: "allowed" | "denied" | "unavailable" | "conflict",
	suffix = result,
): KeyedRateLimitOutcome {
	return createKeyedRateLimitOutcome(req, {
		outcomeId: `outcome-${req.requestId}-${suffix}`,
		result,
		remainingUnits: result === "allowed" ? 4 : result === "denied" ? 0 : undefined,
		resetAtMs: result === "allowed" || result === "denied" ? 10_000 : undefined,
		retryAfterMs: result === "denied" ? 2_000 : result === "allowed" ? 0 : undefined,
		provenance: [{ kind: "transaction", id: "consume", revision: "tx-v1" }, req.authority],
	});
}

function capture<T>(node: Node<T>) {
	const values: T[] = [];
	const release = node.subscribe((msg) => {
		if (msg[0] === "DATA") values.push(msg[1] as T);
	});
	return { values, release };
}

function setup(opts: { maxPending?: number; maxCompleted?: number } = {}) {
	const g = graph({ name: "rate-limit-test" });
	const requests = g.node<KeyedRateLimitRequest>([], null, { name: "requests" });
	const outcomes = g.node<KeyedRateLimitOutcome>([], null, { name: "outcomes" });
	const bundle = keyedRateLimitAdmissionBundle(g, {
		name: "limit",
		requests,
		outcomes,
		...opts,
	});
	const admissions = capture(bundle.admissions);
	const denials = capture(bundle.denials);
	const statuses = capture(bundle.status);
	const issues = capture(bundle.issues);
	const audit = capture(bundle.audit);
	const cursor = capture(bundle.cursor);
	return {
		g,
		requests,
		outcomes,
		bundle,
		admissions,
		denials,
		statuses,
		issues,
		audit,
		cursor,
		release() {
			for (const item of [admissions, denials, statuses, issues, audit, cursor]) item.release();
		},
	};
}

describe("D648/D649 strict keyed rate-limit contracts", () => {
	it("creates deterministic strict-canonical identities without handwritten encoding", () => {
		const first = request("r1");
		const reordered = assertKeyedRateLimitRequest({
			units: 1,
			operation: first.operation,
			authority: first.authority,
			policy: first.policy,
			key: first.key,
			requestId: first.requestId,
			version: 1,
			format: "graphrefly.keyedRateLimitRequest",
		});
		const identityA = keyedRateLimitRequestIdentity(first);
		const identityB = keyedRateLimitRequestIdentity(reordered);

		expect(identityA).toEqual(identityB);
		expect(keyedRateLimitRequestIdentity(first)).toEqual(identityA);
		expect(assertKeyedRateLimitRequestIdentity(JSON.parse(JSON.stringify(identityA)))).toEqual(
			identityA,
		);
		expect(
			assertKeyedRateLimitRequest(strictJsonCodec.decode(strictJsonCodec.encode(first))),
		).toEqual(first);
		expect(strictCanonicalJsonBytes({ identityA, first })).toEqual(
			strictCanonicalJsonBytes({ first, identityA }),
		);
	});

	it("rejects unknown fields, runtime handles, functions, BigInt, unsafe numbers, and malformed identities", () => {
		const valid = request("strict");
		expect(() => assertKeyedRateLimitRequest({ ...valid, extra: true })).toThrow();
		expect(() =>
			assertKeyedRateLimitRequest({ ...valid, key: { ...valid.key, fn() {} } }),
		).toThrow();
		expect(() => assertKeyedRateLimitRequest({ ...valid, operation: new Date() })).toThrow();
		expect(() => assertKeyedRateLimitRequest({ ...valid, units: BigInt(1) })).toThrow();
		expect(() =>
			assertKeyedRateLimitRequest({ ...valid, units: Number.MAX_SAFE_INTEGER + 1 }),
		).toThrow();
		expect(() =>
			assertKeyedRateLimitRequestIdentity({
				...keyedRateLimitRequestIdentity(valid),
				key: "{}",
			}),
		).toThrow();
		const escaped = "\u0001".repeat(256);
		expect(() =>
			assertKeyedRateLimitRequest({
				...valid,
				requestId: escaped,
				key: { kind: escaped, id: escaped, revision: escaped },
				policy: {
					id: escaped,
					revision: escaped,
					algorithm: { kind: escaped, revision: escaped },
				},
				authority: { kind: escaped, id: escaped, revision: escaped },
				operation: { kind: escaped, id: escaped, revision: escaped },
			}),
		).toThrow(/canonical identity.*at most 4096/);
	});

	it("normalizes provenance order and rejects malformed or result-inconsistent outcomes", () => {
		const req = request("outcome");
		const allowed = outcome(req, "allowed");
		expect(allowed.provenance.map((item) => item.kind)).toEqual(["quota-store", "transaction"]);
		expect(assertKeyedRateLimitOutcome(JSON.parse(JSON.stringify(allowed)))).toEqual(allowed);
		expect(() => assertKeyedRateLimitOutcome({ ...allowed, reason: "quota-exhausted" })).toThrow();
		expect(() => assertKeyedRateLimitOutcome({ ...allowed, remainingUnits: -1 })).toThrow();
		expect(() => assertKeyedRateLimitOutcome({ ...allowed, canonicalKey: "leak" })).toThrow();
		expect(() =>
			assertKeyedRateLimitOutcome({
				...allowed,
				provenance: Array.from({ length: 33 }, (_, index) => ({
					kind: "source",
					id: String(index),
					revision: "v1",
				})),
			}),
		).toThrow(/at most 32/);
		expect(() => request("x".repeat(257))).toThrow(/at most 256/);
	});
});

describe("D648/D649 bounded admission and exact correlation", () => {
	it("allows one exact request and exposes ready status", () => {
		const t = setup();
		const req = request("allow", {
			policy: {
				id: "public-session",
				revision: "policy-v3",
				algorithm: { kind: "host-owned-algorithm", revision: "opaque-v99" },
			},
		});
		t.requests.down([["DATA", req]]);
		t.outcomes.down([["DATA", outcome(req, "allowed")]]);

		expect(t.admissions.values).toHaveLength(1);
		expect(t.admissions.values[0]).toMatchObject({
			kind: "keyed-rate-limit-admission",
			requestId: "allow",
			operation: req.operation,
			remainingUnits: 4,
		});
		expect(t.denials.values).toEqual([]);
		expect(t.statuses.values.at(-1)).toMatchObject({
			state: "ready",
			result: "allowed",
			reason: "within-limit",
		});
		expect(t.issues.values).toEqual([]);
		t.release();
	});

	it("treats a valid denial as ready rather than a gate failure", () => {
		const t = setup();
		const req = request("deny");
		t.requests.down([["DATA", req]]);
		t.outcomes.down([["DATA", outcome(req, "denied")]]);

		expect(t.admissions.values).toEqual([]);
		expect(t.denials.values).toHaveLength(1);
		expect(t.denials.values[0]).toMatchObject({
			requestId: "deny",
			reason: "quota-exhausted",
			retryAfterMs: 2_000,
		});
		expect(t.statuses.values.at(-1)).toMatchObject({
			state: "ready",
			result: "denied",
			reason: "quota-exhausted",
		});
		expect(t.issues.values).toEqual([]);
		t.release();
	});

	it("correlates concurrent keys and reverse-order outcomes independently", () => {
		const t = setup();
		const a = request("a");
		const b = request("b", {
			key: { kind: "network-key", id: "different-key", revision: "opaque-v1" },
		});
		t.requests.down([
			["DATA", a],
			["DATA", b],
		]);
		t.outcomes.down([
			["DATA", outcome(b, "denied")],
			["DATA", outcome(a, "allowed")],
		]);

		expect(t.admissions.values.map((item) => item.requestId)).toEqual(["a"]);
		expect(t.denials.values.map((item) => item.requestId)).toEqual(["b"]);
		expect(t.cursor.values.at(-1)).toMatchObject({
			pending: 0,
			allowed: 1,
			denied: 1,
		});
		t.release();
	});

	it("fails closed when a request id is reused with changed key, policy, authority, operation, or units", () => {
		for (const [label, changed] of [
			["key", { key: { kind: "network-key", id: "other", revision: "opaque-v1" } }],
			[
				"policy",
				{
					policy: {
						id: "public-session",
						revision: "policy-v4",
						algorithm: { kind: "fixed-window", revision: "algorithm-v1" },
					},
				},
			],
			["authority", { authority: { kind: "quota-store", id: "replica", revision: "schema-v2" } }],
			["operation", { operation: { kind: "public-session", id: "other", revision: "intent-v1" } }],
			["units", { units: 2 }],
		] as const) {
			const t = setup();
			const original = request(`reuse-${label}`);
			const replacement = request(`reuse-${label}`, changed);
			t.requests.down([
				["DATA", original],
				["DATA", replacement],
			]);
			expect(t.admissions.values).toEqual([]);
			expect(t.issues.values.map((item) => item.code)).toContain(
				"keyed-rate-limit-request-conflict",
			);
			t.release();
		}
	});

	it("rejects stale request identity and mismatched authority without completing the pending request", () => {
		const t = setup();
		const current = request("stale");
		const stale = request("stale", {
			policy: {
				id: "public-session",
				revision: "policy-v2",
				algorithm: { kind: "fixed-window", revision: "algorithm-v1" },
			},
		});
		t.requests.down([["DATA", current]]);
		t.outcomes.down([["DATA", outcome(stale, "allowed")]]);
		const authorityMismatch = {
			...outcome(current, "allowed", "wrong-authority"),
			authority: { kind: "quota-store", id: "replica", revision: "schema-v2" },
		} as KeyedRateLimitOutcome;
		t.outcomes.down([["DATA", authorityMismatch]]);

		expect(t.admissions.values).toEqual([]);
		expect(t.issues.values.map((item) => item.code)).toEqual([
			"keyed-rate-limit-outcome-mismatch",
			"keyed-rate-limit-outcome-mismatch",
		]);
		expect(t.cursor.values.at(-1)).toMatchObject({ pending: 1, mismatched: 2 });
		t.release();
	});

	it("suppresses identical live replays and rejects conflicting outcomes", () => {
		const t = setup();
		const req = request("replay");
		const allowed = outcome(req, "allowed");
		t.requests.down([["DATA", req]]);
		t.outcomes.down([
			["DATA", allowed],
			["DATA", allowed],
		]);
		t.requests.down([["DATA", req]]);
		t.outcomes.down([["DATA", outcome(req, "denied", "conflicting")]]);

		expect(t.admissions.values).toHaveLength(1);
		expect(t.denials.values).toEqual([]);
		expect(t.issues.values.map((item) => item.code)).toContain("keyed-rate-limit-outcome-conflict");
		expect(t.cursor.values.at(-1)).toMatchObject({ allowed: 1, replays: 2, conflicts: 1 });
		t.release();
	});

	it("retains replay suppression across deactivate and resubscribe of the same live gate", () => {
		const t = setup();
		const req = request("reactivate");
		t.requests.down([["DATA", req]]);
		t.outcomes.down([["DATA", outcome(req, "allowed")]]);
		expect(t.admissions.values).toHaveLength(1);
		t.release();

		const replayedAdmissions = capture(t.bundle.admissions);
		expect(replayedAdmissions.values).toEqual([]);
		replayedAdmissions.release();
	});

	it("derives admission and denial identities from both request and outcome coordinates", () => {
		const t = setup();
		const allowedA = request("identity-a");
		const allowedB = request("identity-b");
		const sharedOutcomeId = "authority-local-outcome";
		t.requests.down([
			["DATA", allowedA],
			["DATA", allowedB],
		]);
		t.outcomes.down([
			["DATA", { ...outcome(allowedA, "allowed"), outcomeId: sharedOutcomeId }],
			["DATA", { ...outcome(allowedB, "allowed"), outcomeId: sharedOutcomeId }],
		]);

		expect(t.admissions.values).toHaveLength(2);
		expect(t.admissions.values[0]?.admissionId).not.toBe(t.admissions.values[1]?.admissionId);
		t.release();
	});

	it("fails closed for malformed, orphaned, unavailable, and authority-conflict outcomes", () => {
		const t = setup();
		const unavailable = request("unavailable");
		const conflict = request("conflict");
		t.requests.down([
			["DATA", { ...request("malformed"), unknown: true } as KeyedRateLimitRequest],
			["DATA", unavailable],
			["DATA", conflict],
		]);
		t.outcomes.down([
			[
				"DATA",
				{
					...outcome(unavailable, "allowed"),
					retryAfterMs: BigInt(1),
				} as unknown as KeyedRateLimitOutcome,
			],
			["DATA", outcome(request("orphan"), "allowed")],
			["DATA", outcome(unavailable, "unavailable")],
			["DATA", outcome(conflict, "conflict")],
		]);

		expect(t.admissions.values).toEqual([]);
		expect(t.denials.values).toEqual([]);
		expect(t.issues.values.map((item) => item.code)).toEqual(
			expect.arrayContaining([
				"keyed-rate-limit-malformed-request",
				"keyed-rate-limit-malformed-outcome",
				"keyed-rate-limit-orphan-outcome",
				"keyed-rate-limit-authority-unavailable",
				"keyed-rate-limit-request-conflict",
			]),
		);
		expect(t.statuses.values.filter((item) => item.state === "ready")).toEqual([]);
		t.release();
	});

	it("bounds pending and completed state and makes the retained replay horizon observable", () => {
		const t = setup({ maxPending: 1, maxCompleted: 1 });
		const a = request("bounded-a");
		const b = request("bounded-b");
		const c = request("bounded-c");
		t.requests.down([
			["DATA", a],
			["DATA", b],
		]);
		expect(t.issues.values.map((item) => item.code)).toContain("keyed-rate-limit-request-overflow");
		expect(t.cursor.values.at(-1)).toMatchObject({ pending: 1, overflowed: 1 });

		t.outcomes.down([["DATA", outcome(a, "allowed")]]);
		t.requests.down([["DATA", c]]);
		t.outcomes.down([["DATA", outcome(c, "denied")]]);
		expect(t.cursor.values.at(-1)).toMatchObject({
			pending: 0,
			completedRetained: 1,
			completedEvicted: 1,
		});

		t.outcomes.down([["DATA", outcome(a, "allowed")]]);
		expect(t.admissions.values).toHaveLength(1);
		expect(t.issues.values.map((item) => item.code)).toContain("keyed-rate-limit-orphan-outcome");

		t.requests.down([["DATA", a]]);
		t.outcomes.down([["DATA", outcome(a, "allowed")]]);
		expect(t.admissions.values).toHaveLength(2);
		expect(t.cursor.values.at(-1)).toMatchObject({ completedEvicted: 2, allowed: 2 });
		t.release();
	});

	it("does not leak opaque key, canonical identity, or operation coordinates through issue/audit", () => {
		const t = setup();
		const req = request("private", {
			key: { kind: "network-key", id: "PRIVATE-KEY-MATERIAL", revision: "opaque-v1" },
			operation: {
				kind: "private-operation",
				id: "PRIVATE-OPERATION-MATERIAL",
				revision: "intent-v1",
			},
		});
		const identity = keyedRateLimitRequestIdentity(req);
		t.requests.down([["DATA", req]]);
		t.outcomes.down([["DATA", outcome(req, "unavailable")]]);

		const diagnostics = JSON.stringify({
			issues: t.issues.values,
			audit: t.audit.values,
			status: t.statuses.values,
			cursor: t.cursor.values,
		});
		expect(diagnostics).not.toContain("PRIVATE-KEY-MATERIAL");
		expect(diagnostics).not.toContain("PRIVATE-OPERATION-MATERIAL");
		expect(diagnostics).not.toContain(identity.key);
		t.release();
	});
});

describe("D648/D649 host authority adapter and topology", () => {
	it("composes synchronous host consume into exact admission without a raw-request bypass", () => {
		const g = graph({ name: "authority-topology" });
		const requests = g.node<KeyedRateLimitRequest>([], null, { name: "requests" });
		const authority = attachKeyedRateLimitAuthority(
			g,
			requests,
			{
				consume(req, complete) {
					complete(outcome(req, "allowed"));
				},
			},
			{ name: "authority" },
		);
		const gate = authority.admission;
		const protectedEffect = g.effect([gate.admissions], () => {}, { name: "protected-effect" });
		const admissions = capture(gate.admissions);
		const effectRelease = protectedEffect.subscribe(() => {});

		requests.down([["DATA", request("topology")]]);
		expect(admissions.values).toHaveLength(1);

		const topology = g.describe();
		const edge = (from: string, to: string) =>
			topology.edges.some((candidate) => candidate.from === from && candidate.to === to);
		expect(edge("requests", "authority/events")).toBe(true);
		expect(edge("authority/events", "authority/authority-requests")).toBe(true);
		expect(edge("authority/events", "authority/outcomes")).toBe(true);
		expect(edge("authority/events", "authority/correlation-facts")).toBe(true);
		expect(edge("authority/correlation-facts", "authority/admission/runtime")).toBe(true);
		expect(edge("requests", "authority/admission/runtime")).toBe(false);
		expect(edge("authority/admission/admissions", "protected-effect")).toBe(true);
		expect(edge("requests", "protected-effect")).toBe(false);
		expect(topology.nodes.find((node) => node.id === "authority/admission/runtime")?.factory).toBe(
			"keyedRateLimitAdmission",
		);
		expect(topology.nodes.find((node) => node.id === "authority/events")?.factory).toBe(
			"attachKeyedRateLimitAuthority",
		);

		admissions.release();
		effectRelease();
	});

	it("does not lose a synchronous outcome when the composed gate activates over cached input", () => {
		const g = graph();
		const requests = g.node<KeyedRateLimitRequest>([], null);
		const adapter = attachKeyedRateLimitAuthority(g, requests, {
			consume(req, complete) {
				complete(outcome(req, "allowed"));
			},
		});
		requests.down([["DATA", request("late-activation")]]);

		const admissions = capture(adapter.admission.admissions);
		expect(admissions.values.map((item) => item.requestId)).toEqual(["late-activation"]);
		admissions.release();
	});

	it("turns thrown or malformed host results into visible unavailable outcomes without leaking errors", () => {
		for (const mode of ["throw", "malformed"] as const) {
			const g = graph();
			const requests = g.node<KeyedRateLimitRequest>([], null);
			const adapter = attachKeyedRateLimitAuthority(g, requests, {
				consume(_req, complete) {
					if (mode === "throw") throw new Error("PRIVATE HOST ERROR");
					complete({ bad: "PRIVATE HOST OUTCOME" } as unknown as KeyedRateLimitOutcome);
				},
			});
			const gate = adapter.admission;
			const admissions = capture(gate.admissions);
			const issues = capture(gate.issues);
			const errors = capture(adapter.errors);

			requests.down([["DATA", request(`adapter-${mode}`)]]);
			expect(admissions.values).toEqual([]);
			expect(issues.values.map((item) => item.code)).toContain(
				"keyed-rate-limit-authority-unavailable",
			);
			expect(errors.values).toHaveLength(1);
			expect(JSON.stringify({ issues: issues.values, errors: errors.values })).not.toContain(
				"PRIVATE HOST",
			);
			admissions.release();
			issues.release();
			errors.release();
		}
	});

	it("cancels host-private pending work on graph deactivation", () => {
		const g = graph();
		const requests = g.node<KeyedRateLimitRequest>([], null);
		let cancelled = 0;
		const adapter = attachKeyedRateLimitAuthority(g, requests, {
			consume() {
				return () => {
					cancelled += 1;
				};
			},
		});
		const statuses = capture(adapter.status);
		requests.down([["DATA", request("cancel")]]);
		expect(statuses.values.at(-1)?.state).toBe("requested");
		statuses.release();
		expect(cancelled).toBe(1);
	});

	it("bounds authority work before consume and exposes overflow without quota work", () => {
		const g = graph();
		const requests = g.node<KeyedRateLimitRequest>([], null);
		let consumes = 0;
		const adapter = attachKeyedRateLimitAuthority(
			g,
			requests,
			{
				consume() {
					consumes += 1;
				},
			},
			{ maxInFlight: 1 },
		);
		const authorityRequests = capture(adapter.authorityRequests);
		const errors = capture(adapter.errors);
		const statuses = capture(adapter.status);
		const cursor = capture(adapter.cursor);
		const admissions = capture(adapter.admission.admissions);

		requests.down([
			["DATA", request("bounded-authority-a")],
			["DATA", request("bounded-authority-b")],
		]);

		expect(consumes).toBe(1);
		expect(authorityRequests.values.map((item) => item.requestId)).toEqual(["bounded-authority-a"]);
		expect(errors.values.at(-1)).toMatchObject({ code: "request-overflow" });
		expect(statuses.values.at(-1)).toMatchObject({ inFlight: 1, overflowed: 1 });
		expect(cursor.values.at(-1)).toMatchObject({
			requested: 1,
			inFlight: 1,
			overflowed: 1,
		});
		expect(admissions.values).toEqual([]);
		for (const captured of [authorityRequests, errors, statuses, cursor, admissions])
			captured.release();
	});

	it("settles a mismatched callback fail-closed without adapter/gate pending drift", () => {
		const g = graph();
		const requests = g.node<KeyedRateLimitRequest>([], null);
		let consumes = 0;
		const adapter = attachKeyedRateLimitAuthority(
			g,
			requests,
			{
				consume(req, complete) {
					consumes += 1;
					if (req.requestId === "mismatch-a") {
						complete(outcome(request("different-request"), "allowed"));
						return;
					}
					complete(outcome(req, "allowed"));
				},
			},
			{ maxInFlight: 1 },
		);
		const admissions = capture(adapter.admission.admissions);
		const issues = capture(adapter.admission.issues);
		const errors = capture(adapter.errors);
		const cursor = capture(adapter.cursor);

		requests.down([
			["DATA", request("mismatch-a")],
			["DATA", request("mismatch-b")],
		]);

		expect(consumes).toBe(2);
		expect(admissions.values.map((item) => item.requestId)).toEqual(["mismatch-b"]);
		expect(issues.values.map((item) => item.code)).toContain(
			"keyed-rate-limit-authority-unavailable",
		);
		expect(errors.values.map((item) => item.code)).toContain("outcome-mismatch");
		expect(cursor.values.at(-1)).toMatchObject({ inFlight: 0, failed: 1, settled: 1 });
		for (const captured of [admissions, issues, errors, cursor]) captured.release();
	});

	it("does not start authority work after requested delivery deactivates the adapter", () => {
		const g = graph();
		const requests = g.node<KeyedRateLimitRequest>([], null);
		let consumes = 0;
		const adapter = attachKeyedRateLimitAuthority(g, requests, {
			consume() {
				consumes += 1;
			},
		});
		let release = () => {};
		release = adapter.status.subscribe((msg) => {
			if (msg[0] === "DATA" && msg[1].state === "requested") release();
		});

		requests.down([["DATA", request("deactivate-before-consume")]]);
		expect(consumes).toBe(0);
	});

	it("does not swallow synchronous completion propagation errors", () => {
		const g = graph();
		const requests = g.node<KeyedRateLimitRequest>([], null);
		const adapter = attachKeyedRateLimitAuthority(g, requests, {
			consume(req, complete) {
				complete(outcome(req, "allowed"));
			},
		});
		const release = adapter.outcomes.subscribe((msg) => {
			if (msg[0] === "DATA") throw new Error("downstream delivery failed");
		});

		expect(() => requests.down([["DATA", request("delivery-error")]])).toThrow(
			"downstream delivery failed",
		);
		release();
	});

	it("rethrows completion propagation errors even when the host catches the callback throw", () => {
		const g = graph();
		const requests = g.node<KeyedRateLimitRequest>([], null);
		const adapter = attachKeyedRateLimitAuthority(g, requests, {
			consume(req, complete) {
				try {
					complete(outcome(req, "allowed"));
				} catch {
					// A hostile host must not be able to erase Graph delivery failure.
				}
			},
		});
		const release = adapter.outcomes.subscribe((msg) => {
			if (msg[0] === "DATA") throw new Error("caught delivery failed");
		});

		expect(() => requests.down([["DATA", request("caught-delivery-error")]])).toThrow(
			"caught delivery failed",
		);
		release();
	});

	it("relies on host idempotent consume while suppressing repeated live admissions", () => {
		const g = graph();
		const requests = g.node<KeyedRateLimitRequest>([], null);
		const decisions = new Map<string, KeyedRateLimitOutcome>();
		let durableConsumes = 0;
		const authority: KeyedRateLimitAuthority = {
			consume(req, complete) {
				let decided = decisions.get(req.requestId);
				if (decided === undefined) {
					durableConsumes += 1;
					decided = outcome(req, "allowed");
					decisions.set(req.requestId, decided);
				}
				complete(decided);
			},
		};
		const adapter = attachKeyedRateLimitAuthority(g, requests, authority);
		const gate = adapter.admission;
		const admissions = capture(gate.admissions);
		const req = request("idempotent");
		requests.down([
			["DATA", req],
			["DATA", req],
		]);

		expect(durableConsumes).toBe(1);
		expect(admissions.values).toHaveLength(1);
		admissions.release();
	});
});

type _PublicFocusedTypes = [
	KeyedRateLimitAdmission,
	KeyedRateLimitDenial,
	KeyedRateLimitStatus,
	KeyedRateLimitIssue,
	KeyedRateLimitAuditEntry,
	KeyedRateLimitCursor,
];
