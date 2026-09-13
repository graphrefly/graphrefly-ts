/** External action boundaries, also loaded unchanged with countable fake hosts. */
export function sample(mod, row, scenario, expected, now) {
	const clocks = [];
	let run,
		releaseAttempted = false,
		releaseCompleted = false,
		error;
	let snapshot, before, after, rejected;
	const tick = () => {
		const value = now();
		clocks.push(value);
		return value;
	};
	try {
		if (row === "P2-lifecycle") {
			const action = mod.duplicate(scenario);
			tick();
			run = mod.candidate();
			tick();
			tick();
			for (const step of scenario.steps) run.send(step);
			tick();
			before = mod.occurrence(run);
			tick();
			for (const step of action) run.send(step);
			tick();
			after = mod.occurrence(run);
			snapshot = mod.graphSnapshot(run);
			tick();
			releaseAttempted = true;
			run.cleanup();
			releaseCompleted = true;
			tick();
			mod.validate(run, snapshot, expected, before, after);
		} else {
			run = mod.micro(row);
			tick();
			releaseAttempted = true;
			try {
				run.release();
				releaseCompleted = true;
			} catch (e) {
				rejected = e;
			}
			tick();
			run.validate(rejected);
		}
	} catch (e) {
		error = e;
	}
	// Cleanup even on failed clock/capture/validation. Never repeat a completed release.
	let cleanupError;
	try {
		if (run && (row !== "P2-lifecycle" || !releaseAttempted)) run.cleanup();
		if (run && row !== "P2-lifecycle") run.finished();
	} catch (e) {
		cleanupError = e;
	}
	if (error || cleanupError)
		throw new AggregateError(
			[error, cleanupError].filter(Boolean),
			"sample failed; cleanup retained",
		);
	if (
		clocks.length !== (row === "P2-lifecycle" ? 8 : 2) ||
		clocks.some((x, i) => !Number.isFinite(x) || (i && x < clocks[i - 1]))
	)
		throw Error("invalid clock sequence");
	return {
		clocks,
		outcome: row === "active-diamond-5" ? "rejected-then-cleaned" : "released",
		releaseCompleted,
		before,
		after,
		snapshot,
	};
}
export function coordinates(variant) {
	if (variant !== "U" && variant !== "V") throw Error("variant");
	const out = [];
	for (let block = 0; block < 1; block++)
		for (let position = 0; position < 2; position++) {
			const slot = (block + position + (variant === "V" ? 1 : 0)) % 2;
			for (let index = 0; index < 70; index++)
				out.push({ block, position, slot, index, phase: index < 20 ? "warmup" : "measured" });
		}
	return out;
}
