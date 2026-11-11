import { currentBatch, DeferredWrite, deferToBatch, stagedBatchWave } from "../batch/batch.js";
import { deferRequest, reportFailure } from "../batch/boundary.js";
import type { Sink } from "../ctx/types.js";
import type { Message, Wave } from "../protocol/messages.js";
import { isTerminal, SENTINEL } from "../protocol/messages.js";
import type { Subscriber } from "./core.js";
import type { Node } from "./node.js";
import { nodeCloseLifetime } from "./node-lifecycle-runtime.js";
import type { NodeRuntimeHost } from "./node-runtime-host.js";
import { validateDownPayloads } from "./protocol-guards.js";
import {
	advanceNodeVersion,
	assertNodeVersionDataCompatible,
	snapshotNodeVersionData,
} from "./versioning.js";

/**
 * R-wave: an array carrying DATA, RESOLVED, INVALIDATE, COMPLETE or ERROR marks the sender's
 * dependents pending and goes out with the kernel's PENDING first.
 */
export function isMarking(m: Message): boolean {
	return (
		m[0] === "DATA" ||
		m[0] === "RESOLVED" ||
		m[0] === "INVALIDATE" ||
		m[0] === "COMPLETE" ||
		m[0] === "ERROR"
	);
}

/**
 * R-wave: one submitted array, checked and split into the arrays that are published. Messages
 * keep their written order; a terminal must be last; the array is split at its last INVALIDATE,
 * so what came before it is dropped and the INVALIDATE goes out as its own array. Throws before
 * anything is accepted.
 */
export function prepareArrays(msgs: Wave): Message[][] {
	const end = msgs.findIndex((m) => isTerminal(m[0]));
	if (end >= 0 && end < msgs.length - 1)
		throw new Error("down: a terminal must be the last message of its array (R-wave)");
	let cut = -1;
	for (let i = msgs.length - 1; i >= 0; i--) {
		if (msgs[i]?.[0] === "INVALIDATE") {
			cut = i;
			break;
		}
	}
	const arrays: Message[][] = cut >= 0 ? [[["INVALIDATE"]]] : [];
	const rest = msgs.slice(cut + 1);
	if (rest.length > 0) arrays.push([...rest]);
	return arrays;
}

export function nodeDown<T>(self: NodeRuntimeHost<T>, msgs: Wave): void {
	if (self._released) return;
	validateDownPayloads(msgs);
	for (const m of msgs) {
		if (m[0] === "DATA") assertNodeVersionDataCompatible(self._version.policy, m[1]);
	}
	// Terminal-is-forever (R-terminals): once COMPLETE/ERROR has been emitted the node's output
	// is final; later output is dropped.
	if (self._value.terminal !== undefined) return;
	const arrays = prepareArrays(msgs);
	if (arrays.length === 0) return;
	// R-wave: a running function's arrays reach its subscribers after it returned.
	if (self._wave.insideRunWave) {
		self._wave.runOutput.push(...arrays);
		return;
	}
	// O3 / R-request-order: a batch body delivers nothing; its writes commit as one array per
	// node. A terminal already staged must stay last.
	if (currentBatch(self._core)) {
		const staged = stagedBatchWave(self._core, self as unknown as Node<unknown>);
		if (staged?.some((m) => isTerminal(m[0])))
			throw new Error("down: a terminal must be the last message of its array (R-wave)");
		const add = arrays
			.flat()
			.map((m) =>
				m[0] === "DATA"
					? (["DATA", snapshotNodeVersionData(self._version.policy, m[1])] as Message)
					: m,
			);
		deferToBatch(self._core, self as unknown as Node<unknown>, [...(staged ?? []), ...add]);
		return;
	}
	nodePublish(self, arrays);
}

/**
 * Apply arrays to what this node holds (value, last array, terminal, invalidation) and send what
 * remains: the kernel marks the cone pending first, through the dependent channel, then each
 * subscriber receives every array in order before the next subscriber (R-wave).
 */
export function nodePublish<T>(self: NodeRuntimeHost<T>, arrays: readonly Message[][]): void {
	if (self._released) return;
	const out: Message[][] = [];
	for (const array of arrays) {
		if (self._value.terminal !== undefined) break; // nothing after a terminal
		const kept: Message[] = [];
		const values: T[] = [];
		for (const m of array) {
			if (m[0] === "DATA") {
				const v = m[1] as T;
				self._version.value = advanceNodeVersion(self._version.value, self._version.policy, v);
				self._value.cache = v;
				self._value.hasData = true;
				values.push(v);
				kept.push(m);
				continue;
			}
			if (m[0] === "RESOLVED") {
				kept.push(m);
				continue;
			}
			if (m[0] === "INVALIDATE") {
				// R-invalidation: effective only while a value is retained.
				if (!self._value.hasData) continue;
				self._value.cache = SENTINEL;
				self._value.hasData = false;
				self._value.lastArray = [];
				kept.push(m);
				continue;
			}
			if (m[0] === "COMPLETE") {
				self._value.terminal = true;
				kept.push(m);
				continue;
			}
			if (m[0] === "ERROR") {
				self._value.terminal = m[1];
				kept.push(m);
			}
		}
		// R-subscription: an array with values replaces the retained ones.
		if (values.length > 0) self._value.lastArray = values;
		if (kept.length > 0) out.push(kept);
	}
	if (out.length === 0) return;
	if (!self._wave.emittedDirtyThisWave) {
		// A node publishing without having been marked (a source, a later output, a first run)
		// marks its own cone first, so a fan-in below waits for every input of the wave.
		self._wave.emittedDirtyThisWave = true;
		nodeMarkDependents(self);
	}
	self._wave.emittedSettleThisWave = true;
	const ending =
		self._value.terminal !== undefined && out.some((a) => a.some((m) => isTerminal(m[0])));
	nodeDeliver(self, out);
	if (!self._wave.insideRunWave) self._wave.emittedDirtyThisWave = false;
	// R-terminals / R-lifetime: an ended node closes its lifetime after its terminal's fanout.
	if (ending) nodeCloseEndedLifetime(self);
}

/**
 * R-lifetime: closing the lifetime of a node that has ended releases its dependencies, runs its
 * cleanup, which may still read the private state, and then drops the private state. The node
 * keeps its values, terminal and subscribers, and its function never runs again.
 */
export function nodeCloseEndedLifetime<T>(self: NodeRuntimeHost<T>): void {
	nodeCloseLifetime(self);
	self._resetDepState();
}

/** R-wave: the kernel's pending mark, sent ahead of the values to dependents only. */
export function nodeMarkDependents<T>(self: NodeRuntimeHost<T>): void {
	if (self._released) return;
	for (const sub of [...self._lifecycle.subscribers]) {
		if (sub.kind === "dependent") sub.fn(["PENDING"]);
	}
}

function nodeDeliver<T>(self: NodeRuntimeHost<T>, out: readonly Message[][]): void {
	// The subscriber list as it was when publication began (a copy guards against changes).
	for (const sub of [...self._lifecycle.subscribers]) {
		if (self._released) return;
		if (sub.kind === "sink") {
			for (const array of out) nodeCallSink(self, sub, [["PENDING"], ...array]);
			continue;
		}
		// One delivery: each array is an input array of its own, and the dependent settles once,
		// after the last of them.
		for (let a = 0; a < out.length; a++) {
			const array = out[a] as Message[];
			const wave = {};
			const lastArray = a === out.length - 1;
			for (let i = 0; i < array.length; i++)
				sub.fn(array[i] as Message, { wave, last: lastArray && i === array.length - 1 });
		}
	}
}

/**
 * R-failure: a sink that throws has no node to end. Its failure goes to the graph's host reporter
 * as { source, error } and the fanout goes on; with no reporter nothing is kept, and a reporter
 * that throws is ignored.
 */
export function nodeCallSink<T>(
	self: NodeRuntimeHost<T>,
	sub: Subscriber & { kind: "sink" },
	array: Wave,
): void {
	const sink: Sink = sub.fn;
	try {
		sink(array);
	} catch (error) {
		reportFailure(self._core, `sink of ${self._slot.name ?? "node"}`, error);
	}
}

export function nodeMarkBatchedWave<T>(self: NodeRuntimeHost<T>, wave: Wave): void {
	// O3: a batch commit is one wave: every staged node marks its cone before any delivers.
	if (self._released || self._value.terminal !== undefined) return;
	if (!wave.some(isMarking) || self._wave.emittedDirtyThisWave) return;
	self._wave.emittedDirtyThisWave = true;
	nodeMarkDependents(self);
}

/** R-request-order: compute the function writes a batch staged (set(fn)), in staged order. */
export function nodeResolveBatchedWave<T>(self: NodeRuntimeHost<T>, wave: Wave): Wave {
	let current: unknown = self._value.hasData ? self._value.cache : undefined;
	const out: Message[] = [];
	for (const m of wave) {
		if (m[0] === "INVALIDATE") current = undefined;
		if (m[0] !== "DATA") {
			out.push(m);
			continue;
		}
		if (!(m[1] instanceof DeferredWrite)) {
			current = m[1];
			out.push(m);
			continue;
		}
		const next = m[1].fn(current);
		if (Object.is(next, current)) continue;
		current = next;
		out.push(["DATA", next]);
	}
	return out;
}

export function nodeCommitBatchedWave<T>(self: NodeRuntimeHost<T>, wave: Wave): void {
	self._down(wave); // batch is inactive at commit -> publishes normally
}

export function nodeDeferBoundary<T>(
	self: NodeRuntimeHost<T>,
	fn: () => void,
	batchToken?: object,
): void {
	deferRequest(self._core, fn, { batchToken });
}
