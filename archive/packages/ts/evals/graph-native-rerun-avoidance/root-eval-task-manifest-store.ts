import { randomBytes, randomInt } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, realpath, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalStrictJsonDigest } from "./canonical.js";
import {
	readRootEvalD145CharterLedger,
	rootEvalD152DevelopmentGenerationRef,
} from "./root-eval-charter-ledger.js";
import {
	acquireRootEvalD152Execution,
	nextRootEvalD152DevelopmentOrdinal,
	readRootEvalD152Ledger,
} from "./root-eval-d152-ledger.js";
import {
	bindRootEvalD157HorizonManifests,
	bindRootEvalD159HorizonManifests,
	createRootEvalTaskManifest,
	isRootEvalSupportedDevelopmentSlot,
	ROOT_EVAL_D157_HORIZON_DIRECTORY_NAME,
	ROOT_EVAL_D157_HORIZON_SLOTS,
	ROOT_EVAL_D159_HORIZON_DIRECTORY_NAME,
	ROOT_EVAL_D159_HORIZON_SLOTS,
	ROOT_EVAL_SUPPORTED_DEVELOPMENT_SLOTS,
	ROOT_EVAL_TASK_MANIFEST_SCHEMA,
	type RootEvalTaskManifest,
	type RootEvalTaskManifestSlot,
	readRootEvalTaskManifest,
	rootEvalD159DevelopmentRegistryPairwiseAudit,
	rootEvalDevelopmentOrdinal,
	rootEvalDevelopmentRegistryPairwiseAudit,
	rootEvalDevelopmentTaskSetRef,
	rootEvalMechanismPairwiseAudit,
	rootEvalTaskManifestDirectory,
	rootEvalTaskManifestDisjointAudit,
	rootEvalTaskManifestPath,
	rootEvalVariantOrderSupportsIrrelevantControls,
} from "./root-eval-task.js";

export const ROOT_EVAL_D157_HORIZON_RECEIPT_SCHEMA =
	"graphrefly-ts.root-eval-d157-development-horizon.v3" as const;
export const ROOT_EVAL_D157_HORIZON_RECEIPT_NAME = "receipt.json" as const;
export const ROOT_EVAL_D157_HORIZON_RECEIPT_DIGEST =
	"sha256:2fbf99acecde8f1a4ffe3a494479e5ab7dfc1de2bee5f5947312dda7f6c5025b" as const;
export const ROOT_EVAL_D159_HORIZON_RECEIPT_SCHEMA =
	"graphrefly-ts.root-eval-d159-development-horizon.v1" as const;
export const ROOT_EVAL_D159_HORIZON_RECEIPT_NAME = "receipt.json" as const;
export const ROOT_EVAL_D159_HORIZON_RECEIPT_DIGEST =
	"sha256:e1f699790dcdf11143384e86d67c705f5d6527d855e28df58b01ad765a6e82ac" as const;
const ROOT_EVAL_FROZEN_PRE_D156_MANIFEST_SCHEMA =
	"graphrefly-ts.root-eval-d152-mechanism-manifest.v7" as const;

export interface RootEvalD157HorizonReceipt {
	readonly schemaVersion: typeof ROOT_EVAL_D157_HORIZON_RECEIPT_SCHEMA;
	readonly decisionRef: "graphrefly-ts:D157";
	readonly slots: typeof ROOT_EVAL_D157_HORIZON_SLOTS;
	readonly manifests: readonly Readonly<{
		readonly slot: (typeof ROOT_EVAL_D157_HORIZON_SLOTS)[number];
		readonly taskSetRef: string;
		readonly manifestDigest: string;
	}>[];
	readonly receiptDigest: string;
}

export interface RootEvalD159HorizonReceipt {
	readonly schemaVersion: typeof ROOT_EVAL_D159_HORIZON_RECEIPT_SCHEMA;
	readonly decisionRef: "graphrefly-ts:D159";
	readonly predecessorReceiptDigest: typeof ROOT_EVAL_D157_HORIZON_RECEIPT_DIGEST;
	readonly slots: typeof ROOT_EVAL_D159_HORIZON_SLOTS;
	readonly manifests: readonly Readonly<{
		readonly slot: (typeof ROOT_EVAL_D159_HORIZON_SLOTS)[number];
		readonly taskSetRef: string;
		readonly manifestDigest: string;
	}>[];
	readonly receiptDigest: string;
}

export interface RootEvalFrozenDevelopmentManifestAudit {
	readonly schemaVersion: string;
	readonly slot: (typeof ROOT_EVAL_SUPPORTED_DEVELOPMENT_SLOTS)[number];
	readonly taskSetRef: string;
	readonly manifestDigest: string;
	readonly tasks: readonly Readonly<{
		readonly replicate: number;
		readonly taskSetRef: string;
		readonly mechanismId: string;
		readonly sourceInsightContent: string;
		readonly sourceReadonlyFixtureFiles: readonly Readonly<{ readonly text: string }>[];
		readonly readonlyFixtureFiles: readonly Readonly<{ readonly text: string }>[];
		readonly sourceFixtureCorrectText: string;
		readonly sourceFixtureBuggyText: string;
		readonly sourceFixtureAlternativeText?: string;
		readonly fixtureCorrectText: string;
		readonly fixtureBuggyText: string;
		readonly fixtureAlternativeText?: string;
		readonly sourceHiddenVerifierSource: string;
		readonly hiddenVerifierSource: string;
	}>[];
}

interface RootEvalD157PrecommitState {
	readonly developmentEntryCount: number;
	readonly developmentQualificationStreak: number;
	readonly ledgerPath: string;
	readonly outcomeStatePaths: readonly string[];
	readonly priorManifestBindings: readonly Readonly<{
		readonly taskSetRef: string;
		readonly manifestDigest: string;
	}>[];
}

interface RootEvalD157PreparationAuthority {
	readonly snapshot: () => Promise<RootEvalD157PrecommitState>;
	readonly acquire: (ledgerPath: string) => Promise<() => Promise<void>>;
}

function shuffledVariantOrder(slot: RootEvalTaskManifestSlot): readonly number[] {
	for (let attempt = 0; attempt < 128; attempt += 1) {
		const order = [0, 1, 2, 3, 4];
		for (let index = order.length - 1; index > 0; index -= 1) {
			const swap = randomInt(index + 1);
			[order[index], order[swap]] = [order[swap]!, order[index]!];
		}
		if (rootEvalVariantOrderSupportsIrrelevantControls(order, slot)) return Object.freeze(order);
	}
	throw new TypeError("root eval could not generate incompatible irrelevant controls");
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, constants.O_RDONLY);
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function writeMode0600(path: string, value: unknown): Promise<void> {
	const handle = await open(
		path,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(strictJsonCodec.encode(value));
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function readMode0600NoFollow(path: string, label: string): Promise<Uint8Array> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const file = await handle.stat();
		if (
			!file.isFile() ||
			file.nlink !== 1 ||
			(file.mode & 0o777) !== 0o600 ||
			file.size < 1 ||
			file.size > 4 * 1_048_576
		)
			throw new TypeError(`${label} must be a mode-0600 regular file`);
		return new Uint8Array(await handle.readFile());
	} finally {
		await handle.close();
	}
}

async function assertMode0700DirectoryNoFollow(path: string, label: string): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const directory = await handle.stat();
		if (!directory.isDirectory() || (directory.mode & 0o777) !== 0o700)
			throw new TypeError(`${label} must be a mode-0700 directory`);
	} finally {
		await handle.close();
	}
}

function horizonReceiptMaterial(
	manifests: readonly RootEvalFrozenDevelopmentManifestAudit[],
): Omit<RootEvalD157HorizonReceipt, "receiptDigest"> {
	return Object.freeze({
		schemaVersion: ROOT_EVAL_D157_HORIZON_RECEIPT_SCHEMA,
		decisionRef: "graphrefly-ts:D157" as const,
		slots: ROOT_EVAL_D157_HORIZON_SLOTS,
		manifests: Object.freeze(
			manifests.map((manifest) =>
				Object.freeze({
					slot: manifest.slot as (typeof ROOT_EVAL_D157_HORIZON_SLOTS)[number],
					taskSetRef: manifest.taskSetRef,
					manifestDigest: manifest.manifestDigest,
				}),
			),
		),
	});
}

function d159HorizonReceiptMaterial(
	manifests: readonly RootEvalFrozenDevelopmentManifestAudit[],
): Omit<RootEvalD159HorizonReceipt, "receiptDigest"> {
	return Object.freeze({
		schemaVersion: ROOT_EVAL_D159_HORIZON_RECEIPT_SCHEMA,
		decisionRef: "graphrefly-ts:D159" as const,
		predecessorReceiptDigest: ROOT_EVAL_D157_HORIZON_RECEIPT_DIGEST,
		slots: ROOT_EVAL_D159_HORIZON_SLOTS,
		manifests: Object.freeze(
			manifests.map((manifest) =>
				Object.freeze({
					slot: manifest.slot as (typeof ROOT_EVAL_D159_HORIZON_SLOTS)[number],
					taskSetRef: manifest.taskSetRef,
					manifestDigest: manifest.manifestDigest,
				}),
			),
		),
	});
}

function auditCurrentManifest(
	manifest: RootEvalTaskManifest,
): RootEvalFrozenDevelopmentManifestAudit {
	if (!isRootEvalSupportedDevelopmentSlot(manifest.slot))
		throw new TypeError("root eval D157 current manifest was not a supported development slot");
	return manifest as unknown as RootEvalFrozenDevelopmentManifestAudit;
}

function requiredString(record: Readonly<Record<string, unknown>>, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0)
		throw new TypeError(`root eval frozen manifest task.${key} invalid`);
	return value;
}

export async function readRootEvalFrozenDevelopmentManifestAudit(
	slot: RootEvalTaskManifestSlot,
): Promise<RootEvalFrozenDevelopmentManifestAudit> {
	if (!isRootEvalSupportedDevelopmentSlot(slot))
		throw new TypeError("root eval frozen manifest audit is outside the D157 finite horizon");
	const path = rootEvalTaskManifestPath(slot);
	const raw = await readMode0600NoFollow(path, `root eval ${slot} frozen manifest`);
	const value = strictJsonCodec.decode(raw) as Readonly<Record<string, unknown>>;
	const ordinal = rootEvalDevelopmentOrdinal(slot)!;
	const schemaAllowed =
		value.schemaVersion ===
		(ordinal <= 3 ? ROOT_EVAL_FROZEN_PRE_D156_MANIFEST_SCHEMA : ROOT_EVAL_TASK_MANIFEST_SCHEMA);
	const expectedKeys =
		slot === "development-4" || slot === "development-6"
			? "horizonPeerManifestDigest,manifestDigest,schemaVersion,slot,taskSetRef,tasks"
			: "manifestDigest,schemaVersion,slot,taskSetRef,tasks";
	if (
		value === null ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.keys(value).sort().join(",") !== expectedKeys ||
		!schemaAllowed ||
		value.slot !== slot ||
		value.taskSetRef !== rootEvalDevelopmentTaskSetRef(ordinal) ||
		typeof value.manifestDigest !== "string" ||
		!Array.isArray(value.tasks) ||
		value.tasks.length !== 5 ||
		value.manifestDigest !==
			empiricalStrictJsonDigest({
				schemaVersion: value.schemaVersion,
				slot: value.slot,
				taskSetRef: value.taskSetRef,
				tasks: value.tasks,
				...(value.horizonPeerManifestDigest === undefined
					? {}
					: { horizonPeerManifestDigest: value.horizonPeerManifestDigest }),
			})
	)
		throw new TypeError(`root eval ${slot} frozen manifest binding failed closed`);
	const tasks = value.tasks.map((candidate, index) => {
		if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate))
			throw new TypeError(`root eval ${slot} frozen manifest task shape invalid`);
		const task = candidate as Readonly<Record<string, unknown>>;
		if (
			task.replicate !== index + 1 ||
			task.taskSetRef !== value.taskSetRef ||
			task.kind !== "development-transfer" ||
			!Array.isArray(task.sourceReadonlyFixtureFiles) ||
			task.sourceReadonlyFixtureFiles.length !== 1 ||
			!Array.isArray(task.readonlyFixtureFiles) ||
			task.readonlyFixtureFiles.length !== 1
		)
			throw new TypeError(`root eval ${slot} frozen manifest task binding invalid`);
		const fixture = task.readonlyFixtureFiles[0];
		const sourceFixture = task.sourceReadonlyFixtureFiles[0];
		if (fixture === null || typeof fixture !== "object" || Array.isArray(fixture))
			throw new TypeError(`root eval ${slot} frozen manifest fixture invalid`);
		if (sourceFixture === null || typeof sourceFixture !== "object" || Array.isArray(sourceFixture))
			throw new TypeError(`root eval ${slot} frozen source manifest fixture invalid`);
		const fixtureText = requiredString(fixture as Readonly<Record<string, unknown>>, "text");
		const sourceFixtureText = requiredString(
			sourceFixture as Readonly<Record<string, unknown>>,
			"text",
		);
		const optionalString = (key: string): string | undefined => {
			const item = task[key];
			if (item === undefined) return undefined;
			if (typeof item !== "string" || item.length === 0)
				throw new TypeError(`root eval frozen manifest task.${key} invalid`);
			return item;
		};
		return Object.freeze({
			replicate: index + 1,
			taskSetRef: value.taskSetRef as string,
			mechanismId: requiredString(task, "mechanismId"),
			sourceInsightContent: requiredString(task, "sourceInsightContent"),
			sourceReadonlyFixtureFiles: Object.freeze([Object.freeze({ text: sourceFixtureText })]),
			readonlyFixtureFiles: Object.freeze([Object.freeze({ text: fixtureText })]),
			sourceFixtureCorrectText: requiredString(task, "sourceFixtureCorrectText"),
			sourceFixtureBuggyText: requiredString(task, "sourceFixtureBuggyText"),
			sourceFixtureAlternativeText: optionalString("sourceFixtureAlternativeText"),
			fixtureCorrectText: requiredString(task, "fixtureCorrectText"),
			fixtureBuggyText: requiredString(task, "fixtureBuggyText"),
			fixtureAlternativeText: optionalString("fixtureAlternativeText"),
			sourceHiddenVerifierSource: requiredString(task, "sourceHiddenVerifierSource"),
			hiddenVerifierSource: requiredString(task, "hiddenVerifierSource"),
		});
	});
	return Object.freeze({
		schemaVersion: value.schemaVersion as string,
		slot,
		taskSetRef: value.taskSetRef as string,
		manifestDigest: value.manifestDigest as string,
		tasks: Object.freeze(tasks),
	});
}

function assertCurrentRegistryBanksDisjoint(slots: readonly RootEvalTaskManifestSlot[]): void {
	const manifests = slots.map((slot, index) =>
		createRootEvalTaskManifest({
			slot,
			variantOrder: shuffledVariantOrder(slot),
			coordinateSuffix: `registry-audit-${index + 1}-0000000000000000`,
		}),
	);
	for (let left = 0; left < manifests.length; left += 1) {
		for (let right = left + 1; right < manifests.length; right += 1)
			rootEvalTaskManifestDisjointAudit(manifests[left]!, manifests[right]!);
	}
}

function assertAllDevelopmentBanksDisjoint(
	manifests: readonly RootEvalFrozenDevelopmentManifestAudit[],
	decisionRef: "D157" | "D159",
): void {
	const expectedSlots =
		decisionRef === "D157"
			? ROOT_EVAL_SUPPORTED_DEVELOPMENT_SLOTS.slice(0, 5)
			: ROOT_EVAL_SUPPORTED_DEVELOPMENT_SLOTS;
	assertCurrentRegistryBanksDisjoint(expectedSlots);
	if (
		manifests.length !== expectedSlots.length ||
		manifests.some((manifest, index) => manifest.slot !== expectedSlots[index])
	)
		throw new TypeError(`root eval ${decisionRef} development bank sequence drifted`);
	for (const manifest of manifests.filter(
		(manifest) => manifest.schemaVersion === ROOT_EVAL_TASK_MANIFEST_SCHEMA,
	)) {
		const semanticAudit = rootEvalMechanismPairwiseAudit(manifest.tasks);
		if (
			semanticAudit.length !== 10 ||
			semanticAudit.some((entry) => entry.semanticInterchangeable || entry.actionTokenOverlap > 0.2)
		)
			throw new TypeError(`root eval ${decisionRef} development bank semantic audit failed`);
	}
	const registryTasks = manifests.flatMap((manifest) => manifest.tasks);
	const horizonSemanticAudit =
		decisionRef === "D157"
			? rootEvalDevelopmentRegistryPairwiseAudit(registryTasks)
			: rootEvalD159DevelopmentRegistryPairwiseAudit(registryTasks);
	if (horizonSemanticAudit.length !== (decisionRef === "D157" ? 195 : 295))
		throw new TypeError(`root eval ${decisionRef} frozen horizon semantic audit was incomplete`);
	const intersection = (leftValues: readonly string[], rightValues: readonly string[]) => {
		const rightSet = new Set(rightValues);
		return [...new Set(leftValues.filter((value) => rightSet.has(value)))];
	};
	const fixtureDigests = (manifest: RootEvalFrozenDevelopmentManifestAudit) =>
		manifest.tasks.flatMap((task) =>
			[
				task.sourceReadonlyFixtureFiles[0]?.text,
				task.readonlyFixtureFiles[0]?.text,
				task.sourceFixtureCorrectText,
				task.sourceFixtureBuggyText,
				task.sourceFixtureAlternativeText,
				task.fixtureCorrectText,
				task.fixtureBuggyText,
				task.fixtureAlternativeText,
			]
				.filter((value): value is string => value !== undefined)
				.map((value) => empiricalStrictJsonDigest(value)),
		);
	const verifierDigests = (manifest: RootEvalFrozenDevelopmentManifestAudit) =>
		manifest.tasks.flatMap((task) => [
			empiricalStrictJsonDigest(task.sourceHiddenVerifierSource),
			empiricalStrictJsonDigest(task.hiddenVerifierSource),
		]);
	for (let left = 0; left < manifests.length; left += 1) {
		for (let right = left + 1; right < manifests.length; right += 1) {
			const leftManifest = manifests[left]!;
			const rightManifest = manifests[right]!;
			if (
				leftManifest.slot === rightManifest.slot ||
				leftManifest.taskSetRef === rightManifest.taskSetRef ||
				leftManifest.manifestDigest === rightManifest.manifestDigest ||
				intersection(
					leftManifest.tasks.map((task) => task.mechanismId),
					rightManifest.tasks.map((task) => task.mechanismId),
				).length > 0 ||
				intersection(fixtureDigests(leftManifest), fixtureDigests(rightManifest)).length > 0 ||
				intersection(verifierDigests(leftManifest), verifierDigests(rightManifest)).length > 0
			)
				throw new TypeError(
					`root eval ${decisionRef} frozen development manifests were not disjoint`,
				);
		}
	}
}

export async function readRootEvalD157HorizonReceipt(): Promise<RootEvalD157HorizonReceipt> {
	const directory = resolve(rootEvalTaskManifestDirectory(), ROOT_EVAL_D157_HORIZON_DIRECTORY_NAME);
	const receiptPath = resolve(directory, ROOT_EVAL_D157_HORIZON_RECEIPT_NAME);
	await assertMode0700DirectoryNoFollow(directory, "root eval D157 horizon directory");
	const raw = await readMode0600NoFollow(receiptPath, "root eval D157 horizon receipt");
	const value = strictJsonCodec.decode(raw) as RootEvalD157HorizonReceipt;
	if (
		value === null ||
		typeof value !== "object" ||
		Object.keys(value).sort().join(",") !==
			"decisionRef,manifests,receiptDigest,schemaVersion,slots" ||
		value.schemaVersion !== ROOT_EVAL_D157_HORIZON_RECEIPT_SCHEMA ||
		value.decisionRef !== "graphrefly-ts:D157" ||
		!Array.isArray(value.slots) ||
		value.slots.length !== ROOT_EVAL_D157_HORIZON_SLOTS.length ||
		value.slots.some((slot, index) => slot !== ROOT_EVAL_D157_HORIZON_SLOTS[index]) ||
		!Array.isArray(value.manifests) ||
		value.manifests.length !== ROOT_EVAL_D157_HORIZON_SLOTS.length
	)
		throw new TypeError("root eval D157 horizon receipt shape invalid");
	const manifests = await Promise.all(
		ROOT_EVAL_SUPPORTED_DEVELOPMENT_SLOTS.slice(0, 5).map(
			readRootEvalFrozenDevelopmentManifestAudit,
		),
	);
	assertAllDevelopmentBanksDisjoint(manifests, "D157");
	const horizonManifests = ROOT_EVAL_D157_HORIZON_SLOTS.map((slot) =>
		auditCurrentManifest(readRootEvalTaskManifest(slot)),
	);
	if (
		readRootEvalTaskManifest("development-4").horizonPeerManifestDigest !==
		readRootEvalTaskManifest("development-5").manifestDigest
	)
		throw new TypeError("root eval D157 development-4 ledger binding lost development-5");
	const material = horizonReceiptMaterial(horizonManifests);
	if (
		value.manifests.some(
			(entry, index) =>
				Object.keys(entry).sort().join(",") !== "manifestDigest,slot,taskSetRef" ||
				entry.slot !== material.manifests[index]!.slot ||
				entry.taskSetRef !== material.manifests[index]!.taskSetRef ||
				entry.manifestDigest !== material.manifests[index]!.manifestDigest,
		) ||
		value.receiptDigest !== empiricalStrictJsonDigest(material)
	)
		throw new TypeError("root eval D157 horizon receipt lost manifest binding");
	if (
		process.env.GRAPHREFLY_ROOT_EVAL_TASK_MANIFEST_DIRECTORY === undefined &&
		value.receiptDigest !== ROOT_EVAL_D157_HORIZON_RECEIPT_DIGEST
	)
		throw new TypeError("root eval D157 production horizon receipt drifted");
	return Object.freeze(value);
}

export async function readRootEvalD159HorizonReceipt(): Promise<RootEvalD159HorizonReceipt> {
	await readRootEvalD157HorizonReceipt();
	const directory = resolve(rootEvalTaskManifestDirectory(), ROOT_EVAL_D159_HORIZON_DIRECTORY_NAME);
	const receiptPath = resolve(directory, ROOT_EVAL_D159_HORIZON_RECEIPT_NAME);
	await assertMode0700DirectoryNoFollow(directory, "root eval D159 horizon directory");
	const entries = await readdir(directory, { withFileTypes: true });
	const expectedEntries = [
		...ROOT_EVAL_D159_HORIZON_SLOTS.map((slot) => `${slot}.json`),
		ROOT_EVAL_D159_HORIZON_RECEIPT_NAME,
	].sort();
	if (
		entries.some((entry) => !entry.isFile()) ||
		entries
			.map((entry) => entry.name)
			.sort()
			.some((name, index) => name !== expectedEntries[index]) ||
		entries.length !== expectedEntries.length
	)
		throw new TypeError("root eval D159 horizon directory membership drifted");
	const raw = await readMode0600NoFollow(receiptPath, "root eval D159 horizon receipt");
	const value = strictJsonCodec.decode(raw) as RootEvalD159HorizonReceipt;
	if (
		value === null ||
		typeof value !== "object" ||
		Object.keys(value).sort().join(",") !==
			"decisionRef,manifests,predecessorReceiptDigest,receiptDigest,schemaVersion,slots" ||
		value.schemaVersion !== ROOT_EVAL_D159_HORIZON_RECEIPT_SCHEMA ||
		value.decisionRef !== "graphrefly-ts:D159" ||
		value.predecessorReceiptDigest !== ROOT_EVAL_D157_HORIZON_RECEIPT_DIGEST ||
		!Array.isArray(value.slots) ||
		value.slots.length !== ROOT_EVAL_D159_HORIZON_SLOTS.length ||
		value.slots.some((slot, index) => slot !== ROOT_EVAL_D159_HORIZON_SLOTS[index]) ||
		!Array.isArray(value.manifests) ||
		value.manifests.length !== ROOT_EVAL_D159_HORIZON_SLOTS.length
	)
		throw new TypeError("root eval D159 horizon receipt shape invalid");
	const manifests = await Promise.all(
		ROOT_EVAL_SUPPORTED_DEVELOPMENT_SLOTS.map(readRootEvalFrozenDevelopmentManifestAudit),
	);
	assertAllDevelopmentBanksDisjoint(manifests, "D159");
	const horizonManifests = ROOT_EVAL_D159_HORIZON_SLOTS.map((slot) =>
		auditCurrentManifest(readRootEvalTaskManifest(slot)),
	);
	if (
		readRootEvalTaskManifest("development-6").horizonPeerManifestDigest !==
		readRootEvalTaskManifest("development-7").manifestDigest
	)
		throw new TypeError("root eval D159 development-6 ledger binding lost development-7");
	const material = d159HorizonReceiptMaterial(horizonManifests);
	if (
		value.manifests.some(
			(entry, index) =>
				Object.keys(entry).sort().join(",") !== "manifestDigest,slot,taskSetRef" ||
				entry.slot !== material.manifests[index]!.slot ||
				entry.taskSetRef !== material.manifests[index]!.taskSetRef ||
				entry.manifestDigest !== material.manifests[index]!.manifestDigest,
		) ||
		value.receiptDigest !== empiricalStrictJsonDigest(material)
	)
		throw new TypeError("root eval D159 horizon receipt lost manifest binding");
	if (
		process.env.GRAPHREFLY_ROOT_EVAL_TASK_MANIFEST_DIRECTORY === undefined &&
		value.receiptDigest !== ROOT_EVAL_D159_HORIZON_RECEIPT_DIGEST
	)
		throw new TypeError("root eval D159 production horizon receipt drifted");
	return Object.freeze(value);
}

async function d157PrecommitState(): Promise<RootEvalD157PrecommitState> {
	const operatorRoot = resolve(import.meta.dirname, "../.private/graph-native-rerun-avoidance");
	const historicalLedger = await readRootEvalD145CharterLedger(
		resolve(operatorRoot, "d145-charter-ledger.v4.json"),
	);
	const ledger = await readRootEvalD152Ledger({
		path: resolve(operatorRoot, "d152-charter-ledger.v1.json"),
		historicalLedger,
	});
	if (nextRootEvalD152DevelopmentOrdinal(ledger) !== 4)
		throw new TypeError("root eval D157 horizon precommit ledger order invalid");
	return Object.freeze({
		developmentEntryCount: ledger.entries.length,
		developmentQualificationStreak: ledger.developmentQualificationStreak,
		ledgerPath: resolve(operatorRoot, "d152-charter-ledger.v1.json"),
		outcomeStatePaths: Object.freeze([
			resolve(operatorRoot, "d152-charter-transaction.v1.json"),
			resolve(operatorRoot, `current-${rootEvalD152DevelopmentGenerationRef(4)}`),
		]),
		priorManifestBindings: Object.freeze(
			ledger.entries.map((entry) =>
				Object.freeze({
					taskSetRef: entry.taskSetRef,
					manifestDigest: entry.taskManifestDigest,
				}),
			),
		),
	});
}

export function assertRootEvalD157PrecommitEligibility(input: {
	readonly developmentEntryCount: number;
	readonly developmentQualificationStreak: number;
	readonly outcomeStatePresent: boolean;
	readonly priorManifestBindingsMatch: boolean;
}): void {
	if (
		input.developmentEntryCount !== 3 ||
		input.developmentQualificationStreak !== 0 ||
		input.outcomeStatePresent ||
		!input.priorManifestBindingsMatch
	)
		throw new TypeError("root eval D157 horizon precommit authority invalid");
}

async function assertD157PrecommitWindow(
	state: RootEvalD157PrecommitState,
	prior?: readonly RootEvalFrozenDevelopmentManifestAudit[],
): Promise<void> {
	let outcomeStatePresent = false;
	for (const path of state.outcomeStatePaths) {
		try {
			await lstat(path);
			outcomeStatePresent = true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	assertRootEvalD157PrecommitEligibility({
		developmentEntryCount: state.developmentEntryCount,
		developmentQualificationStreak: state.developmentQualificationStreak,
		outcomeStatePresent,
		priorManifestBindingsMatch:
			state.priorManifestBindings.length === 3 &&
			(prior === undefined ||
				prior.every(
					(manifest, index) =>
						manifest.taskSetRef === state.priorManifestBindings[index]?.taskSetRef &&
						manifest.manifestDigest === state.priorManifestBindings[index]?.manifestDigest,
				)),
	});
}

async function prepareRootEvalD157HorizonWithAuthority(
	authority: RootEvalD157PreparationAuthority,
): Promise<RootEvalD157HorizonReceipt> {
	try {
		return await readRootEvalD157HorizonReceipt();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const initialState = await authority.snapshot();
	const release = await authority.acquire(initialState.ledgerPath);
	try {
		try {
			return await readRootEvalD157HorizonReceipt();
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		await assertD157PrecommitWindow(await authority.snapshot());
		const prior = await Promise.all(
			ROOT_EVAL_SUPPORTED_DEVELOPMENT_SLOTS.slice(0, 3).map(
				readRootEvalFrozenDevelopmentManifestAudit,
			),
		);
		await assertD157PrecommitWindow(await authority.snapshot(), prior);
		const horizonBase = ROOT_EVAL_D157_HORIZON_SLOTS.map((slot) =>
			createRootEvalTaskManifest({
				slot,
				variantOrder: shuffledVariantOrder(slot),
				coordinateSuffix: randomBytes(24).toString("hex"),
			}),
		);
		const horizon = bindRootEvalD157HorizonManifests(horizonBase[0]!, horizonBase[1]!);
		assertAllDevelopmentBanksDisjoint([...prior, ...horizon.map(auditCurrentManifest)], "D157");
		const material = horizonReceiptMaterial(horizon.map(auditCurrentManifest));
		const receipt = Object.freeze({
			...material,
			receiptDigest: empiricalStrictJsonDigest(material),
		});
		const parent = rootEvalTaskManifestDirectory();
		const target = resolve(parent, ROOT_EVAL_D157_HORIZON_DIRECTORY_NAME);
		const stage = resolve(
			parent,
			`.${ROOT_EVAL_D157_HORIZON_DIRECTORY_NAME}.stage-${process.pid}-${randomBytes(12).toString("hex")}`,
		);
		await mkdir(parent, { recursive: true, mode: 0o700 });
		await chmod(parent, 0o700);
		await mkdir(stage, { mode: 0o700 });
		try {
			for (const manifest of horizon)
				await writeMode0600(resolve(stage, `${manifest.slot}.json`), manifest);
			await writeMode0600(resolve(stage, ROOT_EVAL_D157_HORIZON_RECEIPT_NAME), receipt);
			await syncDirectory(stage);
			await assertD157PrecommitWindow(await authority.snapshot(), prior);
			try {
				await rename(stage, target);
			} catch (error) {
				if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? ""))
					throw error;
			}
			await syncDirectory(parent);
		} finally {
			await rm(stage, { recursive: true, force: true });
		}
		return readRootEvalD157HorizonReceipt();
	} finally {
		await release();
	}
}

export async function prepareRootEvalD157Horizon(): Promise<RootEvalD157HorizonReceipt> {
	return prepareRootEvalD157HorizonWithAuthority({
		snapshot: d157PrecommitState,
		acquire: acquireRootEvalD152Execution,
	});
}

/** @internal No-network qualification seam; production runners never import this capability. */
export async function prepareRootEvalD157HorizonForNoNetworkQualification(input: {
	readonly state: RootEvalD157PrecommitState;
}): Promise<RootEvalD157HorizonReceipt> {
	const override = process.env.GRAPHREFLY_ROOT_EVAL_TASK_MANIFEST_DIRECTORY;
	if (process.env.NODE_ENV !== "test" || override === undefined)
		throw new TypeError("root eval D157 no-network preparation capability unavailable");
	const isolatedRoot = await realpath(resolve(override));
	const temporaryRoot = await realpath(tmpdir());
	const canonicalRoot = await realpath(
		resolve(
			import.meta.dirname,
			"../.private/empirical-memory-rerun-avoidance/d152-mechanism-manifests",
		),
	);
	if (
		isolatedRoot === canonicalRoot ||
		isolatedRoot === temporaryRoot ||
		!isolatedRoot.startsWith(`${temporaryRoot}${sep}`)
	)
		throw new TypeError("root eval D157 no-network preparation requires an isolated temp root");
	await assertMode0700DirectoryNoFollow(isolatedRoot, "root eval D157 no-network preparation root");
	return prepareRootEvalD157HorizonWithAuthority({
		snapshot: async () => input.state,
		acquire: acquireRootEvalD152Execution,
	});
}

async function d159PrecommitState(): Promise<RootEvalD157PrecommitState> {
	const operatorRoot = resolve(import.meta.dirname, "../.private/graph-native-rerun-avoidance");
	const historicalLedger = await readRootEvalD145CharterLedger(
		resolve(operatorRoot, "d145-charter-ledger.v4.json"),
	);
	const ledger = await readRootEvalD152Ledger({
		path: resolve(operatorRoot, "d152-charter-ledger.v1.json"),
		historicalLedger,
	});
	if (nextRootEvalD152DevelopmentOrdinal(ledger) !== 6)
		throw new TypeError("root eval D159 horizon precommit ledger order invalid");
	return Object.freeze({
		developmentEntryCount: ledger.entries.length,
		developmentQualificationStreak: ledger.developmentQualificationStreak,
		ledgerPath: resolve(operatorRoot, "d152-charter-ledger.v1.json"),
		outcomeStatePaths: Object.freeze([
			resolve(operatorRoot, "d152-charter-transaction.v1.json"),
			resolve(operatorRoot, `current-${rootEvalD152DevelopmentGenerationRef(6)}`),
		]),
		priorManifestBindings: Object.freeze(
			ledger.entries.map((entry) =>
				Object.freeze({
					taskSetRef: entry.taskSetRef,
					manifestDigest: entry.taskManifestDigest,
				}),
			),
		),
	});
}

export function assertRootEvalD159PrecommitEligibility(input: {
	readonly developmentEntryCount: number;
	readonly developmentQualificationStreak: number;
	readonly outcomeStatePresent: boolean;
	readonly priorManifestBindingsMatch: boolean;
}): void {
	if (
		input.developmentEntryCount !== 5 ||
		input.developmentQualificationStreak !== 0 ||
		input.outcomeStatePresent ||
		!input.priorManifestBindingsMatch
	)
		throw new TypeError("root eval D159 horizon precommit authority invalid");
}

async function assertD159PrecommitWindow(
	state: RootEvalD157PrecommitState,
	prior?: readonly RootEvalFrozenDevelopmentManifestAudit[],
): Promise<void> {
	let outcomeStatePresent = false;
	for (const path of state.outcomeStatePaths) {
		try {
			await lstat(path);
			outcomeStatePresent = true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	assertRootEvalD159PrecommitEligibility({
		developmentEntryCount: state.developmentEntryCount,
		developmentQualificationStreak: state.developmentQualificationStreak,
		outcomeStatePresent,
		priorManifestBindingsMatch:
			state.priorManifestBindings.length === 5 &&
			(prior === undefined ||
				prior.every(
					(manifest, index) =>
						manifest.taskSetRef === state.priorManifestBindings[index]?.taskSetRef &&
						manifest.manifestDigest === state.priorManifestBindings[index]?.manifestDigest,
				)),
	});
}

async function prepareRootEvalD159HorizonWithAuthority(
	authority: RootEvalD157PreparationAuthority,
): Promise<RootEvalD159HorizonReceipt> {
	try {
		await readRootEvalD159HorizonReceipt();
		throw new TypeError("root eval D159 horizon preparation replay rejected");
	} catch (error) {
		if (error instanceof TypeError && /preparation replay rejected/u.test(error.message))
			throw error;
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const initialState = await authority.snapshot();
	const release = await authority.acquire(initialState.ledgerPath);
	try {
		try {
			await readRootEvalD159HorizonReceipt();
			throw new TypeError("root eval D159 horizon preparation replay rejected");
		} catch (error) {
			if (error instanceof TypeError && /preparation replay rejected/u.test(error.message))
				throw error;
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		await readRootEvalD157HorizonReceipt();
		await assertD159PrecommitWindow(await authority.snapshot());
		const prior = await Promise.all(
			ROOT_EVAL_SUPPORTED_DEVELOPMENT_SLOTS.slice(0, 5).map(
				readRootEvalFrozenDevelopmentManifestAudit,
			),
		);
		await assertD159PrecommitWindow(await authority.snapshot(), prior);
		const horizonBase = ROOT_EVAL_D159_HORIZON_SLOTS.map((slot) =>
			createRootEvalTaskManifest({
				slot,
				variantOrder: shuffledVariantOrder(slot),
				coordinateSuffix: randomBytes(24).toString("hex"),
			}),
		);
		const horizon = bindRootEvalD159HorizonManifests(horizonBase[0]!, horizonBase[1]!);
		assertAllDevelopmentBanksDisjoint([...prior, ...horizon.map(auditCurrentManifest)], "D159");
		const material = d159HorizonReceiptMaterial(horizon.map(auditCurrentManifest));
		const receipt = Object.freeze({
			...material,
			receiptDigest: empiricalStrictJsonDigest(material),
		});
		const parent = rootEvalTaskManifestDirectory();
		const target = resolve(parent, ROOT_EVAL_D159_HORIZON_DIRECTORY_NAME);
		const stage = resolve(
			parent,
			`.${ROOT_EVAL_D159_HORIZON_DIRECTORY_NAME}.stage-${process.pid}-${randomBytes(12).toString("hex")}`,
		);
		await mkdir(parent, { recursive: true, mode: 0o700 });
		await chmod(parent, 0o700);
		await mkdir(stage, { mode: 0o700 });
		try {
			for (const manifest of horizon)
				await writeMode0600(resolve(stage, `${manifest.slot}.json`), manifest);
			await writeMode0600(resolve(stage, ROOT_EVAL_D159_HORIZON_RECEIPT_NAME), receipt);
			await syncDirectory(stage);
			await assertD159PrecommitWindow(await authority.snapshot(), prior);
			await rename(stage, target);
			await syncDirectory(parent);
		} finally {
			await rm(stage, { recursive: true, force: true });
		}
		return readRootEvalD159HorizonReceipt();
	} finally {
		await release();
	}
}

export async function prepareRootEvalD159Horizon(): Promise<RootEvalD159HorizonReceipt> {
	return prepareRootEvalD159HorizonWithAuthority({
		snapshot: d159PrecommitState,
		acquire: acquireRootEvalD152Execution,
	});
}

/** @internal No-network D159 precommit seam; production runners never import this capability. */
export async function prepareRootEvalD159HorizonForNoNetworkQualification(input: {
	readonly state: RootEvalD157PrecommitState;
}): Promise<RootEvalD159HorizonReceipt> {
	const override = process.env.GRAPHREFLY_ROOT_EVAL_TASK_MANIFEST_DIRECTORY;
	if (process.env.NODE_ENV !== "test" || override === undefined)
		throw new TypeError("root eval D159 no-network preparation capability unavailable");
	const isolatedRoot = await realpath(resolve(override));
	const temporaryRoot = await realpath(tmpdir());
	const canonicalRoot = await realpath(
		resolve(
			import.meta.dirname,
			"../.private/empirical-memory-rerun-avoidance/d152-mechanism-manifests",
		),
	);
	if (
		isolatedRoot === canonicalRoot ||
		isolatedRoot === temporaryRoot ||
		!isolatedRoot.startsWith(`${temporaryRoot}${sep}`)
	)
		throw new TypeError("root eval D159 no-network preparation requires an isolated temp root");
	await assertMode0700DirectoryNoFollow(isolatedRoot, "root eval D159 no-network preparation root");
	return prepareRootEvalD159HorizonWithAuthority({
		snapshot: async () => input.state,
		acquire: acquireRootEvalD152Execution,
	});
}

export async function ensureRootEvalDevelopmentTaskManifest(
	slot: RootEvalTaskManifestSlot,
): Promise<RootEvalTaskManifest> {
	if (rootEvalDevelopmentOrdinal(slot) === null)
		throw new TypeError("confirmatory task manifest must be pre-sealed, never generated on demand");
	if (!isRootEvalSupportedDevelopmentSlot(slot))
		throw new TypeError("root eval development task manifest is outside the D157 finite horizon");
	if (
		ROOT_EVAL_D157_HORIZON_SLOTS.includes(slot as (typeof ROOT_EVAL_D157_HORIZON_SLOTS)[number])
	) {
		await readRootEvalD157HorizonReceipt();
		return readRootEvalTaskManifest(slot);
	}
	if (
		ROOT_EVAL_D159_HORIZON_SLOTS.includes(slot as (typeof ROOT_EVAL_D159_HORIZON_SLOTS)[number])
	) {
		await readRootEvalD159HorizonReceipt();
		return readRootEvalTaskManifest(slot);
	}
	throw new TypeError("root eval development-1..3 manifests are immutable audit-only evidence");
}
