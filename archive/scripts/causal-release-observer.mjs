/** R-only sample-local forwarding; D keeps the frozen observer. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createGaps } from "./causal-cleanup-observer.mjs";
export function createReleaseGaps(config, supplied) {
	assert.equal(config.releaseMode, "R");
	assert.equal(config.gapMode, "D");
	const api = supplied ?? { now: () => performance.now(), write: (p, s) => writeFileSync(p, s) };
	const base = createGaps(config, {
		now: api.now,
		write: (p, s) => {
			const state = JSON.parse(s);
			state.releaseMode = "R";
			api.write(p, JSON.stringify(state) + "\n");
		},
	});
	let active;
	const errors = () => active?.deep?.release?.failures?.map((s) => new Error(s)) ?? [];
	return {
		begin(c) {
			active = base.begin(c);
			return active;
		},
		deep(row) {
			const d = base.deep(row);
			d.release = {
				now: () => {
					try {
						return api.now();
					} catch (e) {
						(d.release.failures ??= []).push(String(e?.stack ?? e));
						return undefined;
					}
				},
			};
			return d;
		},
		fail(primary, ...rest) {
			base.fail(
				primary,
				...rest,
				...errors(),
				...(active?.deep?.failure ? [new Error(active.deep.failure)] : []),
			);
		},
		append(row, primary) {
			const failures = errors();
			if (failures.length)
				base.fail(primary, ...failures, ...(row.deep.failure ? [new Error(row.deep.failure)] : []));
			delete row.deep.release.now;
			base.append(row, primary);
			active = undefined;
		},
		finish(e) {
			return base.finish(e);
		},
	};
}
