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
`dist/`.
