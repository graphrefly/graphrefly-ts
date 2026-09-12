/** Private diagnostic sidecar; no Graph imports or consumer execution on import. */
import assert from "node:assert/strict";
import { PerformanceObserver, performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";

export function createObservation(
	condition,
	orientation,
	io = {
		now: () => performance.now(),
		cpu: () => process.cpuUsage(),
		Observer: PerformanceObserver,
		tick: () => setImmediate(),
	},
) {
	assert.ok(["CPU", "CPU_GC"].includes(condition));
	assert.ok(["U", "V"].includes(orientation));
	const data = {
		condition,
		orientation,
		checkpoints: [],
		gc: [],
		disconnectAt: null,
		observerInstalled: condition === "CPU_GC",
	};
	let fault,
		observer,
		finished = false;
	const collect = (entries) => {
		try {
			for (const entry of entries) {
				assert.ok(data.gc.length < 100000, "GC buffer limit");
				const receivedAt = io.now();
				const { startTime, duration } = entry;
				assert.ok([startTime, duration, receivedAt].every((x) => Number.isFinite(x) && x >= 0));
				assert.ok(startTime + duration <= receivedAt, "GC event beyond receipt");
				const { kind, flags } = entry.detail;
				assert.ok(Number.isInteger(kind) && kind >= 0 && Number.isInteger(flags) && flags >= 0);
				data.gc.push({ startTime, duration, receivedAt, kind, flags });
			}
		} catch (error) {
			fault ??= error;
			try {
				observer?.disconnect();
			} catch (cleanup) {
				fault = new AggregateError([fault, cleanup], "observer disconnect failure");
			}
		}
	};
	if (condition === "CPU_GC") {
		assert.ok(io.Observer.supportedEntryTypes.includes("gc"), "GC channel unavailable");
		observer = new io.Observer((list) => collect(list.getEntries()));
		observer.observe({ entryTypes: ["gc"] });
	}
	return {
		check() {
			if (fault) throw fault;
		},
		checkpoint(batch, arm, edge) {
			assert.ok(!finished);
			if (fault) throw fault;
			const wallBefore = io.now(),
				{ user, system } = io.cpu(),
				wallAfter = io.now();
			assert.ok(Number.isFinite(wallBefore) && wallBefore >= 0 && wallAfter >= wallBefore);
			assert.ok(
				Number.isSafeInteger(user) && user >= 0 && Number.isSafeInteger(system) && system >= 0,
			);
			data.checkpoints.push({ batch, arm, edge, wallBefore, wallAfter, user, system });
		},
		async finish() {
			assert.ok(!finished);
			finished = true;
			try {
				if (observer) {
					await io.tick();
					await io.tick();
					collect(observer.takeRecords());
				}
			} catch (error) {
				fault = fault ? new AggregateError([fault, error], "observation failures") : error;
			} finally {
				try {
					observer?.disconnect();
					if (observer) data.disconnectAt = io.now();
				} catch (error) {
					fault = fault ? new AggregateError([fault, error], "observation failures") : error;
				}
			}
			return { data, fault };
		},
	};
}
