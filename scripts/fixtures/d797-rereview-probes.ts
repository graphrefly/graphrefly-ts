/** D808 shared probe scenarios; expected results belong to root spec/fixtures/d797-rereview.v1.json. */
import { type Ctx, graph, type Message, restoreGraph } from "../../packages/ts/src/index.js";

const values = (msgs: readonly Message[]) => msgs.flatMap((m) => (m[0] === "DATA" ? [m[1]] : []));

function stopProbes(): { observeStop: unknown[]; subscribeStop: unknown[] } {
	const g = graph();
	const source = g.state(0);
	const n = g.node(
		[source],
		(ctx) => {
			if (ctx.deps[0].value === 1) {
				ctx.emit(1);
				ctx.emit(2);
			}
		},
		{ name: "n" },
	);
	const observeStop: unknown[] = [],
		subscribeStop: unknown[] = [];
	const stopObserve = g.observe(["n"], ({ msgs }) => {
		const data = values(msgs);
		if (data.length) {
			observeStop.push(...data);
			stopObserve();
		}
	});
	const stopSubscribe = n.subscribe((msgs) => {
		const data = values(msgs);
		if (data.length) {
			subscribeStop.push(...data);
			stopSubscribe();
		}
	});
	source.set(1);
	return { observeStop, subscribeStop };
}

export function runRereviewProbes() {
	const qg = graph();
	const source = qg.state(0);
	const quiet = qg.node(
		[source],
		(ctx) => {
			if (ctx.deps[0].terminal) ctx.emit(99);
		},
		{ quiet: true },
	);
	let runs = 0;
	let waves: unknown[][] = [];
	let terminal = "none";
	const downstream = qg.node(
		[quiet],
		(ctx) => {
			runs++;
			waves = ctx.deps[0].waves.map((w) => [...w]);
			terminal = ctx.deps[0].terminal?.kind === "complete" ? "COMPLETE" : "none";
		},
		{ complete: "manual" },
	);
	const stopQuiet = downstream.subscribe(() => {});
	runs = 0;
	source.complete();
	const quietTerminal = { runs, waves, terminal };
	stopQuiet();

	const eg = graph();
	let emptyCtx!: Ctx;
	let arrays = 0;
	const empty = eg.node([], (ctx) => {
		emptyCtx = ctx;
	});
	const stopEmpty = empty.subscribe(() => arrays++);
	arrays = 0;
	emptyCtx.down([]);
	const emptyDown = { arrays };
	stopEmpty();

	const lg = graph();
	const bad = lg.state(0);
	let lateCtx!: Ctx;
	const late = lg.node([], (ctx) => {
		lateCtx = ctx;
	});
	const lateAfterCommitFailure: unknown[] = [];
	const stopLate = late.subscribe((msgs) => lateAfterCommitFailure.push(...values(msgs)));
	try {
		lg.batch(() => {
			bad.set(() => {
				throw new Error("commit fails");
			});
			lateCtx.emit(42);
		});
	} catch {
		/* The batch throws; the independent late request still runs. */
	}
	stopLate();

	const rg = graph();
	const replaceCleanup: unknown[] = [];
	const ledger = rg.state(0);
	const stopLedger = ledger.subscribe((msgs) => replaceCleanup.push(...values(msgs)));
	replaceCleanup.length = 0;
	const replaced = rg.node([], () => {}, {
		setup: (ctx) => {
			ctx.state.set(42);
			return () => ledger.set(ctx.state.get<number>()!);
		},
	});
	const stopReplaced = replaced.subscribe(() => {});
	rg.replace(replaced, [], () => {});
	stopReplaced();
	stopLedger();

	let reports = 0;
	const bg = graph({
		report: () => {
			reports++;
		},
	});
	const ended = bg.state(0);
	const other = bg.state(0);
	const batchTrigger = bg.state(0);
	let updaterRuns = 0;
	const stopBatchTrigger = batchTrigger.subscribe((msgs) => {
		if (!values(msgs).includes(1)) return;
		ended.complete();
		bg.batch(() => {
			other.set(() => {
				updaterRuns++;
				return 1;
			});
			ended.set(() => {
				updaterRuns++;
				return 1;
			});
		});
	});
	batchTrigger.set(1);
	const endedBatch = { updaterRuns, otherValue: other.cache, reports };
	stopBatchTrigger();

	const cg = graph();
	cg.node([], () => {}, { name: "n", recipe: { ref: "missing" } });
	let checkpointMissingRecipe = "accepted";
	try {
		restoreGraph(cg.checkpoint(), { registry: {} });
	} catch (error) {
		checkpointMissingRecipe = (error as Error).message;
	}
	return {
		quietTerminal,
		...stopProbes(),
		emptyDown,
		lateAfterCommitFailure,
		replaceCleanup,
		endedBatch,
		checkpointMissingRecipe,
	};
}

/** Same malformed checkpoint fields in each runtime; all errors identify node n. */
export function runCheckpointReasonProbes(): Record<string, string> {
	const g = graph();
	const source = g.state(1, { name: "source" });
	const fn = (ctx: Ctx) => ctx.emit(ctx.deps[0].value);
	const n = g.node([source], fn, { name: "n", recipe: { ref: "n" } });
	const stop = g.retain(n);
	const saved = g.checkpoint();
	stop();
	const registry = { n: { ref: "n", build: () => ({ fn }) } };
	const output: Record<string, string> = {};
	for (const reason of [
		"missingRecipe",
		"retainedValues",
		"receivedValues",
		"privateState",
		"recipeConfig",
		"errorPayload",
		"localOnly",
		"missingReceived",
	]) {
		const input = structuredClone(saved);
		const node = input.nodes.find((entry) => entry.id === "n")!;
		// Exactly representable in each host, outside the package strict JSON integer range.
		const nonJson = (2 ** 53) as never;
		switch (reason) {
			case "retainedValues":
				node.values = [nonJson];
				break;
			case "receivedValues":
				node.lifetime!.received[0].values = [nonJson];
				break;
			case "privateState":
				node.lifetime!.state = nonJson;
				break;
			case "recipeConfig":
				node.recipe!.config = nonJson;
				break;
			case "errorPayload":
				node.terminal = { kind: "ERROR", error: nonJson };
				break;
			case "localOnly":
				delete node.recipe;
				break;
			case "missingReceived":
				delete node.lifetime;
				break;
		}
		try {
			restoreGraph(input, { registry: reason === "missingRecipe" ? {} : registry });
			output[reason] = "accepted";
		} catch (error) {
			output[reason] = (error as Error).message;
		}
	}
	return output;
}
