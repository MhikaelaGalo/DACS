-- Backend-driven Create Visual: custom visuals now reference the
-- analytics field catalog (data source + aggregation + optional date
-- bucket) instead of the removed frontend sample table. Legacy
-- sample-data visuals keep a NULL dataset and render an honest
-- "obsolete" state in the frontend — they are never silently remapped
-- onto real fields.
ALTER TABLE "dashboard_visuals" ADD COLUMN "dataset" TEXT;
ALTER TABLE "dashboard_visuals" ADD COLUMN "x_bucket" TEXT;
ALTER TABLE "dashboard_visuals" ADD COLUMN "aggregation" TEXT;

-- KPI label corrections (shipped default titles only; user-authored
-- titles are left alone):
--   * kpi-seminars counts APPROVED certificate_requests, not seminar
--     sales — DACS records no seminar revenue.
--   * monthly-sales plots the trailing 12 months, not one fixed year.
UPDATE "dashboard_visuals"
SET "title" = 'Seminar Certificates Issued'
WHERE "builtin" = 'kpi-seminars'
  AND "title" = 'Total # of Sales for Seminars';

UPDATE "dashboard_visuals"
SET "title" = 'Total # of Sales per Month (Last 12 Months)'
WHERE "builtin" = 'monthly-sales'
  AND "title" = 'Total # of Sales per Month for the year of 2026';
