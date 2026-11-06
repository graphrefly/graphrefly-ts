/** B121-private runtime loading; no installed/dist build can silently change the evaluated controller. */
import { tsImport } from "../../../../node_modules/tsx/dist/esm/api/index.mjs";

const runtime = await tsImport("../../src/graph/graph.ts", import.meta.url);
const ctx = await tsImport("../../src/ctx/types.ts", import.meta.url);
const operators = await tsImport("../../src/operators/index.ts", import.meta.url);
const boundaries = await tsImport(
	"../graph-native-rerun-avoidance/quiet-data-boundary.ts",
	import.meta.url,
);
export const quietDataBoundary = boundaries.rootEvalQuietDataBoundary;
export const merge = operators.merge;
export const Graph = runtime.Graph;
export const depBatch = ctx.depBatch;

export function createGraphContext({ name = "b121", journal } = {}) {
	const graph = new Graph({ name });
	const releases = new Set();
	return Object.freeze({
		graph,
		observe(sink = journal) {
			if (typeof sink !== "function") throw new TypeError("graph observation sink required");
			const stop = graph.observe().subscribe((event) => {
				// Never export material, model responses, credentials or closure state via observation.
				sink({
					type: "graph-observation",
					data: { path: event.path, tier: event.tier, seq: event.seq, message: event.msg[0] },
				});
			});
			releases.add(stop);
			return () => {
				releases.delete(stop);
				stop();
			};
		},
		dispose() {
			for (const release of releases) release();
			releases.clear();
		},
	});
}
