# =============================================================================
# Stage 1 — deps
# Install ALL production dependencies inside a Debian-based image that has the
# build toolchain (python3, make, g++) needed to compile better-sqlite3.
# We keep this stage separate so the toolchain never lands in the runtime image.
# =============================================================================
FROM node:20-bookworm-slim AS deps

# Build tools required by better-sqlite3 (native node-gyp module)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./

# npm ci compiles better-sqlite3 from source (or uses prebuild if compatible).
# --ignore-scripts=false ensures node-gyp / prebuild-install runs.
RUN npm ci --ignore-scripts=false


# =============================================================================
# Stage 2 — builder
# Run `next build` with the standalone output mode enabled.  We only need the
# compiled node_modules from the deps stage, not the build toolchain itself.
# =============================================================================
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Bring in the compiled node_modules (including the native .node binary)
COPY --from=deps /app/node_modules ./node_modules

# Copy source — .dockerignore strips node_modules, .next, data, .git, etc.
COPY . .

ENV NODE_ENV=production
RUN npm run build


# =============================================================================
# Stage 3 — runner
# Minimal image: standalone server bundle only.  No build tools, no dev deps.
# Non-root user for runtime security.
# =============================================================================
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Default data dir; override at runtime with -e DATA_DIR=... or in compose.
ENV DATA_DIR=/app/data

# Create a non-root system user/group for the Node process
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

# --- Next.js standalone output ---
# Contains server.js + its own node_modules (traced dependencies).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# Static assets must be placed where standalone's server.js expects them
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# NOTE: this project has no public/ directory, so there is nothing to copy.
# (A COPY with a non-matching glob would fail the build, so it is omitted.
# If a public/ dir is added later, restore: COPY --from=builder /app/public ./public)

# --- schema.sql fix ---
# db.ts resolves the schema via: resolve(process.cwd(), 'src/lib/schema.sql')
# In the standalone runner process.cwd() == /app (WORKDIR), so the file must
# live at /app/src/lib/schema.sql.  Next.js standalone tracing does NOT copy
# source files — we must do it explicitly.
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/schema.sql ./src/lib/schema.sql

# --- better-sqlite3 native module fix ---
# Next.js standalone tracing captures JS files but can silently omit the
# compiled .node binary (build/Release/better_sqlite3.node).  We copy the
# entire package from the deps stage on top of whatever standalone traced,
# guaranteeing the binary compiled against the exact node20/bookworm ABI.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3

# --- pdfjs-dist ---
# Loaded via dynamic import in extract.ts during ingest.  Standalone tracing
# may miss parts of this package's legacy/build subtree.  Explicit copy is
# safer and avoids a runtime MODULE_NOT_FOUND during cold-start ingest.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/pdfjs-dist ./node_modules/pdfjs-dist

# Data directory (SQLite + PDF cache) is a mounted volume at runtime.
# We pre-create it here so it's owned by nextjs even before the volume mount.
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

USER nextjs

EXPOSE 3000

# Healthcheck: hit the homepage; app is ready when it returns 200.
# start-period gives the standalone server time to boot and fire-and-forget
# the first ingest before the first check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/', (r) => { process.exitCode = r.statusCode === 200 ? 0 : 1; })"

CMD ["node", "server.js"]
