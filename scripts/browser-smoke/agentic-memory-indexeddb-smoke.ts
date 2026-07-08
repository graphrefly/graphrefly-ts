/// <reference lib="dom" />

import { indexedDbAgenticMemoryCommittedFactLogBackend } from "../../packages/ts/src/solutions/agentic-memory/browser.js";
import {
	type AgenticMemoryCommittedFactCursor,
	agenticMemoryCommittedFactBatch,
	agenticMemoryCommittedRecordMaterialFact,
	agenticMemoryFactCommitStatusIsDurable,
	agenticMemoryFactCommitStatusIsTerminalFailure,
} from "../../packages/ts/src/solutions/agentic-memory/committed-fact-log.js";
import {
	AGENTIC_MEMORY_COMMITTED_FACT_LOG_BACKEND_CURSOR_KIND,
	type AgenticMemoryCommittedFactLogBackendStatus,
} from "../../packages/ts/src/solutions/agentic-memory/committed-fact-log-backend.js";
import type {
	AgenticMemoryRecord,
	StrictJsonValue,
} from "../../packages/ts/src/solutions/agentic-memory/types.js";

const RESULT_START = "__GRAPHREFLY_AGENTIC_MEMORY_IDB_SMOKE__";
const RESULT_END = "__GRAPHREFLY_AGENTIC_MEMORY_IDB_SMOKE_END__";
const forbiddenBoundaryText =
	/applicationAck|liveGraphTruth|recordMutation|hotHydration|hydration|restore|liveRefresh|commitBarrier|sameEvaluationFeedback/i;

type SmokeOk = {
	readonly ok: true;
	readonly cases: readonly string[];
	readonly diagnostics: {
		readonly appendCursor: AgenticMemoryCommittedFactCursor;
		readonly backendCursorKind: string | undefined;
		readonly statusCapabilities: readonly string[];
	};
};

type SmokeFailure = {
	readonly ok: false;
	readonly error: string;
	readonly stack?: string;
};

type SmokeResult = SmokeOk | SmokeFailure;

const dbNames = new Set<string>();
let dbCounter = 0;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
	const actualJson = JSON.stringify(actual);
	const expectedJson = JSON.stringify(expected);
	if (actualJson !== expectedJson) {
		throw new Error(`${message}\nactual: ${actualJson}\nexpected: ${expectedJson}`);
	}
}

function record<T extends StrictJsonValue = string>(
	id: string,
	fragmentId: string,
	payload: T = "payload" as T,
): AgenticMemoryRecord<T> {
	return {
		id,
		kind: "semantic",
		persistenceLevel: "project",
		artifactKind: "insight",
		scope: { sessionId: "session-1", projectId: "project-1" },
		fragment: {
			id: fragmentId,
			payload,
			tNs: 10n,
			confidence: 0.8,
			tags: ["browser-smoke", "d594"],
			sources: [],
		},
	};
}

function nextSpec(label: string) {
	dbCounter += 1;
	const dbName = `graphrefly-d594-real-idb-${Date.now()}-${dbCounter}-${label}`;
	dbNames.add(dbName);
	return { dbName, storeName: "fact-log" };
}

function factCursorText(value: unknown): string {
	return JSON.stringify(value);
}

function stringifyBoundary(value: unknown): string {
	return JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));
}

function statusCapabilities(
	status: AgenticMemoryCommittedFactLogBackendStatus | undefined,
): readonly string[] {
	return (
		status?.capabilities.map((capability) => `${capability.name}:${capability.supported}`) ?? []
	);
}

async function deleteDatabaseBestEffort(dbName: string): Promise<void> {
	await new Promise<void>((resolve) => {
		const req = indexedDB.deleteDatabase(dbName);
		req.onsuccess = () => resolve();
		req.onerror = () => resolve();
		req.onblocked = () => resolve();
	});
}

async function createDatabaseWithStore(dbName: string, storeName: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const req = indexedDB.open(dbName, 1);
		req.onupgradeneeded = () => {
			if (!req.result.objectStoreNames.contains(storeName)) {
				req.result.createObjectStore(storeName);
			}
		};
		req.onsuccess = () => {
			req.result.close();
			resolve();
		};
		req.onerror = () => reject(req.error ?? new Error("IndexedDB setup open failed"));
		req.onblocked = () => reject(new Error("IndexedDB setup open blocked"));
	});
}

async function runAppendReadDiagnosticsSmoke(): Promise<SmokeOk["diagnostics"]> {
	const spec = nextSpec("append-read");
	await deleteDatabaseBestEffort(spec.dbName);
	const first = agenticMemoryCommittedRecordMaterialFact(
		record("record-d594-real-idb-a", "fragment-d594-real-idb-a"),
		{ operation: "create", correlationId: "d594-real-idb-a" },
	);
	const second = agenticMemoryCommittedRecordMaterialFact(
		record("record-d594-real-idb-b", "fragment-d594-real-idb-b"),
		{ operation: "create", correlationId: "d594-real-idb-b" },
	);
	const backend = indexedDbAgenticMemoryCommittedFactLogBackend<string>(spec, {
		backendName: "real-browser-indexeddb-smoke",
	});
	const status = typeof backend.status === "function" ? await backend.status() : backend.status;
	const append = await backend.append(agenticMemoryCommittedFactBatch([first, second]));
	const reopened = indexedDbAgenticMemoryCommittedFactLogBackend<string>(spec, {
		backendName: "real-browser-indexeddb-smoke",
	});
	const readAll = await reopened.read();
	const readAfterFirst = await reopened.read({
		after: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
	});

	assert(append.status === "committed", "real IndexedDB append should report committed");
	assert(append.facts === 2, "committed append should count the whole fact batch");
	assertDeepEqual(
		append.cursor,
		{ kind: "agentic-memory-fact-stream.cursor", position: 2 },
		"append cursor must be a fact-stream position",
	);
	assertDeepEqual(
		readAll.facts,
		[first, second],
		"reopened backend should read facts in stream order",
	);
	assertDeepEqual(
		readAll.cursor,
		{ kind: "agentic-memory-fact-stream.cursor", position: 2 },
		"read cursor must be a fact-stream position",
	);
	assertDeepEqual(readAfterFirst.facts, [second], "read after fact cursor should skip prior facts");
	assertDeepEqual(
		readAfterFirst.cursor,
		{ kind: "agentic-memory-fact-stream.cursor", position: 2 },
		"read-after cursor should advance only by visible facts",
	);
	assert(
		append.backendCursor?.kind === AGENTIC_MEMORY_COMMITTED_FACT_LOG_BACKEND_CURSOR_KIND,
		"IndexedDB storage cursor must stay a backend diagnostic cursor",
	);
	assert(
		typeof append.backendCursor.value === "object" &&
			append.backendCursor.value !== null &&
			Object.hasOwn(append.backendCursor.value, "indexedDbKey") &&
			Object.hasOwn(append.backendCursor.value, "appendLogSeq"),
		"backend cursor should report IndexedDB storage diagnostics only",
	);
	assert(
		!/indexedDb|appendLog|storage|backend|row|key/i.test(factCursorText(append.cursor)),
		"fact cursor must not contain IndexedDB keys or storage cursor material",
	);
	assert(
		status?.capabilities.some(
			(capability) => capability.name === "single-writer" && capability.supported === true,
		),
		"backend status should report the single-writer reference-backend mode",
	);
	assert(
		status?.capabilities.some(
			(capability) =>
				capability.name === "multi-writer-correctness" && capability.supported === false,
		),
		"backend status must not claim multi-writer correctness",
	);
	assert(
		status?.capabilities.some(
			(capability) => capability.name === "fsync-guarantee" && capability.supported === false,
		),
		"backend status must not claim fsync or permanent durability",
	);
	assert(
		!forbiddenBoundaryText.test(stringifyBoundary({ status, append, readAll })),
		"browser smoke diagnostics must not imply lifecycle, app ack, live truth, or commit-barrier semantics",
	);

	return {
		appendCursor: append.cursor,
		backendCursorKind: append.backendCursor?.kind,
		statusCapabilities: statusCapabilities(status),
	};
}

async function runDuplicateConflictSmoke(): Promise<void> {
	const spec = nextSpec("duplicate-conflict");
	await deleteDatabaseBestEffort(spec.dbName);
	const backend = indexedDbAgenticMemoryCommittedFactLogBackend<string>(spec);
	const original = agenticMemoryCommittedRecordMaterialFact(
		record("record-d594-real-idb-conflict", "fragment-d594-real-idb-original"),
		{ operation: "create", correlationId: "d594-real-idb-conflict" },
	);
	const conflicting = agenticMemoryCommittedRecordMaterialFact(
		record("record-d594-real-idb-conflict", "fragment-d594-real-idb-conflicting", "other"),
		{ operation: "create", correlationId: "d594-real-idb-conflict" },
	);
	const batch = agenticMemoryCommittedFactBatch([original]);

	const committed = await backend.append(batch);
	const duplicate = await backend.append(batch);
	const conflict = await backend.append(agenticMemoryCommittedFactBatch([conflicting]));
	const read = await backend.read();

	assert(committed.status === "committed", "initial fact should commit");
	assert(duplicate.status === "duplicate", "same identity/material should be duplicate");
	assert(conflict.status === "conflict", "same identity/different material should be conflict");
	assertDeepEqual(
		original.identity,
		conflicting.identity,
		"conflict setup should reuse fact identity",
	);
	assert(
		original.materialIdentity.key !== conflicting.materialIdentity.key,
		"conflict setup should use different material identity",
	);
	assertDeepEqual(read.facts, [original], "conflict should not choose a winner or append material");
}

async function runUncertainSmoke(): Promise<void> {
	const spec = nextSpec("uncertain");
	await deleteDatabaseBestEffort(spec.dbName);
	await createDatabaseWithStore(spec.dbName, "other-store");
	const backend = indexedDbAgenticMemoryCommittedFactLogBackend<string>({
		...spec,
		version: 1,
		storeName: "missing-store",
	});
	const fact = agenticMemoryCommittedRecordMaterialFact(
		record("record-d594-real-idb-uncertain", "fragment-d594-real-idb-uncertain"),
		{ operation: "create", correlationId: "d594-real-idb-uncertain" },
	);

	const append = await backend.append(agenticMemoryCommittedFactBatch([fact]));
	const read = await backend.read();

	assert(append.status === "uncertain", "missing object store should be an uncertain attempt");
	assert(
		agenticMemoryFactCommitStatusIsDurable(append.status) === false,
		"uncertain must not be treated as durable success",
	);
	assert(
		agenticMemoryFactCommitStatusIsTerminalFailure(append.status) === false,
		"uncertain must not be treated as terminal failure",
	);
	assertDeepEqual(
		append.cursor,
		{ kind: "agentic-memory-fact-stream.cursor", position: 0 },
		"uncertain append should keep the last proven fact-stream cursor",
	);
	assert(append.facts === 0, "uncertain append should not report committed facts");
	assert(read.facts.length === 0, "uncertain path should not expose committed facts");
	assert(
		(read.issues?.length ?? 0) > 0,
		"uncertain setup should remain visible through issue DATA",
	);
}

async function runSmoke(): Promise<SmokeOk> {
	assert(typeof indexedDB !== "undefined", "real browser IndexedDB API is required");
	const diagnostics = await runAppendReadDiagnosticsSmoke();
	await runDuplicateConflictSmoke();
	await runUncertainSmoke();
	return {
		ok: true,
		cases: ["append-read-diagnostics", "duplicate-conflict", "uncertain-read-resolution-required"],
		diagnostics,
	};
}

function errorMessage(error: unknown): SmokeFailure {
	if (error instanceof Error) {
		return {
			ok: false,
			error: error.message,
			...(error.stack === undefined ? {} : { stack: error.stack }),
		};
	}
	return { ok: false, error: String(error) };
}

function base64Utf8(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

async function main(): Promise<void> {
	let result: SmokeResult;
	try {
		result = await runSmoke();
	} catch (error) {
		result = errorMessage(error);
	} finally {
		await Promise.all(Array.from(dbNames, (dbName) => deleteDatabaseBestEffort(dbName)));
	}
	const payload = `${RESULT_START}${base64Utf8(JSON.stringify(result))}${RESULT_END}`;
	console.log(payload);
	document.body.textContent = payload;
}

void main();
