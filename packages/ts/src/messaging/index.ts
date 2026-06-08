/**
 * Reusable application-infrastructure messaging namespace.
 *
 * Retained root messaging utilities land here only after B63 re-derives them
 * onto the D125 package DAG.
 */

import { depBatch, type NodeFn } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";

export interface MessageEnvelope<T = unknown> {
	readonly topic: string;
	readonly seq: number;
	readonly payload: T;
	readonly key?: string;
	readonly timestampMs: number;
}

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
