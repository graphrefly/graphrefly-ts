import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import { empiricalStrictJsonDigest, exactKeys, record, strictSnapshot } from "./canonical.js";
import { createD43PolicyCatalog } from "./d43-model-harness-policy.js";
import {
	admitD45EffectResult,
	createD45GraphToolAuthority,
	type D45AdmittedEffectV1,
	type D45CanonicalEvidenceV1,
	type D45EffectResultInputV1,
	type D45FactV1,
	type D45GraphToolAuthorityV1,
	type D45PartialCanonicalEvidenceV1,
	d45TaskEnvelopeDigest,
	readD45ToolArguments,
	snapshotD45CanonicalEvidence,
	snapshotD45PartialCanonicalEvidence,
	takeD45AdmittedEffect,
	validateD45CanonicalEvidence,
	validateD45PartialCanonicalEvidence,
} from "./d45-graph-tool-authority.js";
import {
	createD45QualificationPolicy,
	D45_ASSIGNMENT,
	D45_READABLE_PATHS,
	D45_TASK_MATERIAL,
	D45_WRITABLE_PATH,
} from "./d45-graph-tool-qualification.js";
import { lowerD45ProviderEffect } from "./d45-mechanical-chat-adapter.js";

export const D46_AUTHORITY_REVISION = "graphrefly-ts.d46.bounded-inspection-authority.v2" as const;
export const D46_EVIDENCE_SCHEMA = "graphrefly-ts.d46.canonical-evidence.v2" as const;
export const D46_PARTIAL_EVIDENCE_SCHEMA =
	"graphrefly-ts.d46.partial-canonical-evidence.v2" as const;
export const D46_SLICE_FACT_SCHEMA = "graphrefly-ts.d46.bounded-inspection-fact.v2" as const;
export const D46_FAILURE_CLEANUP_EFFECT_SCHEMA =
	"graphrefly-ts.d46.failure-cleanup-effect.v1" as const;
export const D46_FAILURE_CLEANUP_FACT_SCHEMA = "graphrefly-ts.d46.failure-cleanup-fact.v1" as const;
export const D46_SELECTOR_REVISION = "public-task-token-score-2026-08-21.v1" as const;
export const D46_MAX_SOURCE_BYTES = 262_144 as const;
export const D46_MAX_PROJECTED_BYTES = 24_576 as const;
export const D46_MAX_WINDOWS = 6 as const;
export const D46_CONTEXT_LINES = 20 as const;

type D45Arm = keyof typeof D45_TASK_MATERIAL.armContexts;

export interface D46BoundedWindowV1 {
	readonly startLine: number;
	readonly endLine: number;
	readonly score: number;
	readonly contentDigest: string;
}

export interface D46BoundedInspectionFactV1 {
	readonly schemaVersion: typeof D46_SLICE_FACT_SCHEMA;
	readonly sequence: number;
	readonly selectorRevision: typeof D46_SELECTOR_REVISION;
	readonly effectDigest: string;
	readonly requestDigest: string;
	readonly admissionDigest: string;
	readonly taskEnvelopeDigest: string;
	readonly arm: D45Arm;
	readonly path: string;
	readonly sourceBytes: number;
	readonly sourceDigest: string;
	readonly executorEvidenceDigest: string;
	readonly windows: readonly D46BoundedWindowV1[];
	readonly projectedBytes: number;
	readonly projectedDigest: string;
	readonly projectionMetadataDigest: string;
	readonly factDigest: string;
}

export interface D46CanonicalEvidenceV1 {
	readonly schemaVersion: typeof D46_EVIDENCE_SCHEMA;
	readonly decisionRef: "graphrefly-ts:D46";
	readonly authorityRevision: typeof D46_AUTHORITY_REVISION;
	readonly selectorRevision: typeof D46_SELECTOR_REVISION;
	readonly sliceFacts: readonly D46BoundedInspectionFactV1[];
	readonly d45Evidence: D45CanonicalEvidenceV1;
	readonly maxSourceBytes: typeof D46_MAX_SOURCE_BYTES;
	readonly maxProjectedBytes: typeof D46_MAX_PROJECTED_BYTES;
	readonly maxWindows: typeof D46_MAX_WINDOWS;
	readonly contextLines: typeof D46_CONTEXT_LINES;
	readonly rawMaterialPersisted: false;
	readonly exactSixArmsCompleted: boolean;
	readonly frozenGateWouldPass: boolean;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly evidenceDigest: string;
}

export interface D46FailureCleanupEffectV1 {
	readonly schemaVersion: typeof D46_FAILURE_CLEANUP_EFFECT_SCHEMA;
	readonly interruptedEffectDigest: string;
	readonly interruptedRequestDigest: string;
	readonly interruptedAdmissionDigest: string;
	readonly causeCode: "executor-interrupted";
	readonly cleanupAdmissionDigest: string;
}

export interface D46FailureCleanupFactV1 {
	readonly schemaVersion: typeof D46_FAILURE_CLEANUP_FACT_SCHEMA;
	readonly cleanupEffect: D46FailureCleanupEffectV1;
	readonly status: "completed" | "failed";
	readonly causeCode: null | "dispose-rejected";
	readonly elapsedMs: number;
	readonly resultEvidenceDigest: string;
	readonly factDigest: string;
}

export interface D46PartialCanonicalEvidenceV1 {
	readonly schemaVersion: typeof D46_PARTIAL_EVIDENCE_SCHEMA;
	readonly decisionRef: "graphrefly-ts:D46";
	readonly authorityRevision: typeof D46_AUTHORITY_REVISION;
	readonly selectorRevision: typeof D46_SELECTOR_REVISION;
	readonly sliceFacts: readonly D46BoundedInspectionFactV1[];
	readonly terminalCleanup: D46FailureCleanupFactV1;
	readonly d45PartialEvidence: D45PartialCanonicalEvidenceV1;
	readonly rawMaterialPersisted: false;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly evidenceDigest: string;
}

export interface D46BoundedInspectionAuthorityV1 {
	readonly revision: typeof D46_AUTHORITY_REVISION;
}

interface State {
	readonly owner: ReturnType<typeof graph>;
	readonly factNode: ReturnType<typeof createFactNode>;
	readonly cleanupFactNode: ReturnType<typeof createCleanupFactNode>;
	readonly d45Authority: D45GraphToolAuthorityV1;
	readonly taskEnvelopeDigest: string;
	readonly sliceFacts: D46BoundedInspectionFactV1[];
	readonly admittedReadEffects: Set<string>;
	activeEffect: D45AdmittedEffectV1 | null;
	pendingCleanup: D46FailureCleanupEffectV1 | null;
	terminalCleanup: D46FailureCleanupFactV1 | null;
}

const states = new WeakMap<object, State>();

function createFactNode(owner: ReturnType<typeof graph>) {
	return owner.node<D46BoundedInspectionFactV1>([], null, {
		name: "d46/bounded-inspection-runtime-facts",
	});
}

function createCleanupFactNode(owner: ReturnType<typeof graph>) {
	return owner.node<D46FailureCleanupFactV1>([], null, {
		name: "d46/failure-cleanup-runtime-facts",
	});
}
const STOP_WORDS = new Set([
	"about",
	"after",
	"again",
	"before",
	"bounded",
	"change",
	"exact",
	"frozen",
	"graph",
	"instruction",
	"make",
	"never",
	"only",
	"phase",
	"smallest",
	"statement",
	"that",
	"then",
	"tool",
	"with",
	"workspace",
]);

function stateFor(authority: D46BoundedInspectionAuthorityV1): State {
	const state = states.get(authority);
	if (state === undefined) throw new TypeError("D46 authority is invalid");
	return state;
}

function tokens(value: string): readonly string[] {
	return Object.freeze(
		value
			.toLowerCase()
			.match(/[a-z][a-z0-9_-]{3,}/gu)
			?.flatMap((token) => token.split(/[_-]+/u))
			.filter((token) => token.length >= 4 && !STOP_WORDS.has(token)) ?? [],
	);
}

interface MutableWindow {
	startLine: number;
	endLine: number;
	score: number;
}

function chooseWindows(lines: readonly string[], publicTokens: readonly string[]): MutableWindow[] {
	const lowered = lines.map((line) => line.toLowerCase());
	const taskFrequency = new Map<string, number>();
	for (const token of publicTokens) taskFrequency.set(token, (taskFrequency.get(token) ?? 0) + 1);
	const uniqueTokens = [...taskFrequency.keys()].sort();
	const sourceFrequency = new Map(
		uniqueTokens.map((token) => [
			token,
			lowered.reduce((count, line) => count + (line.includes(token) ? 1 : 0), 0),
		]),
	);
	const anchor = uniqueTokens
		.filter((token) => {
			const count = sourceFrequency.get(token) ?? 0;
			return count >= 2 && count <= 128;
		})
		.sort((left, right) => {
			const importance = (token: string) =>
				(taskFrequency.get(token) ?? 0) *
				Math.log((lines.length + 1) / ((sourceFrequency.get(token) ?? 0) + 1));
			return (
				(taskFrequency.get(right) ?? 0) - (taskFrequency.get(left) ?? 0) ||
				importance(right) - importance(left) ||
				left.localeCompare(right)
			);
		})[0];
	const scoreAt = (lineIndex: number) => {
		const start = Math.max(0, lineIndex - D46_CONTEXT_LINES);
		const end = Math.min(lines.length, lineIndex + D46_CONTEXT_LINES + 1);
		let score = 0;
		for (const token of uniqueTokens) {
			let occurrences = 0;
			for (let index = start; index < end; index += 1)
				if (lowered[index]?.includes(token)) occurrences += 1;
			if (occurrences > 0)
				score +=
					(taskFrequency.get(token) ?? 0) *
					Math.log((lines.length + 1) / ((sourceFrequency.get(token) ?? 0) + 1));
		}
		return Math.max(1, Math.round(score * 1_000));
	};
	const anchorLines =
		anchor === undefined
			? []
			: lowered.flatMap((line, index) => (line.includes(anchor) ? [index + 1] : []));
	const anchorCandidates = anchorLines.map((line) => ({
		line,
		score: scoreAt(line - 1),
		selectionPriority: 1,
		anchorDensity: anchorLines.reduce(
			(count, candidate) => count + (Math.abs(candidate - line) <= D46_CONTEXT_LINES ? 1 : 0),
			0,
		),
	}));
	for (let index = 1; index < anchorLines.length; index += 1) {
		const previous = anchorLines[index - 1];
		const current = anchorLines[index];
		if (
			previous !== undefined &&
			current !== undefined &&
			current - previous > D46_CONTEXT_LINES &&
			current - previous <= 2 * D46_CONTEXT_LINES + 2
		) {
			const line = Math.floor((previous + current) / 2);
			anchorCandidates.push({
				line,
				score: scoreAt(line - 1),
				anchorDensity: 3,
				selectionPriority: 2,
			});
		}
	}
	const generalCandidates = lines.map((_line, index) => ({
		line: index + 1,
		score: scoreAt(index),
		anchorDensity: 0,
		selectionPriority: 0,
	}));
	const candidates = [...anchorCandidates, ...generalCandidates].sort(
		(left, right) =>
			right.anchorDensity - left.anchorDensity ||
			right.selectionPriority - left.selectionPriority ||
			(left.selectionPriority === 2 ? left.line - right.line : 0) ||
			right.score - left.score ||
			left.line - right.line,
	);
	if (candidates.length === 0)
		return [{ startLine: 1, endLine: Math.min(lines.length, 2 * D46_CONTEXT_LINES + 1), score: 0 }];
	const windows: MutableWindow[] = [];
	for (const candidate of candidates) {
		const startLine = Math.max(1, candidate.line - D46_CONTEXT_LINES);
		const endLine = Math.min(lines.length, candidate.line + D46_CONTEXT_LINES);
		const overlaps = windows.some(
			(window) => startLine <= window.endLine && endLine >= window.startLine,
		);
		if (!overlaps && windows.length < D46_MAX_WINDOWS)
			windows.push({ startLine, endLine, score: candidate.score });
		if (windows.length === D46_MAX_WINDOWS) break;
	}
	return windows.sort((left, right) => left.startLine - right.startLine);
}

export function projectD46BoundedInspection(input: {
	readonly path: string;
	readonly content: string;
	readonly publicContext: string;
}): Readonly<{
	content: string;
	sourceBytes: number;
	sourceDigest: string;
	windows: readonly D46BoundedWindowV1[];
	projectedBytes: number;
	projectedDigest: string;
}> {
	const sourceBytes = Buffer.byteLength(input.content, "utf8");
	if (sourceBytes < 1 || sourceBytes > D46_MAX_SOURCE_BYTES)
		throw new TypeError("D46 read proposal exceeded its source bound");
	const lines = input.content.split(/\r?\n/u);
	const selected: D46BoundedWindowV1[] = [];
	const projections: string[] = [];
	for (const window of chooseWindows(lines, tokens(input.publicContext))) {
		const body = lines.slice(window.startLine - 1, window.endLine).join("\n");
		const projection = `<graph-admitted-window path=${JSON.stringify(input.path)} lines=${JSON.stringify(`${window.startLine}-${window.endLine}`)}>\n${body}\n</graph-admitted-window>`;
		const nextBytes = Buffer.byteLength([...projections, projection].join("\n\n"), "utf8");
		if (nextBytes > D46_MAX_PROJECTED_BYTES) continue;
		projections.push(projection);
		selected.push(
			Object.freeze({
				startLine: window.startLine,
				endLine: window.endLine,
				score: window.score,
				contentDigest: empiricalStrictJsonDigest(body),
			}),
		);
	}
	if (selected.length === 0) throw new TypeError("D46 selector could not admit a bounded window");
	const content = projections.join("\n\n");
	const projectedBytes = Buffer.byteLength(content, "utf8");
	return Object.freeze({
		content,
		sourceBytes,
		sourceDigest: empiricalStrictJsonDigest(input.content),
		windows: Object.freeze(selected),
		projectedBytes,
		projectedDigest: empiricalStrictJsonDigest(content),
	});
}

export function createD46BoundedInspectionAuthority(): D46BoundedInspectionAuthorityV1 {
	const policy = createD45QualificationPolicy();
	const d45Authority = createD45GraphToolAuthority({
		catalog: createD43PolicyCatalog([policy]),
		assignment: D45_ASSIGNMENT,
		readablePaths: D45_READABLE_PATHS,
		writablePath: D45_WRITABLE_PATH,
		taskMaterial: D45_TASK_MATERIAL,
		routeProfile: { reasoningEffort: "high", requireParameters: true },
		campaign: policy.campaign,
	});
	const taskEnvelopeDigest = d45TaskEnvelopeDigest(D45_TASK_MATERIAL);
	const owner = graph({ name: "d46/bounded-inspection-authority" });
	const factNode = createFactNode(owner);
	const cleanupFactNode = createCleanupFactNode(owner);
	const authority = Object.freeze({ revision: D46_AUTHORITY_REVISION });
	let state!: State;
	const projectionNode = owner.node<D46BoundedInspectionFactV1>(
		[factNode],
		(ctx) => {
			for (const fact of (depBatch(ctx, 0) ?? []) as readonly D46BoundedInspectionFactV1[]) {
				state.sliceFacts.push(fact);
				ctx.down([["DATA", fact]]);
			}
		},
		{ name: "d46/canonical-projection", factory: "d46BoundedInspectionProjection" },
	);
	const cleanupProjectionNode = owner.node<D46FailureCleanupFactV1>(
		[cleanupFactNode],
		(ctx) => {
			for (const fact of (depBatch(ctx, 0) ?? []) as readonly D46FailureCleanupFactV1[]) {
				if (state.terminalCleanup !== null)
					throw new TypeError("D46 terminal cleanup fact replayed");
				state.terminalCleanup = fact;
				ctx.down([["DATA", fact]]);
			}
		},
		{ name: "d46/failure-cleanup-projection", factory: "d46FailureCleanupProjection" },
	);
	state = {
		owner,
		factNode,
		cleanupFactNode,
		d45Authority,
		taskEnvelopeDigest,
		sliceFacts: [],
		admittedReadEffects: new Set(),
		activeEffect: null,
		pendingCleanup: null,
		terminalCleanup: null,
	};
	projectionNode.subscribe(() => undefined);
	cleanupProjectionNode.subscribe(() => undefined);
	states.set(authority, state);
	return authority;
}

export function lowerD46ProviderEffect(
	authority: D46BoundedInspectionAuthorityV1,
	effect: D45AdmittedEffectV1,
): ReturnType<typeof lowerD45ProviderEffect> {
	return lowerD45ProviderEffect(stateFor(authority).d45Authority, effect);
}

export function readD46ToolArguments(
	authority: D46BoundedInspectionAuthorityV1,
	effect: D45AdmittedEffectV1,
): ReturnType<typeof readD45ToolArguments> {
	return readD45ToolArguments(stateFor(authority).d45Authority, effect);
}

export function takeD46AdmittedEffect(
	authority: D46BoundedInspectionAuthorityV1,
): D45AdmittedEffectV1 | null {
	const state = stateFor(authority);
	if (state.activeEffect !== null) throw new TypeError("D46 already has an active effect");
	const effect = takeD45AdmittedEffect(state.d45Authority);
	state.activeEffect = effect;
	return effect;
}

export function admitD46EffectResult(
	authority: D46BoundedInspectionAuthorityV1,
	effect: D45AdmittedEffectV1,
	result: D45EffectResultInputV1,
): void {
	const state = stateFor(authority);
	const normalizedResult = strictSnapshot(
		record(result, "D46.executorResult"),
	) as unknown as D45EffectResultInputV1;
	if (state.activeEffect?.effectDigest !== effect.effectDigest)
		throw new TypeError("D46 effect result did not match its active admission");
	if (effect.taskEnvelopeDigest !== state.taskEnvelopeDigest)
		throw new TypeError("D46 effect task envelope provenance drifted");
	if (
		effect.effectKind !== "tool-action" ||
		effect.toolRef !== "read-file" ||
		normalizedResult.effectKind !== "tool-action" ||
		normalizedResult.status !== "success"
	) {
		admitD45EffectResult(state.d45Authority, effect, normalizedResult);
		state.activeEffect = null;
		return;
	}
	if (state.admittedReadEffects.has(effect.effectDigest))
		throw new TypeError("D46 bounded inspection proposal replayed");
	if (normalizedResult.content === null || effect.path === null)
		throw new TypeError("D46 successful read omitted material");
	const armContext = D45_TASK_MATERIAL.armContexts[effect.arm];
	const projection = projectD46BoundedInspection({
		path: effect.path,
		content: normalizedResult.content,
		publicContext: `${D45_TASK_MATERIAL.systemInstruction}\n${D45_TASK_MATERIAL.taskStatement}\n${armContext}`,
	});
	const executorEvidenceDigest = normalizedResult.evidenceDigest;
	const projectionMetadataDigest = empiricalStrictJsonDigest(
		strictSnapshot({
			selectorRevision: D46_SELECTOR_REVISION,
			taskEnvelopeDigest: effect.taskEnvelopeDigest,
			path: effect.path,
			sourceBytes: projection.sourceBytes,
			sourceDigest: projection.sourceDigest,
			windows: projection.windows,
			projectedBytes: projection.projectedBytes,
			projectedDigest: projection.projectedDigest,
		}),
	);
	const admittedResult = Object.freeze({
		...normalizedResult,
		evidenceDigest: empiricalStrictJsonDigest({
			executorEvidenceDigest,
			projectionMetadataDigest,
		}),
		content: projection.content,
	});
	admitD45EffectResult(state.d45Authority, effect, admittedResult);
	const factMaterial = strictSnapshot({
		schemaVersion: D46_SLICE_FACT_SCHEMA,
		sequence: state.sliceFacts.length + 1,
		selectorRevision: D46_SELECTOR_REVISION,
		effectDigest: effect.effectDigest,
		requestDigest: effect.requestDigest,
		admissionDigest: effect.admissionDigest,
		taskEnvelopeDigest: effect.taskEnvelopeDigest,
		arm: effect.arm,
		path: effect.path,
		sourceBytes: projection.sourceBytes,
		sourceDigest: projection.sourceDigest,
		executorEvidenceDigest,
		windows: projection.windows,
		projectedBytes: projection.projectedBytes,
		projectedDigest: projection.projectedDigest,
		projectionMetadataDigest,
	});
	state.factNode.down([
		[
			"DATA",
			Object.freeze({ ...factMaterial, factDigest: empiricalStrictJsonDigest(factMaterial) }),
		],
	]);
	state.admittedReadEffects.add(effect.effectDigest);
	state.activeEffect = null;
}

export function takeD46FailureCleanupEffect(
	authority: D46BoundedInspectionAuthorityV1,
): D46FailureCleanupEffectV1 {
	const state = stateFor(authority);
	if (
		state.activeEffect === null ||
		state.pendingCleanup !== null ||
		state.terminalCleanup !== null
	)
		throw new TypeError("D46 failure cleanup is not admissible");
	const material = strictSnapshot({
		schemaVersion: D46_FAILURE_CLEANUP_EFFECT_SCHEMA,
		interruptedEffectDigest: state.activeEffect.effectDigest,
		interruptedRequestDigest: state.activeEffect.requestDigest,
		interruptedAdmissionDigest: state.activeEffect.admissionDigest,
		causeCode: "executor-interrupted" as const,
	});
	const effect = Object.freeze({
		...material,
		cleanupAdmissionDigest: empiricalStrictJsonDigest(material),
	});
	state.pendingCleanup = effect;
	return effect;
}

export function admitD46FailureCleanupResult(
	authority: D46BoundedInspectionAuthorityV1,
	effect: D46FailureCleanupEffectV1,
	result: Readonly<{
		readonly status: "completed" | "failed";
		readonly causeCode: null | "dispose-rejected";
		readonly elapsedMs: number;
		readonly evidenceDigest: string;
	}>,
): void {
	const state = stateFor(authority);
	const normalized = record(result, "D46.failureCleanupResult");
	exactKeys(
		normalized,
		["status", "causeCode", "elapsedMs", "evidenceDigest"],
		"D46.failureCleanupResult",
	);
	if (
		state.pendingCleanup?.cleanupAdmissionDigest !== effect.cleanupAdmissionDigest ||
		state.activeEffect?.effectDigest !== effect.interruptedEffectDigest ||
		!(
			(normalized.status === "completed" && normalized.causeCode === null) ||
			(normalized.status === "failed" && normalized.causeCode === "dispose-rejected")
		) ||
		!Number.isSafeInteger(normalized.elapsedMs) ||
		(normalized.elapsedMs as number) < 0 ||
		(normalized.elapsedMs as number) > 30_000 ||
		!/^sha256:[a-f0-9]{64}$/u.test(String(normalized.evidenceDigest))
	)
		throw new TypeError("D46 failure cleanup result failed admission");
	const material = strictSnapshot({
		schemaVersion: D46_FAILURE_CLEANUP_FACT_SCHEMA,
		cleanupEffect: effect,
		status: normalized.status as "completed" | "failed",
		causeCode: normalized.causeCode as null | "dispose-rejected",
		elapsedMs: normalized.elapsedMs as number,
		resultEvidenceDigest: normalized.evidenceDigest as string,
	});
	state.cleanupFactNode.down([
		["DATA", Object.freeze({ ...material, factDigest: empiricalStrictJsonDigest(material) })],
	]);
	state.pendingCleanup = null;
	state.activeEffect = null;
}

export function snapshotD46CanonicalEvidence(
	authority: D46BoundedInspectionAuthorityV1,
): D46CanonicalEvidenceV1 {
	const state = stateFor(authority);
	const d45Evidence = validateD45CanonicalEvidence(
		snapshotD45CanonicalEvidence(state.d45Authority),
	);
	const material = strictSnapshot({
		schemaVersion: D46_EVIDENCE_SCHEMA,
		decisionRef: "graphrefly-ts:D46" as const,
		authorityRevision: D46_AUTHORITY_REVISION,
		selectorRevision: D46_SELECTOR_REVISION,
		sliceFacts: state.sliceFacts,
		d45Evidence,
		maxSourceBytes: D46_MAX_SOURCE_BYTES,
		maxProjectedBytes: D46_MAX_PROJECTED_BYTES,
		maxWindows: D46_MAX_WINDOWS,
		contextLines: D46_CONTEXT_LINES,
		rawMaterialPersisted: false as const,
		exactSixArmsCompleted: d45Evidence.exactSixArmsCompleted,
		frozenGateWouldPass: d45Evidence.frozenGateWouldPass,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

export function snapshotD46PartialCanonicalEvidence(
	authority: D46BoundedInspectionAuthorityV1,
): D46PartialCanonicalEvidenceV1 {
	const state = stateFor(authority);
	if (state.terminalCleanup === null)
		throw new TypeError("D46 partial evidence requires admitted terminal cleanup");
	const d45PartialEvidence = validateD45PartialCanonicalEvidence(
		snapshotD45PartialCanonicalEvidence(state.d45Authority),
	);
	const material = strictSnapshot({
		schemaVersion: D46_PARTIAL_EVIDENCE_SCHEMA,
		decisionRef: "graphrefly-ts:D46" as const,
		authorityRevision: D46_AUTHORITY_REVISION,
		selectorRevision: D46_SELECTOR_REVISION,
		sliceFacts: state.sliceFacts,
		terminalCleanup: state.terminalCleanup,
		d45PartialEvidence,
		rawMaterialPersisted: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

function validateSliceFacts(
	facts: readonly D46BoundedInspectionFactV1[],
	d45Facts: readonly D45FactV1[],
): void {
	const observedEffects = new Set<string>();
	for (const [index, fact] of facts.entries()) {
		exactKeys(
			record(fact, `D46.sliceFacts[${index}]`),
			[
				"schemaVersion",
				"sequence",
				"selectorRevision",
				"effectDigest",
				"requestDigest",
				"admissionDigest",
				"taskEnvelopeDigest",
				"arm",
				"path",
				"sourceBytes",
				"sourceDigest",
				"executorEvidenceDigest",
				"windows",
				"projectedBytes",
				"projectedDigest",
				"projectionMetadataDigest",
				"factDigest",
			],
			`D46.sliceFacts[${index}]`,
		);
		for (const [windowIndex, window] of fact.windows.entries())
			exactKeys(
				record(window, `D46.sliceFacts[${index}].windows[${windowIndex}]`),
				["startLine", "endLine", "score", "contentDigest"],
				`D46.sliceFacts[${index}].windows[${windowIndex}]`,
			);
		const admitted = d45Facts.find(
			(candidate) =>
				candidate.factKind === "effect-admitted" &&
				candidate.effect.effectDigest === fact.effectDigest,
		);
		const result = d45Facts.find(
			(candidate) =>
				candidate.factKind === "tool-result" && candidate.effectDigest === fact.effectDigest,
		);
		if (
			fact.schemaVersion !== D46_SLICE_FACT_SCHEMA ||
			fact.sequence !== index + 1 ||
			fact.selectorRevision !== D46_SELECTOR_REVISION ||
			observedEffects.has(fact.effectDigest) ||
			fact.sourceBytes < 1 ||
			fact.sourceBytes > D46_MAX_SOURCE_BYTES ||
			fact.projectedBytes < 1 ||
			fact.projectedBytes > D46_MAX_PROJECTED_BYTES ||
			fact.windows.length < 1 ||
			fact.windows.length > D46_MAX_WINDOWS ||
			fact.windows.some(
				(window, windowIndex) =>
					!Number.isSafeInteger(window.startLine) ||
					!Number.isSafeInteger(window.endLine) ||
					!Number.isSafeInteger(window.score) ||
					window.startLine < 1 ||
					window.endLine < window.startLine ||
					window.endLine - window.startLine > 2 * D46_CONTEXT_LINES ||
					(windowIndex > 0 && window.startLine <= (fact.windows[windowIndex - 1]?.endLine ?? 0)) ||
					!/^sha256:[a-f0-9]{64}$/u.test(window.contentDigest),
			) ||
			!/^sha256:[a-f0-9]{64}$/u.test(fact.sourceDigest) ||
			!/^sha256:[a-f0-9]{64}$/u.test(fact.projectedDigest) ||
			fact.projectionMetadataDigest !==
				empiricalStrictJsonDigest(
					strictSnapshot({
						selectorRevision: fact.selectorRevision,
						taskEnvelopeDigest: fact.taskEnvelopeDigest,
						path: fact.path,
						sourceBytes: fact.sourceBytes,
						sourceDigest: fact.sourceDigest,
						windows: fact.windows,
						projectedBytes: fact.projectedBytes,
						projectedDigest: fact.projectedDigest,
					}),
				) ||
			admitted?.factKind !== "effect-admitted" ||
			admitted.effect.effectKind !== "tool-action" ||
			admitted.effect.toolRef !== "read-file" ||
			admitted.effect.requestDigest !== fact.requestDigest ||
			admitted.effect.admissionDigest !== fact.admissionDigest ||
			admitted.effect.taskEnvelopeDigest !== fact.taskEnvelopeDigest ||
			admitted.effect.arm !== fact.arm ||
			admitted.effect.path !== fact.path ||
			result?.factKind !== "tool-result" ||
			result.requestDigest !== fact.requestDigest ||
			result.admissionDigest !== fact.admissionDigest ||
			result.result.status !== "success" ||
			fact.executorEvidenceDigest !==
				empiricalStrictJsonDigest({
					request: fact.requestDigest,
					contentDigest: fact.sourceDigest,
				}) ||
			result.result.evidenceDigest !==
				empiricalStrictJsonDigest({
					executorEvidenceDigest: fact.executorEvidenceDigest,
					projectionMetadataDigest: fact.projectionMetadataDigest,
				}) ||
			result.result.contentDigest !== fact.projectedDigest ||
			result.result.contentBytes !== fact.projectedBytes ||
			fact.factDigest !==
				empiricalStrictJsonDigest(
					strictSnapshot((({ factDigest: _factDigest, ...factMaterial }) => factMaterial)(fact)),
				)
		)
			throw new TypeError("D46 bounded inspection fact failed replay");
		observedEffects.add(fact.effectDigest);
	}
	const successfulReadEffects = d45Facts.flatMap((fact) => {
		if (fact.factKind !== "tool-result" || fact.result.status !== "success") return [];
		const admitted = d45Facts.find(
			(candidate) =>
				candidate.factKind === "effect-admitted" &&
				candidate.effect.effectDigest === fact.effectDigest &&
				candidate.effect.toolRef === "read-file",
		);
		return admitted === undefined ? [] : [fact.effectDigest];
	});
	if (
		successfulReadEffects.length !== facts.length ||
		successfulReadEffects.some((effectDigest) => !observedEffects.has(effectDigest))
	)
		throw new TypeError("D46 read projection bijection failed replay");
}

function validateFailureCleanup(
	fact: D46FailureCleanupFactV1,
	partial: D45PartialCanonicalEvidenceV1,
): void {
	exactKeys(
		record(fact, "D46.terminalCleanup"),
		[
			"schemaVersion",
			"cleanupEffect",
			"status",
			"causeCode",
			"elapsedMs",
			"resultEvidenceDigest",
			"factDigest",
		],
		"D46.terminalCleanup",
	);
	exactKeys(
		record(fact.cleanupEffect, "D46.terminalCleanup.cleanupEffect"),
		[
			"schemaVersion",
			"interruptedEffectDigest",
			"interruptedRequestDigest",
			"interruptedAdmissionDigest",
			"causeCode",
			"cleanupAdmissionDigest",
		],
		"D46.terminalCleanup.cleanupEffect",
	);
	const { cleanupAdmissionDigest: _cleanupDigest, ...cleanupMaterial } = fact.cleanupEffect;
	const { factDigest: _factDigest, ...factMaterial } = fact;
	const interrupted = partial.facts.find(
		(candidate) =>
			candidate.factKind === "effect-admitted" &&
			candidate.effect.effectDigest === fact.cleanupEffect.interruptedEffectDigest,
	);
	if (
		fact.schemaVersion !== D46_FAILURE_CLEANUP_FACT_SCHEMA ||
		fact.cleanupEffect.schemaVersion !== D46_FAILURE_CLEANUP_EFFECT_SCHEMA ||
		fact.cleanupEffect.causeCode !== "executor-interrupted" ||
		fact.cleanupEffect.cleanupAdmissionDigest !==
			empiricalStrictJsonDigest(strictSnapshot(cleanupMaterial)) ||
		partial.activeEffectDigest !== fact.cleanupEffect.interruptedEffectDigest ||
		interrupted?.factKind !== "effect-admitted" ||
		interrupted.effect.requestDigest !== fact.cleanupEffect.interruptedRequestDigest ||
		interrupted.effect.admissionDigest !== fact.cleanupEffect.interruptedAdmissionDigest ||
		!(
			(fact.status === "completed" && fact.causeCode === null) ||
			(fact.status === "failed" && fact.causeCode === "dispose-rejected")
		) ||
		!Number.isSafeInteger(fact.elapsedMs) ||
		fact.elapsedMs < 0 ||
		fact.elapsedMs > 30_000 ||
		!/^sha256:[a-f0-9]{64}$/u.test(fact.resultEvidenceDigest) ||
		fact.factDigest !== empiricalStrictJsonDigest(strictSnapshot(factMaterial))
	)
		throw new TypeError("D46 terminal cleanup failed replay");
}

export function validateD46CanonicalEvidence(
	value: D46CanonicalEvidenceV1,
): D46CanonicalEvidenceV1 {
	exactKeys(
		record(value, "D46.canonicalEvidence"),
		[
			"schemaVersion",
			"decisionRef",
			"authorityRevision",
			"selectorRevision",
			"sliceFacts",
			"d45Evidence",
			"maxSourceBytes",
			"maxProjectedBytes",
			"maxWindows",
			"contextLines",
			"rawMaterialPersisted",
			"exactSixArmsCompleted",
			"frozenGateWouldPass",
			"causalAttribution",
			"efficacyClaim",
			"evidenceDigest",
		],
		"D46.canonicalEvidence",
	);
	const d45Evidence = validateD45CanonicalEvidence(value.d45Evidence);
	validateSliceFacts(value.sliceFacts, d45Evidence.facts);
	const { evidenceDigest: _digest, ...material } = value;
	if (
		value.schemaVersion !== D46_EVIDENCE_SCHEMA ||
		value.decisionRef !== "graphrefly-ts:D46" ||
		value.authorityRevision !== D46_AUTHORITY_REVISION ||
		value.selectorRevision !== D46_SELECTOR_REVISION ||
		value.maxSourceBytes !== D46_MAX_SOURCE_BYTES ||
		value.maxProjectedBytes !== D46_MAX_PROJECTED_BYTES ||
		value.maxWindows !== D46_MAX_WINDOWS ||
		value.contextLines !== D46_CONTEXT_LINES ||
		value.rawMaterialPersisted !== false ||
		value.causalAttribution !== "undetermined" ||
		value.efficacyClaim !== "none" ||
		value.exactSixArmsCompleted !== d45Evidence.exactSixArmsCompleted ||
		value.frozenGateWouldPass !== d45Evidence.frozenGateWouldPass ||
		value.evidenceDigest !== empiricalStrictJsonDigest(strictSnapshot(material))
	)
		throw new TypeError("D46 canonical evidence failed replay");
	return value;
}

export function validateD46PartialCanonicalEvidence(
	value: D46PartialCanonicalEvidenceV1,
): D46PartialCanonicalEvidenceV1 {
	exactKeys(
		record(value, "D46.partialEvidence"),
		[
			"schemaVersion",
			"decisionRef",
			"authorityRevision",
			"selectorRevision",
			"sliceFacts",
			"terminalCleanup",
			"d45PartialEvidence",
			"rawMaterialPersisted",
			"causalAttribution",
			"efficacyClaim",
			"evidenceDigest",
		],
		"D46.partialEvidence",
	);
	const partial = validateD45PartialCanonicalEvidence(value.d45PartialEvidence);
	validateSliceFacts(value.sliceFacts, partial.facts);
	validateFailureCleanup(value.terminalCleanup, partial);
	const { evidenceDigest: _digest, ...material } = value;
	if (
		value.schemaVersion !== D46_PARTIAL_EVIDENCE_SCHEMA ||
		value.decisionRef !== "graphrefly-ts:D46" ||
		value.authorityRevision !== D46_AUTHORITY_REVISION ||
		value.selectorRevision !== D46_SELECTOR_REVISION ||
		value.rawMaterialPersisted !== false ||
		value.causalAttribution !== "undetermined" ||
		value.efficacyClaim !== "none" ||
		value.evidenceDigest !== empiricalStrictJsonDigest(strictSnapshot(material))
	)
		throw new TypeError("D46 partial canonical evidence failed replay");
	return value;
}
