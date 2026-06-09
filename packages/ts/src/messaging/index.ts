/**
 * Reusable application-infrastructure messaging namespace.
 *
 * Retained root messaging utilities land here only after B63 re-derives them
 * onto the D125 package DAG.
 */

import { depBatch, type NodeFn } from "../ctx/types.js";
import { type Graph, releaseGraphNodes } from "../graph/graph.js";
import type { Node } from "../node/node.js";

export interface MessageEnvelope<T = unknown> {
	readonly topic: string;
	readonly seq: number;
	readonly payload: T;
	readonly key?: string;
	readonly timestampMs: number;
}

/**
 * Minimal JSON Schema vocabulary for cross-graph/topic payload descriptions.
 *
 * D125/D132 keep this as passive messaging vocabulary: GraphReFly does not ship
 * a validator here and does not make schemas protocol messages.
 */
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

/**
 * Recommended passive envelope for payloads that cross topic, agent, or graph
 * boundaries. It is an application fact shape, not a required protocol type.
 */
export interface TopicMessage<T = unknown> {
	readonly id: string;
	readonly schema?: JsonSchema;
	readonly expiresAt?: string;
	readonly correlationId?: string;
	readonly payload: T;
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

export interface MessageBusEvent<T = unknown> {
	readonly kind: "publish" | "complete" | "error";
	readonly topic: string;
	readonly seq?: number;
	readonly payload?: T;
	readonly error?: unknown;
}

export interface MessageBusOptions<TTopic extends string = string> {
	readonly topics: readonly TTopic[];
	readonly name?: string;
	readonly now?: () => number;
}

export interface MessageBus<TTopic extends string = string> {
	readonly topics: readonly TTopic[];
	topic<T = unknown>(name: TTopic): Node<MessageEnvelope<T>>;
	publish<T = unknown>(name: TTopic, payload: T, opts?: { key?: string }): MessageEnvelope<T>;
	has(name: string): name is TTopic;
}

interface MessageBusState<TTopic extends string> {
	readonly graph: Graph;
	readonly name: string;
	readonly now: () => number;
	readonly topics: readonly TTopic[];
	readonly records: Map<TTopic, TopicRecord>;
	seq: number;
}

type ProducedTopicMessage<T = unknown> =
	| { readonly kind: "publish"; readonly envelope: MessageEnvelope<T> }
	| { readonly kind: "error"; readonly topic: string; readonly error: unknown };

interface TopicRecord {
	readonly node: Node<MessageEnvelope<unknown>>;
	readonly producers: Node<ProducedTopicMessage<unknown>>[];
	readonly body: NodeFn;
}

const busStates = new WeakMap<MessageBus<string>, MessageBusState<string>>();

export interface ToTopicOptions {
	readonly name?: string;
	readonly keyOf?: (value: unknown) => string | undefined;
}

export interface ToTopicBundle<T> {
	readonly events: Node<MessageBusEvent<T>>;
}

export type DynamicHubUnknownTopicPolicy = "drop" | "error" | "dead-letter" | "create-as-fact";

export interface DynamicHubOptions {
	readonly name?: string;
	readonly topics?: readonly string[];
	readonly unknownTopic?: DynamicHubUnknownTopicPolicy;
	readonly deadLetter?: boolean;
	readonly maxTopics?: number;
	readonly maxTopicLength?: number;
	readonly now?: () => number;
}

export interface DynamicHubMetadata {
	readonly seq: number;
	readonly cursor: number;
	readonly timestampMs: number;
}

export type DynamicHubEventKind =
	| "create"
	| "delete"
	| "message"
	| "subscribe"
	| "close"
	| "error"
	| "dead-letter";

export type DynamicHubCommand<T = unknown> =
	| {
			readonly kind: "create";
			readonly topic: string;
			readonly key?: string;
			readonly payload?: T;
	  }
	| {
			readonly kind: "delete";
			readonly topic: string;
			readonly key?: string;
			readonly payload?: T;
	  }
	| {
			readonly kind: "publish";
			readonly topic: string;
			readonly payload: T;
			readonly key?: string;
	  }
	| {
			readonly kind: "subscribe";
			readonly topic: string;
			readonly key?: string;
			readonly payload?: T;
	  }
	| {
			readonly kind: "close";
			readonly key?: string;
			readonly payload?: T;
	  };

export interface DynamicHubStatus {
	readonly open: boolean;
	readonly topics: readonly string[];
	readonly seq: number;
	readonly cursor: number;
	readonly lastEventKind?: DynamicHubEventKind;
}

interface DynamicHubEventFrame {
	readonly meta: DynamicHubMetadata;
	readonly status: DynamicHubStatus;
}

export type DynamicHubEvent<T = unknown> = DynamicHubEventFrame &
	(
		| {
				readonly kind: "create";
				readonly topic: string;
				readonly key?: string;
				readonly payload?: T;
		  }
		| {
				readonly kind: "delete";
				readonly topic: string;
				readonly key?: string;
				readonly payload?: T;
		  }
		| {
				readonly kind: "message";
				readonly topic: string;
				readonly payload: T;
				readonly key?: string;
		  }
		| {
				readonly kind: "subscribe";
				readonly topic: string;
				readonly key?: string;
				readonly payload?: T;
		  }
		| {
				readonly kind: "close";
				readonly key?: string;
				readonly payload?: T;
		  }
		| {
				readonly kind: "error";
				readonly topic?: string;
				readonly error: string;
				readonly command: unknown;
		  }
		| {
				readonly kind: "dead-letter";
				readonly topic?: string;
				readonly reason: string;
				readonly command: unknown;
		  }
	);

export interface DynamicHubError {
	readonly topic?: string;
	readonly error: string;
	readonly command: unknown;
	readonly meta: DynamicHubMetadata;
}

export interface DynamicHubDeadLetter {
	readonly topic?: string;
	readonly reason: string;
	readonly command: unknown;
	readonly meta: DynamicHubMetadata;
}

export interface DynamicHub<T = unknown> {
	readonly command: Node<DynamicHubCommand<T>>;
	readonly events: Node<DynamicHubEvent<T>>;
	readonly status: Node<DynamicHubStatus>;
	readonly errors: Node<DynamicHubError>;
	readonly deadLetter?: Node<DynamicHubDeadLetter>;
	create(topic: string, opts?: { key?: string; payload?: T }): DynamicHubCommand<T>;
	delete(topic: string, opts?: { key?: string; payload?: T }): DynamicHubCommand<T>;
	publish(topic: string, payload: T, opts?: { key?: string }): DynamicHubCommand<T>;
	subscribeTopic(topic: string, opts?: { key?: string; payload?: T }): DynamicHubCommand<T>;
	close(opts?: { key?: string; payload?: T }): DynamicHubCommand<T>;
}

export interface ToHubTopicOptions<T> {
	readonly name?: string;
	readonly keyOf?: (value: T) => string | undefined;
}

export interface ToHubTopicBundle<T> {
	readonly commands: Node<DynamicHubCommand<T>>;
}

interface DynamicHubState<T> {
	readonly graph: Graph;
	readonly name: string;
	readonly maxTopicLength: number;
	readonly commandSources: Node<DynamicHubCommand<T>>[];
	readonly commandBody: NodeFn;
	readonly releaseEventsRetain: () => void;
}

interface DynamicHubRuntime {
	topics: string[];
	open: boolean;
	seq: number;
	cursor: number;
}

const dynamicHubStates = new WeakMap<DynamicHub<unknown>, DynamicHubState<unknown>>();
const DEFAULT_DYNAMIC_HUB_MAX_TOPICS = 1024;
const DEFAULT_DYNAMIC_HUB_MAX_TOPIC_LENGTH = 256;

export function messageBus<TTopic extends string>(
	graph: Graph,
	opts: MessageBusOptions<TTopic>,
): MessageBus<TTopic> {
	const unique = [...new Set(opts.topics)];
	if (unique.length !== opts.topics.length) throw new Error("messageBus: duplicate topic");
	if (unique.length === 0) throw new Error("messageBus: at least one topic is required");
	const name = opts.name ?? "messageBus";
	const state: MessageBusState<TTopic> = {
		graph,
		name,
		now: opts.now ?? Date.now,
		topics: Object.freeze([...unique]),
		records: new Map(),
		seq: 0,
	};
	for (const topic of unique) {
		const producers: Node<ProducedTopicMessage<unknown>>[] = [];
		const body: NodeFn = (ctx) => {
			for (let i = 0; i < producers.length; i++) {
				for (const produced of depBatch(ctx, i) ?? []) {
					if ((produced as ProducedTopicMessage).kind === "publish") {
						ctx.down([
							[
								"DATA",
								(
									produced as ProducedTopicMessage<unknown> & {
										kind: "publish";
									}
								).envelope,
							],
						]);
					}
				}
			}
		};
		const node = graph.node<MessageEnvelope<unknown>>([], body, {
			name: `${name}/${topic}`,
			factory: "messageTopic",
			meta: { topic },
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		});
		state.records.set(topic, { node, producers, body });
	}
	const bus: MessageBus<TTopic> = {
		topics: state.topics,
		topic<T = unknown>(topic: TTopic): Node<MessageEnvelope<T>> {
			return requireTopic(state, topic) as Node<MessageEnvelope<T>>;
		},
		publish<T = unknown>(
			topic: TTopic,
			payload: T,
			publishOpts: { key?: string } = {},
		): MessageEnvelope<T> {
			const node = requireTopic(state, topic);
			const envelope: MessageEnvelope<T> = {
				topic,
				seq: ++state.seq,
				payload,
				timestampMs: state.now(),
				...(publishOpts.key === undefined ? {} : { key: publishOpts.key }),
			};
			node.down([["DATA", envelope as MessageEnvelope<unknown>]]);
			return envelope;
		},
		has(topic: string): topic is TTopic {
			return state.records.has(topic as TTopic);
		},
	};
	busStates.set(bus as MessageBus<string>, state as unknown as MessageBusState<string>);
	return bus;
}

/**
 * D135 dynamic messaging hub: topic lifecycle is DATA facts over fixed graph-visible
 * command/event/status/error nodes. Topic keys never create or delete graph nodes.
 */
export function dynamicHub<T = unknown>(graph: Graph, opts: DynamicHubOptions = {}): DynamicHub<T> {
	const name = opts.name ?? "dynamicHub";
	const unknownTopic = normalizeUnknownTopicPolicy(opts.unknownTopic);
	const maxTopics = normalizeHubLimit(
		opts.maxTopics,
		DEFAULT_DYNAMIC_HUB_MAX_TOPICS,
		"dynamicHub: maxTopics",
	);
	const maxTopicLength = normalizeHubLimit(
		opts.maxTopicLength,
		DEFAULT_DYNAMIC_HUB_MAX_TOPIC_LENGTH,
		"dynamicHub: maxTopicLength",
	);
	const now = opts.now ?? Date.now;
	const initialTopics = uniqueTopics(opts.topics ?? [], maxTopicLength);
	if (initialTopics.length > maxTopics) {
		throw new Error("dynamicHub: topics exceed maxTopics");
	}
	const commandSources: Node<DynamicHubCommand<T>>[] = [];
	const commandBody: NodeFn = (ctx) => {
		for (let i = 0; i < commandSources.length; i++) {
			for (const command of depBatch(ctx, i) ?? []) ctx.down([["DATA", command]]);
		}
	};
	const command = graph.node<DynamicHubCommand<T>>([], commandBody, {
		name: `${name}/command`,
		factory: "dynamicHubCommand",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const events = graph.node<DynamicHubEvent<T>>(
		[command],
		(ctx) => {
			const runtime =
				ctx.state.get<DynamicHubRuntime>() ??
				({
					topics: [...initialTopics],
					open: true,
					seq: 0,
					cursor: 0,
				} satisfies DynamicHubRuntime);
			ctx.state.persist(true);
			for (const commandFact of depBatch(ctx, 0) ?? []) {
				const parsed = parseDynamicHubCommand(commandFact);
				if (typeof parsed === "string") {
					ctx.down([["DATA", hubError(runtime, commandFact, parsed, timestampOrFallback(now))]]);
					continue;
				}
				const reduced = reduceDynamicHubCommand(
					runtime,
					parsed as DynamicHubCommand<T>,
					unknownTopic,
					maxTopics,
					maxTopicLength,
					now,
				);
				for (const event of reduced) ctx.down([["DATA", event]]);
			}
			ctx.state.set(runtime);
		},
		{
			name: `${name}/events`,
			factory: "dynamicHubEvents",
			meta: { unknownTopic },
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const status = graph.node<DynamicHubStatus>(
		[events],
		(ctx) => {
			for (const event of depBatch(ctx, 0) ?? []) {
				const typed = event as DynamicHubEvent<T>;
				ctx.down([["DATA", typed.status]]);
			}
		},
		{
			name: `${name}/status`,
			factory: "dynamicHubStatus",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const errors = graph.node<DynamicHubError>(
		[events],
		(ctx) => {
			for (const event of depBatch(ctx, 0) ?? []) {
				const typed = event as DynamicHubEvent<T>;
				if (typed.kind !== "error") continue;
				ctx.down([
					[
						"DATA",
						{
							...(typed.topic === undefined ? {} : { topic: typed.topic }),
							error: typed.error,
							command: typed.command,
							meta: typed.meta,
						} satisfies DynamicHubError,
					],
				]);
			}
		},
		{
			name: `${name}/errors`,
			factory: "dynamicHubErrors",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const deadLetter =
		opts.deadLetter === true || unknownTopic === "dead-letter"
			? graph.node<DynamicHubDeadLetter>(
					[events],
					(ctx) => {
						for (const event of depBatch(ctx, 0) ?? []) {
							const typed = event as DynamicHubEvent<T>;
							if (typed.kind !== "dead-letter") continue;
							ctx.down([
								[
									"DATA",
									{
										...(typed.topic === undefined ? {} : { topic: typed.topic }),
										reason: typed.reason,
										command: typed.command,
										meta: typed.meta,
									} satisfies DynamicHubDeadLetter,
								],
							]);
						}
					},
					{
						name: `${name}/deadLetter`,
						factory: "dynamicHubDeadLetter",
						completeWhenDepsComplete: false,
						errorWhenDepsError: false,
					},
				)
			: undefined;
	const releaseEventsRetain = graph.retain(events, { reason: `${name}.dynamicHub.events` });
	const hub: DynamicHub<T> = {
		command,
		events,
		status,
		errors,
		...(deadLetter === undefined ? {} : { deadLetter }),
		create(topic, commandOpts = {}) {
			return publishHubCommand(command, {
				kind: "create",
				topic,
				...(commandOpts.key === undefined ? {} : { key: commandOpts.key }),
				...(commandOpts.payload === undefined ? {} : { payload: commandOpts.payload }),
			} as DynamicHubCommand<T>);
		},
		delete(topic, commandOpts = {}) {
			return publishHubCommand(command, {
				kind: "delete",
				topic,
				...(commandOpts.key === undefined ? {} : { key: commandOpts.key }),
				...(commandOpts.payload === undefined ? {} : { payload: commandOpts.payload }),
			} as DynamicHubCommand<T>);
		},
		publish(topic, payload, commandOpts = {}) {
			return publishHubCommand(command, {
				kind: "publish",
				topic,
				payload,
				...(commandOpts.key === undefined ? {} : { key: commandOpts.key }),
			});
		},
		subscribeTopic(topic, commandOpts = {}) {
			return publishHubCommand(command, {
				kind: "subscribe",
				topic,
				...(commandOpts.key === undefined ? {} : { key: commandOpts.key }),
				...(commandOpts.payload === undefined ? {} : { payload: commandOpts.payload }),
			} as DynamicHubCommand<T>);
		},
		close(commandOpts = {}) {
			return publishHubCommand(command, {
				kind: "close",
				...(commandOpts.key === undefined ? {} : { key: commandOpts.key }),
				...(commandOpts.payload === undefined ? {} : { payload: commandOpts.payload }),
			} as DynamicHubCommand<T>);
		},
	};
	dynamicHubStates.set(hub as DynamicHub<unknown>, {
		graph,
		name,
		maxTopicLength,
		commandSources: commandSources as Node<DynamicHubCommand<unknown>>[],
		commandBody,
		releaseEventsRetain,
	});
	return hub;
}

/** Static D135 projection over hub event facts for one topic key; no topic node is created. */
export function fromHubTopic<T = unknown>(
	hub: DynamicHub<unknown>,
	topic: string,
	opts: { name?: string } = {},
): Node<MessageEnvelope<T>> {
	const state = requireDynamicHubState(hub);
	assertTopicKey(topic, "fromHubTopic", state.maxTopicLength);
	return state.graph.node<MessageEnvelope<T>>(
		[hub.events],
		(ctx) => {
			for (const event of depBatch(ctx, 0) ?? []) {
				const typed = event as DynamicHubEvent<T>;
				if (typed.kind !== "message" || typed.topic !== topic) continue;
				ctx.down([
					[
						"DATA",
						{
							topic,
							seq: typed.meta.seq,
							payload: typed.payload,
							timestampMs: typed.meta.timestampMs,
							...(typed.key === undefined ? {} : { key: typed.key }),
						} satisfies MessageEnvelope<T>,
					],
				]);
			}
		},
		{
			name: opts.name ?? `${state.name}/${topic}/fromHubTopic`,
			factory: "fromHubTopic",
			meta: { topic },
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
}

/** Static D135 command helper: source DATA becomes publish command facts for one topic key. */
export function toHubTopic<T>(
	graph: Graph,
	source: Node<T>,
	hub: DynamicHub<unknown>,
	topic: string,
	opts: ToHubTopicOptions<T> = {},
): ToHubTopicBundle<T> {
	const state = requireDynamicHubState(hub);
	assertTopicKey(topic, "toHubTopic", state.maxTopicLength);
	if (state.graph !== graph) throw new Error("toHubTopic: hub and source graph must match");
	if (isReachableUpstream(source as Node<unknown>, hub.command as Node<unknown>)) {
		throw new Error("toHubTopic: source already depends on hub command path");
	}
	const commands = graph.node<DynamicHubCommand<T>>(
		[source],
		(ctx) => {
			for (const value of depBatch(ctx, 0) ?? []) {
				try {
					const key = opts.keyOf?.(value as T);
					ctx.down([
						[
							"DATA",
							{
								kind: "publish",
								topic,
								payload: value as T,
								...(key === undefined ? {} : { key }),
							} satisfies DynamicHubCommand<T>,
						],
					]);
				} catch (error) {
					ctx.down([
						[
							"DATA",
							{
								kind: "invalid",
								topic,
								error: error instanceof Error ? error.message : String(error),
							} as unknown as DynamicHubCommand<T>,
						],
					]);
				}
			}
		},
		{
			name: opts.name ?? `${state.name}/${topic}/toHubTopic`,
			factory: "toHubTopic",
			meta: { topic },
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const commandSource = commands as Node<DynamicHubCommand<unknown>>;
	state.commandSources.push(commandSource);
	try {
		hub.command.replaceDeps([...state.commandSources], state.commandBody);
	} catch (error) {
		state.commandSources.splice(state.commandSources.indexOf(commandSource), 1);
		releaseGraphNodes(graph, [commands as Node<unknown>], {
			reason: "toHubTopic failed command wiring",
		});
		throw error;
	}
	return { commands };
}

export function fromTopic<T = unknown, TTopic extends string = string>(
	bus: MessageBus<TTopic>,
	topic: TTopic,
): Node<MessageEnvelope<T>> {
	return bus.topic<T>(topic);
}

export function toTopic<T, TTopic extends string>(
	graph: Graph,
	source: Node<T>,
	bus: MessageBus<TTopic>,
	topic: TTopic,
	opts: ToTopicOptions = {},
): ToTopicBundle<T> {
	const state = busStates.get(bus as MessageBus<string>) as MessageBusState<TTopic> | undefined;
	if (state === undefined) throw new Error("toTopic: unknown message bus implementation");
	if (state.graph !== graph) throw new Error("toTopic: bus and source graph must match");
	const record = requireTopicRecord(state, topic);
	const name = opts.name ?? `toTopic/${topic}`;
	const producer = graph.node<ProducedTopicMessage<T>>(
		[source],
		(ctx) => {
			for (const value of depBatch(ctx, 0) ?? []) {
				try {
					const key = opts.keyOf?.(value);
					const envelope: MessageEnvelope<T> = {
						topic,
						seq: ++state.seq,
						payload: value as T,
						timestampMs: state.now(),
						...(key === undefined ? {} : { key }),
					};
					ctx.down([
						[
							"DATA",
							{
								kind: "publish",
								envelope,
							} satisfies ProducedTopicMessage<T>,
						],
					]);
				} catch (error) {
					ctx.down([["DATA", { kind: "error", topic, error } satisfies ProducedTopicMessage<T>]]);
				}
			}
		},
		{
			name,
			factory: "toTopic",
			meta: { topic },
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	record.producers.push(producer as Node<ProducedTopicMessage<unknown>>);
	record.node.replaceDeps([...record.producers], record.body);
	const events = graph.node<MessageBusEvent<T>>(
		[producer, source],
		(ctx) => {
			for (const produced of depBatch(ctx, 0) ?? []) {
				const typed = produced as ProducedTopicMessage<T>;
				if (typed.kind === "publish") {
					ctx.down([
						[
							"DATA",
							{
								kind: "publish",
								topic,
								seq: typed.envelope.seq,
								payload: typed.envelope.payload,
							} satisfies MessageBusEvent<T>,
						],
					]);
				} else {
					ctx.down([
						["DATA", { kind: "error", topic, error: typed.error } satisfies MessageBusEvent<T>],
					]);
				}
			}
			const terminal = ctx.terminal[0];
			if (terminal !== false && terminal !== undefined && terminal !== true) {
				ctx.down([
					["DATA", { kind: "error", topic, error: terminal } satisfies MessageBusEvent<T>],
				]);
			}
			const sourceTerminal = ctx.terminal[1];
			if (sourceTerminal === true) {
				ctx.down([["DATA", { kind: "complete", topic } satisfies MessageBusEvent<T>]]);
			} else if (sourceTerminal !== false && sourceTerminal !== undefined) {
				ctx.down([
					["DATA", { kind: "error", topic, error: sourceTerminal } satisfies MessageBusEvent<T>],
				]);
			}
		},
		{
			name: `${name}/events`,
			factory: "toTopicEvents",
			meta: { topic },
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			terminalAsRealInput: true,
		},
	);
	return { events };
}

function requireTopic<TTopic extends string>(
	state: MessageBusState<TTopic>,
	topic: TTopic,
): Node<MessageEnvelope<unknown>> {
	return requireTopicRecord(state, topic).node;
}

function requireTopicRecord<TTopic extends string>(
	state: MessageBusState<TTopic>,
	topic: TTopic,
): TopicRecord {
	const record = state.records.get(topic);
	if (record === undefined) throw new Error(`messageBus: unknown topic '${topic}'`);
	return record;
}

function uniqueTopics(topics: readonly string[], maxTopicLength: number): readonly string[] {
	const unique = [...new Set(topics)];
	if (unique.length !== topics.length) throw new Error("dynamicHub: duplicate topic");
	for (const topic of unique) assertTopicKey(topic, "dynamicHub", maxTopicLength);
	return Object.freeze(unique.sort());
}

function normalizeUnknownTopicPolicy(
	policy: DynamicHubOptions["unknownTopic"],
): DynamicHubUnknownTopicPolicy {
	if (policy === undefined) return "error";
	if (
		policy === "drop" ||
		policy === "error" ||
		policy === "dead-letter" ||
		policy === "create-as-fact"
	) {
		return policy;
	}
	throw new Error("dynamicHub: unknownTopic policy is not recognized");
}

function normalizeHubLimit(value: number | undefined, fallback: number, owner: string): number {
	if (value === undefined) return fallback;
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${owner} must be a positive integer`);
	}
	return value;
}

function publishHubCommand<T>(
	commandNode: Node<DynamicHubCommand<T>>,
	command: DynamicHubCommand<T>,
): DynamicHubCommand<T> {
	commandNode.down([["DATA", command]]);
	return command;
}

function parseDynamicHubCommand(value: unknown): DynamicHubCommand<unknown> | string {
	if (!isObjectRecord(value)) return "dynamicHub: command fact must be an object";
	const kind = value.kind;
	if (
		kind !== "create" &&
		kind !== "delete" &&
		kind !== "publish" &&
		kind !== "subscribe" &&
		kind !== "close"
	) {
		return "dynamicHub: command kind is not recognized";
	}
	if (kind === "close") {
		return {
			kind,
			...(typeof value.key === "string" ? { key: value.key } : {}),
			...(value.payload === undefined ? {} : { payload: value.payload }),
		};
	}
	const topic = value.topic;
	if (typeof topic !== "string" || topic.length === 0) {
		return "dynamicHub: command topic must be a non-empty string";
	}
	if (kind === "publish") {
		if (value.payload === undefined) return "dynamicHub: publish command payload is required";
		return {
			kind,
			topic,
			payload: value.payload,
			...(typeof value.key === "string" ? { key: value.key } : {}),
		};
	}
	return {
		kind,
		topic,
		...(typeof value.key === "string" ? { key: value.key } : {}),
		...(value.payload === undefined ? {} : { payload: value.payload }),
	};
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readHubTimestamp(now: () => number): number | string {
	try {
		const timestampMs = now();
		return Number.isFinite(timestampMs)
			? timestampMs
			: "dynamicHub: now() must return a finite number";
	} catch (error) {
		return `dynamicHub: now() threw: ${error instanceof Error ? error.message : String(error)}`;
	}
}

function timestampOrFallback(now: () => number): number {
	const timestampMs = readHubTimestamp(now);
	return typeof timestampMs === "number" ? timestampMs : Date.now();
}

function reduceDynamicHubCommand<T>(
	runtime: DynamicHubRuntime,
	command: DynamicHubCommand<T>,
	unknownTopic: DynamicHubUnknownTopicPolicy,
	maxTopics: number,
	maxTopicLength: number,
	now: () => number,
): DynamicHubEvent<T>[] {
	const topic = "topic" in command ? command.topic : undefined;
	if (topic !== undefined) {
		const topicError = validateTopicKey(topic, "dynamicHub", maxTopicLength);
		if (topicError !== undefined) {
			return [hubError(runtime, command, topicError, timestampOrFallback(now))];
		}
	}
	if (!runtime.open && command.kind !== "close") {
		return [hubError(runtime, command, "dynamicHub: hub is closed", timestampOrFallback(now))];
	}
	switch (command.kind) {
		case "create": {
			const capacityError = canAddHubTopic(runtime, command.topic, maxTopics);
			if (capacityError !== undefined) {
				return [hubError(runtime, command, capacityError, timestampOrFallback(now))];
			}
			const timestampMs = readHubTimestamp(now);
			if (typeof timestampMs === "string")
				return [hubError(runtime, command, timestampMs, Date.now())];
			addHubTopic(runtime, command.topic);
			return [hubEvent(runtime, timestampMs, command)];
		}
		case "delete": {
			if (!hasHubTopic(runtime, command.topic)) {
				return unknownHubTopic(runtime, command, unknownTopic, now);
			}
			const timestampMs = readHubTimestamp(now);
			if (typeof timestampMs === "string")
				return [hubError(runtime, command, timestampMs, Date.now())];
			deleteHubTopic(runtime, command.topic);
			return [hubEvent(runtime, timestampMs, command)];
		}
		case "publish": {
			if (!hasHubTopic(runtime, command.topic)) {
				if (unknownTopic === "create-as-fact") {
					const capacityError = canAddHubTopic(runtime, command.topic, maxTopics);
					if (capacityError !== undefined) {
						return [hubError(runtime, command, capacityError, timestampOrFallback(now))];
					}
					const createTimestampMs = readHubTimestamp(now);
					if (typeof createTimestampMs === "string") {
						return [hubError(runtime, command, createTimestampMs, Date.now())];
					}
					const messageTimestampMs = readHubTimestamp(now);
					if (typeof messageTimestampMs === "string") {
						return [hubError(runtime, command, messageTimestampMs, Date.now())];
					}
					addHubTopic(runtime, command.topic);
					return [
						hubEvent(runtime, createTimestampMs, { kind: "create", topic: command.topic }),
						hubEvent(runtime, messageTimestampMs, {
							kind: "message",
							topic: command.topic,
							payload: command.payload,
							...(command.key === undefined ? {} : { key: command.key }),
						}),
					];
				}
				return unknownHubTopic(runtime, command, unknownTopic, now);
			}
			const timestampMs = readHubTimestamp(now);
			if (typeof timestampMs === "string")
				return [hubError(runtime, command, timestampMs, Date.now())];
			return [
				hubEvent(runtime, timestampMs, {
					kind: "message",
					topic: command.topic,
					payload: command.payload,
					...(command.key === undefined ? {} : { key: command.key }),
				}),
			];
		}
		case "subscribe": {
			if (!hasHubTopic(runtime, command.topic)) {
				if (unknownTopic === "create-as-fact") {
					const capacityError = canAddHubTopic(runtime, command.topic, maxTopics);
					if (capacityError !== undefined) {
						return [hubError(runtime, command, capacityError, timestampOrFallback(now))];
					}
					const createTimestampMs = readHubTimestamp(now);
					if (typeof createTimestampMs === "string") {
						return [hubError(runtime, command, createTimestampMs, Date.now())];
					}
					const subscribeTimestampMs = readHubTimestamp(now);
					if (typeof subscribeTimestampMs === "string") {
						return [hubError(runtime, command, subscribeTimestampMs, Date.now())];
					}
					addHubTopic(runtime, command.topic);
					return [
						hubEvent(runtime, createTimestampMs, { kind: "create", topic: command.topic }),
						hubEvent(runtime, subscribeTimestampMs, command),
					];
				}
				return unknownHubTopic(runtime, command, unknownTopic, now);
			}
			const timestampMs = readHubTimestamp(now);
			if (typeof timestampMs === "string")
				return [hubError(runtime, command, timestampMs, Date.now())];
			return [hubEvent(runtime, timestampMs, command)];
		}
		case "close": {
			const timestampMs = readHubTimestamp(now);
			if (typeof timestampMs === "string")
				return [hubError(runtime, command, timestampMs, Date.now())];
			runtime.open = false;
			return [hubEvent(runtime, timestampMs, command)];
		}
	}
}

function hubEvent<T>(
	runtime: DynamicHubRuntime,
	timestampMs: number,
	event: Record<string, unknown> & { readonly kind: DynamicHubEventKind },
): DynamicHubEvent<T> {
	const meta = nextHubMetadata(runtime, timestampMs);
	return {
		...event,
		meta,
		status: snapshotHubStatus(runtime, meta, event.kind),
	} as DynamicHubEvent<T>;
}

function hubError<T>(
	runtime: DynamicHubRuntime,
	command: unknown,
	error: string,
	timestampMs: number,
): DynamicHubEvent<T> {
	return hubEvent(runtime, timestampMs, {
		kind: "error",
		...(isObjectRecord(command) && typeof command.topic === "string"
			? { topic: command.topic }
			: {}),
		error,
		command,
	});
}

function unknownHubTopic<T>(
	runtime: DynamicHubRuntime,
	command: DynamicHubCommand<T>,
	policy: DynamicHubUnknownTopicPolicy,
	now: () => number,
): DynamicHubEvent<T>[] {
	const topic = "topic" in command ? command.topic : undefined;
	const reason = `dynamicHub: unknown topic '${topic ?? ""}'`;
	if (policy === "drop") return [];
	if (policy === "dead-letter") {
		return [
			hubEvent(runtime, timestampOrFallback(now), {
				kind: "dead-letter",
				...(topic === undefined ? {} : { topic }),
				reason,
				command,
			}),
		];
	}
	return [hubError(runtime, command, reason, timestampOrFallback(now))];
}

function nextHubMetadata(runtime: DynamicHubRuntime, timestampMs: number): DynamicHubMetadata {
	runtime.seq += 1;
	runtime.cursor = runtime.seq;
	return { seq: runtime.seq, cursor: runtime.cursor, timestampMs };
}

function snapshotHubStatus(
	runtime: DynamicHubRuntime,
	meta: DynamicHubMetadata,
	kind: DynamicHubEventKind,
): DynamicHubStatus {
	return {
		open: runtime.open,
		topics: Object.freeze([...runtime.topics].sort()),
		seq: meta.seq,
		cursor: meta.cursor,
		lastEventKind: kind,
	};
}

function assertTopicKey(topic: string, owner: string, maxTopicLength: number): void {
	const error = validateTopicKey(topic, owner, maxTopicLength);
	if (error !== undefined) throw new Error(error);
}

function validateTopicKey(
	topic: string,
	owner: string,
	maxTopicLength: number,
): string | undefined {
	if (typeof topic !== "string" || topic.length === 0) {
		return `${owner}: topic must be a non-empty string`;
	}
	if (topic.length > maxTopicLength) {
		return `${owner}: topic exceeds maxTopicLength`;
	}
	return undefined;
}

function hasHubTopic(runtime: DynamicHubRuntime, topic: string): boolean {
	return runtime.topics.includes(topic);
}

function addHubTopic(runtime: DynamicHubRuntime, topic: string): void {
	if (!hasHubTopic(runtime, topic)) runtime.topics = [...runtime.topics, topic];
}

function deleteHubTopic(runtime: DynamicHubRuntime, topic: string): void {
	runtime.topics = runtime.topics.filter((existing) => existing !== topic);
}

function canAddHubTopic(
	runtime: DynamicHubRuntime,
	topic: string,
	maxTopics: number,
): string | undefined {
	if (hasHubTopic(runtime, topic)) return undefined;
	return runtime.topics.length >= maxTopics
		? "dynamicHub: topic count exceeds maxTopics"
		: undefined;
}

function isReachableUpstream(from: Node<unknown>, target: Node<unknown>): boolean {
	const seen = new Set<Node<unknown>>();
	const stack: Node<unknown>[] = [from];
	while (stack.length > 0) {
		const node = stack.pop();
		if (node === undefined) continue;
		if (node === target) return true;
		if (seen.has(node)) continue;
		seen.add(node);
		for (const dep of node.deps) stack.push(dep);
	}
	return false;
}

function requireDynamicHubState(hub: DynamicHub<unknown>): DynamicHubState<unknown> {
	const state = dynamicHubStates.get(hub);
	if (state === undefined) throw new Error("dynamicHub: unknown hub implementation");
	return state;
}
