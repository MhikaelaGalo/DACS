-- Delete-button backend support: seminar modules and videos gain an
-- archive timestamp so records with farmer history (enrollments /
-- watch progress) are archived by DELETE instead of destroyed.
-- Additive with NULL default: existing rows read as "not archived".

ALTER TABLE "seminar_modules" ADD COLUMN "archived_at" TIMESTAMP(3);
ALTER TABLE "seminar_videos" ADD COLUMN "archived_at" TIMESTAMP(3);
