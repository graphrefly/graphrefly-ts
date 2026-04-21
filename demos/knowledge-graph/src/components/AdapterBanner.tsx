import type { AdapterInfo } from "../lib/types";

export default function AdapterBanner({ info }: { info: AdapterInfo }) {
	return (
		<div className={`adapter-banner ${info.status}`}>
			<span className="pill">{info.name}</span>
			<span>
				<strong>{info.status}</strong> — {info.note}
			</span>
		</div>
	);
}
