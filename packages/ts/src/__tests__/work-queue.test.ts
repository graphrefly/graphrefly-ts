import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import { messageBus } from "../messaging/index.js";
import { workQueue } from "../work-queue/index.js";

describe("workQueue messageBus-backed lifecycle (D299-D324/D325)", () => {
	it("admits submitted work through messageBus and advances ingestion ack after durable record", () => {
		const g = graph();
		const now = 100;
		const bus = messageBus(g, { topics: ["work"], name: "bus", now: () => now });
		const queue = workQueue<{ id: string }>(g, {
			queueId: "q",
			bus,
			topic: "work",
			subscriptionId: "q-admit",
			now: () => now,
		});
		const records: unknown[] = [];
		const cursor: unknown[] = [];
		queue.records.subscribe((msg) => records.push(msg));
		bus
			.subscription({ topic: "work", subscriptionId: "q-admit" })
			.cursor.subscribe((msg) => cursor.push(msg));

		queue.submit({ id: "a" });

		expect(records).toContainEqual([
			"DATA",
			expect.objectContaining({
				kind: "work-admitted",
				queueId: "q",
				workId: "q:work:1",
				payload: { id: "a" },
				messageBus: { topic: "work", seq: 1, subscriptionId: "q-admit" },
			}),
		]);
		expect(cursor.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ topic: "work", subscriptionId: "q-admit", nextSeq: 2 }),
		]);
		expect(g.describe().nodes).toContainEqual(
			expect.objectContaining({
				id: "workQueue/q/admissionAckCommands",
				factory: "workQueueAdmissionAckCommands",
			}),
		);
	});

	it("admits retained backlog through subscription.available rather than helper cache ack", () => {
		const g = graph();
		const bus = messageBus(g, { topics: ["work"], name: "bus", now: () => 101 });
		bus.publish("work", { id: "before" });
		const queue = workQueue<{ id: string }>(g, {
			queueId: "q",
			bus,
			topic: "work",
			subscriptionId: "q-admit",
			now: () => 101,
		});
		const records: unknown[] = [];
		const cursor: unknown[] = [];
		queue.records.subscribe((msg) => records.push(msg));
		bus
			.subscription({ topic: "work", subscriptionId: "q-admit" })
			.cursor.subscribe((msg) => cursor.push(msg));

		expect(records).toContainEqual([
			"DATA",
			expect.objectContaining({
				kind: "work-admitted",
				workId: "q:work:1",
				payload: { id: "before" },
			}),
		]);
		expect(cursor.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ topic: "work", subscriptionId: "q-admit", nextSeq: 2 }),
		]);
	});

	it("claim races resolve by record order and stale claims emit issues", () => {
		const g = graph();
		const bus = messageBus(g, { topics: ["work"], name: "bus", now: () => 1 });
		const queue = workQueue<{ id: string }>(g, {
			queueId: "q",
			bus,
			topic: "work",
			subscriptionId: "q-admit",
			now: () => 1,
		});
		const records: unknown[] = [];
		const issues: unknown[] = [];
		queue.records.subscribe((msg) => records.push(msg));
		queue.issues.subscribe((msg) => issues.push(msg));

		queue.submit({ id: "a" });
		queue.claim({ workerId: "w1", requestedWorkIds: ["q:work:1"], commandId: "claim-1" });
		queue.claim({ workerId: "w2", requestedWorkIds: ["q:work:1"], commandId: "claim-2" });

		expect(records).toContainEqual([
			"DATA",
			expect.objectContaining({ kind: "work-claimed", workId: "q:work:1", workerId: "w1" }),
		]);
		expect(issues.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ code: "not-ready", source: "workQueue" }),
		]);
	});

	it("renews, releases, reclaims, completes, and rejects stale lease callbacks", () => {
		const g = graph();
		const now = 10;
		const bus = messageBus(g, { topics: ["work"], name: "bus", now: () => now });
		const queue = workQueue<{ id: string }>(g, {
			queueId: "q",
			bus,
			topic: "work",
			subscriptionId: "q-admit",
			now: () => now,
			leaseDurationMs: 10,
		});
		const records: unknown[] = [];
		const issues: unknown[] = [];
		queue.records.subscribe((msg) => records.push(msg));
		queue.issues.subscribe((msg) => issues.push(msg));

		queue.submit({ id: "a" });
		queue.claim({ workerId: "w1", commandId: "claim-1" });
		queue.renewLease({
			workId: "q:work:1",
			leaseId: "q:work:1:lease:1",
			attempt: 1,
			workerId: "w1",
			commandId: "renew-1",
			leaseDurationMs: 20,
		});
		queue.release({
			workId: "q:work:1",
			leaseId: "q:work:1:lease:1",
			attempt: 1,
			workerId: "w1",
			commandId: "release-1",
		});
		queue.claim({ workerId: "w2", commandId: "claim-2" });
		queue.complete({
			workId: "q:work:1",
			leaseId: "q:work:1:lease:2",
			attempt: 2,
			workerId: "w2",
			commandId: "complete-1",
			result: { ok: true },
		});
		queue.fail({
			workId: "q:work:1",
			leaseId: "q:work:1:lease:2",
			attempt: 2,
			workerId: "w2",
			commandId: "fail-stale",
		});

		expect(records).toContainEqual([
			"DATA",
			expect.objectContaining({ kind: "lease-renewed", leaseExpiresAtMs: 30 }),
		]);
		expect(records).toContainEqual([
			"DATA",
			expect.objectContaining({ kind: "work-released", workId: "q:work:1" }),
		]);
		expect(records).toContainEqual([
			"DATA",
			expect.objectContaining({ kind: "work-completed", result: { ok: true } }),
		]);
		expect(issues.at(-1)).toEqual(["DATA", expect.objectContaining({ code: "terminal-work" })]);
	});

	it("expires leases through explicit maintenance, then makes work claimable again", () => {
		const g = graph();
		let now = 0;
		const bus = messageBus(g, { topics: ["work"], name: "bus", now: () => now });
		const queue = workQueue<{ id: string }>(g, {
			queueId: "q",
			bus,
			topic: "work",
			subscriptionId: "q-admit",
			now: () => now,
			leaseDurationMs: 5,
		});
		const records: unknown[] = [];
		queue.records.subscribe((msg) => records.push(msg));

		queue.submit({ id: "a" });
		queue.claim({ workerId: "w1", commandId: "claim-1" });
		now = 6;
		queue.expireLeases({ commandId: "expire-1" });
		queue.claim({ workerId: "w2", commandId: "claim-2" });

		expect(records).toContainEqual([
			"DATA",
			expect.objectContaining({ kind: "lease-expired", leaseId: "q:work:1:lease:1" }),
		]);
		expect(records).toContainEqual([
			"DATA",
			expect.objectContaining({
				kind: "work-claimed",
				leaseId: "q:work:1:lease:2",
				workerId: "w2",
			}),
		]);
	});

	it("materializes lease expiration before stale lifecycle commands or reclaim", () => {
		const g = graph();
		let now = 0;
		const bus = messageBus(g, { topics: ["work"], name: "bus", now: () => now });
		const queue = workQueue<{ id: string }>(g, {
			queueId: "q",
			bus,
			topic: "work",
			subscriptionId: "q-admit",
			now: () => now,
			leaseDurationMs: 5,
		});
		const records: unknown[] = [];
		const issues: unknown[] = [];
		queue.records.subscribe((msg) => records.push(msg));
		queue.issues.subscribe((msg) => issues.push(msg));

		queue.submit({ id: "a" });
		queue.claim({ workerId: "w1", commandId: "claim-1" });
		now = 6;
		queue.complete({
			workId: "q:work:1",
			leaseId: "q:work:1:lease:1",
			attempt: 1,
			workerId: "w1",
			commandId: "complete-expired",
		});
		queue.claim({ workerId: "w2", commandId: "claim-2" });

		expect(records).toContainEqual([
			"DATA",
			expect.objectContaining({ kind: "lease-expired", commandId: "complete-expired" }),
		]);
		expect(issues).toContainEqual(["DATA", expect.objectContaining({ code: "lease-expired" })]);
		expect(records).toContainEqual([
			"DATA",
			expect.objectContaining({ kind: "work-claimed", workerId: "w2" }),
		]);
	});

	it("fail emits retry-scheduled or work-dead-lettered disposition", () => {
		const g = graph();
		let now = 0;
		const bus = messageBus(g, { topics: ["work"], name: "bus", now: () => now });
		const queue = workQueue<{ id: string }>(g, {
			queueId: "q",
			bus,
			topic: "work",
			subscriptionId: "q-admit",
			now: () => now,
			retry: { maxAttempts: 2, delayMs: 5 },
		});
		const records: unknown[] = [];
		queue.records.subscribe((msg) => records.push(msg));

		queue.submit({ id: "a" });
		queue.claim({ workerId: "w1", commandId: "claim-1" });
		queue.fail({
			workId: "q:work:1",
			leaseId: "q:work:1:lease:1",
			attempt: 1,
			workerId: "w1",
			commandId: "fail-1",
		});
		now = 6;
		queue.claim({ workerId: "w2", commandId: "claim-2" });
		queue.fail({
			workId: "q:work:1",
			leaseId: "q:work:1:lease:2",
			attempt: 2,
			workerId: "w2",
			commandId: "fail-2",
		});

		expect(records).toContainEqual([
			"DATA",
			expect.objectContaining({ kind: "retry-scheduled", retryAtMs: 5 }),
		]);
		expect(records).toContainEqual([
			"DATA",
			expect.objectContaining({ kind: "work-dead-lettered", reason: "attempts-exhausted" }),
		]);
	});

	it("terminal work projections do not expose an active lease", () => {
		const g = graph();
		const bus = messageBus(g, { topics: ["work"], name: "bus", now: () => 0 });
		const queue = workQueue<{ id: string }>(g, {
			queueId: "q",
			bus,
			topic: "work",
			subscriptionId: "q-admit",
			now: () => 0,
		});

		queue.submit({ id: "a" });
		queue.claim({ workerId: "w1", commandId: "claim-1" });
		queue.complete({
			workId: "q:work:1",
			leaseId: "q:work:1:lease:1",
			attempt: 1,
			workerId: "w1",
			commandId: "complete-1",
		});
		const work = queue.work("q:work:1");
		work.snapshot.up([["PULL", { pullId: work.snapshotPullId }]]);

		expect(work.snapshot.cache).toEqual(expect.objectContaining({ state: "completed" }));
		expect(work.snapshot.cache?.activeLease).toBeUndefined();
	});

	it("schedule/cancel and read-only projections do not mutate queue state", () => {
		const g = graph();
		const now = 0;
		const bus = messageBus(g, { topics: ["work"], name: "bus", now: () => now });
		const queue = workQueue<{ id: string }>(g, {
			queueId: "q",
			bus,
			topic: "work",
			subscriptionId: "q-admit",
			now: () => now,
		});
		queue.submit({ id: "a" });
		queue.schedule({ workId: "q:work:1", notBeforeMs: 10, commandId: "schedule-1" });
		const available = queue.available();
		const work = queue.work("q:work:1");
		const dead = queue.deadLetter();

		available.available.up([["PULL", { pullId: available.availablePullId, params: { nowMs: 0 } }]]);
		work.snapshot.up([["PULL", { pullId: work.snapshotPullId }]]);
		dead.snapshot.up([["PULL", { pullId: dead.snapshotPullId }]]);

		expect(available.available.cache).toEqual(
			expect.objectContaining({ items: [], asOfRecordSeq: 2 }),
		);
		expect(work.snapshot.cache).toEqual(
			expect.objectContaining({ workId: "q:work:1", state: "scheduled" }),
		);
		expect(dead.snapshot.cache).toEqual(expect.objectContaining({ entries: [] }));

		queue.cancel({ workId: "q:work:1", commandId: "cancel-1", reason: "user" });
		expect(work.snapshot.cache?.state).toBe("scheduled");
		work.snapshot.up([["PULL", { pullId: work.snapshotPullId }]]);
		expect(work.snapshot.cache?.state).toBe("canceled");
	});

	it("rejects malformed and wrong-queue command facts without mutating lifecycle state", () => {
		const g = graph();
		const bus = messageBus(g, { topics: ["work"], name: "bus", now: () => 0 });
		const queue = workQueue<{ id: string }>(g, {
			queueId: "q",
			bus,
			topic: "work",
			subscriptionId: "q-admit",
			now: () => 0,
		});
		const issues: unknown[] = [];
		const records: unknown[] = [];
		queue.issues.subscribe((msg) => issues.push(msg));
		queue.records.subscribe((msg) => records.push(msg));

		queue.commands.down([
			["DATA", { kind: "bogus", commandId: "bad-1" } as never],
			["DATA", { kind: "cancel", commandId: "bad-2", queueId: "other", workId: "x" } as never],
		]);

		expect(issues).toContainEqual([
			"DATA",
			expect.objectContaining({ code: "malformed-command", source: "workQueue" }),
		]);
		expect(issues).toContainEqual([
			"DATA",
			expect.objectContaining({ code: "queue-mismatch", source: "workQueue" }),
		]);
		expect(records.filter((msg) => msg[0] === "DATA")).toEqual([]);
	});

	it("available pagination can use admissionSeq without workId sort skips", () => {
		const g = graph();
		const bus = messageBus(g, { topics: ["work"], name: "bus", now: () => 0 });
		const queue = workQueue<{ id: string }>(g, {
			queueId: "q",
			bus,
			topic: "work",
			subscriptionId: "q-admit",
			now: () => 0,
		});
		queue.submit({ id: "first" }, { workId: "z" });
		queue.submit({ id: "second" }, { workId: "a" });
		const available = queue.available();

		available.available.up([["PULL", { pullId: available.availablePullId, params: { limit: 1 } }]]);
		const nextAfterAdmissionSeq = available.available.cache?.nextAfterAdmissionSeq;
		available.available.up([
			[
				"PULL",
				{
					pullId: available.availablePullId,
					params: { limit: 1, afterAdmissionSeq: nextAfterAdmissionSeq },
				},
			],
		]);

		expect(available.available.cache?.items.map((item) => item.workId)).toEqual(["a"]);
	});
});
