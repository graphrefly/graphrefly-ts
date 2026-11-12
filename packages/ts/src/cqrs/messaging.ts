/**
 * Optional CQRS-over-messageBus recipe (D350/D351/D353).
 *
 * Retained message delivery is lowered to CQRS command facts. Ack commands are
 * derived only after visible CQRS accepted/rejected/error/audit material exists.
 */

import type { CqrsCommand, CqrsError, CqrsEvent, CqrsStatus } from "../cqrs/index.js";

import type { NodeFn } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import type { GraphRecipeFactory } from "../graph/restore.js";
import { canonicalTupleKey, compoundTupleKey } from "../identity.js";
import type {
	MessageBusAvailablePage,
	MessageBusCommand,
	MessageBusMessage,
} from "../messaging/index.js";
import type { Node } from "../node/node.js";
import { oneArrayPerRun } from "../node/one-array-per-run.js";

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

/** Build the optional D350/D351 CQRS messaging recipe.
 * @param graph - Graph that owns the created nodes or projector.
 * @param opts - Options that configure the helper.
 * @returns A bundle of graph-visible nodes for the recipe.
 * @category cqrs
 * @example
 * ```ts
 * import { cqrsMessagingRecipe } from "@graphrefly/ts/cqrs/messaging";
 * ```
 */
export function cqrsMessagingRecipe<TPayload = unknown, TCommand = unknown, TEvent = unknown>(
	graph: Graph,
	opts: CqrsMessagingRecipeOptions<TPayload, TCommand, TEvent>,
): CqrsMessagingRecipeBundle<TCommand> {
	const name = opts.name ?? "cqrsMessaging";
	const runtime = graph.node<CqrsMessagingFact<TCommand>>(
		[opts.deliveries],
		oneArrayPerRun((ctx) => {
			for (const raw of ctx.deps[0].waves.flat()) {
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
		}),
		{
			name: `${name}/runtime`,
			factory: "cqrsMessagingRuntime",
			complete: "manual",
			error: "manual",
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

/**
 * Creates a CQRS message command.
 *
 * @param message - message value used by the helper.
 * @param delivery - delivery value used by the helper.
 * @param policy - Policy object used to admit, retry, or route work.
 * @returns The CQRS message command result.
 * @category cqrs
 * @example
 * ```ts
 * import { cqrsMessageCommand } from "@graphrefly/ts/cqrs/messaging";
 * ```
 */
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
			// Absent fields are omitted, so the command stays strict JSON (R-checkpoint@1).
			...optionalStringField(message.payload, "aggregateId"),
			...optionalStringField(message.payload, "correlationId"),
			...optionalStringField(message.payload, "causationId"),
			metadata: {
				...(objectField(message.payload, "metadata") ?? {}),
			},
		},
		delivery,
	);
}

/**
 * Creates a CQRS message ack commands.
 *
 * @param graph - Graph that owns the created nodes or projector.
 * @param opts - Options that configure the helper.
 * @returns The CQRS message ack commands result.
 * @category cqrs
 * @example
 * ```ts
 * import { cqrsMessageAckCommands } from "@graphrefly/ts/cqrs/messaging";
 * ```
 */
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
	const config: AckCommandsConfig = {
		ackRejected: opts.ackRejected !== false,
		issues: opts.issues !== undefined,
	};
	return graph.node<MessageBusCommand>(
		opts.issues === undefined
			? [opts.commands, opts.status]
			: [opts.commands, opts.status, opts.issues],
		ackCommandsFn(config),
		{
			name: opts.name ?? "cqrsMessaging/ackCommands",
			factory: "cqrsMessagingAckCommands",
			complete: "manual",
			error: "manual",
			recipe: { ref: ACK_COMMANDS_REF, config },
		},
	);
}

const ACK_COMMANDS_REF = "cqrsMessaging.ackCommands";
const OUTBOX_COMMANDS_REF = "cqrsMessaging.outboxCommands";

/** The ack commands node's recipe config: its policy and whether it reads an issues input. */
interface AckCommandsConfig {
	readonly ackRejected: boolean;
	readonly issues: boolean;
}

/**
 * Deliveries awaiting a CQRS status, by command id, in arrival order: strict JSON private state
 * (R-checkpoint@1), so a checkpoint keeps what a restored node still has to ack.
 */
type PendingDeliveries = Array<[commandId: string, deliveries: MessageBusDelivery[]]>;

function ackCommandsFn(config: AckCommandsConfig): NodeFn {
	return oneArrayPerRun((ctx) => {
		const deliveries = ctx.state.get<PendingDeliveries>() ?? [];
		for (const raw of ctx.deps[0].waves.flat()) {
			const command = raw as CqrsCommand;
			const delivery = commandDelivery(command);
			if (delivery !== undefined) pushDelivery(deliveries, command.id, delivery);
		}
		for (const raw of ctx.deps[1]?.waves.flat() ?? []) {
			const status = raw as CqrsStatus;
			if (status.state === "rejected" && !config.ackRejected) continue;
			if (status.commandId === undefined) continue;
			const delivery = shiftDelivery(deliveries, status.commandId);
			if (delivery === undefined) continue;
			ctx.down([["DATA", ackCommand(delivery, ackCommandId("cqrs", delivery, "status"))]]);
		}
		if (config.issues) {
			for (const raw of ctx.deps[2]?.waves.flat() ?? []) {
				const issue = raw as DataIssue;
				const delivery = issueDelivery(issue);
				if (delivery !== undefined) {
					ctx.down([["DATA", ackCommand(delivery, ackCommandId("cqrs", delivery, "issue"))]]);
				}
			}
		}
		ctx.state.set(deliveries);
	});
}

/**
 * Creates a CQRS event outbox commands.
 *
 * @param graph - Graph that owns the created nodes or projector.
 * @param events - Event node or event collection to consume.
 * @param topic - topic value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns The CQRS event outbox commands result.
 * @category cqrs
 * @example
 * ```ts
 * import { cqrsEventOutboxCommands } from "@graphrefly/ts/cqrs/messaging";
 * ```
 */
export function cqrsEventOutboxCommands<TEvent>(
	graph: Graph,
	events: Node<CqrsEvent<TEvent>>,
	topic: string,
	opts: { readonly name?: string } = {},
): Node<MessageBusCommand> {
	return graph.node<MessageBusCommand>([events], outboxCommandsFn(topic), {
		name: opts.name ?? "cqrsMessaging/outboxCommands",
		factory: "cqrsMessagingOutboxCommands",
		complete: "manual",
		error: "manual",
		recipe: { ref: OUTBOX_COMMANDS_REF, config: { topic } },
	});
}

function outboxCommandsFn(topic: string): NodeFn {
	return oneArrayPerRun((ctx) => {
		for (const event of ctx.deps[0].waves.flat()) {
			const typed = event as CqrsEvent;
			ctx.down([
				[
					"DATA",
					{
						kind: "publish",
						topic,
						payload: typed,
						// An event with no aggregate has no key: omitted, not undefined (strict JSON).
						...(typed.aggregateId === undefined ? {} : { key: typed.aggregateId }),
						commandId: compoundTupleKey("cqrs-outbox", [typed.id]),
						idempotencyKey: typed.id,
					} satisfies MessageBusCommand,
				],
			]);
		}
	});
}

function recipeObject(config: unknown, ref: string): Record<string, unknown> {
	if (typeof config !== "object" || config === null || Array.isArray(config))
		throw new Error(`restoreGraph: '${ref}' recipe requires an object config`);
	return config as Record<string, unknown>;
}

/**
 * Restore entries for the CQRS messaging ack and outbox command nodes (R-checkpoint@1): add them
 * to the registry given to restoreGraph.
 * @category cqrs
 * @example
 * ```ts
 * import { cqrsMessagingRestoreRegistry } from "@graphrefly/ts/cqrs/messaging";
 * import { defaultRestoreRegistry, restoreGraph } from "@graphrefly/ts/graph";
 *
 * const g = restoreGraph(checkpoint, {
 *   registry: { ...defaultRestoreRegistry, ...cqrsMessagingRestoreRegistry },
 * });
 * ```
 */
export const cqrsMessagingRestoreRegistry: Readonly<Record<string, GraphRecipeFactory<any>>> = {
	[ACK_COMMANDS_REF]: {
		ref: ACK_COMMANDS_REF,
		validateConfig(config): AckCommandsConfig {
			const c = recipeObject(config, ACK_COMMANDS_REF);
			if (typeof c.ackRejected !== "boolean" || typeof c.issues !== "boolean")
				throw new Error(
					`restoreGraph: '${ACK_COMMANDS_REF}' config.ackRejected and config.issues must be booleans`,
				);
			return { ackRejected: c.ackRejected, issues: c.issues };
		},
		build(config: AckCommandsConfig) {
			return { fn: ackCommandsFn(config) };
		},
	} satisfies GraphRecipeFactory<AckCommandsConfig>,
	[OUTBOX_COMMANDS_REF]: {
		ref: OUTBOX_COMMANDS_REF,
		validateConfig(config): { readonly topic: string } {
			const topic = recipeObject(config, OUTBOX_COMMANDS_REF).topic;
			if (typeof topic !== "string" || topic.length === 0)
				throw new Error(`restoreGraph: '${OUTBOX_COMMANDS_REF}' config.topic must be a string`);
			return { topic };
		},
		build(config: { readonly topic: string }) {
			return { fn: outboxCommandsFn(config.topic) };
		},
	} satisfies GraphRecipeFactory<{ readonly topic: string }>,
};

function project<T, TCommand>(
	graph: Graph,
	runtime: Node<CqrsMessagingFact<TCommand>>,
	name: string,
	factory: string,
	pick: (fact: CqrsMessagingFact<TCommand>) => T | undefined,
): Node<T> {
	return graph.node<T>(
		[runtime],
		oneArrayPerRun((ctx) => {
			for (const fact of ctx.deps[0].waves.flat()) {
				const value = pick(fact as CqrsMessagingFact<TCommand>);
				if (value !== undefined) ctx.down([["DATA", value]]);
			}
		}),
		{ name, factory, complete: "manual", error: "manual" },
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
	deliveries: PendingDeliveries,
	commandId: string,
	delivery: MessageBusDelivery,
): void {
	const entry = deliveries.find(([id]) => id === commandId);
	if (entry === undefined) deliveries.push([commandId, [delivery]]);
	else entry[1] = [...entry[1], delivery];
}

function shiftDelivery(
	deliveries: PendingDeliveries,
	commandId: string,
): MessageBusDelivery | undefined {
	const at = deliveries.findIndex(([id]) => id === commandId);
	if (at < 0) return undefined;
	const [first, ...rest] = (deliveries[at] as PendingDeliveries[number])[1];
	if (rest.length === 0) deliveries.splice(at, 1);
	else deliveries[at] = [commandId, rest];
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

/** `{ [key]: value }` when the record has a string `key`, else nothing. */
function optionalStringField(record: Record<string, unknown>, key: string): Record<string, string> {
	const value = stringField(record, key);
	return value === undefined ? {} : { [key]: value };
}
