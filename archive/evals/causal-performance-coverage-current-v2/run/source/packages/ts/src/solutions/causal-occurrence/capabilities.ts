import { depBatch } from "../../ctx/types.js";
import type { DataIssue } from "../../data/index.js";
import type { ConstructionScope, StartupFact } from "../../graph/construction-scope.js";
import type { Graph } from "../../graph/graph.js";
import type { Node } from "../../node/node.js";
import type {
	CausalCurrentness,
	CausalEffectConservation,
	CausalEvidenceCoverage,
	CausalOccurrence,
	CausalOccurrenceBundle,
	CausalQuiescence,
	CausalTerminalFanIn,
} from "./contracts.js";

export interface CausalBinding {
	readonly contract: "contract-v2";
	readonly implementationRevision: "construction-v1";
	readonly scope: "full";
	readonly epoch: number;
}
export interface IdentityCapability<T> {
	readonly released: Node<CausalOccurrence<T>>;
	readonly currentness: Node<CausalCurrentness>;
	readonly issues: Node<DataIssue>;
}
export interface ExecutionCapability<T> {
	readonly identity: IdentityCapability<T>;
	readonly terminals: Node<CausalTerminalFanIn>;
	readonly conservation: Node<CausalEffectConservation>;
	readonly causalQuiescence: Node<Omit<CausalQuiescence, "retainedEvidence">>;
}
export interface RetainedEvidenceCapability<T> {
	readonly execution: ExecutionCapability<T>;
	readonly coverage: Node<CausalEvidenceCoverage>;
	readonly retainedQuiescence: Node<CausalQuiescence>;
}
export interface FullCausalCapability<T> {
	readonly identity: IdentityCapability<T>;
	readonly execution: ExecutionCapability<T>;
	readonly retained: RetainedEvidenceCapability<T>;
	readonly startup: Node<StartupFact>;
}

interface Issued {
	readonly graph: Graph;
	readonly instance: object;
	readonly binding: CausalBinding;
	readonly level: string;
}
const issued = new WeakMap<object, Issued>();

export function causalBinding(binding: CausalBinding): CausalBinding {
	if (
		binding.contract !== "contract-v2" ||
		binding.implementationRevision !== "construction-v1" ||
		binding.scope !== "full" ||
		!Number.isSafeInteger(binding.epoch) ||
		binding.epoch < 1 ||
		Object.keys(binding).length !== 4
	)
		throw new TypeError("unsupported causal binding or lifecycle epoch");
	return Object.freeze({ ...binding });
}

/** Exact issued-object validation; a structural cast or copied lower handle is not an issued capability. */
export function assertCausalCapabilities<T>(
	graph: Graph,
	full: FullCausalCapability<T>,
	binding: CausalBinding,
): void {
	const root = issued.get(full);
	if (
		root === undefined ||
		root.graph !== graph ||
		root.level !== "full" ||
		root.binding.contract !== binding.contract ||
		root.binding.implementationRevision !== binding.implementationRevision ||
		root.binding.scope !== binding.scope ||
		root.binding.epoch !== binding.epoch
	)
		throw new TypeError("causal capability binding mismatch");
	for (const handle of [full.identity, full.execution, full.retained]) {
		const record = issued.get(handle);
		if (record === undefined || record.instance !== root.instance || record.graph !== graph)
			throw new TypeError("causal capability lineage mismatch");
	}
	if (full.execution.identity !== full.identity || full.retained.execution !== full.execution)
		throw new TypeError("causal capability lower handle mismatch");
}

export function createCausalCapabilities<T>(
	graph: Graph,
	scope: ConstructionScope,
	name: string,
	ports: CausalOccurrenceBundle<T>,
	binding: CausalBinding,
): FullCausalCapability<T> {
	const causalQuiescence = scope.node<Omit<CausalQuiescence, "retainedEvidence">>(
		[ports.quiescence],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const value = raw as CausalQuiescence;
				// Explicit payload projection, not a type cast over retained evidence.
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: value.kind,
							revisionDomain: value.revisionDomain,
							evaluatedThroughRevision: value.evaluatedThroughRevision,
							lifecycle: value.lifecycle,
							pendingOccurrenceRefs: value.pendingOccurrenceRefs,
							pendingEffectIds: value.pendingEffectIds,
						}),
					],
				]);
			}
		},
		{ name: `${name}/causal-quiescence`, factory: "causalLifecycleQuiescence" },
	);
	const identity = Object.freeze({
		released: ports.released,
		currentness: ports.currentness,
		issues: ports.issues,
	});
	const execution = Object.freeze({
		identity,
		terminals: ports.terminals,
		conservation: ports.conservation,
		causalQuiescence,
	});
	const retained = Object.freeze({
		execution,
		coverage: ports.coverage,
		retainedQuiescence: ports.quiescence,
	});
	const full = Object.freeze({ identity, execution, retained, startup: ports.startup });
	const instance = Object.freeze({});
	for (const [level, handle] of [
		["identity", identity],
		["execution", execution],
		["retained", retained],
		["full", full],
	] as const)
		issued.set(handle, { graph, instance, binding, level });
	return full;
}
