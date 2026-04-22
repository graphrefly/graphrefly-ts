/**
 * 50 mock emails — varied mix of actionable work items, personal notes,
 * promotional noise, calendar reminders, newsletters, and notifications.
 *
 * The reducer pipeline will classify each, filter the actionable ones,
 * extract action items, rank by priority × confidence, and draft a brief.
 */

export interface Email {
	readonly id: string;
	readonly from: string;
	readonly subject: string;
	readonly snippet: string;
	readonly receivedAt: string;
}

export const EMAILS: readonly Email[] = [
	// --- Work: concrete action requests (should rank high) ---
	{
		id: "e01",
		from: "alice@acme.co",
		subject: "Can you review PR #482 before EOD?",
		snippet:
			"Merge window closes at 5pm PT. Two tests still flaky — see line 34 of runner.ts. Need your approval.",
		receivedAt: "2026-04-21T08:12:00Z",
	},
	{
		id: "e02",
		from: "finance@acme.co",
		subject: "Invoice #INV-2031 requires approval",
		snippet:
			"Vendor: Acme Hosting. Amount: $4,200. Due: Friday 4/24. Approve in Ramp or reply with concerns.",
		receivedAt: "2026-04-21T08:25:00Z",
	},
	{
		id: "e03",
		from: "legal@acme.co",
		subject: "Please sign updated MSA with FidelityCorp",
		snippet: "Redlines resolved. DocuSign link inside. Counterparty expects return by Wed.",
		receivedAt: "2026-04-21T08:40:00Z",
	},
	{
		id: "e04",
		from: "hr@acme.co",
		subject: "Complete Q2 compliance training by 4/30",
		snippet: "30-minute module. Required for all US employees. Link inside.",
		receivedAt: "2026-04-21T09:00:00Z",
	},
	{
		id: "e05",
		from: "bob@acme.co",
		subject: "Re: Sprint planning — your inputs on the roadmap?",
		snippet:
			"Need your priorities for the May sprint by Friday so I can draft the doc. 3 bullets is fine.",
		receivedAt: "2026-04-21T09:14:00Z",
	},
	{
		id: "e06",
		from: "security@acme.co",
		subject: "Rotate your SSH key — expires 4/28",
		snippet: "Your acme-prod key expires in 7 days. Use the self-serve portal to rotate.",
		receivedAt: "2026-04-21T09:30:00Z",
	},
	{
		id: "e07",
		from: "design@acme.co",
		subject: "Figma mocks for onboarding v3 — final review",
		snippet: "Last chance to comment. Shipping to eng Monday. Link inside.",
		receivedAt: "2026-04-21T09:45:00Z",
	},
	{
		id: "e08",
		from: "pm@acme.co",
		subject: "Customer escalation — RightAngle account",
		snippet:
			"RightAngle threatened to churn. Need your take on a retention discount before 2pm call.",
		receivedAt: "2026-04-21T10:00:00Z",
	},

	// --- Personal: real but lower urgency ---
	{
		id: "e09",
		from: "mom@gmail.com",
		subject: "Dinner Sunday?",
		snippet: "Dad and I are free Sunday 6pm. Let me know if you can make it.",
		receivedAt: "2026-04-21T07:15:00Z",
	},
	{
		id: "e10",
		from: "sarah.chen@gmail.com",
		subject: "Coffee this week?",
		snippet: "Back in town Thursday through Saturday. Blue Bottle on 18th?",
		receivedAt: "2026-04-21T07:42:00Z",
	},
	{
		id: "e11",
		from: "dentist@smileclinic.com",
		subject: "Reminder: cleaning appointment 4/24",
		snippet: "Friday 10:30am with Dr. Okafor. Reply STOP to cancel.",
		receivedAt: "2026-04-21T06:00:00Z",
	},
	{
		id: "e12",
		from: "landlord@sfapts.com",
		subject: "Annual lease renewal — action required",
		snippet:
			"Your lease renews 5/31. Rent increase of 3%. Sign the addendum by 4/30 or we'll assume month-to-month.",
		receivedAt: "2026-04-21T08:05:00Z",
	},

	// --- Promotional / marketing (should be filtered as non-actionable) ---
	{
		id: "e13",
		from: "offers@bestbuy.com",
		subject: "30% off laptops this week only",
		snippet: "Shop Dell, HP, Lenovo. Sale ends Sunday midnight.",
		receivedAt: "2026-04-21T05:00:00Z",
	},
	{
		id: "e14",
		from: "deals@airlines.com",
		subject: "Flights to Tokyo from $645 round-trip",
		snippet: "Limited-time fare alert. Book by Friday for May–June travel.",
		receivedAt: "2026-04-21T05:15:00Z",
	},
	{
		id: "e15",
		from: "marketing@shoestore.com",
		subject: "New Nike drops — shop the collection",
		snippet: "Air Max 2026, Pegasus 41, and more. Free shipping on orders over $50.",
		receivedAt: "2026-04-21T05:30:00Z",
	},
	{
		id: "e16",
		from: "promo@groceryapp.com",
		subject: "$10 off your next 3 orders",
		snippet: "Code SPRING10. Expires 4/30.",
		receivedAt: "2026-04-21T05:45:00Z",
	},
	{
		id: "e17",
		from: "deals@hotels.com",
		subject: "Weekend getaway deals from $89/night",
		snippet: "Book your spring escape. Free cancellation.",
		receivedAt: "2026-04-21T06:00:00Z",
	},
	{
		id: "e18",
		from: "crm@streamingservice.com",
		subject: "We miss you — 2 months free",
		snippet: "Come back to MovieStream. First 2 months on us.",
		receivedAt: "2026-04-21T06:15:00Z",
	},
	{
		id: "e19",
		from: "offers@creditcard.com",
		subject: "Earn 60,000 bonus points",
		snippet: "Limited-time welcome bonus on the Platinum Travel card.",
		receivedAt: "2026-04-21T06:30:00Z",
	},
	{
		id: "e20",
		from: "store@electronics.com",
		subject: "Flash sale: headphones 40% off",
		snippet: "Today only. Over-ear, in-ear, gaming. Free 2-day shipping.",
		receivedAt: "2026-04-21T06:45:00Z",
	},

	// --- Newsletters / digests ---
	{
		id: "e21",
		from: "digest@hackernews.com",
		subject: "HN weekly digest — top 10 stories",
		snippet: "AI agent harnesses · new Rust async runtime · YC S26 batch · more.",
		receivedAt: "2026-04-21T04:00:00Z",
	},
	{
		id: "e22",
		from: "newsletter@tldr.tech",
		subject: "TLDR — Apr 21: three things to know",
		snippet:
			"1. Anthropic ships managed agents. 2. NVIDIA Q1 earnings beat. 3. New WebGPU spec draft.",
		receivedAt: "2026-04-21T04:30:00Z",
	},
	{
		id: "e23",
		from: "noreply@substack.com",
		subject: "New post: 'Why your eval harness lies to you'",
		snippet: "Substack post from Ben Hylak. Read time: 9 min.",
		receivedAt: "2026-04-21T04:45:00Z",
	},
	{
		id: "e24",
		from: "weekly@changelog.com",
		subject: "Changelog weekly — episode 621",
		snippet: "New episode on developer tooling. Listen in your podcast app.",
		receivedAt: "2026-04-21T05:00:00Z",
	},
	{
		id: "e25",
		from: "briefing@morningbrew.com",
		subject: "Morning Brew — 4/21",
		snippet: "Markets: S&P +0.4%. Stories: Tesla delivery miss, Fed pause, retail sales up.",
		receivedAt: "2026-04-21T05:15:00Z",
	},

	// --- Notifications (systems, not humans) ---
	{
		id: "e26",
		from: "no-reply@amazon.com",
		subject: "Your package has been delivered",
		snippet: "Order #114-2918 delivered to front porch. Photo attached.",
		receivedAt: "2026-04-21T07:00:00Z",
	},
	{
		id: "e27",
		from: "alerts@united.com",
		subject: "Flight UA 5321 confirmed for 4/27",
		snippet: "SFO → JFK, departing 8:15am. Check-in opens 4/26 8:15am.",
		receivedAt: "2026-04-21T07:10:00Z",
	},
	{
		id: "e28",
		from: "github.com",
		subject: "[acme/runner] Build #1923 failed",
		snippet: "Job 'test:integration' failed on main. See log for stack trace.",
		receivedAt: "2026-04-21T10:15:00Z",
	},
	{
		id: "e29",
		from: "linear.app",
		subject: "You were assigned AE-224 — 'Fix rate-limit leak'",
		snippet: "Assigned by Bob Martinez. Priority: High. Due: 4/25.",
		receivedAt: "2026-04-21T10:20:00Z",
	},
	{
		id: "e30",
		from: "pagerduty.com",
		subject: "[RESOLVED] High error rate on api-gateway",
		snippet: "Incident #8821 auto-resolved after 4 min. No action needed.",
		receivedAt: "2026-04-21T03:15:00Z",
	},
	{
		id: "e31",
		from: "notifications@slack.com",
		subject: "Daily summary from #eng-harness",
		snippet: "23 messages. Top threads: eval run failure · cache key bug · PR #487.",
		receivedAt: "2026-04-21T07:30:00Z",
	},
	{
		id: "e32",
		from: "billing@stripe.com",
		subject: "Invoice paid: $199.00",
		snippet: "Your monthly subscription was charged. Receipt attached.",
		receivedAt: "2026-04-21T07:45:00Z",
	},

	// --- Threads / replies (mix of real and informational) ---
	{
		id: "e33",
		from: "carol@acme.co",
		subject: "Re: Re: Eval run looked off — can you double-check the judge config?",
		snippet:
			"You were right. Judge was pointing at the wrong model. Fix in PR #489. Can you approve?",
		receivedAt: "2026-04-21T09:55:00Z",
	},
	{
		id: "e34",
		from: "daniel@acme.co",
		subject: "Re: Architecture review doc",
		snippet: "Added comments throughout. See sections 3.2 and 4.1 for concerns.",
		receivedAt: "2026-04-21T10:05:00Z",
	},
	{
		id: "e35",
		from: "emily@vendor.co",
		subject: "Re: Pricing question",
		snippet:
			"Confirmed: the usage-based tier caps at $2k/mo. Let me know if you want the enterprise tier.",
		receivedAt: "2026-04-21T10:10:00Z",
	},
	{
		id: "e36",
		from: "frank@acme.co",
		subject: "Re: Lunch",
		snippet: "Thanks! See you at 12:30 at the usual place.",
		receivedAt: "2026-04-21T10:20:00Z",
	},
	{
		id: "e37",
		from: "gina@acme.co",
		subject: "Re: Q2 OKR draft",
		snippet:
			"LGTM. Only comment: 'ship harness' should be split into 'harness MVP' and 'harness GA'.",
		receivedAt: "2026-04-21T10:30:00Z",
	},

	// --- Calendar invites / meeting reminders ---
	{
		id: "e38",
		from: "calendar@google.com",
		subject: "Reminder: 1:1 with Manager in 15 minutes",
		snippet: "10:30am PT · Google Meet · No agenda attached.",
		receivedAt: "2026-04-21T10:15:00Z",
	},
	{
		id: "e39",
		from: "calendar@google.com",
		subject: "Tomorrow: Architecture review with partner team",
		snippet: "4/22 2:00pm PT · Zoom link inside · Bring the reduction-layer diagram.",
		receivedAt: "2026-04-21T10:20:00Z",
	},
	{
		id: "e40",
		from: "calendar@google.com",
		subject: "New meeting request: onboarding intro with new hire",
		snippet: "4/23 11:00am · 30 min · Accept/Tentative/Decline.",
		receivedAt: "2026-04-21T10:25:00Z",
	},

	// --- Urgent / ambiguous (human follow-ups) ---
	{
		id: "e41",
		from: "henry@acme.co",
		subject: "Can you jump on a quick call?",
		snippet: "Customer-facing issue with the ingest pipeline. Slack huddle running now.",
		receivedAt: "2026-04-21T10:40:00Z",
	},
	{
		id: "e42",
		from: "isabel@acme.co",
		subject: "Heads up — board deck needs your section by Thursday",
		snippet: "Your 2 slides on harness adoption. Keep to bullets. Thursday 5pm.",
		receivedAt: "2026-04-21T10:45:00Z",
	},
	{
		id: "e43",
		from: "jack@acme.co",
		subject: "FYI: eval infra cost spike",
		snippet: "Looks like we left a GPU box running overnight. $180 one-off. No action for you.",
		receivedAt: "2026-04-21T10:50:00Z",
	},

	// --- Billing / receipts ---
	{
		id: "e44",
		from: "receipts@uber.com",
		subject: "Your Uber trip receipt",
		snippet: "From Mission St to SFO. $37.42. Tap to rate your driver.",
		receivedAt: "2026-04-21T06:00:00Z",
	},
	{
		id: "e45",
		from: "receipts@doordash.com",
		subject: "Order from Golden Boy delivered",
		snippet: "$28.15 · Receipt attached.",
		receivedAt: "2026-04-21T06:30:00Z",
	},

	// --- Spam / low-quality outreach ---
	{
		id: "e46",
		from: "outbound@salestool.co",
		subject: "Quick question about Acme's AI strategy",
		snippet: "Saw your post on LinkedIn. Would love to connect for 15 min this week?",
		receivedAt: "2026-04-21T04:30:00Z",
	},
	{
		id: "e47",
		from: "recruiter@megacorp.com",
		subject: "Sr. Eng role at MegaCorp — interested?",
		snippet:
			"Based on your GitHub activity, you'd be a great fit for our infra team. Open to a chat?",
		receivedAt: "2026-04-21T04:45:00Z",
	},
	{
		id: "e48",
		from: "no-reply@linkedin.com",
		subject: "5 people viewed your profile this week",
		snippet: "See who's interested. Upgrade to Premium to see all viewers.",
		receivedAt: "2026-04-21T05:00:00Z",
	},

	// --- Mixed (automated but actually useful) ---
	{
		id: "e49",
		from: "statuspage@provider.io",
		subject: "[Investigating] Elevated error rate on US-West region",
		snippet: "Started 08:42 UTC. Affecting ~3% of reads. Updates every 15 min.",
		receivedAt: "2026-04-21T08:45:00Z",
	},
	{
		id: "e50",
		from: "noreply@1password.com",
		subject: "Security alert: new sign-in from Chrome on macOS",
		snippet: "If this was you, no action needed. If not, lock your account immediately.",
		receivedAt: "2026-04-21T08:50:00Z",
	},
];
