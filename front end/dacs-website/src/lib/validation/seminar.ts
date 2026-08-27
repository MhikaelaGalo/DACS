import { z } from "zod";

/**
 * Seminar Registration form (Figma 252:124 / 252:2206).
 * The Module 2/3 "Date Completed" dropdowns are only enabled — and required —
 * when the farmer answers "Yes" to "Are you a re-enrollee?".
 */
export const seminarRegistrationSchema = z
  .object({
    fullName: z.string().min(1, "Full name is required"),
    email: z.string().min(1, "Email is required").email("Enter a valid email"),
    contactNumber: z.string().min(1, "Contact number is required"),
    gender: z.string().min(1, "Gender is required"),
    facebookName: z.string().min(1, "Facebook/Messenger name is required"),
    occupation: z.string().min(1, "Occupation is required"),
    homeFarmAddress: z.string().min(1, "Home / farm address is required"),
    country: z.string().min(1, "Current residence country is required"),
    isReEnrollee: z.boolean(),
    module2DateCompleted: z.string(),
    module3DateCompleted: z.string(),
    seminarIds: z.array(z.string()).min(1, "Please select a seminar module."),
  })
  .superRefine((data, ctx) => {
    if (data.isReEnrollee) {
      if (!data.module2DateCompleted) {
        ctx.addIssue({
          code: "custom",
          message: "Module 2 date completed is required",
          path: ["module2DateCompleted"],
        });
      }
      if (!data.module3DateCompleted) {
        ctx.addIssue({
          code: "custom",
          message: "Module 3 date completed is required",
          path: ["module3DateCompleted"],
        });
      }
    }
  });

export type SeminarRegistrationFormValues = z.infer<
  typeof seminarRegistrationSchema
>;
