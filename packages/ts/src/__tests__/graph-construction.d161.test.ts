import { afterEach, describe, expect, it, vi } from "vitest";
import { batch } from "../batch/batch.js";
import { deferRewire } from "../batch/boundary.js";
import { depLatest } from "../ctx/types.js";
import { Dispatcher, type Handle } from "../dispatcher/index.js";
import {
	ColdConstructionError,
	constructionOf,
	prepareConstruction,
	startConstruction,
} from "../graph/construction-scope.js";
import { Graph } from "../graph/graph.js";
import { NodeCore, type NodeId } from "../node/core.js";
import { Node } from "../node/node.js";
import { nodeRuntimeHost } from "../node/node-runtime-host.js";
import { checkpointStateOfNode, subscriberCountOfNode } from "../node/runtime-accessors.js";
import {
	assertCausalCapabilities,
	type CausalBinding,
} from "../solutions/causal-occurrence/capabilities.js";
import type {
	CausalEffectOutcome,
	CausalOccurrenceBundleOptions,
	RuntimeState,
} from "../solutions/causal-occurrence/contracts.js";
import {
	causalComposition,
	causalOccurrenceBundle,
	causalOccurrenceDigest,
} from "../solutions/causal-occurrence.js";

afterEach(() => vi.restoreAllMocks());

class CountingDispatcher extends Dispatcher {
	readonly live = new Set<Handle>();
	override register(...args: Parameters<Dispatcher["register"]>): Handle {
		const handle = super.register(...args);
		this.live.add(handle);
		return handle;
	}
	override unregister(handle: Handle): void {
		super.unregister(handle);
		this.live.delete(handle);
	}
}

function simple(name = "view") {
	const dispatcher = new CountingDispatcher();
	const graph = new Graph({ dispatcher });
	const a = graph.state(2, { name: "a" });
	const b = graph.state(3, { name: "b" });
	const scope = prepareConstruction(graph, {
		name,
		epoch: 1,
		inputs: [a, b],
		names: [`${name}/startup`, `${name}/left`, `${name}/right`, `${name}/join`],
	});
	const startup = scope.startupSource();
	const left = scope.node([a], (ctx) => ctx.down([["DATA", Number(depLatest(ctx, 0)) * 2]]), {
		name: `${name}/left`,
	});
	const right = scope.node(
		[a, b],
		(ctx) => ctx.down([["DATA", Number(depLatest(ctx, 0)) + Number(depLatest(ctx, 1))]]),
		{ name: `${name}/right` },
	);
	const join = scope.node<number>(
		[left, right],
		(ctx) => ctx.down([["DATA", Number(depLatest(ctx, 0)) + Number(depLatest(ctx, 1))]]),
		{ name: `${name}/join` },
	);
	return { graph, dispatcher, a, b, scope, startup, left, right, join };
}

function causal(graph = new Graph(), fault = false) {
	const material = {
		revisionDomain: "d",
		occurrenceId: "one",
		revision: 1,
		sourceRefs: [{ kind: "input", id: "one" }],
		value: "value",
	};
	const occurrence = { ...material, digest: causalOccurrenceDigest(material) };
	const proposal = {
		occurrence,
		effectId: "effect",
		requestRef: { kind: "request", id: "request" },
		proposalDigest: `sha256:${"b".repeat(64)}`,
	};
	const admitted = {
		...proposal,
		admissionRef: { kind: "admission", id: "admission" },
		state: "admitted" as const,
	};
	const outcomes = graph.node<CausalEffectOutcome>([], null, { name: "input/outcome" });
	const options: CausalOccurrenceBundleOptions<string> = {
		name: "causal",
		occurrences: graph.state(occurrence, { name: "input/occurrence" }),
		admissions: graph.state(
			{
				occurrence,
				decisionId: "decision",
				decisionDigest: `sha256:${"a".repeat(64)}`,
				state: "admitted" as const,
			},
			{ name: "input/admission" },
		),
		branchTerminals: graph.state(
			{
				occurrence,
				branch: "one",
				state: "completed" as const,
				result: { kind: "ok" as const, value: "done" },
			},
			{ name: "input/terminal" },
		),
		effectProposals: graph.state(proposal, { name: "input/proposal" }),
		effectAdmissions: graph.state(admitted, { name: "input/effect-admission" }),
		effectOutcomes: outcomes,
		evidence: graph.node([], null, { name: "input/evidence" }),
		watermarks: graph.producer(
			(ctx) => {
				ctx.down([["DATA", { revisionDomain: "d", revision: 1 }]]);
				if (fault) throw new Error("after admission");
			},
			{ name: "input/watermark" },
		),
		requiredBranches: ["one"],
		requiredEvidenceKinds: ["receipt"],
		maxOccurrences: 8,
		maxPending: 8,
		maxEffects: 8,
		maxEvidence: 8,
	};
	return { graph, options, occurrence, admitted, outcomes };
}
const binding: CausalBinding = {
	contract: "contract-v2",
	implementationRevision: "construction-v1",
	scope: "full",
	epoch: 1,
};

// Independent finite ownership oracle: no production phase reducer or cleanup helpers.
function expectedResources(transferred: boolean, acquired: number, released: number) {
	return {
		owned: transferred ? acquired : 0,
		coldRemaining: transferred ? 0 : acquired - released,
	};
}

describe("D161 graph construction ownership", () => {
	it("rejects real cold dependency loss on the native B1 path and releases acquired resources", () => {
		const f = causal();
		let changed = false;
		const stop = f.graph.observeTopology().subscribe((event) => {
			if (event.path !== "causal/issues") return;
			const authority = f.graph.find("causal/authority")!;
			expect(authority.status).toBe("sentinel");
			authority.replaceDeps([], null);
			changed = true;
		});
		expect(f.graph.describe).toBe(Graph.prototype.describe);
		expect(() => causalOccurrenceBundle(f.graph, f.options)).toThrow(
			/missing required edge causal\/arrivals -> causal\/authority/,
		);
		stop();
		expect(changed).toBe(true);
		expect(f.graph.find("causal/authority")).toBeUndefined();
		expect(constructionOf(f.graph, "causal")).toBeUndefined();
		expect(f.graph.describe().nodes).toHaveLength(8);
		const group = f.graph.topologyGroup();
		for (const node of f.graph.describe().nodes) group.add(f.graph.find(node.id)!);
		group.release();
	});

	it("constructs cold, transfers before running, and preserves a real fan-out/fan-in trace", () => {
		const f = simple();
		expect(subscriberCountOfNode(f.a)).toBe(0);
		expect(f.dispatcher.live.size).toBe(3);
		const original = nodeRuntimeHost(f.join)._subscribeOwned.bind(nodeRuntimeHost(f.join));
		vi.spyOn(nodeRuntimeHost(f.join), "_subscribeOwned").mockImplementation((sink, acquisition) => {
			expect(constructionOf(f.graph, "view")?.phase).toBe("starting");
			return original(sink, acquisition);
		});
		const owner = f.scope.seal(f.startup, [f.join]);
		f.scope.transferToGraph(owner);
		startConstruction(f.graph, owner);
		expect(f.startup.cache?.state).toBe("started");
		expect(f.join.cache).toBe(9);
		f.a.set(4);
		expect(f.join.cache).toBe(15);
		expect(owner.roots.filter((r) => r.unsubscribe).length).toBe(
			expectedResources(true, 2, 0).owned,
		);
		expect(() => startConstruction(f.graph, owner)).toThrow(/already started/);
		expect(() => f.scope.abort("late")).toThrow(/cannot cold-abort/);
	});

	it("preflights the entire input closure and all retired names before allocating", () => {
		const g = new Graph();
		const other = new Graph();
		const dead = g.node([], null, { name: "dead" });
		dead.down([["COMPLETE"]]);
		const child = g.node([dead], null, { name: "child" });
		for (const input of [other.state(1), new Node([], null), child])
			expect(() =>
				prepareConstruction(g, { name: "bad", epoch: 1, names: ["bad/startup"], inputs: [input] }),
			).toThrow();
		const retired = g.topologyGroup();
		retired.node([], null, { name: "retired" });
		retired.release();
		expect(() =>
			prepareConstruction(g, { name: "bad", epoch: 1, names: ["retired"], inputs: [] }),
		).toThrow(/retired/);
		expect(g.describe().nodes).toHaveLength(2);
	});

	it("rejects active batch and reactive entry before any resource acquisition", () => {
		const g = new Graph();
		const make = () =>
			prepareConstruction(g, { name: "bad", epoch: 1, names: ["bad/startup"], inputs: [] });
		expect(() => batch(make)).toThrow(/stable/);
		const source = g.producer(
			() => {
				expect(make).toThrow(/stable/);
			},
			{ name: "source" },
		);
		source.subscribe(() => {});
		expect(g.describe().nodes).toHaveLength(1);
	});

	it("cleans a failed constructor handle before a Node is returned", () => {
		const dispatcher = new CountingDispatcher();
		const g = new Graph({ dispatcher });
		const scope = prepareConstruction(g, {
			name: "cold",
			epoch: 1,
			inputs: [],
			names: ["cold/startup", "cold/bad"],
		});
		scope.startupSource();
		let caught: unknown;
		try {
			scope.node([], () => {}, {
				name: "cold/bad",
				initial: 1,
				versioning: {
					level: 1,
					hash: () => {
						throw new Error("hash allocation failure");
					},
				} as never,
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeDefined();
		expect(() => scope.abort(caught)).toThrow(ColdConstructionError);
		expect(dispatcher.live.size).toBe(expectedResources(false, 1, 1).coldRemaining);
		expect(g.describe().nodes).toHaveLength(0);
	});

	it("cleans already registered cold nodes when a later acquisition throws", () => {
		const f = simple();
		const before = f.graph.describe().nodes.length;
		expect(before).toBe(6);
		expect(() => f.scope.abort(new Error("seal failed"))).toThrow(/cleanup complete/);
		expect(f.graph.describe().nodes.map((n) => n.id)).toEqual(["a", "b"]);
		expect(f.dispatcher.live.size).toBe(0);
		expect(subscriberCountOfNode(f.a)).toBe(0);
		expect(() => f.graph.node([], null, { name: "view/join" })).toThrow(/cannot be reused/);
	});

	it("cleans a slot allocated before the constructor returns its Node", () => {
		const g = new Graph();
		const scope = prepareConstruction(g, {
			name: "slot",
			epoch: 1,
			inputs: [],
			names: ["slot/startup", "slot/bad"],
		});
		scope.startupSource();
		const original = NodeCore.prototype.createSlot;
		let allocated: { core: NodeCore; id: NodeId } | undefined;
		vi.spyOn(NodeCore.prototype, "createSlot").mockImplementation(function (slot, state) {
			const result = original.call(this, slot, state);
			allocated = { core: this, id: result.id };
			return result;
		});
		const brokenGet = vi.spyOn(NodeCore.prototype, "get").mockImplementationOnce(() => {
			throw new Error("after slot allocation");
		});
		let cause: unknown;
		try {
			scope.node([], null, { name: "slot/bad" });
		} catch (error) {
			cause = error;
		}
		brokenGet.mockRestore();
		expect(allocated).toBeDefined();
		expect(() => scope.abort(cause)).toThrow(/cleanup complete/);
		expect(() => allocated!.core.get(allocated!.id)).toThrow(/unknown node slot/);
	});

	it("reports cleanup failure and still attempts independent resources", () => {
		const f = simple();
		const original = f.dispatcher.unregister.bind(f.dispatcher);
		let calls = 0;
		vi.spyOn(f.dispatcher, "unregister").mockImplementation((handle) => {
			calls++;
			if (calls === 1) throw new Error("cleanup failed");
			original(handle);
		});
		let failure: ColdConstructionError | undefined;
		try {
			f.scope.abort("original failure");
		} catch (e) {
			failure = e as ColdConstructionError;
		}
		expect(failure?.originalCause).toBe("original failure");
		expect(failure?.cleanupErrors.length).toBeGreaterThan(0);
		expect(calls).toBe(3);
		expect(f.dispatcher.live.size).toBe(1);
	});

	it.each([
		"START",
		"DATA",
	] as const)("records the acquired root lease before throwing %s delivery", (failAt) => {
		const f = simple();
		const host = nodeRuntimeHost(f.join);
		// DATA uses a pre-existing source cache and the actual subscription implementation.
		const target = failAt === "DATA" ? f.startup : f.join;
		const targetHost = nodeRuntimeHost(target);
		const original = targetHost._subscribeOwned.bind(targetHost);
		vi.spyOn(targetHost, "_subscribeOwned").mockImplementation((sink, acquisition) =>
			original((message, delivery) => {
				if (message[0] === failAt) throw new Error("handshake");
				sink(message, delivery);
			}, acquisition),
		);
		const owner = f.scope.seal(f.startup, [f.join]);
		f.scope.transferToGraph(owner);
		startConstruction(f.graph, owner);
		expect(owner.phase).toBe("faulted");
		expect(owner.roots.find((r) => r.node === target)?.unsubscribe).toBeTypeOf("function");
		expect(subscriberCountOfNode(target)).toBe(1);
		if (failAt === "START") expect(host._lifecycle.activated).toBe(false);
	});

	it("retains failed deep dependency leases without disturbing a shared existing subscriber", () => {
		const f = simple();
		const values: unknown[] = [];
		f.a.subscribe((m) => {
			if (m[0] === "DATA") values.push(m[1]);
		});
		const original = nodeRuntimeHost(f.b)._subscribeOwned.bind(nodeRuntimeHost(f.b));
		vi.spyOn(nodeRuntimeHost(f.b), "_subscribeOwned").mockImplementation((sink, acquisition) =>
			original((m, d) => {
				if (m[0] === "START") throw new Error("deep handshake");
				sink(m, d);
			}, acquisition),
		);
		const owner = f.scope.seal(f.startup, [f.join]);
		f.scope.transferToGraph(owner);
		startConstruction(f.graph, owner);
		expect(owner.phase).toBe("faulted");
		expect(subscriberCountOfNode(f.a)).toBe(3);
		expect(subscriberCountOfNode(f.b)).toBe(1);
		expect(nodeRuntimeHost(f.right)._dep.unsubs[1]).toBeTypeOf("function");
		f.a.set(4);
		expect(values).toEqual([2, 4]);
	});

	it("does not call startup successful before exitWave drain returns", () => {
		const f = simple();
		const original = nodeRuntimeHost(f.join)._subscribeOwned.bind(nodeRuntimeHost(f.join));
		vi.spyOn(nodeRuntimeHost(f.join), "_subscribeOwned").mockImplementation((sink, acquisition) =>
			original((m, d) => {
				sink(m, d);
				if (m[0] === "START")
					deferRewire(nodeRuntimeHost(f.join)._core, () => {
						throw new Error("drain failure");
					});
			}, acquisition),
		);
		const owner = f.scope.seal(f.startup, [f.join]);
		f.scope.transferToGraph(owner);
		startConstruction(f.graph, owner);
		expect(f.join.cache).toBe(9);
		expect(f.startup.cache?.state).toBe("faulted");
	});

	it("does not rewrite a started fact when its consumer throws", () => {
		const f = simple();
		const seen: unknown[] = [];
		const owner = f.scope.seal(f.startup, [f.join]);
		f.scope.transferToGraph(owner);
		// An external observer is installed after handoff, before the native start driver.
		f.startup.subscribe((m) => {
			if (m[0] === "DATA") {
				seen.push(m[1]);
				if ((m[1] as { state: string }).state === "started") throw new Error("delivery");
			}
		});
		startConstruction(f.graph, owner);
		expect(owner.phase).toBe("started");
		expect(owner.deliveryError).toBeDefined();
		expect(seen.map((v) => (v as { state: string }).state)).toEqual(["starting", "started"]);
	});

	it("preserves admission after startup failure, UI detach and a mismatched outcome", () => {
		const f = causal(new Graph(), true);
		const full = causalComposition(f.graph).composeFull(f.options, binding);
		const authority = f.graph.find("causal/authority")!;
		const effects = () => [
			...(checkpointStateOfNode(authority).ctxState.value as RuntimeState<string>).effects.values(),
		];
		expect(full.startup.cache?.state).toBe("faulted");
		expect(effects()[0]?.admission?.state).toBe("admitted");
		const stop = full.execution.conservation.subscribe(() => {});
		stop();
		const outcome: CausalEffectOutcome = {
			...f.admitted,
			state: "failed",
			result: { kind: "error", error: { kind: "issue", code: "failed", message: "failed" } },
		};
		f.outcomes.down([["DATA", { ...outcome, admissionRef: { kind: "admission", id: "wrong" } }]]);
		expect(effects()[0]?.outcome).toBeUndefined();
		f.outcomes.down([["DATA", outcome]]);
		expect(effects()[0]?.outcome?.state).toBe("failed");
		expect(constructionOf(f.graph, "causal")?.phase).toBe("faulted");
	});

	it("keeps a protocol-terminated authority unresolved without automatic reset", () => {
		const f = causal();
		const full = causalComposition(f.graph).composeFull(f.options, binding);
		const authority = f.graph.find("causal/authority")!;
		f.outcomes.down([["ERROR", "outcome source lost"]]);
		expect(authority.status).toBe("errored");
		expect(() => full.execution.conservation.subscribe(() => {})).toThrow(/non-resubscribable/);
		expect(
			[
				...(
					checkpointStateOfNode(authority).ctxState.value as RuntimeState<string>
				).effects.values(),
			][0]?.outcome,
		).toBeUndefined();
	});

	it("returns exact narrow handles with real payload projection and rejects wrong bindings", () => {
		const f = causal();
		const setup = causalComposition(f.graph);
		const before = f.graph.describe().nodes.length;
		expect(() =>
			setup.composeFull(f.options, { ...binding, scope: "identity" } as never),
		).toThrow();
		expect(f.graph.describe().nodes.length).toBe(before);
		const full = setup.composeFull(f.options, binding);
		assertCausalCapabilities(f.graph, full, binding);
		expect(full.execution.identity).toBe(full.identity);
		expect(full.retained.execution).toBe(full.execution);
		expect(Object.keys(full.identity)).toEqual(["released", "currentness", "issues"]);
		const values: unknown[] = [];
		full.execution.causalQuiescence.subscribe((m) => {
			if (m[0] === "DATA") values.push(m[1]);
		});
		f.options.watermarks.down([["DATA", { revisionDomain: "d", revision: 2 }]]);
		expect(values.length).toBeGreaterThan(0);
		expect(values.every((v) => !("retainedEvidence" in (v as object)))).toBe(true);
		expect(() => assertCausalCapabilities(new Graph(), full, binding)).toThrow();
		expect(() => assertCausalCapabilities(f.graph, full, { ...binding, epoch: 2 })).toThrow();
		expect(() =>
			assertCausalCapabilities(f.graph, { ...full, identity: { ...full.identity } }, binding),
		).toThrow();
	});

	it("rejects a missing required lane before any instance exists", () => {
		const f = causal();
		// Malformed required input must reject before constructing an instance.
		expect(() =>
			causalOccurrenceBundle(f.graph, { ...f.options, effectProposals: undefined as never }),
		).toThrow();
		expect(constructionOf(f.graph, "causal")).toBeUndefined();
	});

	it("reports every residual handle, including an undefined thrown error", () => {
		const f = simple();
		let calls = 0;
		const original = f.dispatcher.unregister.bind(f.dispatcher);
		vi.spyOn(f.dispatcher, "unregister").mockImplementation((handle) => {
			calls++;
			if (calls <= 2) throw undefined;
			original(handle);
		});
		let failure: ColdConstructionError | undefined;
		try {
			f.scope.abort("cold failure");
		} catch (error) {
			failure = error as ColdConstructionError;
		}
		expect(failure?.cleanupErrors).toHaveLength(2);
		expect(new Set(failure?.cleanupErrors.map((e) => e.handle))).toEqual(f.dispatcher.live);
		expect(failure?.cleanupErrors.map((e) => e.resource)).toEqual([
			"view/left:handle",
			"view/right:handle",
		]);
	});

	it("retains all slot and handle cleanup failures with exact locators", () => {
		const f = simple();
		let slots = 0;
		const releaseSlot = NodeCore.prototype.releaseSlot;
		vi.spyOn(NodeCore.prototype, "releaseSlot").mockImplementation(function (id) {
			if (++slots <= 2) throw undefined;
			releaseSlot.call(this, id);
		});
		let handles = 0;
		const unregister = f.dispatcher.unregister.bind(f.dispatcher);
		vi.spyOn(f.dispatcher, "unregister").mockImplementation((handle) => {
			if (++handles <= 2) throw new Error("handle");
			unregister(handle);
		});
		let failure: ColdConstructionError | undefined;
		try {
			f.scope.abort("original");
		} catch (error) {
			failure = error as ColdConstructionError;
		}
		const failedSlots = failure!.cleanupErrors.filter((e) => e.slot !== undefined);
		expect(failedSlots).toHaveLength(2);
		for (const failed of failedSlots) expect(failed.core!.get(failed.slot!)).toBeDefined();
		expect(new Set(failure!.cleanupErrors.filter((e) => e.handle).map((e) => e.handle))).toEqual(
			f.dispatcher.live,
		);
	});

	it("reports an exact handle when registration fails after Node construction", () => {
		const dispatcher = new CountingDispatcher();
		const g = new Graph({ dispatcher });
		const scope = prepareConstruction(g, {
			name: "late",
			epoch: 1,
			inputs: [],
			names: ["late/startup", "late/root"],
		});
		scope.startupSource();
		// D167 prechecks known duplicates; exercise an actual post-acquisition race instead.
		const register = dispatcher.register.bind(dispatcher);
		vi.spyOn(dispatcher, "register").mockImplementationOnce((...args) => {
			g.state(1, { name: "late/root" });
			return register(...args);
		});
		let cause: unknown;
		try {
			scope.node([], () => {}, { name: "late/root" });
		} catch (error) {
			cause = error;
		}
		vi.spyOn(dispatcher, "unregister").mockImplementation(() => {
			throw new Error("unregister");
		});
		let failure: ColdConstructionError | undefined;
		try {
			scope.abort(cause);
		} catch (error) {
			failure = error as ColdConstructionError;
		}
		expect(failure?.cleanupErrors).toHaveLength(1);
		expect(failure?.cleanupErrors[0]?.resource).toBe("late/root:handle");
		expect(new Set(failure?.cleanupErrors.map((e) => e.handle))).toEqual(dispatcher.live);
		expect(g.find("late/root")?.cache).toBe(1);
	});

	it("D167 retains an unpublished node release exception without persisted identity diagnostics", () => {
		const dispatcher = new CountingDispatcher();
		const g = new Graph({ dispatcher });
		const scope = prepareConstruction(g, {
			name: "fallback",
			epoch: 1,
			inputs: [],
			names: ["fallback/startup", "fallback/root"],
		});
		scope.startupSource();
		const register = dispatcher.register.bind(dispatcher);
		vi.spyOn(dispatcher, "register").mockImplementationOnce((...args) => {
			g.state(1, { name: "fallback/root" });
			return register(...args);
		});
		let cause: unknown;
		try {
			scope.node([], () => {}, { name: "fallback/root" });
		} catch (error) {
			cause = error;
		}
		const cleanup = new Error("release before persistence");
		vi.spyOn(nodeRuntimeHost(Node.prototype), "_releaseRuntime").mockImplementation(() => {
			throw cleanup;
		});
		let failure: ColdConstructionError | undefined;
		try {
			scope.abort(cause);
		} catch (error) {
			failure = error as ColdConstructionError;
		}
		expect(failure?.cleanupErrors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ resource: "fallback/root:runtime", cause: cleanup, dispatcher }),
			]),
		);
	});

	it("reports a failed partial constructor's exact handle without hiding undefined errors", () => {
		const dispatcher = new CountingDispatcher();
		const g = new Graph({ dispatcher });
		const scope = prepareConstruction(g, {
			name: "partial",
			epoch: 1,
			inputs: [],
			names: ["partial/startup", "partial/root"],
		});
		scope.startupSource();
		let cause: unknown;
		try {
			scope.node([], () => {}, {
				name: "partial/root",
				initial: 1,
				versioning: {
					level: 1,
					hash: () => {
						throw new Error("hash");
					},
				},
			});
		} catch (error) {
			cause = error;
		}
		vi.spyOn(dispatcher, "unregister").mockImplementation(() => {
			throw undefined;
		});
		let failure: ColdConstructionError | undefined;
		try {
			scope.abort(cause);
		} catch (error) {
			failure = error as ColdConstructionError;
		}
		expect(failure?.cleanupErrors).toHaveLength(1);
		expect(failure?.cleanupErrors[0]?.resource).toBe("partial/root:handle");
		expect(new Set(failure?.cleanupErrors.map((e) => e.handle))).toEqual(dispatcher.live);
	});

	it("keeps a failed-release owner after an unrelated successful release", () => {
		const f = simple();
		const owner = f.scope.seal(f.startup, [f.join]);
		f.scope.transferToGraph(owner);
		startConstruction(f.graph, owner);
		for (const root of owner.roots) root.unsubscribe?.();
		vi.spyOn(f.dispatcher, "unregister").mockImplementationOnce(() => {
			throw new Error("residual handle");
		});
		const group = f.graph.topologyGroup();
		for (const node of owner.nodes) group.add(node);
		expect(() => group.release()).toThrow(/residual/);
		f.graph.topologyGroup().release();
		expect(constructionOf(f.graph, "view")).toBe(owner);
	});

	it("records dependencies acquired by a startup boundary rewire before their handshake", () => {
		const g = new Graph();
		const a = g.state(1, { name: "a" });
		const b = g.state(2, { name: "b" });
		const scope = prepareConstruction(g, {
			name: "rewired",
			epoch: 1,
			names: ["rewired/startup", "rewired/root"],
			inputs: [a, b],
		});
		const startup = scope.startupSource();
		const root = scope.node(
			[a],
			(ctx) => {
				if (ctx.state.get() === undefined) {
					ctx.state.set(true);
					ctx.rewireNext.subscribeDep(b);
				}
			},
			{ name: "rewired/root" },
		);
		const original = nodeRuntimeHost(b)._subscribeOwned.bind(nodeRuntimeHost(b));
		vi.spyOn(nodeRuntimeHost(b), "_subscribeOwned").mockImplementation((sink, acquisition) =>
			original((m, d) => {
				if (m[0] === "START") throw new Error("rewire handshake");
				sink(m, d);
			}, acquisition),
		);
		const owner = scope.seal(startup, [root]);
		scope.transferToGraph(owner);
		startConstruction(g, owner);
		expect(owner.phase).toBe("faulted");
		expect(subscriberCountOfNode(b)).toBe(1);
		expect(nodeRuntimeHost(root)._dep.unsubs[1]).toBeTypeOf("function");
	});

	it("releases a completed non-causal view without retaining its owner or disturbing shared sources", () => {
		const g = new Graph({ dispatcher: new CountingDispatcher() });
		const source = g.state(1, { name: "source" });
		const seen: unknown[] = [];
		source.subscribe((m) => {
			if (m[0] === "DATA") seen.push(m[1]);
		});
		for (let i = 0; i < 20; i++) {
			const name = `view-${i}`;
			const scope = prepareConstruction(g, {
				name,
				epoch: 1,
				names: [`${name}/startup`, `${name}/root`],
				inputs: [source],
			});
			const startup = scope.startupSource();
			const root = scope.node([source], null, { name: `${name}/root` });
			const owner = scope.seal(startup, [root]);
			scope.transferToGraph(owner);
			startConstruction(g, owner);
			expect(subscriberCountOfNode(source)).toBe(2);
			// This non-causal view has no business obligations and is explicitly ended by its owner.
			for (const lease of owner.roots) lease.unsubscribe?.();
			const group = g.topologyGroup();
			for (const node of owner.nodes) group.add(node);
			group.release();
			expect(constructionOf(g, name)).toBeUndefined();
			expect(subscriberCountOfNode(source)).toBe(1);
		}
		source.set(2);
		expect(seen).toEqual([1, 2]);
		expect(g.describe().nodes).toHaveLength(1);
	});

	it.each([
		false,
		true,
	])("a graph-wired startup gate controls the offline host request (fault=%s)", (fault) => {
		const f = causal(new Graph(), fault);
		const full = causalComposition(f.graph).composeFull(f.options, binding);
		const authorized = f.graph.state(
			{ instance: "causal", epoch: 1, admitted: true },
			{ name: "test/authorization" },
		);
		const request = f.graph.derived(
			[full.startup, authorized],
			(startup, grant) =>
				startup.state === "started" &&
				startup.instance === grant.instance &&
				startup.epoch === grant.epoch &&
				grant.admitted,
			{ name: "test/guard" },
		);
		let calls = 0;
		const stop = request.subscribe((m) => {
			if (m[0] === "DATA" && m[1] === true) calls++;
		});
		expect(calls).toBe(fault ? 0 : 1);
		authorized.set({ instance: "causal", epoch: 2, admitted: true });
		authorized.set({ instance: "other", epoch: 1, admitted: true });
		authorized.set({ instance: "causal", epoch: 1, admitted: false });
		expect(calls).toBe(fault ? 0 : 1);
		stop();
		// This proves only the startup condition; no real inbox or business verifier is present.
	});

	it("successful startup and replay without a proposal never fabricate an effect", () => {
		const f = causal();
		const proposals = f.graph.node([], null, { name: "input/no-proposal" });
		const full = causalComposition(f.graph).composeFull(
			{ ...f.options, effectProposals: proposals },
			binding,
		);
		expect(full.startup.cache?.state).toBe("started");
		for (let i = 0; i < 3; i++) {
			const stop = full.startup.subscribe(() => {});
			stop();
		}
		f.options.occurrences.down([["DATA", f.occurrence]]);
		const state = checkpointStateOfNode(f.graph.find("causal/authority")!).ctxState
			.value as RuntimeState<string>;
		expect(state.effects.size).toBe(0);
		expect(constructionOf(f.graph, "causal")?.phase).toBe("started");
	});
});
