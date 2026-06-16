import { describe, expect, it } from "vitest";
import type { CqrsStatus } from "../cqrs/index.js";
import {
	type CqrsQueuedCommandPayload,
	type CqrsWorkQueueAttempt,
	cqrsWorkQueueDispositionCommand,
	cqrsWorkQueueRecipe,
} from "../cqrs/work-queue.js";
import { graph } from "../graph/graph.js";
import type { WorkQueueRecord } from "../work-queue/index.js";

describe("CQRS workQueue recipe (D350/D352/D353)", () => {
	it("maps a queue claim to a CQRS command fact, then accepted status to queue complete", () => {
		const g = graph();
		const records = g.node<WorkQueueRecord<CqrsQueuedCommandPayload>>([], null, {
			name: "queueRecords",
		});
		const status = g.node<CqrsStatus>([], null, { name: "cqrsStatus" });
		const recipe = cqrsWorkQueueRecipe(g, { records, status, workerId: "worker-1" });
		const dispatches = collectData(recipe.dispatches);
		const commands = collectData(recipe.commands);

		records.down([
			["DATA", admittedRecord()],
			[
				"DATA",
				{
					kind: "work-claimed",
					recordSeq: 2,
					queueId: "q",
					workId: "work-1",
					leaseId: "lease-1",
					attempt: 1,
					workerId: "worker-1",
					claimedAtMs: 110,
					leaseExpiresAtMs: 210,
					recordedAtMs: 110,
				} satisfies WorkQueueRecord<CqrsQueuedCommandPayload>,
			],
		]);
		status.down([["DATA", statusFact("accepted", 2)]]);

		expect(dispatches.at(-1)).toEqual(payload().command);
		expect(commands.at(-1)).toEqual(
			expect.objectContaining({
				kind: "complete",
				workId: "work-1",
				leaseId: "lease-1",
				result: expect.objectContaining({
					kind: "cqrs-accepted-result",
					eventCount: 2,
				}),
			}),
		);
	});

	it("keeps the D352 outcome matrix on queue disposition helpers", () => {
		const attempt = attemptFact();

		expect(
			cqrsWorkQueueDispositionCommand(attempt, {
				kind: "accepted",
				status: statusFact("accepted", 0),
			}),
		).toEqual(
			expect.objectContaining({
				kind: "complete",
				result: expect.objectContaining({ kind: "cqrs-accepted-result", eventCount: 0 }),
			}),
		);
		expect(
			cqrsWorkQueueDispositionCommand(attempt, {
				kind: "rejected",
				status: statusFact("rejected", 0, "unknown-command"),
			}),
		).toEqual(
			expect.objectContaining({
				kind: "complete",
				result: expect.objectContaining({
					kind: "cqrs-rejected-result",
					errorCode: "unknown-command",
				}),
			}),
		);
		expect(
			cqrsWorkQueueDispositionCommand(attempt, {
				kind: "rejected",
				status: statusFact("rejected", 0, "handler-threw"),
			}),
		).toEqual(expect.objectContaining({ kind: "fail", retryable: true }));
		expect(
			cqrsWorkQueueDispositionCommand(attempt, {
				kind: "rejected",
				status: statusFact("rejected", 0, "clock-threw"),
			}),
		).toEqual(expect.objectContaining({ kind: "fail", retryable: true }));
		expect(
			cqrsWorkQueueDispositionCommand(attempt, { kind: "release", reason: "shutdown" }),
		).toEqual(expect.objectContaining({ kind: "release", reason: "shutdown" }));
	});

	it("allows a retry claim for the same CQRS command id to produce its own disposition", () => {
		const g = graph();
		const records = g.node<WorkQueueRecord<CqrsQueuedCommandPayload>>([], null, {
			name: "queueRecords",
		});
		const status = g.node<CqrsStatus>([], null, { name: "cqrsStatus" });
		const recipe = cqrsWorkQueueRecipe(g, { records, status });
		const commands = collectData(recipe.commands);

		records.down([
			["DATA", admittedRecord()],
			["DATA", claimedRecord(2, "lease-1", 1)],
		]);
		status.down([["DATA", statusFact("rejected", 0, "handler-threw")]]);
		records.down([["DATA", claimedRecord(4, "lease-2", 2)]]);
		status.down([["DATA", statusFact("accepted", 1)]]);

		expect(commands).toEqual([
			expect.objectContaining({ kind: "fail", leaseId: "lease-1", retryable: true }),
			expect.objectContaining({ kind: "complete", leaseId: "lease-2" }),
		]);
		expect(commands[0]?.commandId).not.toEqual(commands[1]?.commandId);
	});

	it("does not use a stale pre-claim CQRS status as a later queue disposition", () => {
		const g = graph();
		const records = g.node<WorkQueueRecord<CqrsQueuedCommandPayload>>([], null, {
			name: "queueRecords",
		});
		const status = g.node<CqrsStatus>([], null, { name: "cqrsStatus" });
		const recipe = cqrsWorkQueueRecipe(g, { records, status });
		const commands = collectData(recipe.commands);
		const issues = collectData(recipe.issues);

		status.down([["DATA", statusFact("accepted", 1)]]);
		records.down([
			["DATA", admittedRecord()],
			["DATA", claimedRecord(2, "lease-1", 1)],
		]);

		expect(commands).toEqual([]);
		expect(issues.at(-1)).toEqual(
			expect.objectContaining({ code: "cqrs-status-without-active-queue-claim" }),
		);

		status.down([["DATA", statusFact("accepted", 1)]]);

		expect(commands.at(-1)).toEqual(
			expect.objectContaining({ kind: "complete", workId: "work-1", leaseId: "lease-1" }),
		);
	});

	it("uses lease-scoped disposition command ids for repeated retryable failures", () => {
		const g = graph();
		const records = g.node<WorkQueueRecord<CqrsQueuedCommandPayload>>([], null, {
			name: "queueRecords",
		});
		const status = g.node<CqrsStatus>([], null, { name: "cqrsStatus" });
		const recipe = cqrsWorkQueueRecipe(g, { records, status });
		const commands = collectData(recipe.commands);

		records.down([
			["DATA", admittedRecord()],
			["DATA", claimedRecord(2, "lease-1", 1)],
		]);
		status.down([["DATA", statusFact("rejected", 0, "handler-threw")]]);
		records.down([["DATA", claimedRecord(4, "lease-2", 2)]]);
		status.down([["DATA", statusFact("rejected", 0, "handler-threw")]]);

		expect(commands).toEqual([
			expect.objectContaining({
				kind: "fail",
				leaseId: "lease-1",
				commandId: "cmd-1:work-1:lease-1:1:cqrs-queue-fail",
			}),
			expect.objectContaining({
				kind: "fail",
				leaseId: "lease-2",
				commandId: "cmd-1:work-1:lease-2:2:cqrs-queue-fail",
			}),
		]);
	});

	it("releases a claim when dispatch was not attempted because payload is missing", () => {
		const g = graph();
		const records = g.node<WorkQueueRecord<CqrsQueuedCommandPayload>>([], null, {
			name: "queueRecords",
		});
		const status = g.node<CqrsStatus>([], null, { name: "cqrsStatus" });
		const recipe = cqrsWorkQueueRecipe(g, { records, status });
		const commands = collectData(recipe.commands);
		const issues = collectData(recipe.issues);

		records.down([["DATA", claimedRecord(1, "lease-missing", 1)]]);

		expect(issues.at(-1)).toEqual(expect.objectContaining({ code: "cqrs-claim-without-payload" }));
		expect(commands.at(-1)).toEqual(
			expect.objectContaining({
				kind: "release",
				workId: "work-1",
				leaseId: "lease-missing",
				reason: "cqrs-claim-without-payload",
			}),
		);
	});
});

function collectData<T>(node: {
	subscribe(sink: (msg: readonly [string, unknown?]) => void): unknown;
}): T[] {
	const out: T[] = [];
	node.subscribe((msg) => {
		if (msg[0] === "DATA") out.push(msg[1] as T);
	});
	return out;
}

function payload(): CqrsQueuedCommandPayload {
	return {
		kind: "cqrs-queued-command",
		command: { id: "cmd-1", type: "create", payload: { title: "one" } },
		sourceRefs: ["message:1"],
	};
}

function admittedRecord(): WorkQueueRecord<CqrsQueuedCommandPayload> {
	return {
		kind: "work-admitted",
		recordSeq: 1,
		queueId: "q",
		workId: "work-1",
		commandId: "admit-1",
		recordedAtMs: 100,
		payload: payload(),
		messageBus: { topic: "work", seq: 1, subscriptionId: "sub" },
	};
}

function claimedRecord(
	recordSeq: number,
	leaseId: string,
	attempt: number,
): WorkQueueRecord<CqrsQueuedCommandPayload> {
	return {
		kind: "work-claimed",
		recordSeq,
		queueId: "q",
		workId: "work-1",
		leaseId,
		attempt,
		workerId: "worker-1",
		claimedAtMs: 110 + recordSeq,
		leaseExpiresAtMs: 210 + recordSeq,
		recordedAtMs: 110 + recordSeq,
	};
}

function attemptFact(): CqrsWorkQueueAttempt {
	return {
		kind: "cqrs-work-queue-attempt",
		workId: "work-1",
		leaseId: "lease-1",
		queueAttempt: 1,
		workerId: "worker-1",
		command: payload().command,
		payload: payload(),
	};
}

function statusFact(
	state: CqrsStatus["state"],
	eventCount: number,
	errorCode?: CqrsStatus["errorCode"],
): CqrsStatus {
	return {
		state,
		commandId: "cmd-1",
		commandType: "create",
		eventCount,
		errorCode,
		cursor: {
			eventSeq: eventCount,
			commandCount: 1,
			errorCount: state === "rejected" ? 1 : 0,
			auditSeq: 1,
		},
	};
}
