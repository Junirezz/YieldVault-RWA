import { z } from "zod";

export const settingsFormSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters.")
    .max(30, "Username cannot exceed 30 characters.")
    .regex(/^[a-zA-Z0-9_-]+$/, "Username can only contain letters, numbers, underscores, and hyphens."),
  email: z.string().email("Please enter a valid email address."),
  slippageTolerance: z
    .string()
    .refine((val) => !isNaN(Number(val)) && Number(val) >= 0.1 && Number(val) <= 5.0, {
      message: "Slippage tolerance must be between 0.1% and 5.0%.",
    }),
  currency: z.enum(["USD", "EUR", "GBP", "XLM"], {
    errorMap: () => ({ message: "Please select a supported currency." }),
  }),
});

export type SettingsFormValues = z.infer<typeof settingsFormSchema>;
