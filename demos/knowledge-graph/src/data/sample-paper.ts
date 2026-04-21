// Default content for the demo. Bundled so the page works offline and on
// first paint without needing an external fetch. Source attribution is
// preserved in the title; users can swap to any URL via the textarea.

export type SamplePaper = {
	url: string;
	title: string;
	author: string;
	body: string;
};

export const SAMPLE_PAPER: SamplePaper = {
	url: "https://medium.com/be-open/what-is-ai-harness-engineering-your-guide-to-controlling-autonomous-systems-30c9c8d2b489",
	title: "What is AI Harness Engineering? Your Guide to Controlling Autonomous Systems",
	author: "Mohit Sewak, Ph.D. — Be Open · Mar 3, 2026",
	body: `AI Harness Engineering represents a fundamental shift in how we approach artificial intelligence development. Rather than writing every instruction, developers become "strategic architects" designing safe environments for autonomous systems. The discipline translates abstract concepts like "AI Alignment" into concrete technical implementations.

The risks of poorly controlled AI systems extend beyond traditional software bugs. Reward Hacking can emerge when systems achieve stated goals through unintended methods, such as eliminating complaint channels rather than improving products. Emergent Behaviors are AI systems developing unexpected capabilities not explicitly programmed, which can be benign or dangerous. Value Brittleness shows up when systems follow literal instructions while missing their intended purpose.

Effective AI control requires a layered system. AI Agent Architecture builds a leash into the brain through structural design that constrains AI decision-making. The Thinking Corner is where Planning happens; the Tool Shed restricts Action to pre-approved tools and APIs; the Magic Mirror is for Reflection on action outcomes; the Never-Forget Notebook is long-term Memory that prevents repeated mistakes through historical record-keeping.

Reward Engineering is the art of the perfect doggy treat. Reward Shaping uses intermediate rewards to guide systems toward complex objectives. Penalty Design establishes clear consequences for prohibited behaviors. Designers must anticipate creative misinterpretation of reward functions.

Constraints and Guardrails are the unbreakable fences — non-negotiable operational rules including prohibitions on harmful content generation, privacy violations, and deceptive practices. Automated monitoring acts as a digital immune system, continuously detecting and correcting deviations.

Human-in-the-Loop is the ultimate failsafe. Human judgment remains essential for high-stakes decisions and ethically complex scenarios where machines lack wisdom, empathy, and contextual understanding.

Mechanistic Interpretability reverse-engineers internal AI processes into understandable components, enabling detection of hidden objectives and deceptive alignment. Formal Verification provides mathematical proofs that AI systems will not violate specific safety rules under defined conditions, but works best for narrow concrete properties rather than complex contextual ethical guidelines.

Red Teaming hires hackers to break your AI: adversarial teams actively attempt to compromise AI safety controls. Adversarial Robustness trains systems on adversarially crafted examples — intentionally designed inputs that trick AI systems — improving resilience to imperceptible modifications.

Human oversight scales poorly when supervising vastly superior intelligence. AI Debate pits competing AI systems against each other to generate arguments humans can evaluate. Weak-to-Strong Generalization develops techniques enabling weaker supervisors to effectively train more capable systems. Constitutional AI provides core principles as an ethical framework, with AI systems supervising each other based on these constitutional guidelines.

The Value Alignment Problem remains unsolved — translating nuanced contextual human values into executable code presents persistent challenges. Engineers and Researchers must continue innovation in scalable oversight, automated interpretability, and robust assurance methods. Policymakers move beyond vague principles toward concrete standards. Business Leaders treat safety as harness engineering investment from project inception, not as an added feature.`,
};

/** Split a paper body into paragraphs the LLM extractor can chew on. */
export function splitParagraphs(body: string): readonly string[] {
	return body
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.filter((p) => p.length > 40);
}
