/**
 * Baseline variant — fn is a member field on the node, called directly.
 * Mirrors how current pure-ts stores `_fn` on the Node instance.
 */

import { type Actions, type Ctx, type Fn, TinyNode } from "./protocol.js";

export class BaselineNode<T> extends TinyNode<T> {
	private _fn: Fn<T> | null;

	constructor(deps: TinyNode<unknown>[], fn?: Fn<T>, initial?: T) {
		super(deps);
		this._fn = fn ?? null;
		if (initial !== undefined) {
			this._hasData = true;
			this._cache = initial;
		}
	}

	protected _invokeFn(
		batchData: ReadonlyArray<unknown[] | null>,
		actions: Actions<T>,
		ctx: Ctx,
	): void {
		if (this._fn !== null) this._fn(batchData, actions, ctx);
	}
}

export function baselineNode<T>(
	deps: TinyNode<unknown>[],
	fn?: Fn<T>,
	initial?: T,
): BaselineNode<T> {
	return new BaselineNode(deps, fn, initial);
}
