# VPS Deployment Guide

Cherkasy Queue Lookup — Docker deployment on a VPS running Docker 28+.

## Required environment variables

| Variable | Required | Description |
|---|---|---|
| `CHERKASY_INDEX_URL` | Recommended | URL of the Cherkasyoblenergo index page listing all outage-schedule PDFs (`https://www.cherkasyoblenergo.com/static/perelik-gpv`). The app scrapes this on each startup to discover current per-publication URLs. |
| `CHERKASY_SAMPLE_PDF_URL` | Optional | Direct URL to a single PDF (iter1 / fallback mode). Used only when `CHERKASY_INDEX_URL` is unset or when this URL is not already in the discovered set. |
| `DATA_DIR` | Optional | Absolute path inside the container where SQLite + PDF cache are stored. Defaults to `/app/data`; override only if you change the volume mount point. |

If neither `CHERKASY_INDEX_URL` nor `CHERKASY_SAMPLE_PDF_URL` is set, the container boots and serves the UI, but all search requests return `503 not_ready` until at least one ingest has succeeded.

## Build the image

```bash
docker build -t cherkasy-queue-lookup:latest .
```

The build has three stages: `deps` (native compilation of `better-sqlite3`), `builder` (`next build`), and `runner` (slim runtime). The first build takes a few minutes; subsequent builds use Docker layer cache.

## Run with docker compose (recommended)

Copy `.env.example` to `.env` and fill in at least `CHERKASY_INDEX_URL`:

```bash
cp .env.example .env
# edit .env
docker compose up -d
```

The named volume `cherkasy_data` is created automatically and persists across restarts and image upgrades. It holds:
- `cherkasy.sqlite` — the SQLite database
- `pdf-cache/` — downloaded PDFs keyed by sha1(URL)

Check logs and wait for the initial ingest to complete (a few minutes on first run):

```bash
docker compose logs -f app
```

Stop and start without losing data:

```bash
docker compose down   # stops container, volume is preserved
docker compose up -d  # re-uses existing volume
```

## Run with plain docker (alternative)

```bash
docker volume create cherkasy_data

docker run -d \
  --name cherkasy \
  -p 3000:3000 \
  -v cherkasy_data:/app/data \
  -e CHERKASY_INDEX_URL=https://www.cherkasyoblenergo.com/static/perelik-gpv \
  -e DATA_DIR=/app/data \
  --restart unless-stopped \
  cherkasy-queue-lookup:latest
```

## Upgrade (zero-downtime rebuild)

```bash
docker build -t cherkasy-queue-lookup:latest .
docker compose up -d --no-deps app
```

The new container reuses the existing `cherkasy_data` volume, so the SQLite database from the previous run is available immediately. The startup ingest re-validates PDFs via conditional GET (ETag/Last-Modified) and only re-parses changed files.

## Force a fresh ingest (wipe the DB)

```bash
docker compose down
docker volume rm cherkasy_data
docker compose up -d
```

Or while running, POST to the refresh endpoint:

```bash
curl -X POST http://localhost:3000/api/ingest/refresh
```

## Health check

The container has a built-in HEALTHCHECK that polls `http://localhost:3000/`. The compose file also declares it:

```bash
docker compose ps          # shows health status
docker inspect cherkasy    # full healthcheck history
```

## Verify the container is serving

```bash
# Homepage should return 200
curl -o /dev/null -sw "%{http_code}\n" http://localhost:3000/

# Search returns 503 until first ingest completes (expected on cold start)
curl http://localhost:3000/api/search?q=тест

# After ingest completes, search returns results
curl "http://localhost:3000/api/search?q=Черкаси"
```

## Packaging notes

- Base image: `node:20-bookworm-slim` (glibc, amd64/arm64).
- `better-sqlite3` is compiled from source in the `deps` stage against the exact Node.js ABI used in the runner. The compiled `.node` binary is copied explicitly into the runner image because Next.js standalone output tracing can silently omit binary files.
- `pdfjs-dist` is copied explicitly for the same reason (it is imported dynamically during ingest, outside the Next.js module graph that tracing analyses).
- `src/lib/schema.sql` is copied to `/app/src/lib/schema.sql` inside the runner. `db.ts` resolves it via `resolve(process.cwd(), 'src/lib/schema.sql')`, and `process.cwd()` in the standalone server is `/app` (the WORKDIR).
- The container runs as a non-root user (`nextjs`, uid 1001).
