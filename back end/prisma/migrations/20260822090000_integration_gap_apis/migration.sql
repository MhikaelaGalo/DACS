-- Frontend-integration gap APIs (2026-08-22):
--   1. Seminar certificate-template reference on modules (file lives in
--      file storage, only the URL is persisted).
--   2. dashboard_visuals: per-user dashboard layout definitions (visual
--      type + builder field picks, never the computed data).
--   3. role_permissions: persisted overrides of the code-default
--      role-permission matrix (Settings > Roles and Permission).
--   4. activity_logs read-API indexes for the Audit Logs screen.
-- Everything is additive; no existing rows change.

ALTER TABLE "seminar_modules" ADD COLUMN "certificate_template_url" TEXT;

CREATE TABLE "dashboard_visuals" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "visual_type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "x_field" TEXT,
  "y_field" TEXT,
  "legend_field" TEXT,
  "builtin" TEXT,
  "display_order" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "dashboard_visuals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dashboard_visuals_user_id_display_order_idx"
  ON "dashboard_visuals"("user_id", "display_order");

ALTER TABLE "dashboard_visuals"
  ADD CONSTRAINT "dashboard_visuals_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "role_permissions" (
  "id" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "permission_module" TEXT NOT NULL,
  "allowed" BOOLEAN NOT NULL,
  "updated_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "role_permissions_role_permission_module_key"
  ON "role_permissions"("role", "permission_module");

ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_updated_by_user_id_fkey"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs"("created_at");
CREATE INDEX "activity_logs_user_id_idx" ON "activity_logs"("user_id");
CREATE INDEX "activity_logs_module_idx" ON "activity_logs"("module");
CREATE INDEX "activity_logs_action_idx" ON "activity_logs"("action");
