/** Sample-scoped private sidecars, no graph state or registry. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
export function createGaps(
	config,
	api = { now: () => performance.now(), write: (p, s) => writeFileSync(p, s) },
) {
	assert.ok(["S", "D"].includes(config.gapMode));
	const state = {
		identity: { run: config.run, pid: process.pid, sourceDigest: config.sourceDigest },
		cpuMode: "Q",
		gapMode: config.gapMode,
		units: "performance-ms",
		samples: [],
		active: null,
		complete: false,
	};
	return {
		begin(coordinate) {
			assert.equal(state.active, null);
			assert.ok(state.samples.length < 2400);
			const row = { ...coordinate };
			state.active = row;
			return row;
		},
		deep(row) {
			assert.equal(state.active, row);
			if (config.gapMode === "S") return undefined;
			row.deep = {
				now: () => {
					try {
						return api.now();
					} catch (error) {
						row.deep.failure = String(error?.stack ?? error);
						return undefined;
					}
				},
			};
			return row.deep;
		},
		fail(primary, ...errors) {
			throw new AggregateError(
				[primary, ...errors].filter((e) => e !== undefined),
				"sample and diagnostic cleanup failures",
			);
		},
		append(row, primary) {
			assert.equal(state.active, row);
			if (row.deep?.failure)
				throw new AggregateError(
					[primary, new Error(row.deep.failure)].filter((e) => e !== undefined),
					"sample and deep observation failures",
				);
			if (row.deep) delete row.deep.now;
			state.samples.push(row);
			state.active = null;
		},
		finish(error = null) {
			state.complete = error === null && state.active === null && state.samples.length === 2400;
			state.error = error === null ? null : String(error?.stack ?? error);
			api.write(`${config.output}/gaps.json`, JSON.stringify(state) + "\n");
			if (error === null) assert.ok(state.complete);
			return state;
		},
	};
}
export function finishBoth(observer, gaps, primary) {
	const errors = primary === null ? [] : [primary];
	for (const object of [observer, gaps])
		try {
			object.finish(primary);
		} catch (error) {
			errors.push(error);
		}
	if (errors.length > (primary === null ? 0 : 1))
		throw new AggregateError(errors, "consumer and diagnostic finalization");
}
