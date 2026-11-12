import type { ConstructionScope, StartupFact } from "../../graph/construction-scope.js";
import type { Graph } from "../../graph/graph.js";
import type { Node } from "../../node/node.js";
import { merge } from "../../operators/index.js";
import type { Message } from "../../protocol/messages.js";
import {
	type CausalBinding,
	causalBinding,
	createCausalCapabilities,
	type FullCausalCapability,
} from "./capabilities.js";
import { prepareCommittedEffectsView } from "./committed-view.js";
import type {
	Arrival,
	AuthorityEmission,
	AuthorityFact,
	CausalOccurrence,
	CausalOccurrenceBundle,
	CausalOccurrenceBundleOptions,
	CommittedEffectsView,
	RuntimeState,
} from "./contracts.js";
import { transitionCausalAuthority } from "./transition.js";

/** Private fixed construction material. Does not acquire or activate graph resources. */
export function causalColdNodeNames(name: string): readonly string[] {
	const suffixes = [
		"input/occurrences",
		"input/admissions",
		"input/branch-terminals",
		"input/effect-proposals",
		"input/effect-admissions",
		"input/effect-outcomes",
		"input/evidence",
		"input/watermarks",
		"arrivals",
		"authority",
		"release-candidates",
		"released",
		"currentness",
		"terminals",
		"conservation",
		"coverage",
		"quiescence",
		"issues",
		"causal-quiescence",
		"committed-effects",
	];
	return suffixes.map((suffix) => `${name}/${suffix}`);
}

/** Opaque, immutable construction preparation; preserves one validation/snapshot pass. */
class PreparedCausalOptions<T> {
	readonly #options: CausalOccurrenceBundleOptions<T>;
	constructor(options: CausalOccurrenceBundleOptions<T>) {
		this.#options = options;
		Object.freeze(this);
	}
	get options(): CausalOccurrenceBundleOptions<T> {
		return this.#options;
	}
}

/** Validate the same standalone options before acquiring resources. */
export function prepareCausalOptions<T>(
	opts: CausalOccurrenceBundleOptions<T>,
): PreparedCausalOptions<T> {
	for (const [label, bound] of [
		["maxOccurrences", opts.maxOccurrences],
		["maxPending", opts.maxPending],
		["maxEffects", opts.maxEffects],
		["maxEvidence", opts.maxEvidence],
	] as const) {
		if (!Number.isSafeInteger(bound) || bound < 1)
			throw new TypeError(`${label} must be a positive safe integer`);
	}
	if (new Set(opts.requiredBranches).size !== opts.requiredBranches.length)
		throw new TypeError("required branches must be unique");
	if (opts.requiredBranches.length === 0)
		throw new TypeError("at least one required branch must be declared");
	if (new Set(opts.requiredEvidenceKinds).size !== opts.requiredEvidenceKinds.length)
		throw new TypeError("required evidence kinds must be unique");

	opts = Object.freeze({
		...opts,
		requiredBranches: Object.freeze([...opts.requiredBranches]),
		requiredEvidenceKinds: Object.freeze([...opts.requiredEvidenceKinds]),
	});
	return new PreparedCausalOptions(opts);
}

function lane<T, K extends Arrival<T>["lane"]>(
	graph: ConstructionScope,
	input: Node<unknown>,
	name: string,
	laneName: K,
): Node<Arrival<T>> {
	return graph.node<Arrival<T>>(
		[input],
		(ctx) => {
			const values = ctx.deps[0].waves.flat();
			ctx.down([["DATA", { lane: laneName, values } as Arrival<T>]]);
		},
		{ name, factory: "causalOccurrenceInputLane" },
	);
}

function projectFact<T, K extends AuthorityFact<T>["kind"]>(
	graph: ConstructionScope,
	authority: Node<AuthorityEmission<T>>,
	name: string,
	kind: K,
): Node<Extract<AuthorityFact<T>, { kind: K }>["value"]> {
	return graph.node(
		[authority],
		(ctx) => {
			// Each fact keeps its own array (R-wave): the authority publishes facts one array each,
			// and one delivery brings them all to this run.
			for (const wave of ctx.deps[0].waves) {
				const values = (wave as AuthorityEmission<T>[])
					.filter((raw) => raw.kind === "fact" && raw.fact.kind === kind)
					.map(
						(raw) =>
							[
								"DATA",
								(raw as unknown as { fact: Extract<AuthorityFact<T>, { kind: K }> }).fact.value,
							] as const,
					);
				ctx.down(values);
			}
		},
		{ name, factory: "causalOccurrenceFactProjection" },
	);
}

/** D162: append the complete causal closure to an existing cold owner; never start it. */
export function buildCausalNodes<T>(
	ownerGraph: Graph,
	graph: ConstructionScope,
	startup: Node<StartupFact>,
	preparedOptions: PreparedCausalOptions<T>,
	binding: CausalBinding,
): {
	ports: CausalOccurrenceBundle<T>;
	full: FullCausalCapability<T>;
	roots: readonly Node<unknown>[];
	committedEffects: Node<CommittedEffectsView>;
} {
	binding = causalBinding(binding);
	graph.assertContext(ownerGraph, startup, binding.epoch);
	const opts = preparedOptions.options;
	const arrivals = graph.initNode(
		merge<Arrival<T>>(),
		[
			lane(graph, opts.occurrences, `${opts.name}/input/occurrences`, "occurrences"),
			lane(graph, opts.admissions, `${opts.name}/input/admissions`, "admissions"),
			lane(graph, opts.branchTerminals, `${opts.name}/input/branch-terminals`, "branch-terminals"),
			lane(graph, opts.effectProposals, `${opts.name}/input/effect-proposals`, "effect-proposals"),
			lane(
				graph,
				opts.effectAdmissions,
				`${opts.name}/input/effect-admissions`,
				"effect-admissions",
			),
			lane(graph, opts.effectOutcomes, `${opts.name}/input/effect-outcomes`, "effect-outcomes"),
			lane(graph, opts.evidence, `${opts.name}/input/evidence`, "evidence"),
			lane(graph, opts.watermarks, `${opts.name}/input/watermarks`, "watermarks"),
		],
		{ name: `${opts.name}/arrivals` },
	);

	const authority = graph.node<AuthorityEmission<T>>(
		[arrivals],
		(ctx) => {
			// One transition per input array, in order: a delivery brings a wave's arrays to one run
			// (R-wave), and each array is an arrival step whose pending work the next step may need.
			let state = ctx.state.get<RuntimeState<T>>();
			const firstRun = state === undefined;
			const outputs: AuthorityFact<T>[] = [];
			let committedViewChanged = false;
			const waves = ctx.deps[0].waves;
			for (const wave of waves.length > 0 ? waves : [[]]) {
				const step = transitionCausalAuthority(state, wave as Arrival<T>[], opts);
				state = step.state;
				for (const output of step.outputs) outputs.push(output);
				committedViewChanged ||= step.committedViewChanged;
			}
			if (state === undefined) return;
			const committedEffects = prepareCommittedEffectsView(
				state,
				committedViewChanged,
				outputs.length > 0,
				`${opts.name}/authority`,
				binding,
			);
			state.committedEffects = committedEffects;
			ctx.state.set(state);
			// Commit once before publishing each fact in its original wave. A lifetime's first run sends
			// its facts as one array, so a projection that joins afterwards has them all in its snapshot
			// (R-subscription).
			const facts = outputs.map(
				(output) =>
					[
						"DATA",
						Object.freeze({
							kind: "fact" as const,
							fact: Object.freeze(output),
							committedEffects: committedEffects!,
						}),
					] as Message,
			);
			if (firstRun && facts.length > 0) ctx.down(facts);
			else for (const fact of facts) ctx.down([fact]);
			if (committedViewChanged && outputs.length === 0)
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "view-change" as const,
							committedEffects: committedEffects!,
						}),
					],
				]);
		},
		{
			name: `${opts.name}/authority`,
			factory: "causalOccurrenceAuthority",
			complete: "manual",
		},
	);

	const rawRelease = projectFact(graph, authority, `${opts.name}/release-candidates`, "release");
	// The release boundary is one quiet node (graphrefly-ts:D172): it forwards each release
	// candidate, and a quiet node's output goes out after the current wave as a wave of its own
	// (R-wave), so nothing below waits on the authority's wave.
	const released = graph.node<CausalOccurrence<T>>(
		[rawRelease],
		(ctx) => {
			for (const wave of ctx.deps[0].waves) ctx.down(wave.map((value) => ["DATA", value]));
		},
		{
			name: `${opts.name}/released`,
			factory: "causalOccurrenceReleased",
			quiet: true,
		},
	);

	const result: CausalOccurrenceBundle<T> = {
		startup,
		released,
		currentness: projectFact(graph, authority, `${opts.name}/currentness`, "currentness"),
		terminals: projectFact(graph, authority, `${opts.name}/terminals`, "terminal"),
		conservation: projectFact(graph, authority, `${opts.name}/conservation`, "conservation"),
		coverage: projectFact(graph, authority, `${opts.name}/coverage`, "coverage"),
		quiescence: projectFact(graph, authority, `${opts.name}/quiescence`, "quiescence"),
		issues: projectFact(graph, authority, `${opts.name}/issues`, "issue"),
	};
	const committedEffects = graph.node<CommittedEffectsView>(
		[authority],
		(ctx) => {
			let seen = ctx.state.get<{ view: CommittedEffectsView | undefined }>();
			if (seen === undefined) {
				const slot = { view: undefined as CommittedEffectsView | undefined };
				seen = slot;
				ctx.state.set(slot);
			}
			// R-invalidation, manual policy: an INVALIDATE clears the dedup slot and invalidates this
			// view, so the next committed view is sent again.
			if (ctx.deps[0].invalidated) {
				seen.view = undefined;
				ctx.down([["INVALIDATE"]]);
			}
			for (const emission of ctx.deps[0].waves.flat() as AuthorityEmission<T>[]) {
				if (seen.view === emission.committedEffects) continue;
				seen.view = emission.committedEffects;
				ctx.down([["DATA", seen.view]]);
			}
		},
		{
			name: `${opts.name}/committed-effects`,
			factory: "causalCommittedEffectsProjection",
			invalidate: "manual",
		},
	);
	assertCausalOccurrenceTopology(graph.readIncoming(), opts.name);
	const full = createCausalCapabilities(ownerGraph, graph, opts.name, result, binding);
	Object.freeze(result);
	return Object.freeze({
		ports: result,
		full,
		committedEffects,
		roots: Object.freeze([released]),
	});
}

export function causalOccurrenceRequiredEdges(
	name: string,
	description?: Readonly<{
		readonly edges: readonly Readonly<{ from: string; to: string }>[];
	}>,
): readonly Readonly<{ from: string; to: string }>[] {
	const arrivals = `${name}/arrivals`;
	const authority = `${name}/authority`;
	const releaseCandidates = `${name}/release-candidates`;
	const released = `${name}/released`;
	const internal = [
		{ from: `${name}/input/occurrences`, to: arrivals },
		{ from: `${name}/input/admissions`, to: arrivals },
		{ from: `${name}/input/branch-terminals`, to: arrivals },
		{ from: `${name}/input/effect-proposals`, to: arrivals },
		{ from: `${name}/input/effect-admissions`, to: arrivals },
		{ from: `${name}/input/effect-outcomes`, to: arrivals },
		{ from: `${name}/input/evidence`, to: arrivals },
		{ from: `${name}/input/watermarks`, to: arrivals },
		{ from: arrivals, to: authority },
		{ from: authority, to: releaseCandidates },
		{ from: releaseCandidates, to: released },
		{ from: authority, to: `${name}/currentness` },
		{ from: authority, to: `${name}/terminals` },
		{ from: authority, to: `${name}/conservation` },
		{ from: authority, to: `${name}/coverage` },
		{ from: authority, to: `${name}/quiescence` },
		{ from: authority, to: `${name}/issues` },
		{ from: authority, to: `${name}/committed-effects` },
	];
	const inputLanes = [
		"occurrences",
		"admissions",
		"branch-terminals",
		"effect-proposals",
		"effect-admissions",
		"effect-outcomes",
		"evidence",
		"watermarks",
	];
	const sources =
		description === undefined
			? []
			: inputLanes.flatMap((laneName) => {
					const target = `${name}/input/${laneName}`;
					return description.edges.filter((edge) => edge.to === target);
				});
	return Object.freeze([...sources, ...internal]);
}

export function assertCausalOccurrenceTopology(
	description: Readonly<{ readonly edges: readonly Readonly<{ from: string; to: string }>[] }>,
	name: string,
): void {
	const incoming = new Map<string, Set<string>>();
	description.edges.forEach((edge) => {
		let sources = incoming.get(edge.to);
		if (sources === undefined) {
			sources = new Set<string>();
			incoming.set(edge.to, sources);
		}
		sources.add(edge.from);
	});
	for (const laneName of [
		"occurrences",
		"admissions",
		"branch-terminals",
		"effect-proposals",
		"effect-admissions",
		"effect-outcomes",
		"evidence",
		"watermarks",
	]) {
		if (!incoming.has(`${name}/input/${laneName}`))
			throw new TypeError(`causal occurrence topology missing source edge into ${laneName}`);
	}
	for (const edge of causalOccurrenceRequiredEdges(name, description)) {
		if (!incoming.get(edge.to)?.has(edge.from))
			throw new TypeError(
				`causal occurrence topology missing required edge ${edge.from} -> ${edge.to}`,
			);
	}
}
