// ---------------------------------------------------------------------------
// NestJS RxJS bridge — returns a real rxjs `Observable` (so NestJS route
// handlers' `isObservable()` recognizes it and `.pipe()` works directly).
//
// rxjs lives ONLY here, under the opt-in `compat/nestjs` subpath, where it is
// legitimately available (`@nestjs/common` depends on rxjs). The base
// `toObservable` (`@graphrefly/graphrefly/base`) is dependency-free and is
// what RN/Hermes/web consumers load — this wrapper just adopts it via
// rxjs `from()`.
// ---------------------------------------------------------------------------

import type { Messages, Node } from "@graphrefly/pure-ts/core";
import { from, type Observable, type ObservableInput } from "rxjs";
import {
	toObservable as baseToObservable,
	type ToObservableOptions,
} from "../../base/composition/observable.js";

export type { ToObservableOptions };

/**
 * Bridge a `Node<T>` to a real rxjs `Observable` for NestJS controllers,
 * gateways, and interceptors. Wraps the dependency-free base interop
 * observable with rxjs `from()` so `isObservable()` / `.pipe()` work.
 *
 * See {@link baseToObservable} for the DATA/ERROR/COMPLETE mapping and the
 * `{ raw: true }` message-batch mode.
 */
export function toObservable<T>(
	node: Node<T>,
	options?: ToObservableOptions & { raw?: false },
): Observable<T>;
export function toObservable<T>(
	node: Node<T>,
	options: ToObservableOptions & { raw: true },
): Observable<Messages>;
export function toObservable<T>(
	node: Node<T>,
	options?: ToObservableOptions,
): Observable<T | Messages> {
	// The base interop observable exposes `subscribe` + the well-known
	// `Symbol.observable` method at runtime; rxjs `from()` adopts it. Branch
	// so each call hits a concrete base overload (the union impl signature is
	// not visible to callers), and cast the minimal base type to rxjs input.
	const base = options?.raw ? baseToObservable(node, { raw: true }) : baseToObservable<T>(node);
	return from(base as unknown as ObservableInput<T | Messages>);
}
