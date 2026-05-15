/**
 * Git hook source — Node-only reactive source that polls a repository's HEAD
 * and emits structured `GitEvent`s on every new commit.
 *
 * Isolated from `./adapters.ts` so that the universal `extra/index` barrel
 * stays browser-safe. Access via `@graphrefly/graphrefly/extra/node`, which
 * re-exports this module.
 *
 * @module
 */

import { wallClockNs } from "@graphrefly/pure-ts/core";
import { ERROR } from "@graphrefly/pure-ts/core";
import { type Node, type NodeOptions, node } from "@graphrefly/pure-ts/core";
import { fromTimer, globToRegExp, matchesAnyPattern, switchMap } from "@graphrefly/pure-ts/extra";

type ExtraOpts = Omit<NodeOptions, "describeKind">;

/** Git hook type for {@link fromGitHook}. */
export type GitHookType = "post-commit" | "post-merge" | "post-checkout" | "post-rewrite";

/** Structured git event emitted by {@link fromGitHook}. */
export type GitEvent = {
	hook: GitHookType;
	commit: string;
	files: string[];
	message: string;
	author: string;
	timestamp_ns: number;
};

/** Options for {@link fromGitHook}. */
export type FromGitHookOptions = ExtraOpts & {
	pollMs?: number;
	include?: string[];
	exclude?: string[];
	/**
	 * Maximum consecutive poll errors before terminating the source. Prevents
	 * error storms when the repository is unavailable (e.g. deleted, corrupt,
	 * permissions lost). Default: `1` (terminate on first error — preserves
	 * pre-switchMap back-compat). Raise it (or set `Infinity`) to keep
	 * retrying indefinitely (legacy behavior).
	 */
	maxConsecutiveErrors?: number;
};

/**
 * Git change detection as a reactive source.
 *
 * @category extra
 */
export function fromGitHook(repoPath: string, opts?: FromGitHookOptions): Node<GitEvent> {
	const { pollMs = 5000, include, exclude, maxConsecutiveErrors = 1 } = opts ?? {};
	const includePatterns = include?.map(globToRegExp) ?? [];
	const excludePatterns = exclude?.map(globToRegExp) ?? [];
	const { execFileSync } = require("node:child_process") as typeof import("node:child_process");

	const gitQuery = (args: string[]): string =>
		execFileSync("git", args, { cwd: repoPath, encoding: "utf-8" }).trim();

	// Shared across ticks: the previous HEAD we committed to. Undefined on the
	// very first poll (we record the initial HEAD without emitting).
	let lastSeen: string | undefined;
	// Circuit breaker: consecutive error count. Resets on any successful poll.
	let consecutiveErrors = 0;

	// `fromTimer | switchMap(sync-git-diff)` — ticks drive the poll, switchMap
	// cancels any in-flight inner on next tick. First tick at t=0 records the
	// baseline HEAD silently; subsequent ticks emit `GitEvent` on HEAD change.
	return switchMap(fromTimer(0, { period: pollMs }), () =>
		node<GitEvent>((_data, a) => {
			try {
				const head = gitQuery(["rev-parse", "HEAD"]);
				if (!head) {
					consecutiveErrors = 0;
					return () => {};
				}
				if (lastSeen === undefined) {
					// First poll: record baseline; stay idle until next tick
					// disposes this inner.
					lastSeen = head;
					consecutiveErrors = 0;
					return () => {};
				}
				if (head === lastSeen) {
					consecutiveErrors = 0;
					return () => {};
				}
				let files = gitQuery(["diff", "--name-only", `${lastSeen}..${head}`])
					.split("\n")
					.filter(Boolean);
				if (includePatterns.length > 0) {
					files = files.filter((f) => matchesAnyPattern(f, includePatterns));
				}
				if (excludePatterns.length > 0) {
					files = files.filter((f) => !matchesAnyPattern(f, excludePatterns));
				}
				const message = gitQuery(["log", "-1", "--format=%s", head]);
				const author = gitQuery(["log", "-1", "--format=%an", head]);
				a.emit({
					hook: "post-commit" as GitHookType,
					commit: head,
					files,
					message,
					author,
					timestamp_ns: wallClockNs(),
				});
				lastSeen = head;
				consecutiveErrors = 0;
			} catch (err) {
				consecutiveErrors += 1;
				if (consecutiveErrors >= maxConsecutiveErrors) {
					a.down([[ERROR, err]]);
				}
				// else: transient error — next tick will retry; don't spam ERROR.
			}
			return () => {};
		}),
	);
}
