/**
 * B49 TypeScript probe.
 *
 * Informational, not a CI gate. It measures the TS-local costs B49/D76 calls out before
 * considering any no-double-bookkeeping propagation/frontier rewrite.
 *
 * Run from repo root:
 *   pnpm run probe:b49:ts
 */

import { performance } from "node:perf_hooks";
import {
	batch,
	depLatest,
	graph,
	type Message,
	type Node,
	type NodeFn,
	node,
	type StateNode,
} from "../index.js";

interface ProbeResult {
	name: string;
	repeats: number;
	medianMs: number;
	minMs: number;
	maxMs: number;
	notes: string;
}

interface ProbeOpts {
	repeats?: number;
	warmups?: number;
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

function expectEqual(label: string, actual: number, expected: number): string {
	if (actual !== expected) {
		throw new Error(`${label}: expected ${expected}, got ${actual}`);
	}
	return `${label}=${actual}/${expected}`;
}

function median(xs: number[]): number {
	const sorted = [...xs].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function measure(name: string, run: () => string, opts: ProbeOpts = {}): ProbeResult {
	const repeats = opts.repeats ?? 5;
	const warmups = opts.warmups ?? 1;
	for (let i = 0; i < warmups; i++) run();
	const times: number[] = [];
	let notes = "";
	for (let i = 0; i < repeats; i++) {
		const t0 = performance.now();
		notes = run();
		times.push(performance.now() - t0);
	}
	return {
		name,
		repeats,
		medianMs: median(times),
		minMs: Math.min(...times),
		maxMs: Math.max(...times),
		notes,
	};
}

function subscribeCounts(n: Node<unknown>): {
	dataCount: () => number;
	invalidateCount: () => number;
	unsubscribe: () => void;
} {
	let dataCount = 0;
	let invalidateCount = 0;
	const unsubscribe = n.subscribe((m: Message) => {
		if (m[0] === "DATA") dataCount++;
		if (m[0] === "INVALIDATE") invalidateCount++;
	});
	return { dataCount: () => dataCount, invalidateCount: () => invalidateCount, unsubscribe };
}

function fanoutProbe(fanout = 512, waves = 2_000): string {
	const g = graph();
	const src = g.state(0);
	const sinks = Array.from({ length: fanout }, () => {
		const d = g.derived([src], (v) => (v as number) + 1);
		return subscribeCounts(d);
	});
	for (const s of sinks) s.dataCount(); // force activation before measurement assertions.
	for (let i = 1; i <= waves; i++) src.set(i);
	const delivered = sinks.reduce((sum, s) => sum + s.dataCount(), 0);
	const expected = fanout * (waves + 1); // includes activation push from initial state.
	for (const s of sinks) s.unsubscribe();
	return `fanout=${fanout}, waves=${waves}, ${expectEqual("DATA deliveries", delivered, expected)}`;
}

function invalidateSetOnlyProbe(fanout = 256, waves = 2_000): string {
	const { src, sinks } = makeInvalidateTopology(fanout);
	for (let i = 1; i <= waves; i++) src.set(i);
	const delivered = sinks.reduce((sum, s) => sum + s.dataCount(), 0);
	const expected = fanout * (waves + 1);
	for (const s of sinks) s.unsubscribe();
	return `fanout=${fanout}, set waves=${waves}, ${expectEqual("DATA deliveries", delivered, expected)}`;
}

function invalidateSetPlusInvalidateProbe(fanout = 256, waves = 2_000): string {
	const { src, sinks } = makeInvalidateTopology(fanout);
	let invalidates = 0;
	const invalidateSink = src.subscribe((m) => {
		if (m[0] === "INVALIDATE") invalidates++;
	});
	for (let i = 1; i <= waves; i++) {
		src.set(i);
		src.up([["INVALIDATE"]]);
	}
	const delivered = sinks.reduce((sum, s) => sum + s.dataCount(), 0);
	const sinkInvalidates = sinks.reduce((sum, s) => sum + s.invalidateCount(), 0);
	const expectedData = fanout * (waves + 1);
	const expectedSinkInvalidates = fanout * waves;
	for (const s of sinks) s.unsubscribe();
	invalidateSink();
	return [
		`fanout=${fanout}`,
		`set+invalidate waves=${waves}`,
		expectEqual("DATA deliveries", delivered, expectedData),
		expectEqual("source INVALIDATE", invalidates, waves),
		expectEqual("sink INVALIDATE", sinkInvalidates, expectedSinkInvalidates),
	].join(", ");
}

function makeInvalidateTopology(fanout: number): {
	src: StateNode<number>;
	sinks: Array<{
		dataCount: () => number;
		invalidateCount: () => number;
		unsubscribe: () => void;
	}>;
} {
	const g = graph();
	const src = g.state(0);
	const sinks = Array.from({ length: fanout }, () => {
		const d = g.derived([src], (v) => v as number);
		return subscribeCounts(d);
	});
	return { src, sinks };
}

function diamondProbe(legs = 128, waves = 2_000): string {
	const g = graph();
	const src = g.state(0);
	const mids = Array.from({ length: legs }, (_, i) => g.derived([src], (v) => (v as number) + i));
	const join = g.derived(mids, (...vals) => vals.reduce((sum, v) => sum + (v as number), 0));
	const sink = subscribeCounts(join);
	for (let i = 1; i <= waves; i++) src.set(i);
	const expected = waves + 1;
	const delivered = sink.dataCount();
	sink.unsubscribe();
	return `legs=${legs}, waves=${waves}, ${expectEqual("join DATA deliveries", delivered, expected)}`;
}

function rewireChurnProbe(turns = 10_000): string {
	const g = graph();
	const a = g.state(1);
	const b = g.state(2);
	const body: NodeFn = (ctx) => {
		ctx.down([["DATA", (depLatest(ctx, 0) as number) + 1]]);
	};
	const d = g.node<number>([a], body);
	const sink = subscribeCounts(d);
	for (let i = 0; i < turns; i++) d.setDeps([i % 2 === 0 ? b : a], body);
	const delivered = sink.dataCount();
	const expected = turns + 1;
	sink.unsubscribe();
	return `turns=${turns}, ${expectEqual("DATA deliveries", delivered, expected)}`;
}

function boundaryFifoProbe(tasks = 20_000): string {
	const g = graph();
	const owner = g.state(0);
	let ran = 0;
	batch(() => {
		for (let i = 0; i < tasks; i++) owner.__deferBoundary(() => ran++);
	});
	return `tasks=${tasks}, ${expectEqual("drained", ran, tasks)}`;
}

function retainedLifecycleProbe(nodes = 2_500, payloadBytes = 4_096): string {
	let cleanupBytes = 0;
	for (let i = 0; i < nodes; i++) {
		const src = node<number>([], null, { initial: i });
		const payload = new Uint8Array(payloadBytes);
		const d = node<number>([src], (ctx) => {
			ctx.onDeactivation(() => {
				cleanupBytes += payload.byteLength;
			});
			ctx.down([["DATA", depLatest(ctx, 0)]]);
		});
		const unsubscribe = d.subscribe(() => {});
		unsubscribe();
	}
	const expectedBytes = nodes * payloadBytes;
	return `nodes=${nodes}, payload=${payloadBytes} bytes, ${expectEqual("cleanup bytes", cleanupBytes, expectedBytes)}`;
}

const probes: Array<[string, () => string, ProbeOpts?]> = [
	["boundary FIFO queue", () => boundaryFifoProbe(), { repeats: 7, warmups: 2 }],
	["fanout DATA push", () => fanoutProbe(), { repeats: 5, warmups: 1 }],
	["INVALIDATE set-only baseline", () => invalidateSetOnlyProbe(), { repeats: 5, warmups: 1 }],
	[
		"INVALIDATE set+invalidate",
		() => invalidateSetPlusInvalidateProbe(),
		{ repeats: 5, warmups: 1 },
	],
	["diamond pending join", () => diamondProbe(), { repeats: 5, warmups: 1 }],
	["rewire churn", () => rewireChurnProbe(), { repeats: 5, warmups: 1 }],
	["active lifecycle retained cleanup", () => retainedLifecycleProbe(), { repeats: 5, warmups: 1 }],
];

const results = probes.map(([name, run, opts]) => measure(name, run, opts));

console.log("B49 TypeScript probe (informational, not a CI gate)");
console.log(`node=${process.version}`);
for (const r of results) {
	console.log(
		`${r.name}: median=${fmt(r.medianMs)} ms, min=${fmt(r.minMs)} ms, max=${fmt(r.maxMs)} ms, repeats=${r.repeats}; ${r.notes}`,
	);
}
