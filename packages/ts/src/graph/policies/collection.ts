/**
 * Internal graph-layer policy helpers (D70).
 *
 * This module is deliberately NOT exported from the package index. It centralizes policy plumbing
 * shared by collection structures while each structure still owns backend mutation + delta emission
 * in its apply/mutation path (D60/D61/D68/D69).
 */

import type { Ctx } from "../../ctx/types.js";
import type { Node } from "../../node/node.js";

export type PolicyOpt<T> = T | Node<T>;

export interface PolicyReader<T> {
	readonly index: number;
	read(ctx: Ctx, current: T | undefined): T | undefined;
}

export class PolicyInputs {
	readonly deps: Node<unknown>[];

	constructor(initial: readonly Node<unknown>[] = []) {
		this.deps = [...initial];
	}

	add<T>(node: Node<T> | undefined): PolicyReader<T> {
		if (node === undefined) return missingPolicyReader<T>();
		const index = this.deps.push(node as Node<unknown>) - 1;
		return policyReader<T>(index);
	}
}

function missingPolicyReader<T>(): PolicyReader<T> {
	return {
		index: -1,
		read: (_ctx, current) => current,
	};
}

function policyReader<T>(index: number): PolicyReader<T> {
	return {
		index,
		read(ctx, current) {
			const latest = ctx.depRecords[index]?.latest;
			return latest === undefined ? current : (latest as T);
		},
	};
}

export interface KeyOrderPolicy<K> {
	keys(): Iterable<K>;
}

export function lruKeys<K>(keys: Iterable<K>): KeyOrderPolicy<K> {
	return {
		keys: () => keys,
	};
}

export interface CapacityConfig {
	readonly maxSize?: number;
}

export interface SizedCapacityConfig extends CapacityConfig {
	readonly size: number;
}

export function trimHeadOverflow<T>(items: T[], config: CapacityConfig): T[];
export function trimHeadOverflow<T>(items: Iterable<T>, config: SizedCapacityConfig): T[];
export function trimHeadOverflow<T>(
	items: T[] | Iterable<T>,
	config: CapacityConfig | SizedCapacityConfig,
): T[] {
	const { maxSize } = config;
	if (maxSize === undefined) return [];
	if (!Number.isInteger(maxSize) || maxSize < 1)
		throw new RangeError(`maxSize must be a positive integer (got ${maxSize})`);

	const size = "size" in config ? config.size : Array.isArray(items) ? items.length : undefined;
	if (size === undefined) throw new Error("trimHeadOverflow requires size for non-array iterables");
	const overflow = size - maxSize;
	if (overflow <= 0) return [];

	if (Array.isArray(items) && !("size" in config)) return items.splice(0, overflow);

	const victims: T[] = [];
	for (const item of items) {
		victims.push(item);
		if (victims.length === overflow) break;
	}
	return victims;
}

export interface DeadlineEntry<K> {
	readonly key: K;
	readonly expiresAt: number;
}

export interface DeadlinePolicy<K> {
	readonly size: number;
	push(item: DeadlineEntry<K>): void;
	peek(): DeadlineEntry<K> | undefined;
	pop(): DeadlineEntry<K> | undefined;
}

export function deadlines<K>(): DeadlinePolicy<K> {
	return new MinDeadlineHeap<K>();
}

class MinDeadlineHeap<K> implements DeadlinePolicy<K> {
	private readonly items: DeadlineEntry<K>[] = [];

	get size(): number {
		return this.items.length;
	}

	push(item: DeadlineEntry<K>): void {
		this.items.push(item);
		this.up(this.items.length - 1);
	}

	peek(): DeadlineEntry<K> | undefined {
		return this.items[0];
	}

	pop(): DeadlineEntry<K> | undefined {
		const top = this.items[0];
		const last = this.items.pop();
		if (top !== undefined && last !== undefined && this.items.length > 0) {
			this.items[0] = last;
			this.down(0);
		}
		return top;
	}

	private up(i: number): void {
		while (i > 0) {
			const p = (i - 1) >> 1;
			if (
				(this.items[p] as DeadlineEntry<K>).expiresAt <=
				(this.items[i] as DeadlineEntry<K>).expiresAt
			)
				return;
			[this.items[p], this.items[i]] = [
				this.items[i] as DeadlineEntry<K>,
				this.items[p] as DeadlineEntry<K>,
			];
			i = p;
		}
	}

	private down(i: number): void {
		for (;;) {
			const left = i * 2 + 1;
			const right = left + 1;
			let smallest = i;
			if (left < this.items.length && this.expiresAt(left) < this.expiresAt(smallest))
				smallest = left;
			if (right < this.items.length && this.expiresAt(right) < this.expiresAt(smallest))
				smallest = right;
			if (smallest === i) return;
			[this.items[i], this.items[smallest]] = [
				this.items[smallest] as DeadlineEntry<K>,
				this.items[i] as DeadlineEntry<K>,
			];
			i = smallest;
		}
	}

	private expiresAt(i: number): number {
		return (this.items[i] as DeadlineEntry<K>).expiresAt;
	}
}

export interface ScoredEntry<T> {
	readonly entry: T;
	readonly score: number;
}

export interface RetentionSelectionConfig {
	readonly maxSize?: number;
}

export function selectRetentionVictims<T>(
	scoredEntries: readonly ScoredEntry<T>[],
	config: RetentionSelectionConfig,
): T[] {
	const { maxSize } = config;
	if (maxSize === undefined) return [];
	if (!Number.isInteger(maxSize) || maxSize < 0)
		throw new RangeError(`retention maxSize must be a non-negative integer (got ${maxSize})`);
	const overflow = scoredEntries.length - maxSize;
	if (overflow <= 0) return [];

	return scoredEntries
		.map((item, index) => {
			if (!Number.isFinite(item.score))
				throw new RangeError(`retention score must be finite (got ${item.score})`);
			return { ...item, index };
		})
		.sort((a, b) => a.score - b.score || a.index - b.index)
		.slice(0, overflow)
		.map((item) => item.entry);
}
