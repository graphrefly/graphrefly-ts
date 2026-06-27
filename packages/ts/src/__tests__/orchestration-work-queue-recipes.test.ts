import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import type { ProcessEffectRequest } from "../orchestration/index.js";
import {
	type OrchestrationQueuedEffectPayload,
	orchestrationWorkQueueRecipe,
} from "../orchestration/work-queue.js";
import type { WorkQueueRecord } from "../work-queue/index.js";

describe("orchestration workQueue recipe (D349/D353)", () => {
	it("maps terminal queue records to recipe evidence, not ProcessBundle status truth", () => {
		const g = graph();
		const records = g.node<WorkQueueRecord<OrchestrationQueuedEffectPayload>>([], null, {
			name: "queueRecords",
		});
		const recipe = orchestrationWorkQueueRecipe(g, { records });
		const evidence = collectData(recipe.evidence);
		const status = collectData(recipe.status);

		records.down([
			["DATA", admittedRecord()],
			[
				"DATA",
				{
					kind: "work-completed",
					recordSeq: 2,
					queueId: "q",
					workId: "work-1",
					leaseId: "lease-1",
					attempt: 1,
					workerId: "worker-1",
					result: { ok: true },
					recordedAtMs: 120,
				} satisfies WorkQueueRecord<OrchestrationQueuedEffectPayload>,
			],
		]);

		expect(evidence.at(-1)).toEqual(
			expect.objectContaining({
				kind: "orchestration-queue-evidence",
				effectId: "effect-1",
				queueRecordKind: "work-completed",
			}),
		);
		expect(status.at(-1)).toEqual(
			expect.objectContaining({
				kind: "orchestration-queue-status",
				state: "evidence-recorded",
				effectId: "effect-1",
			}),
		);
		expect(Object.hasOwn(status.at(-1) ?? {}, "eventCount")).toBe(false);
	});

	it("surfaces malformed admitted payloads as recipe issues", () => {
		const g = graph();
		const records = g.node<WorkQueueRecord<OrchestrationQueuedEffectPayload>>([], null, {
			name: "queueRecords",
		});
		const recipe = orchestrationWorkQueueRecipe(g, { records });
		const issues = collectData(recipe.issues);
		const status = collectData(recipe.status);
		const audit = collectData(recipe.audit);

		records.down([["DATA", malformedAdmittedRecord()]]);

		expect(issues.at(-1)).toEqual(
			expect.objectContaining({ code: "orchestration-queue-malformed-payload" }),
		);
		expect(status.at(-1)).toEqual(
			expect.objectContaining({
				kind: "orchestration-queue-status",
				state: "mapping-issue",
				workId: "work-bad",
				queueRecordKind: "work-admitted",
			}),
		);
		expect(audit.at(-1)).toEqual(
			expect.objectContaining({
				kind: "orchestration-queue-audit",
				outcome: "issue",
				workId: "work-bad",
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

function effect(): ProcessEffectRequest {
	return {
		id: "effect-1",
		type: "send-email",
		seq: 1,
		cursor: 1,
		commandId: "cmd-1",
		commandType: "start",
		payload: { to: "team@example.com" },
		timestampMs: 100,
	};
}

function admittedRecord(): WorkQueueRecord<OrchestrationQueuedEffectPayload> {
	return {
		kind: "work-admitted",
		recordSeq: 1,
		queueId: "q",
		workId: "work-1",
		commandId: "admit-1",
		recordedAtMs: 100,
		payload: {
			kind: "orchestration-queued-effect",
			effect: effect(),
		},
		messageBus: { topic: "work", seq: 1, subscriptionId: "sub" },
	};
}

function malformedAdmittedRecord(): WorkQueueRecord<OrchestrationQueuedEffectPayload> {
	return {
		kind: "work-admitted",
		recordSeq: 1,
		queueId: "q",
		workId: "work-bad",
		commandId: "admit-bad",
		recordedAtMs: 100,
		payload: null,
		messageBus: { topic: "work", seq: 1, subscriptionId: "sub" },
	} as unknown as WorkQueueRecord<OrchestrationQueuedEffectPayload>;
}
