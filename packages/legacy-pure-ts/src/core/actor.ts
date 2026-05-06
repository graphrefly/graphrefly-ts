/**
 * Who is performing an operation (attribution + ABAC input).
 *
 * @see GRAPHREFLY-SPEC — roadmap Phase 1.5 (Actor & Guard).
 */
export type Actor = {
	type: "human" | "llm" | "wallet" | "system" | string;
	id: string;
} & Record<string, unknown>;

/** Default actor when none is passed ({@link normalizeActor}). */
export const DEFAULT_ACTOR: Actor = { type: "system", id: "" };

/**
 * Fills missing `type` / `id` on an actor and returns {@link DEFAULT_ACTOR} when input is undefined.
 *
 * @param actor - Optional partial actor from a transport hint.
 * @returns A normalized `Actor` safe to pass to guards and graph APIs.
 *
 * @example
 * ```ts
 * import { normalizeActor } from "@graphrefly/graphrefly-ts";
 *
 * normalizeActor({ type: "human", id: "u1" });
 * ```
 */
export function normalizeActor(actor?: Actor): Actor {
	if (actor == null) return DEFAULT_ACTOR;
	const { type, id, ...rest } = actor;
	return {
		type: type ?? "system",
		id: id ?? "",
		...rest,
	} as Actor;
}
