import type { NodeFn } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import type {
	MessageBusCommand,
	MessageBusDeadLetterEntry,
	MessageBusDedupePolicy,
	MessageBusMessage,
	MessageBusRetentionPolicy,
	MessageBusStatus,
	MessageBusTopicPolicy,
} from "./types.js";

export interface TopicState {
	closed: boolean;
	headSeq: number;
	nextSeq: number;
	messages: MessageBusMessage[];
}

export interface SubscriptionState {
	topic: string;
	subscriptionId: string;
	nextSeq: number;
	closed: boolean;
	retentionGap: boolean;
}

export type RuntimeEvent<T = unknown> =
	| { readonly kind: "message"; readonly message: MessageBusMessage<T> }
	| { readonly kind: "status"; readonly status: MessageBusStatus }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "dead-letter"; readonly entry: MessageBusDeadLetterEntry<T> };

export interface MessageBusState {
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
