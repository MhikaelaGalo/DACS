-- Forms foundation: persist the admin form builder's definitions so the
-- Form Delete button has a real backend. form_submissions exists from
-- day one so deletion can be history-aware (submissions RESTRICT the
-- form row; DELETE archives instead of destroying history).

CREATE TABLE "forms" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  "archived_at" TIMESTAMP(3),
  "created_by_user_id" TEXT,
  "updated_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "forms_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "forms_is_published_idx" ON "forms"("is_published");
CREATE INDEX "forms_archived_at_idx" ON "forms"("archived_at");

ALTER TABLE "forms"
  ADD CONSTRAINT "forms_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "forms"
  ADD CONSTRAINT "forms_updated_by_user_id_fkey"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "form_fields" (
  "id" TEXT NOT NULL,
  "form_id" TEXT NOT NULL,
  "field_type" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "display_order" INTEGER NOT NULL DEFAULT 1,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "placeholder" TEXT,
  "allow_other" BOOLEAN NOT NULL DEFAULT false,
  "time_format" TEXT,
  "options" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "form_fields_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "form_fields_form_id_display_order_idx"
  ON "form_fields"("form_id", "display_order");

ALTER TABLE "form_fields"
  ADD CONSTRAINT "form_fields_form_id_fkey"
  FOREIGN KEY ("form_id") REFERENCES "forms"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "form_submissions" (
  "id" TEXT NOT NULL,
  "form_id" TEXT NOT NULL,
  "customer_profile_id" TEXT,
  "answers" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "form_submissions_form_id_idx" ON "form_submissions"("form_id");
CREATE INDEX "form_submissions_customer_profile_id_idx"
  ON "form_submissions"("customer_profile_id");

ALTER TABLE "form_submissions"
  ADD CONSTRAINT "form_submissions_form_id_fkey"
  FOREIGN KEY ("form_id") REFERENCES "forms"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "form_submissions"
  ADD CONSTRAINT "form_submissions_customer_profile_id_fkey"
  FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
