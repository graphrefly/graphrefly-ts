import { type Ctx, depBatch } from "../../ctx/types.js";
import type { DataIssue } from "../../data/index.js";
import type { Graph } from "../../graph/graph.js";
import type { Node } from "../../node/node.js";
import type { EffectRunGoal, SourceRef } from "../../orchestration/agent-runtime.js";
import type {
	Fact,
	VerificationPlan,
	VerificationStep,
	WorkItemDraft,
	WorkItemValidationIssueCode,
	WorkItemValidationStatus,
} from "./scheduling-types.js";

export function emitAudit(
	ctx: Ctx,
	state: { auditSeq: number },
	kind: string,
	status: WorkItemValidationStatus,
): void {
	state.auditSeq += 1;
	emit(ctx, "audit", {
		id: `${kind}:${state.auditSeq}`,
		kind,
		subjectId: status.workItemId,
		message: status.message,
		issueCode: status.code,
		sourceRefs: status.sourceRefs,
		metadata: {
			statusId: status.statusId,
			state: status.state,
			revision: status.revision,
			executionInputRevision: status.executionInputRevision,
			...(status.metadata ?? {}),
		},
	});
}

export function project<TFact, TSelected>(
	graph: Graph,
	runtime: Node<TFact>,
	name: string,
	factory: string,
	select: (fact: TFact) => TSelected | undefined,
): Node<TSelected> {
	return graph.node<TSelected>(
		[runtime],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const selected = select(raw as TFact);
				if (selected !== undefined) ctx.down([["DATA", selected]]);
			}
		},
		{ name, factory, partial: true, completeWhenDepsComplete: false, errorWhenDepsError: false },
	);
}

export function emit<T, K extends Fact<T>["kind"]>(
	ctx: Ctx,
	kind: K,
	value: Extract<Fact<T>, { kind: K }>["value"],
): void {
	ctx.down([["DATA", { kind, value } as Fact<T>]]);
}

export function normalizePlan<T>(
	draft: Pick<WorkItemDraft<T>, "verificationPlan" | "verificationSteps">,
): VerificationPlan<T> | undefined {
	if (draft.verificationPlan !== undefined) return draft.verificationPlan;
	if (draft.verificationSteps !== undefined)
		return { planId: "default", steps: draft.verificationSteps };
	return undefined;
}

export function normalizePlanFromUnknown<T>(
	draft: Record<string, unknown>,
): VerificationPlan<T> | undefined {
	const verificationPlan = draft.verificationPlan;
	if (verificationPlan !== undefined) {
		if (!isRecord(verificationPlan) || !Array.isArray(verificationPlan.steps)) {
			return { planId: "malformed", steps: [] };
		}
		return verificationPlan as unknown as VerificationPlan<T>;
	}
	const verificationSteps = draft.verificationSteps;
	if (verificationSteps !== undefined) {
		if (!Array.isArray(verificationSteps)) return { planId: "malformed", steps: [] };
		return { planId: "default", steps: verificationSteps as readonly VerificationStep<T>[] };
	}
	return undefined;
}

export function isVerificationPlanShape(value: unknown): value is VerificationPlan {
	return isRecord(value) && typeof value.planId === "string" && Array.isArray(value.steps);
}

export function immutableClone<T>(value: T): T {
	if (Array.isArray(value)) return Object.freeze(value.map((item) => immutableClone(item))) as T;
	if (!isRecord(value)) return value;
	const out: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value)) out[key] = immutableClone(child);
	return Object.freeze(out) as T;
}

export function stringMetadata(
	metadata: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = metadata?.[key];
	return typeof value === "string" && value !== "" ? value : undefined;
}

export function numberMetadata(
	metadata: Record<string, unknown> | undefined,
	key: string,
): number | undefined {
	const value = metadata?.[key];
	return typeof value === "number" ? value : undefined;
}

export function sourceRefId(
	refs: readonly SourceRef[] | undefined,
	kind: string,
): string | undefined {
	return refs?.find((sourceRef) => sourceRef.kind === kind)?.id;
}

export function goalWithInlineInput<T>(
	goal: EffectRunGoal<T>,
	input: T | undefined,
	inputId: string,
	inputKind: string,
	subjectRefs: readonly SourceRef[] | undefined,
): EffectRunGoal<T> {
	if (input === undefined || goal.input !== undefined) return goal;
	return {
		...goal,
		input: {
			inputId,
			inputKind,
			dataMode: "inline",
			value: input,
			subjectRefs,
		},
	};
}

export function issue(
	code: WorkItemValidationIssueCode,
	message: string,
	workItemId?: string,
	metadata?: Record<string, unknown>,
): DataIssue {
	return {
		kind: "issue",
		code,
		message,
		severity: "error",
		source: "work-item-scheduling",
		subjectId: workItemId,
		metadata,
	};
}

export function refs(kind: string, id: string, rest?: readonly SourceRef[]): readonly SourceRef[] {
	return [ref(kind, id), ...(rest ?? [])];
}

export function ref(kind: string, id: string): SourceRef {
	return { kind, id };
}

export function stringArray(value: unknown): readonly string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}
