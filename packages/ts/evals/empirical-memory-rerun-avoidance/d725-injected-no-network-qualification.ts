import { empiricalStrictJsonDigest } from "./canonical.js";
import {
	createD722InjectedModelFixture,
	invokeD722InjectedModelFixture,
} from "./d722-injected-model-fixture.js";
import { D725_IMPLEMENTATION_MANIFEST_DIGEST } from "./d725-implementation-manifest.js";
import {
	consumeD725AdapterReceipt,
	createD725InjectedNoNetworkTurn,
	createD725PreLiveBundle,
	createD725Qualification,
	createD725RealProviderAdapter,
	type D725PreLiveBundleV1,
	invokeD725OpenRouterGraphTurn,
	runD725RealProviderAdapter,
} from "./d725-terminal-http-real-provider.js";

const digest = (value: unknown) => empiricalStrictJsonDigest(value);
const encoder = new TextEncoder();
const constructedInjectedBundles = new WeakSet<object>();

const budget = Object.freeze({
	budgetLimits: Object.freeze({
		maxRequests: 96,
		maxRetryWaits: 12,
		maxCostMicrousd: 6_000_000,
		maxElapsedMs: 7_200_000,
	}),
	effectCeilings: Object.freeze({
		providerMaxCostMicrousd: 50_000,
		providerMaxElapsedMs: 120_000,
		localEffectMaxElapsedMs: 60_000,
		routeDigest: digest({ route: "d725-injected-no-network" }),
	}),
});

function createFullSixArmAdapter() {
	const workspaces = new Map<number, string>();
	const model = createD722InjectedModelFixture();
	return createD725RealProviderAdapter({
		executionClass: "injected-no-network",
		async materialization({ effectRequest }) {
			const workspace = digest({ run: effectRequest.runSequence, state: "base" });
			workspaces.set(effectRequest.runSequence, workspace);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "materialization",
					status: "ready",
					workspaceStateDigest: workspace,
					evidenceDigest: digest({ effectRequest, ready: true }),
				},
			};
		},
		async providerRequest(input) {
			return createD725InjectedNoNetworkTurn({
				actualCostMicrousd: 1,
				actualElapsedMs: 1,
				result: await invokeD722InjectedModelFixture(model, input.effectRequest),
			});
		},
		async retryWait({ effectRequest }) {
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: effectRequest.retryAfterMs ?? 60_000,
				result: {
					effectKind: "retry-wait",
					status: "completed",
					evidenceDigest: digest({ effectRequest, waited: true }),
				},
			};
		},
		async toolAction({ effectRequest }) {
			const intent = effectRequest.toolIntent!;
			const before = workspaces.get(effectRequest.runSequence)!;
			const after =
				intent.toolRef === "replace-exact"
					? digest({ before, intent: intent.intentDigest })
					: before;
			workspaces.set(effectRequest.runSequence, after);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "tool-action",
					toolRef: intent.toolRef,
					intentDigest: intent.intentDigest,
					status: "succeeded",
					nonEmptyDiff: intent.toolRef === "workspace-diff",
					workspaceStateBeforeDigest: before,
					workspaceStateAfterDigest: after,
					evidenceDigest: digest({ effectRequest, succeeded: true }),
				},
			};
		},
		async hiddenVerifier({ effectRequest }) {
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "hidden-verifier",
					status: "passed",
					workspaceStateDigest: workspaces.get(effectRequest.runSequence)!,
					evidenceDigest: digest({ effectRequest, passed: true }),
				},
			};
		},
		async cleanup({ effectRequest }) {
			workspaces.delete(effectRequest.runSequence);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "cleanup",
					status: "succeeded",
					evidenceDigest: digest({ effectRequest, cleaned: true }),
				},
			};
		},
	});
}

function createTerminalProbeAdapter() {
	const workspace = digest({ workspace: "d725-terminal-probe" });
	return createD725RealProviderAdapter({
		executionClass: "injected-no-network",
		async materialization({ effectRequest }) {
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "materialization",
					status: "ready",
					workspaceStateDigest: workspace,
					evidenceDigest: digest({ effectRequest, ready: true }),
				},
			};
		},
		async providerRequest({ effectRequest, signal }) {
			return invokeD725OpenRouterGraphTurn({
				effectRequest,
				credential: {
					credentialBindingRef: "d725.injected",
					credentialBindingRevision: "v1",
					bearerToken: "not-a-live-credential",
				},
				transport: {
					async request() {
						return {
							status: 400,
							body: encoder.encode(
								JSON.stringify({ error: { code: "invalid_request", message: "private" } }),
							),
							retryAfterMs: null,
							retryAfterDisposition: "absent",
						};
					},
				},
				taskStatement: "Injected D725 terminal HTTP probe",
				conversation: { messages: [] },
				signal: signal ?? new AbortController().signal,
				monotonicNowMs: () => 1,
			});
		},
		async retryWait() {
			throw new TypeError("D725 terminal probe cannot retry");
		},
		async toolAction() {
			throw new TypeError("D725 terminal probe cannot execute tools");
		},
		async hiddenVerifier() {
			throw new TypeError("D725 terminal probe cannot verify");
		},
		async cleanup({ effectRequest }) {
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "cleanup",
					status: "succeeded",
					evidenceDigest: digest({ effectRequest, cleaned: true }),
				},
			};
		},
	});
}

export async function runD725InjectedNoNetworkQualification(): Promise<D725PreLiveBundleV1> {
	const sourceDigest = D725_IMPLEMENTATION_MANIFEST_DIGEST;
	const fullRun = await runD725RealProviderAdapter({
		sourceDigest,
		...budget,
		adapter: createFullSixArmAdapter(),
	});
	const operational = consumeD725AdapterReceipt(fullRun.receipt, fullRun);
	if (fullRun.core.ledger.completedArms.length !== 6)
		throw new TypeError("D725 injected qualification did not complete all six arms");
	const probeRun = await runD725RealProviderAdapter({
		sourceDigest: digest({ qualification: "d725-terminal-probe" }),
		...budget,
		adapter: createTerminalProbeAdapter(),
	});
	const probe = consumeD725AdapterReceipt(probeRun.receipt, probeRun);
	if (probe.terminalHttpAdmissionCount !== 1)
		throw new TypeError("D725 injected qualification omitted its terminal HTTP probe");
	const bundle = createD725PreLiveBundle(
		createD725Qualification({
			sourceDigest,
			ledgerEvidenceDigest: fullRun.core.ledger.evidenceDigest,
			terminalHttpGraphEvidence: fullRun.terminalHttpGraphEvidence,
			terminalProbeGraphEvidence: probeRun.terminalHttpGraphEvidence,
			operational,
		}),
	);
	constructedInjectedBundles.add(bundle);
	return bundle;
}

export function isD725InjectedNoNetworkQualificationBundle(
	value: unknown,
): value is D725PreLiveBundleV1 {
	return typeof value === "object" && value !== null && constructedInjectedBundles.has(value);
}
