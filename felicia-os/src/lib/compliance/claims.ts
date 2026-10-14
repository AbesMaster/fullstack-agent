/**
 * Rule-based claim checker (Compliance & Risk agent). It flags wording that UK
 * advertising rules (CAP Code / ASA guidance on health and "therapeutic" claims)
 * and consumer-protection law commonly treat as risky. It is a safety net that
 * routes content to a human — NOT a legal determination.
 */
export type Severity = "block" | "review";
export type ClaimFlag = { rule: string; severity: Severity; match: string; advice: string };

const RULES: { rule: string; severity: Severity; pattern: RegExp; advice: string }[] = [
  {
    rule: "medical-cure-claim",
    severity: "block",
    pattern: /\b(cures?|cured|curing|heals?|healed|treats?|treatment for|remed(y|ies))\b[^.!?\n]{0,60}\b(cancer|diabetes|depression|anxiety|ptsd|disease|illness|infertility|addiction|disorder|chronic pain|trauma|insomnia|adhd|autism)\b/i,
    advice: "Don't claim to cure or treat medical or psychological conditions. Describe the experience (e.g. 'a space to relax and reflect') instead.",
  },
  {
    rule: "replace-medical-care",
    severity: "block",
    pattern: /\b(instead of|replace|replaces|no need for|stop taking|alternative to)\b[^.!?\n]{0,40}\b(medication|medicine|doctor|therapy|therapist|treatment|gp|psychiatrist)\b/i,
    advice: "Never suggest the service replaces medical or psychological care.",
  },
  {
    rule: "guaranteed-outcome",
    severity: "block",
    pattern: /\b(guarantee[ds]?|100% (effective|results)|proven to|scientifically proven|clinically proven|always works|permanent(ly)? (results|healing|change))\b/i,
    advice: "Remove guarantees. Outcomes vary; describe what the session offers rather than promising results.",
  },
  {
    rule: "unverified-professional-title",
    severity: "review",
    pattern: /\b(licensed|registered|certified|accredited|chartered)\s+(psychologist|psychotherapist|therapist|counsellor|counselor|doctor|practitioner|nurse)\b|\b(psychologist|psychotherapist|medical practitioner)\b/i,
    advice: "Only use protected or professional titles once qualifications are independently verified.",
  },
  {
    rule: "false-scarcity",
    severity: "review",
    pattern: /\b(only \d+ (spots?|places?|seats?) left|last chance|ends tonight|act now|don'?t miss out|limited time only|hurry)\b/i,
    advice: "Scarcity statements must be literally true at publication. Confirm with real capacity data or remove.",
  },
  {
    rule: "testimonial-needs-consent",
    severity: "review",
    pattern: /("[^"]{10,}"\s*[—–-]\s*[A-Z][a-z]+)|\btestimonial\b/i,
    advice: "Testimonials must be genuine, unedited in meaning, and published with the client's written consent.",
  },
  {
    rule: "breathwork-safety",
    severity: "review",
    pattern: /\b(breathwork|holotropic|hyperventilat\w*|rebirthing)\b/i,
    advice: "Breathwork content should mention it isn't suitable for everyone and invite people with health conditions to check first.",
  },
  {
    rule: "income-or-life-promise",
    severity: "review",
    pattern: /\b(transform your life in|change your life forever|manifest (money|wealth)|attract (money|wealth))\b/i,
    advice: "Avoid absolute life-change or financial promises; soften to invitation language.",
  },
];

export function checkClaims(text: string): ClaimFlag[] {
  const flags: ClaimFlag[] = [];
  for (const r of RULES) {
    const m = text.match(r.pattern);
    if (m) flags.push({ rule: r.rule, severity: r.severity, match: m[0], advice: r.advice });
  }
  return flags;
}

export const isBlocked = (flags: ClaimFlag[]) => flags.some((f) => f.severity === "block");

/** Conversation-level escalation: topics an AI assistant must hand to Felicia (or emergency services). */
const ESCALATE: { reason: string; pattern: RegExp }[] = [
  { reason: "possible crisis / risk of harm", pattern: /\b(suicid\w*|kill myself|end my life|self[- ]harm\w*|hurt myself|don'?t want to (live|be here))\b/i },
  { reason: "medical question", pattern: /\b(medications?|pregnan\w*|heart condition|epilep\w*|seizures?|diagnos\w*|prescri\w*|blood pressure|surgery|asthma)\b/i },
  { reason: "complaint or dispute", pattern: /\b(refund|complain|chargeback|solicitor|lawyer|unhappy with|legal action)\b/i },
  { reason: "safeguarding", pattern: /\b(abuse|abused|unsafe at home|domestic violence)\b/i },
];

export function escalationReason(message: string): string | null {
  return ESCALATE.find((e) => e.pattern.test(message))?.reason ?? null;
}

export const CRISIS_RESPONSE =
  "I'm an AI assistant, and I want to make sure you get the right support. If you are in immediate danger, please call 999 (UK) or your local emergency number. In the UK you can also call Samaritans free, any time, on 116 123. I've passed your message to Felicia so a person can follow up with you.";
