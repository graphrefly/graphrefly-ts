/** Private no-I/O probe of the approved host notification contract. Not a host adapter. */
import { expect, it } from "vitest";
import { batch } from "../batch/batch.js";
import { depBatch } from "../ctx/types.js";
import { Graph } from "../graph/graph.js";

type Receipt = Readonly<{ id: number; result: "cancelled" | "succeeded" }>;
function fixture(capacity = 64, enqueue: (callback: () => void) => void = queueMicrotask) {
	const graph = new Graph();
	const input = graph.node<number>([], null, { name: "request-input" });
	const source = graph.node<readonly Receipt[]>([], null, { name: "host-completion-source" });
	const records = new Map<number, Receipt | undefined>();
	let scheduled = false,
		delivering = false,
		faulted = false,
		revision = 0,
		notifications = 0;
	let conflicts = 0;
	const observed: (readonly Receipt[])[] = [];
	const schedule = () => {
		if (scheduled || delivering || faulted) return;
		scheduled = true;
		const deliver = () => {
			scheduled = false;
			delivering = true;
			const captured = revision;
			const snapshot = Object.freeze(
				[...records.values()].filter((r): r is Receipt => r !== undefined),
			);
			try {
				notifications++;
				source.down([["DATA", snapshot]]);
			} catch {
				faulted = true;
			} finally {
				delivering = false;
			}
			if (!faulted && revision !== captured) schedule();
		};
		try {
			enqueue(deliver);
		} catch {
			scheduled = false;
			faulted = true;
		}
	};
	const reserve = (id: number) => {
		if (faulted || records.has(id) || records.size >= capacity) return false;
		records.set(id, undefined);
		return true;
	};
	const complete = (receipt: Receipt) => {
		if (!records.has(receipt.id)) throw new Error("unreserved completion");
		const old = records.get(receipt.id);
		if (old) {
			if (old.result !== receipt.result) conflicts++;
			return;
		}
		records.set(receipt.id, Object.freeze({ ...receipt }));
		revision++;
		schedule();
	};
	const guard = graph.node(
		[input],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const id = raw as number;
				if (reserve(id)) complete({ id, result: "cancelled" });
			}
		},
		{ name: "fake-host-refusal" },
	);
	const ownerStop = guard.subscribe(() => {});
	const observerStop = source.subscribe((message) => {
		if (message[0] === "DATA") observed.push(message[1] as readonly Receipt[]);
	});
	return {
		input,
		guard,
		source,
		records,
		observed,
		reserve,
		complete,
		observerStop,
		status: () => ({ scheduled, delivering, faulted, notifications, conflicts }),
		cleanup: () => {
			ownerStop();
			observerStop();
			const group = graph.topologyGroup();
			for (const node of [guard, input, source]) group.add(node);
			group.release();
		},
	};
}

// A real microtask checkpoint; no timers or mock Graph delivery.
const checkpoint = () => new Promise<void>((resolve) => queueMicrotask(resolve));

it("delivers after nested batch commits, with one immutable complete snapshot", async () => {
	const f = fixture();
	try {
		batch(() =>
			batch(() =>
				f.input.down([
					["DATA", 1],
					["DATA", 2],
				]),
			),
		);
		expect(f.observed).toEqual([]);
		expect(f.records.size).toBe(2);
		await checkpoint();
		expect(f.observed).toEqual([
			[
				{ id: 1, result: "cancelled" },
				{ id: 2, result: "cancelled" },
			],
		]);
		expect(Object.isFrozen(f.observed[0])).toBe(true);
		expect(Object.isFrozen(f.observed[0][0])).toBe(true);
		expect(f.status().notifications).toBe(1);
	} finally {
		f.cleanup();
	}
});

it("does not create a host record or notification from rolled back input", async () => {
	const f = fixture();
	try {
		batch((ctx) => {
			f.input.down([["DATA", 1]]);
			ctx.rollback();
		});
		await checkpoint();
		expect(f.records.size).toBe(0);
		expect(f.status().notifications).toBe(0);
	} finally {
		f.cleanup();
	}
});

it("retains records across UI detachment and rejects duplicate and conflicting completion", async () => {
	const f = fixture();
	try {
		f.observerStop();
		f.input.down([["DATA", 1]]);
		await checkpoint();
		f.complete({ id: 1, result: "cancelled" });
		f.complete({ id: 1, result: "succeeded" });
		await checkpoint();
		expect(f.records.get(1)).toEqual({ id: 1, result: "cancelled" });
		expect(f.status().notifications).toBe(1);
		expect(f.status().conflicts).toBe(1);
		const reconnected: unknown[] = [];
		const stop = f.source.subscribe((message) => {
			if (message[0] === "DATA") reconnected.push(message[1]);
		});
		stop();
		expect(reconnected).toEqual([[{ id: 1, result: "cancelled" }]]);
	} finally {
		f.cleanup();
	}
});

it("coalesces new completions during delivery into one subsequent notification", async () => {
	const f = fixture();
	let once = false;
	const stop = f.source.subscribe((message) => {
		if (message[0] !== "DATA" || once) return;
		once = true;
		for (const id of [2, 3]) {
			expect(f.reserve(id)).toBe(true);
			f.complete({ id, result: "cancelled" });
		}
	});
	try {
		f.input.down([["DATA", 1]]);
		await checkpoint();
		await checkpoint();
		expect(f.status().notifications).toBe(2);
		expect(f.observed.map((frame) => frame.map((r) => r.id))).toEqual([[1], [1, 2, 3]]);
	} finally {
		stop();
		f.cleanup();
	}
});

it("reserves at most 64 records and never reuses completed capacity", async () => {
	const f = fixture();
	try {
		for (let id = 0; id < 64; id++) expect(f.reserve(id)).toBe(true);
		expect(f.reserve(64)).toBe(false);
		for (let id = 0; id < 64; id++) f.complete({ id, result: "cancelled" });
		await checkpoint();
		expect(f.records.size).toBe(64);
		expect(f.observed[0]).toHaveLength(64);
		expect(f.reserve(64)).toBe(false);
		expect(() => f.complete({ id: 64, result: "cancelled" })).toThrow("unreserved");
	} finally {
		f.cleanup();
	}
});

it("retains receipts and prevents new reservations after source delivery throws", async () => {
	const f = fixture();
	const stop = f.source.subscribe((message) => {
		if (message[0] === "DATA") throw new Error("delivery failure");
	});
	try {
		f.input.down([["DATA", 1]]);
		await checkpoint();
		expect(f.status().faulted).toBe(true);
		expect(f.records.get(1)).toEqual({ id: 1, result: "cancelled" });
		expect(f.reserve(2)).toBe(false);
		await checkpoint();
		expect(f.status().notifications).toBe(1);
	} finally {
		stop();
		f.cleanup();
	}
});

it("delivers results triggered by final RESUME without an input wrapper", async () => {
	const f = fixture();
	const lock = Symbol("pause");
	try {
		f.guard.up([["PAUSE", lock]]);
		f.input.down([["DATA", 1]]);
		await checkpoint();
		expect(f.records.size).toBe(0);
		f.guard.up([["RESUME", lock]]);
		await checkpoint();
		expect(f.observed).toEqual([[{ id: 1, result: "cancelled" }]]);
	} finally {
		f.cleanup();
	}
});

it("retains a result when scheduling fails without retrying", () => {
	const f = fixture(64, () => {
		throw new Error("scheduler unavailable");
	});
	try {
		expect(f.reserve(1)).toBe(true);
		f.complete({ id: 1, result: "cancelled" });
		expect(f.records.get(1)).toEqual({ id: 1, result: "cancelled" });
		expect(f.status()).toMatchObject({ faulted: true, scheduled: false, notifications: 0 });
		expect(f.reserve(2)).toBe(false);
	} finally {
		f.cleanup();
	}
});

it("uses the same notification path for a later fake asynchronous completion", async () => {
	const f = fixture();
	try {
		expect(f.reserve(1)).toBe(true);
		await checkpoint();
		expect(f.observed).toEqual([]);
		f.complete({ id: 1, result: "succeeded" });
		expect(f.observed).toEqual([]);
		await checkpoint();
		expect(f.observed).toEqual([[{ id: 1, result: "succeeded" }]]);
	} finally {
		f.cleanup();
	}
});
