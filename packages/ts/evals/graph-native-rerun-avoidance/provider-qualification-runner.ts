import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalSha256, empiricalStrictJsonDigest, record } from "./canonical.js";
import { createRootEvalHttpTransportLeaf } from "./http-transport-leaf.js";
import {
	createProviderQualificationGraph,
	PROVIDER_QUALIFICATION_CAP,
	PROVIDER_QUALIFICATION_REF,
	PROVIDER_QUALIFICATION_ROUTE,
	type QualificationAdmission,
	type QualificationOutcome,
	type QualificationState,
} from "./provider-qualification.js";
import {
	acquireRootEvalD152Execution,
	reserveRootEvalQualification,
	settleRootEvalQualification,
	updateRootEvalQualificationLedger,
} from "./root-eval-d152-ledger.js";
import { parseRootEvalLiveProviderResponse, parseRootEvalUniqueJson } from "./root-eval-live.js";

export const QUALIFICATION_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

import {
	qualificationExamples as examples,
	QUALIFICATION_PRICING,
	qualificationCandidateCatalogDigest,
	qualificationWire,
} from "./provider-qualification.js";
export function qualificationOutcome(
	admission: QualificationAdmission,
	status: number,
	bytes: Uint8Array,
): QualificationOutcome {
	let reported: number | null = null;
	let usable = false;
	let reason = "transport-uncertain";
	// Preserve valid usage.cost even if later format/route verification rejects.
	try {
		const root = record(
			parseRootEvalUniqueJson(bytes, "qualification response"),
			"qualification response",
		);
		const usage = record(root.usage, "qualification usage");
		if (
			typeof usage.cost === "number" &&
			Number.isFinite(usage.cost) &&
			usage.cost >= 0 &&
			Number.isSafeInteger(Math.ceil(usage.cost * 1_000_000))
		)
			reported = Math.ceil(usage.cost * 1_000_000);
	} catch {
		/* No cost evidence releases a reservation. */
	}
	try {
		const example = examples[admission.request - 1]!;
		const result = parseRootEvalLiveProviderResponse({
			route: PROVIDER_QUALIFICATION_ROUTE,
			status,
			bytes,
			retryAfter: null,
			pricing: QUALIFICATION_PRICING,
			reservationMicrousd: admission.reservationMicrousd,
			candidateRefs: [...example.candidateRefs],
			candidateCatalogDigest: qualificationCandidateCatalogDigest(admission.request),
		});
		usable =
			result.disposition === "tool" &&
			reported !== null &&
			result.tool?.candidateRef === example.candidateRefs[example.requested] &&
			result.tool.candidateCatalogDigest === qualificationCandidateCatalogDigest(admission.request);
		reason = usable
			? "exact-proposal-accepted"
			: result.disposition === "tool"
				? "qualification-content-mismatch"
				: result.reason;
	} catch {
		reason = "response-contract-rejected";
	}
	return Object.freeze({
		request: admission.request,
		admissionDigest: admission.admissionDigest,
		responseDigest: empiricalSha256(bytes),
		status,
		usable,
		reason,
		providerReportedMicrousd: reported,
		accountedMicrousd: reported ?? admission.reservationMicrousd,
	});
}

async function saveExclusive(path: string, bytes: Uint8Array): Promise<void> {
	const file = await open(
		path,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await file.writeFile(bytes);
		await file.sync();
	} finally {
		await file.close();
	}
}

export type QualificationGrant = Readonly<{
	executionRef: typeof PROVIDER_QUALIFICATION_REF;
	mode: "live" | "no-network";
	implementationDigest: string;
	controlPlaneDigest: string;
	credentialFingerprintDigest: string;
	approvedHardCapMicrousd: typeof PROVIDER_QUALIFICATION_CAP;
	maxRequests: 3;
}>;

/** Private executor: transport is injected only by the separately named offline entry. */
async function run(input: {
	privateRoot: string;
	ledgerPath: string;
	expectedLedgerDigest: string;
	grant: QualificationGrant;
	transport: (
		admission: QualificationAdmission,
		body: string,
		signal: AbortSignal,
	) => Promise<{ status: number; bytes: Uint8Array }>;
}) {
	const release = await acquireRootEvalD152Execution(input.ledgerPath);
	try {
		return await runExclusive(input);
	} finally {
		await release();
	}
}

async function runExclusive(input: Parameters<typeof run>[0]) {
	if (
		input.grant.executionRef !== PROVIDER_QUALIFICATION_REF ||
		input.grant.approvedHardCapMicrousd !== PROVIDER_QUALIFICATION_CAP ||
		input.grant.maxRequests !== 3
	)
		throw new TypeError("qualification grant scope invalid");
	const grantDigest = empiricalStrictJsonDigest(input.grant);
	// mkdir is exclusive: a failed/interrupted run never becomes a redispatch.
	await mkdir(input.privateRoot, { mode: 0o700 });
	await saveExclusive(join(input.privateRoot, "grant.json"), strictJsonCodec.encode(input.grant));
	const reserved = await updateRootEvalQualificationLedger({
		path: input.ledgerPath,
		expectedLedgerDigest: input.expectedLedgerDigest,
		update: (ledger) => reserveRootEvalQualification(ledger, input.grant.executionRef, grantDigest),
	});
	const topology = createProviderQualificationGraph(input.grant.executionRef);
	// Snapshot the domain observation targets before attaching transport internals.
	// These are untouched Graph.observe envelopes, not a rewritten full-graph trace.
	const domainObservation = topology.graph.observe();
	const http = createRootEvalHttpTransportLeaf<{ status: number; bytes: Uint8Array }>(
		topology.graph,
		{
			endpoint: QUALIFICATION_ENDPOINT,
			maxExecutions: 3,
			timeoutMs: 300_000,
			maxResponseBytes: 1_048_576,
		},
	);
	const envelopes: unknown[] = [];
	const observation = domainObservation.subscribe((envelope) => {
		if (envelopes.length >= 4096) throw new TypeError("qualification observation bound exceeded");
		envelopes.push(envelope);
	});
	let graphFailed = false;
	const stop = topology.state.subscribe((message) => {
		if (message[0] === "ERROR") graphFailed = true;
	});
	try {
		await saveExclusive(
			join(input.privateRoot, "describe.json"),
			strictJsonCodec.encode(topology.graph.describe()),
		);
		topology.input.down([["DATA", { kind: "start" }]]);
		for (;;) {
			if (graphFailed) throw new TypeError("qualification Graph rejected lifecycle");
			const admission = topology.admission.cache;
			if (admission === null) break;
			if (typeof admission !== "object" || admission === undefined)
				throw new TypeError("qualification missing Graph admission");
			const body = qualificationWire(admission);
			const executionId = `${admission.executionRef}/request-${admission.request}`;
			await saveExclusive(
				join(input.privateRoot, `dispatch-${admission.request}.json`),
				strictJsonCodec.encode(admission),
			);
			const signal = AbortSignal.timeout(300_000);
			let response: { status: number; bytes: Uint8Array };
			try {
				response = await http.run(
					executionId,
					async (transportSignal) => {
						const material = await input.transport(admission, body, transportSignal);
						return { material, summary: { status: material.status, headers: {}, body: "" } };
					},
					signal,
				);
			} catch {
				response = { status: 0, bytes: new Uint8Array() };
			}
			await saveExclusive(
				join(input.privateRoot, `response-${admission.request}.json`),
				response.bytes,
			);
			topology.input.down([
				[
					"DATA",
					{
						kind: "outcome",
						outcome: qualificationOutcome(admission, response.status, response.bytes),
					},
				],
			]);
		}
		const receipt = topology.terminal.cache as QualificationState | null;
		if (receipt === null || !receipt.terminal)
			throw new TypeError("qualification omitted terminal receipt");
		await saveExclusive(
			join(input.privateRoot, "observation.json"),
			strictJsonCodec.encode(envelopes),
		);
		await saveExclusive(join(input.privateRoot, "receipt.json"), strictJsonCodec.encode(receipt));
		const ledger = await updateRootEvalQualificationLedger({
			path: input.ledgerPath,
			expectedLedgerDigest: reserved.ledgerDigest,
			update: (current) => settleRootEvalQualification(current, grantDigest, receipt),
		});
		return { receipt, ledger };
	} finally {
		await http.dispose();
		observation();
		stop();
		topology.dispose();
	}
}

export function runNoNetworkProviderQualification(input: Parameters<typeof run>[0]) {
	if (input.grant.mode !== "no-network")
		throw new TypeError("offline qualification cannot receive live authority");
	return run(input);
}

// Transport injection is mechanical. This module contains no real network or
// credential capability; the sole real transport lives in the validated CLI.
export const runProviderQualificationWithTransport = run;
