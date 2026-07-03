/**
 * Optional CQRS-over-messageBus recipe (D350/D351/D353).
 *
 * Retained message delivery is lowered to CQRS command facts. Ack commands are
 * derived only after visible CQRS accepted/rejected/error/audit material exists.
 */

import type { CqrsCommand, CqrsError, CqrsEvent, CqrsStatus } from "../cqrs/index.js";
import { depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey, compoundTupleKey } from "../identity.js";
import type {
	MessageBusAvailablePage,
	MessageBusCommand,
	MessageBusMessage,
} from "../messaging/index.js";
import type { Node } from "../node/node.js";

export interface CqrsMessagingPolicy<TPayload = unknown, TCommand = unknown> {
	readonly command?: (
		message: MessageBusMessage<TPayload>,
		delivery: MessageBusDelivery,
	) => CqrsCommand<TCommand> | undefined;
	readonly ackRejected?: boolean;
	readonly outboxTopic?: string;
}

export interface CqrsMessagingRecipeOptions<
	TPayload = unknown,
	TCommand = unknown,
	TEvent = unknown,
> {
	readonly name?: string;
	readonly deliveries: Node<MessageBusAvailablePage<TPayload>>;
	readonly status: Node<CqrsStatus>;
	readonly errors?: Node<CqrsError>;
	readonly events?: Node<CqrsEvent<TEvent>>;
	readonly policy?: CqrsMessagingPolicy<TPayload, TCommand>;
}

export interface CqrsMessagingRecipeBundle<TCommand = unknown> {
	readonly commands: Node<CqrsCommand<TCommand>>;
	readonly ackCommands: Node<MessageBusCommand>;
	readonly outboxCommands?: Node<MessageBusCommand>;
	readonly issues: Node<DataIssue>;
}

type CqrsMessagingFact<TCommand> =
	| { readonly kind: "command"; readonly command: CqrsCommand<TCommand> }
	| { readonly kind: "issue"; readonly issue: DataIssue };

export interface MessageBusDelivery {
	readonly topic: string;
	readonly seq: number;
	readonly subscriptionId: string;
	readonly commandId: string;
}

/** Build the optional D350/D351 CQRS messaging recipe. */
export function cqrsMessagingRecipe<TPayload = unknown, TCommand = unknown, TEvent = unknown>(
	graph: Graph,
	opts: CqrsMessagingRecipeOptions<TPayload, TCommand, TEvent>,
): CqrsMessagingRecipeBundle<TCommand> {
	const name = opts.name ?? "cqrsMessaging";
	const runtime = graph.node<CqrsMessagingFact<TCommand>>(
		[opts.deliveries],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const page = raw as MessageBusAvailablePage<TPayload>;
				for (const message of page.messages) {
					const delivery = messageDelivery(page, message);
					const command = cqrsMessageCommand(message, delivery, opts.policy);
					if (command === undefined) {
						ctx.down([["DATA", { kind: "issue", issue: messageIssue(message, delivery) }]]);
					} else {
						ctx.down([["DATA", { kind: "command", command }]]);
					}
				}
			}
		},
		{
			name: `${name}/runtime`,
			factory: "cqrsMessagingRuntime",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const issues = project(graph, runtime, `${name}/issues`, "cqrsMessagingIssues", (fact) =>
		fact.kind === "issue" ? fact.issue : undefined,
	);
	const commands = project(graph, runtime, `${name}/commands`, "cqrsMessagingCommands", (fact) =>
		fact.kind === "command" ? fact.command : undefined,
	);
	const ackCommands = cqrsMessageAckCommands(graph, {
		name: `${name}/ackCommands`,
		commands,
		status: opts.status,
		issues,
		ackRejected: opts.policy?.ackRejected ?? true,
	});
	return {
		commands,
		ackCommands,
		...(opts.events === undefined || opts.policy?.outboxTopic === undefined
			? {}
			: {
					outboxCommands: cqrsEventOutboxCommands(graph, opts.events, opts.policy.outboxTopic, {
						name: `${name}/outboxCommands`,
					}),
				}),
		issues,
	};
}

export function cqrsMessageCommand<TPayload = unknown, TCommand = unknown>(
	message: MessageBusMessage<TPayload>,
	delivery: MessageBusDelivery,
	policy?: CqrsMessagingPolicy<TPayload, TCommand>,
): CqrsCommand<TCommand> | undefined {
	const mapped = policy?.command?.(message, delivery);
	if (mapped !== undefined) return commandWithDelivery(mapped, delivery);
	if (!isObjectRecord(message.payload)) return undefined;
	const id = stringField(message.payload, "id") ?? delivery.commandId;
	const type = stringField(message.payload, "type");
	if (type === undefined) return undefined;
	return commandWithDelivery(
		{
			id,
			type,
			payload: message.payload.payload as TCommand,
			aggregateId: stringField(message.payload, "aggregateId"),
			correlationId: stringField(message.payload, "correlationId"),
			causationId: stringField(message.payload, "causationId"),
			metadata: {
				...(objectField(message.payload, "metadata") ?? {}),
			},
		},
		delivery,
	);
}

export function cqrsMessageAckCommands(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly commands: Node<CqrsCommand>;
		readonly status: Node<CqrsStatus>;
		readonly issues?: Node<DataIssue>;
		readonly ackRejected?: boolean;
	},
): Node<MessageBusCommand> {
	return graph.node<MessageBusCommand>(
		opts.issues === undefined
			? [opts.commands, opts.status]
			: [opts.commands, opts.status, opts.issues],
		(ctx) => {
			const deliveries =
				ctx.state.get<Map<string, MessageBusDelivery[]>>() ??
				new Map<string, MessageBusDelivery[]>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const command = raw as CqrsCommand;
				const delivery = commandDelivery(command);
				if (delivery !== undefined) pushDelivery(deliveries, command.id, delivery);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const status = raw as CqrsStatus;
				if (status.state === "rejected" && opts.ackRejected === false) continue;
				if (status.commandId === undefined) continue;
				const delivery = shiftDelivery(deliveries, status.commandId);
				if (delivery === undefined) continue;
				ctx.down([["DATA", ackCommand(delivery, ackCommandId("cqrs", delivery, "status"))]]);
			}
			if (opts.issues !== undefined) {
				for (const raw of depBatch(ctx, 2) ?? []) {
					const issue = raw as DataIssue;
					const delivery = issueDelivery(issue);
					if (delivery !== undefined) {
						ctx.down([["DATA", ackCommand(delivery, ackCommandId("cqrs", delivery, "issue"))]]);
					}
				}
			}
			ctx.state.set(deliveries);
		},
		{
			name: opts.name ?? "cqrsMessaging/ackCommands",
			factory: "cqrsMessagingAckCommands",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
}

export function cqrsEventOutboxCommands<TEvent>(
	graph: Graph,
	events: Node<CqrsEvent<TEvent>>,
	topic: string,
	opts: { readonly name?: string } = {},
): Node<MessageBusCommand> {
	return graph.node<MessageBusCommand>(
		[events],
		(ctx) => {
			for (const event of depBatch(ctx, 0) ?? []) {
				const typed = event as CqrsEvent<TEvent>;
				ctx.down([
					[
						"DATA",
						{
							kind: "publish",
							topic,
							payload: typed,
							key: typed.aggregateId,
							commandId: compoundTupleKey("cqrs-outbox", [typed.id]),
							idempotencyKey: typed.id,
						} satisfies MessageBusCommand,
					],
				]);
			}
		},
		{
			name: opts.name ?? "cqrsMessaging/outboxCommands",
			factory: "cqrsMessagingOutboxCommands",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
}

function project<T, TCommand>(
	graph: Graph,
	runtime: Node<CqrsMessagingFact<TCommand>>,
	name: string,
	factory: string,
	pick: (fact: CqrsMessagingFact<TCommand>) => T | undefined,
): Node<T> {
	return graph.node<T>(
		[runtime],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) {
				const value = pick(fact as CqrsMessagingFact<TCommand>);
				if (value !== undefined) ctx.down([["DATA", value]]);
			}
		},
		{ name, factory, partial: true, completeWhenDepsComplete: false, errorWhenDepsError: false },
	);
}

function messageIssue(message: MessageBusMessage, delivery: MessageBusDelivery): DataIssue {
	return {
		kind: "issue",
		code: "cqrs-message-lowering-rejected",
		message: "CQRS messaging recipe could not lower retained message to a command fact",
		severity: "error",
		source: "cqrs.messaging",
		metadata: {
			messageBus: {
				topic: delivery.topic,
				seq: delivery.seq,
				subscriptionId: delivery.subscriptionId,
				commandId: delivery.commandId,
			},
		},
		details: message,
	};
}

function ackCommand(delivery: MessageBusDelivery, commandId: string): MessageBusCommand {
	return {
		kind: "ack",
		topic: delivery.topic,
		subscriptionId: delivery.subscriptionId,
		seq: delivery.seq,
		commandId,
	};
}

function ackCommandId(namespace: string, delivery: MessageBusDelivery, reason: string): string {
	return compoundTupleKey("cqrs-message-ack", [
		namespace,
		delivery.topic,
		delivery.subscriptionId,
		String(delivery.seq),
		reason,
	]);
}

function commandWithDelivery<TCommand>(
	command: CqrsCommand<TCommand>,
	delivery: MessageBusDelivery,
): CqrsCommand<TCommand> {
	return {
		...command,
		metadata: {
			...(command.metadata ?? {}),
			messageBus: delivery,
		},
	};
}

function messageDelivery(
	page: MessageBusAvailablePage,
	message: MessageBusMessage,
): MessageBusDelivery {
	return {
		topic: page.topic,
		seq: message.seq,
		subscriptionId: page.subscriptionId,
		commandId:
			isObjectRecord(message.payload) && typeof message.payload.id === "string"
				? message.payload.id
				: (message.commandId ?? canonicalTupleKey([page.topic, String(message.seq)])),
	};
}

function pushDelivery(
	deliveries: Map<string, MessageBusDelivery[]>,
	commandId: string,
	delivery: MessageBusDelivery,
): void {
	const queue = deliveries.get(commandId) ?? [];
	deliveries.set(commandId, [...queue, delivery]);
}

function shiftDelivery(
	deliveries: Map<string, MessageBusDelivery[]>,
	commandId: string,
): MessageBusDelivery | undefined {
	const queue = deliveries.get(commandId);
	if (queue === undefined || queue.length === 0) return undefined;
	const [first, ...rest] = queue;
	if (rest.length === 0) deliveries.delete(commandId);
	else deliveries.set(commandId, rest);
	return first;
}

function issueDelivery(issue: DataIssue): MessageBusDelivery | undefined {
	const metadata = isObjectRecord(issue.metadata) ? issue.metadata : undefined;
	const messageBus = isObjectRecord(metadata?.messageBus) ? metadata.messageBus : undefined;
	if (messageBus === undefined) return undefined;
	if (typeof messageBus.topic !== "string" || typeof messageBus.seq !== "number") return undefined;
	if (typeof messageBus.subscriptionId !== "string") return undefined;
	if (typeof messageBus.commandId !== "string") return undefined;
	return {
		topic: messageBus.topic,
		seq: messageBus.seq,
		subscriptionId: messageBus.subscriptionId,
		commandId: messageBus.commandId,
	};
}

function commandDelivery(command: CqrsCommand): MessageBusDelivery | undefined {
	const metadata = isObjectRecord(command.metadata) ? command.metadata : undefined;
	const messageBus = isObjectRecord(metadata?.messageBus) ? metadata.messageBus : undefined;
	if (messageBus === undefined) return undefined;
	return messageBusDelivery(messageBus);
}

function messageBusDelivery(messageBus: Record<string, unknown>): MessageBusDelivery | undefined {
	if (typeof messageBus.topic !== "string" || typeof messageBus.seq !== "number") return undefined;
	if (typeof messageBus.subscriptionId !== "string") return undefined;
	const commandId = typeof messageBus.commandId === "string" ? messageBus.commandId : "";
	return {
		topic: messageBus.topic,
		seq: messageBus.seq,
		subscriptionId: messageBus.subscriptionId,
		commandId,
	};
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function objectField(
	record: Record<string, unknown>,
	key: string,
): Record<string, unknown> | undefined {
	const value = record[key];
	return isObjectRecord(value) ? value : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
