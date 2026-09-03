import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/graph-native-rerun-avoidance/canonical.js";
import {
	createProviderQualificationGraph,
	initialQualificationState,
	PROVIDER_QUALIFICATION_CAP,
	PROVIDER_QUALIFICATION_REF,
	qualificationAdmission,
	qualificationWire,
	settleQualification,
	validateQualificationState,
} from "../../evals/graph-native-rerun-avoidance/provider-qualification.js";
import {
	type QualificationGrant,
	qualificationOutcome,
	runNoNetworkProviderQualification,
} from "../../evals/graph-native-rerun-avoidance/provider-qualification-runner.js";
import { ROOT_EVAL_D145_EMPTY_CHARTER_LEDGER } from "../../evals/graph-native-rerun-avoidance/root-eval-charter-ledger.js";
import {
	acquireRootEvalD152Execution,
	createRootEvalD152Ledger,
	nextRootEvalD152DevelopmentOrdinal,
	readRootEvalD152Ledger,
	reserveRootEvalQualification,
	settleRootEvalQualification,
	updateRootEvalQualificationLedger,
	upgradeRootEvalQualificationLedger,
} from "../../evals/graph-native-rerun-avoidance/root-eval-d152-ledger.js";
import { strictJsonCodec } from "../json/codec.js";

const digest = empiricalStrictJsonDigest("qualification-test");
const grant: QualificationGrant = {
	executionRef: PROVIDER_QUALIFICATION_REF,
	mode: "no-network",
	implementationDigest: digest,
	controlPlaneDigest: digest,
	credentialFingerprintDigest: digest,
	approvedHardCapMicrousd: PROVIDER_QUALIFICATION_CAP,
	maxRequests: 3,
};
const empty = () => createRootEvalD152Ledger(ROOT_EVAL_D145_EMPTY_CHARTER_LEDGER);
function response(request: number, cost = 0.000042, provider = "Together") {
	const state = initialQualificationState(PROVIDER_QUALIFICATION_REF);
	const admission = qualificationAdmission(state)!;
	const first = JSON.parse(qualificationWire(admission));
	const examples = [
		{
			path: "qualification.ts",
			oldText: "export const value = 1;",
			newText: "export const value = 2;",
		},
		{
			path: "qualification.ts",
			oldText: "\treturn left + right;",
			newText: "\treturn left - right;",
		},
		{
			path: "qualification.ts",
			oldText: "const enabled = false;\r\n",
			newText: "const enabled = true;\r\n",
		},
	];
	return new TextEncoder().encode(
		JSON.stringify({
			id: "gen-test",
			provider,
			model: first.model,
			choices: [
				{
					index: 0,
					finish_reason: "stop",
					message: { role: "assistant", content: JSON.stringify(examples[request - 1]) },
				},
			],
			usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200, cost },
		}),
	);
}
function completed(costs = [42, 42, 42]) {
	let state = initialQualificationState(PROVIDER_QUALIFICATION_REF);
	for (const cost of costs) {
		const admission = qualificationAdmission(state)!;
		state = settleQualification(state, {
			...qualificationOutcome(admission, 200, response(admission.request)),
			providerReportedMicrousd: cost,
			accountedMicrousd: cost,
		});
	}
	return state;
}

describe("D155 independent provider qualification", () => {
	it("rejects relabeled offline grants before transport or ledger access", async () => {
		let calls = 0;
		expect(() =>
			runNoNetworkProviderQualification({
				privateRoot: "/not-accessed",
				ledgerPath: "/not-accessed",
				expectedLedgerDigest: digest,
				grant: { ...grant, mode: "live" },
				transport: async () => {
					calls++;
					return { status: 200, bytes: response(1) };
				},
			}),
		).toThrow(/offline/);
		expect(calls).toBe(0);
	});
	it("rejects a reservation that would exceed the shared development ceiling", () => {
		const ledger = createRootEvalD152Ledger({
			...ROOT_EVAL_D145_EMPTY_CHARTER_LEDGER,
			developmentSpentMicrousd: 39_950_001,
		});
		expect(() =>
			reserveRootEvalQualification(ledger, PROVIDER_QUALIFICATION_REF, digest),
		).toThrow();
	});
	it("stops before a next request that does not fit and conserves an over-reservation response", () => {
		const state = initialQualificationState(PROVIDER_QUALIFICATION_REF);
		const outcome = qualificationOutcome(qualificationAdmission(state)!, 200, response(1));
		const next = settleQualification(state, {
			...outcome,
			providerReportedMicrousd: 80_000,
			accountedMicrousd: 80_000,
		});
		expect(next.stopReason).toBe("budget-stopped");
		expect(qualificationAdmission(next)).toBeNull();
		const reserved = reserveRootEvalQualification(empty(), PROVIDER_QUALIFICATION_REF, digest);
		expect(
			settleRootEvalQualification(reserved, digest, next).qualifications[0]!
				.accountedUpperBoundMicrousd,
		).toBe(80_000);
	});
	it("retains the complete reservation when receipt persistence fails after a response", async () => {
		const directory = await mkdtemp(join(tmpdir(), "d155-crash-"));
		const ledgerPath = join(directory, "ledger.json");
		const ledger = empty();
		await writeFile(ledgerPath, strictJsonCodec.encode(ledger), { mode: 0o600 });
		let calls = 0;
		const privateRoot = join(directory, "run");
		try {
			await expect(
				runNoNetworkProviderQualification({
					privateRoot,
					ledgerPath,
					expectedLedgerDigest: ledger.ledgerDigest,
					grant,
					transport: async () => {
						calls++;
						await writeFile(join(privateRoot, "response-1.json"), "occupied", { mode: 0o600 });
						return { status: 200, bytes: response(1) };
					},
				}),
			).rejects.toThrow();
			const persisted = JSON.parse(await readFile(ledgerPath, "utf8"));
			expect(calls).toBe(1);
			expect(persisted.qualifications[0].status).toBe("reserved");
			expect(persisted.developmentSpentMicrousd).toBe(ledger.developmentSpentMicrousd + 100_000);
			expect(() => nextRootEvalD152DevelopmentOrdinal(persisted)).toThrow();
		} finally {
			await rm(directory, { recursive: true });
		}
	});
	it("binds exact route, wire, privacy, strict schema and token ceiling in admission", () => {
		const admission = qualificationAdmission(
			initialQualificationState(PROVIDER_QUALIFICATION_REF),
		)!;
		const wire = JSON.parse(qualificationWire(admission));
		expect(wire.provider).toEqual({
			order: ["together"],
			only: ["together"],
			allow_fallbacks: false,
			require_parameters: true,
			data_collection: "deny",
			zdr: true,
		});
		expect(wire.max_tokens).toBe(16384);
		expect(wire.response_format.json_schema.strict).toBe(true);
		for (const mutation of [
			{ providerRef: "fireworks" },
			{ requestDigest: digest },
			{ reservationMicrousd: 1 },
			{ request: 4 },
		])
			expect(() => qualificationWire({ ...admission, ...mutation })).toThrow();
	});
	it("completes exactly three serial occurrences and rejects replay and forged snapshots", () => {
		const state = completed([25000, 25000, 25000]);
		expect(state.stopReason).toBe("requests-complete");
		expect(state.accountedMicrousd).toBe(75000);
		expect(qualificationAdmission(state)).toBeNull();
		expect(() => settleQualification(state, state.outcomes[2])).toThrow();
		expect(() => validateQualificationState({ ...state, accountedMicrousd: 0 })).toThrow();
	});
	it.each([
		429, 500, 401, 200, 0,
	])("preserves unknown reservation and stops on unusable status %s", (status) => {
		const state = initialQualificationState(PROVIDER_QUALIFICATION_REF);
		const admission = qualificationAdmission(state)!;
		const outcome = qualificationOutcome(
			admission,
			status,
			new TextEncoder().encode(
				'{"error":{"code":429,"metadata":{"provider_name":"Together","is_byok":false}}}',
			),
		);
		expect(outcome.providerReportedMicrousd).toBeNull();
		expect(outcome.accountedMicrousd).toBe(33333);
		expect(settleQualification(state, outcome).terminal).toBe(true);
	});
	it("keeps reported cost on wrong-route and malformed-output rejection", () => {
		const admission = qualificationAdmission(
			initialQualificationState(PROVIDER_QUALIFICATION_REF),
		)!;
		const outcome = qualificationOutcome(admission, 200, response(1, 0.001, "Fireworks"));
		expect(outcome.usable).toBe(false);
		expect(outcome.accountedMicrousd).toBe(1000);
	});
	it("reserves shared development budget without consuming a generation or scientific streak", () => {
		const ledger = empty();
		const reserved = reserveRootEvalQualification(ledger, PROVIDER_QUALIFICATION_REF, digest);
		expect(reserved.developmentSpentMicrousd).toBe(ledger.developmentSpentMicrousd + 100000);
		expect(reserved.entries).toEqual(ledger.entries);
		expect(reserved.developmentQualificationStreak).toBe(ledger.developmentQualificationStreak);
		expect(() => nextRootEvalD152DevelopmentOrdinal(reserved)).toThrow(/reservation/);
		expect(() =>
			reserveRootEvalQualification(reserved, PROVIDER_QUALIFICATION_REF, digest),
		).toThrow();
		const settled = settleRootEvalQualification(reserved, digest, completed());
		expect(settled.developmentSpentMicrousd).toBe(ledger.developmentSpentMicrousd + 126);
		expect(nextRootEvalD152DevelopmentOrdinal(settled)).toBe(1);
		expect(settleRootEvalQualification(settled, digest, completed())).toEqual(settled);
		expect(() =>
			settleRootEvalQualification(settled, digest, completed([200, 200, 200])),
		).toThrow();
		expect(() =>
			reserveRootEvalQualification(settled, PROVIDER_QUALIFICATION_REF, digest),
		).toThrow();
	});
	it("raw topology and Graph observations expose three admissions and the same terminal receipt", () => {
		const topology = createProviderQualificationGraph(PROVIDER_QUALIFICATION_REF);
		const envelopes: unknown[] = [];
		const stop = topology.graph.observe().subscribe((value) => envelopes.push(value));
		try {
			topology.input.down([["DATA", { kind: "start" }]]);
			for (let request = 1; request <= 3; request++) {
				const admission = topology.admission.cache!;
				expect(admission.request).toBe(request);
				topology.input.down([
					[
						"DATA",
						{ kind: "outcome", outcome: qualificationOutcome(admission, 200, response(request)) },
					],
				]);
			}
			expect(topology.admission.cache).toBeNull();
			expect(topology.terminal.cache).toEqual(completed());
			expect(topology.graph.describe().nodes.map((node) => node.name)).toContain(
				"qualification/provider-admission",
			);
			expect(envelopes.length).toBeGreaterThan(10);
			expect(() => strictJsonCodec.encode(envelopes)).not.toThrow();
		} finally {
			stop();
			topology.dispose();
		}
	});
	it("runs injected HTTP leaf, atomically settles receipt, and cannot execute twice", async () => {
		const directory = await mkdtemp(join(tmpdir(), "d155-qualification-"));
		const ledgerPath = join(directory, "ledger.json");
		const ledger = empty();
		await writeFile(ledgerPath, strictJsonCodec.encode(ledger), { mode: 0o600 });
		let calls = 0;
		const input = {
			privateRoot: join(directory, "run"),
			ledgerPath,
			expectedLedgerDigest: ledger.ledgerDigest,
			grant,
			transport: async (admission: { request: number }) => {
				calls++;
				return { status: 200, bytes: response(admission.request) };
			},
		};
		try {
			const result = await runNoNetworkProviderQualification(input);
			expect(result.receipt.stopReason).toBe("requests-complete");
			expect(calls).toBe(3);
			expect(result.ledger.qualifications[0]!.receipt).toEqual(result.receipt);
			await expect(runNoNetworkProviderQualification(input)).rejects.toThrow();
			expect(calls).toBe(3);
		} finally {
			await rm(directory, { recursive: true });
		}
	});
	it("shares execution and write exclusion and fails stale compare-and-swap closed", async () => {
		const directory = await mkdtemp(join(tmpdir(), "d155-lock-"));
		const path = join(directory, "ledger.json");
		const ledger = empty();
		await writeFile(path, strictJsonCodec.encode(ledger), { mode: 0o600 });
		try {
			const release = await acquireRootEvalD152Execution(path);
			await expect(acquireRootEvalD152Execution(path)).rejects.toThrow();
			await release();
			const lock = await open(`${path}.write-lock`, "wx");
			await expect(
				updateRootEvalQualificationLedger({
					path,
					expectedLedgerDigest: ledger.ledgerDigest,
					update: (value) => value,
				}),
			).rejects.toThrow();
			await lock.close();
			await rm(`${path}.write-lock`);
			await expect(
				updateRootEvalQualificationLedger({
					path,
					expectedLedgerDigest: digest,
					update: (value) => value,
				}),
			).rejects.toThrow(/currentness/);
			expect(JSON.parse(await readFile(path, "utf8"))).toEqual(ledger);
		} finally {
			await rm(directory, { recursive: true });
		}
	});
	it("explicitly upgrades v1 preserving exact original bytes; ordinary readers do not fall back", async () => {
		const directory = await mkdtemp(join(tmpdir(), "d155-upgrade-"));
		const path = join(directory, "ledger.json");
		const {
			qualificationFormatPredecessorDigest: _predecessor,
			qualifications: _qualifications,
			ledgerDigest: _digest,
			...rest
		} = empty();
		const body = { ...rest, schemaVersion: "graphrefly-ts.root-eval-d152-ledger.v1" };
		const original = strictJsonCodec.encode({
			...body,
			ledgerDigest: empiricalStrictJsonDigest(body),
		});
		await writeFile(path, original, { mode: 0o600 });
		try {
			await expect(
				readRootEvalD152Ledger({ path, historicalLedger: ROOT_EVAL_D145_EMPTY_CHARTER_LEDGER }),
			).rejects.toThrow();
			const upgraded = await upgradeRootEvalQualificationLedger(
				path,
				empiricalStrictJsonDigest(body),
			);
			expect(upgraded.developmentSpentMicrousd).toBe(body.developmentSpentMicrousd);
			expect(upgraded.entries).toEqual(body.entries);
			expect(upgraded.qualificationFormatPredecessorDigest).toBe(empiricalStrictJsonDigest(body));
			expect(new Uint8Array(await readFile(`${path}.before-qualification`))).toEqual(original);
			await expect(
				upgradeRootEvalQualificationLedger(path, empiricalStrictJsonDigest(body)),
			).rejects.toThrow();
		} finally {
			await rm(directory, { recursive: true });
		}
	});
});
