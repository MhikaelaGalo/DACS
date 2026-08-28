import { z } from "zod";

// Schemas for the account-section edit forms (Personal Information,
// Farm Information, Security). The Figma edit frames show no required-field
// asterisks, so validation mirrors the auth schemas' plain messages.

export const personalInfoSchema = z.object({
  fullName: z
    .string()
    .min(1, "Full name is required")
    .refine((value) => value.trim().split(/\s+/).length >= 2, {
      message: "Enter your first and last name",
    }),
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  contactNumber: z
    .string()
    .min(1, "Contact number is required")
    // Matches the DACS backend's phone validation.
    .regex(/^\+?\d[\d\s-]{5,19}$/, "Enter a valid contact number"),
  facebookName: z.string(),
  occupation: z.string(),
  completeAddress: z.string().min(1, "Complete address is required"),
});

export type PersonalInfoFormValues = z.infer<typeof personalInfoSchema>;

export const farmDetailsSchema = z.object({
  farmName: z.string().min(1, "Farm name is required"),
  farmAddress: z.string().min(1, "Farm address is required"),
});

export type FarmDetailsFormValues = z.infer<typeof farmDetailsSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmNewPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "Passwords do not match",
    path: ["confirmNewPassword"],
  });

export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;
