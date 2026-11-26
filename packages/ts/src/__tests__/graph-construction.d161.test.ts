import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ColdConstructionError,
	constructionOf,
	prepareConstruction,
	startConstruction,
} from "../graph/construction-scope.js";
import { Graph, type GraphOptions } from "../graph/graph.js";
import { observeTopology } from "../graph/inspect.js";
import { renderSnapshot } from "../graph/render.js";
import * as topology from "../graph/topology.js";
import { kernelOfNode, recordOfNode, type StateNode } from "../node/node.js";
import * as runtimeAccessors from "../node/runtime-accessors.js";
import {
	checkpointStateOfNode,
	isNodeRuntimeReleased,
	subscriberCountOfNode,
} from "../node/runtime-accessors.js";
import {
	assertCausalCapabilities,
	type CausalBinding,
} from "../solutions/causal-occurrence/capabilities.js";
import type {
	CausalEffectOutcome,
	CausalEffectProposal,
	CausalOccurrenceBundleOptions,
	RuntimeState,
} from "../solutions/causal-occurrence/contracts.js";
import {
	causalComposition,
	causalOccurrenceBundle,
	causalOccurrenceDigest,
} from "../solutions/causal-occurrence.js";
import { asState } from "./helpers/as-state.js";
import { relayFirst } from "./helpers/relay.js";

afterEach(() => vi.restoreAllMocks());

/** The graph's release of each node's runtime runs `fault` first; `fault` may throw. */
function faultRelease(
	fault: (node: Parameters<typeof runtimeAccessors.releaseRuntimeOfNode>[0], call: number) => void,
) {
	const release = runtimeAccessors.releaseRuntimeOfNode;
	let calls = 0;
	vi.spyOn(runtimeAccessors, "releaseRuntimeOfNode").mockImplementation((node) => {
		fault(node, ++calls);
		release(node);
	});
	return () => calls;
}

/** `onRun` runs at the start of every run of the right and join functions. */
function simple(
	name = "view",
	report?: GraphOptions["report"],
	onRun?: (node: "right" | "join") => void,
) {
	const graph = new Graph({ report });
	const a = graph.state(2, { name: "a" });
	const b = graph.state(3, { name: "b" });
	const scope = prepareConstruction(graph, {
		name,
		epoch: 1,
		inputs: [a, b],
		names: [`${name}/startup`, `${name}/left`, `${name}/right`, `${name}/join`],
	});
	const startup = scope.startupSource();
	const left = scope.node([a], (ctx) => ctx.down([["DATA", Number(ctx.deps[0].value) * 2]]), {
		name: `${name}/left`,
	});
	const right = scope.node(
		[a, b],
		(ctx) => {
			onRun?.("right");
			ctx.down([["DATA", Number(ctx.deps[0].value) + Number(ctx.deps[1].value)]]);
		},
		{ name: `${name}/right` },
	);
	const join = scope.node<number>(
		[left, right],
		(ctx) => {
			onRun?.("join");
			ctx.down([["DATA", Number(ctx.deps[0].value) + Number(ctx.deps[1].value)]]);
		},
		{ name: `${name}/join` },
	);
	return { graph, a, b, scope, startup, left, right, join };
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
	const watermark = graph.state(
		{ revisionDomain: "d", revision: 1 },
		{ name: "input/watermark-source" },
	);
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
		// The watermark lane forwards a host input; with `fault` its first run throws after it sent
		// the first watermark.
		watermarks: graph.node(
			[watermark],
			(ctx) => {
				for (const value of ctx.deps[0].waves.flat()) ctx.down([["DATA", value]]);
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
	return { graph, options, occurrence, admitted, outcomes, watermark };
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
		const stop = observeTopology(f.graph).subscribe((event) => {
			if (event.path !== "causal/issues") return;
			const authority = f.graph.find("causal/authority")!;
			expect(authority.status.cache).toBe("empty");
			const { fn, setup, recipe } = f.graph.definition(authority);
			f.graph.replace(authority, [], fn!, { setup, recipe });
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
		// Only the fixture's input nodes remain: eight lanes plus the watermark's host input.
		expect(renderSnapshot(f.graph).nodes).toHaveLength(9);
		const group = topology.group(f.graph);
		for (const node of renderSnapshot(f.graph).nodes) group.add(f.graph.find(node.id)!);
		group.release();
	});

	it("constructs cold, transfers before running, and preserves a real fan-out/fan-in trace", () => {
		const phases: unknown[] = [];
		const f = simple("view", undefined, (node) => {
			if (node === "join") phases.push(constructionOf(f.graph, "view")?.phase);
		});
		expect(subscriberCountOfNode(f.a)).toBe(0);
		const owner = f.scope.seal(f.startup, [f.join]);
		f.scope.transferToGraph(owner);
		expect(phases).toEqual([]);
		startConstruction(f.graph, owner);
		// The join first runs as its root lease activates it, while the startup is in progress.
		expect(phases).toEqual(["starting"]);
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
		// An ended node is a valid input (R-terminals): it can be depended on.
		for (const input of [other.state(1)])
			expect(() =>
				prepareConstruction(g, { name: "bad", epoch: 1, names: ["bad/startup"], inputs: [input] }),
			).toThrow();
		const retired = topology.group(g);
		retired.node([], null, { name: "retired" });
		retired.release();
		expect(() =>
			prepareConstruction(g, { name: "bad", epoch: 1, names: ["retired"], inputs: [] }),
		).toThrow(/retired/);
		expect(renderSnapshot(g).nodes).toHaveLength(0);
	});

	it("rejects active batch and reactive entry before any resource acquisition", () => {
		const g = new Graph();
		const make = () =>
			prepareConstruction(g, { name: "bad", epoch: 1, names: ["bad/startup"], inputs: [] });
		expect(() => g.batch(make)).toThrow(/stable/);
		const source = g.producer(
			() => {
				expect(make).toThrow(/stable/);
			},
			{ name: "source" },
		);
		source.subscribe(() => {});
		expect(renderSnapshot(g).nodes).toHaveLength(1);
	});

	it("cleans a failed constructor before a Node is returned", () => {
		const g = new Graph();
		const scope = prepareConstruction(g, {
			name: "cold",
			epoch: 1,
			inputs: [],
			names: ["cold/startup", "cold/bad"],
		});
		scope.startupSource();
		let caught: unknown;
		try {
			// A failure after the constructor made the kernel record, before the node exists.
			vi.spyOn(runtimeAccessors, "issueNodeRegistration").mockImplementationOnce(() => {
				throw new Error("allocation failure");
			});
			scope.node([], () => {}, { name: "cold/bad", initial: 1 });
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeDefined();
		expect(() => scope.abort(caught)).toThrow(ColdConstructionError);
		expect(renderSnapshot(g).nodes).toHaveLength(0);
	});

	it("cleans already registered cold nodes when a later acquisition throws", () => {
		const f = simple();
		const before = renderSnapshot(f.graph).nodes.length;
		expect(before).toBe(6);
		expect(() => f.scope.abort(new Error("seal failed"))).toThrow(/cleanup complete/);
		expect(renderSnapshot(f.graph).nodes.map((n) => n.id)).toEqual(["a", "b"]);
		expect(subscriberCountOfNode(f.a)).toBe(0);
		expect(() => f.graph.node([], null, { name: "view/join" })).toThrow(/cannot be reused/);
	});

	it("reports cleanup failure and still attempts independent resources", () => {
		const f = simple();
		const calls = faultRelease((_node, call) => {
			if (call === 1) throw new Error("cleanup failed");
		});
		let failure: ColdConstructionError | undefined;
		try {
			f.scope.abort("original failure");
		} catch (e) {
			failure = e as ColdConstructionError;
		}
		expect(failure?.originalCause).toBe("original failure");
		expect(failure?.cleanupErrors.length).toBeGreaterThan(0);
		// Every registered cold node's release is attempted; only the failed one is left.
		expect(calls()).toBe(4);
		expect([f.startup, f.left, f.right, f.join].map(isNodeRuntimeReleased)).toEqual([
			false,
			true,
			true,
			true,
		]);
	});

	it("records the acquired root lease when a failure is reported while the root activates", () => {
		const reports: unknown[] = [];
		// The join's first run writes `side`; the write is a request that runs after the activation
		// wave, and side's sink throws on it.
		let side: StateNode<number> | undefined;
		const f = simple(
			"view",
			(failure) => reports.push(failure),
			(node) => node === "join" && side?.set(1),
		);
		side = f.graph.state(0, { name: "side" });
		side.subscribe((msgs) => {
			if (msgs.some((m) => m[0] === "DATA" && m[1] === 1)) throw new Error("side sink");
		});
		const owner = f.scope.seal(f.startup, [f.join]);
		f.scope.transferToGraph(owner);
		startConstruction(f.graph, owner);
		// R-failure: a sink that throws has no node to end: the failure goes to the graph's reporter,
		// and the startup, which observes the failures it causes (graphrefly-ts:D181), is faulted.
		expect(reports).not.toHaveLength(0);
		for (const report of reports)
			expect(report).toEqual({
				source: expect.stringMatching(/^sink of /),
				error: new Error("side sink"),
			});
		expect(owner.phase).toBe("faulted");
		expect(owner.startupError).toEqual(new Error("side sink"));
		expect(owner.roots.find((r) => r.node === f.join)?.unsubscribe).toBeTypeOf("function");
		expect(subscriberCountOfNode(f.join)).toBe(1);
		// R-subscription: activation comes before START, so the failure finds the node activated.
		expect(recordOfNode(f.join).active).toBe(true);
	});

	it("keeps deep dependency leases without disturbing a shared existing subscriber when a deep node's activation fails", () => {
		// The right node, a dependency of the root, writes `side` on its first run; the write runs
		// in the drain after the activation wave, and side's sink throws there.
		let side: StateNode<number> | undefined;
		const f = simple(
			"view",
			() => {},
			(node) => node === "right" && side?.set(1),
		);
		side = f.graph.state(0, { name: "side" });
		side.subscribe((msgs) => {
			if (msgs.some((m) => m[0] === "DATA" && m[1] === 1)) throw new Error("deep handshake");
		});
		const values: unknown[] = [];
		f.a.subscribe((incoming) => {
			for (const m of incoming) {
				if (m[0] === "DATA") values.push(m[1]);
			}
		});
		const owner = f.scope.seal(f.startup, [f.join]);
		f.scope.transferToGraph(owner);
		startConstruction(f.graph, owner);
		expect(owner.phase).toBe("faulted");
		expect(String(owner.startupError)).toBe("Error: deep handshake");
		expect(subscriberCountOfNode(f.a)).toBe(3);
		expect(subscriberCountOfNode(f.b)).toBe(1);
		// right holds its lease on b, its dependency at place 1.
		expect(
			recordOfNode(f.b).subs.some(
				(sub) => sub.kind === "node" && sub.node === recordOfNode(f.right) && sub.dep === 1,
			),
		).toBe(true);
		f.a.set(4);
		expect(values).toEqual([2, 4]);
	});

	it("does not call startup successful before exitWave drain returns", () => {
		// The join's first run writes `side`; the write is a request that runs in the drain after
		// the activation wave, and side's sink throws there.
		let side: StateNode<number> | undefined;
		const f = simple(
			"view",
			() => {},
			(node) => node === "join" && side?.set(1),
		);
		side = f.graph.state(0, { name: "side" });
		side.subscribe((msgs) => {
			if (msgs.some((m) => m[0] === "DATA" && m[1] === 1)) throw new Error("drain failure");
		});
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
		f.startup.subscribe((incoming) => {
			for (const m of incoming) {
				if (m[0] === "DATA") {
					seen.push(m[1]);
					if ((m[1] as { state: string }).state === "started") throw new Error("delivery");
				}
			}
		});
		startConstruction(f.graph, owner);
		expect(owner.phase).toBe("started");
		// R-failure@3: the consumer's throw is caught per sink and goes to the host reporter.
		expect(owner.deliveryError).toBeUndefined();
		expect(seen.map((v) => (v as { state: string }).state)).toEqual(["starting", "started"]);
	});

	it("a producer's throw at startup is its ERROR: what it sent first is dropped and startup faults", () => {
		// R-failure@3: the watermark producer's throw is that node's ERROR and what it sent before
		// the throw is dropped; the causal nodes below it end with it (auto ERROR), so startup
		// reports a protocol error and no effect is admitted.
		const f = causal(new Graph(), true);
		const full = causalComposition(f.graph).composeFull(f.options, binding);
		const authority = f.graph.find("causal/authority")!;
		expect(full.startup.cache?.state).toBe("faulted");
		expect(full.startup.cache?.code).toBe("protocol-error");
		expect(authority.status.output).toBe("errored");
		// R-lifetime: the ended authority's private state, where effects are admitted, is gone.
		expect(checkpointStateOfNode(authority).privateState).toBeUndefined();
		expect(constructionOf(f.graph, "causal")?.phase).toBe("faulted");
	});

	it("keeps a protocol-terminated authority unresolved without automatic reset", () => {
		const f = causal();
		const full = causalComposition(f.graph).composeFull(f.options, binding);
		const authority = f.graph.find("causal/authority")!;
		f.outcomes.error("outcome source lost");
		expect(authority.status.output).toBe("errored");
		// R-terminals: an ended node can still be subscribed; its snapshot ends with its terminal,
		// and nothing restarts it.
		const late: unknown[] = [];
		full.execution.conservation.subscribe((incoming) => {
			for (const m of incoming) {
				late.push(m[0]);
			}
		});
		expect(late.at(-1)).toBe("ERROR");
		expect(authority.status.output).toBe("errored");
		// R-lifetime: the ended authority dropped its private state when its lifetime closed.
		expect(checkpointStateOfNode(authority).privateState).toBeUndefined();
	});

	it("returns exact narrow handles with real payload projection and rejects wrong bindings", () => {
		const f = causal();
		const setup = causalComposition(f.graph);
		const before = renderSnapshot(f.graph).nodes.length;
		expect(() =>
			setup.composeFull(f.options, { ...binding, scope: "identity" } as never),
		).toThrow();
		expect(renderSnapshot(f.graph).nodes.length).toBe(before);
		const full = setup.composeFull(f.options, binding);
		assertCausalCapabilities(f.graph, full, binding);
		expect(full.execution.identity).toBe(full.identity);
		expect(full.retained.execution).toBe(full.execution);
		expect(Object.keys(full.identity)).toEqual(["released", "currentness", "issues"]);
		const values: unknown[] = [];
		full.execution.causalQuiescence.subscribe((incoming) => {
			for (const m of incoming) {
				if (m[0] === "DATA") values.push(m[1]);
			}
		});
		const subscribed = values.length;
		f.watermark.set({ revisionDomain: "d", revision: 2 });
		expect(values.length).toBeGreaterThan(subscribed);
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

	it("D167 retains an unpublished node release exception without persisted identity diagnostics", () => {
		const g = new Graph();
		const scope = prepareConstruction(g, {
			name: "fallback",
			epoch: 1,
			inputs: [],
			names: ["fallback/startup", "fallback/root"],
		});
		scope.startupSource();
		// D167 prechecks known duplicates; a winner takes the name while the root is being built.
		const issue = runtimeAccessors.issueNodeRegistration;
		vi.spyOn(runtimeAccessors, "issueNodeRegistration").mockImplementationOnce((node) => {
			g.state(1, { name: "fallback/root" });
			issue(node);
		});
		let cause: unknown;
		try {
			scope.node([], () => {}, { name: "fallback/root" });
		} catch (error) {
			cause = error;
		}
		const cleanup = new Error("release before persistence");
		vi.spyOn(runtimeAccessors, "releaseRuntimeOfNode").mockImplementation(() => {
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
				expect.objectContaining({
					resource: "fallback/root:runtime",
					cause: cleanup,
					core: kernelOfNode(g.find("fallback/root")!),
				}),
			]),
		);
	});

	it("keeps a failed-release owner after an unrelated successful release", () => {
		const f = simple();
		const owner = f.scope.seal(f.startup, [f.join]);
		f.scope.transferToGraph(owner);
		startConstruction(f.graph, owner);
		for (const root of owner.roots) root.unsubscribe?.();
		vi.spyOn(runtimeAccessors, "releaseRuntimeOfNode").mockImplementationOnce(() => {
			throw new Error("residual runtime");
		});
		const group = topology.group(f.graph);
		for (const node of owner.nodes) group.add(node);
		expect(() => group.release()).toThrow(/residual/);
		topology.group(f.graph).release();
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
		let armed = false;
		const record = recordOfNode(b);
		let values = record.values;
		Object.defineProperty(record, "values", {
			configurable: true,
			get() {
				if (armed) {
					armed = false;
					throw new Error("rewire handshake");
				}
				return values;
			},
			set(v) {
				values = v;
			},
		});
		const root = scope.node(
			[a],
			(ctx) => {
				if (ctx.state.get() === undefined) {
					ctx.state.set(true);
					// The rewire is a request; acquiring b reads b's snapshot, which throws once.
					armed = true;
					ctx.rewire([a, b]);
				}
			},
			{ name: "rewired/root" },
		);
		const owner = scope.seal(startup, [root]);
		scope.transferToGraph(owner);
		startConstruction(g, owner);
		expect(owner.phase).toBe("faulted");
		// REVIEW-D797-migration-codex F4: the failed rewire is the queued request's failure, not
		// root's ERROR. Its committed dependencies stay (D167), and the lease acquired before the
		// handshake threw is recorded (D161), so root holds it and releases it with its lifetime.
		expect(root.status.output).toBe("open");
		expect(root.deps).toEqual([a, b]);
		expect(subscriberCountOfNode(b)).toBe(1);
	});

	it("releases a completed non-causal view without retaining its owner or disturbing shared sources", () => {
		const g = new Graph();
		const source = g.state(1, { name: "source" });
		const seen: unknown[] = [];
		source.subscribe((incoming) => {
			for (const m of incoming) {
				if (m[0] === "DATA") seen.push(m[1]);
			}
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
			const root = scope.node([source], relayFirst, { name: `${name}/root` });
			const owner = scope.seal(startup, [root]);
			scope.transferToGraph(owner);
			startConstruction(g, owner);
			expect(subscriberCountOfNode(source)).toBe(2);
			// This non-causal view has no business obligations and is explicitly ended by its owner.
			for (const lease of owner.roots) lease.unsubscribe?.();
			const group = topology.group(g);
			for (const node of owner.nodes) group.add(node);
			group.release();
			expect(constructionOf(g, name)).toBeUndefined();
			expect(subscriberCountOfNode(source)).toBe(1);
		}
		source.set(2);
		expect(seen).toEqual([1, 2]);
		expect(renderSnapshot(g).nodes).toHaveLength(1);
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
			(startup, grant) => {
				if (startup === undefined || grant === undefined) return undefined;
				return (
					startup.state === "started" &&
					startup.instance === grant.instance &&
					startup.epoch === grant.epoch &&
					grant.admitted
				);
			},
			{ name: "test/guard" },
		);
		let calls = 0;
		const stop = request.subscribe((incoming) => {
			for (const m of incoming) {
				if (m[0] === "DATA" && m[1] === true) calls++;
			}
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
		const proposals = f.graph.node<CausalEffectProposal>([], null, { name: "input/no-proposal" });
		const full = causalComposition(f.graph).composeFull(
			{ ...f.options, effectProposals: proposals },
			binding,
		);
		expect(full.startup.cache?.state).toBe("started");
		for (let i = 0; i < 3; i++) {
			const stop = full.startup.subscribe(() => {});
			stop();
		}
		asState(f.options.occurrences).set(f.occurrence);
		const state = checkpointStateOfNode(f.graph.find("causal/authority")!)
			.privateState as RuntimeState<string>;
		expect(state.effects.size).toBe(0);
		expect(constructionOf(f.graph, "causal")?.phase).toBe("started");
	});
});
