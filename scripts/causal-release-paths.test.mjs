/** Extract actual frozen release bodies into countable offline hosts. No real graph construction. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createReleaseGaps } from "./causal-release-observer.mjs";
import { derive } from "./derive-causal-release.mjs";
export function compileFixture(bundle) {
	const take = (start, end) => {
		const a = bundle.indexOf(start);
		assert.ok(a >= 0, start);
		const b = bundle.indexOf(end, a);
		assert.ok(b > a, end);
		return bundle.slice(a, b);
	};
	const graphMethod = take("  _releaseNodes(nodes,", "\n  // ── 8 verbs");
	const registrarMethod = take("  releaseNodes(nodes, opts", "\n  assertAvailableName");
	const groupText = take("var GraphTopologyGroup = class {", "\n};") + "\n};";
	const runtimeText = take("function nodeReleaseRuntime(self) {", "function nodeResetDepState");
	const quiescentText = take(
		"function nodeIsRuntimeQuiescentForRelease(self) {",
		"function nodeReleaseRuntime",
	);
	return function fixture(fault = "none") {
		const events = [],
			closed = new Set(),
			failures = new Map(),
			registrations = new Map();
		const runtime = new Function(
			"SENTINEL",
			"closeNodeRegistration",
			"setRuntimeReleaseFailures",
			runtimeText + "\nreturn nodeReleaseRuntime;",
		)(
			Symbol("sentinel"),
			(n) => {
				events.push("close:" + n.name);
				closed.add(n);
			},
			(n, e) => failures.set(n, e),
		);
		const quiescent = new Function(quiescentText + "\nreturn nodeIsRuntimeQuiescentForRelease;")();
		const release = new Function(
			"graphRegistrations",
			"isNodeRuntimeQuiescentForRelease",
			"isNodeActiveForRelease",
			"subscriberCountOfNode",
			"releaseRuntimeOfNode",
			"isNodeRuntimeReleased",
			"runtimeReleaseFailuresOfNode",
			"return function " + graphMethod.trim().replace("_releaseNodes", "release") + ";",
		)(
			registrations,
			quiescent,
			(n) => n._lifecycle.activated,
			(n) => n._lifecycle.subscribers.size,
			(n) => {
				events.push("runtime:" + n.name);
				runtime(n);
			},
			(n) => closed.has(n),
			(n) => failures.get(n),
		);
		const nodes = ["a", "b", "c"].map((name) => {
			const fail = (kind) => {
				events.push(kind + ":" + name);
				if (fault === kind && name === "a") throw Error(kind + ":a");
			};
			return {
				name,
				_released: false,
				_id: name,
				_slot: {
					deps: [],
					handle: { name },
					dispatcher: {
						unregister() {
							fail("dispatcher");
						},
					},
				},
				get deps() {
					return this._slot.deps;
				},
				_lifecycle: { activated: false, subscribers: new Set() },
				_value: { status: "sentinel" },
				_wave: {
					pending: 0,
					insideRunWave: false,
					inDepMutation: false,
					rewireRunPending: false,
					batchDirtyOwed: false,
				},
				_dep: { dirty: [], unsubs: [() => fail("unsubscribe")] },
				_hooks: { onDeactivation: [() => fail("hook")] },
				_privateState: {},
				_control: {
					pauseBuffer: [],
					pausedDepWaveOccurred: false,
					demandOwed: undefined,
					activePull: undefined,
					inDeliverDemand: false,
					pauseLockset: new Set(),
				},
				_resetDepState() {
					events.push("reset:" + name);
				},
				_core: {
					releaseSlot() {
						fail("slot");
					},
				},
			};
		});
		nodes[1]._slot.deps = [nodes[0], nodes[0]];
		nodes[2]._slot.deps = [nodes[1]];
		if (fault === "active") {
			for (const n of nodes) n._lifecycle.activated = true;
			nodes[0]._lifecycle.subscribers = new Set([1, 2]);
			nodes[1]._lifecycle.subscribers = new Set([1]);
		}
		if (fault === "subscriber") nodes[2]._lifecycle.subscribers.add("outside");
		if (["nonquiescent", "outside-nonquiescent"].includes(fault))
			nodes[2]._value.status = "pending";
		const graph = {
			_entries: new Map(nodes.map((n) => [n, { node: n, id: n.name, factory: "fake" }])),
			_byId: new Map(nodes.map((n) => [n.name, n])),
			_retiredIds: new Set(),
			_topologyObservers: new Set([1]),
			_topologyDeps: (deps) => deps.map((n) => n.name),
			_emitTopologyNodeReleased(e) {
				events.push("event:" + e.path);
			},
			_releaseNodes: release,
		};
		if (["outside", "outside-nonquiescent"].includes(fault)) {
			const n = { name: "outside", deps: [nodes[0]] };
			graph._entries.set(n, { node: n, id: "outside" });
		}
		const owner = { nodes };
		const constructions = new Map([["owner", owner]]);
		const forward = new Function(
			"return function " + registrarMethod.trim().replace("releaseNodes", "forward") + ";",
		)();
		registrations.set(graph, {
			host: graph,
			releaseNodes: forward,
			existingConstructions: constructions,
			assertRegisteredNode(n) {
				assert.ok(graph._entries.has(n));
			},
		});
		const Group = new Function("graphRegistrations", groupText + "\nreturn GraphTopologyGroup;")(
			registrations,
		);
		const group = new Group(graph);
		for (const n of nodes) group.add(n);
		return { nodes, graph, group, events, closed, failures, constructions };
	};
}
export function exercise(bundle) {
	const make = compileFixture(bundle);
	let cases = 0;
	for (const fault of [
		"none",
		"active",
		"outside",
		"outside-nonquiescent",
		"nonquiescent",
		"subscriber",
		"unsubscribe",
		"hook",
		"dispatcher",
		"slot",
	]) {
		const f = make(fault),
			ticks = [];
		const diagnostic = {
			now() {
				ticks.push(ticks.length);
				return ticks.length;
			},
		};
		let error;
		try {
			f.group.release({}, diagnostic);
		} catch (e) {
			error = e;
		}
		if (["outside", "outside-nonquiescent", "nonquiescent", "subscriber"].includes(fault)) {
			assert.ok(error);
			assert.equal(f.closed.size, 0);
			assert.equal(f.graph._entries.size, fault.startsWith("outside") ? 4 : 3);
			assert.equal(f.graph._byId.size, 3);
			if (fault === "outside-nonquiescent") assert.match(error.message, /still depends/);
			assert.equal(f.graph._retiredIds.size, 0);
			assert.equal(f.group.released, false);
			assert.equal(f.group._members.length, 3);
			assert.equal(f.constructions.size, 1);
			assert.equal(f.events.length, 0);
		} else {
			assert.equal(f.closed.size, 3);
			assert.equal(f.graph._retiredIds.size, 3);
			assert.deepEqual(
				f.events.filter((x) => x.startsWith("runtime:")),
				["runtime:a", "runtime:b", "runtime:c"],
			);
			if (fault === "none" || fault === "active") {
				assert.equal(error, undefined);
				assert.equal(f.group.released, true);
				assert.equal(f.constructions.size, 0);
				assert.equal(f.group._members.length, 0);
			} else {
				assert.equal(error.message, fault + ":a");
				assert.equal(f.group.released, false);
				assert.equal(f.group._members.length, 3);
				assert.equal(f.constructions.size, 1);
				assert.equal(
					f.failures.get(f.nodes[0])[0].resource,
					fault === "dispatcher"
						? "handle"
						: fault === "hook"
							? "deactivation"
							: fault === "unsubscribe"
								? "subscription"
								: "slot",
				);
			}
		}
		if (bundle.includes("// RELEASE")) {
			assert.equal(
				ticks.length,
				["outside", "outside-nonquiescent"].includes(fault)
					? 2
					: ["nonquiescent", "subscriber"].includes(fault)
						? 3
						: ["none", "active"].includes(fault)
							? 7
							: 6,
			);
			if (!error)
				assert.deepEqual(Object.keys(diagnostic), [
					"now",
					"r0",
					"r1",
					"r2",
					"r3",
					"r4",
					"r5",
					"r6",
				]);
		} else assert.equal(ticks.length, 0);
		cases++;
	}
	const f = make();
	f.graph._releaseNodes([f.nodes[0], f.nodes[0], ...f.nodes.slice(1), {}]);
	assert.equal(f.closed.size, 3);
	assert.equal(f.events.filter((x) => x === "runtime:a").length, 1);
	cases++;
	return cases;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const source = readFileSync(process.argv[2], "utf8"),
		r = derive(source);
	const positives = exercise(source) + exercise(r);
	const mutants = [
		["if (!isNodeRuntimeQuiescentForRelease(node))", "if (false)"],
		["if (subscriberCountOfNode(node) > internalSubscribers)", "if (false)"],
		["if (!releaseSet.has(dep)) continue;", "if (true) continue;"],
		["releaseRuntimeOfNode(node);", 'if (node.name !== "c") releaseRuntimeOfNode(node);'],
		["if (releaseFailed) throw releaseError;", ""],
		[
			"if (!releaseFailed) {",
			"graphRegistrations.get(this).existingConstructions.clear(); if (!releaseFailed) {",
		],
		["internalSubscribers += 1", "internalSubscribers = 1"],
		["diagnostic.r6 =", "diagnostic.r7 ="],
		["const releaseSet =", 'this._retiredIds.add("early");\n    const releaseSet ='],
	];
	for (const [a, b] of mutants) {
		assert.ok(r.includes(a));
		assert.throws(() => exercise(r.replace(a, b)), a);
	}
	const methodStart = r.indexOf("  _releaseNodes(");
	const a = r.indexOf("    for (const entry of this._entries.values())", methodStart),
		b = r.indexOf("    if (diagnostic) diagnostic.r2", a),
		c = r.indexOf("    for (const { node, entry } of entries)", b),
		d = r.indexOf("    if (diagnostic) diagnostic.r3", c);
	assert.ok(methodStart < a && a < b && b < c && c < d);
	const reordered = r.slice(0, a) + r.slice(c, d) + r.slice(b, c) + r.slice(a, b) + r.slice(d);
	assert.throws(() => exercise(reordered), "guard order mutation");
	let observerCases = 0;
	for (const [name, failAt, runtimeFault] of [
		["r0", [4], "none"],
		["r3", [7], "none"],
		["r5-runtime", [9], "dispatcher"],
		["deep-and-r5-runtime", [0, 9], "dispatcher"],
	]) {
		const f = compileFixture(r)(runtimeFault);
		let tick = 0,
			written;
		const gaps = createReleaseGaps(
			{ releaseMode: "R", gapMode: "D", output: "fake", run: "fake", sourceDigest: "fake" },
			{
				now() {
					const i = tick++;
					if (failAt.includes(i)) throw Error("clock-" + i);
					return tick;
				},
				write(_p, s) {
					written = JSON.parse(s);
				},
			},
		);
		const row = gaps.begin({ batch: 0, arm: "reference", index: 0, phase: "warmup" }),
			diag = gaps.deep(row),
			primary = Error("primary-record");
		let releaseError, error;
		for (let i = 0; i < 4; i++) diag[`d${i}`] = diag.now();
		try {
			f.group.release({}, diag.release);
		} catch (e) {
			releaseError = e;
		}
		try {
			if (releaseError) gaps.fail(primary, releaseError);
			else {
				diag.d4 = diag.now();
				gaps.append(row, primary);
			}
		} catch (e) {
			error = e;
		}
		assert.ok(error, name);
		const flatten = (e) => [String(e), ...(e.errors ?? []).flatMap(flatten)];
		const messages = flatten(error).join("\n");
		assert.match(messages, /primary-record/);
		for (const i of failAt) assert.ok(messages.includes("clock-" + i));
		assert.equal(f.closed.size, 3);
		assert.equal(f.events.filter((x) => x.startsWith("runtime:")).length, 3);
		if (runtimeFault === "dispatcher") {
			assert.match(messages, /dispatcher:a/);
			assert.equal(diag.release.r6, undefined);
			assert.equal(f.group.released, false);
			assert.equal(f.constructions.size, 1);
		}
		gaps.finish(error);
		assert.equal(written.complete, false);
		assert.ok(written.active);
		observerCases++;
	}
	console.log(
		JSON.stringify({
			passed: true,
			releasePathPositives: positives,
			loadedMutants: mutants.length + 1,
			observerErrorCases: observerCases,
			realConsumerSamples: 0,
		}),
	);
}
