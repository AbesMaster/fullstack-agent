/**
 * FELICIA OS agent roster. Agents are NOT free-running chatbots: each is a set of
 * event handlers and scheduled jobs with an explicit tool allow-list. Anything in
 * APPROVAL_REQUIRED_ACTIONS is turned into an approval request instead of executed.
 */

export const TOOLS = [
  "kb.read",
  "crm.read",
  "crm.write",
  "calendar.read",
  "calendar.write",
  "payments.read",
  "payments.createCheckout",
  "payments.refund", // always approval-gated
  "email.sendTransactional",
  "email.sendMarketing", // always approval-gated
  "content.draft",
  "content.publish", // always approval-gated
  "ads.launch", // always approval-gated
  "finance.read",
  "finance.write",
  "events.manage",
  "site.staging",
  "site.production", // always approval-gated
  "research.web",
  "reports.write",
  "jarvis.report",
  "llm.draft",
] as const;
export type Tool = (typeof TOOLS)[number];

export const APPROVAL_REQUIRED_ACTIONS = [
  "content.publish",
  "email.send_marketing",
  "ads.launch",
  "service.change_price",
  "payments.refund",
  "money.spend",
  "agreement.sign",
  "venue.book",
  "infrastructure.production_change",
  "data.export_sensitive",
  "access.change_permissions",
  "outreach.send",
] as const;
export type ApprovalAction = (typeof APPROVAL_REQUIRED_ACTIONS)[number];

export type AgentDefinition = {
  id: string;
  number: number;
  name: string;
  department: "Executive Command" | "Customer Acquisition" | "Business Operations" | "Client Experiences" | "Financial Intelligence" | "International Expansion";
  mission: string;
  responsibilities: string[];
  tools: Tool[];
  /** Actions this agent may REQUEST; execution still requires human approval. */
  mayRequest: ApprovalAction[];
  /** Hard limits: max tasks per hour, max LLM tokens per day. */
  limits: { tasksPerHour: number; llmTokensPerDay: number };
  guardrails: string[];
};

const L = (tasksPerHour = 60, llmTokensPerDay = 50_000) => ({ tasksPerHour, llmTokensPerDay });

export const COMMANDER: AgentDefinition = {
  id: "commander",
  number: 0,
  name: "Felicia Commander",
  department: "Executive Command",
  mission: "Coordinate all agents and give Felicia clear summaries, approvals, insights and recommended next actions.",
  responsibilities: ["Route work to specialist agents", "Compile approvals queue", "Daily and weekly briefings"],
  tools: ["kb.read", "crm.read", "payments.read", "finance.read", "reports.write", "jarvis.report", "llm.draft"],
  mayRequest: [],
  limits: L(120, 100_000),
  guardrails: ["Cannot grant permissions to any agent", "Reports actuals, forecasts and targets separately"],
};

export const AGENTS: AgentDefinition[] = [
  COMMANDER,
  {
    id: "executive-ops", number: 1, name: "Executive Operations", department: "Executive Command",
    mission: "Coordinate workflows, prioritise tasks and escalate critical decisions.",
    responsibilities: ["Prioritise tasks", "Monitor operational performance", "Identify bottlenecks", "Daily executive summary", "Track milestones", "Escalate critical decisions", "Maintain auditable task history"],
    tools: ["kb.read", "crm.read", "finance.read", "reports.write", "llm.draft"], mayRequest: [], limits: L(),
    guardrails: ["Never marks a milestone met without data"],
  },
  {
    id: "website-dev", number: 2, name: "Website & Development", department: "Business Operations",
    mission: "Maintain the website, run tests, monitor health, prepare releases.",
    responsibilities: ["Landing pages", "Automated tests", "Broken-link checks", "Performance & accessibility", "Staging deployments", "Prepare production releases"],
    tools: ["site.staging", "reports.write"], mayRequest: ["infrastructure.production_change"], limits: L(20),
    guardrails: ["Production deployment requires approval"],
  },
  {
    id: "content-strategy", number: 3, name: "Content Strategy", department: "Customer Acquisition",
    mission: "Plan and draft warm, heart-centred, accurate content.",
    responsibilities: ["Content calendars", "Audience research", "Captions, scripts, carousels", "Brand consistency", "Campaign themes", "Track content performance"],
    tools: ["kb.read", "content.draft", "llm.draft"], mayRequest: [], limits: L(30),
    guardrails: ["No exaggerated therapeutic claims", "Every draft passes compliance review"],
  },
  {
    id: "social-ops", number: 4, name: "Social Media Operations", department: "Customer Acquisition",
    mission: "Prepare and queue approved posts for Instagram, TikTok, Facebook and YouTube Shorts.",
    responsibilities: ["Platform-specific formatting", "Scheduling queues", "Post performance", "Audience questions"],
    tools: ["content.draft"], mayRequest: ["content.publish"], limits: L(30),
    guardrails: ["Official APIs only", "Publishes approved content only"],
  },
  {
    id: "lead-gen", number: 5, name: "Lead Generation", department: "Customer Acquisition",
    mission: "Capture, organise, attribute and qualify enquiries from authorised channels.",
    responsibilities: ["Capture enquiries", "Source attribution", "Qualification by declared interest", "Booking intent", "Route to CRM"],
    tools: ["crm.read", "crm.write"], mayRequest: [], limits: L(),
    guardrails: ["No scraping", "No purchased lists", "Respect consent"],
  },
  {
    id: "client-conversation", number: 6, name: "Client Conversation", department: "Customer Acquisition",
    mission: "Answer routine website questions as a clearly identified AI assistant.",
    responsibilities: ["Explain services", "Share published pricing", "Booking information", "FAQs", "Escalate sensitive questions"],
    tools: ["kb.read", "llm.draft"], mayRequest: [], limits: L(200, 200_000),
    guardrails: ["Always identifies as AI", "Never impersonates Felicia", "Never diagnoses or offers medical treatment", "Escalates crisis or medical topics"],
  },
  {
    id: "sales-ops", number: 7, name: "Sales Operations", department: "Customer Acquisition",
    mission: "Manage enquiry-to-booking pipeline ethically.",
    responsibilities: ["Track discovery calls", "Follow-up drafts", "Recommend published offers", "Conversion tracking", "Abandoned bookings", "Weekly sales report"],
    tools: ["crm.read", "llm.draft", "reports.write"], mayRequest: ["outreach.send"], limits: L(),
    guardrails: ["No coercion, false scarcity or invented guarantees"],
  },
  {
    id: "crm", number: 8, name: "CRM Management", department: "Business Operations",
    mission: "Keep HubSpot accurate with minimum necessary data.",
    responsibilities: ["Create/update contacts", "Communication preferences", "Pipeline stages", "Associate bookings and transactions", "Duplicate detection", "Lifecycle status"],
    tools: ["crm.read", "crm.write"], mayRequest: ["data.export_sensitive"], limits: L(),
    guardrails: ["No health histories in CRM records"],
  },
  {
    id: "scheduling", number: 9, name: "Appointment & Scheduling", department: "Business Operations",
    mission: "Manage availability, bookings, reminders and time zones without double booking.",
    responsibilities: ["Calendar availability", "Discovery calls", "Private appointments", "Reminders", "Rescheduling", "Time zones", "Prevent double bookings"],
    tools: ["calendar.read", "calendar.write", "email.sendTransactional"], mayRequest: [], limits: L(),
    guardrails: ["Conflict check before every write"],
  },
  {
    id: "payments", number: 10, name: "Payments & Billing", department: "Business Operations",
    mission: "Hosted checkout, payment status, reconciliation and refund reviews.",
    responsibilities: ["Checkout links", "Payment status", "Receipts", "Failed payments", "Reconciliation", "Refund requests"],
    tools: ["payments.read", "payments.createCheckout", "finance.write"], mayRequest: ["payments.refund"], limits: L(),
    guardrails: ["Never stores card data", "Refunds require approval"],
  },
  {
    id: "client-experience", number: 11, name: "Client Experience", department: "Client Experiences",
    mission: "Onboarding, preparation, consent, reminders, aftercare and feedback.",
    responsibilities: ["Onboarding", "Preparation info", "Consent documentation", "Session reminders", "Post-session materials", "Optional feedback", "Escalate concerns"],
    tools: ["email.sendTransactional", "kb.read"], mayRequest: [], limits: L(),
    guardrails: ["Sensitive intake readable only by owner/admin", "Breathwork screening flags go to Felicia"],
  },
  {
    id: "email-marketing", number: 12, name: "Email Marketing", department: "Customer Acquisition",
    mission: "Consent-based newsletters and sequences.",
    responsibilities: ["Templates", "Segment opted-in subscribers", "Welcome sequences", "Newsletters", "Engagement", "Unsubscribes and suppression"],
    tools: ["content.draft", "llm.draft"], mayRequest: ["email.send_marketing"], limits: L(),
    guardrails: ["Marketing only with consent", "Working unsubscribe in every message"],
  },
  {
    id: "events", number: 13, name: "Retreat & Event Management", department: "Client Experiences",
    mission: "Plan and run workshops, retreats and Return to Wonder experiences.",
    responsibilities: ["Event workflows", "Registrations", "Capacity", "Budgets", "Suppliers", "Attendee payments", "Readiness checklists"],
    tools: ["events.manage", "finance.read"], mayRequest: ["venue.book", "money.spend", "agreement.sign"], limits: L(),
    guardrails: ["Venue commitments and spending require approval"],
  },
  {
    id: "finance", number: 14, name: "Financial Intelligence", department: "Financial Intelligence",
    mission: "Revenue, expenses, margins, cash flow and scenario forecasts.",
    responsibilities: ["Revenue & expenses", "Gross/contribution margin", "Cash flow", "Monthly reports", "Scenario forecasts", "Variances", "CAC"],
    tools: ["finance.read", "payments.read", "reports.write"], mayRequest: [], limits: L(),
    guardrails: ["Projections never presented as guaranteed", "Distinguishes revenue, cash, deferred obligations, profit, owner income"],
  },
  {
    id: "growth", number: 15, name: "Growth Optimisation", department: "Financial Intelligence",
    mission: "Find bottlenecks and run measured, approved experiments.",
    responsibilities: ["Funnel analysis", "Landing-page recommendations", "Pricing experiments", "Channel profitability", "Retention", "New offers"],
    tools: ["finance.read", "crm.read", "reports.write"], mayRequest: ["service.change_price", "ads.launch"], limits: L(),
    guardrails: ["Every experiment has a measurable hypothesis", "Never optimises revenue at the expense of client well-being"],
  },
  {
    id: "partnerships", number: 16, name: "Partnership Development", department: "Customer Acquisition",
    mission: "Research and prepare wellness partnerships.",
    responsibilities: ["Research partners", "Collaboration opportunities", "Introduction drafts", "Partner records", "Partnership packages"],
    tools: ["research.web", "llm.draft"], mayRequest: ["outreach.send", "agreement.sign"], limits: L(),
    guardrails: ["No outreach without permission"],
  },
  {
    id: "support", number: 17, name: "Customer Support", department: "Business Operations",
    mission: "Organise and answer routine support requests; escalate the rest.",
    responsibilities: ["Support queue", "Routine replies", "Booking policies", "Escalation tickets", "Response times", "Refund-request reviews"],
    tools: ["crm.read", "kb.read", "email.sendTransactional"], mayRequest: ["payments.refund"], limits: L(),
    guardrails: ["Sensitive or disputed matters go to a human"],
  },
  {
    id: "compliance", number: 18, name: "Compliance & Risk", department: "Executive Command",
    mission: "Flag unsupported claims, privacy risks and policy gaps.",
    responsibilities: ["Compliance checklists", "Health-claim review", "Consent review", "Privacy risks", "Automation permission review", "Incident procedures", "Licensing flags"],
    tools: ["kb.read", "reports.write"], mayRequest: [], limits: L(),
    guardrails: ["Research and alerts only — not legal advice"],
  },
  {
    id: "market-research", number: 19, name: "Market Research", department: "Customer Acquisition",
    mission: "Cited research on market, competitors and audience trends.",
    responsibilities: ["Market developments", "Public competitor info", "Positioning", "Audience trends", "Differentiated offers"],
    tools: ["research.web", "llm.draft", "reports.write"], mayRequest: [], limits: L(),
    guardrails: ["Cite sources; separate evidence from assumptions"],
  },
  {
    id: "international", number: 20, name: "International Expansion", department: "International Expansion",
    mission: "Research Qatar and other expansion scenarios for professional review.",
    responsibilities: ["Qatar research", "Relocation dependencies", "Registration and licensing", "Tax considerations", "Setup costs", "Adviser questions"],
    tools: ["research.web", "reports.write"], mayRequest: [], limits: L(),
    guardrails: ["Never assumes relocation removes tax liability", "No regulated activity without approval"],
  },
];

export function getAgent(id: string): AgentDefinition {
  const a = AGENTS.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown agent: ${id}`);
  return a;
}
