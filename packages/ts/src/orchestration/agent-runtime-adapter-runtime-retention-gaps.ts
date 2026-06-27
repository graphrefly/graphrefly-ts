import type { DataIssue } from "../data/index.js";
import {
	type ReplayEvidenceClassification,
	type ReplayEvidenceGapKind,
	type RuntimeIndexItem,
	runtimeDiagnosticKey,
	runtimeEvidenceMetadata,
	runtimeEvidenceSourceRefs,
} from "./agent-runtime-adapter-retention.js";
import { dataIssue, ref } from "./agent-runtime-common.js";
import type { SourceRef } from "./agent-runtime-types-core.js";
import type {
	ToolProviderAdapterRunRequested,
	ToolProviderAdapterRunStatus,
	ToolProviderAdapterRuntimeRetentionEvidenceEntry,
	ToolProviderAdapterRuntimeStatus,
} from "./agent-runtime-types-tool.js";

export interface AdapterRuntimeRetentionGapContext {
	publishIssue(issue: DataIssue, track?: boolean): void;
	publishRunStatus(
		request: ToolProviderAdapterRunRequested,
		statusValue: ToolProviderAdapterRunStatus["status"],
		issueList?: readonly DataIssue[],
	): void;
	publishRuntimeStatus(fact: Omit<ToolProviderAdapterRuntimeStatus, "kind">): void;
	publishRuntimeAudit(
		kind: string,
		auditOpts?: {
			readonly subjectId?: string;
			readonly sourceRefs?: readonly SourceRef[];
			readonly issueCode?: string;
			readonly metadata?: Record<string, unknown>;
		},
	): void;
}

function retentionGapIssueCode(gapKind: ReplayEvidenceGapKind): string {
	switch (gapKind) {
		case "evidence-horizon":
			return "tool-provider-adapter-runtime-retention-evidence-gap";
		case "evidence-horizon-closed":
			return "tool-provider-adapter-runtime-retention-evidence-horizon-closed";
		case "adapter-input-trimmed":
		case "execution-proof-trimmed":
			return "tool-provider-adapter-runtime-retention-gap";
	}
}

function retentionGapMessage(gapKind: ReplayEvidenceGapKind): string {
	switch (gapKind) {
		case "evidence-horizon":
			return "Tool provider adapter runtime retention evidence horizon no longer proves this request is fresh.";
		case "evidence-horizon-closed":
			return "Tool provider adapter runtime retention evidence horizon is closed; this request must fail closed.";
		case "adapter-input-trimmed":
			return "Tool provider adapter runtime retention removed the requested adapter input proof.";
		case "execution-proof-trimmed":
			return "Tool provider adapter runtime retention removed execution proof needed to safely replay this request.";
	}
}

function retentionGapEvidenceKind(
	gapKind: ReplayEvidenceGapKind,
): ToolProviderAdapterRuntimeRetentionEvidenceEntry["evidenceKind"] | undefined {
	switch (gapKind) {
		case "adapter-input-trimmed":
			return "adapter-input-trimmed";
		case "execution-proof-trimmed":
			return "execution-high-water";
		case "evidence-horizon":
		case "evidence-horizon-closed":
			return undefined;
	}
}

export function publishAdapterRuntimeRetentionGap(
	ctx: AdapterRuntimeRetentionGapContext,
	request: ToolProviderAdapterRunRequested,
	classification: Extract<ReplayEvidenceClassification, { readonly kind: "retention-gap" }>,
): void {
	const { index, gapKind } = classification;
	const key = classification.key ?? request.adapterInputId;
	const issueCode = retentionGapIssueCode(gapKind);
	const evidenceKind = retentionGapEvidenceKind(gapKind);
	const sourceRefs = runtimeEvidenceSourceRefs(index, [
		ref("tool-provider-adapter-run", request.runId),
		ref("tool-provider-adapter-input", request.adapterInputId),
	]);
	const metadata = runtimeEvidenceMetadata(index, {
		key,
		extra: {
			gapKind,
			...(evidenceKind === undefined ? {} : { evidenceKind }),
		},
	});
	const issue = dataIssue(issueCode, retentionGapMessage(gapKind), {
		subjectId: request.adapterInputId,
		refs: sourceRefs,
		details: {
			index,
			adapterInputId: request.adapterInputId,
			runId: request.runId,
			attempt: request.attempt,
			issueCode,
			gapKind,
			key: runtimeDiagnosticKey(key),
			...(evidenceKind === undefined ? {} : { evidenceKind }),
		},
	});
	ctx.publishIssue(issue);
	ctx.publishRunStatus(request, "retention-gap", [issue]);
	ctx.publishRuntimeStatus({
		status: "retention-gap",
		index,
		key,
		adapterInputId: request.adapterInputId,
		runId: request.runId,
		attempt: request.attempt,
		issueCode: issue.code,
		sourceRefs,
		metadata,
	});
	ctx.publishRuntimeAudit("tool-provider-adapter-runtime-retention-gap", {
		subjectId: request.adapterInputId,
		sourceRefs,
		issueCode: issue.code,
		metadata,
	});
}

export function publishAdapterRuntimeRetentionEvidenceGlobalFailClosed(
	ctx: AdapterRuntimeRetentionGapContext,
	victim: RuntimeIndexItem<
		ToolProviderAdapterRuntimeRetentionEvidenceEntry,
		ToolProviderAdapterRuntimeRetentionEvidenceEntry
	>,
): void {
	const sourceRefs = runtimeEvidenceSourceRefs("retentionEvidence");
	const metadata = runtimeEvidenceMetadata("retentionEvidence", {
		key: victim.key,
		extra: {
			evidenceKind: victim.value.evidenceKind,
			gapKind: "evidence-horizon-closed",
		},
	});
	const issue = dataIssue(
		"tool-provider-adapter-runtime-retention-evidence-horizon-closed",
		"Tool provider adapter runtime retention evidence closed-marker horizon overflowed; future requests fail closed until runtime reset.",
		{
			subjectId: victim.value.adapterInputId,
			refs: sourceRefs,
			details: {
				index: "retentionEvidence",
				key: runtimeDiagnosticKey(victim.key),
				gapKind: "evidence-horizon-closed",
			},
		},
	);
	ctx.publishIssue(issue, false);
	ctx.publishRuntimeStatus({
		status: "retention-gap",
		index: "retentionEvidence",
		key: victim.key,
		adapterInputId: victim.value.adapterInputId,
		...(victim.value.attemptHighWater === undefined
			? {}
			: { attempt: victim.value.attemptHighWater }),
		issueCode: issue.code,
		sourceRefs,
		metadata,
	});
	ctx.publishRuntimeAudit("tool-provider-adapter-runtime-retention-evidence-horizon-closed", {
		subjectId: victim.value.adapterInputId,
		sourceRefs,
		issueCode: issue.code,
		metadata,
	});
}
