import { describe, expect, it } from "vitest";
import type { CqrsStatus } from "../cqrs/index.js";
import { cqrsMessagingRecipe } from "../cqrs/messaging.js";
import { graph } from "../graph/graph.js";
import type {
	MessageBusAvailablePage,
	MessageBusCommand,
	MessageBusMessage,
} from "../messaging/index.js";
import type { ProcessStatus } from "../orchestration/index.js";
import { orchestrationMessagingRecipe } from "../orchestration/messaging.js";

describe("messaging recipes (D349-D351/D353)", () => {
	it("does not ack orchestration retained delivery until a visible ProcessStatus exists", () => {
		const g = graph();
		const deliveries = g.node<MessageBusAvailablePage>([], null, { name: "deliveries" });
		const status = g.node<ProcessStatus>([], null, { name: "processStatus" });
		const recipe = orchestrationMessagingRecipe(g, { deliveries, status });
		const commands = collectData(recipe.commands);
		const acks = collectData<MessageBusCommand>(recipe.ackCommands);

		deliveries.down([["DATA", page("sub-1", [message("cmd-1", 7)])]]);

		expect(commands.at(-1)).toEqual(
			expect.objectContaining({ id: "cmd-1", type: "start", payload: { ok: true } }),
		);
		expect(acks).toEqual([]);

		status.down([
			[
				"DATA",
				{
					state: "accepted",
					commandId: "cmd-1",
					commandType: "start",
					eventCount: 1,
					effectCount: 0,
					cursor: { eventSeq: 1, effectSeq: 0, commandCount: 1, errorCount: 0, auditSeq: 1 },
				} satisfies ProcessStatus,
			],
		]);

		expect(acks.at(-1)).toEqual(
			expect.objectContaining({
				kind: "ack",
				topic: "commands",
				subscriptionId: "sub-1",
				seq: 7,
			}),
		);
	});

	it("does not ack CQRS retained delivery until visible accepted/rejected material exists", () => {
		const g = graph();
		const deliveries = g.node<MessageBusAvailablePage>([], null, { name: "deliveries" });
		const status = g.node<CqrsStatus>([], null, { name: "cqrsStatus" });
		const recipe = cqrsMessagingRecipe(g, { deliveries, status });
		const acks = collectData<MessageBusCommand>(recipe.ackCommands);

		deliveries.down([["DATA", page("sub-2", [message("cmd-2", 7)])]]);
		expect(acks).toEqual([]);

		status.down([
			[
				"DATA",
				{
					state: "rejected",
					commandId: "cmd-2",
					commandType: "start",
					eventCount: 0,
					errorCode: "unknown-command",
					cursor: { eventSeq: 0, commandCount: 1, errorCount: 1, auditSeq: 1 },
				} satisfies CqrsStatus,
			],
		]);

		expect(acks.at(-1)).toEqual(
			expect.objectContaining({
				kind: "ack",
				topic: "commands",
				subscriptionId: "sub-2",
				seq: 7,
			}),
		);
	});

	it("acks duplicate retained command ids in delivery order instead of overwriting cursors", () => {
		const g = graph();
		const deliveries = g.node<MessageBusAvailablePage>([], null, { name: "deliveries" });
		const status = g.node<CqrsStatus>([], null, { name: "cqrsStatus" });
		const recipe = cqrsMessagingRecipe(g, { deliveries, status });
		const acks = collectData<MessageBusCommand>(recipe.ackCommands);

		deliveries.down([["DATA", page("sub-dup", [message("cmd-dup", 7), message("cmd-dup", 8)])]]);
		status.down([
			["DATA", cqrsStatus("cmd-dup", "accepted")],
			["DATA", cqrsStatus("cmd-dup", "rejected")],
		]);

		expect(acks.map((ack) => ack.seq)).toEqual([7, 8]);
		expect(acks.every((ack) => ack.subscriptionId === "sub-dup")).toBe(true);
		expect(new Set(acks.map((ack) => ack.commandId)).size).toBe(2);
	});

	it("acks CQRS retained delivery by the actual lowered policy command id", () => {
		const g = graph();
		const deliveries = g.node<MessageBusAvailablePage>([], null, { name: "deliveries" });
		const status = g.node<CqrsStatus>([], null, { name: "cqrsStatus" });
		const recipe = cqrsMessagingRecipe(g, {
			deliveries,
			status,
			policy: {
				command: () => ({ id: "mapped-cmd", type: "mapped", payload: { mapped: true } }),
			},
		});
		const commands = collectData(recipe.commands);
		const acks = collectData<MessageBusCommand>(recipe.ackCommands);

		deliveries.down([["DATA", page("sub-policy", [message("payload-cmd", 9)])]]);
		status.down([["DATA", cqrsStatus("payload-cmd", "accepted")]]);
		expect(acks).toEqual([]);

		status.down([["DATA", cqrsStatus("mapped-cmd", "accepted")]]);

		expect(commands.at(-1)).toEqual(
			expect.objectContaining({
				id: "mapped-cmd",
				metadata: {
					messageBus: expect.objectContaining({
						topic: "commands",
						subscriptionId: "sub-policy",
						seq: 9,
					}),
				},
			}),
		);
		expect(acks.at(-1)).toEqual(
			expect.objectContaining({
				kind: "ack",
				topic: "commands",
				subscriptionId: "sub-policy",
				seq: 9,
				commandId: "cqrs:commands:sub-policy:9:status-ack",
			}),
		);
	});

	it("acks orchestration retained delivery by the actual lowered policy command id", () => {
		const g = graph();
		const deliveries = g.node<MessageBusAvailablePage>([], null, { name: "deliveries" });
		const status = g.node<ProcessStatus>([], null, { name: "processStatus" });
		const recipe = orchestrationMessagingRecipe(g, {
			deliveries,
			status,
			policy: {
				command: () => ({ id: "mapped-process", type: "mapped", payload: { mapped: true } }),
			},
		});
		const acks = collectData<MessageBusCommand>(recipe.ackCommands);

		deliveries.down([["DATA", page("sub-process-policy", [message("payload-process", 10)])]]);
		status.down([
			[
				"DATA",
				{
					state: "accepted",
					commandId: "payload-process",
					commandType: "mapped",
					eventCount: 1,
					effectCount: 0,
					cursor: { eventSeq: 1, effectSeq: 0, commandCount: 1, errorCount: 0, auditSeq: 1 },
				} satisfies ProcessStatus,
			],
		]);
		expect(acks).toEqual([]);

		status.down([
			[
				"DATA",
				{
					state: "accepted",
					commandId: "mapped-process",
					commandType: "mapped",
					eventCount: 1,
					effectCount: 0,
					cursor: { eventSeq: 1, effectSeq: 0, commandCount: 1, errorCount: 0, auditSeq: 1 },
				} satisfies ProcessStatus,
			],
		]);

		expect(acks.at(-1)).toEqual(
			expect.objectContaining({
				kind: "ack",
				topic: "commands",
				subscriptionId: "sub-process-policy",
				seq: 10,
				commandId: "orchestration:commands:sub-process-policy:10:status-ack",
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

function message(id: string, seq: number): MessageBusMessage {
	return {
		topic: "commands",
		seq,
		payload: {
			id,
			type: "start",
			payload: { ok: true },
		},
		timestampMs: 100,
		commandId: `${id}:publish`,
	};
}

function page(
	subscriptionId: string,
	messages: readonly MessageBusMessage[],
): MessageBusAvailablePage {
	return {
		topic: "commands",
		subscriptionId,
		cursor: {
			topic: "commands",
			subscriptionId,
			nextSeq: messages[0]?.seq ?? 0,
			closed: false,
			retentionGap: false,
			headSeq: messages[0]?.seq ?? 0,
		},
		messages,
		fromSeq: messages[0]?.seq ?? 0,
		throughSeq: messages.at(-1)?.seq,
		hasMore: false,
	};
}

function cqrsStatus(commandId: string, state: CqrsStatus["state"]): CqrsStatus {
	return {
		state,
		commandId,
		commandType: "start",
		eventCount: state === "accepted" ? 1 : 0,
		errorCode: state === "rejected" ? "unknown-command" : undefined,
		cursor: {
			eventSeq: state === "accepted" ? 1 : 0,
			commandCount: 1,
			errorCount: state === "rejected" ? 1 : 0,
			auditSeq: 1,
		},
	};
}
