/**
 * Reusable application-infrastructure messaging namespace.
 *
 * D279/D282/D284/D285/D276: messageBus is a retained topic-log plus independent
 * subscription-cursor substrate. DynamicHub is intentionally retired; do not add aliases.
 */

import { depBatch, type NodeFn } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import type { LockId, PullDemand } from "../protocol/messages.js";
import {
	attachMessageBusCommandSource,
	getMessageBusState,
	registerMessageBusState,
} from "./internal.js";

export interface MessageEnvelope<T = unknown> {
	readonly topic: string;
	readonly seq: number;
	readonly payload: T;
	readonly key?: string;
	readonly idempotencyKey?: string;
	readonly timestampMs: number;
	readonly commandId?: string;
}

/** Minimal JSON Schema vocabulary for passive topic payload descriptions (D125/D132). */
export interface JsonSchema {
	readonly type?:
		| "string"
		| "number"
		| "integer"
		| "boolean"
		| "object"
		| "array"
		| "null"
		| readonly ("string" | "number" | "integer" | "boolean" | "object" | "array" | "null")[];
	readonly properties?: Readonly<Record<string, JsonSchema>>;
	readonly required?: readonly string[];
	readonly additionalProperties?: boolean | JsonSchema;
	readonly items?: JsonSchema | readonly JsonSchema[];
	readonly enum?: readonly unknown[];
	readonly const?: unknown;
	readonly $ref?: string;
	readonly definitions?: Readonly<Record<string, JsonSchema>>;
	readonly description?: string;
	readonly title?: string;
}

/** Passive envelope for payloads that cross topic, agent, or graph boundaries. */
export interface TopicMessage<T = unknown> {
	readonly id: string;
	readonly schema?: JsonSchema;
	readonly expiresAt?: string;
	readonly correlationId?: string;
	readonly payload: T;
}

/** Passive domain event vocabulary for messageBus/eventFlow composition (D329). */
export interface EventMessage<T = unknown> {
	readonly id: string;
	readonly type: string;
	readonly payload: T;
	readonly key?: string;
	readonly subjectId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
	readonly occurredAtMs?: number;
	readonly actor?: string;
	readonly evidenceRefs?: readonly string[];
	readonly schema?: JsonSchema;
	readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface EventMessageOptions {
	readonly id: string;
	readonly key?: string;
	readonly subjectId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
	readonly occurredAtMs?: number;
	readonly actor?: string;
	readonly evidenceRefs?: readonly string[];
	readonly schema?: JsonSchema;
	readonly metadata?: Readonly<Record<string, unknown>>;
}

export function eventMessage<T>(
	type: string,
	payload: T,
	opts: EventMessageOptions,
): EventMessage<T> {
	assertNonEmpty(type, "eventMessage.type");
	assertNonEmpty(opts.id, "eventMessage.id");
	return {
		id: opts.id,
		type,
		payload,
		...(opts.key === undefined ? {} : { key: opts.key }),
		...(opts.subjectId === undefined ? {} : { subjectId: opts.subjectId }),
		...(opts.correlationId === undefined ? {} : { correlationId: opts.correlationId }),
		...(opts.causationId === undefined ? {} : { causationId: opts.causationId }),
		...(opts.occurredAtMs === undefined ? {} : { occurredAtMs: opts.occurredAtMs }),
		...(opts.actor === undefined ? {} : { actor: opts.actor }),
		...(opts.evidenceRefs === undefined ? {} : { evidenceRefs: opts.evidenceRefs }),
		...(opts.schema === undefined ? {} : { schema: opts.schema }),
		...(opts.metadata === undefined ? {} : { metadata: opts.metadata }),
	};
}

export function isEventMessage(value: unknown): value is EventMessage {
	return eventMessageIssue(value) === undefined;
}

export function eventMessageIssue(value: unknown): DataIssue | undefined {
	if (!isObjectRecord(value)) {
		return eventIssue("event message must be an object");
	}
	if (typeof value.id !== "string" || value.id.length === 0) {
		return eventIssue("event message id must be a non-empty string");
	}
	if (typeof value.type !== "string" || value.type.length === 0) {
		return eventIssue("event message type must be a non-empty string");
	}
	if (!("payload" in value)) {
		return eventIssue("event message payload field is required");
	}
	return undefined;
}

function eventIssue(message: string): DataIssue {
	return {
		kind: "issue",
		code: "malformed-event-message",
		message,
		severity: "error",
		source: "messageBus.eventMessage",
	};
}

export const PROMPTS_TOPIC = "prompts";
export const RESPONSES_TOPIC = "responses";
export const INJECTIONS_TOPIC = "injections";
export const DEFERRED_TOPIC = "deferred";
export const SPAWNS_TOPIC = "spawns";
export const CONTEXT_TOPIC = "context";
export const TODOS_TOPIC = "todos";

export const STANDARD_TOPICS = Object.freeze([
	PROMPTS_TOPIC,
	RESPONSES_TOPIC,
	INJECTIONS_TOPIC,
	DEFERRED_TOPIC,
	SPAWNS_TOPIC,
	CONTEXT_TOPIC,
	TODOS_TOPIC,
] as const);

export type StandardTopic = (typeof STANDARD_TOPICS)[number];

export type MessageBusTopicPolicy = "strict" | "create-as-fact";

export interface MessageBusRetentionPolicy {
	/** Count retention. Trimming advances headSeq and never rewrites seq (D284). */
	readonly maxMessages?: number;
}

export interface MessageBusDedupePolicy {
	/** Duplicate commandId emits status and never publishes a second retained message (D284). */
	readonly commandId?: "status" | "issue";
}

export interface MessageBusOptions<TTopic extends string = string> {
	readonly topics?: readonly TTopic[];
	readonly name?: string;
	readonly now?: () => number;
	readonly topicPolicy?: MessageBusTopicPolicy;
	readonly retention?: MessageBusRetentionPolicy;
	readonly dedupe?: MessageBusDedupePolicy;
}

export type MessageBusCommand<T = unknown> =
	| {
			readonly kind: "ensure-topic";
			readonly topic: string;
			readonly commandId?: string;
	  }
	| {
			readonly kind: "close-topic";
			readonly topic: string;
			readonly commandId?: string;
	  }
	| {
			readonly kind: "publish";
			readonly topic: string;
			readonly payload: T;
			readonly key?: string;
			readonly commandId?: string;
			readonly idempotencyKey?: string;
	  }
	| {
			readonly kind: "topic-policy";
			readonly topicPolicy: MessageBusTopicPolicy;
			readonly commandId?: string;
	  }
	| {
			readonly kind: "ack";
			readonly topic: string;
			readonly subscriptionId: string;
			readonly seq: number;
			readonly commandId?: string;
	  }
	| {
			readonly kind: "seek";
			readonly topic: string;
			readonly subscriptionId: string;
			readonly nextSeq: number;
			readonly commandId?: string;
	  }
	| {
			readonly kind: "close-subscription";
			readonly topic: string;
			readonly subscriptionId: string;
			readonly commandId?: string;
	  };

export type MessageBusMessage<T = unknown> = MessageEnvelope<T>;

export interface MessageBusStatus {
	readonly kind:
		| "topic-created"
		| "topic-closed"
		| "message-published"
		| "retention-trimmed"
		| "duplicate-command"
		| "subscription-acked"
		| "subscription-sought"
		| "subscription-closed"
		| "command-rejected"
		| "projection-ready"
		| "projection-partial";
	readonly topic?: string;
	readonly seq?: number;
	readonly headSeq?: number;
	readonly subscriptionId?: string;
	readonly nextSeq?: number;
	readonly commandId?: string;
	readonly issueCode?: string;
	readonly timestampMs: number;
	readonly details?: unknown;
}

export interface MessageBusCatalogEntry {
	readonly topic: string;
	readonly closed: boolean;
	readonly headSeq: number;
	readonly nextSeq: number;
	readonly messageCount: number;
}

export interface MessageBusCatalogPage {
	readonly topics: readonly MessageBusCatalogEntry[];
	readonly nextAfterTopic?: string;
	readonly hasMore: boolean;
}

export interface MessageBusDeadLetterEntry<T = unknown> {
	readonly entrySeq: number;
	readonly topic?: string;
	readonly command?: MessageBusCommand<T>;
	readonly message?: MessageBusMessage<T>;
	readonly issue: DataIssue;
	readonly timestampMs: number;
}

export interface MessageBusDeadLetterPage<T = unknown> {
	readonly entries: readonly MessageBusDeadLetterEntry<T>[];
	readonly nextAfterEntrySeq?: number;
	readonly hasMore: boolean;
}

export interface MessageBusTopicPage<T = unknown> {
	readonly topic: string;
	readonly messages: readonly MessageBusMessage<T>[];
	readonly fromSeq: number;
	readonly throughSeq?: number;
	readonly nextAfterSeq?: number;
	readonly hasMore: boolean;
}

export interface MessageBusCursor {
	readonly topic: string;
	readonly subscriptionId: string;
	readonly nextSeq: number;
	readonly closed: boolean;
	readonly retentionGap: boolean;
	readonly headSeq: number;
}

export interface MessageBusAvailablePage<T = unknown> {
	readonly topic: string;
	readonly subscriptionId: string;
	readonly cursor: MessageBusCursor;
	readonly messages: readonly MessageBusMessage<T>[];
	readonly fromSeq: number;
	readonly throughSeq?: number;
	readonly nextAfterSeq?: number;
	readonly hasMore: boolean;
}

export interface MessageBusPageParams {
	readonly limit?: number;
}

export interface MessageBusCatalogParams extends MessageBusPageParams {
	readonly afterTopic?: string;
	readonly includeClosed?: boolean;
}

export interface MessageBusDeadLetterParams extends MessageBusPageParams {
	readonly afterEntrySeq?: number;
	readonly topic?: string;
	readonly code?: string;
}

export interface MessageBusTopicParams extends MessageBusPageParams {
	readonly afterSeq?: number;
}

export interface MessageBusAvailableParams extends MessageBusPageParams {
	readonly afterSeq?: number;
}

export interface MessageBusPullProjection<TPage> {
	readonly snapshot: Node<TPage>;
	readonly snapshotPullId: LockId;
	readonly status: Node<MessageBusStatus>;
	readonly issues: Node<DataIssue>;
}

export interface MessageBusTopicProjection<T = unknown>
	extends MessageBusPullProjection<MessageBusTopicPage<T>> {}

export interface MessageBusSubscription<T = unknown> {
	readonly available: Node<MessageBusAvailablePage<T>>;
	readonly availablePullId: LockId;
	readonly cursor: Node<MessageBusCursor>;
	readonly status: Node<MessageBusStatus>;
	readonly issues: Node<DataIssue>;
	ack(seq: number, opts?: { commandId?: string }): MessageBusCommand;
	seek(nextSeq: number, opts?: { commandId?: string }): MessageBusCommand;
	close(opts?: { commandId?: string }): MessageBusCommand;
}

export interface MessageBus<TTopic extends string = string> {
	readonly commands: Node<MessageBusCommand>;
	readonly messages: Node<MessageBusMessage>;
	readonly status: Node<MessageBusStatus>;
	readonly issues: Node<DataIssue>;
	ensureTopic(topic: TTopic | string, opts?: { commandId?: string }): MessageBusCommand;
	closeTopic(topic: TTopic | string, opts?: { commandId?: string }): MessageBusCommand;
	publish<T = unknown>(
		topic: TTopic | string,
		payload: T,
		opts?: { key?: string; commandId?: string; idempotencyKey?: string },
	): MessageBusCommand<T>;
	topic<T = unknown>(
		topic: TTopic | string,
		opts?: { name?: string },
	): MessageBusTopicProjection<T>;
	catalog(opts?: { name?: string }): MessageBusPullProjection<MessageBusCatalogPage>;
	deadLetter<T = unknown>(opts?: {
		name?: string;
	}): MessageBusPullProjection<MessageBusDeadLetterPage<T>>;
	subscription<T = unknown>(opts: {
		topic: TTopic | string;
		subscriptionId: string;
		from?: "earliest" | "latest" | number;
		name?: string;
	}): MessageBusSubscription<T>;
}

export interface ToTopicOptions {
	readonly name?: string;
	readonly keyOf?: (value: unknown) => string | undefined;
	readonly commandIdOf?: (value: unknown) => string | undefined;
}

export interface ToTopicBundle<T> {
	readonly commands: Node<MessageBusCommand<T>>;
	release(): void;
}

interface TopicState {
	closed: boolean;
	headSeq: number;
	nextSeq: number;
	messages: MessageBusMessage[];
}

interface SubscriptionState {
	topic: string;
	subscriptionId: string;
	nextSeq: number;
	closed: boolean;
	retentionGap: boolean;
}

type RuntimeEvent<T = unknown> =
	| { readonly kind: "message"; readonly message: MessageBusMessage<T> }
	| { readonly kind: "status"; readonly status: MessageBusStatus }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "dead-letter"; readonly entry: MessageBusDeadLetterEntry<T> };

interface MessageBusState {
	readonly graph: Graph;
	readonly name: string;
	readonly now: () => number;
	topicPolicy: MessageBusTopicPolicy;
	readonly retention: MessageBusRetentionPolicy;
	readonly dedupe: MessageBusDedupePolicy;
	readonly topics: Map<string, TopicState>;
	readonly subscriptions: Map<string, SubscriptionState>;
	readonly seenCommandIds: Set<string>;
	readonly seenIdempotencyKeys: Set<string>;
	readonly deadLetters: MessageBusDeadLetterEntry[];
	deadLetterSeq: number;
	readonly commandSources: Node<MessageBusCommand>[];
	readonly commandBody: NodeFn;
}

export function messageBus<TTopic extends string>(
	graph: Graph,
	opts: MessageBusOptions<TTopic> = {},
): MessageBus<TTopic> {
	const name = opts.name ?? "messageBus";
	const initialTopics = uniqueTopics(opts.topics ?? []);
	const commandSources: Node<MessageBusCommand>[] = [];
	const commandBody: NodeFn = (ctx) => {
		for (let i = 0; i < commandSources.length; i++) {
			for (const command of depBatch(ctx, i) ?? []) ctx.down([["DATA", command]]);
		}
	};
	const commands = graph.node<MessageBusCommand>([], commandBody, {
		name: `${name}/commands`,
		factory: "messageBusCommands",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const state: MessageBusState = {
		graph,
		name,
		now: opts.now ?? Date.now,
		topicPolicy: opts.topicPolicy ?? "strict",
		retention: opts.retention ?? {},
		dedupe: opts.dedupe ?? { commandId: "status" },
		topics: new Map(initialTopics.map((topic) => [topic, makeTopicState()])),
		subscriptions: new Map(),
		seenCommandIds: new Set(),
		seenIdempotencyKeys: new Set(),
		deadLetters: [],
		deadLetterSeq: 0,
		commandSources,
		commandBody,
	};
	const runtime = graph.node<RuntimeEvent>(
		[commands],
		(ctx) => {
			for (const command of depBatch(ctx, 0) ?? []) {
				for (const event of reduceMessageBusCommand(state, command as MessageBusCommand)) {
					ctx.down([["DATA", event]]);
				}
			}
		},
		{
			name: `${name}/runtime`,
			factory: "messageBusRuntime",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	graph.retain(runtime, { reason: `${name}.messageBus.runtime` });
	const messages = graph.node<MessageBusMessage>(
		[runtime],
		(ctx) => {
			for (const event of depBatch(ctx, 0) ?? []) {
				const typed = event as RuntimeEvent;
				if (typed.kind === "message") ctx.down([["DATA", typed.message]]);
			}
		},
		{
			name: `${name}/messages`,
			factory: "messageBusMessages",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const status = graph.node<MessageBusStatus>(
		[runtime],
		(ctx) => {
			for (const event of depBatch(ctx, 0) ?? []) {
				const typed = event as RuntimeEvent;
				if (typed.kind === "status") ctx.down([["DATA", typed.status]]);
			}
		},
		{
			name: `${name}/status`,
			factory: "messageBusStatus",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const issues = graph.node<DataIssue>(
		[runtime],
		(ctx) => {
			for (const event of depBatch(ctx, 0) ?? []) {
				const typed = event as RuntimeEvent;
				if (typed.kind === "issue") ctx.down([["DATA", typed.issue]]);
			}
		},
		{
			name: `${name}/issues`,
			factory: "messageBusIssues",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);

	const bus: MessageBus<TTopic> = {
		commands,
		messages,
		status,
		issues,
		ensureTopic(topic, commandOpts = {}) {
			return publishCommand(commands, {
				kind: "ensure-topic",
				topic,
				...(commandOpts.commandId === undefined ? {} : { commandId: commandOpts.commandId }),
			});
		},
		closeTopic(topic, commandOpts = {}) {
			return publishCommand(commands, {
				kind: "close-topic",
				topic,
				...(commandOpts.commandId === undefined ? {} : { commandId: commandOpts.commandId }),
			});
		},
		publish<T = unknown>(
			topic: TTopic | string,
			payload: T,
			publishOpts: { key?: string; commandId?: string; idempotencyKey?: string } = {},
		) {
			return publishCommand(commands, {
				kind: "publish",
				topic,
				payload,
				...(publishOpts.key === undefined ? {} : { key: publishOpts.key }),
				...(publishOpts.commandId === undefined ? {} : { commandId: publishOpts.commandId }),
				...(publishOpts.idempotencyKey === undefined
					? {}
					: { idempotencyKey: publishOpts.idempotencyKey }),
			});
		},
		topic<T = unknown>(topic: TTopic | string, projectionOpts: { name?: string } = {}) {
			assertTopicKey(topic, "messageBus.topic");
			const snapshotPullId = Symbol(`${name}/${topic}/topicSnapshot`);
			const snapshot = graph.node<MessageBusTopicPage<T>>(
				[messages],
				(ctx) => {
					const params = pullParams<MessageBusTopicParams>(ctx.pull);
					ctx.down([["DATA", topicPage<T>(state, topic, params)]]);
				},
				{
					name: projectionOpts.name ?? `${name}/${topic}/topic`,
					factory: "messageBusTopicProjection",
					meta: { topic },
					pullId: snapshotPullId,
					partial: true,
					completeWhenDepsComplete: false,
					errorWhenDepsError: false,
				},
			);
			return { snapshot, snapshotPullId, status, issues };
		},
		catalog(projectionOpts: { name?: string } = {}) {
			const snapshotPullId = Symbol(`${name}/catalogSnapshot`);
			const snapshot = graph.node<MessageBusCatalogPage>(
				[runtime],
				(ctx) => {
					const params = pullParams<MessageBusCatalogParams>(ctx.pull);
					ctx.down([["DATA", catalogPage(state, params)]]);
				},
				{
					name: projectionOpts.name ?? `${name}/catalog`,
					factory: "messageBusCatalog",
					pullId: snapshotPullId,
					partial: true,
					completeWhenDepsComplete: false,
					errorWhenDepsError: false,
				},
			);
			return { snapshot, snapshotPullId, status, issues };
		},
		deadLetter<T = unknown>(projectionOpts: { name?: string } = {}) {
			const snapshotPullId = Symbol(`${name}/deadLetterSnapshot`);
			const snapshot = graph.node<MessageBusDeadLetterPage<T>>(
				[runtime],
				(ctx) => {
					const params = pullParams<MessageBusDeadLetterParams>(ctx.pull);
					ctx.down([["DATA", deadLetterPage<T>(state, params)]]);
				},
				{
					name: projectionOpts.name ?? `${name}/deadLetter`,
					factory: "messageBusDeadLetter",
					pullId: snapshotPullId,
					partial: true,
					completeWhenDepsComplete: false,
					errorWhenDepsError: false,
				},
			);
			return { snapshot, snapshotPullId, status, issues };
		},
		subscription<T = unknown>(subscriptionOpts: {
			topic: TTopic | string;
			subscriptionId: string;
			from?: "earliest" | "latest" | number;
			name?: string;
		}) {
			assertTopicKey(subscriptionOpts.topic, "messageBus.subscription");
			assertNonEmpty(subscriptionOpts.subscriptionId, "messageBus.subscriptionId");
			const sub = ensureSubscription(state, {
				topic: subscriptionOpts.topic,
				subscriptionId: subscriptionOpts.subscriptionId,
				from: subscriptionOpts.from ?? "earliest",
			});
			const availablePullId = Symbol(
				`${name}/${subscriptionOpts.topic}/${subscriptionOpts.subscriptionId}/available`,
			);
			const projectionName =
				subscriptionOpts.name ??
				`${name}/${subscriptionOpts.topic}/${subscriptionOpts.subscriptionId}`;
			const available = graph.node<MessageBusAvailablePage<T>>(
				[messages, status],
				(ctx) => {
					const params = pullParams<MessageBusAvailableParams>(ctx.pull);
					ctx.down([["DATA", availablePage<T>(state, sub, params)]]);
				},
				{
					name: `${projectionName}/available`,
					factory: "messageBusSubscriptionAvailable",
					meta: { topic: subscriptionOpts.topic, subscriptionId: subscriptionOpts.subscriptionId },
					pullId: availablePullId,
					partial: true,
					completeWhenDepsComplete: false,
					errorWhenDepsError: false,
				},
			);
			const cursor = graph.node<MessageBusCursor>(
				[status],
				(ctx) => {
					for (const fact of depBatch(ctx, 0) ?? []) {
						const typed = fact as MessageBusStatus;
						const subscriptionMoved =
							typed.topic === sub.topic &&
							typed.subscriptionId === sub.subscriptionId &&
							(typed.kind === "subscription-acked" ||
								typed.kind === "subscription-sought" ||
								typed.kind === "subscription-closed");
						const retentionMoved = typed.topic === sub.topic && typed.kind === "retention-trimmed";
						if (subscriptionMoved || retentionMoved) {
							ctx.down([["DATA", cursorSnapshot(state, sub)]]);
						}
					}
				},
				{
					name: `${projectionName}/cursor`,
					factory: "messageBusSubscriptionCursor",
					completeWhenDepsComplete: false,
					errorWhenDepsError: false,
				},
			);
			return {
				available,
				availablePullId,
				cursor,
				status,
				issues,
				ack(seq, commandOpts = {}) {
					return publishCommand(commands, {
						kind: "ack",
						topic: sub.topic,
						subscriptionId: sub.subscriptionId,
						seq,
						...(commandOpts.commandId === undefined ? {} : { commandId: commandOpts.commandId }),
					});
				},
				seek(nextSeq, commandOpts = {}) {
					return publishCommand(commands, {
						kind: "seek",
						topic: sub.topic,
						subscriptionId: sub.subscriptionId,
						nextSeq,
						...(commandOpts.commandId === undefined ? {} : { commandId: commandOpts.commandId }),
					});
				},
				close(commandOpts = {}) {
					return publishCommand(commands, {
						kind: "close-subscription",
						topic: sub.topic,
						subscriptionId: sub.subscriptionId,
						...(commandOpts.commandId === undefined ? {} : { commandId: commandOpts.commandId }),
					});
				},
			};
		},
	};
	registerMessageBusState(bus, state);
	return bus;
}

export function fromTopic<T = unknown, TTopic extends string = string>(
	bus: MessageBus<TTopic>,
	topic: TTopic | string,
): Node<MessageBusTopicPage<T>> {
	return bus.topic<T>(topic).snapshot;
}

export function toTopic<T, TTopic extends string>(
	graph: Graph,
	source: Node<T>,
	bus: MessageBus<TTopic>,
	topic: TTopic | string,
	opts: ToTopicOptions = {},
): ToTopicBundle<T> {
	const state = getMessageBusState(bus);
	if (state === undefined) throw new Error("toTopic: unknown message bus implementation");
	if (state.graph !== graph) throw new Error("toTopic: bus and source graph must match");
	assertTopicKey(topic, "toTopic");
	const commands = graph.node<MessageBusCommand<T>>(
		[source],
		(ctx) => {
			for (const value of depBatch(ctx, 0) ?? []) {
				const key = opts.keyOf?.(value);
				const commandId = opts.commandIdOf?.(value);
				ctx.down([
					[
						"DATA",
						{
							kind: "publish",
							topic,
							payload: value as T,
							...(key === undefined ? {} : { key }),
							...(commandId === undefined ? {} : { commandId }),
						} satisfies MessageBusCommand<T>,
					],
				]);
			}
		},
		{
			name: opts.name ?? `${state.name}/${topic}/toTopic`,
			factory: "toTopic",
			meta: { topic },
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const releaseSource = attachMessageBusCommandSource(
		graph,
		bus,
		commands as Node<MessageBusCommand>,
	);
	let released = false;
	return {
		commands,
		release() {
			if (released) return;
			released = true;
			releaseSource();
		},
	};
}

function reduceMessageBusCommand(
	state: MessageBusState,
	command: MessageBusCommand,
): RuntimeEvent[] {
	const malformed = validateCommand(command);
	if (malformed !== undefined) return rejectCommand(state, command, malformed);
	if (command.commandId !== undefined) {
		if (state.seenCommandIds.has(command.commandId)) {
			return duplicateCommandEvents(state, command, "duplicate commandId");
		}
		state.seenCommandIds.add(command.commandId);
	}
	if (
		command.kind === "publish" &&
		command.idempotencyKey !== undefined &&
		state.seenIdempotencyKeys.has(idempotencyKey(command.topic, command.idempotencyKey))
	) {
		return duplicateCommandEvents(state, command, "duplicate idempotencyKey");
	}
	switch (command.kind) {
		case "ensure-topic":
			return ensureTopic(state, command.topic, command.commandId);
		case "close-topic": {
			const topic = state.topics.get(command.topic);
			if (topic === undefined) {
				return issueEvents(state, command, "unknown-topic", `unknown topic '${command.topic}'`);
			}
			topic.closed = true;
			return [
				{
					kind: "status",
					status: statusFact(state, "topic-closed", {
						topic: command.topic,
						commandId: command.commandId,
					}),
				},
			];
		}
		case "topic-policy":
			state.topicPolicy = command.topicPolicy;
			return [
				{
					kind: "status",
					status: statusFact(state, "projection-ready", {
						commandId: command.commandId,
						details: { topicPolicy: command.topicPolicy },
					}),
				},
			];
		case "publish":
			return publishMessage(state, command);
		case "ack":
			return ackSubscription(state, command);
		case "seek":
			return seekSubscription(state, command);
		case "close-subscription":
			return closeSubscription(state, command);
	}
}

function publishMessage(
	state: MessageBusState,
	command: Extract<MessageBusCommand, { kind: "publish" }>,
): RuntimeEvent[] {
	let topic = state.topics.get(command.topic);
	const events: RuntimeEvent[] = [];
	if (topic === undefined) {
		if (state.topicPolicy !== "create-as-fact") {
			return issueEvents(state, command, "unknown-topic", `unknown topic '${command.topic}'`);
		}
		events.push(...ensureTopic(state, command.topic, command.commandId));
		topic = state.topics.get(command.topic);
	}
	if (topic === undefined)
		return issueEvents(state, command, "unknown-topic", `unknown topic '${command.topic}'`);
	if (topic.closed)
		return issueEvents(state, command, "closed-topic", `closed topic '${command.topic}'`);
	const message: MessageBusMessage = {
		topic: command.topic,
		seq: topic.nextSeq++,
		payload: command.payload,
		timestampMs: state.now(),
		...(command.key === undefined ? {} : { key: command.key }),
		...(command.idempotencyKey === undefined ? {} : { idempotencyKey: command.idempotencyKey }),
		...(command.commandId === undefined ? {} : { commandId: command.commandId }),
	};
	if (command.idempotencyKey !== undefined) {
		state.seenIdempotencyKeys.add(idempotencyKey(command.topic, command.idempotencyKey));
	}
	topic.messages.push(message);
	events.push({ kind: "message", message });
	events.push({
		kind: "status",
		status: statusFact(state, "message-published", {
			topic: command.topic,
			seq: message.seq,
			commandId: command.commandId,
		}),
	});
	events.push(...trimRetention(state, command.topic, topic));
	return events;
}

function ensureTopic(state: MessageBusState, topic: string, commandId?: string): RuntimeEvent[] {
	assertTopicKey(topic, "messageBus");
	if (!state.topics.has(topic)) state.topics.set(topic, makeTopicState());
	return [
		{
			kind: "status",
			status: statusFact(state, "topic-created", { topic, commandId }),
		},
	];
}

function trimRetention(
	state: MessageBusState,
	topicName: string,
	topic: TopicState,
): RuntimeEvent[] {
	const max = state.retention.maxMessages;
	if (max === undefined || topic.messages.length <= max) return [];
	if (!Number.isInteger(max) || max < 1) {
		return issueEvents(
			state,
			{ kind: "publish", topic: topicName, payload: undefined },
			"policy-rejected",
			"retention.maxMessages must be a positive integer",
		);
	}
	const trimCount = topic.messages.length - max;
	topic.messages.splice(0, trimCount);
	topic.headSeq = topic.messages[0]?.seq ?? topic.nextSeq;
	const events: RuntimeEvent[] = [
		{
			kind: "status",
			status: statusFact(state, "retention-trimmed", {
				topic: topicName,
				headSeq: topic.headSeq,
				details: { trimCount },
			}),
		},
	];
	for (const sub of state.subscriptions.values()) {
		if (sub.closed || sub.topic !== topicName || sub.nextSeq >= topic.headSeq) continue;
		sub.retentionGap = true;
		events.push(
			...issueEvents(
				state,
				{
					kind: "seek",
					topic: topicName,
					subscriptionId: sub.subscriptionId,
					nextSeq: sub.nextSeq,
				},
				"retention-gap",
				`subscription '${sub.subscriptionId}' is before retained headSeq`,
			),
		);
	}
	return events;
}

function ackSubscription(
	state: MessageBusState,
	command: Extract<MessageBusCommand, { kind: "ack" }>,
): RuntimeEvent[] {
	const topic = state.topics.get(command.topic);
	if (topic === undefined)
		return issueEvents(state, command, "unknown-topic", `unknown topic '${command.topic}'`);
	const sub = getSubscription(state, command.topic, command.subscriptionId);
	if (sub === undefined)
		return issueEvents(
			state,
			command,
			"unknown-subscription",
			`unknown subscription '${command.subscriptionId}'`,
		);
	if (sub.closed)
		return issueEvents(state, command, "subscription-closed", "subscription is closed");
	if (sub.retentionGap)
		return issueEvents(state, command, "retention-gap", "subscription must seek before ack");
	if (command.seq < sub.nextSeq)
		return issueEvents(state, command, "source-cursor-stale", "ack is behind subscription cursor");
	if (command.seq >= topic.nextSeq)
		return issueEvents(state, command, "cursor-out-of-range", "ack is beyond topic tail");
	sub.nextSeq = Math.max(sub.nextSeq, command.seq + 1);
	return [
		{
			kind: "status",
			status: statusFact(state, "subscription-acked", {
				topic: command.topic,
				subscriptionId: command.subscriptionId,
				nextSeq: sub.nextSeq,
				commandId: command.commandId,
			}),
		},
	];
}

function seekSubscription(
	state: MessageBusState,
	command: Extract<MessageBusCommand, { kind: "seek" }>,
): RuntimeEvent[] {
	const topic = state.topics.get(command.topic);
	if (topic === undefined)
		return issueEvents(state, command, "unknown-topic", `unknown topic '${command.topic}'`);
	const sub = getSubscription(state, command.topic, command.subscriptionId);
	if (sub === undefined)
		return issueEvents(
			state,
			command,
			"unknown-subscription",
			`unknown subscription '${command.subscriptionId}'`,
		);
	if (sub.closed)
		return issueEvents(state, command, "subscription-closed", "subscription is closed");
	if (command.nextSeq < topic.headSeq)
		return issueEvents(state, command, "retention-gap", "seek is before retained headSeq");
	if (command.nextSeq > topic.nextSeq)
		return issueEvents(state, command, "cursor-out-of-range", "seek is beyond topic tail");
	sub.nextSeq = command.nextSeq;
	sub.retentionGap = false;
	return [
		{
			kind: "status",
			status: statusFact(state, "subscription-sought", {
				topic: command.topic,
				subscriptionId: command.subscriptionId,
				nextSeq: sub.nextSeq,
				commandId: command.commandId,
			}),
		},
	];
}

function closeSubscription(
	state: MessageBusState,
	command: Extract<MessageBusCommand, { kind: "close-subscription" }>,
): RuntimeEvent[] {
	if (!state.topics.has(command.topic))
		return issueEvents(state, command, "unknown-topic", `unknown topic '${command.topic}'`);
	const sub = getSubscription(state, command.topic, command.subscriptionId);
	if (sub === undefined)
		return issueEvents(
			state,
			command,
			"unknown-subscription",
			`unknown subscription '${command.subscriptionId}'`,
		);
	sub.closed = true;
	return [
		{
			kind: "status",
			status: statusFact(state, "subscription-closed", {
				topic: command.topic,
				subscriptionId: command.subscriptionId,
				nextSeq: sub.nextSeq,
				commandId: command.commandId,
			}),
		},
	];
}

function issueEvents(
	state: MessageBusState,
	command: unknown,
	code: string,
	message: string,
): RuntimeEvent[] {
	const topic = commandTopic(command);
	const commandId = commandIdOf(command);
	const issue: DataIssue = {
		kind: "issue",
		code,
		message,
		severity: "error",
		source: "messageBus",
		details: command,
		metadata: topic === undefined ? undefined : { topic },
	};
	const entry: MessageBusDeadLetterEntry = {
		entrySeq: ++state.deadLetterSeq,
		...(topic === undefined ? {} : { topic }),
		...(isObjectRecord(command) ? { command: command as MessageBusCommand } : {}),
		issue,
		timestampMs: state.now(),
	};
	state.deadLetters.push(entry);
	return [
		{ kind: "issue", issue },
		{ kind: "dead-letter", entry },
		{
			kind: "status",
			status: statusFact(state, "command-rejected", {
				topic,
				commandId,
				issueCode: code,
			}),
		},
	];
}

function rejectCommand(state: MessageBusState, command: unknown, reason: string): RuntimeEvent[] {
	return issueEvents(state, command, "malformed-command", reason);
}

function duplicateCommandEvents(
	state: MessageBusState,
	command: MessageBusCommand,
	message: string,
): RuntimeEvent[] {
	const status = statusFact(state, "duplicate-command", {
		topic: "topic" in command ? command.topic : undefined,
		commandId: command.commandId,
	});
	if (state.dedupe.commandId === "issue") {
		return [
			{ kind: "status", status },
			...issueEvents(state, command, "duplicate-command", message),
		];
	}
	return [{ kind: "status", status }];
}

function statusFact(
	state: MessageBusState,
	kind: MessageBusStatus["kind"],
	fields: Partial<MessageBusStatus>,
): MessageBusStatus {
	return {
		kind,
		timestampMs: state.now(),
		...(fields.topic === undefined ? {} : { topic: fields.topic }),
		...(fields.seq === undefined ? {} : { seq: fields.seq }),
		...(fields.headSeq === undefined ? {} : { headSeq: fields.headSeq }),
		...(fields.subscriptionId === undefined ? {} : { subscriptionId: fields.subscriptionId }),
		...(fields.nextSeq === undefined ? {} : { nextSeq: fields.nextSeq }),
		...(fields.commandId === undefined ? {} : { commandId: fields.commandId }),
		...(fields.issueCode === undefined ? {} : { issueCode: fields.issueCode }),
		...(fields.details === undefined ? {} : { details: fields.details }),
	};
}

function validateCommand(command: unknown): string | undefined {
	if (!isObjectRecord(command)) return "command must be an object";
	if (typeof command.kind !== "string") return "command kind is required";
	if (!isMessageBusCommandKind(command.kind)) return `unknown command kind '${command.kind}'`;
	if ("topic" in command) {
		if (typeof command.topic !== "string") return "messageBus: topic must be a non-empty string";
		const topicError = validateTopicKey(command.topic, "messageBus");
		if (topicError !== undefined) return topicError;
	}
	if ("subscriptionId" in command && typeof command.subscriptionId !== "string") {
		return "subscriptionId must be a string";
	}
	if (command.kind === "publish" && command.payload === undefined)
		return "publish payload is required";
	if (command.kind === "ack" && !isPositiveSeq(command.seq))
		return "ack seq must be a positive integer";
	if (command.kind === "seek" && !isPositiveSeq(command.nextSeq)) {
		return "seek nextSeq must be a positive integer";
	}
	if (
		command.kind === "topic-policy" &&
		command.topicPolicy !== "strict" &&
		command.topicPolicy !== "create-as-fact"
	) {
		return "topicPolicy is not recognized";
	}
	return undefined;
}

function isMessageBusCommandKind(kind: string): kind is MessageBusCommand["kind"] {
	return (
		kind === "ensure-topic" ||
		kind === "close-topic" ||
		kind === "publish" ||
		kind === "topic-policy" ||
		kind === "ack" ||
		kind === "seek" ||
		kind === "close-subscription"
	);
}

function catalogPage(
	state: MessageBusState,
	params: MessageBusCatalogParams,
): MessageBusCatalogPage {
	const limit = positiveLimit(params.limit);
	const topics = [...state.topics.entries()]
		.filter(
			([topic, value]) =>
				(params.includeClosed ? true : !value.closed) &&
				(params.afterTopic === undefined || topic > params.afterTopic),
		)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	const page = topics.slice(0, limit);
	const hasMore = topics.length > limit;
	return {
		topics: page.map(([topic, value]) => ({
			topic,
			closed: value.closed,
			headSeq: value.headSeq,
			nextSeq: value.nextSeq,
			messageCount: value.messages.length,
		})),
		...(hasMore && page.length > 0 ? { nextAfterTopic: page[page.length - 1]?.[0] } : {}),
		hasMore,
	};
}

function topicPage<T>(
	state: MessageBusState,
	topicName: string,
	params: MessageBusTopicParams,
): MessageBusTopicPage<T> {
	const topic = state.topics.get(topicName);
	const start = params.afterSeq === undefined ? (topic?.headSeq ?? 1) : params.afterSeq + 1;
	const all = (topic?.messages ?? []).filter((message) => message.seq >= start);
	const limit = positiveLimit(params.limit);
	const messages = all.slice(0, limit) as MessageBusMessage<T>[];
	const hasMore = all.length > limit;
	return {
		topic: topicName,
		messages,
		fromSeq: start,
		...(messages.length > 0 ? { throughSeq: messages[messages.length - 1]?.seq } : {}),
		...(hasMore && messages.length > 0 ? { nextAfterSeq: messages[messages.length - 1]?.seq } : {}),
		hasMore,
	};
}

function availablePage<T>(
	state: MessageBusState,
	sub: SubscriptionState,
	params: MessageBusAvailableParams,
): MessageBusAvailablePage<T> {
	const cursor = cursorSnapshot(state, sub);
	const start = params.afterSeq === undefined ? sub.nextSeq : params.afterSeq + 1;
	const topic = state.topics.get(sub.topic);
	const all = sub.retentionGap
		? []
		: (topic?.messages ?? []).filter((message) => message.seq >= start);
	const limit = positiveLimit(params.limit);
	const messages = all.slice(0, limit) as MessageBusMessage<T>[];
	const hasMore = all.length > limit;
	return {
		topic: sub.topic,
		subscriptionId: sub.subscriptionId,
		cursor,
		messages,
		fromSeq: start,
		...(messages.length > 0 ? { throughSeq: messages[messages.length - 1]?.seq } : {}),
		...(hasMore && messages.length > 0 ? { nextAfterSeq: messages[messages.length - 1]?.seq } : {}),
		hasMore,
	};
}

function deadLetterPage<T>(
	state: MessageBusState,
	params: MessageBusDeadLetterParams,
): MessageBusDeadLetterPage<T> {
	const limit = positiveLimit(params.limit);
	const entries = state.deadLetters.filter((entry) => {
		if (params.afterEntrySeq !== undefined && entry.entrySeq <= params.afterEntrySeq) return false;
		if (params.topic !== undefined && entry.topic !== params.topic) return false;
		if (params.code !== undefined && entry.issue.code !== params.code) return false;
		return true;
	});
	const page = entries.slice(0, limit) as MessageBusDeadLetterEntry<T>[];
	const hasMore = entries.length > limit;
	return {
		entries: page,
		...(hasMore && page.length > 0 ? { nextAfterEntrySeq: page[page.length - 1]?.entrySeq } : {}),
		hasMore,
	};
}

function cursorSnapshot(state: MessageBusState, sub: SubscriptionState): MessageBusCursor {
	const topic = state.topics.get(sub.topic);
	return {
		topic: sub.topic,
		subscriptionId: sub.subscriptionId,
		nextSeq: sub.nextSeq,
		closed: sub.closed,
		retentionGap: sub.retentionGap,
		headSeq: topic?.headSeq ?? 1,
	};
}

function ensureSubscription(
	state: MessageBusState,
	opts: { topic: string; subscriptionId: string; from: "earliest" | "latest" | number },
): SubscriptionState {
	const key = `${opts.topic}\u0000${opts.subscriptionId}`;
	const existing = state.subscriptions.get(key);
	if (existing !== undefined) return existing;
	const topic = state.topics.get(opts.topic);
	const nextSeq =
		opts.from === "earliest"
			? (topic?.headSeq ?? 1)
			: opts.from === "latest"
				? (topic?.nextSeq ?? 1)
				: opts.from;
	const sub: SubscriptionState = {
		topic: opts.topic,
		subscriptionId: opts.subscriptionId,
		nextSeq,
		closed: false,
		retentionGap: topic !== undefined && nextSeq < topic.headSeq,
	};
	state.subscriptions.set(key, sub);
	return sub;
}

function getSubscription(
	state: MessageBusState,
	topic: string,
	subscriptionId: string,
): SubscriptionState | undefined {
	return state.subscriptions.get(`${topic}\u0000${subscriptionId}`);
}

function pullParams<T>(pull: PullDemand | undefined): T {
	return (isObjectRecord(pull?.params) ? pull.params : {}) as T;
}

function publishCommand<T extends MessageBusCommand>(
	commandNode: Node<MessageBusCommand>,
	command: T,
): T {
	commandNode.down([["DATA", command]]);
	return command;
}

function makeTopicState(): TopicState {
	return { closed: false, headSeq: 1, nextSeq: 1, messages: [] };
}

function uniqueTopics(topics: readonly string[]): readonly string[] {
	const unique = [...new Set(topics)];
	if (unique.length !== topics.length) throw new Error("messageBus: duplicate topic");
	for (const topic of unique) assertTopicKey(topic, "messageBus");
	return Object.freeze(unique.sort());
}

function assertTopicKey(topic: string, owner: string): void {
	const error = validateTopicKey(topic, owner);
	if (error !== undefined) throw new Error(error);
}

function validateTopicKey(topic: string, owner: string): string | undefined {
	if (typeof topic !== "string" || topic.length === 0)
		return `${owner}: topic must be a non-empty string`;
	return undefined;
}

function assertNonEmpty(value: string, owner: string): void {
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`${owner}: must be a non-empty string`);
}

function positiveLimit(limit: number | undefined): number {
	if (limit === undefined) return 100;
	if (!Number.isInteger(limit) || limit < 1)
		throw new Error("messageBus: limit must be a positive integer");
	return limit;
}

function isPositiveSeq(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 1;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function commandTopic(command: unknown): string | undefined {
	return isObjectRecord(command) && typeof command.topic === "string" ? command.topic : undefined;
}

function commandIdOf(command: unknown): string | undefined {
	return isObjectRecord(command) && typeof command.commandId === "string"
		? command.commandId
		: undefined;
}

function idempotencyKey(topic: string, key: string): string {
	return `${topic}\u0000${key}`;
}
