// Petit serveur statique pour l'interface (pas de framework, juste node:http).
// Il ne sert QUE des fichiers publics : jamais le .env ni la liste d'émargement.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ROOT, DATA_DIR, SIM, MODE, NETWORK_URL, TESTNET_SERVERS, EXPLORER, loadScrutin, loadState } from "../ledger/common.js";
import { SimLedgerStore, rpc } from "../sim/client.js";

// En mode simulation le serveur héberge aussi le ledger simulé (même fichier que les scripts)
const store = SIM ? new SimLedgerStore(path.join(DATA_DIR, "ledger.json")) : null;

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

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (err) {
        reject(err);
      }
    });
  });
}

// API du ledger simulé : même requêtes que rippled (account_tx, submit...)
async function simApi(req, res, url) {
  const json = (status, body) => send(res, status, JSON.stringify(body), "application/json; charset=utf-8");
  try {
    const body = await readJson(req);
    if (url === "/sim/autofill") return json(200, store.run((engine) => engine.autofill(body)));
    return json(200, { result: rpc(store, body) });
  } catch (err) {
    json(200, { error: err.data?.error || "simError", error_message: err.message });
  }
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://localhost").pathname);

  if (url === "/") return serveFile(res, path.join(ROOT, "web", "index.html"));
  if (url === "/vendor/xrpl.js") return serveFile(res, XRPL_BUNDLE);

  if (SIM && req.method === "POST" && url.startsWith("/sim/")) return simApi(req, res, url);

  if (url === "/api/config") {
    // Uniquement des infos publiques (elles sont de toute façon lisibles sur le ledger)
    const { urne = null, mptId = null } = loadState();
    const body = { mode: MODE, scrutin: loadScrutin(), urne, mptId, network: NETWORK_URL, servers: SIM ? [] : TESTNET_SERVERS, explorer: SIM ? "/web/explorer.html" : EXPLORER };
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
  console.log(`Interface FerraVote (${MODE}) : http://localhost:${PORT}`);
  if (SIM) console.log(`Explorateur du ledger simulé : http://localhost:${PORT}/web/explorer.html`);
});
