# Science Congress — My Focus backend

Backend reads the local `data/myFocus.xlsx` workbook, validates and caches it, and exposes:

- `GET /table` — parsed table payload;
- `GET /health` — process health check.

## Development

```bash
npm ci
npm test
npm run dev
```

The production build creates a self-contained `dist/app.js` and copies the workbook to
`dist/data/myFocus.xlsx`. Every push to `main` deploys `dist/` to Jino over FTPS. The Jino Node
application entry point is `app.js` because the deployed directory itself contains the contents of
`dist/`. The workflow transfers `tmp/restart.txt` after the app files to restart Passenger, then
verifies the legacy and ExpoForum endpoints.

The API allows requests from the test site and the KMU app site
(`science-congress-myfocus-test.marma.pro` and `science-congress-myfocus-app.marma.pro`).
`CORS_ORIGINS` can add further origins without removing these two.

## ExpoForum stand data

The private Google Sheet's bound Apps Script sends `POST /expoforum-stands` with
`Content-Type: application/json` and an `Authorization: Bearer` header. The server accepts
only a complete visitor projection of stand IDs `s1`–`s49` with optional localized `name`,
`shortName`, `description`, and `menu`, plus optional `field` (string or null),
`programs`/`services` (arrays of nonempty filter values), and `editorialEnglish`
(names of text fields explicitly approved in the editor columns). Include an ID-only
entry where a stand has no text yet. Unknown fields, locales and IDs are rejected.

Set the SHA-256 of the bearer token in `EXPOFORUM_STANDS_TOKEN_SHA256` on the server or in
`src/expoforum-stands-settings.ts` before building. Keep the original token in Apps Script's
script properties. The Jino process needs write access to its existing `.cache` directory.

`GET /expoforum-stands` returns the most recent accepted projection. It returns `503` before
the first successful push. Invalid pushes preserve the last accepted projection on disk.
Successful reads carry an ETag and support gzip. An explicit empty description or menu removes
the corresponding text on the map.

Missing translations, loading placeholders and spreadsheet errors preserve the last
accepted locale value on disk. Empty strings explicitly clear descriptions/menus;
empty arrays clear programs/services. Deploy this API before upgrading the bound
Apps Script sender so the new filter fields are accepted.
