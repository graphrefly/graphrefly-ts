import { afterEach, describe, expect, it } from "vitest";
import { type CanvasDogfoodRuntime, createCanvasDogfoodRuntime } from "./canvas-graph";

const runtimes: CanvasDogfoodRuntime[] = [];

afterEach(() => {
	for (const runtime of runtimes.splice(0)) runtime.dispose();
});

function createRuntime(): CanvasDogfoodRuntime {
	const runtime = createCanvasDogfoodRuntime();
	runtimes.push(runtime);
	return runtime;
}

describe("GraphReFly Canvas dogfood graph", () => {
	it("seeds a product-visible board from graph-visible WorkItem/effect/runtime facts", () => {
		const runtime = createRuntime();
		const view = runtime.view.cache;

		expect(view?.nodes).toHaveLength(6);
		expect(view?.edges).toHaveLength(6);
		expect(view?.effectPlans.length).toBeGreaterThanOrEqual(4);
		expect(view?.toolRuns.some((run) => run.status === "result")).toBe(true);
		expect(view?.toolRuns.some((run) => run.status === "failure")).toBe(true);
		expect(view?.toolRuns.some((run) => run.status === "blocked")).toBe(true);
		expect(view?.evidence.some((evidence) => evidence.status === "completed")).toBe(true);
		expect(view?.evidence.some((evidence) => evidence.status === "failed")).toBe(true);
		expect(view?.evidence.some((evidence) => evidence.status === "blocked")).toBe(true);
	});

	it("publishes UI run and domain-action gestures as graph-visible facts", () => {
		const runtime = createRuntime();
		runtime.selectWorkItem("wi-board-query");
		runtime.runSelectedEffect();
		runtime.proposeReviewAction();
		runtime.approveLatestProposal();

		const view = runtime.view.cache;
		expect(view?.selectedWorkItemId).toBe("wi-board-query");
		expect(view?.toolRuns.some((run) => run.workItemId === "wi-board-query")).toBe(true);
		expect(view?.evidence.some((evidence) => evidence.workItemId === "wi-board-query")).toBe(true);
		expect(view?.actions.some((action) => action.workItemId === "wi-board-query")).toBe(true);
		expect(view?.actions.some((action) => action.state === "proposal-only")).toBe(true);
	});
});
