import type { Node } from "../node/node.js";
import type { PullDemand } from "../protocol/messages.js";
import type { MessageBusCommand } from "./types.js";

export function pullParams<T>(pull: PullDemand | undefined): T {
	return (isObjectRecord(pull?.params) ? pull.params : {}) as T;
}

export function publishCommand<T extends MessageBusCommand>(
	commandNode: Node<MessageBusCommand>,
	command: T,
): T {
	commandNode.down([["DATA", command]]);
	return command;
}

export function makeTopicState(): {
	closed: boolean;
	headSeq: number;
	nextSeq: number;
	messages: [];
} {
	return { closed: false, headSeq: 1, nextSeq: 1, messages: [] };
}

export function uniqueTopics(topics: readonly string[]): readonly string[] {
	const unique = [...new Set(topics)];
	if (unique.length !== topics.length) throw new Error("messageBus: duplicate topic");
	for (const topic of unique) assertTopicKey(topic, "messageBus");
	return Object.freeze(unique.sort());
}

export function assertTopicKey(topic: string, owner: string): void {
	const error = validateTopicKey(topic, owner);
	if (error !== undefined) throw new Error(error);
}

export function validateTopicKey(topic: string, owner: string): string | undefined {
	if (typeof topic !== "string" || topic.length === 0)
		return `${owner}: topic must be a non-empty string`;
	return undefined;
}

export function assertNonEmpty(value: string, owner: string): void {
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`${owner}: must be a non-empty string`);
}

export function positiveLimit(limit: number | undefined): number {
	if (limit === undefined) return 100;
	if (!Number.isInteger(limit) || limit < 1)
		throw new Error("messageBus: limit must be a positive integer");
	return limit;
}

export function isPositiveSeq(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 1;
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function commandTopic(command: unknown): string | undefined {
	return isObjectRecord(command) && typeof command.topic === "string" ? command.topic : undefined;
}

export function commandIdOf(command: unknown): string | undefined {
	return isObjectRecord(command) && typeof command.commandId === "string"
		? command.commandId
		: undefined;
}

export function idempotencyKey(topic: string, key: string): string {
	return `${topic}\u0000${key}`;
}
