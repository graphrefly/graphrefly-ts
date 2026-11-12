import { currentBatch, DeferredWrite, stageToBatch } from "../batch/batch.js";
import { deferRequest, reportFailure } from "../batch/boundary.js";
import type { Sink } from "../ctx/types.js";
import type { Message, Wave } from "../protocol/messages.js";
import { isTerminal, SENTINEL } from "../protocol/messages.js";
import type { Subscriber } from "./core.js";
import type { Node } from "./node.js";
import { nodeCloseLifetime } from "./node-lifecycle-runtime.js";
import type { NodeRuntimeHost } from "./node-runtime-host.js";
import { validateDownPayloads } from "./protocol-guards.js";

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
		for (const array of arrays)
			stageToBatch(self._core, self as unknown as Node<unknown>, array, "down");
		return;
	}
	nodePublish(self, arrays);
}

/**
 * graphrefly-ts Q15: wave delivery and pending marking run on explicit work stacks, not JS
 * recursion, so a chain of any depth works. The order is the recursive order: a dependent that
 * settles on the last message of a delivery publishes as a frame on top of the stack, the loop
 * delivers that frame to its end (and everything it causes) before it goes on with the delivery
 * below it, and a frame's post-delivery work runs when the frame is done. A publication that is
 * not that tail call (a source write, a first run, a run inside a function) runs its own loop
 * over the frames it pushes, so it is finished when it returns, as before.
 */
const NOT_TAIL = 0;
/** Set by the delivery loop just before it hands a dependent a message. */
export const TAIL_DELIVERY = 1;
/** Set by the marking loop just before it hands a dependent its PENDING. */
export const TAIL_MARK = 2;
let tailCall = NOT_TAIL;

/**
 * Q15: whether this call into a dependent came straight from a delivery or marking loop. Read
 * once, on entry to the dependent's input, so nothing that input runs sees it.
 */
export function takeTailCall(): number {
	const t = tailCall;
	tailCall = NOT_TAIL;
	return t;
}

/** What a settling caller still does after its publication's fanout (Q15). */
export type SettleTail = (self: NodeRuntimeHost<unknown>, rest: Message[][] | undefined) => void;

/** One publication being delivered: the recursive delivery loop's state, kept on the heap. */
interface Delivery {
	readonly self: NodeRuntimeHost<unknown>;
	readonly out: readonly Message[][];
	readonly subs: Subscriber[];
	readonly ending: boolean;
	/** Next subscriber, and the next array and message for a dependent. */
	si: number;
	ai: number;
	mi: number;
	wave: object;
	readonly after: SettleTail | undefined;
	readonly rest: Message[][] | undefined;
}

const deliveries: Delivery[] = [];
const NO_WAVE: object = Object.freeze({});

/**
 * Apply arrays to what this node holds (value, last array, terminal, invalidation) and send what
 * remains: the kernel marks the cone pending first, through the dependent channel, then each
 * subscriber receives every array in order before the next subscriber (R-wave).
 */
export function nodePublish<T>(self: NodeRuntimeHost<T>, arrays: readonly Message[][]): void {
	const d = nodeBeginPublish(self, arrays, undefined, undefined);
	if (d === null) return;
	const base = deliveries.length;
	deliveries.push(d);
	driveDeliveries(base);
}

/**
 * Q15: a publication in tail position of the delivery loop (a dependent settling on a delivery's
 * last message). Its fanout, then `after`, run as a frame of the loop that is already running.
 * Returns false when nothing goes out; the caller then does its own tail at once.
 */
export function nodePublishTail<T>(
	self: NodeRuntimeHost<T>,
	arrays: readonly Message[][],
	after: SettleTail,
	rest: Message[][] | undefined,
): boolean {
	const d = nodeBeginPublish(self, arrays, after, rest);
	if (d === null) return false;
	deliveries.push(d);
	return true;
}

/** Everything a publication does before its fanout; null when nothing goes out. */
function nodeBeginPublish<T>(
	self: NodeRuntimeHost<T>,
	arrays: readonly Message[][],
	after: SettleTail | undefined,
	rest: Message[][] | undefined,
): Delivery | null {
	if (self._released) return null;
	const out: Message[][] = [];
	for (const array of arrays) {
		if (self._value.terminal !== undefined) break; // nothing after a terminal
		const kept: Message[] = [];
		const values: T[] = [];
		for (const m of array) {
			if (m[0] === "DATA") {
				const v = m[1] as T;
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
	if (out.length === 0) return null;
	if (!self._wave.emittedDirtyThisWave) {
		// A node publishing without having been marked (a source, a later output, a first run)
		// marks its own cone first, so a fan-in below waits for every input of the wave.
		self._wave.emittedDirtyThisWave = true;
		nodeMarkDependents(self);
	}
	self._wave.emittedSettleThisWave = true;
	const ending =
		self._value.terminal !== undefined && out.some((a) => a.some((m) => isTerminal(m[0])));
	return {
		self: self as NodeRuntimeHost<unknown>,
		out,
		// The subscriber list as it was when publication began (a copy guards against changes).
		subs: [...self._lifecycle.subscribers],
		ending,
		si: 0,
		ai: 0,
		mi: 0,
		wave: NO_WAVE,
		after,
		rest,
	};
}

/** Q15: run the frames above `base` to their end, each frame's tail after all it caused. */
function driveDeliveries(base: number): void {
	try {
		while (deliveries.length > base) {
			const d = deliveries[deliveries.length - 1] as Delivery;
			if (nodeDeliverStep(d)) continue;
			deliveries.pop();
			nodeFinishPublish(d);
		}
	} catch (error) {
		// A throw leaves every frame above `base` unfinished, as it left the recursive calls.
		deliveries.length = base;
		tailCall = NOT_TAIL;
		throw error;
	}
}

/** After a publication's fanout: its own tail, then its settling caller's. */
function nodeFinishPublish(d: Delivery): void {
	const self = d.self;
	if (!self._wave.insideRunWave) self._wave.emittedDirtyThisWave = false;
	// R-terminals / R-lifetime: an ended node closes its lifetime after its terminal's fanout.
	if (d.ending) nodeCloseEndedLifetime(self);
	if (d.after !== undefined) d.after(self, d.rest);
}

/**
 * One step of a delivery: every sink up to the next dependent message, then that message. Returns
 * false once every subscriber has had it (or the node was released).
 */
function nodeDeliverStep(d: Delivery): boolean {
	const self = d.self;
	const out = d.out;
	for (;;) {
		if (d.si >= d.subs.length) return false;
		const sub = d.subs[d.si] as Subscriber;
		if (d.ai === 0 && d.mi === 0) {
			if (self._released) return false;
			if (sub.kind === "sink") {
				for (const array of out) nodeCallSink(self, sub, [["PENDING"], ...array]);
				d.si++;
				continue;
			}
			d.wave = {};
		}
		// One delivery: each array is an input array of its own, and the dependent settles once,
		// after the last of them.
		const array = out[d.ai] as Message[];
		const i = d.mi;
		const lastArray = d.ai === out.length - 1;
		const wave = d.wave;
		const last = lastArray && i === array.length - 1;
		if (i + 1 < array.length) d.mi = i + 1;
		else if (lastArray) {
			d.mi = 0;
			d.ai = 0;
			d.si++;
		} else {
			d.mi = 0;
			d.ai++;
			d.wave = {};
		}
		tailCall = TAIL_DELIVERY;
		(sub as Subscriber & { kind: "dependent" }).fn(array[i] as Message, { wave, last });
		tailCall = NOT_TAIL;
		return true;
	}
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

/** One node's pending mark being sent: the recursive marking loop's state (Q15). */
interface Marking {
	readonly subs: Subscriber[];
	i: number;
}

const markings: Marking[] = [];

/**
 * R-wave: the kernel's pending mark, sent ahead of the values to dependents only. Q15: `tail` is a
 * dependent marking its own cone straight from the marking loop; its mark becomes a frame of that
 * loop, sent to its end before the loop goes on, as the recursive call was.
 */
export function nodeMarkDependents<T>(self: NodeRuntimeHost<T>, tail = false): void {
	if (self._released) return;
	const m: Marking = { subs: [...self._lifecycle.subscribers], i: 0 };
	if (tail) {
		markings.push(m);
		return;
	}
	const base = markings.length;
	markings.push(m);
	try {
		while (markings.length > base) {
			const top = markings[markings.length - 1] as Marking;
			if (top.i >= top.subs.length) {
				markings.pop();
				continue;
			}
			const sub = top.subs[top.i++] as Subscriber;
			if (sub.kind !== "dependent") continue;
			tailCall = TAIL_MARK;
			sub.fn(["PENDING"]);
			tailCall = NOT_TAIL;
		}
	} catch (error) {
		markings.length = base;
		tailCall = NOT_TAIL;
		throw error;
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
