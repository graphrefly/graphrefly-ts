/**
 * Optional orchestration-over-messageBus recipe (D349/D351/D353).
 *
 * Ack commands are graph-derived from visible ProcessBundle accepted/rejected
 * material; retained delivery receipt is never an ack.
 */

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
import type { ProcessCommand, ProcessEvent, ProcessStatus } from "../orchestration/index.js";

export interface OrchestrationMessagingPolicy<TPayload = unknown, TCommand = unknown> {
	readonly command?: (
		message: MessageBusMessage<TPayload>,
		delivery: MessageBusDelivery,
	) => ProcessCommand<TCommand> | undefined;
	readonly ackRejected?: boolean;
	readonly outboxTopic?: string;
}

export interface OrchestrationMessagingRecipeOptions<
	TPayload = unknown,
	TCommand = unknown,
	TEvent = unknown,
> {
	readonly name?: string;
	readonly deliveries: Node<MessageBusAvailablePage<TPayload>>;
	readonly status: Node<ProcessStatus>;
	readonly events?: Node<ProcessEvent<TEvent>>;
	readonly policy?: OrchestrationMessagingPolicy<TPayload, TCommand>;
}

export interface OrchestrationMessagingRecipeBundle<TCommand = unknown> {
	readonly commands: Node<ProcessCommand<TCommand>>;
	readonly ackCommands: Node<MessageBusCommand>;
	readonly outboxCommands?: Node<MessageBusCommand>;
	readonly issues: Node<DataIssue>;
}

type OrchestrationMessagingFact<TCommand> =
	| { readonly kind: "command"; readonly command: ProcessCommand<TCommand> }
	| { readonly kind: "issue"; readonly issue: DataIssue };

export interface MessageBusDelivery {
	readonly topic: string;
	readonly seq: number;
	readonly subscriptionId: string;
	readonly commandId: string;
}

/** Build the optional D349/D351 orchestration messaging recipe. */
export function orchestrationMessagingRecipe<
	TPayload = unknown,
	TCommand = unknown,
	TEvent = unknown,
>(
	graph: Graph,
	opts: OrchestrationMessagingRecipeOptions<TPayload, TCommand, TEvent>,
): OrchestrationMessagingRecipeBundle<TCommand> {
	const name = opts.name ?? "orchestrationMessaging";
	const runtime = graph.node<OrchestrationMessagingFact<TCommand>>(
		[opts.deliveries],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const page = raw as MessageBusAvailablePage<TPayload>;
				for (const message of page.messages) {
					const delivery = messageDelivery(page, message);
					const command = orchestrationMessageCommand(message, delivery, opts.policy);
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
			factory: "orchestrationMessagingRuntime",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const issues = project(
		graph,
		runtime,
		`${name}/issues`,
		"orchestrationMessagingIssues",
		(fact) => (fact.kind === "issue" ? fact.issue : undefined),
	);
	const commands = project(
		graph,
		runtime,
		`${name}/commands`,
		"orchestrationMessagingCommands",
		(fact) => (fact.kind === "command" ? fact.command : undefined),
	);
	return {
		commands,
		ackCommands: orchestrationMessageAckCommands(graph, {
			name: `${name}/ackCommands`,
			commands,
			status: opts.status,
			issues,
			ackRejected: opts.policy?.ackRejected ?? true,
		}),
		...(opts.events === undefined || opts.policy?.outboxTopic === undefined
			? {}
			: {
					outboxCommands: processEventOutboxCommands(graph, opts.events, opts.policy.outboxTopic, {
						name: `${name}/outboxCommands`,
					}),
				}),
		issues,
	};
}

/**
 * Creates an orchestration message command.
 *
 * @param message - message value used by the helper.
 * @param delivery - delivery value used by the helper.
 * @param policy - Policy object used to admit, retry, or route work.
 * @returns The orchestration message command result.
 * @category orchestration
 * @example
 * ```ts
 * import { orchestrationMessageCommand } from "@graphrefly/ts/orchestration/messaging";
 * ```
 */
export function orchestrationMessageCommand<TPayload = unknown, TCommand = unknown>(
	message: MessageBusMessage<TPayload>,
	delivery: MessageBusDelivery,
	policy?: OrchestrationMessagingPolicy<TPayload, TCommand>,
): ProcessCommand<TCommand> | undefined {
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
			processId: stringField(message.payload, "processId"),
			correlationId: stringField(message.payload, "correlationId"),
			causationId: stringField(message.payload, "causationId"),
			metadata: {
				...(objectField(message.payload, "metadata") ?? {}),
			},
		},
		delivery,
	);
}

/**
 * Creates an orchestration message ack commands.
 *
 * @param graph - Graph that owns the created nodes or projector.
 * @param opts - Options that configure the helper.
 * @returns The orchestration message ack commands result.
 * @category orchestration
 * @example
 * ```ts
 * import { orchestrationMessageAckCommands } from "@graphrefly/ts/orchestration/messaging";
 * ```
 */
export function orchestrationMessageAckCommands(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly commands: Node<ProcessCommand>;
		readonly status: Node<ProcessStatus>;
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
				const command = raw as ProcessCommand;
				const delivery = commandDelivery(command);
				if (delivery !== undefined) pushDelivery(deliveries, command.id, delivery);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const status = raw as ProcessStatus;
				if (status.state === "rejected" && opts.ackRejected === false) continue;
				if (status.commandId === undefined) continue;
				const delivery = shiftDelivery(deliveries, status.commandId);
				if (delivery === undefined) continue;
				ctx.down([
					["DATA", ackCommand(delivery, ackCommandId("orchestration", delivery, "status"))],
				]);
			}
			if (opts.issues !== undefined) {
				for (const raw of depBatch(ctx, 2) ?? []) {
					const delivery = issueDelivery(raw as DataIssue);
					if (delivery !== undefined) {
						ctx.down([
							["DATA", ackCommand(delivery, ackCommandId("orchestration", delivery, "issue"))],
						]);
					}
				}
			}
			ctx.state.set(deliveries);
		},
		{
			name: opts.name ?? "orchestrationMessaging/ackCommands",
			factory: "orchestrationMessagingAckCommands",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
}

/**
 * Creates a process event outbox commands.
 *
 * @param graph - Graph that owns the created nodes or projector.
 * @param events - Event node or event collection to consume.
 * @param topic - topic value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns The process event outbox commands result.
 * @category orchestration
 * @example
 * ```ts
 * import { processEventOutboxCommands } from "@graphrefly/ts/orchestration/messaging";
 * ```
 */
export function processEventOutboxCommands<TEvent>(
	graph: Graph,
	events: Node<ProcessEvent<TEvent>>,
	topic: string,
	opts: { readonly name?: string } = {},
): Node<MessageBusCommand> {
	return graph.node<MessageBusCommand>(
		[events],
		(ctx) => {
			for (const event of depBatch(ctx, 0) ?? []) {
				const typed = event as ProcessEvent<TEvent>;
				ctx.down([
					[
						"DATA",
						{
							kind: "publish",
							topic,
							payload: typed,
							key: typed.processId,
							commandId: compoundTupleKey("process-outbox", [typed.id]),
							idempotencyKey: typed.id,
						} satisfies MessageBusCommand,
					],
				]);
			}
		},
		{
			name: opts.name ?? "orchestrationMessaging/outboxCommands",
			factory: "orchestrationMessagingOutboxCommands",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
}

function project<T, TCommand>(
	graph: Graph,
	runtime: Node<OrchestrationMessagingFact<TCommand>>,
	name: string,
	factory: string,
	pick: (fact: OrchestrationMessagingFact<TCommand>) => T | undefined,
): Node<T> {
	return graph.node<T>(
		[runtime],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) {
				const value = pick(fact as OrchestrationMessagingFact<TCommand>);
				if (value !== undefined) ctx.down([["DATA", value]]);
			}
		},
		{ name, factory, partial: true, completeWhenDepsComplete: false, errorWhenDepsError: false },
	);
}

function messageIssue(message: MessageBusMessage, delivery: MessageBusDelivery): DataIssue {
	return {
		kind: "issue",
		code: "orchestration-message-lowering-rejected",
		message: "Orchestration messaging recipe could not lower retained message to a command fact",
		severity: "error",
		source: "orchestration.messaging",
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
	return compoundTupleKey("orchestration-message-ack", [
		namespace,
		delivery.topic,
		delivery.subscriptionId,
		String(delivery.seq),
		reason,
	]);
}

function commandWithDelivery<TCommand>(
	command: ProcessCommand<TCommand>,
	delivery: MessageBusDelivery,
): ProcessCommand<TCommand> {
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

function commandDelivery(command: ProcessCommand): MessageBusDelivery | undefined {
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
