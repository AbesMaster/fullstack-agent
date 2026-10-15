import { publicUrl } from "../config/env";
/**
 * Approved email templates. Transactional templates may be sent to any client with a
 * relevant booking/enquiry; MARKETING templates require recorded consent and always
 * carry an unsubscribe link (enforced in email/send.ts).
 */
export type TemplateKind = "transactional" | "marketing";

export type TemplateId =
  | "enquiry_welcome"
  | "discovery_booking_confirmation"
  | "appointment_reminder"
  | "post_discovery_follow_up"
  | "payment_confirmation"
  | "session_preparation"
  | "post_session_thank_you"
  | "feedback_request"
  | "newsletter_welcome"
  | "workshop_registration"
  | "event_reminder"
  | "cancellation_confirmation"
  | "rescheduling_confirmation"
  | "portal_sign_in";

type Vars = Record<string, string>;
type Template = { kind: TemplateKind; subject: (v: Vars) => string; body: (v: Vars) => string; requiredVars: string[] };

const SIGN_OFF = () => `\n\nWith warmth,\nThe MetaMasterMindz team on behalf of Felicia Stefan\n${publicUrl()}`;
const WELLBEING_NOTE =
  "\n\nPlease note: Felicia's sessions support personal development and wellbeing. They are not a substitute for medical or psychological care. If you have a health concern, please speak to a qualified healthcare professional.";

export const TEMPLATES: Record<TemplateId, Template> = {
  enquiry_welcome: {
    kind: "transactional",
    requiredVars: ["name"],
    subject: () => "Thank you for reaching out",
    body: (v) => `Dear ${v.name},\n\nThank you for getting in touch. Your message has been received and a member of the team (or Felicia herself) will reply within two working days.\n\nIf you'd like to talk things through, you're welcome to book a complimentary 20-minute discovery call: ${v.bookingUrl ?? `${publicUrl()}/book`}${SIGN_OFF()}`,
  },
  discovery_booking_confirmation: {
    kind: "transactional",
    requiredVars: ["name", "when"],
    subject: () => "Your discovery call is confirmed",
    body: (v) => `Dear ${v.name},\n\nYour complimentary discovery call is booked for ${v.when}.\n\n${v.joinInfo ?? "Joining details will follow before the call."}\n\nNeed to change the time? Reply to this email and we'll help.${SIGN_OFF()}`,
  },
  appointment_reminder: {
    kind: "transactional",
    requiredVars: ["name", "service", "when"],
    subject: (v) => `Reminder: ${v.service} on ${v.when}`,
    body: (v) => `Dear ${v.name},\n\nA gentle reminder that your ${v.service} is on ${v.when}.\n\n${v.joinInfo ?? ""}${SIGN_OFF()}`,
  },
  post_discovery_follow_up: {
    kind: "transactional",
    requiredVars: ["name"],
    subject: () => "Thank you for our conversation",
    body: (v) => `Dear ${v.name},\n\nThank you for your time on our discovery call. ${v.recommendation ?? ""}\n\nThere's no pressure at all — whenever you feel ready, you can explore and book here: ${v.bookingUrl ?? `${publicUrl()}/sessions`}${SIGN_OFF()}`,
  },
  payment_confirmation: {
    kind: "transactional",
    requiredVars: ["name", "service", "amount", "reference"],
    subject: () => "Payment received — thank you",
    body: (v) => `Dear ${v.name},\n\nWe've received your payment of ${v.amount} for ${v.service}.\nReference: ${v.reference}\n\nYour receipt is available from the payment provider. Our cancellation and refund policy: ${publicUrl()}/cancellation-policy${SIGN_OFF()}`,
  },
  session_preparation: {
    kind: "transactional",
    requiredVars: ["name", "service", "when", "intakeUrl"],
    subject: () => "Preparing for your session",
    body: (v) => `Dear ${v.name},\n\nYour ${v.service} is on ${v.when}.${v.joinInfo ? `\n\n${v.joinInfo}` : ""}\n\nTo help Felicia prepare, please complete your short welcome and consent form: ${v.intakeUrl}\n\nWear comfortable clothing, have water nearby, and allow a little quiet time afterwards.\n\nIf the session includes breathwork, the form asks a few health questions so we can keep you safe. Answers are encrypted and seen only by Felicia.${WELLBEING_NOTE}${SIGN_OFF()}`,
  },
  post_session_thank_you: {
    kind: "transactional",
    requiredVars: ["name"],
    subject: () => "Thank you for today",
    body: (v) => `Dear ${v.name},\n\nThank you for today's session. Be gentle with yourself over the next day or two, drink plenty of water and give yourself space to integrate.\n\n${v.materials ?? ""}${SIGN_OFF()}`,
  },
  feedback_request: {
    kind: "transactional",
    requiredVars: ["name", "feedbackUrl"],
    subject: () => "Would you share a few words? (optional)",
    body: (v) => `Dear ${v.name},\n\nIf you'd like to, we'd love to hear how your experience was: ${v.feedbackUrl}\n\nThis is completely optional, and we will only publish your words with your explicit permission.${SIGN_OFF()}`,
  },
  newsletter_welcome: {
    kind: "marketing",
    requiredVars: ["name"],
    subject: () => "Welcome — Return to Wonder",
    body: (v) => `Dear ${v.name},\n\nThank you for joining. Expect occasional letters on breathwork, conscious living and upcoming experiences — never more than twice a month.${SIGN_OFF()}`,
  },
  workshop_registration: {
    kind: "transactional",
    requiredVars: ["name", "event", "when", "location"],
    subject: (v) => `You're registered: ${v.event}`,
    body: (v) => `Dear ${v.name},\n\nYou're registered for ${v.event} on ${v.when} at ${v.location}.${v.joinInfo ? `\n\n${v.joinInfo}` : ""}${v.healthNote ? `\n\n${v.healthNote}` : ""}${WELLBEING_NOTE}${SIGN_OFF()}`,
  },
  event_reminder: {
    kind: "transactional",
    requiredVars: ["name", "event", "when"],
    subject: (v) => `Coming up: ${v.event}`,
    body: (v) => `Dear ${v.name},\n\n${v.event} is on ${v.when}. ${v.logistics ?? ""}${SIGN_OFF()}`,
  },
  cancellation_confirmation: {
    kind: "transactional",
    requiredVars: ["name", "service"],
    subject: () => "Your booking has been cancelled",
    body: (v) => `Dear ${v.name},\n\nYour ${v.service} booking has been cancelled. ${v.refundNote ?? ""}\n\nYou're always welcome to book again.${SIGN_OFF()}`,
  },
  rescheduling_confirmation: {
    kind: "transactional",
    requiredVars: ["name", "service", "when"],
    subject: () => "Your session has been rescheduled",
    body: (v) => `Dear ${v.name},\n\nYour ${v.service} is now on ${v.when}.${v.joinInfo ? `\n\n${v.joinInfo}` : ""}${SIGN_OFF()}`,
  },
  portal_sign_in: {
    kind: "transactional",
    requiredVars: ["name", "link"],
    subject: () => "Your sign-in link",
    body: (v) => `Dear ${v.name},\n\nHere is your link to sign in to your MetaMasterMindz client area:\n${v.link}\n\nIt works once and expires in 15 minutes. If you didn't ask for it, you can ignore this email; nobody can sign in without it.${SIGN_OFF()}`,
  },
};

export function renderTemplate(id: TemplateId, vars: Vars) {
  const t = TEMPLATES[id];
  const missing = t.requiredVars.filter((k) => !vars[k]);
  if (missing.length) throw new Error(`Template ${id} missing variables: ${missing.join(", ")}`);
  return { kind: t.kind, subject: t.subject(vars), text: t.body(vars) };
}
