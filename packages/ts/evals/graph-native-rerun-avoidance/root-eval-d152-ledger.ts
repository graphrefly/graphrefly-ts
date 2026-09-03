import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalStrictJsonDigest, exactKeys, literal, record, safeInteger } from "./canonical.js";
import type { EvalDevelopmentQualificationState } from "./eval-topology.js";
import {
	ROOT_EVAL_D152_CONFIRMATORY_HARD_CAP_MICROUSD,
	ROOT_EVAL_D152_DEVELOPMENT_GENERATION_HARD_CAP_MICROUSD,
	ROOT_EVAL_D152_DEVELOPMENT_HARD_CAP_MICROUSD,
	ROOT_EVAL_D152_TOTAL_HARD_CAP_MICROUSD,
	type RootEvalD145CharterLedger,
	readRootEvalD145CharterLedger,
	rootEvalD152DevelopmentBudgetPartition,
	rootEvalD152DevelopmentGenerationRef,
} from "./root-eval-charter-ledger.js";
import type { RootEvalLiveEvidence } from "./root-eval-live-authority.js";
import { persistRootEvalLiveEvidence } from "./root-eval-live-authority.js";
import { rootEvalDevelopmentTaskSetRef } from "./root-eval-task.js";

export const ROOT_EVAL_D152_LEDGER_SCHEMA = "graphrefly-ts.root-eval-d152-ledger.v1" as const;
export const ROOT_EVAL_D152_TRANSACTION_SCHEMA =
	"graphrefly-ts.root-eval-d152-transaction.v1" as const;
function developmentOrdinal(generationRef: string): number | null {
	const match = /^root-eval-development-2026-09-01-d152-v([1-9][0-9]*)$/u.exec(generationRef);
	if (match === null) return null;
	const ordinal = Number(match[1]);
	return Number.isSafeInteger(ordinal) &&
		rootEvalD152DevelopmentGenerationRef(ordinal) === generationRef
		? ordinal
		: null;
}

export type RootEvalD152LedgerEntry = Readonly<{
	readonly generationRef: string;
	readonly campaignPurpose: "development";
	readonly taskSetRef: string;
	readonly taskManifestDigest: string;
	readonly budgetPartition: ReturnType<typeof rootEvalD152DevelopmentBudgetPartition>;
	readonly providerReportedMicrousd: number;
	readonly unreportedSettledUpperBoundMicrousd: number;
	readonly accountedUpperBoundMicrousd: number;
	readonly generationQualified: boolean;
	readonly evidenceDigest: string;
}>;

export type RootEvalD152Ledger = Readonly<{
	readonly schemaVersion: typeof ROOT_EVAL_D152_LEDGER_SCHEMA;
	readonly decisionRef: "graphrefly-ts:D152";
	readonly supersededHistoricalLedgerDigest: string;
	readonly carriedDevelopmentSpentMicrousd: number;
	readonly carriedConfirmatorySpentMicrousd: number;
	readonly developmentSpentMicrousd: number;
	readonly confirmatorySpentMicrousd: number;
	readonly developmentQualificationStreak: number;
	readonly heldOutSealDigest: null;
	readonly heldOutConsumed: false;
	readonly entries: readonly RootEvalD152LedgerEntry[];
	readonly ledgerDigest: string;
}>;

function material(input: Omit<RootEvalD152Ledger, "ledgerDigest">) {
	return Object.freeze({
		schemaVersion: ROOT_EVAL_D152_LEDGER_SCHEMA,
		decisionRef: "graphrefly-ts:D152" as const,
		supersededHistoricalLedgerDigest: input.supersededHistoricalLedgerDigest,
		carriedDevelopmentSpentMicrousd: input.carriedDevelopmentSpentMicrousd,
		carriedConfirmatorySpentMicrousd: input.carriedConfirmatorySpentMicrousd,
		developmentSpentMicrousd: input.developmentSpentMicrousd,
		confirmatorySpentMicrousd: input.confirmatorySpentMicrousd,
		developmentQualificationStreak: input.developmentQualificationStreak,
		heldOutSealDigest: null,
		heldOutConsumed: false as const,
		entries: Object.freeze([...input.entries]),
	});
}

export function createRootEvalD152Ledger(
	historical: RootEvalD145CharterLedger,
): RootEvalD152Ledger {
	const value = material({
		schemaVersion: ROOT_EVAL_D152_LEDGER_SCHEMA,
		decisionRef: "graphrefly-ts:D152",
		supersededHistoricalLedgerDigest: historical.ledgerDigest,
		carriedDevelopmentSpentMicrousd: historical.developmentSpentMicrousd,
		carriedConfirmatorySpentMicrousd: historical.confirmatorySpentMicrousd,
		developmentSpentMicrousd: historical.developmentSpentMicrousd,
		confirmatorySpentMicrousd: historical.confirmatorySpentMicrousd,
		developmentQualificationStreak: 0,
		heldOutSealDigest: null,
		heldOutConsumed: false,
		entries: [],
	});
	if (
		value.developmentSpentMicrousd > ROOT_EVAL_D152_DEVELOPMENT_HARD_CAP_MICROUSD ||
		value.confirmatorySpentMicrousd > ROOT_EVAL_D152_CONFIRMATORY_HARD_CAP_MICROUSD ||
		value.developmentSpentMicrousd + value.confirmatorySpentMicrousd >
			ROOT_EVAL_D152_TOTAL_HARD_CAP_MICROUSD
	)
		throw new TypeError("root eval D152 carried spend exceeds the approved cumulative cap");
	return Object.freeze({ ...value, ledgerDigest: empiricalStrictJsonDigest(value) });
}

function validate(value: unknown): RootEvalD152Ledger {
	const root = record(value, "root eval D152 ledger");
	exactKeys(
		root,
		[
			"schemaVersion",
			"decisionRef",
			"supersededHistoricalLedgerDigest",
			"carriedDevelopmentSpentMicrousd",
			"carriedConfirmatorySpentMicrousd",
			"developmentSpentMicrousd",
			"confirmatorySpentMicrousd",
			"developmentQualificationStreak",
			"heldOutSealDigest",
			"heldOutConsumed",
			"entries",
			"ledgerDigest",
		],
		"root eval D152 ledger",
	);
	literal(root.schemaVersion, ROOT_EVAL_D152_LEDGER_SCHEMA, "root eval D152 ledger schema");
	literal(root.decisionRef, "graphrefly-ts:D152", "root eval D152 ledger decision");
	if (
		!/^sha256:[0-9a-f]{64}$/u.test(String(root.supersededHistoricalLedgerDigest)) ||
		root.heldOutSealDigest !== null ||
		root.heldOutConsumed !== false ||
		!Array.isArray(root.entries)
	)
		throw new TypeError("root eval D152 ledger authority invalid");
	const carriedDevelopmentSpentMicrousd = safeInteger(
		root.carriedDevelopmentSpentMicrousd,
		"root eval D152 carried development spend",
		{ max: ROOT_EVAL_D152_DEVELOPMENT_HARD_CAP_MICROUSD },
	);
	const carriedConfirmatorySpentMicrousd = safeInteger(
		root.carriedConfirmatorySpentMicrousd,
		"root eval D152 carried confirmatory spend",
		{ max: ROOT_EVAL_D152_CONFIRMATORY_HARD_CAP_MICROUSD },
	);
	const developmentSpentMicrousd = safeInteger(
		root.developmentSpentMicrousd,
		"root eval D152 development spend",
		{ max: ROOT_EVAL_D152_DEVELOPMENT_HARD_CAP_MICROUSD },
	);
	const confirmatorySpentMicrousd = safeInteger(
		root.confirmatorySpentMicrousd,
		"root eval D152 confirmatory spend",
		{ max: ROOT_EVAL_D152_CONFIRMATORY_HARD_CAP_MICROUSD },
	);
	const developmentQualificationStreak = safeInteger(
		root.developmentQualificationStreak,
		"root eval D152 qualification streak",
		{ max: 2 },
	);
	const entries = root.entries.map((raw, index) => {
		const entry = record(raw, `root eval D152 entries[${index}]`);
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
			`root eval D152 entries[${index}]`,
		);
		const ordinal = developmentOrdinal(String(entry.generationRef));
		const providerReportedMicrousd = safeInteger(
			entry.providerReportedMicrousd,
			`root eval D152 entries[${index}].providerReportedMicrousd`,
		);
		const unreportedSettledUpperBoundMicrousd = safeInteger(
			entry.unreportedSettledUpperBoundMicrousd,
			`root eval D152 entries[${index}].unreportedSettledUpperBoundMicrousd`,
		);
		const accountedUpperBoundMicrousd = safeInteger(
			entry.accountedUpperBoundMicrousd,
			`root eval D152 entries[${index}].accountedUpperBoundMicrousd`,
		);
		if (
			ordinal !== index + 1 ||
			entry.campaignPurpose !== "development" ||
			entry.taskSetRef !== rootEvalDevelopmentTaskSetRef(ordinal) ||
			entry.budgetPartition !== rootEvalD152DevelopmentBudgetPartition(ordinal) ||
			typeof entry.generationQualified !== "boolean" ||
			!/^sha256:[0-9a-f]{64}$/u.test(String(entry.taskManifestDigest)) ||
			!/^sha256:[0-9a-f]{64}$/u.test(String(entry.evidenceDigest)) ||
			accountedUpperBoundMicrousd !== providerReportedMicrousd + unreportedSettledUpperBoundMicrousd
		)
			throw new TypeError(`root eval D152 entries[${index}] invalid`);
		return Object.freeze({
			generationRef: entry.generationRef as string,
			campaignPurpose: "development" as const,
			taskSetRef: entry.taskSetRef as string,
			taskManifestDigest: entry.taskManifestDigest as string,
			budgetPartition: rootEvalD152DevelopmentBudgetPartition(ordinal!),
			providerReportedMicrousd,
			unreportedSettledUpperBoundMicrousd,
			accountedUpperBoundMicrousd,
			generationQualified: entry.generationQualified as boolean,
			evidenceDigest: entry.evidenceDigest as string,
		});
	});
	let derivedStreak = 0;
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		if (!entries[index]!.generationQualified) break;
		derivedStreak = Math.min(2, derivedStreak + 1);
	}
	const checked = material({
		schemaVersion: ROOT_EVAL_D152_LEDGER_SCHEMA,
		decisionRef: "graphrefly-ts:D152",
		supersededHistoricalLedgerDigest: root.supersededHistoricalLedgerDigest as string,
		carriedDevelopmentSpentMicrousd,
		carriedConfirmatorySpentMicrousd,
		developmentSpentMicrousd,
		confirmatorySpentMicrousd,
		developmentQualificationStreak,
		heldOutSealDigest: null,
		heldOutConsumed: false,
		entries,
	});
	if (
		root.ledgerDigest !== empiricalStrictJsonDigest(checked) ||
		developmentSpentMicrousd !==
			carriedDevelopmentSpentMicrousd +
				entries.reduce((sum, entry) => sum + entry.accountedUpperBoundMicrousd, 0) ||
		confirmatorySpentMicrousd !== carriedConfirmatorySpentMicrousd ||
		developmentQualificationStreak !== derivedStreak ||
		new Set(entries.map((entry) => entry.taskManifestDigest)).size !== entries.length
	)
		throw new TypeError("root eval D152 ledger conservation invalid");
	return Object.freeze({ ...checked, ledgerDigest: root.ledgerDigest as string });
}

async function writeLedger(path: string, ledger: RootEvalD152Ledger): Promise<void> {
	const target = resolve(path);
	const checked = validate(ledger);
	await mkdir(dirname(target), { recursive: true, mode: 0o700 });
	await chmod(dirname(target), 0o700);
	const stage = `${target}.stage-${process.pid}-${randomUUID()}`;
	const handle = await open(
		stage,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(strictJsonCodec.encode(checked));
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

async function syncDirectory(path: string): Promise<void> {
	const directory = await open(resolve(path), constants.O_RDONLY | constants.O_DIRECTORY);
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
}

export async function readRootEvalD152Ledger(input: {
	readonly path: string;
	readonly historicalLedger: RootEvalD145CharterLedger;
}): Promise<RootEvalD152Ledger> {
	try {
		const ledger = validate(
			strictJsonCodec.decode(new Uint8Array(await readFile(resolve(input.path)))),
		);
		if (ledger.supersededHistoricalLedgerDigest !== input.historicalLedger.ledgerDigest)
			throw new TypeError("root eval D152 historical ledger binding drifted");
		return ledger;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		const ledger = createRootEvalD152Ledger(input.historicalLedger);
		await writeLedger(input.path, ledger);
		return ledger;
	}
}

export function nextRootEvalD152DevelopmentOrdinal(ledger: RootEvalD152Ledger): number {
	return validate(ledger).entries.length + 1;
}

export function advanceRootEvalD152Ledger(input: {
	readonly ledger: RootEvalD152Ledger;
	readonly generationRef: string;
	readonly taskSetRef: string;
	readonly taskManifestDigest: string;
	readonly providerReportedMicrousd: number;
	readonly unreportedSettledUpperBoundMicrousd: number;
	readonly accountedUpperBoundMicrousd: number;
	readonly admissionStatus: "admitted" | "rejected" | "not-candidate";
	readonly developmentQualification: EvalDevelopmentQualificationState | null;
	readonly evidenceDigest: string;
}): RootEvalD152Ledger {
	const ledger = validate(input.ledger);
	const ordinal = developmentOrdinal(input.generationRef);
	if (
		ordinal !== nextRootEvalD152DevelopmentOrdinal(ledger) ||
		input.taskSetRef !== rootEvalDevelopmentTaskSetRef(ordinal ?? 0) ||
		!/^sha256:[0-9a-f]{64}$/u.test(input.taskManifestDigest) ||
		!/^sha256:[0-9a-f]{64}$/u.test(input.evidenceDigest) ||
		ledger.entries.some(
			(entry) =>
				entry.generationRef === input.generationRef ||
				entry.taskSetRef === input.taskSetRef ||
				entry.taskManifestDigest === input.taskManifestDigest,
		)
	)
		throw new TypeError("root eval D152 generation transition invalid");
	const providerReportedMicrousd = safeInteger(
		input.providerReportedMicrousd,
		"root eval D152 provider-reported spend",
	);
	const unreportedSettledUpperBoundMicrousd = safeInteger(
		input.unreportedSettledUpperBoundMicrousd,
		"root eval D152 unreported settled upper bound",
	);
	const accountedUpperBoundMicrousd = safeInteger(
		input.accountedUpperBoundMicrousd,
		"root eval D152 accounted upper bound",
		{ max: ROOT_EVAL_D152_DEVELOPMENT_GENERATION_HARD_CAP_MICROUSD },
	);
	if (
		accountedUpperBoundMicrousd !==
			providerReportedMicrousd + unreportedSettledUpperBoundMicrousd ||
		ledger.developmentSpentMicrousd + accountedUpperBoundMicrousd >
			ROOT_EVAL_D152_DEVELOPMENT_HARD_CAP_MICROUSD
	)
		throw new TypeError("root eval D152 spend boundary exceeded");
	const generationQualified =
		input.admissionStatus === "admitted" &&
		input.developmentQualification?.generationQualified === true;
	const developmentQualificationStreak = generationQualified
		? Math.min(2, ledger.developmentQualificationStreak + 1)
		: 0;
	if (
		input.admissionStatus === "admitted" &&
		input.developmentQualification !== null &&
		input.developmentQualification.consecutiveQualifyingGenerations !==
			developmentQualificationStreak
	)
		throw new TypeError("root eval D152 Graph qualification disagreed with the ledger");
	const entries = Object.freeze([
		...ledger.entries,
		Object.freeze({
			generationRef: input.generationRef,
			campaignPurpose: "development" as const,
			taskSetRef: input.taskSetRef,
			taskManifestDigest: input.taskManifestDigest,
			budgetPartition: rootEvalD152DevelopmentBudgetPartition(
				developmentOrdinal(input.generationRef)!,
			),
			providerReportedMicrousd,
			unreportedSettledUpperBoundMicrousd,
			accountedUpperBoundMicrousd,
			generationQualified,
			evidenceDigest: input.evidenceDigest,
		}),
	]);
	const next = material({
		...ledger,
		developmentSpentMicrousd: ledger.developmentSpentMicrousd + accountedUpperBoundMicrousd,
		developmentQualificationStreak,
		entries,
	});
	return Object.freeze({ ...next, ledgerDigest: empiricalStrictJsonDigest(next) });
}

type RootEvalD152Transaction = Readonly<{
	readonly schemaVersion: typeof ROOT_EVAL_D152_TRANSACTION_SCHEMA;
	readonly privateRoot: string;
	readonly ledgerPath: string;
	readonly previousLedgerDigest: string;
	readonly evidence: RootEvalLiveEvidence;
	readonly nextLedger: RootEvalD152Ledger;
	readonly transactionDigest: string;
}>;

function transaction(input: Omit<RootEvalD152Transaction, "schemaVersion" | "transactionDigest">) {
	const transactionMaterial = Object.freeze({
		schemaVersion: ROOT_EVAL_D152_TRANSACTION_SCHEMA,
		privateRoot: resolve(input.privateRoot),
		ledgerPath: resolve(input.ledgerPath),
		previousLedgerDigest: input.previousLedgerDigest,
		evidence: input.evidence,
		nextLedger: validate(input.nextLedger),
	});
	if (
		!/^sha256:[0-9a-f]{64}$/u.test(transactionMaterial.previousLedgerDigest) ||
		transactionMaterial.nextLedger.entries.at(-1)?.evidenceDigest !==
			transactionMaterial.evidence.evidenceDigest
	)
		throw new TypeError("root eval D152 transaction correlation invalid");
	return Object.freeze({
		...transactionMaterial,
		transactionDigest: empiricalStrictJsonDigest(transactionMaterial),
	});
}

async function readTransaction(path: string): Promise<RootEvalD152Transaction | null> {
	try {
		const raw = record(
			strictJsonCodec.decode(new Uint8Array(await readFile(resolve(path)))),
			"root eval D152 transaction",
		);
		literal(raw.schemaVersion, ROOT_EVAL_D152_TRANSACTION_SCHEMA, "D152 transaction schema");
		const checked = transaction({
			privateRoot: String(raw.privateRoot),
			ledgerPath: String(raw.ledgerPath),
			previousLedgerDigest: String(raw.previousLedgerDigest),
			evidence: raw.evidence as RootEvalLiveEvidence,
			nextLedger: raw.nextLedger as RootEvalD152Ledger,
		});
		if (raw.transactionDigest !== checked.transactionDigest)
			throw new TypeError("root eval D152 transaction digest invalid");
		return checked;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

async function installJournal(path: string, value: RootEvalD152Transaction): Promise<void> {
	const target = resolve(path);
	await mkdir(dirname(target), { recursive: true, mode: 0o700 });
	await chmod(dirname(target), 0o700);
	const stage = `${target}.stage-${process.pid}-${randomUUID()}`;
	const handle = await open(
		stage,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(strictJsonCodec.encode(value));
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		await link(stage, target);
	} finally {
		await rm(stage, { force: true });
	}
	await syncDirectory(dirname(target));
}

async function finishTransaction(value: RootEvalD152Transaction): Promise<{
	readonly persistence: Awaited<ReturnType<typeof persistRootEvalLiveEvidence>>;
	readonly nextLedger: RootEvalD152Ledger;
}> {
	const historicalPath = resolve(dirname(value.ledgerPath), "d145-charter-ledger.v4.json");
	const historicalLedger = await readRootEvalD145CharterLedger(historicalPath);
	if (historicalLedger.ledgerDigest !== value.nextLedger.supersededHistoricalLedgerDigest)
		throw new TypeError("root eval D152 transaction historical authority drifted");
	const current = await readRootEvalD152Ledger({
		path: value.ledgerPath,
		historicalLedger,
	});
	if (
		current.ledgerDigest !== value.previousLedgerDigest &&
		current.ledgerDigest !== value.nextLedger.ledgerDigest
	)
		throw new TypeError("root eval D152 transaction source ledger changed");
	const persistence = await persistRootEvalLiveEvidence({
		privateRoot: value.privateRoot,
		evidence: value.evidence,
	});
	if (current.ledgerDigest === value.previousLedgerDigest)
		await writeLedger(value.ledgerPath, value.nextLedger);
	return Object.freeze({ persistence, nextLedger: value.nextLedger });
}

export async function recoverRootEvalD152Transaction(path: string): Promise<void> {
	const pending = await readTransaction(path);
	if (pending === null) return;
	await finishTransaction(pending);
	await rm(resolve(path));
	await syncDirectory(dirname(resolve(path)));
}

export async function commitRootEvalD152Transaction(input: {
	readonly journalPath: string;
	readonly privateRoot: string;
	readonly ledgerPath: string;
	readonly previousLedgerDigest: string;
	readonly evidence: RootEvalLiveEvidence;
	readonly nextLedger: RootEvalD152Ledger;
}): Promise<{
	readonly persistence: Awaited<ReturnType<typeof persistRootEvalLiveEvidence>>;
	readonly nextLedger: RootEvalD152Ledger;
}> {
	const journal = transaction(input);
	await installJournal(input.journalPath, journal);
	const committed = await finishTransaction(journal);
	await rm(resolve(input.journalPath));
	await syncDirectory(dirname(resolve(input.journalPath)));
	return committed;
}
