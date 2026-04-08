import { z } from "zod";

export const ChallengeRequestSchema = z.object({
  eoa: z.string().min(1, "eoa must not be empty"),
});

export const AuthVerifyRequestSchema = z.object({
  eoa: z.string().min(1, "eoa must not be empty"),
  publicKey: z.string().min(1, "publicKey must not be empty"),
  message: z.string().min(1, "message must not be empty"),
  signature: z.string().min(1, "signature must not be empty"),
});

export type ChallengeRequestInput = z.input<typeof ChallengeRequestSchema>;
export type AuthVerifyRequestInput = z.input<typeof AuthVerifyRequestSchema>;
