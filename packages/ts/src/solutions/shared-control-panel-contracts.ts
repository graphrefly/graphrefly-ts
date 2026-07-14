/** Database-neutral shared control-panel contracts and strict validation (D609). */
import type {
	SourceRef,
	ToolProviderAdapterRunRequested,
	ToolProviderRunAdmission,
} from "../orchestration/index.js";

export const SHARED_CONTROL_PANEL_CONTRACT_VERSION = "1" as const;

export type SharedControlPanelCapability =
	| "view"
	| "query-rerun"
	| "download"
	| "input"
	| "subscribe"
	| "action";
export type SharedControlPanelCondition = "stale" | "anomaly";
export interface SharedControlPanelHostClock {
	now(): number;
}
export interface SharedControlPanelVerifiedTerminalOutcome {
	readonly runId: string;
	readonly attempt: number;
	readonly outcomeId: string;
	readonly terminalHighWater: number;
	readonly outcomeEvidenceFingerprint: string;
	readonly evidenceRefs: readonly SourceRef[];
}
export interface SharedControlPanelTerminalOutcomeAuthority {
	lookup(value: {
		readonly tenantId: string;
		readonly occurrenceId: string;
		readonly admissionId: string;
		readonly approvedRunId: string;
	}): Promise<SharedControlPanelVerifiedTerminalOutcome | null>;
}
export interface SharedControlPanelSubscriptionBindingAuthority {
	lookup(value: {
		readonly intentId: string;
		readonly idempotencyKey: string;
	}): Promise<SharedControlPanelCanvasSubscriptionBinding | null>;
}

export interface SharedControlPanelPins {
	readonly tenantId: string;
	readonly workspaceId: string;
	readonly workGraphId: string;
	readonly panelId: string;
	readonly panelRevision: string;
	readonly queryRevision: string;
	readonly specRevision: string;
	readonly sourceRevision: string;
	readonly schemaRevision: string;
	readonly artifactRevision: string;
	readonly inputRevision: string;
	readonly topologyFingerprint: string;
	readonly policyRevision: string;
	readonly redactionRevision: string;
	readonly environmentId: string;
	readonly environmentRevision: string;
	readonly runId: string;
	readonly requestId: string;
	readonly attempt: number;
	readonly outcomeId: string;
	readonly runHighWater: number;
	readonly evidenceHighWater: number;
	readonly freshnessHighWater: number;
}

export interface SharedControlPanelFrame {
	readonly frameId: string;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}
export interface SharedControlPanelWidget {
	readonly widgetId: string;
	readonly frameId: string;
	readonly bindingKind: "answer" | "topology" | "input" | "status";
	readonly bindingRef: string;
	readonly displayRevision: string;
}

export interface SharedControlPanelRevision {
	readonly kind: "shared-control-panel-revision";
	readonly pins: SharedControlPanelPins;
	readonly previousRevision: string | null;
	readonly title: string;
	readonly frames: readonly SharedControlPanelFrame[];
	readonly widgets: readonly SharedControlPanelWidget[];
	readonly immutableRefs: readonly SourceRef[];
	readonly createdBy: string;
	readonly createdAtMs: number;
}

export interface SharedControlPanelGrant {
	readonly kind: "shared-control-panel-grant";
	readonly grantId: string;
	readonly tenantId: string;
	readonly panelId: string;
	readonly panelRevision: string;
	readonly subjectId: string;
	readonly capability: SharedControlPanelCapability;
	readonly capabilityRevision: string;
	readonly policyRevision: string;
	readonly redactionRevision: string;
	readonly issuedAtMs: number;
	readonly expiresAtMs: number;
	readonly revokedAtMs: number | null;
	readonly actorSessionRevision: string;
}

export interface SharedControlPanelRestrictedProjection {
	readonly kind: "shared-control-panel-restricted-projection";
	readonly grantId: string;
	readonly tenantId: string;
	readonly workspaceId: string;
	readonly panelId: string;
	readonly panelRevision: string;
	readonly workGraphId: string;
	readonly subjectId: string;
	readonly capability: SharedControlPanelCapability;
	readonly policyRevision: string;
	readonly redactionRevision: string;
	readonly frameIds: readonly string[];
	readonly widgetIds: readonly string[];
}

export interface SharedControlPanelSubscriptionRevision {
	readonly kind: "shared-control-panel-subscription-revision";
	readonly tenantId: string;
	readonly subscriptionId: string;
	readonly subscriptionRevision: string;
	readonly previousRevision: string | null;
	readonly panelId: string;
	readonly panelRevision: string;
	readonly subjectId: string;
	readonly pins: SharedControlPanelPins;
	readonly grantId: string;
	readonly capabilityRevision: string;
	readonly actorSessionRevision: string;
	readonly intervalMs: number;
	readonly scheduleAnchorMs: number;
	readonly expiresAtMs: number;
	readonly condition: SharedControlPanelCondition;
	readonly conditionRevision: string;
	readonly staleAfterMs: number;
	readonly anomalyThreshold: number;
	readonly cooldownMs: number;
	readonly rateCap: number;
	readonly policyRevision: string;
	readonly redactionRevision: string;
	readonly active: boolean;
	readonly effectiveAtMs: number;
}
export interface SharedControlPanelCanvasCoordinate {
	readonly id: string;
	readonly revision: string;
}
export interface SharedControlPanelCanvasSubscriptionBinding {
	readonly capability: "subscribe";
	readonly tenant: SharedControlPanelCanvasCoordinate;
	readonly workspace: SharedControlPanelCanvasCoordinate;
	readonly workGraph: SharedControlPanelCanvasCoordinate;
	readonly panel: SharedControlPanelCanvasCoordinate;
	readonly panelHead: SharedControlPanelCanvasCoordinate;
	readonly panelRevision: SharedControlPanelCanvasCoordinate;
	readonly sourceRequest: SharedControlPanelCanvasCoordinate;
	readonly sourceRun: SharedControlPanelCanvasCoordinate;
	readonly sourceOutcome: SharedControlPanelCanvasCoordinate;
	readonly queryPlan: SharedControlPanelCanvasCoordinate;
	readonly spec: SharedControlPanelCanvasCoordinate;
	readonly input: SharedControlPanelCanvasCoordinate;
	readonly source: SharedControlPanelCanvasCoordinate;
	readonly schema: SharedControlPanelCanvasCoordinate;
	readonly evidence: SharedControlPanelCanvasCoordinate;
	readonly artifact: SharedControlPanelCanvasCoordinate;
	readonly actorSession: SharedControlPanelCanvasCoordinate;
	readonly actorSubject: SharedControlPanelCanvasCoordinate;
	readonly actorGrant: SharedControlPanelCanvasCoordinate;
	readonly actorCapabilitySet: SharedControlPanelCanvasCoordinate;
	readonly capabilityRevision: SharedControlPanelCanvasCoordinate;
	readonly actorAdmission: SharedControlPanelCanvasCoordinate;
	readonly issuedAt: SharedControlPanelCanvasCoordinate;
	readonly expiresAt: SharedControlPanelCanvasCoordinate;
	readonly policy: SharedControlPanelCanvasCoordinate;
	readonly redaction: SharedControlPanelCanvasCoordinate;
	readonly attempt: number;
	readonly topologyFingerprint: string;
	readonly terminalHighWater: string;
	readonly evidenceHighWater: string;
	readonly artifactHighWater: string;
	readonly freshnessHighWater: string;
}
export interface SharedControlPanelCanvasSubscriptionIntent {
	readonly kind: "workspace-shared-control-panel-subscription-intent";
	readonly contractVersion: "1";
	readonly intentId: string;
	readonly idempotencyKey: string;
	readonly action: "create" | "pause" | "resume" | "revoke";
	readonly binding: SharedControlPanelCanvasSubscriptionBinding;
	readonly subscription?: SharedControlPanelCanvasCoordinate;
	readonly intervalSeconds?: number;
	readonly condition?: SharedControlPanelCondition;
}
export interface SharedControlPanelHostSubscriptionRequest {
	readonly kind: "shared-control-panel-host-subscription-request";
	readonly intent: SharedControlPanelCanvasSubscriptionIntent;
	readonly revision: SharedControlPanelSubscriptionRevision;
	readonly admittedAtMs: number;
	readonly bindingAuthorityFingerprint: string;
}

export interface SharedControlPanelCurrentTruth {
	readonly kind: "shared-control-panel-current-truth";
	readonly pins: SharedControlPanelPins;
	readonly subjectId: string;
	readonly grantId: string;
	readonly capability: SharedControlPanelCapability;
	readonly capabilityRevision: string;
	readonly currentPolicyRevision: string;
	readonly currentRedactionRevision: string;
	readonly actorSessionRevision: string;
	readonly observedAtMs: number;
}

export interface SharedControlPanelOccurrence {
	readonly kind: "shared-control-panel-occurrence";
	readonly tenantId: string;
	readonly occurrenceId: string;
	readonly subscriptionId: string;
	readonly subscriptionRevision: string;
	readonly conditionRevision: string;
	readonly panelId: string;
	readonly panelRevision: string;
	readonly dueAtMs: number;
	readonly claimedAtMs: number;
	readonly admissionFingerprint: string;
	readonly state: "claimed" | "candidate-created" | "completed" | "evaluated";
	readonly reason: string;
	readonly candidate: SharedControlPanelCandidate | null;
	readonly completed: SharedControlPanelCompletedOccurrence | null;
	readonly evaluation: SharedControlPanelOccurrenceEvaluation | null;
}
export interface SharedControlPanelOccurrenceEvaluation {
	readonly kind: "shared-control-panel-occurrence-evaluation";
	readonly evidenceFingerprint: string;
	readonly conditionRevision: string;
	readonly policyRevision: string;
	readonly decisionFingerprint: string;
	readonly alertId: string | null;
	readonly suppressionId: string | null;
	readonly evaluatedAtMs: number;
}

export interface SharedControlPanelSignal {
	readonly observedAtMs: number;
	readonly lastSuccessfulRunAtMs: number;
	readonly value: number;
	readonly baseline: number;
	readonly evidenceFingerprint: string;
	readonly evidenceRefs: readonly SourceRef[];
}

export interface SharedControlPanelCandidate {
	readonly kind: "shared-control-panel-run-candidate";
	readonly occurrenceId: string;
	/** A fresh ordinary M9/M10 request which still requires D419 admission. */
	readonly request: ToolProviderAdapterRunRequested;
	readonly createdAtMs: number;
}

export interface SharedControlPanelCompletedOccurrence {
	readonly kind: "shared-control-panel-completed-occurrence";
	readonly occurrenceId: string;
	readonly candidateRequestId: string;
	readonly candidateRunId: string;
	readonly admissionId: string;
	readonly admissionSourceRefs: readonly SourceRef[];
	/** D419-approved ordinary run identity; intentionally differs from candidateRunId. */
	readonly runId: string;
	readonly attempt: number;
	readonly outcomeId: string;
	readonly terminalHighWater: number;
	readonly outcomeEvidenceFingerprint: string;
	readonly evidenceRefs: readonly SourceRef[];
	readonly completedAtMs: number;
}

export interface SharedControlPanelSuppression {
	readonly kind: "shared-control-panel-suppression";
	readonly suppressionId: string;
	readonly tenantId: string;
	readonly occurrenceId: string;
	readonly subscriptionId: string;
	readonly subscriptionRevision: string;
	readonly conditionRevision: string;
	readonly evidenceFingerprint: string;
	readonly reason: "condition-false" | "cooldown" | "rate-cap" | "duplicate";
	readonly policyRevision: string;
	readonly createdAtMs: number;
}

export interface SharedControlPanelAlert {
	readonly kind: "shared-control-panel-alert";
	readonly alertId: string;
	readonly tenantId: string;
	readonly occurrenceId: string;
	readonly subscriptionId: string;
	readonly subscriptionRevision: string;
	readonly conditionRevision: string;
	readonly panelId: string;
	readonly panelRevision: string;
	readonly condition: SharedControlPanelCondition;
	readonly evidenceFingerprint: string;
	readonly evidenceRefs: readonly SourceRef[];
	readonly createdAtMs: number;
}

export interface SharedControlPanelInboxDelivery {
	readonly kind: "shared-control-panel-inbox-delivery";
	readonly deliveryId: string;
	readonly tenantId: string;
	readonly alertId: string;
	readonly recipientId: string;
	readonly redactionRevision: string;
	readonly state: "pending" | "attempted" | "delivered" | "failed" | "suppressed" | "expired";
	readonly createdAtMs: number;
	readonly deliveredAtMs: number | null;
	readonly terminalAtMs: number | null;
}

export interface SharedControlPanelAuditEntry {
	readonly kind: "shared-control-panel-audit";
	readonly tenantId: string;
	readonly sequence: number;
	readonly eventId: string;
	readonly eventKind: string;
	readonly subjectId: string;
	readonly objectId: string;
	readonly occurredAtMs: number;
}

export interface SharedControlPanelStoreResult<T = never> {
	readonly accepted: boolean;
	readonly code: string;
	readonly value?: T;
}
export interface SharedControlPanelCanonicalTruth {
	readonly kind: "shared-control-panel-canonical-truth";
	readonly pins: SharedControlPanelPins;
	readonly recordedAtMs: number;
}
export interface SharedControlPanelRecordedAdmission {
	readonly kind: "shared-control-panel-recorded-admission";
	readonly tenantId: string;
	readonly occurrenceId: string;
	readonly admission: ToolProviderRunAdmission;
	readonly bodyFingerprint: string;
	readonly recordedAtMs: number;
}
export interface SharedControlPanelRecordedTerminalOutcome {
	readonly kind: "shared-control-panel-recorded-terminal-outcome";
	readonly tenantId: string;
	readonly occurrenceId: string;
	readonly runId: string;
	readonly attempt: number;
	readonly outcomeId: string;
	readonly terminalHighWater: number;
	readonly outcomeEvidenceFingerprint: string;
	readonly evidenceRefs: readonly SourceRef[];
	readonly recordedAtMs: number;
}
export interface SharedControlPanelQueryRerunRequest {
	readonly kind: "shared-control-panel-query-rerun-request";
	readonly rerunId: string;
	readonly idempotencyKey: string;
	readonly truth: SharedControlPanelCurrentTruth;
	readonly candidate: SharedControlPanelCandidate;
	readonly binding: SharedControlPanelQueryRerunBinding;
	readonly requestedAtMs: number;
}
export interface SharedControlPanelQueryRerunBinding {
	readonly tenantId: string;
	readonly workspaceId: string;
	readonly workGraphId: string;
	readonly panelId: string;
	readonly panelRevision: string;
	readonly priorRequestId: string;
	readonly priorRunId: string;
	readonly priorOutcomeId: string;
	readonly queryRevision: string;
	readonly specRevision: string;
	readonly inputRevision: string;
	readonly sourceRevision: string;
	readonly policyRevision: string;
}

export function sharedControlPanelConditionMatches(
	sub: SharedControlPanelSubscriptionRevision,
	signal: SharedControlPanelSignal,
	nowMs: number,
): boolean {
	validateSubscription(sub);
	validateSignal(signal);
	timestamp(nowMs);
	return sub.condition === "stale"
		? nowMs - signal.lastSuccessfulRunAtMs >= sub.staleAfterMs
		: Math.abs(signal.value - signal.baseline) >= sub.anomalyThreshold;
}
export function sharedControlPanelCapabilitySupported(
	capability: SharedControlPanelCapability,
): boolean {
	return supported(capability);
}
export function sharedControlPanelCompletedOccurrenceCorrelates(
	occurrence: SharedControlPanelOccurrence,
	completed: SharedControlPanelCompletedOccurrence,
): boolean {
	validateOccurrence(occurrence);
	validateCompleted(completed, occurrence, completed.completedAtMs);
	const candidate = occurrence.candidate?.request;
	return (
		candidate !== undefined &&
		candidate.requestId === completed.candidateRequestId &&
		candidate.runId === completed.candidateRunId &&
		candidate.attempt === completed.attempt &&
		completed.admissionSourceRefs.some(
			(ref) => ref.kind === "tool-provider-run-admission" && ref.id === completed.admissionId,
		)
	);
}
export function sharedControlPanelAdmissionFingerprint(
	admission: ToolProviderRunAdmission,
): string {
	validateAdmission(admission);
	return boundedFingerprint(admission);
}
export function sharedControlPanelAdmitCanvasSubscriptionIntent(
	intent: SharedControlPanelCanvasSubscriptionIntent,
	revision: SharedControlPanelSubscriptionRevision,
	admittedAtMs: number,
	authoritativeBinding: SharedControlPanelCanvasSubscriptionBinding,
): SharedControlPanelHostSubscriptionRequest {
	validateCanvasSubscriptionIntentEnvelope(intent);
	const safeIntentBinding = validateCanvasSubscriptionBinding(intent.binding, revision);
	const safeAuthoritativeBinding = validateCanvasSubscriptionBinding(
		authoritativeBinding,
		revision,
	);
	if (canonical(safeIntentBinding) !== canonical(safeAuthoritativeBinding))
		throw new TypeError("canvas-subscription-binding-authority-mismatch");
	return validateHostSubscriptionRequest({
		kind: "shared-control-panel-host-subscription-request",
		intent,
		revision,
		admittedAtMs,
		bindingAuthorityFingerprint: boundedFingerprint(safeAuthoritativeBinding),
	});
}
export function boundedFingerprint(value: unknown) {
	let hash = 0xcbf29ce484222325n;
	for (const byte of new TextEncoder().encode(canonical(value))) {
		hash ^= BigInt(byte);
		hash = BigInt.asUintN(64, hash * 0x100000001b3n);
	}
	return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}
export function evaluationDecisionFingerprint(
	sub: SharedControlPanelSubscriptionRevision,
	signal: SharedControlPanelSignal,
	alert: SharedControlPanelAlert | null,
	suppression: SharedControlPanelSuppression | null,
) {
	return boundedFingerprint({
		condition: sub.condition,
		conditionRevision: sub.conditionRevision,
		policyRevision: sub.policyRevision,
		staleAfterMs: sub.staleAfterMs,
		anomalyThreshold: sub.anomalyThreshold,
		cooldownMs: sub.cooldownMs,
		rateCap: sub.rateCap,
		signal,
		decision: alert
			? { kind: "alert", id: alert.alertId }
			: { kind: "suppression", id: suppression?.suppressionId, reason: suppression?.reason },
	});
}
export function sharedControlPanelRecordedOutcomeMatchesCompleted(
	outcome: SharedControlPanelRecordedTerminalOutcome,
	completed: SharedControlPanelCompletedOccurrence,
): boolean {
	validateRecordedTerminalOutcome(outcome);
	return (
		outcome.runId === completed.runId &&
		outcome.attempt === completed.attempt &&
		outcome.outcomeId === completed.outcomeId &&
		outcome.terminalHighWater === completed.terminalHighWater &&
		outcome.outcomeEvidenceFingerprint === completed.outcomeEvidenceFingerprint &&
		canonical(outcome.evidenceRefs) === canonical(completed.evidenceRefs)
	);
}

export function supported(value: SharedControlPanelCapability) {
	return value === "view" || value === "query-rerun" || value === "subscribe";
}
export function validateRevision(v: SharedControlPanelRevision) {
	exactKeys(v, [
		"kind",
		"pins",
		"previousRevision",
		"title",
		"frames",
		"widgets",
		"immutableRefs",
		"createdBy",
		"createdAtMs",
	]);
	if (v.kind !== "shared-control-panel-revision")
		throw new TypeError("invalid-panel-revision-kind");
	validatePins(v.pins);
	optionalIdentity(v.previousRevision, "previousRevision");
	identity(v.title, "title");
	identity(v.createdBy, "createdBy");
	timestamp(v.createdAtMs);
	if (
		!Array.isArray(v.frames) ||
		!Array.isArray(v.widgets) ||
		!Array.isArray(v.immutableRefs) ||
		v.frames.length > 64 ||
		v.widgets.length > 64 ||
		v.immutableRefs.length > 64
	)
		throw new TypeError("invalid-panel-bounds");
	denseArray(v.frames, "frames");
	denseArray(v.widgets, "widgets");
	denseArray(v.immutableRefs, "immutableRefs");
	const frames = new Set<string>();
	for (const frame of v.frames) {
		exactKeys(frame, ["frameId", "x", "y", "width", "height"]);
		identity(frame.frameId, "frameId");
		for (const n of [frame.x, frame.y, frame.width, frame.height])
			if (typeof n !== "number" || !Number.isFinite(n))
				throw new TypeError("invalid-frame-coordinate");
		if (
			typeof frame.width !== "number" ||
			typeof frame.height !== "number" ||
			frame.width <= 0 ||
			frame.height <= 0 ||
			frames.has(frame.frameId)
		)
			throw new TypeError("invalid-frame");
		frames.add(frame.frameId);
	}
	const widgets = new Set<string>();
	for (const widget of v.widgets) {
		exactKeys(widget, ["widgetId", "frameId", "bindingKind", "bindingRef", "displayRevision"]);
		identity(widget.widgetId, "widgetId");
		identity(widget.frameId, "frameId");
		identity(widget.bindingRef, "bindingRef");
		identity(widget.displayRevision, "displayRevision");
		if (
			!frames.has(widget.frameId) ||
			widgets.has(widget.widgetId) ||
			typeof widget.bindingKind !== "string" ||
			!["answer", "topology", "input", "status"].includes(widget.bindingKind)
		)
			throw new TypeError("invalid-widget");
		widgets.add(widget.widgetId);
	}
	for (const ref of v.immutableRefs) sourceRef(ref);
	return snapshot(v);
}
export function validatePins(v: SharedControlPanelPins) {
	exactKeys(v, [
		"tenantId",
		"workspaceId",
		"workGraphId",
		"panelId",
		"panelRevision",
		"queryRevision",
		"specRevision",
		"sourceRevision",
		"schemaRevision",
		"artifactRevision",
		"inputRevision",
		"topologyFingerprint",
		"policyRevision",
		"redactionRevision",
		"environmentId",
		"environmentRevision",
		"runId",
		"requestId",
		"attempt",
		"outcomeId",
		"runHighWater",
		"evidenceHighWater",
		"freshnessHighWater",
	]);
	for (const [k, x] of Object.entries(v))
		if (["attempt", "runHighWater", "evidenceHighWater", "freshnessHighWater"].includes(k)) {
			if (!Number.isSafeInteger(x) || Number(x) < 0) throw new TypeError(`invalid-${k}`);
		} else identity(x, k);
}
export function validateGrant(v: unknown): SharedControlPanelGrant {
	exactKeys(v, [
		"kind",
		"grantId",
		"tenantId",
		"panelId",
		"panelRevision",
		"subjectId",
		"capability",
		"capabilityRevision",
		"policyRevision",
		"redactionRevision",
		"issuedAtMs",
		"expiresAtMs",
		"revokedAtMs",
		"actorSessionRevision",
	]);
	const x = v as unknown as SharedControlPanelGrant;
	if (x.kind !== "shared-control-panel-grant" || !capabilities.includes(x.capability))
		throw new TypeError("invalid-grant");
	for (const [k, y] of Object.entries(x))
		if (k.endsWith("AtMs")) {
			if (y !== null) timestamp(y as number);
		} else if (k !== "kind" && k !== "capability") identity(y, k);
	if (x.expiresAtMs <= x.issuedAtMs) throw new TypeError("invalid-grant-expiry");
	return snapshot(x);
}

export function validateRestrictedProjection(v: unknown): SharedControlPanelRestrictedProjection {
	exactKeys(v, [
		"kind",
		"grantId",
		"tenantId",
		"workspaceId",
		"panelId",
		"panelRevision",
		"workGraphId",
		"subjectId",
		"capability",
		"policyRevision",
		"redactionRevision",
		"frameIds",
		"widgetIds",
	]);
	const x = v as unknown as SharedControlPanelRestrictedProjection;
	if (x.kind !== "shared-control-panel-restricted-projection" || !supported(x.capability))
		throw new TypeError("invalid-restricted-projection");
	for (const value of [
		x.grantId,
		x.tenantId,
		x.workspaceId,
		x.panelId,
		x.panelRevision,
		x.workGraphId,
		x.subjectId,
		x.policyRevision,
		x.redactionRevision,
	])
		identity(value, "restricted-projection-coordinate");
	if (!Array.isArray(x.frameIds) || !Array.isArray(x.widgetIds))
		throw new TypeError("invalid-restricted-projection-ids");
	denseArray(x.frameIds, "restrictedProjectionFrameIds");
	denseArray(x.widgetIds, "restrictedProjectionWidgetIds");
	for (const value of [...x.frameIds, ...x.widgetIds]) identity(value, "restricted-projection-id");
	return snapshot(x);
}
export function validateTruth(v: SharedControlPanelCurrentTruth) {
	exactKeys(v, [
		"kind",
		"pins",
		"subjectId",
		"grantId",
		"capability",
		"capabilityRevision",
		"currentPolicyRevision",
		"currentRedactionRevision",
		"actorSessionRevision",
		"observedAtMs",
	]);
	if (v.kind !== "shared-control-panel-current-truth") throw new TypeError("invalid-current-truth");
	validatePins(v.pins);
	identity(v.subjectId, "subjectId");
	identity(v.grantId, "grantId");
	if (!capabilities.includes(v.capability)) throw new TypeError("invalid-capability");
	identity(v.capabilityRevision, "capabilityRevision");
	identity(v.currentPolicyRevision, "policyRevision");
	identity(v.currentRedactionRevision, "redactionRevision");
	identity(v.actorSessionRevision, "actorSessionRevision");
	timestamp(v.observedAtMs);
}
export function validateSubscription(v: SharedControlPanelSubscriptionRevision) {
	exactKeys(v, [
		"kind",
		"tenantId",
		"subscriptionId",
		"subscriptionRevision",
		"previousRevision",
		"panelId",
		"panelRevision",
		"subjectId",
		"pins",
		"grantId",
		"capabilityRevision",
		"actorSessionRevision",
		"intervalMs",
		"scheduleAnchorMs",
		"expiresAtMs",
		"condition",
		"conditionRevision",
		"staleAfterMs",
		"anomalyThreshold",
		"cooldownMs",
		"rateCap",
		"policyRevision",
		"redactionRevision",
		"active",
		"effectiveAtMs",
	]);
	if (
		v.kind !== "shared-control-panel-subscription-revision" ||
		!["stale", "anomaly"].includes(v.condition)
	)
		throw new TypeError("invalid-subscription");
	for (const [k, x] of Object.entries(v)) {
		if (
			[
				"intervalMs",
				"staleAfterMs",
				"cooldownMs",
				"rateCap",
				"effectiveAtMs",
				"scheduleAnchorMs",
				"expiresAtMs",
			].includes(k)
		) {
			if (!Number.isSafeInteger(x) || Number(x) < 0) throw new TypeError(`invalid-${k}`);
		} else if (k === "anomalyThreshold") {
			if (typeof x !== "number" || !Number.isFinite(x) || x < 0)
				throw new TypeError("invalid-anomaly-threshold");
		} else if (k === "pins") validatePins(x as SharedControlPanelPins);
		else if (k !== "kind" && k !== "condition" && k !== "active" && k !== "previousRevision")
			identity(x, k);
	}
	optionalIdentity(v.previousRevision, "previousRevision");
	if (v.intervalMs < 60_000 || v.rateCap < 1 || v.expiresAtMs <= v.effectiveAtMs)
		throw new TypeError("unsafe-subscription-bounds");
	return snapshot(v);
}
export function validateHostSubscriptionRequest(
	v: SharedControlPanelHostSubscriptionRequest,
): SharedControlPanelHostSubscriptionRequest {
	exactKeys(v, ["kind", "intent", "revision", "admittedAtMs", "bindingAuthorityFingerprint"]);
	if (v.kind !== "shared-control-panel-host-subscription-request")
		throw new TypeError("invalid-host-subscription-request");
	const sub = validateSubscription(v.revision);
	const intent = v.intent;
	validateCanvasSubscriptionIntentEnvelope(intent);
	if (
		intent.kind !== "workspace-shared-control-panel-subscription-intent" ||
		intent.contractVersion !== "1" ||
		!["create", "pause", "resume", "revoke"].includes(intent.action)
	)
		throw new TypeError("invalid-canvas-subscription-intent");
	identity(intent.intentId, "intentId");
	identity(intent.idempotencyKey, "idempotencyKey");
	timestamp(v.admittedAtMs);
	identity(v.bindingAuthorityFingerprint, "bindingAuthorityFingerprint");
	const safeBinding = validateCanvasSubscriptionBinding(intent.binding, sub);
	if (v.bindingAuthorityFingerprint !== boundedFingerprint(safeBinding))
		throw new TypeError("subscription-binding-authority-fingerprint-mismatch");
	if (v.admittedAtMs !== sub.effectiveAtMs)
		throw new TypeError("subscription-admission-time-mismatch");
	const create = intent.action === "create";
	if (
		(create &&
			(sub.previousRevision !== null ||
				!sub.active ||
				intent.subscription !== undefined ||
				intent.intervalSeconds !== sub.intervalMs / 1_000 ||
				intent.condition !== sub.condition)) ||
		(!create &&
			(sub.previousRevision === null ||
				intent.intervalSeconds !== undefined ||
				intent.condition !== undefined ||
				!intent.subscription ||
				intent.subscription.id !== sub.subscriptionId ||
				intent.subscription.revision !== sub.previousRevision ||
				(intent.action === "resume") !== sub.active))
	)
		throw new TypeError("subscription-intent-revision-mismatch");
	return snapshot(v);
}
export function validateCanvasSubscriptionBinding(
	v: SharedControlPanelCanvasSubscriptionBinding,
	sub: SharedControlPanelSubscriptionRevision,
): SharedControlPanelCanvasSubscriptionBinding {
	const coordinateKeys = [
		"tenant",
		"workspace",
		"workGraph",
		"panel",
		"panelHead",
		"panelRevision",
		"sourceRequest",
		"sourceRun",
		"sourceOutcome",
		"queryPlan",
		"spec",
		"input",
		"source",
		"schema",
		"evidence",
		"artifact",
		"actorSession",
		"actorSubject",
		"actorGrant",
		"actorCapabilitySet",
		"capabilityRevision",
		"actorAdmission",
		"issuedAt",
		"expiresAt",
		"policy",
		"redaction",
	] as const;
	exactKeys(v, [
		"capability",
		...coordinateKeys,
		"attempt",
		"topologyFingerprint",
		"terminalHighWater",
		"evidenceHighWater",
		"artifactHighWater",
		"freshnessHighWater",
	]);
	if (v.capability !== "subscribe") throw new TypeError("subscribe-binding-required");
	for (const key of coordinateKeys) {
		exactKeys(v[key], ["id", "revision"]);
		identity(v[key].id, `${key}Id`);
		identity(v[key].revision, `${key}Revision`);
	}
	if (!Number.isSafeInteger(v.attempt) || v.attempt < 0)
		throw new TypeError("invalid-binding-attempt");
	for (const [key, value] of [
		["topologyFingerprint", v.topologyFingerprint],
		["terminalHighWater", v.terminalHighWater],
		["evidenceHighWater", v.evidenceHighWater],
		["artifactHighWater", v.artifactHighWater],
		["freshnessHighWater", v.freshnessHighWater],
	] as const)
		identity(value, key);
	const p = sub.pins;
	const mismatched =
		v.tenant.id !== p.tenantId ||
		v.workspace.id !== p.workspaceId ||
		v.workGraph.id !== p.workGraphId ||
		v.panel.id !== p.panelId ||
		v.panelRevision.revision !== p.panelRevision ||
		v.sourceRequest.id !== p.requestId ||
		v.sourceRun.id !== p.runId ||
		v.sourceOutcome.id !== p.outcomeId ||
		v.queryPlan.revision !== p.queryRevision ||
		v.spec.revision !== p.specRevision ||
		v.input.revision !== p.inputRevision ||
		v.source.revision !== p.sourceRevision ||
		v.schema.revision !== p.schemaRevision ||
		v.artifact.revision !== p.artifactRevision ||
		v.actorSession.revision !== sub.actorSessionRevision ||
		v.actorSubject.id !== sub.subjectId ||
		v.actorGrant.id !== sub.grantId ||
		v.actorGrant.revision !== sub.capabilityRevision ||
		canonical(v.actorCapabilitySet) !== canonical(v.capabilityRevision) ||
		v.capabilityRevision.revision !== sub.capabilityRevision ||
		v.policy.revision !== sub.policyRevision ||
		v.redaction.revision !== sub.redactionRevision ||
		v.attempt !== p.attempt ||
		v.topologyFingerprint !== p.topologyFingerprint ||
		v.terminalHighWater !== String(p.runHighWater) ||
		v.evidenceHighWater !== String(p.evidenceHighWater) ||
		v.freshnessHighWater !== String(p.freshnessHighWater);
	if (mismatched) throw new TypeError("canvas-subscription-binding-mismatch");
	return snapshot(v);
}
export function validateCanvasSubscriptionIntentEnvelope(
	v: SharedControlPanelCanvasSubscriptionIntent,
) {
	exactKeys(
		v,
		[
			"kind",
			"contractVersion",
			"intentId",
			"idempotencyKey",
			"action",
			"binding",
			"subscription",
			"intervalSeconds",
			"condition",
		],
		["subscription", "intervalSeconds", "condition"],
	);
}
export function validateOccurrence(v: unknown): SharedControlPanelOccurrence {
	exactKeys(v, [
		"kind",
		"tenantId",
		"occurrenceId",
		"subscriptionId",
		"subscriptionRevision",
		"conditionRevision",
		"panelId",
		"panelRevision",
		"dueAtMs",
		"claimedAtMs",
		"admissionFingerprint",
		"state",
		"reason",
		"candidate",
		"completed",
		"evaluation",
	]);
	const x = v as unknown as SharedControlPanelOccurrence;
	if (
		x.kind !== "shared-control-panel-occurrence" ||
		!["claimed", "candidate-created", "completed", "evaluated"].includes(x.state)
	)
		throw new TypeError("invalid-occurrence");
	for (const [k, y] of Object.entries(x))
		if (k.endsWith("AtMs")) timestamp(y as number);
		else if (
			k !== "kind" &&
			k !== "state" &&
			k !== "candidate" &&
			k !== "completed" &&
			k !== "evaluation"
		)
			identity(y, k);
	if (x.candidate !== null) validateCandidate(x.candidate, x, x.candidate.createdAtMs);
	if (x.completed !== null) validateCompleted(x.completed, x, x.completed.completedAtMs);
	if (x.evaluation !== null) validateEvaluation(x.evaluation);
	if (
		(x.state === "claimed" &&
			(x.candidate !== null || x.completed !== null || x.evaluation !== null)) ||
		(x.state === "candidate-created" &&
			(x.candidate === null || x.completed !== null || x.evaluation !== null)) ||
		(x.state === "completed" &&
			(x.candidate === null || x.completed === null || x.evaluation !== null)) ||
		(x.state === "evaluated" &&
			(x.candidate === null || x.completed === null || x.evaluation === null))
	)
		throw new TypeError("invalid-occurrence-state-coherence");
	if (
		x.candidate &&
		x.completed &&
		(x.candidate.request.requestId !== x.completed.candidateRequestId ||
			x.candidate.request.runId !== x.completed.candidateRunId ||
			x.candidate.request.attempt !== x.completed.attempt)
	)
		throw new TypeError("invalid-occurrence-completion-correlation");
	if (
		x.completed &&
		x.evaluation &&
		(x.evaluation.evidenceFingerprint !== x.completed.outcomeEvidenceFingerprint ||
			x.evaluation.conditionRevision !== x.conditionRevision ||
			x.evaluation.evaluatedAtMs < x.completed.completedAtMs)
	)
		throw new TypeError("invalid-occurrence-evaluation-correlation");
	return snapshot(x);
}
export function validateEvaluation(v: SharedControlPanelOccurrenceEvaluation) {
	exactKeys(v, [
		"kind",
		"evidenceFingerprint",
		"conditionRevision",
		"policyRevision",
		"decisionFingerprint",
		"alertId",
		"suppressionId",
		"evaluatedAtMs",
	]);
	if (
		v.kind !== "shared-control-panel-occurrence-evaluation" ||
		(v.alertId === null) === (v.suppressionId === null)
	)
		throw new TypeError("invalid-occurrence-evaluation");
	identity(v.evidenceFingerprint, "evidenceFingerprint");
	identity(v.conditionRevision, "conditionRevision");
	identity(v.policyRevision, "policyRevision");
	identity(v.decisionFingerprint, "decisionFingerprint");
	optionalIdentity(v.alertId, "alertId");
	optionalIdentity(v.suppressionId, "suppressionId");
	timestamp(v.evaluatedAtMs);
}
export function validateSignal(v: SharedControlPanelSignal) {
	exactKeys(v, [
		"observedAtMs",
		"lastSuccessfulRunAtMs",
		"value",
		"baseline",
		"evidenceFingerprint",
		"evidenceRefs",
	]);
	timestamp(v.observedAtMs);
	timestamp(v.lastSuccessfulRunAtMs);
	if (!Number.isFinite(v.value) || !Number.isFinite(v.baseline))
		throw new TypeError("invalid-signal-value");
	identity(v.evidenceFingerprint, "evidenceFingerprint");
	if (!Array.isArray(v.evidenceRefs) || v.evidenceRefs.length > 32)
		throw new TypeError("invalid-evidence-refs");
	for (const r of v.evidenceRefs) sourceRef(r);
}
export function validateCandidate(
	v: SharedControlPanelCandidate,
	o: SharedControlPanelOccurrence,
	now: number,
) {
	exactKeys(v, ["kind", "occurrenceId", "request", "createdAtMs"]);
	if (
		v.kind !== "shared-control-panel-run-candidate" ||
		v.occurrenceId !== o.occurrenceId ||
		v.createdAtMs !== now
	)
		throw new TypeError("invalid-fresh-run-candidate");
	validateCandidateRequest(v.request);
}
export function validateCandidateRequest(v: ToolProviderAdapterRunRequested) {
	exactKeys(
		v,
		[
			"kind",
			"runId",
			"adapterInputId",
			"requestId",
			"operationId",
			"routeId",
			"providerId",
			"executorId",
			"profileId",
			"attempt",
			"reason",
			"retryOfOutcomeId",
			"policyRefs",
			"sourceRefs",
			"requestedAtMs",
			"metadata",
		],
		[
			"routeId",
			"providerId",
			"executorId",
			"profileId",
			"retryOfOutcomeId",
			"policyRefs",
			"sourceRefs",
			"requestedAtMs",
			"metadata",
		],
	);
	if (
		v.kind !== "tool-provider-adapter-run-requested" ||
		!Number.isSafeInteger(v.attempt) ||
		v.attempt < 0
	)
		throw new TypeError("invalid-candidate-request");
	for (const x of [v.runId, v.adapterInputId, v.requestId, v.operationId, v.reason])
		identity(x, "candidate-coordinate");
	for (const x of [v.routeId, v.providerId, v.executorId, v.profileId, v.retryOfOutcomeId])
		if (x !== undefined) identity(x, "candidate-coordinate");
	for (const refs of [v.policyRefs, v.sourceRefs])
		if (refs) {
			if (!Array.isArray(refs) || refs.length > 32) throw new TypeError("candidate-refs-too-large");
			for (const ref of refs) sourceRef(ref);
		}
	if (v.requestedAtMs !== undefined) timestamp(v.requestedAtMs);
	if (v.metadata !== undefined) validateEnvironmentPinnedMetadata(v.metadata);
}
export function validateEnvironmentPinnedMetadata(v: Record<string, unknown>) {
	exactKeys(
		v,
		[
			"executionEnvironmentId",
			"executionEnvironmentRevision",
			"executionEnvironmentLocality",
			"executionEnvironmentBindingKind",
			"executionSessionEpoch",
			"executionManifestFingerprint",
		],
		["executionManifestFingerprint"],
	);
	for (const key of [
		"executionEnvironmentId",
		"executionEnvironmentRevision",
		"executionSessionEpoch",
	] as const)
		identity(v[key], key);
	if (
		!["local", "managed-cloud", "customer-hosted"].includes(
			v.executionEnvironmentLocality as string,
		)
	)
		throw new TypeError("invalid-execution-environment-locality");
	if (
		!["local-host-process", "local-container", "remote-session"].includes(
			v.executionEnvironmentBindingKind as string,
		)
	)
		throw new TypeError("invalid-execution-environment-binding-kind");
	if (v.executionManifestFingerprint !== undefined)
		identity(v.executionManifestFingerprint, "executionManifestFingerprint");
}
export function validateAlert(
	v: SharedControlPanelAlert,
	o: SharedControlPanelOccurrence,
	s: SharedControlPanelSignal,
	now: number,
	sub?: SharedControlPanelSubscriptionRevision,
) {
	exactKeys(v, [
		"kind",
		"alertId",
		"tenantId",
		"occurrenceId",
		"subscriptionId",
		"subscriptionRevision",
		"conditionRevision",
		"panelId",
		"panelRevision",
		"condition",
		"evidenceFingerprint",
		"evidenceRefs",
		"createdAtMs",
	]);
	if (
		v.kind !== "shared-control-panel-alert" ||
		v.tenantId !== o.tenantId ||
		v.occurrenceId !== o.occurrenceId ||
		v.subscriptionId !== o.subscriptionId ||
		v.subscriptionRevision !== o.subscriptionRevision ||
		v.conditionRevision !== o.conditionRevision ||
		v.panelId !== o.panelId ||
		v.panelRevision !== o.panelRevision ||
		(sub !== undefined &&
			(v.condition !== sub.condition || v.conditionRevision !== sub.conditionRevision)) ||
		v.evidenceFingerprint !== s.evidenceFingerprint ||
		v.createdAtMs !== now
	)
		throw new TypeError("invalid-alert");
	if (v.evidenceRefs.length > 32) throw new TypeError("alert-evidence-too-large");
	denseArray(v.evidenceRefs, "alertEvidenceRefs");
	for (const ref of v.evidenceRefs) sourceRef(ref);
}
export function validateCompleted(
	v: SharedControlPanelCompletedOccurrence,
	o: SharedControlPanelOccurrence,
	now: number,
) {
	exactKeys(v, [
		"kind",
		"occurrenceId",
		"candidateRequestId",
		"candidateRunId",
		"admissionId",
		"admissionSourceRefs",
		"runId",
		"attempt",
		"outcomeId",
		"terminalHighWater",
		"outcomeEvidenceFingerprint",
		"evidenceRefs",
		"completedAtMs",
	]);
	if (
		v.kind !== "shared-control-panel-completed-occurrence" ||
		v.occurrenceId !== o.occurrenceId ||
		v.completedAtMs !== now ||
		!Number.isSafeInteger(v.attempt) ||
		!Number.isSafeInteger(v.terminalHighWater)
	)
		throw new TypeError("invalid-completed-occurrence");
	for (const x of [v.candidateRequestId, v.candidateRunId, v.admissionId, v.runId, v.outcomeId])
		identity(x, "completed-coordinate");
	if (
		!Array.isArray(v.admissionSourceRefs) ||
		v.admissionSourceRefs.length === 0 ||
		v.admissionSourceRefs.length > 16
	)
		throw new TypeError("invalid-admission-source-refs");
	for (const ref of v.admissionSourceRefs) sourceRef(ref);
	identity(v.outcomeEvidenceFingerprint, "outcomeEvidenceFingerprint");
	if (!Array.isArray(v.evidenceRefs) || v.evidenceRefs.length > 32)
		throw new TypeError("invalid-completed-evidence");
	for (const ref of v.evidenceRefs) sourceRef(ref);
}
export function validateAlertStored(
	v: unknown,
	d: SharedControlPanelInboxDelivery,
	truth: SharedControlPanelCurrentTruth,
) {
	exactKeys(v, [
		"kind",
		"alertId",
		"tenantId",
		"occurrenceId",
		"subscriptionId",
		"subscriptionRevision",
		"conditionRevision",
		"panelId",
		"panelRevision",
		"condition",
		"evidenceFingerprint",
		"evidenceRefs",
		"createdAtMs",
	]);
	const a = v as unknown as SharedControlPanelAlert;
	if (
		a.kind !== "shared-control-panel-alert" ||
		a.tenantId !== d.tenantId ||
		a.alertId !== d.alertId ||
		a.panelId !== truth.pins.panelId ||
		a.panelRevision !== truth.pins.panelRevision
	)
		throw new TypeError("invalid-stored-alert");
	if (!Array.isArray(a.evidenceRefs) || a.evidenceRefs.length > 32)
		throw new TypeError("invalid-stored-alert-evidence");
	denseArray(a.evidenceRefs, "storedAlertEvidenceRefs");
	for (const ref of a.evidenceRefs) sourceRef(ref);
}
export function validateSuppression(
	v: SharedControlPanelSuppression,
	o: SharedControlPanelOccurrence,
	s: SharedControlPanelSignal,
	sub: SharedControlPanelSubscriptionRevision,
	now: number,
) {
	exactKeys(v, [
		"kind",
		"suppressionId",
		"tenantId",
		"occurrenceId",
		"subscriptionId",
		"subscriptionRevision",
		"conditionRevision",
		"evidenceFingerprint",
		"reason",
		"policyRevision",
		"createdAtMs",
	]);
	if (
		v.kind !== "shared-control-panel-suppression" ||
		v.tenantId !== o.tenantId ||
		v.occurrenceId !== o.occurrenceId ||
		v.subscriptionId !== o.subscriptionId ||
		v.subscriptionRevision !== o.subscriptionRevision ||
		v.conditionRevision !== sub.conditionRevision ||
		v.evidenceFingerprint !== s.evidenceFingerprint ||
		v.policyRevision !== sub.policyRevision ||
		v.createdAtMs !== now ||
		!["condition-false", "cooldown", "rate-cap", "duplicate"].includes(v.reason)
	)
		throw new TypeError("invalid-suppression");
	identity(v.suppressionId, "suppressionId");
}
export function validateDelivery(v: unknown): SharedControlPanelInboxDelivery {
	exactKeys(v, [
		"kind",
		"deliveryId",
		"tenantId",
		"alertId",
		"recipientId",
		"redactionRevision",
		"state",
		"createdAtMs",
		"deliveredAtMs",
		"terminalAtMs",
	]);
	const x = v as unknown as SharedControlPanelInboxDelivery;
	if (
		x.kind !== "shared-control-panel-inbox-delivery" ||
		!["pending", "attempted", "delivered", "failed", "suppressed", "expired"].includes(x.state)
	)
		throw new TypeError("invalid-delivery");
	for (const [k, y] of Object.entries(x))
		if (k.endsWith("AtMs")) {
			if (y !== null) timestamp(y as number);
		} else if (k !== "kind" && k !== "state") identity(y, k);
	if (
		(x.state === "pending" || x.state === "attempted") &&
		(x.deliveredAtMs !== null || x.terminalAtMs !== null)
	)
		throw new TypeError("invalid-delivery-timestamps");
	if (x.state === "delivered" && (x.deliveredAtMs === null || x.terminalAtMs !== x.deliveredAtMs))
		throw new TypeError("invalid-delivery-timestamps");
	if (
		["failed", "suppressed", "expired"].includes(x.state) &&
		(x.deliveredAtMs !== null || x.terminalAtMs === null)
	)
		throw new TypeError("invalid-delivery-timestamps");
	return snapshot(x);
}
export function validateAudit(v: unknown): SharedControlPanelAuditEntry {
	plain(v);
	const x = v as unknown as SharedControlPanelAuditEntry;
	if (x.kind !== "shared-control-panel-audit" || !Number.isSafeInteger(x.sequence))
		throw new TypeError("invalid-audit");
	return snapshot(x);
}
const capabilities: readonly SharedControlPanelCapability[] = [
	"view",
	"query-rerun",
	"download",
	"input",
	"subscribe",
	"action",
];
export function sourceRef(v: SourceRef) {
	exactKeys(v, ["kind", "id"]);
	identity(v.kind, "sourceRef.kind");
	identity(v.id, "sourceRef.id");
}
export function clockNow(clock: SharedControlPanelHostClock): number {
	const value = clock.now();
	timestamp(value);
	return value;
}
export function validateCanonicalTruth(v: SharedControlPanelCanonicalTruth) {
	exactKeys(v, ["kind", "pins", "recordedAtMs"]);
	if (v.kind !== "shared-control-panel-canonical-truth")
		throw new TypeError("invalid-canonical-truth");
	validatePins(v.pins);
	timestamp(v.recordedAtMs);
	return snapshot(v);
}
export function truthScope(p: SharedControlPanelPins) {
	const {
		runId: _r,
		attempt: _a,
		outcomeId: _o,
		runHighWater: _rh,
		evidenceHighWater: _eh,
		freshnessHighWater: _fh,
		...scope
	} = p;
	return scope;
}
export function validateRecordedAdmission(v: SharedControlPanelRecordedAdmission) {
	exactKeys(v, [
		"kind",
		"tenantId",
		"occurrenceId",
		"admission",
		"bodyFingerprint",
		"recordedAtMs",
	]);
	if (v.kind !== "shared-control-panel-recorded-admission")
		throw new TypeError("invalid-recorded-admission");
	identity(v.occurrenceId, "occurrenceId");
	identity(v.tenantId, "tenantId");
	identity(v.bodyFingerprint, "bodyFingerprint");
	timestamp(v.recordedAtMs);
	validateAdmission(v.admission);
	if (v.bodyFingerprint !== sharedControlPanelAdmissionFingerprint(v.admission))
		throw new TypeError("admission-body-fingerprint-mismatch");
	return snapshot(v);
}
export function validateRecordedTerminalOutcome(v: SharedControlPanelRecordedTerminalOutcome) {
	exactKeys(v, [
		"kind",
		"tenantId",
		"occurrenceId",
		"runId",
		"attempt",
		"outcomeId",
		"terminalHighWater",
		"outcomeEvidenceFingerprint",
		"evidenceRefs",
		"recordedAtMs",
	]);
	if (
		v.kind !== "shared-control-panel-recorded-terminal-outcome" ||
		!Number.isSafeInteger(v.attempt) ||
		v.attempt < 0 ||
		!Number.isSafeInteger(v.terminalHighWater) ||
		v.terminalHighWater < 0
	)
		throw new TypeError("invalid-recorded-terminal-outcome");
	for (const x of [v.tenantId, v.occurrenceId, v.runId, v.outcomeId, v.outcomeEvidenceFingerprint])
		identity(x, "terminal-outcome-coordinate");
	timestamp(v.recordedAtMs);
	if (!Array.isArray(v.evidenceRefs) || v.evidenceRefs.length === 0 || v.evidenceRefs.length > 32)
		throw new TypeError("invalid-terminal-outcome-evidence");
	denseArray(v.evidenceRefs, "terminalOutcomeEvidenceRefs");
	for (const ref of v.evidenceRefs) sourceRef(ref);
	if (!v.evidenceRefs.some((ref) => ref.kind === "executor-outcome" && ref.id === v.outcomeId))
		throw new TypeError("terminal-outcome-ref-missing");
	return snapshot(v);
}
export function validateAdmission(v: ToolProviderRunAdmission) {
	exactKeys(
		v,
		[
			"kind",
			"admissionId",
			"proposalId",
			"runId",
			"adapterInputId",
			"requestId",
			"operationId",
			"state",
			"decisionId",
			"approvedRunId",
			"reason",
			"sourceRefs",
			"metadata",
		],
		["reason", "sourceRefs", "metadata"],
	);
	if (
		v.kind !== "tool-provider-run-admission" ||
		v.state !== "admitted" ||
		!v.approvedRunId ||
		!v.decisionId
	)
		throw new TypeError("invalid-d419-admission");
	for (const x of [
		v.admissionId,
		v.proposalId,
		v.runId,
		v.adapterInputId,
		v.requestId,
		v.operationId,
		v.decisionId,
		v.approvedRunId,
	])
		identity(x, "admission-coordinate");
	if (v.sourceRefs) {
		if (!Array.isArray(v.sourceRefs) || v.sourceRefs.length > 32)
			throw new TypeError("invalid-admission-refs");
		for (const ref of v.sourceRefs) sourceRef(ref);
	}
	if (v.metadata !== undefined) validateAdmissionMetadata(v.metadata);
}
export function validateAdmissionMetadata(v: Record<string, unknown>) {
	exactKeys(v, ["approvalMode", "occurredAtMs"], ["occurredAtMs"]);
	identity(v.approvalMode, "approvalMode");
	if (v.occurredAtMs !== undefined) timestamp(v.occurredAtMs as number);
}
export function validateQueryRerun(v: SharedControlPanelQueryRerunRequest) {
	exactKeys(v, [
		"kind",
		"rerunId",
		"idempotencyKey",
		"truth",
		"candidate",
		"binding",
		"requestedAtMs",
	]);
	if (v.kind !== "shared-control-panel-query-rerun-request")
		throw new TypeError("invalid-query-rerun");
	identity(v.rerunId, "rerunId");
	identity(v.idempotencyKey, "idempotencyKey");
	validateTruth(v.truth);
	if (v.truth.capability !== "query-rerun") throw new TypeError("query-rerun-capability-required");
	validateCandidate(
		v.candidate,
		{
			kind: "shared-control-panel-occurrence",
			tenantId: v.truth.pins.tenantId,
			occurrenceId: v.candidate.occurrenceId,
			subscriptionId: "interactive-rerun",
			subscriptionRevision: "interactive-rerun-v1",
			conditionRevision: "interactive-rerun-v1",
			panelId: v.truth.pins.panelId,
			panelRevision: v.truth.pins.panelRevision,
			dueAtMs: v.requestedAtMs,
			claimedAtMs: v.requestedAtMs,
			admissionFingerprint: "interactive",
			state: "claimed",
			reason: "interactive",
			candidate: null,
			completed: null,
			evaluation: null,
		},
		v.requestedAtMs,
	);
	validateQueryRerunBinding(v.binding, v.truth.pins);
	const request = v.candidate.request;
	if (
		request.runId === v.truth.pins.runId ||
		request.requestId === v.truth.pins.requestId ||
		request.attempt !== 1 ||
		request.retryOfOutcomeId !== undefined ||
		request.reason !== "shared-control-panel-query-rerun" ||
		request.requestedAtMs !== v.requestedAtMs
	)
		throw new TypeError("query-rerun-not-fresh");
	const metadata = request.metadata as Record<string, unknown> | undefined;
	if (
		!metadata ||
		metadata.executionEnvironmentId !== v.truth.pins.environmentId ||
		metadata.executionEnvironmentRevision !== v.truth.pins.environmentRevision
	)
		throw new TypeError("query-rerun-environment-pins-mismatch");
	timestamp(v.requestedAtMs);
}
export function validateQueryRerunBinding(
	v: SharedControlPanelQueryRerunBinding,
	p: SharedControlPanelPins,
) {
	exactKeys(v, [
		"tenantId",
		"workspaceId",
		"workGraphId",
		"panelId",
		"panelRevision",
		"priorRequestId",
		"priorRunId",
		"priorOutcomeId",
		"queryRevision",
		"specRevision",
		"inputRevision",
		"sourceRevision",
		"policyRevision",
	]);
	const expected = {
		tenantId: p.tenantId,
		workspaceId: p.workspaceId,
		workGraphId: p.workGraphId,
		panelId: p.panelId,
		panelRevision: p.panelRevision,
		priorRequestId: p.requestId,
		priorRunId: p.runId,
		priorOutcomeId: p.outcomeId,
		queryRevision: p.queryRevision,
		specRevision: p.specRevision,
		inputRevision: p.inputRevision,
		sourceRevision: p.sourceRevision,
		policyRevision: p.policyRevision,
	};
	if (canonical(v) !== canonical(expected)) throw new TypeError("query-rerun-binding-mismatch");
}
export function plain(v: unknown): asserts v is Record<string, unknown> {
	if (v === null || typeof v !== "object" || Object.getPrototypeOf(v) !== Object.prototype)
		throw new TypeError("non-plain-shared-control-panel-material");
	for (const d of Object.values(Object.getOwnPropertyDescriptors(v)))
		if ("get" in d || "set" in d) throw new TypeError("accessor-shared-control-panel-material");
}
export function exactKeys(
	v: unknown,
	allowed: readonly string[],
	optional: readonly string[] = [],
): asserts v is Record<string, unknown> {
	plain(v);
	const keys = Object.keys(v);
	for (const key of keys)
		if (!allowed.includes(key)) throw new TypeError(`unknown-shared-control-panel-field:${key}`);
	for (const key of allowed)
		if (!optional.includes(key) && !keys.includes(key))
			throw new TypeError(`missing-shared-control-panel-field:${key}`);
}
export function denseArray(v: readonly unknown[], name: string) {
	for (let index = 0; index < v.length; index++)
		if (!Object.hasOwn(v, index)) throw new TypeError(`sparse-${name}`);
}
export function identity(v: unknown, name: string): asserts v is string {
	if (
		typeof v !== "string" ||
		v.length === 0 ||
		v.length > 512 ||
		[...v].some((character) => character.charCodeAt(0) < 32)
	)
		throw new TypeError(`invalid-${name}`);
}
export function optionalIdentity(v: unknown, n: string) {
	if (v !== null) identity(v, n);
}
export function timestamp(v: number) {
	if (!Number.isSafeInteger(v) || v < 0) throw new TypeError("invalid-timestamp");
}
export function canonical(v: unknown): string {
	return JSON.stringify(canonicalValue(v));
}
export function canonicalValue(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(canonicalValue);
	if (v !== null && typeof v === "object") {
		const out: Record<string, unknown> = {};
		for (const k of Object.keys(v).sort())
			out[k] = canonicalValue((v as Record<string, unknown>)[k]);
		return out;
	}
	return v;
}
export function accepted<T>(code: string, value: T): SharedControlPanelStoreResult<T> {
	return snapshot({ accepted: true, code, value });
}
export function rejected<T = never>(code: string): SharedControlPanelStoreResult<T> {
	return snapshot({ accepted: false, code });
}
export function snapshot<T>(v: T): T {
	return deepFreeze(structuredClone(v));
}
export function deepFreeze<T>(v: T): T {
	if (v && typeof v === "object") {
		Object.freeze(v);
		for (const x of Object.values(v)) deepFreeze(x);
	}
	return v;
}
