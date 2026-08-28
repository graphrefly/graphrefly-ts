import { constants, createReadStream } from "node:fs";
import { chmod, link, mkdir, open, readdir, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	safeInteger,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import {
	assertRootEvalObservationRuntimeShape,
	assertRootEvalObservationSequence,
	type EvalObservation,
} from "./eval-topology.js";
import {
	ROOT_EVAL_LIVE_CAMPAIGN_HARD_CAP_MICROUSD,
	ROOT_EVAL_LIVE_GENERATION_REF,
} from "./root-eval-live-authority.js";

const RECOVERY_SCHEMA = "graphrefly-ts.root-eval-live-recovered-progress.v1" as const;
const DISPOSITION_NAME = `.${ROOT_EVAL_LIVE_GENERATION_REF}.disposition.v18.json` as const;
const DISPATCH_DIRECTORY = ".d140-provider-dispatches" as const;
const TARGET_NAME = "recovered-progress-evidence.v1.json" as const;
const EXPECTED_FAILURE =
	"root eval live success partial observations drifted from Graph result observations" as const;

interface SessionCommandOutput {
	readonly threadId: string;
	readonly command: string;
	readonly status: string;
	readonly stdout: string;
}

async function readSessionCommandOutput(
	sessionPath: string,
	ordinal: number,
): Promise<SessionCommandOutput> {
	let selected: SessionCommandOutput | null = null;
	const lines = createInterface({ input: createReadStream(sessionPath, { encoding: "utf8" }) });
	for await (const line of lines) {
		const value = record(JSON.parse(line), "session record");
		if (value.ordinal !== ordinal) continue;
		literal(value.type, "event_msg", "session record.type");
		const payload = record(value.payload, "session record.payload");
		literal(payload.type, "item_completed", "session record.payload.type");
		const item = record(payload.item, "session record.payload.item");
		const command = array(item.command, "session command");
		if (command.length !== 3 || typeof command[2] !== "string")
			throw new TypeError("recovery source command shape invalid");
		if (typeof item.stdout !== "string" || typeof item.status !== "string")
			throw new TypeError("recovery source output shape invalid");
		if (typeof payload.thread_id !== "string")
			throw new TypeError("recovery source thread identity invalid");
		selected = Object.freeze({
			threadId: payload.thread_id,
			command: command[2],
			status: item.status,
			stdout: item.stdout,
		});
		break;
	}
	if (selected === null) throw new TypeError("recovery source command output missing");
	return selected;
}

function parseProgress(stdout: string): readonly EvalObservation[] {
	const observations: EvalObservation[] = [];
	for (const line of stdout.split("\n")) {
		if (!line.startsWith('{"stream":"graph-progress"')) continue;
		const envelope = record(JSON.parse(line), "recovered graph progress envelope");
		exactKeys(envelope, ["stream", "observation"], "recovered graph progress envelope");
		literal(envelope.stream, "graph-progress", "recovered graph progress stream");
		const observation = envelope.observation as EvalObservation;
		assertRootEvalObservationRuntimeShape(
			observation,
			`recovered graph progress observation ${observations.length}`,
		);
		observations.push(strictSnapshot(observation) as EvalObservation);
	}
	if (observations.length < 1 || observations.length > 512)
		throw new TypeError("recovered graph progress observation count invalid");
	return Object.freeze(observations);
}

function semanticProgress(values: readonly EvalObservation[]): readonly EvalObservation[] {
	const projected: EvalObservation[] = [];
	for (const value of values) {
		const previous = projected.at(-1);
		if (
			previous === undefined ||
			empiricalStrictJsonDigest(previous) !== empiricalStrictJsonDigest(value)
		)
			projected.push(value);
	}
	assertRootEvalObservationSequence(projected, "recovered Graph progress");
	return Object.freeze(projected);
}

async function readCanonicalFile(path: string, maximumBytes: number): Promise<unknown> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600)
			throw new TypeError("recovery input private file identity invalid");
		if (stat.size < 1 || stat.size > maximumBytes)
			throw new TypeError("recovery input private file size invalid");
		const bytes = new Uint8Array(await handle.readFile());
		const decoded = strictJsonCodec.decode(bytes);
		if (!sameBytes(strictJsonCodec.encode(decoded), bytes))
			throw new TypeError("recovery input private file was not canonical");
		return decoded;
	} finally {
		await handle.close();
	}
}

async function readDispatchReceipts(
	privateRoot: string,
	claimDigest: string,
): Promise<readonly string[]> {
	const root = join(privateRoot, DISPATCH_DIRECTORY);
	const names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort();
	const receiptDigests: string[] = [];
	const admissionIds = new Set<string>();
	for (const name of names) {
		if (!/^[0-9a-f]{64}\.json$/u.test(name))
			throw new TypeError("recovery dispatch receipt name invalid");
		const receipt = record(
			await readCanonicalFile(join(root, name), 16_384),
			"recovery dispatch receipt",
		);
		exactKeys(
			receipt,
			["claimDigest", "executionId", "admissionId", "operationId", "attempt", "receiptDigest"],
			"recovery dispatch receipt",
		);
		literal(receipt.claimDigest, claimDigest, "recovery dispatch receipt.claimDigest");
		const executionId = String(receipt.executionId);
		const admissionId = String(receipt.admissionId);
		const operationId = String(receipt.operationId);
		const attempt = safeInteger(receipt.attempt, "recovery dispatch receipt.attempt", { max: 2 });
		if (
			attempt < 1 ||
			!admissionId.endsWith(`/attempt-${attempt}/admission`) ||
			executionId !== admissionId ||
			operationId.length < 1 ||
			admissionIds.has(admissionId)
		)
			throw new TypeError("recovery dispatch receipt relationship invalid");
		admissionIds.add(admissionId);
		const receiptDigest = digest(receipt.receiptDigest, "recovery dispatch receipt.receiptDigest");
		const material = { claimDigest, executionId, admissionId, operationId, attempt };
		if (receiptDigest !== empiricalStrictJsonDigest(material))
			throw new TypeError("recovery dispatch receipt digest invalid");
		receiptDigests.push(receiptDigest);
	}
	return Object.freeze(receiptDigests);
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(
		path,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function persistExclusive(privateRoot: string, value: unknown): Promise<string> {
	const generationRoot = join(privateRoot, ROOT_EVAL_LIVE_GENERATION_REF);
	await mkdir(generationRoot, { mode: 0o700 });
	await chmod(generationRoot, 0o700);
	const bytes = strictJsonCodec.encode(value);
	const target = join(generationRoot, TARGET_NAME);
	const stage = join(privateRoot, `.${TARGET_NAME}.stage-${process.pid}`);
	const handle = await open(
		stage,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		await link(stage, target);
		await syncDirectory(generationRoot);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
		await rename(stage, target);
		await syncDirectory(generationRoot);
		return empiricalSha256(bytes);
	} finally {
		await rm(stage, { force: true });
	}
	return empiricalSha256(bytes);
}

async function main(): Promise<void> {
	const privateRootArgument = process.argv[2];
	const sessionPathArgument = process.argv[3];
	const ordinalArgument = process.argv[4];
	if (
		privateRootArgument === undefined ||
		sessionPathArgument === undefined ||
		ordinalArgument === undefined ||
		!isAbsolute(privateRootArgument) ||
		!isAbsolute(sessionPathArgument)
	)
		throw new TypeError(
			"usage: recover-d140-progress-evidence <private-root> <session-jsonl> <ordinal>",
		);
	const privateRoot = resolve(privateRootArgument);
	const sessionPath = resolve(sessionPathArgument);
	if (
		(await realpath(privateRoot)) !== privateRoot ||
		(await realpath(dirname(sessionPath))) !== dirname(sessionPath)
	)
		throw new TypeError("recovery input path drifted");
	const ordinal = safeInteger(Number(ordinalArgument), "recovery source ordinal");
	const claim = record(
		await readCanonicalFile(join(privateRoot, DISPOSITION_NAME), 65_536),
		"recovery committed claim",
	);
	const claimDigest = digest(claim.claimDigest, "recovery committed claim.claimDigest");
	const commandOutput = await readSessionCommandOutput(sessionPath, ordinal);
	if (
		commandOutput.command !== "pnpm run eval:root:live" ||
		commandOutput.status !== "failed" ||
		!commandOutput.stdout.includes(EXPECTED_FAILURE)
	)
		throw new TypeError("recovery source was not the consumed D140 live command");
	const progress = parseProgress(commandOutput.stdout);
	const semantic = semanticProgress(progress);
	const terminal = semantic.at(-1)!;
	if (
		terminal.campaignRef !== ROOT_EVAL_LIVE_GENERATION_REF ||
		terminal.finding !== "no-positive-differential" ||
		terminal.stoppingReason !== "campaign-complete" ||
		terminal.verificationDiagnostics.completedWorkItems !== 30 ||
		terminal.activeAdmittedEffects !== 0 ||
		terminal.accountedUpperBoundMicrousd > ROOT_EVAL_LIVE_CAMPAIGN_HARD_CAP_MICROUSD
	)
		throw new TypeError("recovered D140 terminal Graph observation invalid");
	for (const arm of terminal.armOrder) {
		const stage = terminal.verificationDiagnostics.stageCounts[arm];
		if (stage.completedWorkItems !== 5 || stage.cleanupCompleted !== 5)
			throw new TypeError("recovered D140 cleanup was incomplete");
	}
	const receiptDigests = await readDispatchReceipts(privateRoot, claimDigest);
	if (
		receiptDigests.length !== terminal.providerCallCount ||
		receiptDigests.length !== terminal.admittedAttempts
	)
		throw new TypeError("recovered D140 provider dispatch conservation invalid");
	const material = strictSnapshot({
		schemaVersion: RECOVERY_SCHEMA,
		generationRef: ROOT_EVAL_LIVE_GENERATION_REF,
		decisionRef: "graphrefly-ts:D140",
		disposition: "recovered-partial-evidence",
		claimDigest,
		implementationCoordinate: String(claim.implementationCoordinate),
		canonicalEvidenceStatus: "unavailable-after-post-campaign-persistence-validation-failure",
		source: {
			kind: "codex-command-output",
			threadId: commandOutput.threadId,
			ordinal,
			command: commandOutput.command,
			outputDigest: empiricalSha256(new TextEncoder().encode(commandOutput.stdout)),
		},
		progressObservationCount: progress.length,
		semanticProgressObservationCount: semantic.length,
		progressObservationDigests: progress.map(empiricalStrictJsonDigest),
		progressObservations: progress,
		terminalObservation: terminal,
		providerDispatchReceiptCount: receiptDigests.length,
		providerDispatchReceiptSetDigest: empiricalStrictJsonDigest([...receiptDigests].sort()),
		cleanupDisposition: "complete",
		persistenceFailureDigest: empiricalStrictJsonDigest({
			kind: "post-campaign-persistence-validation-failure",
			message: EXPECTED_FAILURE,
		}),
		finding: "no-positive-differential",
		efficacyClaim: "none",
		causalAttribution: "undetermined",
	});
	const evidence = strictSnapshot({
		...material,
		recoveryEvidenceDigest: empiricalStrictJsonDigest(material),
	});
	const artifactDigest = await persistExclusive(privateRoot, evidence);
	process.stdout.write(
		`${JSON.stringify({
			artifactDigest,
			recoveryEvidenceDigest: evidence.recoveryEvidenceDigest,
			progressObservationCount: progress.length,
			providerDispatchReceiptCount: receiptDigests.length,
			finding: evidence.finding,
			efficacyClaim: evidence.efficacyClaim,
		})}\n`,
	);
}

await main();
