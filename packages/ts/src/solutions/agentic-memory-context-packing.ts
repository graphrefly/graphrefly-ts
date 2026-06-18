import { depLatest } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import type { FactId } from "../patterns/semantic-memory.js";
import { solutionProjection } from "./agentic-memory-projection.js";
import {
	agenticStatusState,
	assertStrictJsonValue,
	errorMessage,
	freezeError,
	isNonEmptyString,
	isPlainRecord,
	safeArrayLength,
	validateRecordMetadata,
} from "./agentic-memory-shared.js";
import type {
	AgenticMemoryContextEntry,
	AgenticMemoryContextPackingBundle,
	AgenticMemoryContextPackingBundleOptions,
	AgenticMemoryContextPackingCursor,
	AgenticMemoryContextPackingError,
	AgenticMemoryContextPackingPolicy,
	AgenticMemoryContextPackingSnapshot,
	AgenticMemoryContextPackingStatus,
	AgenticMemoryContextText,
	AgenticMemoryPackedContext,
	AgenticMemoryPackedContextEntry,
	StrictJsonValue,
	ValidatedPackingContext,
} from "./agentic-memory-types.js";

export function agenticMemoryContextPackingBundle<T = unknown>(
	graph: Graph,
	opts: AgenticMemoryContextPackingBundleOptions<T>,
): AgenticMemoryContextPackingBundle<T> {
	const name = opts.name ?? "agenticMemoryContextPacking";
	const projection = graph.node<AgenticMemoryContextPackingSnapshot>(
		[opts.context, opts.texts, opts.policy],
		(ctx) => {
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			state.evaluation += 1;
			const packed = packContext(
				depLatest(ctx, 0),
				depLatest(ctx, 1),
				depLatest(ctx, 2),
				state.evaluation,
			);
			ctx.state.set(state);
			ctx.down([["DATA", packed]]);
		},
		{
			name: `${name}/projection`,
			factory: "agenticMemoryContextPacking",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input: { context: opts.context, texts: opts.texts, policy: opts.policy },
		projection,
		packedContext: solutionProjection(
			graph,
			projection,
			`${name}/packedContext`,
			"agenticMemoryPackedContext",
			(fact) => fact.packedContext,
		),
		status: solutionProjection(
			graph,
			projection,
			`${name}/status`,
			"agenticMemoryContextPackingStatus",
			(fact) => fact.status,
		),
		errors: solutionProjection(
			graph,
			projection,
			`${name}/errors`,
			"agenticMemoryContextPackingErrors",
			(fact) => fact.errors,
		),
		cursor: solutionProjection(
			graph,
			projection,
			`${name}/cursor`,
			"agenticMemoryContextPackingCursor",
			(fact) => fact.cursor,
		),
	};
}

function packContext(
	contextValue: unknown,
	textsValue: unknown,
	policyValue: unknown,
	evaluation: number,
): AgenticMemoryContextPackingSnapshot {
	const errors: Omit<AgenticMemoryContextPackingError, "cursor">[] = [];
	const context = validatePackingContext(contextValue, errors);
	const texts = validateContextTexts(textsValue, errors);
	const policy = validatePackingPolicy(policyValue, errors);
	const packedEntries: AgenticMemoryPackedContextEntry[] = [];
	let omittedEntries = 0;
	let totalChars = 0;
	let totalCost = 0;
	if (context !== undefined && policy !== undefined) {
		for (const entry of context.entries) {
			const textFact = texts.get(entry.fragmentId);
			if (textFact === undefined) {
				omittedEntries += 1;
				errors.push({
					code: "missing-text",
					message: "agenticMemoryContextPackingBundle: missing text projection for context entry",
					fragmentId: entry.fragmentId,
					validationErrors: [`missing text for fragment '${entry.fragmentId}'`],
				});
				continue;
			}
			const cost = textFact.cost ?? textFact.text.length;
			const nextEntries = packedEntries.length + 1;
			const separatorChars = packedEntries.length === 0 ? 0 : 2;
			const nextChars = totalChars + separatorChars + textFact.text.length;
			const nextCost = totalCost + cost;
			const exceeds =
				(policy.maxEntries !== undefined && nextEntries > policy.maxEntries) ||
				(policy.maxChars !== undefined && nextChars > policy.maxChars) ||
				(policy.maxCost !== undefined && nextCost > policy.maxCost);
			if (exceeds) {
				omittedEntries += 1;
				continue;
			}
			const packedEntry: AgenticMemoryPackedContextEntry = Object.freeze({
				fragmentId: entry.fragmentId,
				text: textFact.text,
				cost,
				chars: textFact.text.length,
				...(entry.record === undefined ? {} : { record: entry.record }),
				...(policy.includeMetadata && textFact.metadata !== undefined
					? { metadata: textFact.metadata }
					: {}),
			});
			packedEntries.push(packedEntry);
			totalChars = nextChars;
			totalCost = nextCost;
		}
	}
	const cursor: AgenticMemoryContextPackingCursor = Object.freeze({
		evaluation,
		inputEntries: context?.entries.length ?? 0,
		packedEntries: packedEntries.length,
		omittedEntries,
		totalChars,
		totalCost,
	});
	const errorFacts = Object.freeze(
		errors.map((error) =>
			freezeError({
				...error,
				cursor,
			}),
		),
	);
	const packedContext: AgenticMemoryPackedContext = Object.freeze({
		entries: Object.freeze(packedEntries),
		text: packedEntries.map((entry) => entry.text).join("\n\n"),
		totalChars,
		totalCost,
		truncated: omittedEntries > 0,
	});
	const status: AgenticMemoryContextPackingStatus = Object.freeze({
		state: agenticStatusState(errorFacts.length, packedEntries.length),
		cursor,
	});
	return Object.freeze({
		packedContext,
		status,
		errors: errorFacts,
		cursor,
	});
}

function validatePackingContext(
	value: unknown,
	errors: Omit<AgenticMemoryContextPackingError, "cursor">[],
): ValidatedPackingContext | undefined {
	if (!isPlainRecord(value)) {
		errors.push({
			code: "invalid-context",
			message: "agenticMemoryContextPackingBundle: context must be an AgenticMemoryContext fact",
			value,
		});
		return undefined;
	}
	let entriesValue: unknown;
	try {
		entriesValue = value.entries;
	} catch (error) {
		errors.push({
			code: "invalid-context",
			message: `agenticMemoryContextPackingBundle: context entries access failed: ${errorMessage(error)}`,
			value,
			validationErrors: ["context entries access failed"],
		});
		return undefined;
	}
	if (!Array.isArray(entriesValue)) {
		errors.push({
			code: "invalid-context",
			message: "agenticMemoryContextPackingBundle: context must be an AgenticMemoryContext fact",
			value,
			validationErrors: ["context.entries must be an array"],
		});
		return undefined;
	}
	const length = safeArrayLength(entriesValue);
	if (length === undefined) {
		errors.push({
			code: "invalid-context",
			message: "agenticMemoryContextPackingBundle: context entries length could not be read",
			value,
			validationErrors: ["context.entries length could not be read"],
		});
		return undefined;
	}
	const entries: AgenticMemoryContextEntry[] = [];
	for (let i = 0; i < length; i += 1) {
		let raw: unknown;
		try {
			raw = entriesValue[i];
			if (!isPlainRecord(raw) || !isNonEmptyString(raw.fragmentId)) {
				errors.push({
					code: "invalid-context",
					message: "agenticMemoryContextPackingBundle: context entry is invalid",
					index: i,
					value: raw,
					validationErrors: ["context entry fragmentId must be a non-empty string"],
				});
				continue;
			}
			const record = validateRecordMetadata(raw.record);
			if (!record.ok) {
				errors.push({
					code: "invalid-context",
					message: "agenticMemoryContextPackingBundle: context entry record metadata is invalid",
					index: i,
					fragmentId: raw.fragmentId,
					value: raw,
					validationErrors: Object.freeze(record.errors),
				});
				continue;
			}
			entries.push(
				Object.freeze({
					fragmentId: raw.fragmentId,
					...(record.metadata === undefined ? {} : { record: record.metadata }),
				}) as AgenticMemoryContextEntry,
			);
		} catch (error) {
			errors.push({
				code: "invalid-context",
				message: `agenticMemoryContextPackingBundle: context entry access failed: ${errorMessage(error)}`,
				index: i,
				value: raw,
				validationErrors: ["context entry access failed"],
			});
		}
	}
	return Object.freeze({
		entries: Object.freeze(entries),
	});
}

function validateContextTexts(
	value: unknown,
	errors: Omit<AgenticMemoryContextPackingError, "cursor">[],
): Map<FactId, AgenticMemoryContextText> {
	const out = new Map<FactId, AgenticMemoryContextText>();
	if (!Array.isArray(value)) {
		errors.push({
			code: "invalid-texts-input",
			message: "agenticMemoryContextPackingBundle: texts input must be an array",
			value,
		});
		return out;
	}
	const length = safeArrayLength(value);
	if (length === undefined) {
		errors.push({
			code: "invalid-texts-input",
			message: "agenticMemoryContextPackingBundle: texts input length could not be read",
			value,
		});
		return out;
	}
	for (let i = 0; i < length; i += 1) {
		try {
			const raw = value[i];
			const result = validateContextText(raw, i);
			if (result.error !== undefined) {
				errors.push(result.error);
				continue;
			}
			if (result.text === undefined) {
				errors.push({
					code: "invalid-text",
					message: "agenticMemoryContextPackingBundle: text fact is invalid",
					index: i,
					value: raw,
					validationErrors: ["text validation returned no fact"],
				});
				continue;
			}
			if (out.has(result.text.fragmentId)) {
				errors.push({
					code: "duplicate-text-fragment-id",
					message: "agenticMemoryContextPackingBundle: duplicate text fragment id",
					index: i,
					fragmentId: result.text.fragmentId,
					value: raw,
					validationErrors: [`duplicate text fragment id '${result.text.fragmentId}'`],
				});
				continue;
			}
			out.set(result.text.fragmentId, result.text);
		} catch (error) {
			errors.push({
				code: "invalid-text",
				message: `agenticMemoryContextPackingBundle: text access failed: ${errorMessage(error)}`,
				index: i,
				validationErrors: ["text access failed"],
			});
		}
	}
	return out;
}

function validateContextText(
	value: unknown,
	index: number,
): {
	readonly text?: AgenticMemoryContextText;
	readonly error?: Omit<AgenticMemoryContextPackingError, "cursor">;
} {
	if (!isPlainRecord(value)) {
		return {
			error: {
				code: "invalid-text",
				message: "agenticMemoryContextPackingBundle: text fact must be an object",
				index,
				value,
			},
		};
	}
	const errors: string[] = [];
	if (!isNonEmptyString(value.fragmentId)) errors.push("fragmentId must be a non-empty string");
	if (typeof value.text !== "string") errors.push("text must be a string");
	if (
		value.cost !== undefined &&
		(typeof value.cost !== "number" || !Number.isFinite(value.cost) || value.cost < 0)
	) {
		errors.push("cost must be a finite number >= 0");
	}
	if (value.metadata !== undefined) {
		try {
			if (!isPlainRecord(value.metadata)) {
				throw new TypeError("metadata must be a plain object when present");
			}
			assertStrictJsonValue(value.metadata, "metadata");
		} catch (error) {
			errors.push(errorMessage(error));
		}
	}
	if (errors.length > 0) {
		return {
			error: {
				code: "invalid-text",
				message: "agenticMemoryContextPackingBundle: text fact is invalid",
				index,
				fragmentId: typeof value.fragmentId === "string" ? value.fragmentId : undefined,
				value,
				validationErrors: Object.freeze(errors),
			},
		};
	}
	return {
		text: Object.freeze({
			fragmentId: value.fragmentId as string,
			text: value.text as string,
			...(value.cost === undefined ? {} : { cost: value.cost as number }),
			...(value.metadata === undefined
				? {}
				: { metadata: Object.freeze({ ...(value.metadata as Record<string, StrictJsonValue>) }) }),
		}),
	};
}

function validatePackingPolicy(
	value: unknown,
	errors: Omit<AgenticMemoryContextPackingError, "cursor">[],
): AgenticMemoryContextPackingPolicy | undefined {
	if (!isPlainRecord(value)) {
		errors.push({
			code: "invalid-policy",
			message: "agenticMemoryContextPackingBundle: policy must be an object",
			value,
		});
		return undefined;
	}
	const validation: string[] = [];
	let maxEntries: unknown;
	let maxChars: unknown;
	let maxCost: unknown;
	let includeMetadata: unknown;
	try {
		maxEntries = value.maxEntries;
		maxChars = value.maxChars;
		maxCost = value.maxCost;
		includeMetadata = value.includeMetadata;
	} catch (error) {
		errors.push({
			code: "invalid-policy",
			message: `agenticMemoryContextPackingBundle: policy access failed: ${errorMessage(error)}`,
			value,
			validationErrors: ["policy access failed"],
		});
		return undefined;
	}
	if (
		maxEntries !== undefined &&
		(typeof maxEntries !== "number" || !Number.isSafeInteger(maxEntries) || maxEntries < 0)
	) {
		validation.push("maxEntries must be a safe integer >= 0");
	}
	if (
		maxChars !== undefined &&
		(typeof maxChars !== "number" || !Number.isSafeInteger(maxChars) || maxChars < 0)
	) {
		validation.push("maxChars must be a safe integer >= 0");
	}
	if (
		maxCost !== undefined &&
		(typeof maxCost !== "number" || !Number.isFinite(maxCost) || maxCost < 0)
	) {
		validation.push("maxCost must be a finite number >= 0");
	}
	if (includeMetadata !== undefined && typeof includeMetadata !== "boolean") {
		validation.push("includeMetadata must be a boolean when present");
	}
	if (validation.length > 0) {
		errors.push({
			code: "invalid-policy",
			message: "agenticMemoryContextPackingBundle: policy is invalid",
			value,
			validationErrors: Object.freeze(validation),
		});
		return undefined;
	}
	return Object.freeze({
		...(maxEntries === undefined ? {} : { maxEntries: maxEntries as number }),
		...(maxChars === undefined ? {} : { maxChars: maxChars as number }),
		...(maxCost === undefined ? {} : { maxCost: maxCost as number }),
		...(includeMetadata === undefined ? {} : { includeMetadata: includeMetadata as boolean }),
	});
}
