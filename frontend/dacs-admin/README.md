# DACS Admin

Staff portal for Dominant Asia Poultry Genetics (Owner / Administrative
Staff / Staff). Companion app to `dacs-website` (the customer site);
both talk to the Express backend in `back end/`.

```
npm install
npm run dev     # http://localhost:3001 (customer site uses :3000)
```

Sign-in is mocked: any email (or the Google button) signs you in as the
Owner. The Switch Role button on restricted pages cycles Owner ->
Administrative Staff -> Staff to demonstrate the access rules.

## Status

UI complete against the approved Figma mockups, running on mock data.
Not yet wired to the backend — that is the integration phase.

## Integration map (mock -> real API)

Every mock's shape mirrors the backend response, so each swap is
"replace the import with a fetch":

| Mock | Real endpoint |
|---|---|
| `data/mock-analytics.ts` | `GET /api/analytics/dashboard` |
| `data/mock-tables.ts` (queue) | `GET /api/orders`, `PATCH /api/orders/:id/status` |
| `data/mock-tables.ts` (seminar/breeder/ticket) | `GET /api/seminars/...`, `/api/breeders`, `/api/inquiries` |
| `data/mock-seminars.ts` | `GET/POST /api/seminars/modules...` |
| `data/mock-settings.ts` (files) | `GET/POST/DELETE /api/historical/files` |
| `data/mock-settings.ts` (users) | `GET /api/users`, role/status PATCHes |
| `data/mock-settings.ts` (audit logs) | activity-log read endpoint (to be added to backend) |
| `data/mock-settings.ts` (notifications) | `GET /api/notifications`, `/unread-count`, `PATCH .../read` |
| Settings > Notifications tab | `GET/PATCH /api/notifications/preferences` |
| `lib/auth.ts` | Firebase SDK sign-in (email/password + Google) + `POST /api/auth/sync`, `GET /api/auth/me` |
| Form builder publish (`localStorage`) | forms tables + endpoints (to be added to backend) |

## Notes

- Chart palette (`components/charts/ChartTheme.ts`) passed the dataviz
  six-checks validator; status charts use semantic colors (green =
  good, amber = pending, red = rejected/expired).
- "Create Visual" (custom chart builder) and the Philippines map are
  later phases; Breeders-by-Province bars consume the same per-province
  numbers a map would.
