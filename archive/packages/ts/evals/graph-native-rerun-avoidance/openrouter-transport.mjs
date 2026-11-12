// Package-private shared I/O and accounting. Admission, model selection and retry policy belong to callers.
export async function readBoundedResponseBytes(response, maxBytes, path, signal) {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
		throw new TypeError(`${path} byte bound was invalid`);
	const contentLength = response.headers.get("content-length");
	if (
		contentLength !== null &&
		(!/^\d+$/u.test(contentLength) || Number(contentLength) > maxBytes)
	) {
		void response.body?.cancel().catch(() => undefined);
		throw new TypeError(`${path} exceeded its content-length bound`);
	}
	if (response.body === null) throw new TypeError(`${path} body was unavailable`);
	const reader = response.body.getReader();
	const chunks = [];
	let total = 0;
	let bodyReadFailed = false;
	try {
		while (true) {
			signal?.throwIfAborted();
			let chunk;
			try {
				chunk = await abortable(reader.read(), signal);
			} catch (error) {
				bodyReadFailed = true;
				throw error;
			}
			const { done, value } = chunk;
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				void reader.cancel().catch(() => undefined);
				throw new TypeError(`${path} exceeded its streaming byte bound`);
			}
			chunks.push(value);
		}
	} catch (cause) {
		void reader.cancel().catch(() => undefined);
		const error = new TypeError(
			cause instanceof Error ? cause.message : `${path} body read failed`,
			{ cause },
		);
		error.partialBytes = concatenate(chunks);
		error.bodyReadFailed = bodyReadFailed;
		throw error;
	} finally {
		reader.releaseLock();
	}
	return concatenate(chunks);
}

function concatenate(chunks) {
	const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function object(value, path) {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${path} must be an object`);
	return value;
}
function safeInteger(value, path) {
	if (!Number.isSafeInteger(value) || value < 0)
		throw new TypeError(`${path} must be a non-negative safe integer`);
	return value;
}
export function providerReportedCost(root) {
	const usage = object(root.usage, "provider usage");
	if (typeof usage.cost !== "number" || !Number.isFinite(usage.cost) || usage.cost < 0)
		throw new TypeError("provider usage.cost must be a non-negative finite number");
	const exactProviderCostMicrousd = usage.cost * 1_000_000;
	if (
		!Number.isFinite(exactProviderCostMicrousd) ||
		exactProviderCostMicrousd < 0 ||
		exactProviderCostMicrousd > Number.MAX_SAFE_INTEGER
	)
		throw new TypeError("provider usage.cost exceeded safe microusd bounds");
	const costMicrousd = Math.ceil(exactProviderCostMicrousd);
	return Object.freeze({
		exactProviderCostMicrousd,
		costMicrousd,
		pricingRoundingAllowanceMicrousd:
			costMicrousd === Math.floor(exactProviderCostMicrousd) ? 0 : 1,
	});
}

export function parseOpenRouterUsage(root) {
	const usage = object(root.usage, "provider usage");
	const input = safeInteger(usage.prompt_tokens, "provider usage.prompt_tokens");
	const output = safeInteger(usage.completion_tokens, "provider usage.completion_tokens");
	if (safeInteger(usage.total_tokens, "provider usage.total_tokens") !== input + output)
		throw new TypeError("provider usage total drifted");
	const details =
		usage.prompt_tokens_details === undefined
			? undefined
			: object(usage.prompt_tokens_details, "provider usage.prompt_tokens_details");
	const cached =
		details?.cached_tokens === undefined
			? 0
			: safeInteger(details.cached_tokens, "provider usage.cached_tokens");
	if (cached > input) throw new TypeError("provider cached token usage exceeded input usage");
	return Object.freeze({ input, output, total: input + output, cached });
}
export function auditProviderReportedCost(root, pricing, cost = providerReportedCost(root)) {
	const { input, output, cached } = parseOpenRouterUsage(root);

	const numerators = [
		(input - cached) * pricing.inputMicrousdPerMillionTokens,
		cached * pricing.cacheReadMicrousdPerMillionTokens,
		output * pricing.outputMicrousdPerMillionTokens,
	];
	if (numerators.some((numerator) => !Number.isSafeInteger(numerator) || numerator < 0))
		throw new TypeError("provider usage pricing arithmetic exceeded safe integer bounds");
	const numeratorTotal = numerators.reduce((total, numerator) => total + numerator, 0);
	if (!Number.isSafeInteger(numeratorTotal))
		throw new TypeError("provider usage pricing arithmetic exceeded safe integer bounds");
	const tokenPricingAuditMicrousd = numeratorTotal / 1_000_000;
	if (Math.abs(tokenPricingAuditMicrousd - cost.exactProviderCostMicrousd) > 1e-6)
		throw new TypeError("provider usage.cost disagreed with the admitted route pricing audit");

	return Object.freeze({
		input,
		output,
		total: input + output,
		cached,
		tokenPricingAuditMicrousd,
	});
}

/** Exactly one explicitly supplied request; never consults environment or retries. */
export async function requestOpenRouter({
	endpoint,
	apiKey,
	body,
	signal,
	maxResponseBytes,
	fetchImpl = globalThis.fetch,
}) {
	const url = new URL(endpoint);
	if (url.protocol !== "https:" || url.username || url.password || url.hash)
		throw new TypeError(
			"OpenRouter endpoint must be an explicit HTTPS URL without credentials or fragment",
		);
	if (typeof apiKey !== "string" || !apiKey || /[\r\n]/u.test(apiKey))
		throw new TypeError("OpenRouter key must be explicitly supplied");
	if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1)
		throw new TypeError("OpenRouter byte bound invalid");
	object(body, "OpenRouter request body");
	if (body.stream === true)
		throw new TypeError("OpenRouter shared transport requires non-streaming responses");
	signal?.throwIfAborted();
	const response = await abortable(
		fetchImpl(endpoint, {
			method: "POST",
			redirect: "error",
			cache: "no-store",
			credentials: "omit",
			referrerPolicy: "no-referrer",
			headers: {
				authorization: `Bearer ${apiKey}`,
				"content-type": "application/json",
				accept: "application/json",
			},
			body: JSON.stringify(body),
			signal,
		}),
		signal,
	);
	const metadata = {
		status: response.status,
		url: response.url,
		headers: Object.fromEntries(response.headers.entries()),
	};
	let bytes = new Uint8Array();
	let bodyText = "";
	try {
		if (response.redirected || response.url !== endpoint) {
			void response.body?.cancel().catch(() => undefined);
			throw new TypeError("OpenRouter response route drifted");
		}
		bytes = await readBoundedResponseBytes(
			response,
			maxResponseBytes,
			"OpenRouter response",
			signal,
		);
		bodyText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		const json = JSON.parse(bodyText);
		const receipt = { ...metadata, bytes, bodyText, json };
		if (!response.ok)
			throw new OpenRouterTransportError("OpenRouter HTTP response failed", receipt);
		return receipt;
	} catch (error) {
		if (error instanceof OpenRouterTransportError) throw error;
		if (error?.partialBytes instanceof Uint8Array) bytes = error.partialBytes;
		if (!bodyText) bodyText = new TextDecoder().decode(bytes);
		throw new OpenRouterTransportError(
			"OpenRouter response was not accepted",
			{ ...metadata, bytes, bodyText, json: null },
			error,
		);
	}
}

export class OpenRouterTransportError extends Error {
	constructor(message, receipt, cause) {
		super(message, { cause });
		this.name = "OpenRouterTransportError";
		this.receipt = receipt;
		this.bodyReadFailed = cause?.bodyReadFailed === true;
	}
}

function abortable(promise, signal) {
	if (!signal) return promise;
	return new Promise((resolve, reject) => {
		const abort = () => reject(signal.reason ?? new Error("OpenRouter request aborted"));
		signal.addEventListener("abort", abort, { once: true });
		Promise.resolve(promise)
			.then(resolve, reject)
			.finally(() => signal.removeEventListener("abort", abort));
		if (signal.aborted) abort();
	});
}
