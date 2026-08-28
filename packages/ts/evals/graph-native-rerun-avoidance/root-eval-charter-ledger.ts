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
import {
	ROOT_EVAL_CONFIRMATORY_TASK_SET_REF,
	ROOT_EVAL_HELD_OUT_SEAL_DIGEST,
	rootEvalDevelopmentTaskSetRef,
} from "./root-eval-task.js";

export const ROOT_EVAL_D145_CHARTER_LEDGER_SCHEMA = "graphrefly-ts.d145-charter-ledger.v3" as const;
export const ROOT_EVAL_D145_PARTITION_HARD_CAP_MICROUSD = 6_000_000 as const;

export interface RootEvalD145CharterLedgerEntry {
	readonly generationRef: string;
	readonly campaignPurpose: Exclude<EvalCampaignPurpose, "qualification">;
	readonly taskSetRef: string;
	readonly taskManifestDigest: string;
	readonly budgetPartition: Exclude<EvalBudgetPartition, "no-network">;
	readonly providerReportedMicrousd: number;
	readonly unreportedSettledUpperBoundMicrousd: number;
	readonly accountedUpperBoundMicrousd: number;
	readonly generationQualified: boolean | null;
	readonly evidenceDigest: string;
}

export interface RootEvalD145CharterLedger {
	readonly schemaVersion: typeof ROOT_EVAL_D145_CHARTER_LEDGER_SCHEMA;
	readonly decisionRef: "graphrefly-ts:D145";
	readonly heldOutSealDigest: typeof ROOT_EVAL_HELD_OUT_SEAL_DIGEST;
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
	heldOutSealDigest: ROOT_EVAL_HELD_OUT_SEAL_DIGEST,
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
	literal(root.heldOutSealDigest, ROOT_EVAL_HELD_OUT_SEAL_DIGEST, "charter ledger held-out seal");
	const developmentSpentMicrousd = safeInteger(
		root.developmentSpentMicrousd,
		"charter ledger development spend",
		{ max: ROOT_EVAL_D145_PARTITION_HARD_CAP_MICROUSD },
	);
	const confirmatorySpentMicrousd = safeInteger(
		root.confirmatorySpentMicrousd,
		"charter ledger confirmatory spend",
		{ max: ROOT_EVAL_D145_PARTITION_HARD_CAP_MICROUSD },
	);
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
			!(["development-usd-6", "confirmatory-usd-6"] as const).includes(
				entry.budgetPartition as "development-usd-6" | "confirmatory-usd-6",
			) ||
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
		heldOutSealDigest: ROOT_EVAL_HELD_OUT_SEAL_DIGEST,
		developmentSpentMicrousd,
		confirmatorySpentMicrousd,
		developmentQualificationStreak,
		heldOutConsumed: root.heldOutConsumed,
		entries: Object.freeze(entries),
	});
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
				entry.accountedUpperBoundMicrousd !==
				entry.providerReportedMicrousd + entry.unreportedSettledUpperBoundMicrousd,
		) ||
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

export function advanceRootEvalD145CharterLedger(input: {
	readonly ledger: RootEvalD145CharterLedger;
	readonly generationRef: string;
	readonly campaignPurpose: "development" | "confirmatory";
	readonly taskSetRef: string;
	readonly taskManifestDigest: string;
	readonly budgetPartition: "development-usd-6" | "confirmatory-usd-6";
	readonly providerReportedMicrousd: number;
	readonly unreportedSettledUpperBoundMicrousd: number;
	readonly accountedUpperBoundMicrousd: number;
	readonly developmentQualification: EvalDevelopmentQualificationState | null;
	readonly evidenceDigest: string;
}): RootEvalD145CharterLedger {
	const ledger = validateLedger(input.ledger);
	if (ledger.entries.some((entry) => entry.generationRef === input.generationRef))
		throw new TypeError("root eval D145 generation was already recorded");
	if (
		(input.campaignPurpose === "development" && input.budgetPartition !== "development-usd-6") ||
		(input.campaignPurpose === "confirmatory" &&
			(input.budgetPartition !== "confirmatory-usd-6" ||
				ledger.developmentQualificationStreak !== 2 ||
				ledger.heldOutConsumed))
	)
		throw new TypeError("root eval D145 charter transition was not authorized");
	const expectedTaskSetRef =
		input.campaignPurpose === "confirmatory"
			? ROOT_EVAL_CONFIRMATORY_TASK_SET_REF
			: rootEvalDevelopmentTaskSetRef(
					ledger.entries.filter((entry) => entry.campaignPurpose === "development").length + 1,
				);
	if (
		input.taskSetRef !== expectedTaskSetRef ||
		!/^sha256:[0-9a-f]{64}$/u.test(input.taskManifestDigest) ||
		ledger.entries.some(
			(entry) =>
				entry.taskSetRef === input.taskSetRef ||
				entry.taskManifestDigest === input.taskManifestDigest,
		) ||
		(input.campaignPurpose === "confirmatory" &&
			input.taskManifestDigest !== ROOT_EVAL_HELD_OUT_SEAL_DIGEST)
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
		developmentSpentMicrousd > ROOT_EVAL_D145_PARTITION_HARD_CAP_MICROUSD ||
		confirmatorySpentMicrousd > ROOT_EVAL_D145_PARTITION_HARD_CAP_MICROUSD
	)
		throw new TypeError("root eval D145 partition hard cap exceeded");
	const generationQualified =
		input.campaignPurpose === "development"
			? input.developmentQualification?.generationQualified === true
			: null;
	const developmentQualificationStreak =
		input.campaignPurpose === "development"
			? generationQualified
				? Math.min(2, ledger.developmentQualificationStreak + 1)
				: 0
			: ledger.developmentQualificationStreak;
	if (
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
			budgetPartition: input.budgetPartition,
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
		heldOutSealDigest: ROOT_EVAL_HELD_OUT_SEAL_DIGEST,
		developmentSpentMicrousd,
		confirmatorySpentMicrousd,
		developmentQualificationStreak,
		heldOutConsumed: ledger.heldOutConsumed || input.campaignPurpose === "confirmatory",
		entries,
	});
	return Object.freeze({ ...material, ledgerDigest: empiricalStrictJsonDigest(material) });
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
