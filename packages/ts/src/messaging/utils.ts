import { type Ctx, depLiveBatch } from "../ctx/types.js";
import { canonicalTupleKey } from "../identity.js";
import type { StateNode } from "../node/node.js";
import type { MessageBusCommand } from "./types.js";

/**
 * The params of the live request this run, from a projection's request dependency (graphrefly-ts:
 * D172): `undefined` when no request arrived live in this run (including the activation snapshot
 * of an earlier request), otherwise the last written object (a non-object write counts as `{}`).
 */
export function requestParams<T>(ctx: Ctx, depIndex: number): T | undefined {
	const writes = depLiveBatch(ctx, depIndex);
	if (writes === null) return undefined;
	const last = writes[writes.length - 1];
	return (typeof last === "object" && last !== null && !Array.isArray(last) ? last : {}) as T;
}

export function publishCommand<T extends MessageBusCommand>(
	commandNode: StateNode<MessageBusCommand>,
	command: T,
): T {
	commandNode.set(command);
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
	return canonicalTupleKey([topic, key]);
}
