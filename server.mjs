// Local HTTP + SSE server for the World Cup map canvas.
//
//   GET /              -> public/index.html (the Leaflet map UI)
//   GET /api/matches   -> normalized, geo-enriched matches (JSON); ?team= & ?status= filters
//   GET /events        -> Server-Sent Events stream used to push agent-driven commands
//                         (reload / focus / filter) to an already-open canvas page
//
// Runnable standalone for testing: `node server.mjs` (prints its URL).
// When imported by extension.mjs it stays silent on stdout (reserved for JSON-RPC).

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, extname } from "node:path";
import { getMatches, filterMatches, clearCache } from "./data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** @type {Set<import("node:http").ServerResponse>} */
const sseClients = new Set();

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(payload);
}

async function serveStatic(res, relPath) {
  // Prevent path traversal: only serve files resolved under PUBLIC_DIR.
  const safe = join(PUBLIC_DIR, relPath.replace(/^\/+/, ""));
  if (!safe.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const data = await readFile(safe);
    res.writeHead(200, {
      "content-type": MIME[extname(safe)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

function handleSse(req, res) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  sseClients.add(res);

  const keepAlive = setInterval(() => {
    try {
      res.write(": keep-alive\n\n");
    } catch {
      /* ignore */
    }
  }, 25_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
}

/**
 * Push a command to every connected canvas page.
 * @param {string} type  e.g. "reload" | "focus" | "filter"
 * @param {unknown} [data]
 */
function broadcast(type, data = {}) {
  const frame = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(frame);
    } catch {
      sseClients.delete(client);
    }
  }
}

async function handleRequest(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");

  if (url.pathname === "/events") return handleSse(req, res);

  if (url.pathname === "/api/matches") {
    try {
      const all = await getMatches();
      const status = url.searchParams.get("status");
      const team = url.searchParams.get("team");
      const matches = filterMatches(all, {
        status: status === "result" || status === "upcoming" ? status : "all",
        team: team || undefined,
      });
      return sendJson(res, 200, {
        updatedAt: new Date().toISOString(),
        count: matches.length,
        matches,
      });
    } catch (err) {
      return sendJson(res, 502, { error: String(err && err.message ? err.message : err) });
    }
  }

  if (url.pathname === "/api/refresh") {
    clearCache();
    try {
      const matches = await getMatches({ force: true });
      broadcast("reload", { count: matches.length });
      return sendJson(res, 200, { ok: true, count: matches.length });
    } catch (err) {
      return sendJson(res, 502, { error: String(err && err.message ? err.message : err) });
    }
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    return serveStatic(res, "index.html");
  }

  return serveStatic(res, url.pathname);
}

/**
 * Start the server on an ephemeral localhost port.
 * @returns {Promise<{ url: string, port: number, broadcast: typeof broadcast, close: () => Promise<void> }>}
 */
export function startServer() {
  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      try {
        sendJson(res, 500, { error: String(err && err.message ? err.message : err) });
      } catch {
        /* ignore */
      }
    });
  });

  // Preferred stable port so an already-open canvas keeps working across extension
  // reloads. Falls back to an ephemeral port only if the preferred one stays busy.
  const PREFERRED_PORT = Number(process.env.WORLDCUP_PORT) || 60698;

  function listen(port, attemptsLeft) {
    return new Promise((resolve, reject) => {
      const onError = (err) => {
        server.removeListener("listening", onListening);
        if (err && err.code === "EADDRINUSE" && port !== 0 && attemptsLeft > 0) {
          // A just-killed previous instance may still be releasing the port; retry,
          // then fall back to an OS-assigned port as a last resort.
          setTimeout(() => {
            const next = attemptsLeft === 1 ? 0 : port;
            resolve(listen(next, attemptsLeft - 1));
          }, 300);
          return;
        }
        reject(err);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        const address = server.address();
        resolve(typeof address === "object" && address ? address.port : port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      // Bind to loopback only.
      server.listen(port, "127.0.0.1");
    });
  }

  return listen(PREFERRED_PORT, 5).then((port) => ({
    url: `http://127.0.0.1:${port}/`,
    port,
    broadcast,
    close: () =>
      new Promise((done) => {
        for (const client of sseClients) {
          try {
            client.end();
          } catch {
            /* ignore */
          }
        }
        sseClients.clear();
        server.close(() => done());
      }),
  }));
}

// Standalone test mode: `node server.mjs`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().then(({ url }) => {
    // eslint-disable-next-line no-console
    console.log(`worldcup-map server listening at ${url}`);
  });
}
