import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalSha256, empiricalStrictJsonDigest, exactKeys, record } from "./canonical.js";
import {
	assertCurrentImplementationRuntime,
	CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
	measureCurrentImplementation,
} from "./implementation-manifest.js";
import {
	PROVIDER_QUALIFICATION_CAP,
	PROVIDER_QUALIFICATION_REF,
} from "./provider-qualification.js";
import {
	QUALIFICATION_ENDPOINT,
	runProviderQualificationWithTransport,
} from "./provider-qualification-runner.js";
import { readRootEvalD145CharterLedger } from "./root-eval-charter-ledger.js";
import {
	acquireRootEvalD152Execution,
	readRootEvalD152Ledger,
	upgradeRootEvalQualificationLedger,
} from "./root-eval-d152-ledger.js";
import { parseRootEvalUniqueJson, readRootEvalBoundedResponseBytes } from "./root-eval-live.js";
import {
	parseRootEvalLiveCredential,
	ROOT_EVAL_LIVE_PRICING_SOURCE,
	ROOT_EVAL_LIVE_ZDR_SOURCE,
	readRootEvalLiveCurrentKey,
	readRootEvalPrivateFile,
} from "./root-eval-live-authority.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const operatorRoot = resolve(import.meta.dirname, "../.private/graph-native-rerun-avoidance");
const ledgerPath = join(operatorRoot, "d152-charter-ledger.v1.json");
const LIVE_FETCH = globalThis.fetch;

async function official(url: string, maximum: number) {
	const response = await LIVE_FETCH(url, {
		redirect: "error",
		cache: "no-store",
		credentials: "omit",
		referrerPolicy: "no-referrer",
		signal: AbortSignal.timeout(30000),
	});
	if (response.status !== 200 || response.redirected || response.url !== url)
		throw new TypeError("qualification official source unavailable");
	const bytes = await readRootEvalBoundedResponseBytes(
		response,
		maximum,
		"qualification official source",
	);
	return {
		bytes,
		value: record(
			parseRootEvalUniqueJson(bytes, "qualification official source"),
			"qualification official source",
		),
	};
}

async function main() {
	const [mode, approvalRef, proofDigest] = process.argv.slice(2);
	if (
		process.argv.length !== 5 ||
		!["--upgrade-ledger", "--execute-live"].includes(mode ?? "") ||
		approvalRef !== PROVIDER_QUALIFICATION_REF ||
		!/^sha256:[a-f0-9]{64}$/u.test(proofDigest ?? "")
	)
		throw new TypeError(
			"requires exact qualification execution reference and settings/predecessor proof digest",
		);
	assertCurrentImplementationRuntime();
	if (
		execFileSync("git", ["status", "--porcelain"], {
			cwd: repositoryRoot,
			encoding: "utf8",
		}).trim() !== "" ||
		(await measureCurrentImplementation()) !== CURRENT_IMPLEMENTATION_MANIFEST_DIGEST
	)
		throw new TypeError("qualification requires clean committed and frozen implementation");
	if (mode === "--upgrade-ledger") {
		const release = await acquireRootEvalD152Execution(ledgerPath);
		try {
			const ledger = await upgradeRootEvalQualificationLedger(ledgerPath, proofDigest!);
			console.log(
				JSON.stringify({
					action: "qualification-format-upgrade",
					ledgerDigest: ledger.ledgerDigest,
					developmentSpentMicrousd: ledger.developmentSpentMicrousd,
					campaigns: ledger.entries.length,
				}),
			);
		} finally {
			await release();
		}
		return;
	}
	// This receipt is made only after the intended settings are observed in the UI.
	// Missing browser evidence stops before credential access or inference.
	const settings = record(
		strictJsonCodec.decode(
			new Uint8Array(await readFile(join(operatorRoot, "together-qualification-settings.json"))),
		),
		"qualification settings",
	);
	exactKeys(
		settings,
		[
			"executionRef",
			"keyName",
			"credentialFingerprintDigest",
			"providerRef",
			"allowedModels",
			"allowedProviders",
			"zeroByok",
			"zeroDataRetention",
			"promptTraining",
			"observedAtMs",
		],
		"qualification settings",
	);
	const now = Date.now();
	if (
		empiricalStrictJsonDigest(settings) !== proofDigest ||
		settings.executionRef !== approvalRef ||
		settings.keyName !== "Local Eval 2" ||
		settings.providerRef !== "together" ||
		settings.zeroByok !== true ||
		settings.zeroDataRetention !== true ||
		settings.promptTraining !== false ||
		JSON.stringify(settings.allowedModels) !==
			JSON.stringify(["deepseek/deepseek-v4-flash-0731"]) ||
		JSON.stringify(settings.allowedProviders) !== JSON.stringify(["Fireworks", "Together"]) ||
		!Number.isSafeInteger(settings.observedAtMs) ||
		now - Number(settings.observedAtMs) < 0 ||
		now - Number(settings.observedAtMs) > 86_400_000
	)
		throw new TypeError("qualification settings proof invalid or stale");
	const pricing = await official(ROOT_EVAL_LIVE_PRICING_SOURCE, 1_048_576);
	const data = record(pricing.value.data, "qualification pricing data");
	if (data.id !== "deepseek/deepseek-v4-flash-0731" || !Array.isArray(data.endpoints))
		throw new TypeError("qualification model catalog invalid");
	const exactRoute = (raw: unknown) => {
		const value = record(raw, "qualification endpoint");
		return (
			value.provider_name === "Together" &&
			value.tag === "together" &&
			value.model_id === "deepseek/deepseek-v4-flash-0731"
		);
	};
	const matches = data.endpoints.filter(exactRoute);
	if (matches.length !== 1) throw new TypeError("qualification Together route ambiguous");
	const endpoint = record(matches[0], "qualification Together endpoint");
	const prices = record(endpoint.pricing, "qualification prices");
	if (
		prices.prompt !== "0.00000014" ||
		prices.completion !== "0.00000028" ||
		prices.input_cache_read !== "0.00000003" ||
		!Array.isArray(endpoint.supported_parameters) ||
		!["reasoning", "response_format", "structured_outputs", "max_tokens"].every((value) =>
			(endpoint.supported_parameters as unknown[]).includes(value),
		)
	)
		throw new TypeError("qualification Together price or request contract changed");
	const zdr = await official(ROOT_EVAL_LIVE_ZDR_SOURCE, 4 * 1_048_576);
	if (!Array.isArray(zdr.value.data) || zdr.value.data.filter(exactRoute).length !== 1)
		throw new TypeError("qualification Together ZDR unavailable");
	const historical = await readRootEvalD145CharterLedger(
		join(operatorRoot, "d145-charter-ledger.v4.json"),
	);
	const ledger = await readRootEvalD152Ledger({ path: ledgerPath, historicalLedger: historical });
	if (
		ledger.qualifications.some(
			(entry) => entry.status === "reserved" || entry.executionRef === approvalRef,
		) ||
		ledger.developmentSpentMicrousd + PROVIDER_QUALIFICATION_CAP > 40_000_000
	)
		throw new TypeError("qualification exhausted or consumed development authority");
	const credential = parseRootEvalLiveCredential(
		await readRootEvalPrivateFile(
			resolve(import.meta.dirname, "../.private/empirical-memory-rerun-avoidance/openrouter.env"),
			16384,
		),
	);
	const credentialFingerprintDigest = empiricalSha256(
		new TextEncoder().encode(credential.bearerToken),
	);
	if (credentialFingerprintDigest !== settings.credentialFingerprintDigest)
		throw new TypeError("qualification settings credential mismatch");
	const currentKey = await readRootEvalLiveCurrentKey({
		fetchImpl: LIVE_FETCH,
		credential,
		minimumRemainingMicrousd: PROVIDER_QUALIFICATION_CAP,
	});
	const result = await runProviderQualificationWithTransport({
		privateRoot: join(operatorRoot, approvalRef!),
		ledgerPath,
		expectedLedgerDigest: ledger.ledgerDigest,
		transport: async (_admission, body, signal) => {
			const response = await LIVE_FETCH(QUALIFICATION_ENDPOINT, {
				method: "POST",
				body,
				headers: {
					authorization: `Bearer ${credential.bearerToken}`,
					"content-type": "application/json",
				},
				redirect: "error",
				credentials: "omit",
				referrerPolicy: "no-referrer",
				signal,
			});
			if (response.redirected || response.url !== QUALIFICATION_ENDPOINT)
				throw new TypeError("qualification response route drift");
			return {
				status: response.status,
				bytes: await readRootEvalBoundedResponseBytes(
					response,
					1_048_576,
					"qualification provider response",
				),
			};
		},
		grant: {
			executionRef: PROVIDER_QUALIFICATION_REF,
			mode: "live",
			implementationDigest: CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
			controlPlaneDigest: empiricalStrictJsonDigest({
				settings,
				pricingDigest: empiricalSha256(pricing.bytes),
				zdrDigest: empiricalSha256(zdr.bytes),
				currentKeyDigest: currentKey.admissionDigest,
			}),
			credentialFingerprintDigest,
			approvedHardCapMicrousd: PROVIDER_QUALIFICATION_CAP,
			maxRequests: 3,
		},
	});
	console.log(
		JSON.stringify({
			executionRef: approvalRef,
			receipt: result.receipt,
			ledgerDigest: result.ledger.ledgerDigest,
			developmentSpentMicrousd: result.ledger.developmentSpentMicrousd,
			efficacyClaim: "none",
		}),
	);
}

await main();
