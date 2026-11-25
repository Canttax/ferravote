// Petit serveur statique pour l'interface (pas de framework, juste node:http).
// Il ne sert QUE des fichiers publics : jamais le .env ni la liste d'émargement.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ROOT, NETWORK_URL, EXPLORER, loadScrutin, loadState } from "../ledger/common.js";

const PORT = Number(process.env.PORT) || 3000;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };

// URL -> fichier sur le disque (liste blanche de dossiers)
const ROUTES = {
  "/web/": path.join(ROOT, "web"),
  "/tally/": path.join(ROOT, "tally"),
};
const XRPL_BUNDLE = path.join(ROOT, "node_modules", "xrpl", "build", "xrpl-latest-min.js");

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, "introuvable");
    send(res, 200, data, TYPES[path.extname(file)] || "application/octet-stream");
  });
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://localhost").pathname);

  if (url === "/") return serveFile(res, path.join(ROOT, "web", "index.html"));
  if (url === "/vendor/xrpl.js") return serveFile(res, XRPL_BUNDLE);

  if (url === "/api/config") {
    // Uniquement des infos publiques (elles sont de toute façon lisibles sur le ledger)
    const { urne = null, mptId = null } = loadState();
    const body = { scrutin: loadScrutin(), urne, mptId, network: NETWORK_URL, explorer: EXPLORER };
    return send(res, 200, JSON.stringify(body), "application/json; charset=utf-8");
  }

  for (const [prefix, dir] of Object.entries(ROUTES)) {
    if (!url.startsWith(prefix)) continue;
    const file = path.normalize(path.join(dir, url.slice(prefix.length)));
    if (!file.startsWith(dir + path.sep) || file.endsWith("server.js")) return send(res, 403, "interdit");
    return serveFile(res, file);
  }
  send(res, 404, "introuvable");
});

server.listen(PORT, () => {
  console.log(`Interface FerraVote : http://localhost:${PORT}`);
});
