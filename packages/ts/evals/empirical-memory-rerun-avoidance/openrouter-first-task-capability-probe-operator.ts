import { pathToFileURL } from "node:url";
import { runOpenRouterFirstTaskCapabilityProbe } from "./openrouter-first-task-capability-probe.js";
import {
	createOpenRouterCredentialCapabilityFromOperatorEnvironment,
	OPENROUTER_API_KEY_ENVIRONMENT_NAME,
} from "./openrouter-first-task-smoke.js";
import {
	loadOpenRouterFirstTaskSmokeOperatorInput,
	type OpenRouterFirstTaskSmokeOperatorInputV1,
	readOpenRouterSmokeOperatorMonotonicMs,
} from "./openrouter-first-task-smoke-operator.js";
import { createOpenRouterResponsesFetchByteTransport } from "./openrouter-responses-byte-transport.js";
import { validateOperatorSuppliedOpenRouterRouteQualification } from "./openrouter-route-qualification.js";

export async function runOpenRouterFirstTaskCapabilityProbeOperator(input: {
	readonly modulePath: string;
	readonly privateRoot: string;
	readonly environment: Readonly<Record<string, string | undefined>>;
	readonly fetch: typeof fetch;
	readonly monotonicNowMs: () => number;
}): Promise<Awaited<ReturnType<typeof runOpenRouterFirstTaskCapabilityProbe>>> {
	const operatorInput = await loadOpenRouterFirstTaskSmokeOperatorInput(
		input.modulePath,
		input.privateRoot,
	);
	return runLoadedOpenRouterFirstTaskCapabilityProbeOperator({ ...input, operatorInput });
}

export async function runLoadedOpenRouterFirstTaskCapabilityProbeOperator(input: {
	readonly operatorInput: OpenRouterFirstTaskSmokeOperatorInputV1;
	readonly privateRoot: string;
	readonly environment: Readonly<Record<string, string | undefined>>;
	readonly fetch: typeof fetch;
	readonly monotonicNowMs: () => number;
}): Promise<Awaited<ReturnType<typeof runOpenRouterFirstTaskCapabilityProbe>>> {
	let result: Awaited<ReturnType<typeof runOpenRouterFirstTaskCapabilityProbe>> | null = null;
	let executionError: unknown = null;
	let cleanupFailed = false;
	try {
		if (input.operatorInput.privateRoot !== input.privateRoot) {
			throw new TypeError("OpenRouter capability probe input changed private artifact ownership");
		}
		const qualifiedRoute = validateOperatorSuppliedOpenRouterRouteQualification(
			input.operatorInput.routeQualification,
			input.operatorInput.host.frozen,
			input.operatorInput.host.qualificationReport,
			input.operatorInput.host.initialRequest.configurationRef,
		);
		const credential = createOpenRouterCredentialCapabilityFromOperatorEnvironment(
			input.environment,
			qualifiedRoute.qualification,
		);
		result = await runOpenRouterFirstTaskCapabilityProbe({
			frozen: input.operatorInput.host.frozen,
			qualificationReport: input.operatorInput.host.qualificationReport,
			request: input.operatorInput.host.initialRequest,
			routeQualification: qualifiedRoute.qualification,
			credential,
			transport: createOpenRouterResponsesFetchByteTransport({ fetch: input.fetch }),
			monotonicMeasurement: { readMs: input.monotonicNowMs },
			executionClass: "live-provider",
			signal: AbortSignal.timeout(
				Math.min(qualifiedRoute.qualification.budget.maxLatencyMs, 120_000),
			),
		});
	} catch (error) {
		executionError = error;
	} finally {
		try {
			await input.operatorInput.host.materialization.cleanup();
		} catch {
			cleanupFailed = true;
		}
	}
	if (cleanupFailed) {
		throw new TypeError("OpenRouter capability probe workspace cleanup failed");
	}
	if (executionError !== null) throw executionError;
	if (result === null) throw new TypeError("OpenRouter capability probe produced no result");
	return result;
}

async function main(): Promise<void> {
	const modulePath = process.argv[2];
	const privateRoot = process.argv[3];
	if (modulePath === undefined || privateRoot === undefined || process.argv.length !== 4) {
		throw new TypeError(
			"usage: openrouter-first-task-capability-probe-operator <absolute-input-module> <absolute-private-root>",
		);
	}
	const result = await runOpenRouterFirstTaskCapabilityProbeOperator({
		modulePath,
		privateRoot,
		environment: process.env,
		fetch: globalThis.fetch,
		monotonicNowMs: readOpenRouterSmokeOperatorMonotonicMs,
	});
	process.stdout.write(`${JSON.stringify(result)}\n`);
	if (!result.capable) process.exitCode = 2;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(() => {
		process.stderr.write(
			`OpenRouter first-task capability probe failed closed; verify ${OPENROUTER_API_KEY_ENVIRONMENT_NAME} only in the operator environment\n`,
		);
		process.exitCode = 1;
	});
}
