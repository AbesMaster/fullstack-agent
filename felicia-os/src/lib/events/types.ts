import { z } from "zod";

/** Typed domain events. Every event carries a correlationId and idempotencyKey (outbox columns). */
export const EventSchemas = {
  LEAD_CREATED: z.object({ enquiryId: z.string(), contactId: z.string() }),
  LEAD_QUALIFIED: z.object({ enquiryId: z.string(), contactId: z.string(), bookingIntent: z.enum(["high", "medium", "low", "unknown"]) }),
  ENQUIRY_ESCALATED: z.object({ enquiryId: z.string(), reason: z.string() }),
  BOOKING_REQUESTED: z.object({ bookingId: z.string() }),
  BOOKING_CONFIRMED: z.object({ bookingId: z.string() }),
  BOOKING_CANCELLED: z.object({ bookingId: z.string(), reason: z.string() }),
  BOOKING_RESCHEDULED: z.object({ bookingId: z.string(), previousStartsAt: z.string() }),
  PAYMENT_CONFIRMED: z.object({ paymentId: z.string(), bookingId: z.string().nullable(), registrationId: z.string().nullable() }),
  PAYMENT_FAILED: z.object({ paymentId: z.string(), bookingId: z.string().nullable() }),
  REFUND_REQUESTED: z.object({ refundRequestId: z.string() }),
  INTAKE_SUBMITTED: z.object({ intakeId: z.string(), bookingId: z.string(), requiresReview: z.boolean() }),
  SESSION_COMPLETED: z.object({ bookingId: z.string() }),
  EVENT_REGISTRATION_CREATED: z.object({ registrationId: z.string(), eventId: z.string() }),
  CONTENT_SUBMITTED: z.object({ contentId: z.string() }),
  APPROVAL_DECIDED: z.object({ approvalId: z.string(), status: z.enum(["approved", "rejected"]) }),
  BUDGET_ALERT: z.object({ rule: z.string(), message: z.string() }),
} as const;

export type EventType = keyof typeof EventSchemas;
export type EventPayload<T extends EventType> = z.infer<(typeof EventSchemas)[T]>;

export type DomainEvent<T extends EventType = EventType> = {
  id: string;
  type: T;
  payload: EventPayload<T>;
  correlationId: string;
  attempts: number;
};
