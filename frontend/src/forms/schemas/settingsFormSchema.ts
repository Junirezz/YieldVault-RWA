import { z } from "zod";
import {
  SLIPPAGE_RANGE_ERROR,
  isValidSlippagePercent,
} from "./slippageSchema";

export const settingsFormSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters.")
    .max(30, "Username cannot exceed 30 characters.")
    .regex(/^[a-zA-Z0-9_-]+$/, "Username can only contain letters, numbers, underscores, and hyphens."),
  email: z.string().email("Please enter a valid email address."),
  slippageTolerance: z
    .string()
    .refine((val) => isValidSlippagePercent(Number(val)), {
      message: SLIPPAGE_RANGE_ERROR,
    }),
  currency: z.enum(["USD", "EUR", "GBP", "XLM"], {
    error: () => ({ message: "Please select a supported currency." }),
  }),
});

export type SettingsFormValues = z.infer<typeof settingsFormSchema>;
