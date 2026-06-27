import { describe, expect, it } from "vitest";
import type { DataIssue } from "../data/index.js";
import { graph } from "../graph/graph.js";
import type {
	ScheduledReadinessClock,
	ScheduledReadinessOverdue,
	ScheduledReadinessReady,
	ScheduledReadinessRequested,
} from "../orchestration/index.js";
import { scheduledReadinessProjector } from "../orchestration/index.js";
import {
	type WorkQueueReadinessCandidate,
	type WorkQueueReadinessHandoffStatus,
	type WorkQueueReadinessHandoffViews,
	type WorkQueueScheduledReadinessStatus,
	type WorkQueueScheduledReadinessViews,
	workQueueLeaseExpirationCommandProjector,
	workQueueReadinessHandoffProjector,
	workQueueScheduledReadinessProjector,
} from "../orchestration/work-queue.js";
import type { WorkQueueCommand, WorkQueueRecord } from "../work-queue/index.js";

describe("workQueueScheduledReadinessProjector (B94/D424/D432/D433)", () => {
	it("lowers work-scheduled notBeforeMs to shared readyAtMs without shared notBeforeMs", () => {
		const harness = createHarness();

		harness.records.down([
			[
				"DATA",
				workScheduled({
					recordSeq: 7,
					commandId: "schedule-command",
					scheduleId: "user-schedule",
					notBeforeMs: 1_000,
					deadlineMs: 1_500,
				}),
			],
		]);

		expect(harness.seen.schedules).toEqual([
			expect.objectContaining({
				kind: "scheduled-readiness-requested",
				scheduleId: "workQueue:q:w1:schedule:user-schedule",
				readyAtMs: 1_000,
				deadlineMs: 1_500,
				reason: "work-queue-schedule",
			}),
		]);
		expect(JSON.stringify(harness.seen.schedules[0])).not.toContain("notBeforeMs");
		expect(harness.seen.schedules[0]?.subjectRefs).toEqual(
			expect.arrayContaining([
				{ kind: "work-queue", id: "q" },
				{ kind: "work-queue-work", id: "w1" },
				{ kind: "work-queue-record", id: "7" },
				{ kind: "work-queue-command", id: "schedule-command" },
			]),
		);
	});

	it("lowers delayed work-admitted and retry-scheduled records to shared readyAtMs", () => {
		const harness = createHarness();

		harness.records.down([
			[
				"DATA",
				workAdmitted({
					recordSeq: 1,
					notBeforeMs: 250,
					deadlineMs: 300,
				}),
			],
			[
				"DATA",
				retryScheduled({
					recordSeq: 2,
					commandId: "fail-1",
					retryAtMs: 500,
					delayMs: 100,
				}),
			],
		]);

		expect(harness.seen.schedules).toEqual([
			expect.objectContaining({
				scheduleId: "workQueue:q:w1:admission:1",
				readyAtMs: 250,
				deadlineMs: 300,
				reason: "work-queue-delayed-admission",
			}),
			expect.objectContaining({
				scheduleId: "workQueue:q:w1:retry:fail-1",
				readyAtMs: 500,
				reason: "work-queue-retry",
			}),
		]);
		expect(JSON.stringify(harness.seen.schedules)).not.toContain("retryAtMs");
		expect(harness.seen.schedules[1]?.metadata).toEqual(
			expect.objectContaining({ delayMs: 100, scheduleKind: "retry-scheduled" }),
		);
	});

	it("dedupes replayed records without duplicating shared schedules", () => {
		const harness = createHarness();
		const record = workScheduled({ recordSeq: 9, notBeforeMs: 900 });

		harness.records.down([["DATA", record]]);
		harness.records.down([["DATA", record]]);

		expect(harness.seen.schedules).toHaveLength(1);
		expect(harness.seen.status.filter((status) => status.state === "translated")).toHaveLength(1);
		expect(harness.seen.audit).toHaveLength(1);
		expect(harness.seen.views.at(-1)?.schedulesById.size).toBe(1);
	});

	it("emits a visible issue when a scheduleId replays with conflicting material", () => {
		const harness = createHarness();

		harness.records.down([
			[
				"DATA",
				workScheduled({
					recordSeq: 1,
					scheduleId: "same-schedule",
					notBeforeMs: 100,
				}),
			],
		]);
		harness.records.down([
			[
				"DATA",
				workScheduled({
					recordSeq: 2,
					scheduleId: "same-schedule",
					notBeforeMs: 200,
				}),
			],
		]);

		expect(harness.seen.schedules).toHaveLength(1);
		expect(harness.seen.schedules[0]).toEqual(
			expect.objectContaining({
				scheduleId: "workQueue:q:w1:schedule:same-schedule",
				readyAtMs: 100,
			}),
		);
		expect(harness.seen.issues).toEqual([
			expect.objectContaining({
				code: "work-queue-scheduled-readiness-schedule-conflict",
			}),
		]);
		expect(harness.seen.status).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					state: "issue",
					issueCodes: ["work-queue-scheduled-readiness-schedule-conflict"],
				}),
			]),
		);
		expect(
			harness.seen.views.at(-1)?.schedulesById.get("workQueue:q:w1:schedule:same-schedule")
				?.readyAtMs,
		).toBe(100);
	});

	it("emits a visible issue when the same workQueue record replays with conflicting material", () => {
		const harness = createHarness();

		harness.records.down([
			[
				"DATA",
				workScheduled({
					recordSeq: 5,
					notBeforeMs: 100,
				}),
			],
		]);
		harness.records.down([
			[
				"DATA",
				workScheduled({
					recordSeq: 5,
					notBeforeMs: 200,
				}),
			],
		]);

		expect(harness.seen.schedules).toHaveLength(1);
		expect(harness.seen.schedules[0]).toEqual(
			expect.objectContaining({
				scheduleId: "workQueue:q:w1:schedule:5",
				readyAtMs: 100,
			}),
		);
		expect(harness.seen.issues).toEqual([
			expect.objectContaining({
				code: "work-queue-scheduled-readiness-schedule-conflict",
			}),
		]);
	});

	it("fails closed on malformed delayed records instead of throwing", () => {
		const harness = createHarness();

		harness.records.down([
			[
				"DATA",
				{
					kind: "work-scheduled",
					queueId: "q",
					recordSeq: 13,
					notBeforeMs: 100,
					recordedAtMs: 0,
				} as unknown as WorkQueueRecord,
			],
		]);

		expect(harness.seen.schedules).toEqual([]);
		expect(harness.seen.issues).toEqual([
			expect.objectContaining({
				code: "work-queue-scheduled-readiness-malformed-record",
			}),
		]);
		expect(harness.seen.status).toEqual([
			expect.objectContaining({
				state: "issue",
				issueCodes: ["work-queue-scheduled-readiness-malformed-record"],
			}),
		]);
	});

	it("translates lease expiration eligibility without materializing lease-expired lifecycle records", () => {
		const harness = createHarness();

		harness.records.down([
			[
				"DATA",
				workClaimed({
					recordSeq: 3,
					leaseId: "lease-1",
					leaseExpiresAtMs: 1_200,
				}),
			],
			[
				"DATA",
				leaseRenewed({
					recordSeq: 4,
					leaseId: "lease-1",
					leaseExpiresAtMs: 1_600,
					previousLeaseExpiresAtMs: 1_200,
				}),
			],
		]);

		expect(harness.seen.schedules).toEqual([
			expect.objectContaining({
				scheduleId: "workQueue:q:w1:lease:lease-1:expires:3",
				readyAtMs: 1_200,
				reason: "work-queue-lease-expiration",
			}),
			expect.objectContaining({
				scheduleId: "workQueue:q:w1:lease:lease-1:expires:4",
				readyAtMs: 1_600,
				reason: "work-queue-lease-expiration",
			}),
		]);
		const serialized = JSON.stringify({
			schedules: harness.seen.schedules,
			status: harness.seen.status,
			views: harness.seen.views,
		});
		expect(serialized).not.toContain("lease-expired");
		expect(serialized).not.toContain("expire-leases");
		expect(serialized).not.toContain("work-canceled");
		expect(serialized).not.toContain("work-completed");
	});

	it("keeps shared ready and overdue as visibility only, not workQueue lifecycle mutation", () => {
		const harness = createHarness({ includeSharedReadiness: true });

		harness.records.down([
			[
				"DATA",
				workScheduled({
					recordSeq: 11,
					notBeforeMs: 1_000,
					deadlineMs: 900,
				}),
			],
		]);
		harness.clocks?.down([["DATA", clock(1_000)]]);

		expect(harness.seen.ready).toEqual([
			expect.objectContaining({
				scheduleId: "workQueue:q:w1:schedule:11",
				readyAtMs: 1_000,
				nowMs: 1_000,
			}),
		]);
		expect(harness.seen.overdue).toEqual([
			expect.objectContaining({
				scheduleId: "workQueue:q:w1:schedule:11",
				deadlineMs: 900,
				nowMs: 1_000,
			}),
		]);
		expect(harness.seen.status).toEqual([
			expect.objectContaining({ state: "translated", readyAtMs: 1_000, deadlineMs: 900 }),
		]);
		const serialized = JSON.stringify({
			translator: harness.seen,
			ready: harness.seen.ready,
			overdue: harness.seen.overdue,
		});
		expect(serialized).not.toContain("work-queue-command");
		expect(serialized).not.toContain("lease-expired");
		expect(serialized).not.toContain("cancel");
		expect(serialized).not.toContain("complete");
		expect(serialized).not.toContain("fail");
	});

	it("bounds public metadata and source refs without carrying raw payloads or secrets", () => {
		const harness = createHarness();
		const raw = "x".repeat(10_000);
		const privateRef = `secret-token-${"s".repeat(1_000)}`;
		const extraRefs = Array.from({ length: 20 }, (_, index) => `source-${index}`);

		harness.records.down([
			[
				"DATA",
				workScheduled({
					recordSeq: 12,
					notBeforeMs: 300,
					commandId: privateRef,
					sourceRefs: ["visible-source", privateRef, ...extraRefs],
					policyRefs: [privateRef],
					payload: { apiKey: "SECRET", rawResponseBody: raw },
				} as WorkQueueRecord<{ readonly apiKey: string; readonly rawResponseBody: string }>),
			],
		]);

		const serialized = JSON.stringify(harness.seen.schedules[0]);
		expect(serialized).not.toContain("SECRET");
		expect(serialized).not.toContain(raw);
		expect(serialized).not.toContain(privateRef);
		expect(serialized).not.toContain("secret-token");
		expect(serialized.length).toBeLessThan(4_000);
		expect(harness.seen.schedules[0]?.scheduleId).toContain("bounded:");
		expect(harness.seen.schedules[0]?.sourceRefs).toEqual(
			expect.arrayContaining([
				{ kind: "work-queue-source-ref", id: "visible-source" },
				{ kind: "work-queue-record", id: "12" },
				expect.objectContaining({
					kind: "work-queue-source-ref",
					id: expect.stringMatching(/^bounded:/),
				}),
				expect.objectContaining({
					kind: "work-queue-source-ref-overflow",
				}),
			]),
		);
		expect(harness.seen.schedules[0]?.policyRefs).toEqual([
			expect.objectContaining({
				kind: "work-queue-policy-ref",
				id: expect.stringMatching(/^bounded:/),
			}),
		]);
	});

	it("ignores terminal/canceled/dead-lettered records instead of emitting shared lifecycle facts", () => {
		const harness = createHarness();

		harness.records.down([
			["DATA", terminalRecord("work-canceled", 20)],
			["DATA", terminalRecord("work-completed", 21)],
			["DATA", terminalRecord("work-dead-lettered", 22)],
		]);

		expect(harness.seen.schedules).toEqual([]);
		expect(harness.seen.status).toEqual([]);
		expect(harness.seen.issues).toEqual([]);
	});
});

describe("workQueueReadinessHandoffProjector (B94/D433)", () => {
	it("turns scheduled and retry readiness into claim-eligible candidates without claiming work", () => {
		const harness = createHandoffHarness();

		harness.records.down([
			["DATA", workScheduled({ recordSeq: 1, notBeforeMs: 100 })],
			["DATA", retryScheduled({ workId: "w2", recordSeq: 2, commandId: "fail-1", retryAtMs: 200 })],
		]);
		harness.ready.down([["DATA", ready("workQueue:q:w1:schedule:1", 100)]]);
		harness.ready.down([["DATA", ready("workQueue:q:w2:retry:fail-1", 200)]]);

		expect(harness.seen.candidates).toEqual([
			expect.objectContaining({
				kind: "work-queue-readiness-candidate",
				candidateKind: "claim-eligible",
				workId: "w1",
				scheduleId: "workQueue:q:w1:schedule:1",
				readyAtMs: 100,
			}),
			expect.objectContaining({
				candidateKind: "claim-eligible",
				workId: "w2",
				scheduleId: "workQueue:q:w2:retry:fail-1",
				readyAtMs: 200,
			}),
		]);
		expect(harness.seen.commands).toEqual([]);
		expect(JSON.stringify(harness.seen)).not.toContain("work-claimed");
		expect(JSON.stringify(harness.seen)).not.toContain("lease-expired");
	});

	it("keeps current work state isolated by queueId and workId", () => {
		const harness = createHandoffHarness();

		harness.records.down([
			[
				"DATA",
				workScheduled({ queueId: "q1", workId: "same-work", recordSeq: 1, notBeforeMs: 100 }),
			],
			["DATA", terminalRecord("work-completed", 2, { queueId: "q2", workId: "same-work" })],
		]);
		harness.ready.down([["DATA", ready("workQueue:q1:same-work:schedule:1", 100)]]);

		expect(harness.seen.candidates).toEqual([
			expect.objectContaining({
				candidateKind: "claim-eligible",
				queueId: "q1",
				workId: "same-work",
				scheduleId: "workQueue:q1:same-work:schedule:1",
			}),
		]);
		expect(harness.seen.handoffStatus).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					state: "ignored-terminal",
					queueId: "q1",
					workId: "same-work",
				}),
			]),
		);
	});

	it("ignores stale readiness whose origin record was superseded by a newer record", () => {
		const harness = createHandoffHarness();

		harness.records.down([
			["DATA", workScheduled({ recordSeq: 1, notBeforeMs: 100 })],
			["DATA", workScheduled({ recordSeq: 2, notBeforeMs: 200 })],
		]);
		harness.ready.down([["DATA", ready("workQueue:q:w1:schedule:1", 100)]]);

		expect(harness.seen.candidates).toEqual([]);
		expect(harness.seen.handoffStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					state: "ignored-superseded",
					scheduleId: "workQueue:q:w1:schedule:1",
					metadata: expect.objectContaining({
						originRecordSeq: 1,
						latestRecordSeq: 2,
					}),
				}),
			]),
		);
	});

	it("ignores stale lower-sequence records instead of reopening terminal work", () => {
		const harness = createHandoffHarness();

		harness.records.down([
			["DATA", terminalRecord("work-completed", 10)],
			["DATA", workScheduled({ recordSeq: 1, notBeforeMs: 100 })],
		]);
		harness.ready.down([["DATA", ready("workQueue:q:w1:schedule:1", 100)]]);

		expect(harness.seen.candidates).toEqual([]);
		expect(harness.seen.handoffStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					state: "ignored-superseded",
					currentState: "completed",
					scheduleId: "workQueue:q:w1:schedule:1",
					metadata: expect.objectContaining({ latestRecordSeq: 10 }),
				}),
			]),
		);
	});

	it("lowers only lease-expiration candidates into expire-leases commands", () => {
		const harness = createHandoffHarness({ includeLeaseCommands: true });

		harness.records.down([
			[
				"DATA",
				workClaimed({
					recordSeq: 3,
					leaseId: "lease-1",
					attempt: 1,
					workerId: "worker-1",
					leaseExpiresAtMs: 300,
				}),
			],
		]);
		harness.ready.down([["DATA", ready("workQueue:q:w1:lease:lease-1:expires:3", 300)]]);

		expect(harness.seen.candidates).toEqual([
			expect.objectContaining({
				candidateKind: "lease-expiration-eligible",
				workId: "w1",
				leaseId: "lease-1",
				attempt: 1,
				workerId: "worker-1",
				leaseExpiresAtMs: 300,
			}),
		]);
		expect(harness.seen.commands).toEqual([
			expect.objectContaining({
				kind: "expire-leases",
				workIds: ["w1"],
				limit: 1,
				nowMs: 300,
				causationId: "workQueue:q:w1:lease:lease-1:expires:3",
			}),
		]);
		expect(JSON.stringify(harness.seen.commands)).not.toContain("lease-expired");
	});

	it("ignores superseded lease readiness after a renewal extends the active lease", () => {
		const harness = createHandoffHarness({ includeLeaseCommands: true });

		harness.records.down([
			[
				"DATA",
				workClaimed({
					recordSeq: 3,
					leaseId: "lease-1",
					attempt: 1,
					leaseExpiresAtMs: 300,
				}),
			],
			[
				"DATA",
				leaseRenewed({
					recordSeq: 4,
					leaseId: "lease-1",
					attempt: 1,
					previousLeaseExpiresAtMs: 300,
					leaseExpiresAtMs: 600,
				}),
			],
		]);
		harness.ready.down([["DATA", ready("workQueue:q:w1:lease:lease-1:expires:3", 300)]]);

		expect(harness.seen.candidates).toEqual([]);
		expect(harness.seen.commands).toEqual([]);
		expect(harness.seen.handoffStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					state: "ignored-superseded",
					scheduleId: "workQueue:q:w1:lease:lease-1:expires:3",
					currentState: "leased",
				}),
			]),
		);
	});

	it("ignores terminal work and treats overdue as visibility-only status", () => {
		const harness = createHandoffHarness({ includeLeaseCommands: true });

		harness.records.down([
			["DATA", workScheduled({ recordSeq: 6, notBeforeMs: 100 })],
			["DATA", terminalRecord("work-completed", 7)],
		]);
		harness.ready.down([["DATA", ready("workQueue:q:w1:schedule:6", 100)]]);
		harness.overdue.down([["DATA", overdue("workQueue:q:w1:schedule:6", 100, 90)]]);

		expect(harness.seen.candidates).toEqual([]);
		expect(harness.seen.commands).toEqual([]);
		expect(harness.seen.handoffStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					state: "ignored-superseded",
					currentState: "completed",
					metadata: expect.objectContaining({ latestRecordSeq: 7 }),
				}),
				expect.objectContaining({
					state: "overdue",
					scheduleId: "workQueue:q:w1:schedule:6",
				}),
			]),
		);
		expect(JSON.stringify(harness.seen)).not.toContain("cancel");
		expect(JSON.stringify(harness.seen)).not.toContain("fail");
	});

	it("handles out-of-order ready before origin records deterministically", () => {
		const harness = createHandoffHarness();

		harness.ready.down([["DATA", ready("workQueue:q:w1:schedule:8", 800)]]);
		expect(harness.seen.candidates).toEqual([]);
		expect(harness.seen.handoffStatus).toEqual([
			expect.objectContaining({
				state: "pending-origin",
				scheduleId: "workQueue:q:w1:schedule:8",
			}),
		]);

		harness.records.down([["DATA", workScheduled({ recordSeq: 8, notBeforeMs: 800 })]]);

		expect(harness.seen.candidates).toEqual([
			expect.objectContaining({
				candidateKind: "claim-eligible",
				scheduleId: "workQueue:q:w1:schedule:8",
			}),
		]);
	});

	it("re-emits overdue status with origin coordinates after late origin material", () => {
		const harness = createHandoffHarness();

		harness.overdue.down([["DATA", overdue("workQueue:q:w1:schedule:9", 100, 90)]]);
		harness.records.down([["DATA", workScheduled({ recordSeq: 9, notBeforeMs: 100 })]]);
		harness.overdue.down([["DATA", overdue("workQueue:q:w1:schedule:9", 100, 90)]]);

		expect(harness.seen.handoffStatus[0]).toEqual(
			expect.objectContaining({
				state: "overdue",
				scheduleId: "workQueue:q:w1:schedule:9",
			}),
		);
		expect(Object.hasOwn(harness.seen.handoffStatus[0] ?? {}, "queueId")).toBe(false);
		expect(Object.hasOwn(harness.seen.handoffStatus[0] ?? {}, "workId")).toBe(false);
		expect(harness.seen.handoffStatus[1]).toEqual(
			expect.objectContaining({
				state: "overdue",
				scheduleId: "workQueue:q:w1:schedule:9",
				queueId: "q",
				workId: "w1",
			}),
		);
		expect(harness.seen.candidates).toEqual([]);
	});
});

function createHarness(opts: { readonly includeSharedReadiness?: boolean } = {}) {
	const g = graph();
	const records = g.node<WorkQueueRecord>([], null, { name: "work-queue-records" });
	const translator = workQueueScheduledReadinessProjector(g, { records });
	const clocks = opts.includeSharedReadiness
		? g.node<ScheduledReadinessClock>([], null, { name: "work-queue-readiness-clock" })
		: undefined;
	const readiness =
		clocks === undefined
			? undefined
			: scheduledReadinessProjector(g, {
					schedules: [translator.readinessSchedules],
					clocks: [clocks],
				});
	return {
		records,
		clocks,
		seen: {
			schedules: collectData<ScheduledReadinessRequested>(translator.readinessSchedules),
			status: collectData<WorkQueueScheduledReadinessStatus>(translator.status),
			issues: collectData<DataIssue>(translator.issues),
			audit: collectData<{ readonly kind: string }>(translator.audit),
			views: collectData<WorkQueueScheduledReadinessViews>(translator.views),
			ready: readiness === undefined ? [] : collectData<ScheduledReadinessReady>(readiness.ready),
			overdue:
				readiness === undefined ? [] : collectData<ScheduledReadinessOverdue>(readiness.overdue),
		},
	};
}

function createHandoffHarness(opts: { readonly includeLeaseCommands?: boolean } = {}) {
	const g = graph();
	const records = g.node<WorkQueueRecord>([], null, { name: "work-queue-handoff-records" });
	const readyNode = g.node<ScheduledReadinessReady>([], null, {
		name: "work-queue-handoff-ready",
	});
	const overdueNode = g.node<ScheduledReadinessOverdue>([], null, {
		name: "work-queue-handoff-overdue",
	});
	const handoff = workQueueReadinessHandoffProjector(g, {
		records,
		ready: readyNode,
		overdue: overdueNode,
	});
	const leaseCommands = opts.includeLeaseCommands
		? workQueueLeaseExpirationCommandProjector(g, { candidates: handoff.candidates })
		: undefined;
	return {
		records,
		ready: readyNode,
		overdue: overdueNode,
		seen: {
			candidates: collectData<WorkQueueReadinessCandidate>(handoff.candidates),
			handoffStatus: collectData<WorkQueueReadinessHandoffStatus>(handoff.status),
			handoffViews: collectData<WorkQueueReadinessHandoffViews>(handoff.views),
			commands:
				leaseCommands === undefined ? [] : collectData<WorkQueueCommand>(leaseCommands.commands),
			commandStatus:
				leaseCommands === undefined
					? []
					: collectData<WorkQueueReadinessHandoffStatus>(leaseCommands.status),
		},
	};
}

function workAdmitted(
	fields: Partial<Extract<WorkQueueRecord, { kind: "work-admitted" }>> = {},
): WorkQueueRecord {
	return {
		kind: "work-admitted",
		queueId: "q",
		workId: "w1",
		recordSeq: 1,
		payload: { id: "payload" },
		messageBus: { topic: "work", seq: 1, subscriptionId: "q-admit" },
		recordedAtMs: 0,
		...fields,
	};
}

function workScheduled(
	fields: Partial<Extract<WorkQueueRecord, { kind: "work-scheduled" }>> = {},
): WorkQueueRecord {
	return {
		kind: "work-scheduled",
		queueId: "q",
		workId: "w1",
		recordSeq: 1,
		notBeforeMs: 100,
		recordedAtMs: 0,
		...fields,
	};
}

function retryScheduled(
	fields: Partial<Extract<WorkQueueRecord, { kind: "retry-scheduled" }>> = {},
): WorkQueueRecord {
	return {
		kind: "retry-scheduled",
		queueId: "q",
		workId: "w1",
		recordSeq: 1,
		retryAtMs: 100,
		delayMs: 100,
		recordedAtMs: 0,
		...fields,
	};
}

function workClaimed(
	fields: Partial<Extract<WorkQueueRecord, { kind: "work-claimed" }>> = {},
): WorkQueueRecord {
	return {
		kind: "work-claimed",
		queueId: "q",
		workId: "w1",
		recordSeq: 1,
		leaseId: "lease-1",
		attempt: 1,
		workerId: "worker",
		claimedAtMs: 0,
		leaseExpiresAtMs: 100,
		recordedAtMs: 0,
		...fields,
	};
}

function leaseRenewed(
	fields: Partial<Extract<WorkQueueRecord, { kind: "lease-renewed" }>> = {},
): WorkQueueRecord {
	return {
		kind: "lease-renewed",
		queueId: "q",
		workId: "w1",
		recordSeq: 1,
		leaseId: "lease-1",
		attempt: 1,
		workerId: "worker",
		previousLeaseExpiresAtMs: 50,
		leaseExpiresAtMs: 100,
		renewedAtMs: 0,
		recordedAtMs: 0,
		...fields,
	};
}

function terminalRecord(
	kind: "work-canceled" | "work-completed" | "work-dead-lettered",
	recordSeq: number,
	fields: Partial<Extract<WorkQueueRecord, { kind: typeof kind }>> = {},
): WorkQueueRecord {
	if (kind === "work-canceled") {
		return {
			kind,
			queueId: "q",
			workId: "w1",
			recordSeq,
			canceledAtMs: 10,
			recordedAtMs: 10,
			...fields,
		};
	}
	if (kind === "work-completed") {
		return {
			kind,
			queueId: "q",
			workId: "w1",
			recordSeq,
			leaseId: "lease-1",
			attempt: 1,
			workerId: "worker",
			recordedAtMs: 10,
			...fields,
		};
	}
	return {
		kind,
		queueId: "q",
		workId: "w1",
		recordSeq,
		reason: "attempts-exhausted",
		recordedAtMs: 10,
		...fields,
	};
}

function clock(nowMs: number): ScheduledReadinessClock {
	return {
		kind: "scheduled-readiness-clock",
		clockId: "work-queue-test-clock",
		nowMs,
		sourceRefs: [{ kind: "clock", id: "work-queue-test-clock" }],
	};
}

function ready(scheduleId: string, readyAtMs: number): ScheduledReadinessReady {
	return {
		kind: "scheduled-readiness-ready",
		scheduleId,
		subjectRefs: [{ kind: "work-queue-work", id: "w1" }],
		readyAtMs,
		nowMs: readyAtMs,
		sourceRefs: [{ kind: "scheduled-readiness", id: scheduleId }],
	};
}

function overdue(
	scheduleId: string,
	readyAtMs: number,
	deadlineMs: number,
): ScheduledReadinessOverdue {
	return {
		kind: "scheduled-readiness-overdue",
		scheduleId,
		subjectRefs: [{ kind: "work-queue-work", id: "w1" }],
		readyAtMs,
		deadlineMs,
		nowMs: readyAtMs,
		sourceRefs: [{ kind: "scheduled-readiness", id: scheduleId }],
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
