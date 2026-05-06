// ---------------------------------------------------------------------------
// NestJS Actor bridge — maps NestJS ExecutionContext to GraphReFly Actor.
// ---------------------------------------------------------------------------
// Implements the NestJS `CanActivate` interface to extract an `Actor` from the
// request (JWT payload, session, custom header, etc.) and attach it to the
// request object for downstream graph operations.
//
// The decorator does NOT enforce access control — it merely bridges the NestJS
// authentication context to GraphReFly's ABAC model. Actual access control
// flows through node `policy()` guards reactively.
// ---------------------------------------------------------------------------

import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { type Actor, DEFAULT_ACTOR, normalizeActor } from "../../core/actor.js";

/**
 * Property name under which the extracted {@link Actor} is stored on the
 * request object. Downstream code (controllers, gateways) reads
 * `req[ACTOR_KEY]` to pass actor context to graph operations.
 */
export const ACTOR_KEY = "graphReflyActor" as const;

/**
 * Extracts a GraphReFly {@link Actor} from a NestJS {@link ExecutionContext}.
 *
 * Return `undefined` to fall back to {@link DEFAULT_ACTOR}.
 */
export type ActorExtractor = (context: ExecutionContext) => Actor | undefined;

/**
 * Creates an {@link ActorExtractor} that reads a JWT payload from `req.user`
 * (the standard Passport.js location) and maps it to a GraphReFly {@link Actor}.
 *
 * @param mapping - Optional transform from the JWT payload to an Actor.
 *   When omitted, the payload is used directly (must have `type` and `id`).
 *
 * @example
 * ```ts
 * // Default: req.user is already { type, id, ... }
 * GraphReflyGuard(fromJwtPayload())
 *
 * // Custom mapping from your JWT claims
 * GraphReflyGuard(fromJwtPayload((payload) => ({
 *   type: payload.role === "admin" ? "human" : "llm",
 *   id: payload.sub,
 *   org: payload.org_id,
 * })))
 * ```
 */
export function fromJwtPayload(mapping?: (payload: unknown) => Actor): ActorExtractor {
	return (context: ExecutionContext): Actor | undefined => {
		const req = context.switchToHttp().getRequest();
		const user = req?.user;
		if (user == null) return undefined;
		if (mapping) return mapping(user);
		return user as Actor;
	};
}

/**
 * Creates an {@link ActorExtractor} that reads an Actor from a request header.
 *
 * The header value is parsed as JSON. Useful for service-to-service calls
 * where the caller embeds actor context in a custom header.
 *
 * @param headerName - HTTP header name (case-insensitive). Default: `"x-graphrefly-actor"`.
 *
 * @example
 * ```ts
 * GraphReflyGuard(fromHeader("x-actor"))
 * ```
 */
export function fromHeader(headerName = "x-graphrefly-actor"): ActorExtractor {
	return (context: ExecutionContext): Actor | undefined => {
		const req = context.switchToHttp().getRequest();
		const raw = req?.headers?.[headerName.toLowerCase()];
		if (typeof raw !== "string" || raw.length === 0) return undefined;
		try {
			return JSON.parse(raw) as Actor;
		} catch {
			return undefined;
		}
	};
}

/**
 * Reads the extracted {@link Actor} from a request object (set by {@link GraphReflyGuardImpl}).
 *
 * Returns {@link DEFAULT_ACTOR} if no actor was attached.
 *
 * @example
 * ```ts
 * @Get("status")
 * getStatus(@Req() req: Request) {
 *   const actor = getActor(req);
 *   return this.graph.describe({ actor });
 * }
 * ```
 */
export function getActor(req: unknown): Actor {
	const actor = (req as Record<string, unknown>)?.[ACTOR_KEY];
	return actor != null ? normalizeActor(actor as Actor) : DEFAULT_ACTOR;
}

/**
 * NestJS guard that extracts a GraphReFly {@link Actor} from the execution
 * context and attaches it to the request as `req.graphReflyActor`.
 *
 * This guard always returns `true` (allows the request through). Access
 * control is handled by GraphReFly node guards (`policy()`), not by this
 * NestJS guard. The purpose is purely to **bridge** authentication context.
 *
 * @example
 * ```ts
 * // Global guard — every request gets an Actor
 * app.useGlobalGuards(new GraphReflyGuardImpl(fromJwtPayload()));
 *
 * // Controller-scoped
 * @UseGuards(GraphReflyGuard(fromJwtPayload()))
 * @Controller("api")
 * export class ApiController { ... }
 * ```
 */
export class GraphReflyGuardImpl implements CanActivate {
	constructor(private readonly extractor: ActorExtractor) {}

	canActivate(context: ExecutionContext): boolean {
		const actor = normalizeActor(this.extractor(context));
		const req = context.switchToHttp().getRequest();
		if (req != null) {
			(req as Record<string, unknown>)[ACTOR_KEY] = actor;
		}
		return true;
	}
}

/**
 * Factory that creates a {@link GraphReflyGuardImpl} instance. Use with
 * NestJS `@UseGuards()` or `app.useGlobalGuards()`.
 *
 * @param extractor - How to extract an Actor from the request context.
 *   Defaults to {@link fromJwtPayload} (reads `req.user`).
 *
 * @example
 * ```ts
 * import { GraphReflyGuard, fromJwtPayload } from "@graphrefly/graphrefly-ts/compat/nestjs";
 *
 * @UseGuards(GraphReflyGuard())
 * @Controller("graph")
 * export class GraphController { ... }
 * ```
 */
export function GraphReflyGuard(extractor?: ActorExtractor): GraphReflyGuardImpl {
	return new GraphReflyGuardImpl(extractor ?? fromJwtPayload());
}
