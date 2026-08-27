-- Track content edits made after a seminar module was published, so the
-- admin UI can show "Published • Unpublished changes" and require an
-- explicit re-publish. Additive with a default: existing rows read as
-- "no pending changes".
ALTER TABLE "seminar_modules" ADD COLUMN "has_unpublished_changes" BOOLEAN NOT NULL DEFAULT false;
