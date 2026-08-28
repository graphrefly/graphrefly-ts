import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalStrictJsonDigest, record, safeInteger, sameBytes } from "./canonical.js";
import {
	ROOT_EVAL_D145_CHARTER_LEDGER_SCHEMA,
	type RootEvalD145CharterLedger,
	type RootEvalD145CharterLedgerEntry,
	writeRootEvalD145CharterLedger,
} from "./root-eval-charter-ledger.js";

async function readCanonicalPrivateFile(path: string, maximumBytes: number): Promise<unknown> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600)
			throw new TypeError("D145 ledger rollover input identity invalid");
		if (stat.size < 1 || stat.size > maximumBytes)
			throw new TypeError("D145 ledger rollover input size invalid");
		const bytes = new Uint8Array(await handle.readFile());
		const decoded = strictJsonCodec.decode(bytes);
		if (!sameBytes(strictJsonCodec.encode(decoded), bytes))
			throw new TypeError("D145 ledger rollover input was not canonical");
		return decoded;
	} finally {
		await handle.close();
	}
}

function assertOwnDigest(value: Readonly<Record<string, unknown>>, key: string): void {
	const claimed = value[key];
	if (typeof claimed !== "string") throw new TypeError("D145 ledger rollover digest absent");
	const { [key]: _claimed, ...material } = value;
	if (claimed !== empiricalStrictJsonDigest(material))
		throw new TypeError("D145 ledger rollover digest invalid");
}

async function correctedEntry(
	operatorRoot: string,
	rawEntry: unknown,
): Promise<RootEvalD145CharterLedgerEntry> {
	const entry = record(rawEntry, "D145 ledger rollover entry");
	const generationRef = String(entry.generationRef);
	const evidencePath = join(
		operatorRoot,
		`current-${generationRef}`,
		generationRef,
		"evidence.v23.json",
	);
	const evidence = record(
		await readCanonicalPrivateFile(evidencePath, 16 * 1_048_576),
		"D145 ledger rollover evidence",
	);
	assertOwnDigest(evidence, "evidenceDigest");
	if (evidence.generationRef !== generationRef || evidence.evidenceDigest !== entry.evidenceDigest)
		throw new TypeError("D145 ledger rollover evidence correlation invalid");
	let providerReportedMicrousd = 0;
	let unreportedSettledUpperBoundMicrousd = 0;
	if (evidence.latestGraphObservation !== null) {
		const latest = record(evidence.latestGraphObservation, "D145 ledger rollover observation");
		if (!Array.isArray(latest.msg) || latest.msg[0] !== "DATA")
			throw new TypeError("D145 ledger rollover latest observation invalid");
		const value = record(latest.msg[1], "D145 ledger rollover observation value");
		providerReportedMicrousd = safeInteger(
			value.providerReportedMicrousd,
			"D145 ledger rollover provider-reported spend",
		);
		unreportedSettledUpperBoundMicrousd =
			safeInteger(
				value.unreportedSettledUpperBoundMicrousd,
				"D145 ledger rollover unreported settled spend",
			) + safeInteger(value.activeReservedMicrousd, "D145 ledger rollover active reservation");
	} else if (evidence.providerCalls !== 0) {
		throw new TypeError("D145 ledger rollover spend lacked Graph authority");
	}
	return Object.freeze({
		generationRef,
		campaignPurpose: entry.campaignPurpose as "development" | "confirmatory",
		taskSetRef: String(entry.taskSetRef),
		taskManifestDigest: String(entry.taskManifestDigest),
		budgetPartition: entry.budgetPartition as "development-usd-6" | "confirmatory-usd-6",
		providerReportedMicrousd,
		unreportedSettledUpperBoundMicrousd,
		accountedUpperBoundMicrousd: providerReportedMicrousd + unreportedSettledUpperBoundMicrousd,
		generationQualified: entry.generationQualified as boolean | null,
		evidenceDigest: String(entry.evidenceDigest),
	});
}

async function main(): Promise<void> {
	const oldPathArgument = process.argv[2];
	const newPathArgument = process.argv[3];
	if (
		oldPathArgument === undefined ||
		newPathArgument === undefined ||
		!isAbsolute(oldPathArgument) ||
		!isAbsolute(newPathArgument)
	)
		throw new TypeError("usage: rollover-d145-charter-ledger <v3-ledger> <v4-ledger>");
	const oldPath = resolve(oldPathArgument);
	const newPath = resolve(newPathArgument);
	if (
		basename(oldPath) !== "d145-charter-ledger.v3.json" ||
		basename(newPath) !== "d145-charter-ledger.v4.json" ||
		dirname(oldPath) !== dirname(newPath) ||
		(await realpath(dirname(oldPath))) !== dirname(oldPath)
	)
		throw new TypeError("D145 ledger rollover path identity invalid");
	await lstat(newPath).then(
		() => {
			throw new TypeError("D145 ledger v4 already exists");
		},
		(error: unknown) => {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		},
	);
	const old = record(
		await readCanonicalPrivateFile(oldPath, 1_048_576),
		"D145 superseded charter ledger",
	);
	if (old.schemaVersion !== "graphrefly-ts.d145-charter-ledger.v3")
		throw new TypeError("D145 ledger rollover source schema invalid");
	assertOwnDigest(old, "ledgerDigest");
	if (!Array.isArray(old.entries)) throw new TypeError("D145 ledger rollover entries invalid");
	const entries = Object.freeze(
		await Promise.all(old.entries.map((entry) => correctedEntry(dirname(oldPath), entry))),
	);
	const developmentSpentMicrousd = entries.reduce(
		(total, entry) =>
			total + (entry.campaignPurpose === "development" ? entry.accountedUpperBoundMicrousd : 0),
		0,
	);
	const confirmatorySpentMicrousd = entries.reduce(
		(total, entry) =>
			total + (entry.campaignPurpose === "confirmatory" ? entry.accountedUpperBoundMicrousd : 0),
		0,
	);
	const material = Object.freeze({
		schemaVersion: ROOT_EVAL_D145_CHARTER_LEDGER_SCHEMA,
		decisionRef: "graphrefly-ts:D145" as const,
		heldOutSealDigest: String(
			old.heldOutSealDigest,
		) as RootEvalD145CharterLedger["heldOutSealDigest"],
		supersededLedgerDigest: String(old.ledgerDigest),
		developmentSpentMicrousd,
		confirmatorySpentMicrousd,
		developmentQualificationStreak: safeInteger(
			old.developmentQualificationStreak,
			"D145 ledger rollover qualification streak",
			{ max: 2 },
		),
		heldOutConsumed: old.heldOutConsumed as boolean,
		entries,
	});
	const next = Object.freeze({
		...material,
		ledgerDigest: empiricalStrictJsonDigest(material),
	}) as RootEvalD145CharterLedger;
	await writeRootEvalD145CharterLedger(newPath, next);
	process.stdout.write(
		`${JSON.stringify({
			schemaVersion: next.schemaVersion,
			supersededLedgerDigest: next.supersededLedgerDigest,
			ledgerDigest: next.ledgerDigest,
			entryCount: next.entries.length,
			developmentSpentMicrousd: next.developmentSpentMicrousd,
			reservationReleaseMicrousd:
				safeInteger(old.developmentSpentMicrousd, "D145 superseded development spend") -
				next.developmentSpentMicrousd,
		})}\n`,
	);
}

await main();
