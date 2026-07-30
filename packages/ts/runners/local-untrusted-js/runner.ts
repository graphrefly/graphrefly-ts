import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createContext, Script, SourceTextModule } from "node:vm";
import { graph } from "../../src/graph/graph.js";
import { strictCanonicalJsonBytes } from "../../src/json/codec.js";
import type { Node } from "../../src/node/node.js";

declare const __GRAPHREFLY_TS_PACKAGE_REVISION__: string;

const COMPATIBILITY_REVISION = "graphrefly-local-untrusted-js-compute-v1";
const RUNNER_API_REVISION = "graphrefly-runner-api-v1";
const GRAPHREFLY_PACKAGE_REVISION = __GRAPHREFLY_TS_PACKAGE_REVISION__;
const INPUT_PATHS = ["/input/bundle.mjs", "/input/input.json", "/input/control.json"] as const;
const MAX_RUNNER_NODES = 1_000;
const MAX_RUNNER_EDGES = 2_000;
const SAFE_NAME = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;

interface RunnerNodePlanBase {
	readonly id: string;
	readonly name: string;
	readonly deps: readonly string[];
	readonly meta?: Record<string, unknown>;
}

interface RunnerSourceNodePlan extends RunnerNodePlanBase {
	readonly kind: "source";
	readonly value: unknown;
}

interface RunnerDerivedNodePlan extends RunnerNodePlanBase {
	readonly kind: "derived";
}

type RunnerNodePlan = RunnerSourceNodePlan | RunnerDerivedNodePlan;

interface RunnerPlan {
	readonly graphName: string;
	readonly answerNodeId: string;
	readonly nodes: readonly RunnerNodePlan[];
}

interface EvaluatedBundle {
	readonly plan: RunnerPlan;
	compute(nodeId: string, dependencyValues: readonly unknown[]): unknown;
}

interface SandboxRunnerController {
	declare(main: unknown, admittedInputJson: string): Promise<string>;
	compute(nodeId: string, dependencyValuesJson: string): string;
}

interface RunnerControl {
	readonly contractVersion: "1";
	readonly compatibilityRevision: typeof COMPATIBILITY_REVISION;
	readonly runnerApiRevision: typeof RUNNER_API_REVISION;
	readonly manifestFingerprint: string;
	readonly runAdmissionId: string;
	readonly args: {
		readonly contractVersion: "1";
		readonly runId: string;
		readonly attempt: number;
		readonly sourceRevision: string;
		readonly sourceDigest: string;
		readonly bundleRevision: string;
		readonly bundleDigest: string;
		readonly compilerRevision: string;
		readonly allowedApiRevision: string;
		readonly graphreflyPackageRevision: string;
		readonly runnerRevision: string;
		readonly runnerImageDigest: string;
		readonly admittedInputRefs: readonly string[];
		readonly inputDigest: string;
	};
}

const PRELUDE = `
(() => {
	"use strict";
	const stringify = JSON.stringify.bind(JSON);
	const parse = JSON.parse.bind(JSON);
	const freeze = Object.freeze.bind(Object);
	const keys = Object.keys.bind(Object);
	const hasOwn = Object.prototype.hasOwnProperty.call.bind(Object.prototype.hasOwnProperty);
	const nodeHandle = Symbol("graphrefly-runner-node");
	const safeName = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
	const computeById = Object.create(null);
	let declared = false;

	const cloneJson = (value, label) => {
		let encoded;
		try {
			encoded = stringify(value);
		} catch {
			throw new TypeError(label + " must be JSON data.");
		}
		if (encoded === undefined) throw new TypeError(label + " must be JSON data.");
		return parse(encoded);
	};
	const deepFreeze = (value) => {
		if (value !== null && typeof value === "object") {
			for (const key of keys(value)) deepFreeze(value[key]);
			freeze(value);
		}
		return value;
	};
	const exactNode = (value, byId) => {
		if (
			value === null ||
			typeof value !== "object" ||
			value[nodeHandle] !== true ||
			typeof value.id !== "string" ||
			!hasOwn(byId, value.id)
		) throw new TypeError("GraphReFly dependency must be a node created by this run.");
		return value;
	};
	const name = (value, label) => {
		if (typeof value !== "string" || !safeName.test(value) || value.includes("::"))
			throw new TypeError(label + " must be a safe unique name.");
		return value;
	};

	const declare = async (main, admittedInputJson) => {
		if (declared) throw new TypeError("The GraphReFly runner accepts one declaration.");
		declared = true;
		if (typeof main !== "function")
			throw new TypeError("The admitted bundle must export one default function.");
		if (typeof admittedInputJson !== "string")
			throw new TypeError("Admitted input must cross as canonical JSON text.");
		const admittedInput = parse(admittedInputJson);
		const nodes = [];
		const byId = Object.create(null);
		const names = new Set();
		let graphName = "local-code-workgraph";
		let graphDeclared = false;
		let sequence = 0;
		const add = (kind, nodeName, deps, value, meta, compute) => {
			const safeNodeName = name(nodeName, "Node name");
			if (names.has(safeNodeName)) throw new TypeError("GraphReFly node names must be unique.");
			names.add(safeNodeName);
			const id = "node-" + (++sequence);
			const plan = {
				id,
				kind,
				name: safeNodeName,
				deps: deps.map((dep) => exactNode(dep, byId).id),
				...(kind === "source" ? { value: cloneJson(value, "Source value") } : {}),
				...(meta === undefined ? {} : { meta: cloneJson(meta, "Node metadata") }),
			};
			nodes.push(plan);
			if (kind === "derived") computeById[id] = compute;
			const handle = freeze({
				[nodeHandle]: true,
				id,
				...(kind === "source"
					? { value: deepFreeze(cloneJson(plan.value, "Source value")) }
					: {}),
			});
			byId[id] = handle;
			return handle;
		};
		const api = freeze({
			graph(value) {
				if (graphDeclared) throw new TypeError("A run may declare only one GraphReFly graph.");
				graphDeclared = true;
				graphName = name(value, "Graph name");
				return graphName;
			},
			source(nodeName, value, meta) {
				return add("source", nodeName, [], value, meta);
			},
			derive(nodeName, deps, compute, meta) {
				if (!Array.isArray(deps) || typeof compute !== "function")
					throw new TypeError("GraphReFly derive needs node dependencies and a compute function.");
				const exactDeps = deps.map((dep) => exactNode(dep, byId));
				return add("derived", nodeName, exactDeps, undefined, meta, compute);
			},
			value(node) {
				const exact = exactNode(node, byId);
				if (!hasOwn(exact, "value"))
					throw new TypeError("A derived value is available only from the actual Graph runtime.");
				return exact.value;
			},
		});
		const input = deepFreeze(cloneJson(admittedInput, "Admitted input"));
		const returned = exactNode(await main(freeze({ graphrefly: api, input })), byId);
		return stringify({
			graphName,
			answerNodeId: returned.id,
			nodes,
		});
	};
		const compute = (nodeId, dependencyValuesJson) => {
			const computeFn =
				typeof nodeId === "string" && hasOwn(computeById, nodeId)
					? computeById[nodeId]
					: undefined;
			if (
				typeof nodeId !== "string" ||
				typeof computeFn !== "function" ||
				typeof dependencyValuesJson !== "string"
			) throw new TypeError("GraphReFly derived computation is unavailable.");
			const dependencyValues = deepFreeze(
				cloneJson(parse(dependencyValuesJson), "Derived dependency values"),
			);
			if (!Array.isArray(dependencyValues))
				throw new TypeError("Derived dependency values must be an array.");
			const value = Reflect.apply(computeFn, undefined, dependencyValues);
		if (value !== null && (typeof value === "object" || typeof value === "function")) {
			if (typeof value.then === "function")
				throw new TypeError("GraphReFly derive must be synchronous.");
		}
		return stringify(cloneJson(value, "Derived value"));
	};
	const controller = freeze({ declare, compute });
	for (const intrinsic of [
		Object,
		Array,
		Function,
		Promise,
		Map,
		Set,
		WeakMap,
		WeakSet,
		RegExp,
		Date,
		Error,
		TypeError,
		Number,
		String,
		Boolean,
		Symbol,
		BigInt,
		JSON,
		Math,
		Reflect,
	]) {
		if (intrinsic && intrinsic.prototype) freeze(intrinsic.prototype);
		freeze(intrinsic);
	}
	return controller;
})();
`;

function record(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function exactKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
	label: string,
): void {
	const observed = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (observed.length !== wanted.length || observed.some((key, index) => key !== wanted[index]))
		throw new TypeError(`${label} has an invalid shape.`);
}

function safeString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value.length > 512)
		throw new TypeError(`${label} is invalid.`);
	return value;
}

function digest(value: unknown, label: string): string {
	const text = safeString(value, label);
	if (!/^sha256:[a-f0-9]{64}$/.test(text)) throw new TypeError(`${label} is invalid.`);
	return text;
}

function parseControl(value: unknown): RunnerControl {
	if (!record(value)) throw new TypeError("Runner control must be an object.");
	exactKeys(
		value,
		[
			"contractVersion",
			"compatibilityRevision",
			"runnerApiRevision",
			"manifestFingerprint",
			"args",
			"runAdmissionId",
		],
		"Runner control",
	);
	if (
		value.contractVersion !== "1" ||
		value.compatibilityRevision !== COMPATIBILITY_REVISION ||
		value.runnerApiRevision !== RUNNER_API_REVISION ||
		!record(value.args) ||
		value.args.graphreflyPackageRevision !== GRAPHREFLY_PACKAGE_REVISION
	)
		throw new TypeError("Runner control identity is invalid.");
	safeString(value.manifestFingerprint, "Manifest fingerprint");
	safeString(value.runAdmissionId, "Run admission id");
	const args = value.args;
	for (const key of [
		"runId",
		"sourceRevision",
		"bundleRevision",
		"compilerRevision",
		"allowedApiRevision",
		"graphreflyPackageRevision",
		"runnerRevision",
	] as const)
		safeString(args[key], key);
	for (const key of ["sourceDigest", "bundleDigest", "runnerImageDigest", "inputDigest"] as const)
		digest(args[key], key);
	if (
		args.contractVersion !== "1" ||
		!Number.isSafeInteger(args.attempt) ||
		(args.attempt as number) < 1 ||
		!Array.isArray(args.admittedInputRefs) ||
		args.admittedInputRefs.length === 0 ||
		args.admittedInputRefs.some((entry) => typeof entry !== "string" || entry.length === 0)
	)
		throw new TypeError("Runner arguments are invalid.");
	return value as unknown as RunnerControl;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
	try {
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw new TypeError(`${label} must be valid JSON.`);
	}
}

function parsePlan(value: unknown): RunnerPlan {
	if (!record(value)) throw new TypeError("Runner plan must be an object.");
	exactKeys(value, ["graphName", "answerNodeId", "nodes"], "Runner plan");
	if (
		typeof value.graphName !== "string" ||
		!SAFE_NAME.test(value.graphName) ||
		value.graphName.includes("::") ||
		typeof value.answerNodeId !== "string" ||
		!Array.isArray(value.nodes) ||
		value.nodes.length === 0 ||
		value.nodes.length > MAX_RUNNER_NODES
	)
		throw new TypeError("Runner plan identity or node bound is invalid.");
	const ids = new Set<string>();
	const names = new Set<string>();
	let edgeCount = 0;
	const nodes: RunnerNodePlan[] = value.nodes.map((entry) => {
		if (!record(entry)) throw new TypeError("Runner plan node must be an object.");
		const expected =
			entry.kind === "source"
				? entry.meta === undefined
					? ["id", "kind", "name", "deps", "value"]
					: ["id", "kind", "name", "deps", "value", "meta"]
				: entry.meta === undefined
					? ["id", "kind", "name", "deps"]
					: ["id", "kind", "name", "deps", "meta"];
		exactKeys(entry, expected, "Runner plan node");
		if (
			typeof entry.id !== "string" ||
			!/^node-[1-9][0-9]*$/.test(entry.id) ||
			ids.has(entry.id) ||
			(entry.kind !== "source" && entry.kind !== "derived") ||
			typeof entry.name !== "string" ||
			!SAFE_NAME.test(entry.name) ||
			entry.name.includes("::") ||
			names.has(entry.name) ||
			!Array.isArray(entry.deps) ||
			entry.deps.some((dep) => typeof dep !== "string" || !ids.has(dep)) ||
			(entry.kind === "source" && entry.deps.length !== 0) ||
			(entry.kind === "derived" && entry.deps.length === 0)
		)
			throw new TypeError("Runner plan node identity or dependency is invalid.");
		ids.add(entry.id);
		names.add(entry.name);
		edgeCount += entry.deps.length;
		if (edgeCount > MAX_RUNNER_EDGES) throw new TypeError("Runner plan edge bound is invalid.");
		const canonical = JSON.parse(
			new TextDecoder().decode(strictCanonicalJsonBytes(entry)),
		) as RunnerNodePlan;
		return canonical;
	});
	if (!ids.has(value.answerNodeId))
		throw new TypeError("Runner answer must identify a node created by this run.");
	return { graphName: value.graphName, answerNodeId: value.answerNodeId, nodes };
}

async function evaluateBundle(bundleSource: string, input: unknown): Promise<EvaluatedBundle> {
	const context = createContext(Object.create(null), {
		codeGeneration: { strings: false, wasm: false },
		name: "graphrefly-local-untrusted-js",
	});
	const controller = new Script(PRELUDE, {
		filename: "graphrefly-runner-prelude.js",
	}).runInContext(context) as SandboxRunnerController;
	const rejectDynamicImport = new Script(
		`() => Promise.reject(
			new TypeError("Dynamic imports are not admitted by the GraphReFly runner API."),
		)`,
		{
			filename: "graphrefly-runner-import-policy.js",
		},
	).runInContext(context) as () => Promise<never>;
	const userModule = new SourceTextModule(bundleSource, {
		context,
		identifier: "graphrefly:user-bundle",
		initializeImportMeta(meta) {
			Object.freeze(meta);
		},
		importModuleDynamically() {
			return rejectDynamicImport();
		},
	});
	await userModule.link(() => {
		throw new TypeError("Imports are not admitted by the GraphReFly runner API.");
	});
	await userModule.evaluate();
	const main = Reflect.get(userModule.namespace, "default");
	const declare = Reflect.get(controller, "declare");
	const encoded = await Reflect.apply(declare, undefined, [
		main,
		new TextDecoder().decode(strictCanonicalJsonBytes(input)),
	]);
	if (typeof encoded !== "string") throw new TypeError("Runner plan serialization failed.");
	const plan = parsePlan(JSON.parse(encoded));
	const compute = Reflect.get(controller, "compute");
	return {
		plan,
		compute(nodeId, dependencyValues) {
			const computed = Reflect.apply(compute, undefined, [
				nodeId,
				new TextDecoder().decode(strictCanonicalJsonBytes(dependencyValues)),
			]);
			if (typeof computed !== "string")
				throw new TypeError("Runner derived result serialization failed.");
			const value = JSON.parse(computed) as unknown;
			strictCanonicalJsonBytes(value);
			return value;
		},
	};
}

function materializeResult(
	evaluated: EvaluatedBundle,
	control: RunnerControl,
): Record<string, unknown> {
	const { plan } = evaluated;
	const runtimeGraph = graph({ name: plan.graphName });
	const group = runtimeGraph.topologyGroup({ name: "local-untrusted-js-runner" });
	const nodes = new Map<string, Node<unknown>>();
	const releases: Array<() => void> = [];
	let result: Record<string, unknown> | undefined;
	let failure: unknown;
	let cleanupFailure: Error | undefined;
	try {
		for (const node of plan.nodes) {
			const opts =
				node.meta === undefined ? { name: node.name } : { name: node.name, meta: node.meta };
			if (node.kind === "source") {
				nodes.set(node.id, group.state(node.value, opts));
				continue;
			}
			const deps = node.deps.map((id) => {
				const dep = nodes.get(id);
				if (dep === undefined) throw new TypeError("Runner plan dependency is unavailable.");
				return dep;
			});
			const derived = group.derived(
				deps,
				(...dependencyValues) => evaluated.compute(node.id, dependencyValues),
				opts,
			);
			nodes.set(node.id, derived);
		}
		const answerNode = nodes.get(plan.answerNodeId);
		if (answerNode === undefined) throw new TypeError("Runner answer node is unavailable.");
		const answerPlan = plan.nodes.find((node) => node.id === plan.answerNodeId);
		if (answerPlan === undefined) throw new TypeError("Runner answer plan is unavailable.");
		releases.push(runtimeGraph.retain(answerNode, { reason: "local untrusted JS runner answer" }));
		if (answerNode.cache === undefined)
			throw new TypeError("Runner answer node did not produce a Graph value.");
		const answer = JSON.parse(
			new TextDecoder().decode(strictCanonicalJsonBytes(answerNode.cache)),
		) as unknown;
		const topology = runtimeGraph.topology();
		const describe = runtimeGraph.describe();
		result = {
			contractVersion: "1",
			answer,
			topology,
			describe,
			provenance: {
				sourceRevision: control.args.sourceRevision,
				sourceDigest: control.args.sourceDigest,
				bundleRevision: control.args.bundleRevision,
				bundleDigest: control.args.bundleDigest,
				compilerRevision: control.args.compilerRevision,
				allowedApiRevision: control.args.allowedApiRevision,
				graphreflyPackageRevision: GRAPHREFLY_PACKAGE_REVISION,
				runnerRevision: control.args.runnerRevision,
				runnerImageDigest: control.args.runnerImageDigest,
				manifestFingerprint: control.manifestFingerprint,
				runId: control.args.runId,
				attempt: control.args.attempt,
				graphName: plan.graphName,
				answerNodeId: answerPlan.name,
				admittedInputRefs: [...control.args.admittedInputRefs],
				inputDigest: control.args.inputDigest,
				runAdmissionId: control.runAdmissionId,
			},
			cleanup: {
				graphNodesAfterDispose: 0,
				graphEdgesAfterDispose: 0,
			},
		};
	} catch (error) {
		failure = error;
	} finally {
		for (const release of releases.reverse()) release();
		group.release({ reason: "local untrusted JS runner settled" });
		const after = runtimeGraph.topology();
		if (after.nodes.length !== 0 || after.edges.length !== 0 || after.subgraphs !== undefined)
			cleanupFailure = new Error("Runner Graph did not dispose to 0N/0E.");
	}
	if (failure !== undefined) throw failure;
	if (cleanupFailure !== undefined) throw cleanupFailure;
	if (result === undefined) throw new Error("Runner result was not materialized.");
	return result;
}

async function main(): Promise<void> {
	if (
		process.argv.length !== 5 ||
		INPUT_PATHS.some((path, index) => process.argv[index + 2] !== path)
	)
		throw new TypeError("Runner requires the fixed bundle, input and control paths.");
	const [bundleBytes, inputBytes, controlBytes] = await Promise.all(
		INPUT_PATHS.map((path) => readFile(path)),
	);
	const control = parseControl(parseJson(controlBytes, "Runner control"));
	const observedBundleDigest = `sha256:${createHash("sha256").update(bundleBytes).digest("hex")}`;
	const observedInputDigest = `sha256:${createHash("sha256")
		.update(strictCanonicalJsonBytes(parseJson(inputBytes, "Admitted input")))
		.digest("hex")}`;
	if (
		observedBundleDigest !== control.args.bundleDigest ||
		observedInputDigest !== control.args.inputDigest
	)
		throw new TypeError("Runner material digest mismatch.");
	const input = parseJson(inputBytes, "Admitted input");
	const evaluated = await evaluateBundle(new TextDecoder().decode(bundleBytes), input);
	const result = materializeResult(evaluated, control);
	process.stdout.write(strictCanonicalJsonBytes(result));
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : "Local untrusted JS runner failed.";
	process.stderr.write(`${message}\n`);
	process.exitCode = 1;
});
