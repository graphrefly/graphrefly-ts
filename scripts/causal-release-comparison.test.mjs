/** Loaded tooling tests only. Fake factories/clocks; no runtime consumer imported or timed. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";

const driverSource = readFileSync(
	new URL("./causal-release-comparison-driver.mjs", import.meta.url),
	"utf8",
);
const wrapperSource = readFileSync(
	new URL("./fixtures/causal-release-comparison.ts", import.meta.url),
	"utf8",
);
const load = async (source) =>
	import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const once = (s, a, b) => {
	assert.equal(s.split(a).length, 2, a);
	return s.replace(a, b);
};
const driver = await load(driverSource);
const rows = ["P2-lifecycle", "inactive-60", "active-diamond-5", "inactive-2", "inactive-1"];
function fake(row, fail = {}) {
	const trace = [];
	let cleanup = 0;
	const event = (x) => {
		trace.push(x);
		if (fail[x]) throw Error(x);
	};
	const run = {
		send: (step) => event(`send${step}`),
		cleanup() {
			cleanup++;
			event("cleanup");
		},
		release() {
			event("release");
			if (row === "active-diamond-5") throw Error("expected");
		},
		validate(e) {
			event("micro-validate");
			assert.equal(Boolean(e), row === "active-diamond-5");
		},
		finished() {
			event("finished");
		},
	};
	const mod = {
		candidate() {
			event("factory");
			return run;
		},
		duplicate() {
			event("duplicate");
			return [6];
		},
		occurrence() {
			event("occurrence");
			return 1;
		},
		graphSnapshot() {
			event("snapshot");
			return { ok: true };
		},
		validate() {
			event("validate");
		},
		micro() {
			event("setup");
			return run;
		},
	};
	let i = 0;
	const now = () => {
		event("clock" + i);
		return ++i;
	};
	return {
		trace,
		mod,
		now,
		get cleanup() {
			return cleanup;
		},
	};
}
function checkDriver(d) {
	for (const row of rows) {
		const f = fake(row),
			result = d.sample(f.mod, row, { steps: [0, 1, 2, 3, 4, 5] }, { ok: true }, f.now);
		const expected =
			row === rows[0]
				? [
						"duplicate",
						"clock0",
						"factory",
						"clock1",
						"clock2",
						"send0",
						"send1",
						"send2",
						"send3",
						"send4",
						"send5",
						"clock3",
						"occurrence",
						"clock4",
						"send6",
						"clock5",
						"occurrence",
						"snapshot",
						"clock6",
						"cleanup",
						"clock7",
						"validate",
					]
				: ["setup", "clock0", "release", "clock1", "micro-validate", "cleanup", "finished"];
		assert.deepEqual(f.trace, expected);
		assert.equal(f.cleanup, 1);
		assert.equal(result.clocks.length, row === rows[0] ? 8 : 2);
	}
	for (const variant of ["U", "V"]) {
		const coords = d.coordinates(variant);
		assert.equal(coords.length, 2400);
		for (let n = 0; n < 2400; n++)
			assert.deepEqual(coords[n], {
				block: Math.floor(n / 800),
				position: Math.floor((n % 800) / 400),
				slot: (Math.floor(n / 800) + Math.floor((n % 800) / 400) + (variant === "V" ? 1 : 0)) % 2,
				index: n % 400,
				phase: n % 400 < 100 ? "warmup" : "measured",
			});
	}
	for (let i = 0; i < 8; i++) {
		const f = fake(rows[0], { ["clock" + i]: true });
		assert.throws(() => d.sample(f.mod, rows[0], { steps: [0, 1, 2, 3, 4, 5] }, null, f.now));
		assert.equal(f.cleanup, i === 0 ? 0 : 1, "clock failure cleanup exactly once");
	}
	for (const row of rows) {
		const f = fake(row, { cleanup: true });
		assert.throws(
			() => d.sample(f.mod, row, { steps: [0, 1, 2, 3, 4, 5] }, null, f.now),
			/sample failed/,
		);
		assert.equal(f.cleanup, 1);
	}
	const f = fake(rows[0]);
	assert.throws(
		() => d.sample(f.mod, rows[0], { steps: [0, 1, 2, 3, 4, 5] }, null, () => NaN),
		/clock/,
	);
	assert.equal(f.cleanup, 1);
}
checkDriver(driver);
const driverMutations = [
	["missing factory", "run = mod.candidate();", "run = undefined;"],
	["double factory", "run = mod.candidate();", "mod.candidate(); run = mod.candidate();"],
	["missing cleanup", "run.cleanup();\n\t\t\treleaseCompleted = true;", "releaseCompleted = true;"],
	[
		"double cleanup",
		"run.cleanup();\n\t\t\treleaseCompleted = true;",
		"run.cleanup(); run.cleanup();\n\t\t\treleaseCompleted = true;",
	],
	[
		"factory outside boundary",
		"tick();\n\t\t\trun = mod.candidate();\n\t\t\ttick();",
		"run = mod.candidate(); tick(); tick();",
	],
	[
		"snapshot inside boundary",
		"snapshot = mod.graphSnapshot(run);\n\t\t\ttick();",
		"tick(); snapshot = mod.graphSnapshot(run);",
	],
	["swallowed cleanup", "cleanupError = e;", "cleanupError = undefined;"],
	["missing last block", "block < 3", "block<2"],
	["same order V", 'variant === "V" ? 1 : 0', 'variant === "V" ? 0 : 0'],
];
for (const [name, a, b] of driverMutations) {
	const mutated = await load(once(driverSource, a, b));
	assert.throws(() => checkDriver(mutated), undefined, name);
}
// Compile actual wrapper against a countable ordinary Graph API-shaped host.
function checkWrapper(source) {
	const code = transformSync(source, { loader: "ts", format: "cjs" }).code;
	const business = [];
	let nodes = [],
		external = false,
		released = false,
		releaseCalls = 0;
	class Host {
		topologyGroup() {
			const node = (value) => {
				const n = {
					value,
					subscribe(fn) {
						external = true;
						fn(["DATA", value]);
						return () => {
							external = false;
						};
					},
				};
				nodes.push(n);
				return n;
			};
			return {
				state: node,
				derived: (deps, fn) => node(fn(...deps.map((x) => x.value))),
				get released() {
					return released;
				},
				release() {
					releaseCalls++;
					if (external) throw Error("'join' still has live subscribers");
					released = true;
					nodes = [];
				},
			};
		}
		describe() {
			return { nodes: [...nodes] };
		}
	}
	const exports = {},
		module = { exports };
	const graphArm = (arm, mode) => {
		business.push([arm, mode]);
		return {};
	};
	const require = (name) =>
		name === "node:assert/strict"
			? assert
			: name.includes("/graph/graph")
				? { Graph: Host }
				: name.includes("worker")
					? { graphSnapshot: () => ({}), preflight: () => ({ expected: {} }) }
					: { graphArm, schedule: () => ({ action: [] }) };
	new Function("require", "module", "exports", code)(require, module, exports);
	const fixture = module.exports;
	fixture.candidate();
	assert.deepEqual(business, [["candidate", "summary"]]);
	for (const row of rows.slice(1)) {
		nodes = [];
		external = false;
		released = false;
		releaseCalls = 0;
		const run = fixture.micro(row);
		assert.equal(
			nodes.length,
			{ "inactive-60": 60, "active-diamond-5": 5, "inactive-2": 2, "inactive-1": 1 }[row],
		);
		let error;
		try {
			run.release();
		} catch (e) {
			error = e;
		}
		run.validate(error);
		run.cleanup();
		run.finished();
		assert.equal(releaseCalls, row === "active-diamond-5" ? 2 : 1);
	}
}
checkWrapper(wrapperSource);
assert.throws(() =>
	checkWrapper(
		once(wrapperSource, 'graphArm("candidate", "summary")', 'graphArm("reference", "summary")'),
	),
);
console.log(
	JSON.stringify({
		passed: true,
		realPerformanceSamples: 0,
		rows: 5,
		driverLoadedMutants: driverMutations.length,
		wrapperLoadedMutants: 1,
		clockFailurePositions: 8,
		coordinateChecks: 4800,
	}),
);

// Execute the actual child entry in an in-memory host, including all five row shapes.
const childSource = readFileSync(
	new URL("./causal-release-comparison-child.mjs", import.meta.url),
	"utf8",
);
const { createHash } = await import("node:crypto");
const path = (await import("node:path")).default;
const { pathToFileURL } = await import("node:url");
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
async function checkChild(source) {
	for (const row of rows) {
		const files = new Map(),
			factoryCalls = [],
			preflightCalls = [],
			loads = [];
		const root = "/fake/run",
			entryPath = root + "/jobs/00/entry.json";
		const hash = (b) => createHash("sha256").update(b).digest("hex");
		const input = Buffer.from(JSON.stringify({ steps: [0, 1, 2, 3, 4, 5] }));
		const modules = ["B.mjs", "C.mjs"];
		const moduleDigests = {};
		for (const name of modules) {
			const bytes = Buffer.from(name);
			files.set(root + "/" + name, bytes);
			moduleDigests[name] = hash(bytes);
		}
		files.set(root + "/P2-inputs.json", input);
		files.set(
			entryPath,
			Buffer.from(
				JSON.stringify({ row, variant: "U", modules, moduleDigests, inputDigest: hash(input) }),
			),
		);
		const fakes = modules.map((name) => {
			const run = {
				send() {},
				cleanup() {},
				release() {
					if (row === "active-diamond-5") throw Error("expected");
				},
				validate(e) {
					assert.equal(Boolean(e), row === "active-diamond-5");
				},
				finished() {},
			};
			return {
				candidate() {
					factoryCalls.push(name);
					return run;
				},
				micro() {
					factoryCalls.push(name);
					return run;
				},
				duplicate() {
					return [6];
				},
				occurrence() {
					return 1;
				},
				graphSnapshot() {
					return { z: 1, a: { b: 2, a: 1 } };
				},
				validate(_r, actual, expected) {
					assert.deepEqual(actual, expected);
				},
				preflights() {
					preflightCalls.push(name);
					return { expected: { a: { a: 1, b: 2 }, z: 1 } };
				},
			};
		});
		const fakeProcess = {
			argv: ["node", "child", entryPath],
			execArgv: [],
			env: {},
			pid: 123,
			version: "fake",
			versions: { v8: "fake" },
			platform: "fake",
			arch: "fake",
			execPath: "node",
		};
		const writeFileSync = (file, content, options) => {
			if (options?.flag === "wx") assert.equal(files.has(file), false);
			files.set(file, Buffer.from(content));
		};
		const appendFileSync = (file, content) =>
			files.set(file, Buffer.concat([files.get(file) ?? Buffer.alloc(0), Buffer.from(content)]));
		const readFileSync = (file) => {
			assert.ok(files.has(file), file);
			return files.get(file);
		};
		let clock = 0;
		const body = source
			.replace(/^import[\s\S]*?;\n/gm, "")
			.replace("await import(pathToFileURL(file).href)", "await load(pathToFileURL(file).href)");
		const names = [
			"assert",
			"readFileSync",
			"writeFileSync",
			"appendFileSync",
			"createHash",
			"performance",
			"pathToFileURL",
			"path",
			"sample",
			"coordinates",
			"process",
			"load",
		];
		const load = async (url) => {
			const name = path.basename(new URL(url).pathname);
			loads.push(name);
			return fakes[modules.indexOf(name)];
		};
		await new AsyncFunction(...names, body)(
			assert,
			readFileSync,
			writeFileSync,
			appendFileSync,
			createHash,
			{ now: () => ++clock },
			pathToFileURL,
			path,
			driver.sample,
			driver.coordinates,
			fakeProcess,
			load,
		);
		assert.equal(
			fakeProcess.exitCode,
			undefined,
			files.get(root + "/jobs/00/failure.json")?.toString(),
		);
		assert.deepEqual(loads, modules);
		assert.deepEqual(factoryCalls.slice(0, 2), modules);
		assert.deepEqual(
			factoryCalls.slice(2),
			driver.coordinates("U").map((c) => modules[c.slot]),
		);
		assert.deepEqual(preflightCalls, row === rows[0] ? modules : []);
		const records = files
			.get(root + "/jobs/00/samples.jsonl")
			.toString()
			.trim()
			.split("\n")
			.map(JSON.parse);
		assert.equal(records.length, 2400);
		if (row === rows[0]) {
			const pre = JSON.parse(files.get(root + "/jobs/00/preflight.json"));
			assert.equal(records[0].snapshotDigest, hash(pre.expectedJSON[0]));
		}
	}
}
await checkChild(childSource);
const childMutations = [
	[
		"reverse module load",
		"modules.push(await import(pathToFileURL(file).href));",
		"modules.unshift(await import(pathToFileURL(file).href));",
	],
	["wrong sample slot", "modules[coordinate.slot],", "modules[1-coordinate.slot],"],
	[
		"missing factory sample",
		"for (const coordinate of coordinates(entry.variant))",
		"for (const coordinate of coordinates(entry.variant).slice(1))",
	],
	[
		"extra preflight",
		"const pre = mod.preflights(scenario);",
		"mod.preflights(scenario); const pre = mod.preflights(scenario);",
	],
	[
		"noncanonical snapshot",
		"digest(JSON.stringify(canonical(result.snapshot)))",
		"digest(JSON.stringify(result.snapshot))",
	],
];
for (const [name, a, b] of childMutations) {
	await assert.rejects(() => checkChild(once(childSource, a, b)), undefined, name);
}
console.log(
	JSON.stringify({
		passed: true,
		childRows: 5,
		childLoadedMutants: childMutations.length,
		fakeSamples: 12000,
		realPerformanceSamples: 0,
	}),
);

// Post-attempt repair: real esbuild resolver handshake, virtual constant only (no Graph imports).
const ts = (await import("typescript")).default;
const { build } = await import("esbuild");
async function checkResolver(source) {
	const ast = ts.createSourceFile(
		"builder.mjs",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS,
	);
	let handler;
	function visit(node) {
		if (ts.isCallExpression(node) && node.expression.getText(ast) === "api.onResolve")
			handler = node.arguments[1].getText(ast);
		ts.forEachChild(node, visit);
	}
	visit(ast);
	assert.ok(handler);
	const virtual = "scripts/fixtures/causal-release-comparison.ts";
	const resolve = new Function("assert", "path", "closure", `return (${handler});`)(assert, path, {
		[virtual]: {},
	});
	const outputs = [];
	for (const entry of [virtual, "./" + virtual]) {
		const result = await build({
			entryPoints: [entry],
			bundle: true,
			write: false,
			format: "esm",
			platform: "node",
			logLevel: "silent",
			plugins: [
				{
					name: "countable-resolver",
					setup(api) {
						api.onResolve({ filter: /.*/ }, resolve);
						api.onLoad({ filter: /.*/, namespace: "snapshot" }, (args) => {
							assert.equal(args.path, virtual);
							return { contents: "export const sentinel = 17;", loader: "ts" };
						});
					},
				},
			],
		});
		outputs.push(result.outputFiles[0].text);
	}
	assert.equal(outputs[0], outputs[1]);
}
for (const name of [
	"build-causal-release-comparison.mjs",
	"rebuild-causal-release-comparison.mjs",
]) {
	const source = readFileSync(new URL("./" + name, import.meta.url), "utf8");
	await checkResolver(source);
	await assert.rejects(() =>
		checkResolver(once(source, "? path.posix.normalize(args.path)", "? args.path")),
	);
}
console.log(
	JSON.stringify({
		passed: true,
		postAttemptRepair: true,
		loadedResolverMutants: 2,
		virtualBuildOnly: true,
		realConsumerFactories: 0,
		performanceSamples: 0,
	}),
);

// Loaded guard regression: retained default-off recorder is not measurement instrumentation.
const clockBuilder = readFileSync(
	new URL("./build-causal-release-comparison.mjs", import.meta.url),
	"utf8",
);
const clockAst = ts.createSourceFile(
	"builder.mjs",
	clockBuilder,
	ts.ScriptTarget.Latest,
	true,
	ts.ScriptKind.JS,
);
const clockFunction = clockAst.statements.find(
	(n) => ts.isFunctionDeclaration(n) && n.name?.text === "verifyUninstrumented",
);
assert.ok(clockFunction);
const verifyClocks = new Function(
	"assert",
	"ts",
	"transformSync",
	`${clockFunction.getText(clockAst)};return verifyUninstrumented;`,
)(assert, ts, transformSync);
const dispatcherSource = readFileSync(
	new URL("../packages/ts/src/dispatcher/index.ts", import.meta.url),
	"utf8",
);
const dispatcherJS = transformSync(dispatcherSource, { loader: "ts", target: "node24" }).code;
verifyClocks(dispatcherJS, dispatcherSource);
for (const mutation of [
	dispatcherJS + "\nperformance.now();",
	dispatcherJS.replace("if (!this._recording)", "if (this._recording)"),
	dispatcherJS.replace("const t0 = performance.now();", "const t0 = 0;"),
	dispatcherJS + "\nconst clockAlias = performance.now;",
	dispatcherJS + "\nglobalThis.performance.now();",
	dispatcherJS + '\nperformance["now"]();',
	dispatcherJS + '\nglobalThis["performance"].now();',
])
	assert.throws(() => verifyClocks(mutation, dispatcherSource));
// Execute only the actual invoke method on a countable host, not a Graph/consumer instance.
const dispatcherAst = ts.createSourceFile(
	"dispatcher.js",
	dispatcherJS,
	ts.ScriptTarget.Latest,
	true,
	ts.ScriptKind.JS,
);
let invokeMethod;
function locateInvoke(n) {
	if (
		ts.isMethodDeclaration(n) &&
		n.name.getText(dispatcherAst) === "invoke" &&
		n.getText(dispatcherAst).includes("_recording")
	)
		invokeMethod = n.getText(dispatcherAst);
	ts.forEachChild(n, locateInvoke);
}
locateInvoke(dispatcherAst);
assert.ok(invokeMethod);
let clockReads = 0,
	poolCalls = 0;
const invoke = new Function(
	"performance",
	"dispatcherHandleStatKey",
	`return ({${invokeMethod}}).invoke;`,
)({ now: () => ++clockReads }, () => "fake");
const host = {
	_recording: false,
	pools: [
		{
			invoke() {
				poolCalls++;
			},
		},
	],
	_totalInvokes: 0,
	_stats: new Map(),
};
invoke.call(host, { poolId: 0, handleId: 0 }, {});
assert.equal(clockReads, 0);
assert.equal(poolCalls, 1);
host._recording = true;
invoke.call(host, { poolId: 0, handleId: 0 }, {});
assert.equal(clockReads, 2);
assert.equal(poolCalls, 2);
console.log(
	JSON.stringify({
		passed: true,
		clockGuardMutants: 7,
		recorderOffClockReads: 0,
		recorderOnClockReads: 2,
		realConsumerFactories: 0,
	}),
);
