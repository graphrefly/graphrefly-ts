/**
 * Recipe factories for the built-in operators, combinators and sources (R-checkpoint@1,
 * graphrefly:D802; TS layout graphrefly-ts:D178).
 *
 * Each operator below sets `recipe: { ref, config }` on the node it builds, where `config` holds
 * only the operator's JSON parameters; the factory registered here under the same `ref` rebuilds
 * the identical function and setup from that configuration. An operator whose parameter is a
 * function or a host object (a predicate, a reducer, an abort signal) carries no recipe and stays
 * local-only. No storage I/O.
 */

import type { GraphCheckpointJson } from "./checkpoint.js";
import {
	buffer,
	bufferCount,
	combine,
	concat,
	takeUntil,
	withLatestFrom,
	zip,
} from "./combinators.js";
import { elementAt, merge, type Operator, operatorNodeFn, pairwise, skip } from "./operators.js";
import type { GraphRecipeBuild, GraphRecipeFactory, GraphRestoreEntry } from "./restore.js";
import { empty, fromTimer, interval, never, of } from "./sources.js";

function objectConfig(
	config: GraphCheckpointJson | undefined,
	ref: string,
): Record<string, GraphCheckpointJson> {
	if (
		config === undefined ||
		config === null ||
		Array.isArray(config) ||
		typeof config !== "object"
	) {
		throw new Error(`restoreGraph: '${ref}' recipe requires an object config`);
	}
	return config as Record<string, GraphCheckpointJson>;
}

function finiteNumber(value: GraphCheckpointJson | undefined, ref: string, key: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`restoreGraph: '${ref}' config.${key} must be a finite number`);
	}
	return value;
}

/** The function and setup an operator gives its node. */
function built(op: Operator<never, unknown> | Operator<unknown, unknown>): GraphRecipeBuild {
	const setup = op.opts?.setup;
	return setup === undefined ? { fn: operatorNodeFn(op) } : { fn: operatorNodeFn(op), setup };
}

/** A recipe whose operator takes no parameters: it accepts no configuration. */
function noConfig(ref: string, make: () => Operator<never, unknown> | Operator<unknown, unknown>) {
	const factory: GraphRecipeFactory<undefined> = {
		ref,
		validateConfig(config) {
			if (config !== undefined) {
				throw new Error(`restoreGraph: '${ref}' recipe does not accept config`);
			}
			return undefined;
		},
		build() {
			return built(make());
		},
	};
	return factory;
}

/** A recipe whose operator takes one number, saved as `config[key]`. */
function numberConfig(
	ref: string,
	key: string,
	make: (n: number) => Operator<never, unknown> | Operator<unknown, unknown>,
) {
	const factory: GraphRecipeFactory<{ n: number }> = {
		ref,
		validateConfig(config) {
			return { n: finiteNumber(objectConfig(config, ref)[key], ref, key) };
		},
		build(config) {
			return built(make(config.n));
		},
	};
	return factory;
}

export const skipRestoreDescriptor = numberConfig("skip", "n", (n) => skip(n));
export const elementAtRestoreDescriptor = numberConfig("elementAt", "index", (i) => elementAt(i));
export const mergeRestoreDescriptor = noConfig("merge", () => merge());
export const pairwiseRestoreDescriptor = noConfig("pairwise", () => pairwise());
export const combineRestoreDescriptor = noConfig("combine", () => combine());
export const withLatestFromRestoreDescriptor = noConfig("withLatestFrom", () => withLatestFrom());
export const takeUntilRestoreDescriptor = noConfig("takeUntil", () => takeUntil());
export const zipRestoreDescriptor = noConfig("zip", () => zip());
export const concatRestoreDescriptor = noConfig("concat", () => concat());
export const bufferRestoreDescriptor = noConfig("buffer", () => buffer());
export const bufferCountRestoreDescriptor = numberConfig("bufferCount", "count", (count) =>
	bufferCount(count),
);
export const intervalRestoreDescriptor = numberConfig("interval", "ms", (ms) => interval(ms));
export const emptyRestoreDescriptor = noConfig("empty", () => empty());
export const neverRestoreDescriptor = noConfig("never", () => never());

type FromTimerConfig = { ms: number; period?: number };

export const fromTimerRestoreDescriptor: GraphRecipeFactory<FromTimerConfig> = {
	ref: "fromTimer",
	validateConfig(config) {
		const obj = objectConfig(config, "fromTimer");
		const ms = finiteNumber(obj.ms, "fromTimer", "ms");
		if (obj.period === undefined) return { ms };
		return { ms, period: finiteNumber(obj.period, "fromTimer", "period") };
	},
	build(config) {
		return built(
			fromTimer(config.ms, config.period === undefined ? undefined : { period: config.period }),
		);
	},
};

type OfConfig = { values: readonly GraphCheckpointJson[] };

export const ofRestoreDescriptor: GraphRecipeFactory<OfConfig> = {
	ref: "of",
	validateConfig(config) {
		const values = objectConfig(config, "of").values;
		if (!Array.isArray(values)) {
			throw new Error("restoreGraph: 'of' config.values must be an array");
		}
		return { values };
	},
	build(config) {
		return built(of(...config.values));
	},
};

/** The recipe factories of the built-in operators, combinators and sources, keyed by ref. */
export const operatorRestoreRegistry: Readonly<Record<string, GraphRestoreEntry>> = {
	skip: skipRestoreDescriptor,
	elementAt: elementAtRestoreDescriptor,
	merge: mergeRestoreDescriptor,
	pairwise: pairwiseRestoreDescriptor,
	combine: combineRestoreDescriptor,
	withLatestFrom: withLatestFromRestoreDescriptor,
	takeUntil: takeUntilRestoreDescriptor,
	zip: zipRestoreDescriptor,
	concat: concatRestoreDescriptor,
	buffer: bufferRestoreDescriptor,
	bufferCount: bufferCountRestoreDescriptor,
	interval: intervalRestoreDescriptor,
	fromTimer: fromTimerRestoreDescriptor,
	of: ofRestoreDescriptor,
	empty: emptyRestoreDescriptor,
	never: neverRestoreDescriptor,
};
