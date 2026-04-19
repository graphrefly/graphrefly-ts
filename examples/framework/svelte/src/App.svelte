<script lang="ts">
import { useStore, useSubscribe } from "@graphrefly/graphrefly/compat/svelte";
import { count, doubled } from "./store";

// `useStore` returns a Svelte writable store — `$`-prefix reads and writes it.
const value = useStore(count);
// `useSubscribe` returns a readable store for any node (here: a derived).
const dbl = useSubscribe(doubled);
</script>

<section>
	<h1>GraphReFly · Svelte 5</h1>
	<div class="row">
		<button type="button" on:click={() => ($value = ($value ?? 0) - 1)}>−</button>
		<span class="value">{$value ?? 0}</span>
		<button type="button" on:click={() => ($value = ($value ?? 0) + 1)}>+</button>
	</div>
	<p>doubled = <strong>{$dbl ?? 0}</strong></p>
</section>

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, sans-serif;
		background: #0b0d10;
		color: #e6e6e6;
		display: grid;
		place-items: center;
		min-height: 100vh;
	}
	section {
		text-align: center;
		padding: 2rem 3rem;
		border: 1px solid #2a2f36;
		border-radius: 12px;
	}
	h1 {
		margin: 0 0 1rem;
		font-size: 1rem;
		letter-spacing: 0.08em;
		color: #9aa0a6;
		font-weight: 500;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 1rem;
		justify-content: center;
	}
	button {
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 999px;
		border: 1px solid #3a404a;
		background: transparent;
		color: inherit;
		font-size: 1.25rem;
		cursor: pointer;
	}
	button:hover {
		background: #1b1f26;
	}
	.value {
		font-size: 2.5rem;
		font-variant-numeric: tabular-nums;
		min-width: 3ch;
	}
	p {
		margin-top: 1rem;
		color: #9aa0a6;
	}
	strong {
		color: #e6e6e6;
	}
</style>
