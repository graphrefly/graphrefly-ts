import { describe, expect, it } from "vitest";
import type { DataIssue } from "../data/index.js";
import { graph } from "../graph/graph.js";
import type {
	ScheduledReadinessClock,
	ScheduledReadinessOverdue,
	ScheduledReadinessPending,
	ScheduledReadinessReady,
	ScheduledReadinessRequested,
	ScheduledReadinessStatus,
	ScheduledReadinessViews,
} from "../orchestration/index.js";
import { scheduledReadinessProjector } from "../orchestration/index.js";

describe("scheduledReadinessProjector (D424)", () => {
	it("keeps a schedule pending until an explicit clock reaches readyAtMs", () => {
		const harness = createHarness();
		const schedule = readiness("sched-pending", 1_000);

		harness.schedules.down([["DATA", schedule]]);
		expect(harness.seen.pending).toEqual([
			expect.objectContaining({ scheduleId: "sched-pending", readyAtMs: 1_000 }),
		]);
		expect(harness.seen.ready).toEqual([]);

		harness.clocks.down([["DATA", clock(999)]]);
		expect(harness.seen.ready).toEqual([]);
		harness.clocks.down([["DATA", clock(999.5)]]);
		expect(harness.seen.ready).toEqual([]);
		expect(
			harness.seen.status.filter(
				(status) => status.scheduleId === "sched-pending" && status.state === "pending",
			),
		).toHaveLength(3);
		expect(
			harness.seen.status
				.filter((status) => status.scheduleId === "sched-pending" && status.state === "pending")
				.map((status) => status.nowMs),
		).toEqual([undefined, 999, 999.5]);
		expect(harness.seen.status).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ scheduleId: "sched-pending", state: "pending" }),
			]),
		);
		expect(harness.seen.views.at(-1)?.statusById.get("sched-pending")).toEqual(
			expect.objectContaining({ scheduleId: "sched-pending", state: "pending", nowMs: 999.5 }),
		);

		harness.clocks.down([["DATA", clock(1_000)]]);
		expect(harness.seen.ready).toEqual([
			expect.objectContaining({ scheduleId: "sched-pending", readyAtMs: 1_000, nowMs: 1_000 }),
		]);
	});

	it("emits ready once when schedules or clocks replay", () => {
		const harness = createHarness();
		const schedule = readiness("sched-replay", 10);

		harness.schedules.down([["DATA", schedule]]);
		harness.clocks.down([["DATA", clock(10)]]);
		harness.schedules.down([["DATA", schedule]]);
		harness.clocks.down([["DATA", clock(10)]]);

		expect(harness.seen.ready).toHaveLength(1);
		expect(harness.seen.status.filter((status) => status.state === "ready")).toHaveLength(1);
		expect(
			harness.seen.audit.filter((audit) => audit.kind === "scheduled-readiness-ready"),
		).toHaveLength(1);
	});

	it("handles clock before schedule and schedule before clock", () => {
		const first = createHarness();
		first.clocks.down([["DATA", clock(100)]]);
		first.schedules.down([["DATA", readiness("clock-first", 100)]]);
		expect(first.seen.ready).toEqual([expect.objectContaining({ scheduleId: "clock-first" })]);

		const second = createHarness();
		second.schedules.down([["DATA", readiness("schedule-first", 100)]]);
		second.clocks.down([["DATA", clock(100)]]);
		expect(second.seen.ready).toEqual([expect.objectContaining({ scheduleId: "schedule-first" })]);
	});

	it("does not un-ready or duplicate ready after clock rollback", () => {
		const harness = createHarness();
		harness.schedules.down([["DATA", readiness("rollback", 100)]]);
		harness.clocks.down([["DATA", clock(100)]]);
		harness.clocks.down([["DATA", clock(90, "clock-rollback")]]);
		harness.clocks.down([["DATA", clock(110)]]);

		expect(harness.seen.ready).toHaveLength(1);
		expect(harness.seen.issues).toEqual([
			expect.objectContaining({ code: "scheduled-readiness-clock-rollback" }),
		]);
		expect(harness.seen.views.at(-1)?.readyById.has("rollback")).toBe(true);
	});

	it("emits visible issue/status for malformed schedules and no ready fact", () => {
		const harness = createHarness();
		harness.schedules.down([
			[
				"DATA",
				{
					kind: "scheduled-readiness-requested",
					scheduleId: "bad-schedule",
					sourceRefs: [{ kind: "source", id: "bad" }],
				} as ScheduledReadinessRequested,
			],
		]);
		harness.clocks.down([["DATA", clock(100)]]);

		expect(harness.seen.ready).toEqual([]);
		expect(harness.seen.issues).toEqual([
			expect.objectContaining({ code: "scheduled-readiness-malformed-schedule" }),
		]);
		expect(harness.seen.status).toEqual([
			expect.objectContaining({ scheduleId: "bad-schedule", state: "issue" }),
		]);
	});

	it("emits visible issues for non-object schedule and clock facts", () => {
		const harness = createHarness();
		harness.schedules.down([["DATA", null as unknown as ScheduledReadinessRequested]]);
		harness.clocks.down([["DATA", null as unknown as ScheduledReadinessClock]]);

		expect(harness.seen.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "scheduled-readiness-malformed-schedule" }),
				expect.objectContaining({ code: "scheduled-readiness-malformed-clock" }),
			]),
		);
		expect(harness.seen.status).toEqual([
			expect.objectContaining({ scheduleId: "unknown-scheduled-readiness", state: "issue" }),
		]);
	});

	it("fails closed for non-object malformed schedule and clock facts", () => {
		const harness = createHarness();

		harness.schedules.down([["DATA", null as unknown as ScheduledReadinessRequested]]);
		harness.clocks.down([["DATA", null as unknown as ScheduledReadinessClock]]);

		expect(harness.seen.ready).toEqual([]);
		expect(harness.seen.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "scheduled-readiness-malformed-schedule" }),
				expect.objectContaining({ code: "scheduled-readiness-malformed-clock" }),
			]),
		);
	});

	it("fails closed for malformed schedule and clock ref fields", () => {
		const harness = createHarness();

		harness.schedules.down([
			[
				"DATA",
				{
					...readiness("bad-refs", 10),
					sourceRefs: { kind: "not-array", id: "bad" },
				} as unknown as ScheduledReadinessRequested,
			],
		]);
		harness.clocks.down([
			[
				"DATA",
				{
					...clock(10),
					sourceRefs: { kind: "not-array", id: "bad-clock" },
				} as unknown as ScheduledReadinessClock,
			],
		]);

		expect(harness.seen.ready).toEqual([]);
		expect(harness.seen.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "scheduled-readiness-malformed-schedule" }),
				expect.objectContaining({ code: "scheduled-readiness-malformed-clock" }),
			]),
		);
	});

	it("rejects stale subjectRef and notBeforeMs aliases", () => {
		const harness = createHarness();

		harness.schedules.down([
			[
				"DATA",
				{
					kind: "scheduled-readiness-requested",
					scheduleId: "stale-aliases",
					subjectRef: { kind: "subject", id: "stale-aliases" },
					notBeforeMs: 10,
				} as unknown as ScheduledReadinessRequested,
			],
		]);
		harness.clocks.down([["DATA", clock(10)]]);

		expect(harness.seen.ready).toEqual([]);
		expect(harness.seen.issues).toEqual([
			expect.objectContaining({ code: "scheduled-readiness-malformed-schedule" }),
		]);
	});

	it("keeps the first valid schedule when a scheduleId replays with conflicting material", () => {
		const harness = createHarness();
		harness.schedules.down([["DATA", readiness("conflict", 10)]]);
		harness.clocks.down([["DATA", clock(10)]]);

		harness.schedules.down([["DATA", readiness("conflict", 20)]]);

		expect(harness.seen.ready).toHaveLength(1);
		expect(harness.seen.ready[0]).toEqual(
			expect.objectContaining({ scheduleId: "conflict", readyAtMs: 10 }),
		);
		expect(harness.seen.issues).toEqual([
			expect.objectContaining({ code: "scheduled-readiness-schedule-conflict" }),
		]);
		expect(harness.seen.status).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					scheduleId: "conflict",
					state: "issue",
					issueCodes: ["scheduled-readiness-schedule-conflict"],
				}),
			]),
		);
		expect(harness.seen.views.at(-1)?.readyById.get("conflict")).toEqual(
			expect.objectContaining({ readyAtMs: 10 }),
		);
	});

	it("emits overdue without executing, claiming, admitting, or requesting work", () => {
		const harness = createHarness();
		harness.schedules.down([
			["DATA", { ...readiness("overdue", 100), deadlineMs: 90, reason: "retry-backoff" }],
		]);
		harness.clocks.down([["DATA", clock(100)]]);

		expect(harness.seen.ready).toHaveLength(1);
		expect(harness.seen.overdue).toEqual([
			expect.objectContaining({ scheduleId: "overdue", deadlineMs: 90, nowMs: 100 }),
		]);
		const serialized = JSON.stringify({
			pending: harness.seen.pending,
			ready: harness.seen.ready,
			overdue: harness.seen.overdue,
			status: harness.seen.status,
		});
		expect(serialized).not.toContain("tool-provider-adapter-run-requested");
		expect(serialized).not.toContain("claim");
		expect(serialized).not.toContain("admission");
	});

	it("bounds public metadata and source refs", () => {
		const harness = createHarness();
		const raw = "x".repeat(10_000);
		harness.schedules.down([
			[
				"DATA",
				{
					...readiness("redaction", 1),
					sourceRefs: [{ kind: "source", id: "redaction", metadata: { apiKey: "SECRET" } }],
					metadata: { rawResponseBody: raw, small: "ok" },
				},
			],
		]);
		harness.clocks.down([["DATA", clock(1)]]);

		const serialized = JSON.stringify(harness.seen.ready[0]);
		expect(serialized).not.toContain("SECRET");
		expect(serialized).not.toContain(raw);
		expect(serialized.length).toBeLessThan(2_000);
		expect(harness.seen.ready[0]?.metadata).toEqual({ small: "ok" });
	});
});

function createHarness() {
	const g = graph();
	const schedules = g.node<ScheduledReadinessRequested>([], null, {
		name: "scheduled-readiness-schedules",
	});
	const clocks = g.node<ScheduledReadinessClock>([], null, {
		name: "scheduled-readiness-clocks",
	});
	const bundle = scheduledReadinessProjector(g, { schedules: [schedules], clocks: [clocks] });
	return {
		schedules,
		clocks,
		seen: {
			pending: collectData<ScheduledReadinessPending>(bundle.pending),
			ready: collectData<ScheduledReadinessReady>(bundle.ready),
			overdue: collectData<ScheduledReadinessOverdue>(bundle.overdue),
			status: collectData<ScheduledReadinessStatus>(bundle.status),
			issues: collectData<DataIssue>(bundle.issues),
			audit: collectData<{ readonly kind: string }>(bundle.audit),
			views: collectData<ScheduledReadinessViews>(bundle.views),
		},
	};
}

function readiness(scheduleId: string, readyAtMs: number): ScheduledReadinessRequested {
	return {
		kind: "scheduled-readiness-requested",
		scheduleId,
		subjectRefs: [{ kind: "subject", id: scheduleId }],
		readyAtMs,
		sourceRefs: [{ kind: "test", id: scheduleId }],
	};
}

function clock(nowMs: number, clockId = "test-clock"): ScheduledReadinessClock {
	return {
		kind: "scheduled-readiness-clock",
		clockId,
		nowMs,
		sourceRefs: [{ kind: "clock", id: clockId }],
	};
}

function collectData<T>(node: {
	subscribe(sink: (msg: readonly [string, unknown?]) => void): unknown;
}): T[] {
	const out: T[] = [];
	node.subscribe((msg) => {
		if (msg[0] === "DATA") out.push(msg[1] as T);
	});
	return out;
}
