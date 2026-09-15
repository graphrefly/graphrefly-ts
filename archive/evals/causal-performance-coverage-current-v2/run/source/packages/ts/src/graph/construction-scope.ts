import { currentBatch } from "../batch/batch.js";
import { isWaveActive } from "../batch/boundary.js";
import type { NodeFn } from "../ctx/types.js";
import type { Node } from "../node/node.js";
import { nodeRuntimeHost } from "../node/node-runtime-host.js";
import {
	cleanupNodeAcquisition,
	type NodeAcquisition,
	type RuntimeReleaseFailure,
} from "../node/owned-acquisition.js";
import { isNodeRuntimeReleased, runtimeReleaseFailuresOfNode } from "../node/runtime-accessors.js";
import type { DescribeSnapshot } from "./describe.js";
import type { Graph } from "./graph.js";
import { type GraphLifecycleRegistrar, graphRegistrations } from "./graph-lifecycle.js";
import type { SugarOpts } from "./graph-types.js";
import { type Operator, operatorNodeFn } from "./operators.js";

export interface StartupFact {
	readonly kind: "graph-startup";
	readonly instance: string;
	readonly epoch: number;
	readonly state: "starting" | "started" | "faulted";
	readonly code?: "activation-failed" | "protocol-error";
}

export interface ConstructionManifest {
	readonly name: string;
	readonly epoch: number;
	readonly names: readonly string[];
	readonly inputs: readonly Node<unknown>[];
}

export interface RootLease {
	readonly node: Node<unknown>;
	unsubscribe?: () => void;
}

/** Resource ownership only. Domain state remains in the original authority's ctx.state. */
export interface OwnedConstruction {
	readonly instance: string;
	readonly epoch: number;
	readonly nodes: readonly Node<unknown>[];
	readonly roots: readonly RootLease[];
	readonly startup: Node<StartupFact>;
	phase: "owned" | "starting" | "started" | "faulted";
	startupError?: unknown;
	deliveryError?: unknown;
}

export class ColdConstructionError extends Error {
	constructor(
		readonly instance: string,
		readonly originalCause: unknown,
		readonly cleanupErrors: readonly {
			readonly resource: string;
			readonly cause: unknown;
			readonly handle?: RuntimeReleaseFailure["handle"];
			readonly dispatcher?: RuntimeReleaseFailure["dispatcher"];
			readonly core?: RuntimeReleaseFailure["core"];
			readonly slot?: RuntimeReleaseFailure["slot"];
		}[],
	) {
		super(
			`construction ${instance} rejected; cleanup ${cleanupErrors.length === 0 ? "complete" : "incomplete"}${originalCause instanceof Error ? `: ${originalCause.message}` : ""}`,
		);
	}
}

function stableBoundary(): void {
	if (isWaveActive() || currentBatch())
		throw new Error("construction requires a stable wave/batch boundary");
}

function checkInputs(registrar: GraphLifecycleRegistrar, inputs: readonly Node<unknown>[]): void {
	const seen = new Set<Node<unknown>>();
	const pending = [...inputs];
	while (pending.length > 0) {
		const node = pending.pop()!;
		if (seen.has(node)) continue;
		seen.add(node);
		registrar.assertRegisteredNode(node, "construction input/dependency");
		const host = nodeRuntimeHost(node);
		if (host._value.terminal !== undefined && !host._slot.resubscribable)
			throw new Error("construction input is terminal and non-resubscribable");
		pending.push(...node.deps);
	}
}

/** D161 private construction mechanism. No public begin/commit verb or ambient scope. */
export function prepareConstruction(
	graph: Graph,
	manifest: ConstructionManifest,
): ConstructionScope {
	stableBoundary();
	const registrar = graphRegistrations.get(graph);
	if (registrar === undefined) throw new Error("construction graph is not registered");
	if (
		!manifest.name ||
		manifest.name.length > 256 ||
		!Number.isSafeInteger(manifest.epoch) ||
		manifest.epoch < 1
	)
		throw new TypeError("construction needs a bounded name and positive epoch");
	if (
		manifest.names.length === 0 ||
		manifest.names.length > 4096 ||
		new Set(manifest.names).size !== manifest.names.length
	)
		throw new TypeError("construction needs a finite unique name manifest");
	for (const name of manifest.names) {
		if (!name || name.length > 512) throw new TypeError("invalid construction node name");
		registrar.assertAvailableName(name);
	}
	if (registrar.constructions.has(manifest.name))
		throw new Error("construction instance already owned");
	checkInputs(registrar, manifest.inputs);
	return new ConstructionScope(registrar, manifest);
}

export class ConstructionScope {
	private phase: "cold" | "sealed" | "transferred" | "aborted" = "cold";
	private readonly acquisitions: NodeAcquisition[] = [];
	private sealedOwner?: OwnedConstruction;
	private startupNode?: Node<StartupFact>;
	private readonly available: Set<string>;
	private readonly manifest: ConstructionManifest;
	constructor(
		private readonly registrar: GraphLifecycleRegistrar,
		manifest: ConstructionManifest,
	) {
		this.manifest = Object.freeze({
			...manifest,
			names: Object.freeze([...manifest.names]),
			inputs: Object.freeze([...manifest.inputs]),
		});
		this.available = new Set(manifest.names);
	}

	/** Private component seam: validate native construction identity without reading business DATA. */
	assertContext(graph: Graph, startup: Node<StartupFact>, epoch: number): void {
		if (
			this.phase !== "cold" ||
			graphRegistrations.get(graph) !== this.registrar ||
			startup !== this.startupNode ||
			epoch !== this.manifest.epoch
		)
			throw new TypeError("causal construction context mismatch");
	}

	node<T = unknown>(
		deps: readonly Node<unknown>[] = [],
		fn: NodeFn | null = null,
		opts: SugarOpts<T> = {},
	): Node<T> {
		if (this.phase !== "cold") throw new Error("construction is sealed");
		const name = opts.name;
		if (name === undefined || !this.available.delete(name))
			throw new Error("node is outside construction manifest");
		const acquired: NodeAcquisition = {
			name,
			dispatcher: undefined,
			handle: undefined,
			core: undefined,
			slot: undefined,
			node: undefined,
			registered: false,
		};
		this.acquisitions.push(acquired);
		return this.registrar.createOwned(deps, fn, opts, acquired);
	}

	initNode<TIn, TOut>(
		op: Operator<TIn, TOut>,
		deps: readonly Node<TIn>[],
		opts: SugarOpts<TOut> = {},
	): Node<TOut> {
		return this.node(deps, operatorNodeFn(op), {
			factory: op.factory,
			...op.opts,
			...(op.restore === undefined ? {} : { restore: op.restore }),
			...opts,
		});
	}

	startupSource(): Node<StartupFact> {
		this.startupNode = this.node([], null, {
			name: `${this.manifest.name}/startup`,
			factory: "graphConstructionStartup",
			initial: Object.freeze({
				kind: "graph-startup",
				instance: this.manifest.name,
				epoch: this.manifest.epoch,
				state: "starting",
			}),
		});
		return this.startupNode;
	}

	/** Cold inspection only: actual acquired members, never edges synthesized from the manifest. */
	readIncoming(): Pick<DescribeSnapshot, "edges"> {
		stableBoundary();
		if (this.phase !== "cold") throw new Error("construction is sealed");
		const nodes = new Set<Node<unknown>>();
		for (const record of this.acquisitions) {
			if (record.node === undefined || !record.registered)
				throw new Error("construction resource not registered");
			this.registrar.assertRegisteredNode(record.node, "inspected construction member");
			nodes.add(record.node);
		}
		return this.registrar.readIncoming(nodes);
	}

	seal(startup: Node<StartupFact>, roots: readonly Node<unknown>[]): OwnedConstruction {
		stableBoundary();
		if (this.phase !== "cold" || this.available.size !== 0)
			throw new Error("construction topology is incomplete or sealed");
		checkInputs(this.registrar, this.manifest.inputs);
		const nodes = this.acquisitions.map((record) => {
			if (record.node === undefined || !record.registered)
				throw new Error("construction resource not registered");
			this.registrar.assertRegisteredNode(record.node, "sealed construction member");
			return record.node;
		});
		if (
			startup !== this.startupNode ||
			!nodes.includes(startup) ||
			new Set(roots).size !== roots.length ||
			roots.includes(startup) ||
			roots.some((root) => !nodes.includes(root))
		)
			throw new Error("invalid construction root plan");
		this.phase = "sealed";
		this.sealedOwner = {
			instance: this.manifest.name,
			epoch: this.manifest.epoch,
			nodes: Object.freeze(nodes),
			roots: Object.freeze([startup, ...roots].map((node) => ({ node }))),
			startup,
			phase: "owned",
		};
		return this.sealedOwner;
	}

	transferToGraph(owner: OwnedConstruction): void {
		if (
			this.phase !== "sealed" ||
			owner !== this.sealedOwner ||
			owner.instance !== this.manifest.name ||
			this.registrar.constructions.has(owner.instance)
		)
			throw new Error("invalid construction ownership transfer");
		this.registrar.constructions.set(owner.instance, owner);
		this.phase = "transferred";
		// Actual Node bookkeeping and root leases now own runtime resources; discard the cold journal.
		this.acquisitions.length = 0;
	}

	abort(cause: unknown): never {
		if (this.phase === "aborted") throw new Error("construction was already aborted");
		if (this.phase === "transferred")
			throw new Error("cannot cold-abort an owned running instance");
		this.phase = "aborted";
		const errors: Array<ColdConstructionError["cleanupErrors"][number]> = [];
		const attempt = (
			resource: string,
			cleanup: () => void,
			locator: Partial<RuntimeReleaseFailure> = {},
		) => {
			try {
				cleanup();
			} catch (error) {
				errors.push({ ...locator, resource, cause: error });
			}
		};
		const registered = this.acquisitions.filter((a) => a.registered).map((a) => a.node!);
		attempt(this.manifest.name, () =>
			this.registrar.releaseNodes(registered, { reason: "cold construction failure" }),
		);
		for (const a of this.acquisitions) {
			if (a.registered) continue; // Graph release preserves external dependency safety, even on failure.
			for (const failure of cleanupNodeAcquisition(a)) {
				if (a.node === undefined || runtimeReleaseFailuresOfNode(a.node) === undefined)
					errors.push({ ...failure, resource: `${a.name}:${failure.resource}` });
			}
		}
		const detailed = this.acquisitions.flatMap((a) =>
			a.node === undefined
				? []
				: (runtimeReleaseFailuresOfNode(a.node) ?? []).map((failure) => ({
						...failure,
						resource: `${a.name}:${failure.resource}`,
					})),
		);
		if (detailed.length > 0) {
			const nodesWithFailures = new Set(
				this.acquisitions
					.filter((a) => a.node !== undefined && runtimeReleaseFailuresOfNode(a.node))
					.map((a) => a.name),
			);
			for (let i = errors.length - 1; i >= 0; i--) {
				if (
					errors[i]!.resource === this.manifest.name ||
					nodesWithFailures.has(errors[i]!.resource)
				)
					errors.splice(i, 1);
			}
			errors.push(...detailed);
		}

		throw new ColdConstructionError(this.manifest.name, cause, Object.freeze(errors));
	}
}

/** The private native lifecycle driver reports resource facts; it never approves an effect. */
export function startConstruction(graph: Graph, owner: OwnedConstruction): void {
	stableBoundary();
	if (
		graphRegistrations.get(graph)?.existingConstructions?.get(owner.instance) !== owner ||
		owner.phase !== "owned"
	)
		throw new Error("construction is not owned or was already started");
	owner.phase = "starting";
	let code: StartupFact["code"];
	try {
		for (const lease of owner.roots) {
			nodeRuntimeHost(lease.node)._subscribeOwned(() => {}, {
				record: (release) => {
					lease.unsubscribe = release;
				},
			});
			if (
				owner.nodes.some(
					(node) =>
						nodeRuntimeHost(node)._value.terminal !== undefined &&
						nodeRuntimeHost(node)._value.terminal !== true,
				)
			) {
				code = "protocol-error";
				throw new Error("construction startup encountered protocol ERROR");
			}
		}
		owner.phase = "started";
	} catch (error) {
		owner.startupError = error;
		owner.phase = "faulted";
		code ??= "activation-failed";
	}
	const fact: StartupFact = Object.freeze({
		kind: "graph-startup",
		instance: owner.instance,
		epoch: owner.epoch,
		state: owner.phase,
		...(code === undefined ? {} : { code }),
	});
	try {
		owner.startup.down([["DATA", fact]]);
	} catch (error) {
		owner.deliveryError = error;
	}
}

/** Read-only maintainer resource locator; not a policy or admission input. */
export function constructionOf(graph: Graph, name: string): OwnedConstruction | undefined {
	return graphRegistrations.get(graph)?.existingConstructions?.get(name);
}

/** Test/maintainer assertion: does not infer business lifecycle completion or dispose an instance. */
export function constructionResourcesReleased(owner: OwnedConstruction): boolean {
	return owner.nodes.every(
		(node) => isNodeRuntimeReleased(node) && !runtimeReleaseFailuresOfNode(node),
	);
}
