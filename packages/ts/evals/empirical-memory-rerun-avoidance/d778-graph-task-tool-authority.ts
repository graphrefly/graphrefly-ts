import type { StrictJsonValue } from "../../src/json/codec.js";
import {
	array,
	empiricalStrictJsonDigest,
	exactKeys,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
	string,
} from "./canonical.js";
import type { D720GraphEffectRequestV1 } from "./d767-graph-native-effect-runtime.js";
import { D771_ARM_EXPOSURE_BY_ARM } from "./d771-arm-aware-positive-gate.js";

export const D778_TASK_ENVELOPE_SCHEMA = "graphrefly.b112.d778.graph-task-envelope.v1" as const;
export const D778_TASK_EXPOSURE_FACT_SCHEMA =
	"graphrefly.b112.d778.graph-task-exposure-fact.v1" as const;
export const D778_TOOL_REJECTION_FACT_SCHEMA =
	"graphrefly.b112.d778.sanitized-tool-rejection-fact.v1" as const;

export const D778_TASK_STATEMENT =
	"Managed cloud PostgreSQL must admit only producer-owned canonical run-admission proposal provenance before a worker claim. Inspect the producer contract and canonical identity helpers, then make the smallest consumer change that accepts the valid canonical proposal and rejects malformed or locally reconstructed proposal provenance." as const;
export const D778_ACCEPTANCE_CRITERIA = Object.freeze([
	"The existing hidden target verifier passes for a fresh canonical run-admission proposal.",
	"Malformed or locally reconstructed proposal provenance remains rejected.",
	"Existing authorization, fencing, lease, and claim invariants remain intact.",
	"Only the allowed managed-cloud PostgreSQL implementation file changes.",
]);
export const D778_READABLE_PATHS = Object.freeze([
	"packages/ts/src/executors/managed-cloud-postgresql.ts",
	"packages/ts/src/executors/managed-untrusted-js-compute.ts",
	"packages/ts/src/identity.ts",
	"packages/ts/src/orchestration/agent-runtime-tool-provider-run-admission.ts",
]);
export const D778_WRITABLE_PATHS = Object.freeze([
	"packages/ts/src/executors/managed-cloud-postgresql.ts",
]);

const ARMS = Object.freeze(Object.keys(D771_ARM_EXPOSURE_BY_ARM) as readonly D778Arm[]);
const CAUSES = Object.freeze([
	"malformed-arguments",
	"unexpected-arguments",
	"path-not-allowed",
	"exact-replacement-not-applicable",
	"focused-validation-failed",
] as const);
type D778Arm = keyof typeof D771_ARM_EXPOSURE_BY_ARM;
export type D778ToolRejectionCauseV1 = (typeof CAUSES)[number];

export interface D778GraphTaskEnvelopeV1 {
	readonly schemaVersion: typeof D778_TASK_ENVELOPE_SCHEMA;
	readonly arm: D778Arm;
	readonly runSequence: number;
	readonly logicalRequestDigest: string;
	readonly issuedRequestDigest: string;
	readonly workspaceStateDigest: string;
	readonly taskStatement: typeof D778_TASK_STATEMENT;
	readonly acceptanceCriteria: readonly string[];
	readonly readablePaths: readonly string[];
	readonly writablePaths: readonly string[];
	readonly memoryExposure: (typeof D771_ARM_EXPOSURE_BY_ARM)[D778Arm];
	readonly envelopeDigest: string;
}

export interface D778GraphBindingV1 {
	readonly requestDigest: string;
	readonly admissionDigest: string;
	readonly resultFactDigest: string;
	readonly reconciliationDigest: string;
}

export interface D778TaskExposureFactV1 extends D778GraphBindingV1 {
	readonly schemaVersion: typeof D778_TASK_EXPOSURE_FACT_SCHEMA;
	readonly arm: D778Arm;
	readonly runSequence: number;
	readonly envelopeDigest: string;
	readonly modelVisibleMessagesDigest: string;
	readonly factDigest: string;
}

export interface D778ToolRejectionFactV1 extends D778GraphBindingV1 {
	readonly schemaVersion: typeof D778_TOOL_REJECTION_FACT_SCHEMA;
	readonly runSequence: number;
	readonly toolRef: string;
	readonly causeCode: D778ToolRejectionCauseV1;
	readonly workspaceStateBeforeDigest: string;
	readonly workspaceStateAfterDigest: string;
	readonly factDigest: string;
}

const taskProposals = new WeakMap<object, Omit<D778TaskExposureFactV1, "factDigest">>();
const toolProposals = new WeakMap<object, Omit<D778ToolRejectionFactV1, "factDigest">>();
const wireReceipts = new WeakMap<
	object,
	Readonly<{ envelopeDigest: string; requestDigest: string; modelVisibleMessagesDigest: string }>
>();

function digest(value: unknown, path: string): string {
	const actual = string(value, path, 71);
	if (!/^sha256:[0-9a-f]{64}$/.test(actual)) throw new TypeError(`${path} must be sha256`);
	return actual;
}

function validateBinding(value: unknown, path: string): D778GraphBindingV1 {
	const candidate = record(value, path);
	exactKeys(
		candidate,
		["admissionDigest", "reconciliationDigest", "requestDigest", "resultFactDigest"],
		path,
	);
	return strictSnapshot({
		requestDigest: digest(candidate.requestDigest, `${path}.requestDigest`),
		admissionDigest: digest(candidate.admissionDigest, `${path}.admissionDigest`),
		resultFactDigest: digest(candidate.resultFactDigest, `${path}.resultFactDigest`),
		reconciliationDigest: digest(candidate.reconciliationDigest, `${path}.reconciliationDigest`),
	});
}

export function createD778GraphTaskEnvelope(inputValue: {
	readonly arm: D778Arm;
	readonly effectRequest: D720GraphEffectRequestV1;
}): D778GraphTaskEnvelopeV1 {
	const input = record(inputValue, "d778.taskEnvelope.input");
	exactKeys(input, ["arm", "effectRequest"], "d778.taskEnvelope.input");
	const arm = oneOf(input.arm, ARMS, "d778.taskEnvelope.arm");
	const request = record(input.effectRequest, "d778.taskEnvelope.effectRequest");
	const material = strictSnapshot({
		schemaVersion: D778_TASK_ENVELOPE_SCHEMA,
		arm,
		runSequence: safeInteger(request.runSequence, "d778.taskEnvelope.runSequence", { min: 0 }),
		logicalRequestDigest: digest(
			request.logicalRequestDigest,
			"d778.taskEnvelope.logicalRequestDigest",
		),
		issuedRequestDigest: digest(
			request.issuedRequestDigest,
			"d778.taskEnvelope.issuedRequestDigest",
		),
		workspaceStateDigest: digest(
			request.workspaceStateDigest,
			"d778.taskEnvelope.workspaceStateDigest",
		),
		taskStatement: D778_TASK_STATEMENT,
		acceptanceCriteria: D778_ACCEPTANCE_CRITERIA,
		readablePaths: D778_READABLE_PATHS,
		writablePaths: D778_WRITABLE_PATHS,
		memoryExposure: D771_ARM_EXPOSURE_BY_ARM[arm],
	});
	return strictSnapshot({ ...material, envelopeDigest: empiricalStrictJsonDigest(material) });
}

export function createD778ModelVisibleConversation(envelopeValue: unknown): {
	readonly messages: readonly StrictJsonValue[];
} {
	const envelope = validateD778GraphTaskEnvelope(envelopeValue);
	return strictSnapshot({
		messages: [
			{
				role: "system",
				content:
					"You are the actor in a closed repository repair. Use only the supplied tools. Inspect first, make the smallest exact change, inspect the diff, run focused validation, and only then return a short JSON object. Never invent tool results.",
			},
			{
				role: "user",
				content: JSON.stringify({ graphTaskEnvelope: envelope }),
			},
		],
	});
}

export function validateD778GraphTaskEnvelope(value: unknown): D778GraphTaskEnvelopeV1 {
	const candidate = record(value, "d778.taskEnvelope");
	exactKeys(
		candidate,
		[
			"acceptanceCriteria",
			"arm",
			"envelopeDigest",
			"issuedRequestDigest",
			"memoryExposure",
			"readablePaths",
			"logicalRequestDigest",
			"runSequence",
			"schemaVersion",
			"taskStatement",
			"workspaceStateDigest",
			"writablePaths",
		],
		"d778.taskEnvelope",
	);
	const arm = oneOf(candidate.arm, ARMS, "d778.taskEnvelope.arm");
	const exactArray = (value: unknown, expected: readonly string[], path: string) => {
		const actual = array(value, path).map((entry, index) =>
			string(entry, `${path}[${index}]`, 512),
		);
		if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new TypeError(`${path} drifted`);
		return actual;
	};
	const material = strictSnapshot({
		schemaVersion: oneOf(candidate.schemaVersion, [D778_TASK_ENVELOPE_SCHEMA], "d778.schema"),
		arm,
		runSequence: safeInteger(candidate.runSequence, "d778.runSequence", { min: 0 }),
		logicalRequestDigest: digest(candidate.logicalRequestDigest, "d778.logicalRequestDigest"),
		issuedRequestDigest: digest(candidate.issuedRequestDigest, "d778.issuedRequestDigest"),
		workspaceStateDigest: digest(candidate.workspaceStateDigest, "d778.workspaceStateDigest"),
		taskStatement: oneOf(candidate.taskStatement, [D778_TASK_STATEMENT], "d778.taskStatement"),
		acceptanceCriteria: exactArray(
			candidate.acceptanceCriteria,
			D778_ACCEPTANCE_CRITERIA,
			"d778.acceptanceCriteria",
		),
		readablePaths: exactArray(candidate.readablePaths, D778_READABLE_PATHS, "d778.readablePaths"),
		writablePaths: exactArray(candidate.writablePaths, D778_WRITABLE_PATHS, "d778.writablePaths"),
		memoryExposure: oneOf(
			candidate.memoryExposure,
			[D771_ARM_EXPOSURE_BY_ARM[arm]],
			"d778.memoryExposure",
		),
	});
	if (
		digest(candidate.envelopeDigest, "d778.envelopeDigest") !== empiricalStrictJsonDigest(material)
	)
		throw new TypeError("D778 task envelope digest drifted");
	return strictSnapshot({ ...material, envelopeDigest: candidate.envelopeDigest as string });
}

export function validateD778FinalChatBody(inputValue: {
	readonly body: Uint8Array;
	readonly envelope: D778GraphTaskEnvelopeV1;
	readonly requestDigest: string;
	readonly completionContext?: unknown;
}): object {
	const input = record(inputValue, "d778.chat.input");
	exactKeys(
		input,
		input.completionContext === undefined
			? ["body", "envelope", "requestDigest"]
			: ["body", "completionContext", "envelope", "requestDigest"],
		"d778.chat.input",
	);
	if (!(input.body instanceof Uint8Array) || input.body.byteLength > 1_048_576)
		throw new TypeError("D778 Chat body is outside the bound");
	const envelope = validateD778GraphTaskEnvelope(input.envelope);
	let decoded: unknown;
	try {
		decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.body));
	} catch {
		throw new TypeError("D778 Chat body is not bounded UTF-8 JSON");
	}
	const body = record(decoded, "d778.chat.body");
	const messages = array(body.messages, "d778.chat.messages");
	const prefix = createD778ModelVisibleConversation(envelope).messages;
	if (
		messages.length < prefix.length ||
		empiricalStrictJsonDigest(messages.slice(0, prefix.length)) !==
			empiricalStrictJsonDigest(prefix)
	)
		throw new TypeError("D778 final model-visible messages drifted");
	if (input.completionContext !== undefined) {
		const expectedTail = {
			role: "user",
			content: JSON.stringify({ graphCompletionContext: input.completionContext }),
		};
		if (empiricalStrictJsonDigest(messages.at(-1)) !== empiricalStrictJsonDigest(expectedTail))
			throw new TypeError("D778 final completion context drifted");
	}
	const receipt = Object.freeze({});
	wireReceipts.set(receipt, {
		envelopeDigest: envelope.envelopeDigest,
		requestDigest: digest(input.requestDigest, "d778.chat.requestDigest"),
		modelVisibleMessagesDigest: empiricalStrictJsonDigest(messages),
	});
	return receipt;
}

export function createD778TaskExposureProposal(inputValue: {
	readonly envelope: D778GraphTaskEnvelopeV1;
	readonly wireReceipt: object;
	readonly binding: D778GraphBindingV1;
}): object {
	const input = record(inputValue, "d778.exposureProposal.input");
	exactKeys(input, ["binding", "envelope", "wireReceipt"], "d778.exposureProposal.input");
	const envelope = validateD778GraphTaskEnvelope(input.envelope);
	const binding = validateBinding(input.binding, "d778.exposureProposal.binding");
	const receipt = wireReceipts.get(input.wireReceipt as object);
	if (receipt === undefined) throw new TypeError("D778 task wire receipt is forged or replayed");
	wireReceipts.delete(input.wireReceipt as object);
	if (
		receipt.envelopeDigest !== envelope.envelopeDigest ||
		receipt.requestDigest !== binding.requestDigest
	)
		throw new TypeError("D778 task wire receipt binding drifted");
	const proposal = Object.freeze({});
	taskProposals.set(proposal, {
		schemaVersion: D778_TASK_EXPOSURE_FACT_SCHEMA,
		arm: envelope.arm,
		runSequence: envelope.runSequence,
		envelopeDigest: envelope.envelopeDigest,
		modelVisibleMessagesDigest: receipt.modelVisibleMessagesDigest,
		...binding,
	});
	return proposal;
}

export function admitD778TaskExposureProposal(proposal: object): D778TaskExposureFactV1 {
	const material = taskProposals.get(proposal);
	if (material === undefined)
		throw new TypeError("D778 task exposure proposal is forged or replayed");
	taskProposals.delete(proposal);
	return strictSnapshot({ ...material, factDigest: empiricalStrictJsonDigest(material) });
}

export function createD778ToolRejectionProposal(inputValue: {
	readonly runSequence: number;
	readonly toolRef: string;
	readonly causeCode: D778ToolRejectionCauseV1;
	readonly workspaceStateBeforeDigest: string;
	readonly workspaceStateAfterDigest: string;
	readonly binding: D778GraphBindingV1;
}): object {
	const input = record(inputValue, "d778.toolProposal.input");
	exactKeys(
		input,
		[
			"binding",
			"causeCode",
			"runSequence",
			"toolRef",
			"workspaceStateAfterDigest",
			"workspaceStateBeforeDigest",
		],
		"d778.toolProposal.input",
	);
	const before = digest(input.workspaceStateBeforeDigest, "d778.toolProposal.before");
	const after = digest(input.workspaceStateAfterDigest, "d778.toolProposal.after");
	if (before !== after) throw new TypeError("D778 rejected tool changed workspace state");
	const proposal = Object.freeze({});
	toolProposals.set(proposal, {
		schemaVersion: D778_TOOL_REJECTION_FACT_SCHEMA,
		runSequence: safeInteger(input.runSequence, "d778.toolProposal.runSequence", { min: 0 }),
		toolRef: string(input.toolRef, "d778.toolProposal.toolRef", 64),
		causeCode: oneOf(input.causeCode, CAUSES, "d778.toolProposal.causeCode"),
		workspaceStateBeforeDigest: before,
		workspaceStateAfterDigest: after,
		...validateBinding(input.binding, "d778.toolProposal.binding"),
	});
	return proposal;
}

export function admitD778ToolRejectionProposal(proposal: object): D778ToolRejectionFactV1 {
	const material = toolProposals.get(proposal);
	if (material === undefined)
		throw new TypeError("D778 tool rejection proposal is forged or replayed");
	toolProposals.delete(proposal);
	return strictSnapshot({ ...material, factDigest: empiricalStrictJsonDigest(material) });
}
