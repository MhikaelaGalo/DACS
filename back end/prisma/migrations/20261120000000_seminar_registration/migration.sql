-- Legacy enrollments could be started without submitting the registration form.
ALTER TABLE "seminar_enrollments" ADD COLUMN "registered_at" TIMESTAMP(3);
