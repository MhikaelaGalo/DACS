import { z } from "zod";

export const registerSchema = z
  .object({
    fullName: z
      .string()
      .min(1, "Full name is required")
      .refine((value) => value.trim().split(/\s+/).length >= 2, {
        message: "Enter your first and last name",
      }),
    email: z.string().min(1, "Email is required").email("Enter a valid email"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
    contactNumber: z
      .string()
      .min(1, "Contact number is required")
      // Matches the DACS backend's phone validation.
      .regex(/^\+?\d[\d\s-]{5,19}$/, "Enter a valid contact number"),
    completeAddress: z.string().min(1, "Complete address is required"),
    farmName: z.string().min(1, "Farm name is required"),
    farmAddress: z.string().min(1, "Farm address is required"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type RegisterFormValues = z.infer<typeof registerSchema>;

export const signInSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export type SignInFormValues = z.infer<typeof signInSchema>;

export const forgotPasswordEmailSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
});

export type ForgotPasswordEmailValues = z.infer<typeof forgotPasswordEmailSchema>;

export const forgotPasswordCodeSchema = z.object({
  code: z.string().min(1, "Code is required"),
});

export type ForgotPasswordCodeValues = z.infer<typeof forgotPasswordCodeSchema>;

export const newPasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type NewPasswordValues = z.infer<typeof newPasswordSchema>;
