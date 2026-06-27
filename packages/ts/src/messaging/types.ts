import type { DataIssue } from "../data/index.js";
import type { Node } from "../node/node.js";
import type { LockId } from "../protocol/messages.js";

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
