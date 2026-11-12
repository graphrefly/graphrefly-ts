/**
 * Reusable application-infrastructure messaging namespace.
 *
 * D279/D282/D284/D285/D276: messageBus is a retained topic-log plus independent
 * subscription-cursor substrate. DynamicHub is intentionally retired; do not add aliases.
 */

import type { NodeFn } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey } from "../identity.js";
import { attachableInput } from "../node/attachable-input.js";
import type { Node, StateNode } from "../node/node.js";
import { oneArrayPerRun } from "../node/one-array-per-run.js";
import {
	attachMessageBusCommandSource,
	getMessageBusState,
	registerMessageBusState,
} from "./internal.js";
import type {
	MessageBusState,
	RuntimeEvent,
	SubscriptionState,
	TopicState,
} from "./runtime-types.js";
import type {
	MessageBus,
	MessageBusAvailablePage,
	MessageBusAvailableParams,
	MessageBusCatalogPage,
	MessageBusCatalogParams,
	MessageBusCommand,
	MessageBusCursor,
	MessageBusDeadLetterEntry,
	MessageBusDeadLetterPage,
	MessageBusDeadLetterParams,
	MessageBusMessage,
	MessageBusOptions,
	MessageBusStatus,
	MessageBusTopicPage,
	MessageBusTopicParams,
	ToTopicBundle,
	ToTopicOptions,
} from "./types.js";
import {
	assertNonEmpty,
	assertTopicKey,
	commandIdOf,
	commandTopic,
	idempotencyKey,
	isObjectRecord,
	isPositiveSeq,
	makeTopicState,
	positiveLimit,
	publishCommand,
	requestParams,
	uniqueTopics,
	validateTopicKey,
} from "./utils.js";

export {
	eventMessage,
	eventMessageIssue,
	isEventMessage,
} from "./event-message.js";
export type {
	EventMessage,
	EventMessageOptions,
	JsonSchema,
	MessageBus,
	MessageBusAvailablePage,
	MessageBusAvailableParams,
	MessageBusCatalogEntry,
	MessageBusCatalogPage,
	MessageBusCatalogParams,
	MessageBusCommand,
	MessageBusCursor,
	MessageBusDeadLetterEntry,
	MessageBusDeadLetterPage,
	MessageBusDeadLetterParams,
	MessageBusDedupePolicy,
	MessageBusMessage,
	MessageBusOptions,
	MessageBusPageParams,
	MessageBusRequestProjection,
	MessageBusRetentionPolicy,
	MessageBusStatus,
	MessageBusSubscription,
	MessageBusTopicPage,
	MessageBusTopicParams,
	MessageBusTopicPolicy,
	MessageBusTopicProjection,
	MessageEnvelope,
	StandardTopic,
	TopicMessage,
	ToTopicBundle,
	ToTopicOptions,
} from "./types.js";
export {
	CONTEXT_TOPIC,
	DEFERRED_TOPIC,
	INJECTIONS_TOPIC,
	PROMPTS_TOPIC,
	RESPONSES_TOPIC,
	SPAWNS_TOPIC,
	STANDARD_TOPICS,
	TODOS_TOPIC,
} from "./types.js";

/**
 * Creates a message bus.
 *
 * @param graph - Graph that owns the created nodes or projector.
 * @param opts - Options that configure the helper.
 * @returns The message bus result.
 * @category messaging
 * @example
 * ```ts
 * import { messageBus } from "@graphrefly/ts/messaging";
 * ```
 */
export function messageBus<TTopic extends string>(
	graph: Graph,
	opts: MessageBusOptions<TTopic> = {},
): MessageBus<TTopic> {
	const name = opts.name ?? "messageBus";
	const initialTopics = uniqueTopics(opts.topics ?? []);
	const commandBody: NodeFn = oneArrayPerRun((ctx) => {
		for (let i = 0; i < ctx.deps.length; i++) {
			for (const command of ctx.deps[i].waves.flat()) ctx.down([["DATA", command]]);
		}
		// Only the publish input (dep 0) ends the bus; an attached source ending leaves it open.
		const ended = ctx.deps[0].terminal;
		if (ended?.kind === "complete") ctx.down([["COMPLETE"]]);
		else if (ended?.kind === "error") ctx.down([["ERROR", ended.error]]);
	});
	// The bus's host input: publishes are written here and forwarded by the command node, which also
	// rewires itself to attached command sources (graphrefly-ts:D175, no host write to a computed node).
	const publish = graph.node<MessageBusCommand>([], null, {
		name: `${name}/publish`,
		factory: "messageBusPublish",
		complete: "manual",
		error: "manual",
	});
	const commandSources = attachableInput();
	const commands = graph.node<MessageBusCommand>([publish], commandBody, {
		name: `${name}/commands`,
		factory: "messageBusCommands",
		// A forwarder: it runs on whichever input has commands, without waiting for the others.
		complete: "manual",
		error: "manual",
		setup: commandSources.setup,
	});
	commandSources.bind(commands as Node<unknown>);
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
		commandBody,
		commandSources,
		publish,
	};
	const runtime = graph.node<RuntimeEvent>(
		[commands],
		oneArrayPerRun((ctx) => {
			for (const command of ctx.deps[0].waves.flat()) {
				for (const event of reduceMessageBusCommand(state, command as MessageBusCommand)) {
					ctx.down([["DATA", event]]);
				}
			}
		}),
		{
			name: `${name}/runtime`,
			factory: "messageBusRuntime",
			complete: "manual",
			error: "manual",
		},
	);
	graph.retain(runtime);
	const messages = graph.node<MessageBusMessage>(
		[runtime],
		oneArrayPerRun((ctx) => {
			for (const event of ctx.deps[0].waves.flat()) {
				const typed = event as RuntimeEvent;
				if (typed.kind === "message") ctx.down([["DATA", typed.message]]);
			}
		}),
		{
			name: `${name}/messages`,
			factory: "messageBusMessages",
			complete: "manual",
			error: "manual",
		},
	);
	const status = graph.node<MessageBusStatus>(
		[runtime],
		oneArrayPerRun((ctx) => {
			for (const event of ctx.deps[0].waves.flat()) {
				const typed = event as RuntimeEvent;
				if (typed.kind === "status") ctx.down([["DATA", typed.status]]);
			}
		}),
		{
			name: `${name}/status`,
			factory: "messageBusStatus",
			complete: "manual",
			error: "manual",
		},
	);
	const issues = graph.node<DataIssue>(
		[runtime],
		oneArrayPerRun((ctx) => {
			for (const event of ctx.deps[0].waves.flat()) {
				const typed = event as RuntimeEvent;
				if (typed.kind === "issue") ctx.down([["DATA", typed.issue]]);
			}
		}),
		{
			name: `${name}/issues`,
			factory: "messageBusIssues",
			complete: "manual",
			error: "manual",
		},
	);

	const bus: MessageBus<TTopic> = {
		commands,
		messages,
		status,
		issues,
		ensureTopic(topic, commandOpts = {}) {
			return publishCommand(publish, {
				kind: "ensure-topic",
				topic,
				...(commandOpts.commandId === undefined ? {} : { commandId: commandOpts.commandId }),
			});
		},
		closeTopic(topic, commandOpts = {}) {
			return publishCommand(publish, {
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
			return publishCommand(publish, {
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
			const projectionName = projectionOpts.name ?? `${name}/${topic}/topic`;
			const snapshotRequest = projectionRequest<MessageBusTopicParams>(
				graph,
				projectionName,
				"messageBusTopicRequest",
			);
			const snapshot = graph.node<MessageBusTopicPage<T>>(
				[messages, snapshotRequest],
				(ctx) => {
					const params = requestParams<MessageBusTopicParams>(ctx, 1);
					if (params === undefined) return;
					ctx.down([["DATA", topicPage<T>(state, topic, params)]]);
				},
				{
					name: projectionName,
					factory: "messageBusTopicProjection",
					meta: { topic },
					quiet: true,
					complete: "manual",
					error: "manual",
				},
			);
			return { snapshot, snapshotRequest, status, issues };
		},
		catalog(projectionOpts: { name?: string } = {}) {
			const projectionName = projectionOpts.name ?? `${name}/catalog`;
			const snapshotRequest = projectionRequest<MessageBusCatalogParams>(
				graph,
				projectionName,
				"messageBusCatalogRequest",
			);
			const snapshot = graph.node<MessageBusCatalogPage>(
				[runtime, snapshotRequest],
				(ctx) => {
					const params = requestParams<MessageBusCatalogParams>(ctx, 1);
					if (params === undefined) return;
					ctx.down([["DATA", catalogPage(state, params)]]);
				},
				{
					name: projectionName,
					factory: "messageBusCatalog",
					quiet: true,
					complete: "manual",
					error: "manual",
				},
			);
			return { snapshot, snapshotRequest, status, issues };
		},
		deadLetter<T = unknown>(projectionOpts: { name?: string } = {}) {
			const projectionName = projectionOpts.name ?? `${name}/deadLetter`;
			const snapshotRequest = projectionRequest<MessageBusDeadLetterParams>(
				graph,
				projectionName,
				"messageBusDeadLetterRequest",
			);
			const snapshot = graph.node<MessageBusDeadLetterPage<T>>(
				[runtime, snapshotRequest],
				(ctx) => {
					const params = requestParams<MessageBusDeadLetterParams>(ctx, 1);
					if (params === undefined) return;
					ctx.down([["DATA", deadLetterPage<T>(state, params)]]);
				},
				{
					name: projectionName,
					factory: "messageBusDeadLetter",
					quiet: true,
					complete: "manual",
					error: "manual",
				},
			);
			return { snapshot, snapshotRequest, status, issues };
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
			const projectionName =
				subscriptionOpts.name ??
				`${name}/${subscriptionOpts.topic}/${subscriptionOpts.subscriptionId}`;
			const availableRequest = projectionRequest<MessageBusAvailableParams>(
				graph,
				`${projectionName}/available`,
				"messageBusSubscriptionAvailableRequest",
			);
			const available = graph.node<MessageBusAvailablePage<T>>(
				[messages, status, availableRequest],
				(ctx) => {
					const params = requestParams<MessageBusAvailableParams>(ctx, 2);
					if (params === undefined) return;
					ctx.down([["DATA", availablePage<T>(state, sub, params)]]);
				},
				{
					name: `${projectionName}/available`,
					factory: "messageBusSubscriptionAvailable",
					meta: { topic: subscriptionOpts.topic, subscriptionId: subscriptionOpts.subscriptionId },
					quiet: true,
					complete: "manual",
					error: "manual",
				},
			);
			const cursor = graph.node<MessageBusCursor>(
				[status],
				oneArrayPerRun((ctx) => {
					for (const fact of ctx.deps[0].waves.flat()) {
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
				}),
				{
					name: `${projectionName}/cursor`,
					factory: "messageBusSubscriptionCursor",
					complete: "manual",
					error: "manual",
				},
			);
			return {
				available,
				availableRequest,
				cursor,
				status,
				issues,
				ack(seq, commandOpts = {}) {
					return publishCommand(publish, {
						kind: "ack",
						topic: sub.topic,
						subscriptionId: sub.subscriptionId,
						seq,
						...(commandOpts.commandId === undefined ? {} : { commandId: commandOpts.commandId }),
					});
				},
				seek(nextSeq, commandOpts = {}) {
					return publishCommand(publish, {
						kind: "seek",
						topic: sub.topic,
						subscriptionId: sub.subscriptionId,
						nextSeq,
						...(commandOpts.commandId === undefined ? {} : { commandId: commandOpts.commandId }),
					});
				},
				close(commandOpts = {}) {
					return publishCommand(publish, {
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

/**
 * Creates a to topic.
 *
 * @param graph - Graph that owns the created nodes or projector.
 * @param source - Source node that provides graph-visible input.
 * @param bus - bus value used by the helper.
 * @param topic - topic value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns The to topic result.
 * @category messaging
 * @example
 * ```ts
 * import { toTopic } from "@graphrefly/ts/messaging";
 * ```
 */
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
		oneArrayPerRun((ctx) => {
			for (const value of ctx.deps[0].waves.flat()) {
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
		}),
		{
			name: opts.name ?? `${state.name}/${topic}/toTopic`,
			factory: "toTopic",
			meta: { topic },
			complete: "manual",
			error: "manual",
		},
	);
	const releaseSource = attachMessageBusCommandSource(
		graph,
		bus,
		commands as Node<MessageBusCommand>,
	);
	return {
		commands,
		release() {
			releaseSource();
		},
	};
}

/**
 * A projection's request state (graphrefly-ts:D172): the projection declares it as a dependency
 * and serves one page per live write, with the written params.
 */
function projectionRequest<P>(graph: Graph, projectionName: string, factory: string): StateNode<P> {
	return graph.node<P>([], null, {
		name: `${projectionName}/request`,
		factory,
		complete: "manual",
		error: "manual",
	});
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
	const key = canonicalTupleKey([opts.topic, opts.subscriptionId]);
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
	return state.subscriptions.get(canonicalTupleKey([topic, subscriptionId]));
}
