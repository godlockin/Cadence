/**
 * Node.js production entry — `apps/api/src/node.ts`.
 *
 * Flow: resolve static frontend → buildNodeApp() (runs SQLite migrations,
 * wires auth/storage/scheduler) → serve Hono over `node:http` on
 * `0.0.0.0:3000` (configurable via `PORT` / `HOST`).
 *
 * The built React frontend (`apps/web/dist`) is served with SPA fallback
 * when present; `/api/*` and `/health` are never shadowed by static
 * routing. Graceful shutdown on SIGTERM/SIGINT.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildNodeApp } from './adapters/node.js'
import { VERSION } from './index.js'

const PORT = Number.parseInt(process.env['PORT'] ?? '3000', 10)
const HOST = process.env['HOST'] ?? '0.0.0.0'

/**
 * Resolve the built frontend directory, in priority order:
 *   1. PULSEDECK_STATIC_DIR   (explicit override)
 *   2. <api>/dist/static      (Docker runtime copies web dist here)
 *   3. <repo>/apps/web/dist   (monorepo layout)
 * Returns null when the frontend has not been built — API-only mode.
 */
function resolveStaticDir(): string | null {
  const candidates = [
    process.env['PULSEDECK_STATIC_DIR'],
    fileURLToPath(new URL('../dist/static/', import.meta.url)),
    fileURLToPath(new URL('../../web/dist/', import.meta.url)),
  ].filter((s): s is string => Boolean(s))

  for (const dir of candidates) {
    try {
      if (existsSync(dir)) return resolve(dir)
    } catch {
      /* ignore unreadable candidates */
    }
  }
  return null
}

const staticDir = resolveStaticDir()

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
}

/**
 * Serve a static asset (or SPA-fallback to index.html). Returns true when
 * the response was written, false when the frontend is unavailable.
 * Never serves `/api/*` — those must fall through to Hono's 404 JSON.
 */
async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (staticDir === null) return false
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  if (pathname === '/api' || pathname.startsWith('/api/') || pathname === '/health') return false

  let rel = decodeURIComponent(pathname)
  if (rel === '/') rel = '/index.html'
  const filePath = resolve(staticDir, '.' + rel)

  /* Path-traversal guard (lexical) — resolved path must stay inside staticDir. */
  if (filePath !== staticDir && !filePath.startsWith(staticDir + sep)) return false

  try {
    /* Canonical guard — resolve real path (defeats symlink bypass). */
    const realFile = await realpath(filePath)
    if (realFile !== staticDir && !realFile.startsWith(staticDir + sep)) return false

    const data = await readFile(realFile)
    res.statusCode = 200
    res.setHeader('content-type', MIME_TYPES[extname(filePath)] ?? 'application/octet-stream')
    res.setHeader('content-length', String(data.byteLength))
    res.setHeader('cache-control', 'public, max-age=31536000, immutable')
    res.end(req.method === 'HEAD' ? undefined : data)
    return true
  } catch {
    /* 404 → SPA fallback */
    try {
      const index = await readFile(join(staticDir, 'index.html'))
      res.statusCode = 200
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.setHeader('cache-control', 'no-cache')
      res.end(req.method === 'HEAD' ? undefined : index)
      return true
    } catch {
      return false
    }
  }
}

const built = buildNodeApp()
const app = built.app

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    /* Adapt node IncomingMessage → Web Request. */
    const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`
    const method = req.method ?? 'GET'
    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers.set(k, v)
      else if (Array.isArray(v)) headers.set(k, v.join(', '))
    }
    let body: BodyInit | undefined
    if (method !== 'GET' && method !== 'HEAD') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      body = Buffer.concat(chunks)
    }
    const request = new Request(url, { method, headers, body })
    const response = await app.fetch(request)

    const pathname = new URL(url).pathname
    if (response.status === 404 && staticDir !== null) {
      const served = await serveStatic(req, res, pathname)
      if (served) return
    }

    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      res.setHeader(key, value)
    })
    if (response.body !== null) {
      const buf = Buffer.from(await response.arrayBuffer())
      res.end(buf)
    } else {
      res.end()
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[api/node] request failed', message)
    res.statusCode = 500
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'internal', message }))
  }
})

server.listen(PORT, HOST, () => {
  console.info(
    `[pulsedeck/api] v${VERSION} listening on http://${HOST}:${PORT.toString()}` +
      (staticDir !== null ? ` (static: ${staticDir})` : ' (api-only, no web dist found)'),
  )
})

const shutdown = async (signal: string): Promise<void> => {
  console.info(`[pulsedeck/api] ${signal} received — shutting down`)
  await new Promise<void>((resolveShutdown) => server.close(() => resolveShutdown()))
  await built.close()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
