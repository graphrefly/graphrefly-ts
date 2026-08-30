import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalStrictJsonDigest } from "./canonical.js";
import {
	type RootEvalD145CharterLedger,
	readRootEvalD145CharterLedger,
	writeRootEvalD145CharterLedger,
} from "./root-eval-charter-ledger.js";
import {
	persistRootEvalLiveEvidence,
	type RootEvalLiveEvidence,
} from "./root-eval-live-authority.js";

export const ROOT_EVAL_D145_CHARTER_TRANSACTION_SCHEMA =
	"graphrefly-ts.d145-charter-transaction.v1" as const;
export const ROOT_EVAL_D145_CHARTER_RECONCILIATION_SCHEMA =
	"graphrefly-ts.d145-charter-reconciliation.v1" as const;

export interface RootEvalD145CharterTransaction {
	readonly schemaVersion: typeof ROOT_EVAL_D145_CHARTER_TRANSACTION_SCHEMA;
	readonly privateRoot: string;
	readonly charterLedgerPath: string;
	readonly previousLedgerDigest: string;
	readonly evidence: RootEvalLiveEvidence;
	readonly nextLedger: RootEvalD145CharterLedger;
	readonly transactionDigest: string;
}

export interface RootEvalD145CharterReconciliation {
	readonly schemaVersion: typeof ROOT_EVAL_D145_CHARTER_RECONCILIATION_SCHEMA;
	readonly charterLedgerPath: string;
	readonly previousLedgerDigest: string;
	readonly reconciliationDigest: string;
	readonly nextLedger: RootEvalD145CharterLedger;
	readonly transactionDigest: string;
}

type RootEvalD145CharterJournal =
	| RootEvalD145CharterTransaction
	| RootEvalD145CharterReconciliation;

function transactionMaterial(input: {
	readonly privateRoot: string;
	readonly charterLedgerPath: string;
	readonly previousLedgerDigest: string;
	readonly evidence: RootEvalLiveEvidence;
	readonly nextLedger: RootEvalD145CharterLedger;
}) {
	return Object.freeze({
		schemaVersion: ROOT_EVAL_D145_CHARTER_TRANSACTION_SCHEMA,
		privateRoot: resolve(input.privateRoot),
		charterLedgerPath: resolve(input.charterLedgerPath),
		previousLedgerDigest: input.previousLedgerDigest,
		evidence: input.evidence,
		nextLedger: input.nextLedger,
	});
}

function transaction(input: {
	readonly privateRoot: string;
	readonly charterLedgerPath: string;
	readonly previousLedgerDigest: string;
	readonly evidence: RootEvalLiveEvidence;
	readonly nextLedger: RootEvalD145CharterLedger;
}): RootEvalD145CharterTransaction {
	const material = transactionMaterial(input);
	if (
		!/^sha256:[0-9a-f]{64}$/u.test(material.previousLedgerDigest) ||
		material.nextLedger.entries.at(-1)?.evidenceDigest !== material.evidence.evidenceDigest
	)
		throw new TypeError("root eval D145 charter transaction correlation invalid");
	return Object.freeze({
		...material,
		transactionDigest: empiricalStrictJsonDigest(material),
	});
}

function reconciliationMaterial(input: {
	readonly charterLedgerPath: string;
	readonly previousLedgerDigest: string;
	readonly reconciliationDigest: string;
	readonly nextLedger: RootEvalD145CharterLedger;
}) {
	return Object.freeze({
		schemaVersion: ROOT_EVAL_D145_CHARTER_RECONCILIATION_SCHEMA,
		charterLedgerPath: resolve(input.charterLedgerPath),
		previousLedgerDigest: input.previousLedgerDigest,
		reconciliationDigest: input.reconciliationDigest,
		nextLedger: input.nextLedger,
	});
}

function reconciliation(input: {
	readonly charterLedgerPath: string;
	readonly previousLedgerDigest: string;
	readonly reconciliationDigest: string;
	readonly nextLedger: RootEvalD145CharterLedger;
}): RootEvalD145CharterReconciliation {
	const material = reconciliationMaterial(input);
	if (
		!/^sha256:[0-9a-f]{64}$/u.test(material.previousLedgerDigest) ||
		!/^sha256:[0-9a-f]{64}$/u.test(material.reconciliationDigest) ||
		material.nextLedger.entries.at(-1)?.evidenceDigest !== material.reconciliationDigest
	)
		throw new TypeError("root eval D145 charter reconciliation correlation invalid");
	return Object.freeze({
		...material,
		transactionDigest: empiricalStrictJsonDigest(material),
	});
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function readTransaction(path: string): Promise<RootEvalD145CharterJournal | null> {
	try {
		const value = strictJsonCodec.decode(new Uint8Array(await readFile(resolve(path)))) as
			| RootEvalD145CharterTransaction
			| RootEvalD145CharterReconciliation;
		if (value.schemaVersion === ROOT_EVAL_D145_CHARTER_RECONCILIATION_SCHEMA) {
			if (
				value.transactionDigest !==
				empiricalStrictJsonDigest(
					reconciliationMaterial({
						charterLedgerPath: value.charterLedgerPath,
						previousLedgerDigest: value.previousLedgerDigest,
						reconciliationDigest: value.reconciliationDigest,
						nextLedger: value.nextLedger,
					}),
				)
			)
				throw new TypeError("root eval D145 charter reconciliation journal invalid");
			return reconciliation(value);
		}
		if (
			value.schemaVersion !== ROOT_EVAL_D145_CHARTER_TRANSACTION_SCHEMA ||
			value.transactionDigest !==
				empiricalStrictJsonDigest(
					transactionMaterial({
						privateRoot: value.privateRoot,
						charterLedgerPath: value.charterLedgerPath,
						previousLedgerDigest: value.previousLedgerDigest,
						evidence: value.evidence,
						nextLedger: value.nextLedger,
					}),
				)
		)
			throw new TypeError("root eval D145 charter transaction journal invalid");
		return transaction(value);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

async function writeTransactionExclusive(
	path: string,
	value: RootEvalD145CharterJournal,
): Promise<void> {
	const target = resolve(path);
	const directory = dirname(target);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700);
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
	await syncDirectory(directory);
}

async function withCharterTransactionLock<T>(
	journalPath: string,
	run: () => Promise<T>,
): Promise<T> {
	const target = resolve(journalPath);
	const directory = dirname(target);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700);
	const lockPath = `${target}.lock.sqlite`;
	const database = new DatabaseSync(lockPath);
	try {
		await chmod(lockPath, 0o600);
		database.exec("PRAGMA busy_timeout = 0");
		try {
			database.exec("BEGIN IMMEDIATE");
		} catch {
			throw new TypeError("root eval D145 charter transaction is already active");
		}
		try {
			const result = await run();
			database.exec("COMMIT");
			return result;
		} catch (error) {
			try {
				database.exec("ROLLBACK");
			} catch {
				// The transaction may already have been rolled back by SQLite after an I/O failure.
			}
			throw error;
		}
	} finally {
		database.close();
	}
}

async function finishTransaction(journalPath: string, value: RootEvalD145CharterJournal) {
	const currentLedger = await readRootEvalD145CharterLedger(value.charterLedgerPath);
	if (
		currentLedger.ledgerDigest !== value.previousLedgerDigest &&
		currentLedger.ledgerDigest !== value.nextLedger.ledgerDigest
	)
		throw new TypeError("root eval D145 charter transaction source ledger changed");
	const persistence =
		value.schemaVersion === ROOT_EVAL_D145_CHARTER_TRANSACTION_SCHEMA
			? await persistRootEvalLiveEvidence({
					privateRoot: value.privateRoot,
					evidence: value.evidence,
				})
			: null;
	if (currentLedger.ledgerDigest === value.previousLedgerDigest)
		await writeRootEvalD145CharterLedger(value.charterLedgerPath, value.nextLedger);
	await rm(resolve(journalPath));
	await syncDirectory(dirname(resolve(journalPath)));
	return Object.freeze({ persistence, transactionDigest: value.transactionDigest });
}

export async function recoverRootEvalD145CharterTransaction(journalPath: string) {
	return await withCharterTransactionLock(journalPath, async () => {
		const pending = await readTransaction(journalPath);
		return pending === null ? null : await finishTransaction(journalPath, pending);
	});
}

export async function commitRootEvalD145CharterTransaction(input: {
	readonly journalPath: string;
	readonly privateRoot: string;
	readonly charterLedgerPath: string;
	readonly previousLedgerDigest: string;
	readonly evidence: RootEvalLiveEvidence;
	readonly nextLedger: RootEvalD145CharterLedger;
}) {
	const intended = transaction(input);
	return await withCharterTransactionLock(input.journalPath, async () => {
		try {
			await writeTransactionExclusive(input.journalPath, intended);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const existing = await readTransaction(input.journalPath);
			if (existing?.transactionDigest !== intended.transactionDigest)
				throw new TypeError("root eval D145 charter transaction conflict");
			return await finishTransaction(input.journalPath, existing);
		}
		return await finishTransaction(input.journalPath, intended);
	});
}

export async function commitRootEvalD145CharterReconciliation(input: {
	readonly journalPath: string;
	readonly charterLedgerPath: string;
	readonly previousLedgerDigest: string;
	readonly reconciliationDigest: string;
	readonly nextLedger: RootEvalD145CharterLedger;
}) {
	const intended = reconciliation(input);
	return await withCharterTransactionLock(input.journalPath, async () => {
		try {
			await writeTransactionExclusive(input.journalPath, intended);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const existing = await readTransaction(input.journalPath);
			if (existing?.transactionDigest !== intended.transactionDigest)
				throw new TypeError("root eval D145 charter reconciliation conflict");
			return await finishTransaction(input.journalPath, existing);
		}
		return await finishTransaction(input.journalPath, intended);
	});
}
