/** Offline loaded-source qualification. No performance samples or consumer imports. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";

const source = readFileSync(new URL("../packages/ts/src/graph/graph.ts", import.meta.url), "utf8");
const start = source.indexOf("\tprivate _releaseNodes(");
const end = source.indexOf("\n\t// ── 8 verbs", start);
assert.ok(start > 0 && end > start);
const method = source.slice(start, end);
const lifecycleSource = readFileSync(
	new URL("../packages/ts/src/node/node-lifecycle-runtime.ts", import.meta.url),
	"utf8",
);
const qa = lifecycleSource.indexOf("export function nodeIsRuntimeQuiescentForRelease");
const qb = lifecycleSource.indexOf("export function nodeReleaseRuntime", qa);
assert.ok(qa >= 0 && qb > qa);
const quiescentCode = transformSync(
	lifecycleSource.slice(qa, qb).replace("export function", "function"),
	{ loader: "ts" },
).code;
const actualQuiescent = new Function(`${quiescentCode};return nodeIsRuntimeQuiescentForRelease;`)();

const guard = "if (!isNodeRuntimeQuiescentForRelease(node))";
const allocation = "internalSubscriberCounts = new Map();";
const once = (s, a, b) => {
	assert.equal(s.split(a).length, 2, a);
	return s.replace(a, b);
};
function compile(text) {
	const js = transformSync(`class Subject { ${text} }`, { loader: "ts", target: "es2022" }).code;
	return (facts) => {
		const nodes = facts.nodes.map((n, i) => ({ ...n, name: String(i), deps: [] }));
		for (let i = 0; i < nodes.length; i++) nodes[i].deps = facts.nodes[i].deps.map((j) => nodes[j]);
		const trace = [],
			reads = { active: 0, quiescent: 0, count: 0, maps: 0 };
		const closed = new Set();
		const owners = new Map([["owner", { nodes: facts.registered.map((i) => nodes[i]) }]]);
		const registrations = new Map();
		class CountMap extends Map {
			constructor(...args) {
				super(...args);
				if (args.length === 0) reads.maps++;
			}
		}
		const C = new Function(
			"Map",
			"graphRegistrations",
			"isNodeRuntimeQuiescentForRelease",
			"isNodeActiveForRelease",
			"subscriberCountOfNode",
			"releaseRuntimeOfNode",
			"isNodeRuntimeReleased",
			"runtimeReleaseFailuresOfNode",
			`${js};return Subject;`,
		)(
			CountMap,
			registrations,
			(n) => {
				reads.quiescent++;
				return n.runtime ? actualQuiescent(n.runtime) : n.quiet;
			},
			(n) => {
				reads.active++;
				return n.active;
			},
			(n) => {
				reads.count++;
				return n.subs;
			},
			(n) => {
				trace.push(`runtime:${n.name}`);
				closed.add(n);
				if (n.fail) throw Error(`cleanup:${n.name}`);
			},
			(n) => closed.has(n),
			(n) => n.fail,
		);
		const subject = new C();
		subject._entries = new Map(
			facts.registered.map((i) => [nodes[i], { node: nodes[i], id: String(i), factory: "node" }]),
		);
		subject._byId = new Map(facts.registered.map((i) => [String(i), nodes[i]]));
		subject._retiredIds = new Set();
		subject._topologyObservers = new Set([1]);
		subject._topologyDeps = (deps) => deps.map((d) => d.name);
		subject._emitTopologyNodeReleased = (event) =>
			trace.push(`event:${event.path}:${event.deps.join(",")}`);
		registrations.set(subject, { existingConstructions: owners });
		function run(input = facts.input) {
			trace.length = 0;
			let error = null;
			try {
				subject._releaseNodes(input.map((i) => nodes[i]));
			} catch (e) {
				error = e.message;
			}
			return {
				error,
				trace: [...trace],
				registered: [...subject._byId.keys()],
				retired: [...subject._retiredIds],
				owner: owners.has("owner"),
			};
		}
		return { run, nodes, reads };
	};
}
// Independent original target-wise equation and explicit expected observable commit.
function oracle(f) {
	const members = [...new Set(f.input)].filter((i) => f.registered.includes(i));
	let error = null;
	for (const d of f.registered) {
		if (members.includes(d)) continue;
		const t = f.nodes[d].deps.find((i) => members.includes(i));
		if (t !== undefined) {
			error = `graph: cannot release node group; '${d}' still depends on '${t}' (D122)`;
			break;
		}
	}
	for (const t of members) {
		if (error) break;
		if (!f.nodes[t].quiet) {
			error = `graph: cannot release node group; '${t}' is not runtime-quiescent (D124)`;
			break;
		}
		const count = members
			.filter((d) => d !== t && f.nodes[d].active)
			.reduce((n, d) => n + f.nodes[d].deps.filter((dep) => dep === t).length, 0);
		if (f.nodes[t].subs > count)
			error = `graph: cannot release node group; '${t}' still has live subscribers (D124)`;
	}
	if (error)
		return { error, trace: [], registered: f.registered.map(String), retired: [], owner: true };
	const failed = members.find((i) => f.nodes[i].fail);
	return {
		error: failed === undefined ? null : `cleanup:${failed}`,
		trace: [
			...members.map((i) => `runtime:${i}`),
			...members.map((i) => `event:${i}:${f.nodes[i].deps.join(",")}`),
		],
		registered: f.registered.filter((i) => !members.includes(i)).map(String),
		retired: members.map(String),
		owner: failed !== undefined || f.registered.some((i) => !members.includes(i)),
	};
}
const n = (deps = [], active = false, subs = 0, quiet = true, fail = false) => ({
	deps,
	active,
	subs,
	quiet,
	fail,
});
const fact = (nodes, input = nodes.map((_, i) => i), registered = nodes.map((_, i) => i)) => ({
	nodes,
	input,
	registered,
});
const cases = [
	fact([]),
	fact([n()]),
	fact([n([0], true, 1)]),
	fact([n(), n([0], true)], [0, 0, 1, 2], [0, 1]),
	fact([n([], false, 2), n([0, 0], true)]),
	fact([n([], false, 1), n([0], false)]),
	fact([n([], false, 1), n([], false, 0, false)]),
	fact([n([], false, 1), n([], false, 0, false)], [1, 0]),
	fact([n([], false, 1), n([0], true)], [0]),
	fact([n([], false, 1), n(), n([0], true)], [0, 1, 2], [0, 1]),
	fact([n([2], true), n(), n()], [0, 1]),
	fact([n([], false, 0, true, true), n()]),
];
// Fix unknown input fixture: identity 2 exists, but is not a registered release member.
cases[3] = fact([n(), n([0], true), n()], [0, 0, 1, 2], [0, 1]);
for (let mask = 0; mask < 512; mask++) {
	const nodes = [0, 1, 2].map((i) =>
		n(
			[(i + 1) % 3, (i + 2) % 3, i].filter((_, j) => (mask >> (3 * i + j)) & 1),
			!!((mask >> i) & 1),
			(mask >> (i + 2)) % 3,
			!((mask >> (i + 4)) & 1),
		),
	);
	cases.push(fact(nodes), fact(nodes, [2, 0, 1]));
}
function qualify(factory, checkCounts = false) {
	for (const f of cases) assert.deepEqual(factory(f).run(), oracle(f));
	// The same release host is retried after a rejected first attempt; current deps/activity win.
	const f = fact([n([], false, 1), n([0], true), n([], false, 1)]);
	const host = factory(f);
	assert.deepEqual(host.run(), oracle(f));
	host.nodes[1].active = false;
	host.nodes[2].subs = 0;
	f.nodes[1].active = false;
	f.nodes[2].subs = 0;
	assert.deepEqual(host.run(), oracle(f));
	if (checkCounts) {
		for (const size of [0, 1, 2, 60]) {
			const h = factory(fact(Array.from({ length: size }, () => n())));
			assert.equal(h.run().error, null);
			assert.equal(h.reads.active, size > 1 ? size : 0);
			assert.equal(h.reads.maps, size > 1 ? 1 : 0);
			assert.equal(h.reads.quiescent, size);
		}
		const h = factory(fact([n([], false, 0, false), n()]));
		h.run();
		assert.equal(h.reads.active, 0);
		assert.equal(h.reads.maps, 0);
	}
}
qualify(compile(method), true);
const runtimeMutations = [
	(r) => {
		r._released = true;
	},
	(r) => {
		r._value.status = "dirty";
	},
	(r) => {
		r._value.status = "pending";
	},
	...["pending", "insideRunWave", "inDepMutation", "rewireRunPending", "batchDirtyOwed"].map(
		(key) => (r) => {
			r._wave[key] = 1;
		},
	),
	(r) => {
		r._dep.dirty = [true];
	},
	(r) => {
		r._control.pauseBuffer = [1];
	},
	(r) => {
		r._control.pausedDepWaveOccurred = true;
	},
	(r) => {
		r._control.demandOwed = {};
	},
	(r) => {
		r._control.activePull = {};
	},
	(r) => {
		r._control.inDeliverDemand = true;
	},
	(r) => {
		r._control.pauseLockset = new Set([1]);
	},
];
for (const mutate of runtimeMutations) {
	const runtime = {
		_released: false,
		_value: { status: "sentinel" },
		_wave: { pending: 0 },
		_dep: { dirty: [] },
		_control: { pauseBuffer: [], pauseLockset: new Set() },
	};
	assert.equal(actualQuiescent(runtime), true);
	mutate(runtime);
	const f = fact([{ ...n(), runtime }, n()]);
	const host = compile(method)(f);
	f.nodes[0].quiet = false;
	assert.deepEqual(host.run(), oracle(f));
	assert.equal(host.reads.active, 0);
	assert.equal(host.reads.maps, 0);
}

const mutants = [
	["ignore-activity", once(method, "if (!isNodeActiveForRelease(dependent)) continue;", "")],
	["include-self", once(method, "dep !== dependent && releaseSet.has(dep)", "releaseSet.has(dep)")],
	[
		"dedup-deps",
		once(method, "for (const dep of dependent.deps)", "for (const dep of new Set(dependent.deps))"),
	],
	[
		"count-unregistered-input",
		once(method, "for (const { node: dependent } of entries)", "for (const dependent of nodes)"),
	],
	[
		"cross-call-cache",
		once(method, allocation, "internalSubscriberCounts = this.cachedCounts ??= new Map();"),
	],
	["skip-quiescence", once(method, guard, "if (false)")],
	[
		"reject-equal",
		once(
			method,
			"subscriberCountOfNode(node) > internalSubscribers",
			"subscriberCountOfNode(node) >= internalSubscribers",
		),
	],
	[
		"precheck-all-quiescence",
		once(
			method,
			"let internalSubscriberCounts:",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: inserted TypeScript source, evaluated by the loaded mutant.
			"for (const {node, entry} of entries) { if (!isNodeRuntimeQuiescentForRelease(node)) throw new Error(`graph: cannot release node group; '${entry.id}' is not runtime-quiescent (D124)`); }\nlet internalSubscriberCounts:",
		),
	],
	[
		"remove-before-validation",
		once(
			method,
			"let internalSubscriberCounts:",
			"for (const {node, entry} of entries) { this._entries.delete(node); this._byId.delete(entry.id); }\nlet internalSubscriberCounts:",
		),
	],
];
for (const [name, mutant] of mutants) {
	const loaded = compile(mutant);
	assert.throws(() => qualify(loaded), assert.AssertionError, `survived: ${name}`);
}
console.log(
	JSON.stringify({
		passed: true,
		oracleCases: cases.length,
		runtimeGuardCases: runtimeMutations.length,
		sameHostRetryChecks: 2,
		complexityCases: 5,
		loadedMutants: mutants.map(([name]) => name),
		performanceSamples: 0,
	}),
);
