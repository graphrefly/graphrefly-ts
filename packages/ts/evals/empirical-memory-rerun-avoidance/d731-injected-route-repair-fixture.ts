import { empiricalStrictJsonDigest } from "./canonical.js";
import { invokeD725OpenRouterGraphTurn } from "./d725-terminal-http-real-provider.js";
import {
	D729_MODEL_SLUG,
	D729_PROVIDER_NAME,
	D729_PROVIDER_TAG,
	D729_QUANTIZATION,
	D729_SELECTED_ENDPOINT_MODEL,
} from "./d729-coordinates.js";
import {
	createD726ProviderAdapter,
	createD726ProviderTurn,
	type D726ProviderAdapterV1,
} from "./d729-provider-block-core.js";

const encoder = new TextEncoder();
const digest = (label: string) => empiricalStrictJsonDigest({ label });

export function createD731EndpointEligibilityFixtureBytes(
	supportedParameters: readonly string[] = ["reasoning", "tool_choice", "tools"],
): Uint8Array {
	return encoder.encode(
		JSON.stringify({
			data: {
				id: D729_MODEL_SLUG,
				endpoints: [
					{
						name: `${D729_PROVIDER_NAME} | ${D729_SELECTED_ENDPOINT_MODEL}`,
						provider_name: D729_PROVIDER_NAME,
						tag: D729_PROVIDER_TAG,
						quantization: D729_QUANTIZATION,
						supported_parameters: supportedParameters,
					},
				],
			},
		}),
	);
}

export interface D731RepeatedTerminalInjectedFixtureV1 {
	readonly adapter: D726ProviderAdapterV1;
	readonly providerCalls: () => number;
	readonly activeRunCount: () => number;
	readonly capturedWireBody: () => Uint8Array;
}

export function createD731RepeatedTerminalInjectedFixture(): D731RepeatedTerminalInjectedFixtureV1 {
	const workspaceStateDigest = digest("d731-identical-workspace");
	const activeRuns = new Set<number>();
	let providerCalls = 0;
	let capturedWireBody: Uint8Array | null = null;
	const adapter = createD726ProviderAdapter({
		executionClass: "injected-no-network",
		async materialization({ effectRequest }) {
			activeRuns.add(effectRequest.runSequence);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "materialization",
					status: "ready",
					workspaceStateDigest,
					evidenceDigest: digest(`d731-materialization-${effectRequest.runSequence}`),
				},
			};
		},
		async providerRequest(input) {
			return createD726ProviderTurn(
				await invokeD725OpenRouterGraphTurn({
					effectRequest: input.effectRequest,
					credential: {
						bearerToken: "not-a-live-d731-fixture-credential",
						credentialBindingRef: "d731.injected-fixture",
						credentialBindingRevision: "v1",
					},
					transport: {
						async request(request) {
							providerCalls += 1;
							capturedWireBody ??= new Uint8Array(request.body);
							return {
								status: 404,
								body: encoder.encode('{"error":{"code":"endpoint_not_found"}}'),
								retryAfterMs: null,
								retryAfterDisposition: "absent" as const,
							};
						},
					},
					taskStatement: "D731 repeated identical terminal qualification",
					conversation: { messages: [] },
					signal: input.signal ?? new AbortController().signal,
					monotonicNowMs: () => providerCalls,
				}),
			);
		},
		async retryWait() {
			throw new TypeError("D731 terminal 404 cannot retry");
		},
		async toolAction() {
			throw new TypeError("D731 terminal 404 cannot execute tools");
		},
		async hiddenVerifier() {
			throw new TypeError("D731 terminal 404 cannot verify");
		},
		async cleanup({ effectRequest }) {
			activeRuns.delete(effectRequest.runSequence);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "cleanup",
					status: "succeeded",
					evidenceDigest: digest(`d731-cleanup-${effectRequest.runSequence}`),
				},
			};
		},
	});
	return Object.freeze({
		adapter,
		providerCalls: () => providerCalls,
		activeRunCount: () => activeRuns.size,
		capturedWireBody: () => {
			if (capturedWireBody === null) throw new TypeError("D731 wire body was not captured");
			return new Uint8Array(capturedWireBody);
		},
	});
}
