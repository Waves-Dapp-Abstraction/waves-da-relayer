import { z } from "zod";

const PaymentSchema = z.object({
  amount: z
    .number()
    .int("payment.amount must be an integer")
    .positive("payment.amount must be positive"),
  assetId: z
    .string()
    .min(1, "payment.assetId must not be empty if provided")
    .optional(),
});

const ArgSchema = z.union([
  z.number(),
  z.string(),
  z.boolean(),
]);

export const InvokeRequestSchema = z.object({
  eoa: z
    .string()
    .min(1, "eoa must not be empty"),

  targetDapp: z
    .string()
    .min(1, "targetDapp must not be empty"),

  function: z
    .string()
    .min(1, "function must not be empty"),

  args: z
    .array(ArgSchema)
    .default([]),

  payments: z
    .array(PaymentSchema)
    .max(2, "payments must contain at most 2 entries")
    .default([]),
});

export type InvokeRequestInput = z.input<typeof InvokeRequestSchema>;
export type InvokeRequestParsed = z.output<typeof InvokeRequestSchema>;
