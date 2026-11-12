/** Private phase observer; no consumer import, no observation at module load. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { isMainThread, threadId } from "node:worker_threads";

export function createObserver(config, supplied) {
	const api = supplied ?? {
		now: () => performance.now(),
		hr: () => process.hrtime.bigint().toString(),
		thread: () => process.threadCpuUsage(),
		resources: () => process.resourceUsage(),
		begin: (name) => console.time(name),
		end: (name) => console.timeEnd(name),
		write: (name, value) => writeFileSync(name, JSON.stringify(value, null, 2) + "\n"),
		identity: {
			pid: process.pid,
			node: process.version,
			v8: process.versions.v8,
			isMainThread,
			threadId,
		},
	};
	assert.ok(["Q", "T"].includes(config.mode));
	assert.ok(["fixture", "consumer"].includes(config.profile));
	assert.equal(api.identity.isMainThread, true);
	assert.equal(api.identity.threadId, 0);
	const names =
		config.profile === "fixture"
			? ["empty", "cpu", "yield"]
			: Array.from({ length: 6 }, (_, block) =>
					["warmup", "measured"].map((phase) => `b${Math.floor(block / 2)}s${block % 2}-${phase}`),
				).flat();
	const state = {
		identity: {
			run: config.run,
			pid: api.identity.pid,
			node: api.identity.node,
			v8: api.identity.v8,
			sourceDigest: config.sourceDigest,
		},
		mode: config.mode,
		profile: config.profile,
		orientation: config.orientation ?? null,
		units: "performance-ms/hrtime-ns/trace-us",
		cpuUnits: "microseconds",
		thread: { isMainThread: true, threadId: 0 },
		anchors: [],
		windows: [],
		active: null,
		complete: false,
	};
	function anchor() {
		const p0 = api.now(),
			h = api.hr(),
			p1 = api.now();
		state.anchors.push({ p0, h, p1 });
	}
	function snapshot() {
		const p0 = api.now(),
			thread = api.thread(),
			resources = api.resources(),
			p1 = api.now();
		return { p0, thread, process: resources, p1 };
	}
	return {
		start(name) {
			assert.equal(state.active, null);
			assert.equal(name, names[state.windows.length]);
			if (config.mode === "T" && state.windows.length === 0) anchor();
			const active = { name };
			state.active = active;
			if (config.mode === "T") {
				const h0 = api.hr();
				api.begin(`${config.run}:${name}`);
				active.begin = [h0, api.hr()];
			}
			active.before = snapshot();
			active.start = active.before.p1;
		},
		end(name) {
			const active = state.active;
			assert.equal(active?.name, name);
			active.after = snapshot();
			active.end = active.after.p0;
			if (config.mode === "T") {
				const h0 = api.hr();
				api.end(`${config.run}:${name}`);
				active.finish = [h0, api.hr()];
			}
			state.windows.push(active);
			state.active = null;
			const middle = config.profile === "fixture" ? 2 : 6;
			if (config.mode === "T" && [middle, names.length].includes(state.windows.length)) anchor();
		},
		finish(error = null) {
			state.complete =
				error === null && state.active === null && state.windows.length === names.length;
			state.error = error === null ? null : String(error?.stack ?? error);
			api.write(`${config.output}/evidence.json`, state);
			if (error === null) assert.ok(state.complete, "complete observation phases");
			return state;
		},
	};
}
