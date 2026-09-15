/** Independent failures against real owned host/authority graph, with fake resource only. */
import { expect, it, vi } from "vitest";
import {
	composeOfflineSpending,
	OfflineAlertResource,
} from "../../../../examples/spending-alerts/causal-focused-host.js";
import {
	drain,
	inputsFor,
	runHost,
} from "../../../../scripts/fixtures/spending-focused-host-harness.js";
import {
	evaluationFixture,
	evaluationPack,
	policyFacts,
	presetBinding,
} from "../../../../scripts/fixtures/spending-preset-harness.js";
import {
	oracleCanonical,
	oracleHash,
} from "../../../../scripts/fixtures/spending-preset-oracle.js";
import { batch } from "../batch/batch.js";
import type { NodeFn } from "../ctx/types.js";
import { Dispatcher, type Handle } from "../dispatcher/index.js";
import { ColdConstructionError, ConstructionScope } from "../graph/construction-scope.js";
import { Graph } from "../graph/graph.js";

for (const changed of ["lower-watermark", "different-policy", "higher-watermark"] as const) {
	it(`final currentness checks ${changed} after admission before execution`, async () => {
		const run = runHost();
		const lock = Symbol("hold-final-guard");
		try {
			await drain();
			run.host.guard.up([["PAUSE", lock]]);
			const e = evaluationFixture();
			run.drive([e]);
			expect([...run.state().effects.values()][0].admission?.state).toBe("admitted");
			expect(run.calls).toHaveLength(0);
			const original = policyFacts(e).current;
			run.send("current", {
				...original,
				current: original.current.map((f) => ({
					...f,
					...(changed === "different-policy"
						? { policyRef: { ...f.policyRef, id: "other-policy-same-digest" } }
						: { watermark: e.occurrence.revision + (changed === "higher-watermark" ? 1 : -1) }),
				})),
			});
			run.host.guard.up([["RESUME", lock]]);
			await drain();
			if (changed === "higher-watermark") {
				expect(run.calls).toHaveLength(1);
				run.pending.resolve({ bytesWritten: Buffer.byteLength(run.calls[0]) });
				await drain();
				expect([...run.state().effects.values()][0].outcome?.state).toBe("succeeded");
			} else {
				expect(run.calls).toHaveLength(0);
				const record = [...run.state().effects.values()][0];
				expect(record.outcome).toMatchObject({
					...record.proposal,
					admissionRef: record.admission!.admissionRef,
					state: "cancelled",
					result: { kind: "error", error: { code: "spending-host/final-guard" } },
				});
			}
		} finally {
			run.teardown();
		}
	});
}
it("scheduler failure before write retains known no-submit without executing", async () => {
	const run = runHost();
	try {
		await drain();
		const scheduler = vi.spyOn(globalThis, "queueMicrotask").mockImplementation(() => {
			throw new Error("schedule unavailable");
		});
		try {
			run.drive([evaluationFixture()]);
		} finally {
			scheduler.mockRestore();
		}
		expect(run.calls).toHaveLength(0);
		expect(run.host.inspect()).toMatchObject({
			fault: "schedule-failed",
			inFlight: 0,
			writes: 0,
			normalEndReady: false,
		});
		expect(run.host.inspect().records[0].outcome?.state).toBe("cancelled");
		await drain();
		expect([...run.state().effects.values()][0].outcome).toBeUndefined();
		expect(run.host.inspect().records).toHaveLength(1);
	} finally {
		run.teardown();
	}
});
it("stale aborted resource lease cannot write, transfer, or clear newer owner", async () => {
	const calls: string[] = [];
	const resource = new OfflineAlertResource(presetBinding, async (payload) => {
		calls.push(payload);
		return { bytesWritten: Buffer.byteLength(payload) };
	});
	const stale = resource.claim();
	stale.abort();
	const owner = resource.claim();
	expect(() => stale.write("stale")).toThrow();
	expect(() => stale.transfer()).toThrow();
	stale.abort();
	expect(() => resource.claim()).toThrow("already claimed");
	owner.transfer();
	await owner.write("exact");
	owner.abort();
	expect(() => resource.claim()).toThrow("already claimed");
	expect(calls).toEqual(["exact"]);
});
it("removing a real guard dependency faults without positional fallback", async () => {
	const spy = vi.spyOn(ConstructionScope.prototype, "node");
	const run = runHost();
	const fn = spy.mock.calls.find((call) => call[2]?.name === "spending/hostGuard")?.[1];
	spy.mockRestore();
	try {
		await drain();
		expect(fn).toBeTypeOf("function");
		const lock = Symbol("hold-guard");
		run.host.guard.up([["PAUSE", lock]]);
		run.drive([evaluationFixture()]);
		run.host.guard.unsubscribeDep(run.host.guard.deps[2], fn as NodeFn);
		run.host.guard.up([["RESUME", lock]]);
		await drain();
		expect(run.calls).toHaveLength(0);
		expect(run.host.inspect().fault).toBe("guard-dependency-mismatch");
		expect([...run.state().effects.values()][0].outcome).toBeUndefined();
	} finally {
		run.teardown();
	}
});
it("real source delivery throw preserves completed record and faults owner", async () => {
	const run = runHost();
	let stop: (() => void) | undefined;
	try {
		await drain();
		run.drive([evaluationFixture()]);
		await drain();
		let armed = false;
		stop = run.host.source.subscribe((m) => {
			if (armed && m[0] === "DATA") throw new Error("delivery observer fault");
		});
		armed = true;
		run.pending.resolve({ bytesWritten: Buffer.byteLength(run.calls[0]) });
		await drain();
		expect(run.host.inspect().fault).toBe("delivery-failed");
		expect(run.host.inspect().records[0].outcome?.state).toBe("succeeded");
		expect(run.host.inspect().normalEndReady).toBe(false);
		stop();
		stop = undefined;
		run.drive([evaluationFixture(1)]);
		await drain();
		expect(run.calls).toHaveLength(1);
		expect(run.host.inspect().records).toHaveLength(1);
	} finally {
		stop?.();
		run.teardown();
	}
});
it("64-request burst retains bounded outcomes but reports pending overload and cannot end", async () => {
	const run = runHost();
	try {
		await drain();
		const evaluations = Array.from({ length: 64 }, (_, i) => {
			const { occurrence, ...value } = evaluationFixture(i);
			const { digest: _digest, ...ref } = occurrence;
			const identity = { ...ref, revision: 1, revisionDomain: `independent-${i}` };
			return {
				...value,
				occurrence: {
					...identity,
					digest: oracleHash(
						oracleCanonical({
							schemaRevision: "graphrefly/causal-occurrence-contract/v1@contract-v2",
							...identity,
							value,
						}),
					),
				},
			};
		});
		run.drive(evaluations);
		await drain();
		expect(run.calls).toHaveLength(1);
		expect(run.host.inspect().records).toHaveLength(64);
		expect(
			[...run.state().effects.values()].filter((r) => r.outcome?.state === "cancelled"),
		).toHaveLength(63);
		run.pending.resolve({ bytesWritten: Buffer.byteLength(run.calls[0]) });
		await drain();
		expect(
			[...run.state().effects.values()].filter((r) => r.outcome?.state === "succeeded"),
		).toHaveLength(1);
		const issues: unknown[] = [];
		const stopIssues = run.host.consume.view.issues.subscribe((m) => {
			if (m[0] === "DATA") issues.push(m[1]);
		});
		expect(issues).toContainEqual(
			expect.objectContaining({ code: "causal-occurrence/terminal-pending-bound" }),
		);
		run.send("local", { ...policyFacts(evaluations[0]).local, stop: true });
		await drain();
		expect(run.host.inspect().normalEndReady).toBe(false);
		run.drive([evaluationFixture(64)]);
		await drain();
		stopIssues();
		expect(issues).toContainEqual(expect.objectContaining({ code: "spending/pack-conflict" }));
		expect(run.calls).toHaveLength(1);
		expect(run.host.inspect().records).toHaveLength(64);
		expect(run.host.inspect().fault).toBeUndefined();
		expect(
			[...run.state().effects.values()].some(
				(r) => r.proposal.occurrence.occurrenceId === evaluationFixture(64).occurrence.occurrenceId,
			),
		).toBe(false);
	} finally {
		run.teardown();
	}
});
it("unarrived normal pack frontier blocks normal end after earlier successful effect", async () => {
	const run = runHost();
	try {
		await drain();
		const first = evaluationFixture();
		const future = evaluationFixture(0, "tea", 2, false);
		run.send("pack", evaluationPack([first, future]));
		const facts = policyFacts(first);
		batch(() => {
			run.send("current", facts.current);
			run.send("verification", facts.verification);
			run.send("local", facts.local);
			run.send("arrivals", {
				packRef: presetBinding.packRef,
				evaluationRefs: [first.evaluationRef],
			});
		});
		expect(run.calls).toHaveLength(1);
		run.pending.resolve({ bytesWritten: Buffer.byteLength(run.calls[0]) });
		await drain();
		run.send("local", { ...facts.local, stop: true });
		await drain();
		expect([...run.state().effects.values()][0].outcome?.state).toBe("succeeded");
		expect(run.host.inspect().normalEndReady).toBe(false);
	} finally {
		run.teardown();
	}
});
for (const target of ["hostGuard", "runEndReady"] as const) {
	it(`late dispatcher acquisition at ${target} preserves failure and aborts owned nodes`, () => {
		let allocating = "";
		const failure = new Error(`cannot register spending/${target}`);
		class FailingDispatcher extends Dispatcher {
			readonly live = new Set<Handle>();
			override register(...args: Parameters<Dispatcher["register"]>): Handle {
				if (allocating === `spending/${target}`) throw failure;
				const handle = super.register(...args);
				this.live.add(handle);
				return handle;
			}
			override unregister(handle: Handle): void {
				super.unregister(handle);
				this.live.delete(handle);
			}
		}
		const dispatcher = new FailingDispatcher();
		const graph = new Graph({ dispatcher });
		const { inputs } = inputsFor(graph);
		const before = graph.describe();
		const original = ConstructionScope.prototype.node;
		const spy = vi
			.spyOn(ConstructionScope.prototype, "node")
			.mockImplementation(function (deps, fn, options) {
				allocating = options?.name ?? "";
				try {
					return original.call(this, deps, fn, options);
				} finally {
					allocating = "";
				}
			});
		let caught: unknown;
		try {
			composeOfflineSpending(
				graph,
				inputs,
				presetBinding,
				new OfflineAlertResource(presetBinding, async () => ({ bytesWritten: 0 })),
				{ name: "spending" },
			);
		} catch (error) {
			caught = error;
		} finally {
			spy.mockRestore();
		}
		expect(caught).toBeInstanceOf(ColdConstructionError);
		expect((caught as ColdConstructionError).originalCause).toBe(failure);
		expect((caught as ColdConstructionError).cleanupErrors).toEqual([]);
		expect((caught as Error).message).toContain(`cannot register spending/${target}`);
		expect(graph.describe()).toEqual(before);
		expect(dispatcher.live.size).toBe(0);
	});
}
it("64 sequential writes within original pending bound retain lifetime records and end normally", async () => {
	const run = runHost("off", async (payload) => ({ bytesWritten: Buffer.byteLength(payload) }));
	try {
		await drain();
		const evaluations = Array.from({ length: 32 }, (_, index) => [
			evaluationFixture(index, "coffee"),
			evaluationFixture(index, "tea"),
		]).flat();
		run.send("pack", evaluationPack(evaluations));
		for (const e of evaluations) {
			const facts = policyFacts(e);
			batch(() => {
				run.send("current", facts.current);
				run.send("verification", facts.verification);
				run.send("local", facts.local);
				run.send("arrivals", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] });
			});
			await drain();
		}
		expect(run.calls).toHaveLength(64);
		expect(run.host.inspect().records).toHaveLength(64);
		expect(run.host.inspect().records.every((r) => r.outcome?.state === "succeeded")).toBe(true);
		expect(run.host.inspect().fault).toBeUndefined();
		const latest = evaluations.slice(-2).map((e) => policyFacts(e));
		batch(() => {
			run.send("current", {
				...latest[0].current,
				current: latest.flatMap((f) => f.current.current),
			});
			run.send("local", {
				...latest[0].local,
				stop: true,
				grants: latest.flatMap((f) => f.local.grants),
			});
		});
		await drain();
		expect(run.host.inspect().normalEndReady).toBe(true);
	} finally {
		run.teardown();
	}
}, 20000);
