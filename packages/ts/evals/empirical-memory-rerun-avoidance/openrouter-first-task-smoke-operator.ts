import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
	createOpenRouterCredentialCapabilityFromOperatorEnvironment,
	runOpenRouterFirstTaskSmoke,
} from "./openrouter-first-task-smoke.js";
import { createOpenRouterResponsesFetchByteTransport } from "./openrouter-responses-byte-transport.js";
import { validateOperatorSuppliedOpenRouterRouteQualification } from "./openrouter-route-qualification.js";

export interface OpenRouterFirstTaskSmokeOperatorInputV1 {
	readonly host: Parameters<typeof runOpenRouterFirstTaskSmoke>[0]["host"];
	readonly routeQualification: unknown;
	readonly privateRoot: string;
	readonly generationRef: string;
}

export interface OpenRouterFirstTaskSmokeOperatorInputModuleV1 {
	createOperatorInput(): Promise<OpenRouterFirstTaskSmokeOperatorInputV1>;
}

export function readOpenRouterSmokeOperatorMonotonicMs(): number {
	return Math.floor(performance.now());
}

function isSameOrDescendant(parent: string, candidate: string): boolean {
	const nested = relative(parent, candidate);
	return nested === "" || (nested !== ".." && !nested.startsWith(`..${sep}`));
}

async function loadOperatorInputModule(
	modulePath: string,
	privateRoot: string,
): Promise<OpenRouterFirstTaskSmokeOperatorInputV1> {
	if (!isAbsolute(modulePath)) {
		throw new TypeError("OpenRouter smoke operator input module path must be absolute");
	}
	const canonicalModulePath = await realpath(modulePath);
	const canonicalPrivateRoot = await realpath(privateRoot);
	if (!isSameOrDescendant(canonicalPrivateRoot, canonicalModulePath)) {
		throw new TypeError("OpenRouter smoke operator input module must remain operator-private");
	}
	const loaded = (await import(
		pathToFileURL(canonicalModulePath).href
	)) as Partial<OpenRouterFirstTaskSmokeOperatorInputModuleV1>;
	if (typeof loaded.createOperatorInput !== "function") {
		throw new TypeError("OpenRouter smoke operator input module has no factory");
	}
	return loaded.createOperatorInput();
}

/**
 * Outermost package-private CLI boundary. It is the only committed B112 code
 * that reads the supplied process environment snapshot and constructs live
 * fetch/timeout capabilities.
 */
export async function runOpenRouterFirstTaskSmokeOperator(input: {
	readonly modulePath: string;
	readonly privateRoot: string;
	readonly environment: Readonly<Record<string, string | undefined>>;
	readonly fetch: typeof fetch;
	readonly monotonicNowMs: () => number;
}): Promise<Awaited<ReturnType<typeof runOpenRouterFirstTaskSmoke>>> {
	const operatorInput = await loadOperatorInputModule(input.modulePath, input.privateRoot);
	if (operatorInput.privateRoot !== input.privateRoot) {
		throw new TypeError("OpenRouter smoke operator input changed private artifact ownership");
	}
	const configurationRef = operatorInput.host.initialRequest.configurationRef;
	const qualifiedRoute = validateOperatorSuppliedOpenRouterRouteQualification(
		operatorInput.routeQualification,
		operatorInput.host.frozen,
		operatorInput.host.qualificationReport,
		configurationRef,
	);
	const credential = createOpenRouterCredentialCapabilityFromOperatorEnvironment(
		input.environment,
		qualifiedRoute.qualification,
	);
	return runOpenRouterFirstTaskSmoke({
		...operatorInput,
		routeQualification: qualifiedRoute.qualification,
		credential,
		transport: createOpenRouterResponsesFetchByteTransport({ fetch: input.fetch }),
		monotonicMeasurement: { readMs: input.monotonicNowMs },
		executionClass: "live-provider",
		signal: AbortSignal.timeout(qualifiedRoute.qualification.budget.maxLatencyMs),
	});
}

async function main(): Promise<void> {
	const modulePath = process.argv[2];
	const privateRoot = process.argv[3];
	if (modulePath === undefined || privateRoot === undefined || process.argv.length !== 4) {
		throw new TypeError(
			"usage: openrouter-first-task-smoke-operator <absolute-input-module> <absolute-private-root>",
		);
	}
	const result = await runOpenRouterFirstTaskSmokeOperator({
		modulePath,
		privateRoot,
		environment: process.env,
		fetch: globalThis.fetch,
		monotonicNowMs: readOpenRouterSmokeOperatorMonotonicMs,
	});
	process.stdout.write(
		`${JSON.stringify({
			generationDigest: result.persistence.generationDigest,
			observationDigest: result.persistence.observationDigest,
			scorecardDigest: result.persistence.scorecardDigest,
			status: result.scorecard.status,
			admissionRejection: result.admissionRejection,
		})}\n`,
	);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(() => {
		process.stderr.write("OpenRouter first-task smoke failed closed\n");
		process.exitCode = 1;
	});
}
