-- Seminar video uploads: the admin frontend uploads real video files
-- (multipart) instead of entering URLs. duration_seconds carries the
-- client-probed length; file_name keeps the original upload name for
-- the admin listing. Both stay null for URL-based videos.

ALTER TABLE "seminar_videos" ADD COLUMN "duration_seconds" INTEGER;
ALTER TABLE "seminar_videos" ADD COLUMN "file_name" TEXT;
