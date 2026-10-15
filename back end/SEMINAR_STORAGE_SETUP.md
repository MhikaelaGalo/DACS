# Seminar file storage setup

The application code is prepared for Neon Object Storage. Buckets, credentials,
deployment, and migration of the current local files still need to be completed.
The existing database and Firebase Authentication remain in use.

## 1. Check your plan and bandwidth before enabling storage

Confirm the account's plan and current usage in the Neon Console. As of October
15, 2026, Free includes 5 GB of stored objects and 5 GB of outbound transfer per
project per month. The transfer allowance is shared by PostgreSQL, Object
Storage, and Functions. Exhausting Free network transfer suspends database
compute until the next billing period or an upgrade.

Estimate transfer using the sum of each video's size multiplied by its expected
full views per month, plus images, certificates, database traffic, and replays.
For example: three 100 MB videos watched once by 20 farmers transfer about 6 GB.
The three existing local video files currently total approximately 19.5 MB;
250 complete views of that set would transfer roughly 4.9 GB before other usage.
Recalculate this estimate if the video files or expected audience change.
Stored capacity is not a monthly streaming allowance. Signed URLs restrict access
but do not reduce transfer. This implementation performs no automatic plan upgrades.

Official limits: [Neon plan and transfer limits](https://neon.com/docs/introduction/plans#public-network-transfer)

## 2. Create three buckets on the intended database branch

In Neon Console, select the DACS project and the branch used by the live database.
Open Object storage, choose New bucket, and create:

| Name | Access | Use |
| --- | --- | --- |
| dacs-seminar-covers | public_read | Cover artwork and seminar template uploads |
| dacs-seminar-videos | private | Seminar videos |
| dacs-farmer-certificates | private | Stored personalized certificates |

Keep all three buckets distinct. Private videos receive temporary playback URLs
only after the existing prerequisite/purchase checks. Farmer certificates are
served by authenticated owner-only download endpoints. Covers are public artwork.

Bucket setup: [Neon bucket instructions](https://neon.com/docs/storage/buckets)

## 3. Create storage credentials and add backend settings

Follow Neon's credential setup to obtain the branch's S3 endpoint, actual region,
Access Key ID, and Secret Access Key with storage read/write permission. Storage
credentials are different from the PostgreSQL connection string. Save the secret
when it is first shown and keep it out of GitHub, screenshots, and chat.

Append the values from `seminar-storage.env.example` to the existing local
backend `.env`, and add them to the live backend host's environment settings.
Use the endpoint and region supplied by Neon. Both backends must target the same
branch to share files, matching the current shared database workflow.

Keep `DATABASE_URL` and Firebase configuration. Keys belong on the backend; they
must not use a `NEXT_PUBLIC_` prefix or be placed in either frontend's environment.
Never replace `.env` wholesale with a generated environment file.

`SEMINAR_STORAGE_DRIVER=neon` opts into cloud uploads. Missing credentials in this
mode cause an explicit error, rather than silently saving uploads locally. The
default `local` mode preserves the existing development behavior.
In local mode, new certificates continue to be generated in the browser; the
archive step does not write new local certificate-file references into the shared
database. Permanent certificate storage begins only after Neon mode is enabled.

Credential setup: [Neon storage setup](https://neon.com/docs/storage/get-started)

## 4. Deploy and configure browser access

Deploy the backend and both frontends together: the editor needs the new video
replacement endpoint, and certificate downloads use the new archive endpoint.
Keep the frontends' API address set to the live HTTPS backend address.
Restart the local backend after adding its environment settings.

For browser playback, configure the video bucket's CORS rules to allow GET and
HEAD from the live website and admin origins and the local development origins
you use. Allow the Range header and expose Content-Range, Accept-Ranges, and
Content-Length where required. Do not make the video or certificate bucket public.
Video players request partial content for seeking; Neon supports Range requests.

The admin's current video previews use `preload="none"` so simply opening the
editor does not fetch every stored video. Replacement previews use local files.
Signed playback URLs expire (one hour by default); reload the module to refresh
an expired link. Long videos may need a longer configured lifetime.

S3/CORS/Range support: [Neon storage compatibility](https://neon.com/docs/storage/s3-compatibility)

## 5. Move existing covers and videos using Replace

Save a database backup and retain copies of the original files first. Open each
seminar in the admin editor and select Replace on its cover and each video.
Choose the original file, inspect its preview, then select Save changes. This
updates the existing video row, preserving its identity and farmer progress.
Do not add duplicate videos to migrate existing ones.

Each upload uses a new key. The database is switched after upload succeeds; only
then is the old unreferenced file deleted. If the database update fails, the new
unreferenced upload is cleaned up. Cleanup failures are logged for later review
and do not undo a successfully saved replacement.

After migration, confirm cover URLs are online HTTPS addresses and stored video
references use `neon://` object keys. Expiring signed URLs are generated for API
responses and are never saved as the permanent video reference.

## 6. Store certificates independently

A farmer or staff View/Download action archives an approved certificate once,
using its existing record and the packaged certificate design. The file is kept
in the private certificate bucket and linked to the certificate record. Existing
issue dates, status, number, validity, and stored copies are not replaced.

No seminar replacement, video removal, cover removal, or seminar deletion calls
certificate generation or deletes a farmer's certificate. Unreferenced JPEGs
left by the old workflow are not automatically attached to accounts or migrated.

## 7. Verify behavior and review cleanup later

Check local-to-live uploads, video playback and seeking, and certificate access.
Confirm a locked farmer cannot obtain a playback URL and another farmer cannot
download someone else's certificate. Test the UI cancellation and removal dialogs
without changing real seminars just to test them.

History-bearing seminars/videos use the existing archive behavior and retain
their media. Permanent deletion of a seminar without enrollment/purchase history
removes its unreferenced covers, templates, and videos after the database commit.

`npm run storage:report` is an optional read-only orphan report. It reads database
references in a read-only transaction and lists managed cover/video objects.
Archived references count as used. Unreferenced objects younger than 24 hours are
held aside because an upload might still be in progress. Certificates are excluded
from orphan deletion/review in this tool. The command never deletes any object;
review the report and recheck references before any manual deletion.

## Validation performed for the code

`npm run test:seminar-media` uses the dedicated local `.env.test` database and
mocked cloud storage. It checks failed uploads/saves, cleanup failures, shared
references, private video keys, replacement history, private certificate ownership,
archival preservation, and permanent deletion. It never uploads to a real bucket.
