// Pan + zoom for the mermaid graph container. Same helper as compat-matrix —
// kept local so each demo stays self-contained.

export function attachPanZoom(container: HTMLElement): () => void {
	let scale = 1;
	let tx = 0;
	let ty = 0;
	let dragging = false;
	let lastX = 0;
	let lastY = 0;

	const applyTransform = () => {
		const svg = container.querySelector("svg") as
			| (SVGElement & { style: CSSStyleDeclaration })
			| null;
		if (!svg) return;
		svg.style.transformOrigin = "0 0";
		svg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
	};

	const onWheel = (e: WheelEvent) => {
		e.preventDefault();
		const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
		const rect = container.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;
		tx = mx - (mx - tx) * factor;
		ty = my - (my - ty) * factor;
		scale = Math.max(0.1, Math.min(10, scale * factor));
		applyTransform();
	};

	const onPointerDown = (e: PointerEvent) => {
		if (e.button !== 0) return;
		dragging = true;
		lastX = e.clientX;
		lastY = e.clientY;
		container.setPointerCapture(e.pointerId);
		container.style.cursor = "grabbing";
	};

	const onPointerMove = (e: PointerEvent) => {
		if (!dragging) return;
		tx += e.clientX - lastX;
		ty += e.clientY - lastY;
		lastX = e.clientX;
		lastY = e.clientY;
		applyTransform();
	};

	const onPointerUp = (e: PointerEvent) => {
		if (!dragging) return;
		dragging = false;
		try {
			container.releasePointerCapture(e.pointerId);
		} catch {
			// pointer capture may already be released
		}
		container.style.cursor = "grab";
	};

	const onDoubleClick = () => {
		scale = 1;
		tx = 0;
		ty = 0;
		applyTransform();
	};

	container.addEventListener("wheel", onWheel, { passive: false });
	container.addEventListener("pointerdown", onPointerDown);
	container.addEventListener("pointermove", onPointerMove);
	container.addEventListener("pointerup", onPointerUp);
	container.addEventListener("pointercancel", onPointerUp);
	container.addEventListener("dblclick", onDoubleClick);
	container.style.cursor = "grab";
	container.style.touchAction = "none";

	const observer = new MutationObserver(() => applyTransform());
	observer.observe(container, { childList: true });

	return () => {
		container.removeEventListener("wheel", onWheel);
		container.removeEventListener("pointerdown", onPointerDown);
		container.removeEventListener("pointermove", onPointerMove);
		container.removeEventListener("pointerup", onPointerUp);
		container.removeEventListener("pointercancel", onPointerUp);
		container.removeEventListener("dblclick", onDoubleClick);
		observer.disconnect();
		container.style.cursor = "";
		container.style.touchAction = "";
	};
}
