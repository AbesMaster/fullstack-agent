import {
  pgTable,
  pgEnum,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  vector,
  date,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Enums                                                              */
/* ------------------------------------------------------------------ */

export const roleEnum = pgEnum("role", ["owner", "admin", "staff", "viewer"]);
export const serviceStatusEnum = pgEnum("service_status", ["proposed", "active", "paused", "archived"]);
export const deliveryModeEnum = pgEnum("delivery_mode", ["online", "in_person", "hybrid"]);
export const bookingStatusEnum = pgEnum("booking_status", [
  "pending_payment",
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "succeeded",
  "failed",
  "refunded",
  "partially_refunded",
]);
export const approvalStatusEnum = pgEnum("approval_status", ["pending", "approved", "rejected", "expired"]);
export const outboxStatusEnum = pgEnum("outbox_status", ["pending", "processing", "done", "dead"]);
export const taskStatusEnum = pgEnum("task_status", ["queued", "running", "succeeded", "failed", "blocked"]);
export const verificationEnum = pgEnum("verification_status", ["verified", "assumption", "draft"]);
export const contentStatusEnum = pgEnum("content_status", [
  "idea",
  "brief",
  "draft",
  "compliance_review",
  "awaiting_approval",
  "approved",
  "scheduled",
  "published",
  "rejected",
]);

const id = () => text("id").primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/* ------------------------------------------------------------------ */
/* Identity & access                                                  */
/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: roleEnum("role").notNull().default("viewer"),
  passwordHash: text("password_hash").notNull(),
  totpSecret: text("totp_secret"),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Service catalogue                                                  */
/* ------------------------------------------------------------------ */

export const services = pgTable("services", {
  id: id(), // stable slug, e.g. "signature-private-session"
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  durationMinutes: integer("duration_minutes"),
  priceMinor: integer("price_minor").notNull(), // pence; lower bound for ranges
  priceMaxMinor: integer("price_max_minor"), // upper bound for ranged prices
  currency: text("currency").notNull().default("GBP"),
  priceUnit: text("price_unit").notNull().default("per_booking"), // per_booking | per_participant | per_programme
  deliveryMode: deliveryModeEnum("delivery_mode").notNull().default("online"),
  bookingRules: jsonb("booking_rules").$type<BookingRules>().notNull(),
  cancellationTerms: text("cancellation_terms").notNull(),
  capacity: integer("capacity").notNull().default(1),
  taxConfig: jsonb("tax_config").$type<{ vatRegistered: boolean; ratePercent: number; inclusive: boolean }>().notNull(),
  availability: jsonb("availability").$type<{ days: number[]; startHour: number; endHour: number; timezone: string }>().notNull(),
  status: serviceStatusEnum("status").notNull().default("proposed"),
  ownerApprovedPrice: boolean("owner_approved_price").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  updatedAt: updatedAt(),
});

export type BookingRules = {
  minNoticeHours: number;
  maxAdvanceDays: number;
  bufferMinutes: number;
  requiresDiscoveryCall: boolean;
  requiresIntake: boolean;
  breathworkScreening: boolean;
};

/* ------------------------------------------------------------------ */
/* CRM (minimum necessary data — NO health information here)         */
/* ------------------------------------------------------------------ */

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    country: text("country"),
    timezone: text("timezone"),
    source: text("source").notNull(), // website_form | discovery_booking | partner_referral | event | manual
    sourceDetail: text("source_detail"),
    lifecycleStage: text("lifecycle_stage").notNull().default("lead"), // subscriber|lead|discovery|client|returning_client
    marketingConsent: boolean("marketing_consent").notNull().default(false),
    marketingConsentAt: timestamp("marketing_consent_at", { withTimezone: true }),
    marketingConsentSource: text("marketing_consent_source"),
    crmExternalId: text("crm_external_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("contacts_email_uq").on(t.email)],
);

export const enquiries = pgTable("enquiries", {
  id: id(),
  contactId: text("contact_id").notNull().references(() => contacts.id),
  message: text("message").notNull(),
  interestServiceId: text("interest_service_id").references(() => services.id),
  channel: text("channel").notNull(),
  status: text("status").notNull().default("new"), // new|qualified|responded|booked|closed|escalated
  bookingIntent: text("booking_intent").notNull().default("unknown"), // high|medium|low|unknown
  escalationReason: text("escalation_reason"),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Bookings, payments, intake                                         */
/* ------------------------------------------------------------------ */

export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    contactId: text("contact_id").notNull().references(() => contacts.id),
    serviceId: text("service_id").notNull().references(() => services.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    clientTimezone: text("client_timezone").notNull(),
    participants: integer("participants").notNull().default(1),
    status: bookingStatusEnum("status").notNull().default("pending_payment"),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull().default("GBP"),
    calendarEventId: text("calendar_event_id"),
    /** online | in_person. Fixed by the service, or chosen by the client for hybrid services. */
    attendanceMode: text("attendance_mode").notNull().default("online"),
    /** Video meeting for online sessions. The host start link is never stored (Felicia starts meetings from her Zoom app). */
    videoMeetingId: text("video_meeting_id"),
    videoJoinUrl: text("video_join_url"),
    videoPasscode: text("video_passcode"),
    idempotencyKey: text("idempotency_key").notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("bookings_idem_uq").on(t.idempotencyKey), index("bookings_starts_idx").on(t.startsAt)],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    provider: text("provider").notNull(), // stripe | paypal | mock
    providerRef: text("provider_ref").notNull(),
    bookingId: text("booking_id").references(() => bookings.id),
    registrationId: text("registration_id"),
    amountMinor: integer("amount_minor").notNull(),
    feeMinor: integer("fee_minor").notNull().default(0),
    refundedMinor: integer("refunded_minor").notNull().default(0),
    currency: text("currency").notNull().default("GBP"),
    status: paymentStatusEnum("status").notNull().default("pending"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("payments_provider_ref_uq").on(t.provider, t.providerRef)],
);

export const refundRequests = pgTable("refund_requests", {
  id: id(),
  paymentId: text("payment_id").notNull().references(() => payments.id),
  amountMinor: integer("amount_minor").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending_review"), // pending_review|approved|rejected|processed
  approvalId: text("approval_id"),
  createdAt: createdAt(),
});

/** Sensitive: encrypted at rest with DATA_ENCRYPTION_KEY, separate from CRM. */
export const intakeRecords = pgTable("intake_records", {
  id: id(),
  bookingId: text("booking_id").notNull().references(() => bookings.id),
  encryptedPayload: text("encrypted_payload").notNull(),
  consentVersion: text("consent_version").notNull(),
  consentSignedAt: timestamp("consent_signed_at", { withTimezone: true }).notNull(),
  requiresReview: boolean("requires_review").notNull().default(false), // e.g. breathwork contraindication flagged
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Events, retreats, workshops                                        */
/* ------------------------------------------------------------------ */

export const programmeEvents = pgTable("programme_events", {
  id: id(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  includesBreathwork: boolean("includes_breathwork").notNull().default(false),
  isOnline: boolean("is_online").notNull().default(false),
  videoMeetingId: text("video_meeting_id"),
  videoJoinUrl: text("video_join_url"),
  videoPasscode: text("video_passcode"),
  serviceId: text("service_id").references(() => services.id),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  location: text("location").notNull(),
  capacity: integer("capacity").notNull(),
  priceMinor: integer("price_minor").notNull(),
  budgetMinor: integer("budget_minor").notNull().default(0),
  status: text("status").notNull().default("planning"), // planning|open|full|closed|completed|cancelled
  checklist: jsonb("checklist").$type<{ item: string; done: boolean }[]>().notNull().default([]),
  createdAt: createdAt(),
});

export const eventRegistrations = pgTable(
  "event_registrations",
  {
    id: id(),
    eventId: text("event_id").notNull().references(() => programmeEvents.id),
    contactId: text("contact_id").notNull().references(() => contacts.id),
    status: text("status").notNull().default("pending_payment"), // pending_payment|confirmed|cancelled|attended
    amountMinor: integer("amount_minor").notNull().default(0),
    /** When the current unpaid hold began (reset if a cancelled registrant registers again). */
    holdStartedAt: timestamp("hold_started_at", { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("event_reg_uq").on(t.eventId, t.contactId)],
);

/* ------------------------------------------------------------------ */
/* Finance                                                            */
/* ------------------------------------------------------------------ */

export const expenses = pgTable("expenses", {
  id: id(),
  category: text("category").notNull(), // marketing|software|venue|travel|insurance|professional_fees|other
  description: text("description").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull().default("GBP"),
  incurredOn: date("incurred_on").notNull(),
  eventId: text("event_id"),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Agents, approvals, events, audit                                   */
/* ------------------------------------------------------------------ */

export const approvals = pgTable("approvals", {
  id: id(),
  action: text("action").notNull(),
  agentId: text("agent_id").notNull(),
  summary: text("summary").notNull(),
  payload: jsonb("payload").notNull(),
  status: approvalStatusEnum("status").notNull().default("pending"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  createdAt: createdAt(),
});

export const agentTasks = pgTable(
  "agent_tasks",
  {
    id: id(),
    agentId: text("agent_id").notNull(),
    kind: text("kind").notNull(),
    status: taskStatusEnum("status").notNull().default("queued"),
    correlationId: text("correlation_id"),
    input: jsonb("input"),
    output: jsonb("output"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("agent_tasks_agent_idx").on(t.agentId)],
);

/** Transactional outbox: typed domain events processed with retries + DLQ. */
export const domainEvents = pgTable(
  "domain_events",
  {
    id: id(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    correlationId: text("correlation_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: outboxStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("domain_events_idem_uq").on(t.idempotencyKey), index("domain_events_status_idx").on(t.status)],
);

/** Records which handler already processed which event — exactly-once side effects. */
export const handlerReceipts = pgTable(
  "handler_receipts",
  {
    eventId: text("event_id").notNull(),
    handler: text("handler").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("handler_receipts_uq").on(t.eventId, t.handler)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actor: text("actor").notNull(), // user:<id> | agent:<id> | system | webhook:<provider>
    action: text("action").notNull(),
    target: text("target"),
    correlationId: text("correlation_id"),
    metadata: jsonb("metadata"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_at_idx").on(t.at)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: text("updated_by"),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ */
/* Email consent                                                      */
/* ------------------------------------------------------------------ */

export const emailSuppressions = pgTable("email_suppressions", {
  email: text("email").primaryKey(),
  reason: text("reason").notNull(), // unsubscribed|bounced|complaint|manual
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const emailLog = pgTable("email_log", {
  id: id(),
  template: text("template").notNull(),
  to: text("to_address").notNull(),
  kind: text("kind").notNull(), // transactional | marketing
  status: text("status").notNull(), // sent|suppressed|blocked_no_consent|failed|mock_sent
  correlationId: text("correlation_id"),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Knowledge base (RAG)                                               */
/* ------------------------------------------------------------------ */

export const EMBEDDING_DIM = 256;

export const knowledgeDocuments = pgTable("knowledge_documents", {
  id: id(),
  title: text("title").notNull(),
  section: text("section").notNull(), // A–Q of the directive (identity, pricing, …)
  source: text("source").notNull(),
  format: text("format").notNull(),
  owner: text("owner").notNull(),
  version: integer("version").notNull().default(1),
  accessLevel: text("access_level").notNull().default("internal"), // public|internal|restricted
  verificationStatus: verificationEnum("verification_status").notNull().default("draft"),
  contentHash: text("content_hash").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: id(),
    documentId: text("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    text: text("text").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }).notNull(),
  },
  (t) => [index("knowledge_chunks_doc_idx").on(t.documentId)],
);

/* ------------------------------------------------------------------ */
/* Marketing content pipeline                                         */
/* ------------------------------------------------------------------ */

export const contentItems = pgTable("content_items", {
  id: id(),
  channel: text("channel").notNull(), // instagram|facebook|tiktok|youtube|email|landing_page
  category: text("category").notNull(),
  format: text("format").notNull(), // caption|short_script|carousel|email|landing_copy|brief
  title: text("title").notNull(),
  body: text("body").notNull(),
  status: contentStatusEnum("status").notNull().default("idea"),
  complianceFlags: jsonb("compliance_flags").$type<string[]>().notNull().default([]),
  version: integer("version").notNull().default(1),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ */
/* Optional client feedback (published only with explicit consent)    */
/* ------------------------------------------------------------------ */

export const feedback = pgTable(
  "feedback",
  {
    id: id(),
    bookingId: text("booking_id").notNull().references(() => bookings.id),
    rating: integer("rating"),
    comment: text("comment"),
    consentToPublish: boolean("consent_to_publish").notNull().default(false),
    publishName: text("publish_name"), // how the client wants to be credited, if at all
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("feedback_booking_uq").on(t.bookingId)],
);

/* ------------------------------------------------------------------ */
/* First-party, cookieless website analytics                          */
/* No cookies, no IP addresses, no personal data. A visitor is only    */
/* recognisable within one day via a salted hash whose salt is thrown  */
/* away daily, so visits can't be linked across days or to a person.   */
/* ------------------------------------------------------------------ */

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: id(),
    day: date("day").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    name: text("name").notNull(), // pageview | cta_click | enquiry_submitted | booking_requested | booking_confirmed | event_registration | chat_opened
    path: text("path").notNull(),
    label: text("label"), // e.g. which CTA was clicked
    referrerHost: text("referrer_host"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    device: text("device").notNull(), // mobile | tablet | desktop
    visitorHash: text("visitor_hash").notNull(),
  },
  (t) => [index("analytics_day_idx").on(t.day), index("analytics_name_day_idx").on(t.name, t.day)],
);
