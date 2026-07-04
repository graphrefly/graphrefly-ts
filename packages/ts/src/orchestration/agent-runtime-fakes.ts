import type { DataIssue } from "../data/index.js";
import type { AgentNeed } from "./agent-runtime-types-agent.js";
import type {
	AgentOutputEnvelope,
	ExecutorOutcome,
	ExecutorOutcomeBase,
} from "./agent-runtime-types-core.js";

/**
 * Creates a fake executor result.
 *
 * @param opts - Options that configure the helper.
 * @returns The fake executor result result.
 * @category orchestration
 * @example
 * ```ts
 * import { fakeExecutorResult } from "@graphrefly/ts/orchestration";
 * ```
 */
export function fakeExecutorResult<T>(
	opts: Omit<ExecutorOutcomeBase, "kind"> & { readonly result: AgentOutputEnvelope<T> },
): ExecutorOutcome<T> {
	return { kind: "result", ...opts };
}

/**
 * Creates a fake executor failure.
 *
 * @param opts - Options that configure the helper.
 * @returns The fake executor failure result.
 * @category orchestration
 * @example
 * ```ts
 * import { fakeExecutorFailure } from "@graphrefly/ts/orchestration";
 * ```
 */
export function fakeExecutorFailure(
	opts: Omit<ExecutorOutcomeBase, "kind"> & {
		readonly error: DataIssue;
		readonly retryable?: boolean;
	},
): ExecutorOutcome {
	return { kind: "failure", ...opts };
}

/**
 * Creates a fake executor blocked.
 *
 * @param opts - Options that configure the helper.
 * @returns The fake executor blocked result.
 * @category orchestration
 * @example
 * ```ts
 * import { fakeExecutorBlocked } from "@graphrefly/ts/orchestration";
 * ```
 */
export function fakeExecutorBlocked(
	opts: Omit<ExecutorOutcomeBase, "kind"> & { readonly needs: readonly AgentNeed[] },
): ExecutorOutcome {
	return { kind: "blocked", ...opts };
}

/**
 * Creates a fake executor timeout.
 *
 * @param opts - Options that configure the helper.
 * @returns The fake executor timeout result.
 * @category orchestration
 * @example
 * ```ts
 * import { fakeExecutorTimeout } from "@graphrefly/ts/orchestration";
 * ```
 */
export function fakeExecutorTimeout(
	opts: Omit<ExecutorOutcomeBase, "kind"> & {
		readonly timeoutMs?: number;
		readonly retryable?: boolean;
	},
): ExecutorOutcome {
	return { kind: "timeout", ...opts };
}

/**
 * Creates a fake executor canceled.
 *
 * @param opts - Options that configure the helper.
 * @returns The fake executor canceled result.
 * @category orchestration
 * @example
 * ```ts
 * import { fakeExecutorCanceled } from "@graphrefly/ts/orchestration";
 * ```
 */
export function fakeExecutorCanceled(
	opts: Omit<ExecutorOutcomeBase, "kind"> & { readonly reason?: string },
): ExecutorOutcome {
	return { kind: "canceled", ...opts };
}
