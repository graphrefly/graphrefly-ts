/**
 * Shared pattern-layer error hierarchy (Audit 2 — locked 2026-04-24).
 *
 * Cross-primitive `instanceof` checks: gate, queue, cqrs.dispatch, saga,
 * projection, subscription, etc. all use these classes so consumer error
 * handlers can branch by kind rather than by message string.
 *
 * @internal — exposed via patterns/index for primitive impls; consumers
 * should import the relevant class from the primitive's barrel.
 */

/** Root error class. All pattern-layer errors extend this. */
export class GraphReFlyError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = this.constructor.name;
	}
}

/** Re-registering a name that's already taken (command, gate, queue, saga, projection). */
export class DuplicateRegistrationError extends GraphReFlyError {
	constructor(
		readonly kind: string,
		readonly registrationName: string,
	) {
		super(`Duplicate ${kind} registration: "${registrationName}"`);
	}
}

/** CQRS handler emitted an event type not in its declared `emits` set. */
export class UndeclaredEmitError extends GraphReFlyError {
	constructor(
		readonly commandName: string,
		readonly eventName: string,
		readonly declaredEmits: readonly string[],
	) {
		super(
			`Command "${commandName}" emitted undeclared event "${eventName}". Declared emits: [${declaredEmits.join(", ")}]`,
		);
	}
}

/** Aggregate version expected vs observed mismatch on dispatch. */
export class OptimisticConcurrencyError extends GraphReFlyError {
	constructor(
		readonly aggregateId: string,
		readonly expected: number,
		readonly actual: number,
	) {
		super(
			`Optimistic concurrency conflict on aggregate "${aggregateId}": expected version ${expected}, got ${actual}`,
		);
	}
}

/** `dispatch(name, ...)` for a name that wasn't registered via `command()`. */
export class UnknownCommandError extends GraphReFlyError {
	constructor(readonly commandName: string) {
		super(`Unknown command: "${commandName}". Register with command() first.`);
	}
}

/** Wrap any error thrown from inside a command handler. Original on `cause`. */
export class CommandHandlerError extends GraphReFlyError {
	constructor(
		readonly commandName: string,
		cause: unknown,
	) {
		super(
			`Command handler "${commandName}" threw: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause },
		);
	}
}

/** Mutation method called after the primitive was torn down. */
export class TeardownError extends GraphReFlyError {
	constructor(
		readonly kind: string,
		readonly method: string,
	) {
		super(`${kind}: ${method}() called after teardown`);
	}
}

/** Projection rebuild failure — adapter / decode / reducer error. */
export class RebuildError extends GraphReFlyError {
	constructor(
		readonly projectionName: string,
		cause: unknown,
	) {
		super(
			`Projection "${projectionName}" rebuild failed: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause },
		);
	}
}
