-- Pre-authorization model for staff accounts:
-- an Owner may create a users row for a Google email before that
-- person has ever signed in, so firebase_uid becomes nullable (the
-- unique index still applies to non-null values only). display_name
-- and phone_number carry the staff directory fields that previously
-- had no home in the database.

ALTER TABLE "users" ALTER COLUMN "firebase_uid" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN "display_name" TEXT;
ALTER TABLE "users" ADD COLUMN "phone_number" TEXT;
