import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import {
	backoffDelayMs,
	breakerBundle,
	rateLimitBundle,
	retryPolicy,
	retryStatusBundle,
} from "../orchestration/index.js";

describe("graph-visible resilience bundles (D132)", () => {
	it("shares bounded retry/backoff policy semantics", () => {
		const policy = retryPolicy(3, {
			kind: "linear",
			initialMs: 10,
			stepMs: 5,
			maxMs: 18,
		});
		expect(backoffDelayMs(policy.backoff, 1)).toBe(10);
		expect(backoffDelayMs(policy.backoff, 3)).toBe(18);
	});

	it("projects retry and breaker status from graph-visible event facts", () => {
		const g = graph();
		const events = g.node<{
			kind: "attempt" | "failure" | "success";
			attempt?: number;
			error?: unknown;
		}>([], null, { name: "resilience/events" });
		const retry = retryStatusBundle(g, events, {
			name: "retry",
			policy: retryPolicy(2, { kind: "constant", delayMs: 25 }),
		});
		const breaker = breakerBundle(g, events, {
			name: "breaker",
			failureThreshold: 1,
			now: () => 100,
		});
		const retryStatuses: unknown[] = [];
		const breakerStatuses: unknown[] = [];
		retry.status.subscribe((msg) => retryStatuses.push(msg));
		breaker.status.subscribe((msg) => breakerStatuses.push(msg));

		events.down([["DATA", { kind: "attempt", attempt: 1 }]]);
		events.down([["DATA", { kind: "failure", attempt: 1, error: "nope" }]]);

		expect(retryStatuses.at(-1)).toEqual([
			"DATA",
			{ state: "failed", attempt: 1, maxAttempts: 2, delayMs: 25 },
		]);
		expect(breakerStatuses.at(-1)).toEqual([
			"DATA",
			{ state: "open", failures: 1, openedAtMs: 100 },
		]);
	});

	it("rate-limits DATA while exposing allowed/dropped/status nodes", () => {
		let now = 0;
		const g = graph();
		const source = g.node<number>([], null, { name: "source" });
		const bundle = rateLimitBundle(g, source, {
			name: "limit",
			max: 2,
			windowMs: 100,
			now: () => now,
		});
		const allowed: unknown[] = [];
		const dropped: unknown[] = [];
		const statuses: unknown[] = [];
		bundle.allowed.subscribe((msg) => allowed.push(msg));
		bundle.dropped.subscribe((msg) => dropped.push(msg));
		bundle.status.subscribe((msg) => statuses.push(msg));

		source.down([
			["DATA", 1],
			["DATA", 2],
			["DATA", 3],
		]);
		now = 101;
		source.down([["DATA", 4]]);

		expect(allowed.filter((msg) => Array.isArray(msg) && msg[0] === "DATA")).toEqual([
			["DATA", 1],
			["DATA", 2],
			["DATA", 4],
		]);
		expect(dropped).toContainEqual(["DATA", 3]);
		expect(statuses.at(-1)).toEqual([
			"DATA",
			{ allowed: 3, dropped: 1, remaining: 1, resetAtMs: 201 },
		]);
	});
});
