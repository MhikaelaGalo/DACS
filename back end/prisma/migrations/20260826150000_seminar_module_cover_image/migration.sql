-- Customer-facing card artwork per seminar module. Additive only: the
-- column is nullable, so existing modules simply have no cover image
-- until staff upload one from the module editor.
ALTER TABLE "seminar_modules" ADD COLUMN "cover_image_url" TEXT;
