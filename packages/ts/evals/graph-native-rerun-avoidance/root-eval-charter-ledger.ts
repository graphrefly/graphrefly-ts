import { constants } from "node:fs";
import { chmod, mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalStrictJsonDigest, exactKeys, literal, record, safeInteger } from "./canonical.js";
import type {
	EvalBudgetPartition,
	EvalCampaignPurpose,
	EvalDevelopmentQualificationState,
} from "./eval-topology.js";

export const ROOT_EVAL_D145_CHARTER_LEDGER_SCHEMA = "graphrefly-ts.d145-charter-ledger.v4" as const;
export const ROOT_EVAL_D145_DEVELOPMENT_HARD_CAP_MICROUSD = 36_000_000 as const;
export const ROOT_EVAL_D145_DEVELOPMENT_GENERATION_HARD_CAP_MICROUSD = 12_000_000 as const;
export const ROOT_EVAL_D145_CONFIRMATORY_HARD_CAP_MICROUSD = 6_000_000 as const;
export const ROOT_EVAL_D145_CONFIRMATORY_GENERATION_HARD_CAP_MICROUSD = 6_000_000 as const;
export const ROOT_EVAL_D145_TOTAL_HARD_CAP_MICROUSD = 42_000_000 as const;
export const ROOT_EVAL_D145_HISTORICAL_CONFIRMATORY_TASK_SET_REF =
	"root-eval-d145-transfer-confirmatory-v1" as const;
export const ROOT_EVAL_D145_HISTORICAL_HELD_OUT_SEAL_DIGEST =
	"sha256:304f65ead9d4d9139e2dcf2d3bb5f3152e0c95c33f1671917b53a54f8de0236e" as const;

export const ROOT_EVAL_D152_DEVELOPMENT_HARD_CAP_MICROUSD = 40_000_000 as const;
export const ROOT_EVAL_D152_DEVELOPMENT_GENERATION_HARD_CAP_MICROUSD = 12_000_000 as const;
export const ROOT_EVAL_D152_CONFIRMATORY_HARD_CAP_MICROUSD = 6_000_000 as const;
export const ROOT_EVAL_D152_CONFIRMATORY_GENERATION_HARD_CAP_MICROUSD = 6_000_000 as const;
export const ROOT_EVAL_D152_TOTAL_HARD_CAP_MICROUSD = 46_000_000 as const;

// Immutable generation 1/2 records retain their original partition identity.
// The separately approved development-3 grant changes no historical receipt.
export function rootEvalD152DevelopmentBudgetPartition(ordinal: number) {
	if (!Number.isSafeInteger(ordinal) || ordinal < 1)
		throw new TypeError("root eval D152 budget partition ordinal invalid");
	return ordinal <= 2 ? ("development-usd-36" as const) : ("development-usd-40" as const);
}

export const ROOT_EVAL_D152_QUALIFICATION_EPOCH_SCHEMA =
	"graphrefly-ts.root-eval-d152-qualification-epoch.v1" as const;

export type RootEvalD152QualificationEpoch = Readonly<{
	readonly schemaVersion: typeof ROOT_EVAL_D152_QUALIFICATION_EPOCH_SCHEMA;
	readonly decisionRef: "graphrefly-ts:D152";
	readonly supersededHistoricalLedgerDigest: string;
	readonly carriedDevelopmentSpentMicrousd: number;
	readonly carriedConfirmatorySpentMicrousd: number;
	readonly developmentQualificationStreak: 0;
	readonly heldOutSealDigest: null;
	readonly heldOutConsumed: false;
	readonly developmentManifestSlots: readonly ["development-1", "development-2"];
	readonly epochDigest: string;
}>;

/**
 * Opens the D152 evidence epoch without reinterpreting a prior ledger or held-out result.
 * The returned DATA is planning authority only; it does not authorize provider work or spend.
 */
export function createRootEvalD152QualificationEpoch(input: {
	readonly supersededHistoricalLedgerDigest: string;
	readonly carriedDevelopmentSpentMicrousd: number;
	readonly carriedConfirmatorySpentMicrousd: number;
}): RootEvalD152QualificationEpoch {
	if (!/^sha256:[0-9a-f]{64}$/u.test(input.supersededHistoricalLedgerDigest))
		throw new TypeError("root eval D152 historical ledger digest invalid");
	const carriedDevelopmentSpentMicrousd = safeInteger(
		input.carriedDevelopmentSpentMicrousd,
		"root eval D152 carried development spend",
		{ max: ROOT_EVAL_D145_DEVELOPMENT_HARD_CAP_MICROUSD },
	);
	const carriedConfirmatorySpentMicrousd = safeInteger(
		input.carriedConfirmatorySpentMicrousd,
		"root eval D152 carried confirmatory spend",
		{ max: ROOT_EVAL_D145_CONFIRMATORY_HARD_CAP_MICROUSD },
	);
	if (
		carriedDevelopmentSpentMicrousd + carriedConfirmatorySpentMicrousd >
		ROOT_EVAL_D145_TOTAL_HARD_CAP_MICROUSD
	)
		throw new TypeError("root eval D152 carried total spend exceeded the charter cap");
	const material = Object.freeze({
		schemaVersion: ROOT_EVAL_D152_QUALIFICATION_EPOCH_SCHEMA,
		decisionRef: "graphrefly-ts:D152" as const,
		supersededHistoricalLedgerDigest: input.supersededHistoricalLedgerDigest,
		carriedDevelopmentSpentMicrousd,
		carriedConfirmatorySpentMicrousd,
		developmentQualificationStreak: 0 as const,
		heldOutSealDigest: null,
		heldOutConsumed: false as const,
		developmentManifestSlots: Object.freeze(["development-1", "development-2"] as const),
	});
	return Object.freeze({ ...material, epochDigest: empiricalStrictJsonDigest(material) });
}

export function rootEvalD145DevelopmentGenerationRef(ordinal: number): string {
	if (!Number.isSafeInteger(ordinal) || ordinal < 1)
		throw new TypeError("root eval D145 development generation ordinal invalid");
	return `root-eval-development-2026-08-27-d145-v${ordinal}`;
}

export function rootEvalD152DevelopmentGenerationRef(ordinal: number): string {
	if (!Number.isSafeInteger(ordinal) || ordinal < 1)
		throw new TypeError("root eval D152 development generation ordinal invalid");
	return `root-eval-development-2026-09-01-d152-v${ordinal}`;
}

function developmentGenerationOrdinal(generationRef: string): number | null {
	const match = /^root-eval-development-2026-08-27-d145-v([1-9][0-9]*)$/u.exec(generationRef);
	if (match === null) return null;
	const ordinal = Number(match[1]);
	return Number.isSafeInteger(ordinal) ? ordinal : null;
}

export function rootEvalD145DevelopmentTaskSetRef(ordinal: number): string {
	if (!Number.isSafeInteger(ordinal) || ordinal < 1)
		throw new TypeError("root eval D145 development task-set ordinal invalid");
	return `root-eval-d145-transfer-development-${ordinal}-v1`;
}

type RootEvalD145LedgerBudgetPartition =
	| "development-usd-6"
	| "development-usd-12"
	| "development-usd-36"
	| "confirmatory-usd-6";

export function latestRootEvalGraphSpend(
	snapshots: readonly Readonly<{
		providerReportedMicrousd: number;
		unreportedSettledUpperBoundMicrousd: number;
		activeReservedMicrousd: number;
	}>[],
): Readonly<{
	providerReportedMicrousd: number;
	unreportedSettledUpperBoundMicrousd: number;
	accountedUpperBoundMicrousd: number;
}> {
	const latest = snapshots.at(-1) ?? {
		providerReportedMicrousd: 0,
		unreportedSettledUpperBoundMicrousd: 0,
		activeReservedMicrousd: 0,
	};
	const providerReportedMicrousd = safeInteger(
		latest.providerReportedMicrousd,
		"root eval latest Graph provider-reported spend",
	);
	const unreportedSettledUpperBoundMicrousd =
		safeInteger(
			latest.unreportedSettledUpperBoundMicrousd,
			"root eval latest Graph unreported settled spend",
		) + safeInteger(latest.activeReservedMicrousd, "root eval latest Graph active reservation");
	return Object.freeze({
		providerReportedMicrousd,
		unreportedSettledUpperBoundMicrousd,
		accountedUpperBoundMicrousd: providerReportedMicrousd + unreportedSettledUpperBoundMicrousd,
	});
}

export interface RootEvalD145CharterLedgerEntry {
	readonly generationRef: string;
	readonly campaignPurpose: Exclude<EvalCampaignPurpose, "qualification">;
	readonly taskSetRef: string;
	readonly taskManifestDigest: string;
	readonly budgetPartition: RootEvalD145LedgerBudgetPartition;
	readonly providerReportedMicrousd: number;
	readonly unreportedSettledUpperBoundMicrousd: number;
	readonly accountedUpperBoundMicrousd: number;
	readonly generationQualified: boolean | null;
	readonly evidenceDigest: string;
}

export interface RootEvalD145CharterLedger {
	readonly schemaVersion: typeof ROOT_EVAL_D145_CHARTER_LEDGER_SCHEMA;
	readonly decisionRef: "graphrefly-ts:D145";
	readonly heldOutSealDigest: typeof ROOT_EVAL_D145_HISTORICAL_HELD_OUT_SEAL_DIGEST;
	readonly supersededLedgerDigest: string | null;
	readonly developmentSpentMicrousd: number;
	readonly confirmatorySpentMicrousd: number;
	readonly developmentQualificationStreak: number;
	readonly heldOutConsumed: boolean;
	readonly entries: readonly RootEvalD145CharterLedgerEntry[];
	readonly ledgerDigest: string;
}

const EMPTY_MATERIAL = Object.freeze({
	schemaVersion: ROOT_EVAL_D145_CHARTER_LEDGER_SCHEMA,
	decisionRef: "graphrefly-ts:D145" as const,
	heldOutSealDigest: ROOT_EVAL_D145_HISTORICAL_HELD_OUT_SEAL_DIGEST,
	supersededLedgerDigest: null,
	developmentSpentMicrousd: 0,
	confirmatorySpentMicrousd: 0,
	developmentQualificationStreak: 0,
	heldOutConsumed: false,
	entries: Object.freeze([]) as readonly RootEvalD145CharterLedgerEntry[],
});

export const ROOT_EVAL_D145_EMPTY_CHARTER_LEDGER: RootEvalD145CharterLedger = Object.freeze({
	...EMPTY_MATERIAL,
	ledgerDigest: empiricalStrictJsonDigest(EMPTY_MATERIAL),
});

function validateLedger(value: unknown): RootEvalD145CharterLedger {
	const root = record(value, "root eval D145 charter ledger");
	exactKeys(
		root,
		[
			"schemaVersion",
			"decisionRef",
			"heldOutSealDigest",
			"supersededLedgerDigest",
			"developmentSpentMicrousd",
			"confirmatorySpentMicrousd",
			"developmentQualificationStreak",
			"heldOutConsumed",
			"entries",
			"ledgerDigest",
		],
		"root eval D145 charter ledger",
	);
	literal(root.schemaVersion, ROOT_EVAL_D145_CHARTER_LEDGER_SCHEMA, "charter ledger schema");
	literal(root.decisionRef, "graphrefly-ts:D145", "charter ledger decision");
	literal(
		root.heldOutSealDigest,
		ROOT_EVAL_D145_HISTORICAL_HELD_OUT_SEAL_DIGEST,
		"charter ledger held-out seal",
	);
	if (
		root.supersededLedgerDigest !== null &&
		!/^sha256:[0-9a-f]{64}$/u.test(String(root.supersededLedgerDigest))
	)
		throw new TypeError("root eval D145 superseded ledger digest invalid");
	const developmentSpentMicrousd = safeInteger(
		root.developmentSpentMicrousd,
		"charter ledger development spend",
		{ max: ROOT_EVAL_D145_DEVELOPMENT_HARD_CAP_MICROUSD },
	);
	const confirmatorySpentMicrousd = safeInteger(
		root.confirmatorySpentMicrousd,
		"charter ledger confirmatory spend",
		{ max: ROOT_EVAL_D145_CONFIRMATORY_HARD_CAP_MICROUSD },
	);
	if (developmentSpentMicrousd + confirmatorySpentMicrousd > ROOT_EVAL_D145_TOTAL_HARD_CAP_MICROUSD)
		throw new TypeError("root eval D145 total hard cap exceeded");
	const developmentQualificationStreak = safeInteger(
		root.developmentQualificationStreak,
		"charter ledger development qualification streak",
		{ max: 2 },
	);
	if (typeof root.heldOutConsumed !== "boolean" || !Array.isArray(root.entries))
		throw new TypeError("root eval D145 charter ledger shape invalid");
	const entries = root.entries.map((raw, index) => {
		const entry = record(raw, `charter ledger entries[${index}]`);
		exactKeys(
			entry,
			[
				"generationRef",
				"campaignPurpose",
				"taskSetRef",
				"taskManifestDigest",
				"budgetPartition",
				"providerReportedMicrousd",
				"unreportedSettledUpperBoundMicrousd",
				"accountedUpperBoundMicrousd",
				"generationQualified",
				"evidenceDigest",
			],
			`charter ledger entries[${index}]`,
		);
		if (
			typeof entry.generationRef !== "string" ||
			typeof entry.taskSetRef !== "string" ||
			!/^sha256:[0-9a-f]{64}$/u.test(String(entry.taskManifestDigest)) ||
			!(["development", "confirmatory"] as const).includes(
				entry.campaignPurpose as "development" | "confirmatory",
			) ||
			!(
				[
					"development-usd-6",
					"development-usd-12",
					"development-usd-36",
					"confirmatory-usd-6",
				] as const
			).includes(entry.budgetPartition as RootEvalD145LedgerBudgetPartition) ||
			!([null, true, false] as const).includes(entry.generationQualified as boolean | null) ||
			!/^sha256:[0-9a-f]{64}$/u.test(String(entry.evidenceDigest))
		)
			throw new TypeError(`charter ledger entries[${index}] invalid`);
		return Object.freeze({
			generationRef: entry.generationRef,
			campaignPurpose: entry.campaignPurpose,
			taskSetRef: entry.taskSetRef,
			taskManifestDigest: entry.taskManifestDigest,
			budgetPartition: entry.budgetPartition,
			providerReportedMicrousd: safeInteger(
				entry.providerReportedMicrousd,
				`charter ledger entries[${index}].providerReportedMicrousd`,
			),
			unreportedSettledUpperBoundMicrousd: safeInteger(
				entry.unreportedSettledUpperBoundMicrousd,
				`charter ledger entries[${index}].unreportedSettledUpperBoundMicrousd`,
			),
			accountedUpperBoundMicrousd: safeInteger(
				entry.accountedUpperBoundMicrousd,
				`charter ledger entries[${index}].accountedUpperBoundMicrousd`,
			),
			generationQualified: entry.generationQualified,
			evidenceDigest: entry.evidenceDigest,
		}) as RootEvalD145CharterLedgerEntry;
	});
	const material = Object.freeze({
		schemaVersion: ROOT_EVAL_D145_CHARTER_LEDGER_SCHEMA,
		decisionRef: "graphrefly-ts:D145" as const,
		heldOutSealDigest: ROOT_EVAL_D145_HISTORICAL_HELD_OUT_SEAL_DIGEST,
		supersededLedgerDigest: root.supersededLedgerDigest,
		developmentSpentMicrousd,
		confirmatorySpentMicrousd,
		developmentQualificationStreak,
		heldOutConsumed: root.heldOutConsumed,
		entries: Object.freeze(entries),
	});
	const developmentOrdinals = entries
		.filter((entry) => entry.campaignPurpose === "development")
		.map((entry) => developmentGenerationOrdinal(entry.generationRef));
	let derivedDevelopmentQualificationStreak = 0;
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index]!;
		if (entry.campaignPurpose !== "development") continue;
		if (entry.generationQualified !== true) break;
		derivedDevelopmentQualificationStreak = Math.min(2, derivedDevelopmentQualificationStreak + 1);
	}
	if (root.ledgerDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("root eval D145 charter ledger digest invalid");
	if (
		entries.reduce(
			(total, entry) =>
				total + (entry.campaignPurpose === "development" ? entry.accountedUpperBoundMicrousd : 0),
			0,
		) !== developmentSpentMicrousd ||
		entries.reduce(
			(total, entry) =>
				total + (entry.campaignPurpose === "confirmatory" ? entry.accountedUpperBoundMicrousd : 0),
			0,
		) !== confirmatorySpentMicrousd ||
		entries.filter((entry) => entry.campaignPurpose === "confirmatory").length !==
			(root.heldOutConsumed ? 1 : 0) ||
		entries.some(
			(entry) =>
				(entry.campaignPurpose === "development" &&
					entry.budgetPartition !== "development-usd-6" &&
					entry.budgetPartition !== "development-usd-12" &&
					entry.budgetPartition !== "development-usd-36") ||
				(entry.campaignPurpose === "confirmatory" &&
					entry.budgetPartition !== "confirmatory-usd-6") ||
				entry.accountedUpperBoundMicrousd !==
					entry.providerReportedMicrousd + entry.unreportedSettledUpperBoundMicrousd,
		) ||
		entries.some((entry) => {
			if (entry.campaignPurpose !== "development") return false;
			const ordinal = developmentGenerationOrdinal(entry.generationRef);
			return (
				ordinal === null ||
				entry.taskSetRef !== rootEvalD145DevelopmentTaskSetRef(ordinal) ||
				typeof entry.generationQualified !== "boolean"
			);
		}) ||
		entries.some(
			(entry) => entry.campaignPurpose === "confirmatory" && entry.generationQualified !== null,
		) ||
		(entries.some((entry) => entry.campaignPurpose === "confirmatory") &&
			entries.at(-1)?.campaignPurpose !== "confirmatory") ||
		developmentOrdinals.some((ordinal, index) => ordinal !== index + 1) ||
		developmentQualificationStreak !== derivedDevelopmentQualificationStreak ||
		new Set(entries.map((entry) => entry.taskSetRef)).size !== entries.length ||
		new Set(entries.map((entry) => entry.taskManifestDigest)).size !== entries.length
	)
		throw new TypeError("root eval D145 charter ledger conservation invalid");
	return Object.freeze({
		...material,
		ledgerDigest: root.ledgerDigest,
	}) as RootEvalD145CharterLedger;
}

export async function readRootEvalD145CharterLedger(
	path: string,
): Promise<RootEvalD145CharterLedger> {
	try {
		return validateLedger(strictJsonCodec.decode(new Uint8Array(await readFile(resolve(path)))));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			return ROOT_EVAL_D145_EMPTY_CHARTER_LEDGER;
		throw error;
	}
}

export function nextRootEvalD145DevelopmentOrdinal(ledger: RootEvalD145CharterLedger): number {
	const validated = validateLedger(ledger);
	const latest = validated.entries
		.filter((entry) => entry.campaignPurpose === "development")
		.map((entry) => developmentGenerationOrdinal(entry.generationRef)!)
		.at(-1);
	return (latest ?? 0) + 1;
}

export function advanceRootEvalD145CharterLedger(input: {
	readonly ledger: RootEvalD145CharterLedger;
	readonly generationRef: string;
	readonly campaignPurpose: "development" | "confirmatory";
	readonly taskSetRef: string;
	readonly taskManifestDigest: string;
	readonly budgetPartition: Exclude<EvalBudgetPartition, "no-network">;
	readonly providerReportedMicrousd: number;
	readonly unreportedSettledUpperBoundMicrousd: number;
	readonly accountedUpperBoundMicrousd: number;
	readonly admissionStatus: "admitted" | "rejected" | "not-candidate";
	readonly developmentQualification: EvalDevelopmentQualificationState | null;
	readonly evidenceDigest: string;
}): RootEvalD145CharterLedger {
	const ledger = validateLedger(input.ledger);
	const budgetPartition = input.budgetPartition;
	if (budgetPartition === "development-usd-40")
		throw new TypeError("root eval D145 charter transition was not authorized");
	if (
		!(
			"admitted" === input.admissionStatus ||
			"rejected" === input.admissionStatus ||
			"not-candidate" === input.admissionStatus
		)
	)
		throw new TypeError("root eval D145 evidence admission status invalid");
	if (ledger.entries.some((entry) => entry.generationRef === input.generationRef))
		throw new TypeError("root eval D145 generation was already recorded");
	if (
		(input.campaignPurpose === "development" &&
			(input.budgetPartition !== "development-usd-36" || ledger.heldOutConsumed)) ||
		(input.campaignPurpose === "confirmatory" &&
			(input.budgetPartition !== "confirmatory-usd-6" ||
				ledger.developmentQualificationStreak !== 2 ||
				ledger.heldOutConsumed))
	)
		throw new TypeError("root eval D145 charter transition was not authorized");
	const nextRecordedDevelopmentOrdinal = nextRootEvalD145DevelopmentOrdinal(ledger);
	const currentDevelopmentOrdinal = developmentGenerationOrdinal(input.generationRef);
	if (
		input.campaignPurpose === "development" &&
		(currentDevelopmentOrdinal === null ||
			currentDevelopmentOrdinal !== nextRecordedDevelopmentOrdinal)
	)
		throw new TypeError("root eval D145 development generation order was invalid");
	const expectedTaskSetRef =
		input.campaignPurpose === "confirmatory"
			? ROOT_EVAL_D145_HISTORICAL_CONFIRMATORY_TASK_SET_REF
			: rootEvalD145DevelopmentTaskSetRef(currentDevelopmentOrdinal!);
	if (
		input.taskSetRef !== expectedTaskSetRef ||
		!/^sha256:[0-9a-f]{64}$/u.test(input.taskManifestDigest) ||
		ledger.entries.some(
			(entry) =>
				entry.taskSetRef === input.taskSetRef ||
				entry.taskManifestDigest === input.taskManifestDigest,
		) ||
		(input.campaignPurpose === "confirmatory" &&
			input.taskManifestDigest !== ROOT_EVAL_D145_HISTORICAL_HELD_OUT_SEAL_DIGEST)
	)
		throw new TypeError("root eval D145 task manifest transition was not authorized");
	const providerReportedMicrousd = safeInteger(
		input.providerReportedMicrousd,
		"root eval D145 generation spend",
	);
	const unreportedSettledUpperBoundMicrousd = safeInteger(
		input.unreportedSettledUpperBoundMicrousd,
		"root eval D145 generation unreported settled upper bound",
	);
	const accountedUpperBoundMicrousd = safeInteger(
		input.accountedUpperBoundMicrousd,
		"root eval D145 generation accounted upper bound",
	);
	if (
		accountedUpperBoundMicrousd !==
		providerReportedMicrousd + unreportedSettledUpperBoundMicrousd
	)
		throw new TypeError("root eval D145 generation spend arithmetic drifted");
	const developmentSpentMicrousd =
		ledger.developmentSpentMicrousd +
		(input.campaignPurpose === "development" ? accountedUpperBoundMicrousd : 0);
	const confirmatorySpentMicrousd =
		ledger.confirmatorySpentMicrousd +
		(input.campaignPurpose === "confirmatory" ? accountedUpperBoundMicrousd : 0);
	if (
		developmentSpentMicrousd > ROOT_EVAL_D145_DEVELOPMENT_HARD_CAP_MICROUSD ||
		confirmatorySpentMicrousd > ROOT_EVAL_D145_CONFIRMATORY_HARD_CAP_MICROUSD ||
		developmentSpentMicrousd + confirmatorySpentMicrousd > ROOT_EVAL_D145_TOTAL_HARD_CAP_MICROUSD
	)
		throw new TypeError("root eval D145 partition hard cap exceeded");
	const generationQualified =
		input.campaignPurpose === "development"
			? input.admissionStatus === "admitted" &&
				input.developmentQualification?.generationQualified === true
			: null;
	const developmentQualificationStreak =
		input.campaignPurpose === "development"
			? generationQualified
				? Math.min(2, ledger.developmentQualificationStreak + 1)
				: 0
			: ledger.developmentQualificationStreak;
	if (
		input.admissionStatus === "admitted" &&
		input.developmentQualification !== null &&
		input.developmentQualification.consecutiveQualifyingGenerations !==
			developmentQualificationStreak
	)
		throw new TypeError("root eval D145 Graph qualification disagreed with charter ledger");
	const entries = Object.freeze([
		...ledger.entries,
		Object.freeze({
			generationRef: input.generationRef,
			campaignPurpose: input.campaignPurpose,
			taskSetRef: input.taskSetRef,
			taskManifestDigest: input.taskManifestDigest,
			budgetPartition,
			providerReportedMicrousd,
			unreportedSettledUpperBoundMicrousd,
			accountedUpperBoundMicrousd,
			generationQualified,
			evidenceDigest: input.evidenceDigest,
		}),
	]);
	const material = Object.freeze({
		schemaVersion: ROOT_EVAL_D145_CHARTER_LEDGER_SCHEMA,
		decisionRef: "graphrefly-ts:D145" as const,
		heldOutSealDigest: ROOT_EVAL_D145_HISTORICAL_HELD_OUT_SEAL_DIGEST,
		supersededLedgerDigest: ledger.supersededLedgerDigest,
		developmentSpentMicrousd,
		confirmatorySpentMicrousd,
		developmentQualificationStreak,
		heldOutConsumed: ledger.heldOutConsumed || input.campaignPurpose === "confirmatory",
		entries,
	});
	return Object.freeze({ ...material, ledgerDigest: empiricalStrictJsonDigest(material) });
}

export function reconcileRootEvalD145ConsumedPreclaimFailure(input: {
	readonly ledger: RootEvalD145CharterLedger;
	readonly generationRef: string;
	readonly taskSetRef: string;
	readonly taskManifestDigest: string;
	readonly receiptDigest: string;
}): RootEvalD145CharterLedger {
	const reconciliationDigest = rootEvalD145ConsumedPreclaimReconciliationDigest(input);
	return advanceRootEvalD145CharterLedger({
		ledger: input.ledger,
		generationRef: input.generationRef,
		campaignPurpose: "development",
		taskSetRef: input.taskSetRef,
		taskManifestDigest: input.taskManifestDigest,
		budgetPartition: "development-usd-36",
		providerReportedMicrousd: 0,
		unreportedSettledUpperBoundMicrousd: 0,
		accountedUpperBoundMicrousd: 0,
		admissionStatus: "rejected",
		developmentQualification: null,
		evidenceDigest: reconciliationDigest,
	});
}

export function rootEvalD145ConsumedPreclaimReconciliationDigest(input: {
	readonly generationRef: string;
	readonly taskSetRef: string;
	readonly taskManifestDigest: string;
	readonly receiptDigest: string;
}): string {
	const ordinal = developmentGenerationOrdinal(input.generationRef);
	if (
		ordinal === null ||
		input.taskSetRef !== rootEvalD145DevelopmentTaskSetRef(ordinal) ||
		!/^sha256:[0-9a-f]{64}$/u.test(input.taskManifestDigest) ||
		!/^sha256:[0-9a-f]{64}$/u.test(input.receiptDigest)
	)
		throw new TypeError("root eval D145 consumed preclaim reconciliation invalid");
	return empiricalStrictJsonDigest({
		kind: "root-eval-d145-consumed-preclaim-reconciliation",
		generationRef: input.generationRef,
		taskSetRef: input.taskSetRef,
		taskManifestDigest: input.taskManifestDigest,
		receiptDigest: input.receiptDigest,
	});
}

export async function writeRootEvalD145CharterLedger(
	path: string,
	ledger: RootEvalD145CharterLedger,
): Promise<void> {
	const target = resolve(path);
	const validated = validateLedger(ledger);
	await mkdir(dirname(target), { recursive: true, mode: 0o700 });
	await chmod(dirname(target), 0o700);
	const stage = `${target}.stage-${process.pid}`;
	const handle = await open(
		stage,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(strictJsonCodec.encode(validated));
		await handle.sync();
	} finally {
		await handle.close();
	}
	await rename(stage, target);
	await chmod(target, 0o600);
	const directory = await open(dirname(target), constants.O_RDONLY | constants.O_DIRECTORY);
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
}
