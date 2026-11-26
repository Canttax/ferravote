// Fonctions partagées par les scripts du dossier ledger/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import xrpl from "xrpl";
import { SimClient } from "../sim/client.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

// Deux modes :
//   - testnet (par défaut) : vrai XRPL Testnet via xrpl.js
//   - simulation : ledger simulé en local (dossier sim/), avec --sim ou XRPL_MODE=simulation
export const SIM = process.argv.includes("--sim") || process.env.XRPL_MODE === "simulation";
export const MODE = SIM ? "simulation" : "testnet";

// Chaque mode a ses propres données et ses propres wallets, pour ne jamais mélanger
export const DATA_DIR = SIM ? path.join(ROOT, "data", "sim") : path.join(ROOT, "data");
export const ENV_FILE = SIM ? path.join(DATA_DIR, "wallets.env") : path.join(ROOT, ".env");
if (SIM) {
  for (const k of ["URNE_SEED", "ELECTEUR_SEEDS", "INTRUS_SEED"]) delete process.env[k];
  dotenv.config({ path: ENV_FILE, quiet: true, override: true });
}

const WEB_PORT = Number(process.env.PORT) || 3000;
export const NETWORK_URL = SIM ? "simulation locale" : process.env.XRPL_NETWORK || "wss://s.altnet.rippletest.net:51233";
export const EXPLORER = SIM
  ? `http://localhost:${WEB_PORT}/web/explorer.html`
  : process.env.XRPL_EXPLORER || "https://testnet.xrpl.org";

const STATE_FILE = path.join(DATA_DIR, "scrutin-state.json");
const SCRUTIN_FILE = path.join(ROOT, "config", "scrutin.json");

export function loadScrutin() {
  return JSON.parse(fs.readFileSync(SCRUTIN_FILE, "utf8"));
}

// Etat public du scrutin (adresse de l'urne, ID du jeton, électeurs autorisés).
// Aucune seed ici, uniquement des infos qui sont de toute façon visibles sur le ledger.
export function loadState() {
  if (!fs.existsSync(STATE_FILE)) return {};
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

export function saveState(patch) {
  const state = { ...loadState(), ...patch };
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
  return state;
}

export async function connect() {
  const client = SIM ? new SimClient(path.join(DATA_DIR, "ledger.json")) : new xrpl.Client(NETWORK_URL);
  await client.connect();
  return client;
}

export function urneWallet() {
  if (!process.env.URNE_SEED) {
    throw new Error(`URNE_SEED manquant dans ${path.relative(ROOT, ENV_FILE)} (lancer d'abord : npm run wallets${SIM ? " -- --sim" : ""})`);
  }
  return xrpl.Wallet.fromSeed(process.env.URNE_SEED);
}

export function electeurWallets() {
  const seeds = (process.env.ELECTEUR_SEEDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (seeds.length === 0) {
    throw new Error(`ELECTEUR_SEEDS manquant dans ${path.relative(ROOT, ENV_FILE)} (lancer d'abord : npm run wallets${SIM ? " -- --sim" : ""})`);
  }
  return seeds.map((s) => xrpl.Wallet.fromSeed(s));
}

// Wallet "intrus" : financé mais jamais autorisé, sert à montrer qu'il ne peut pas voter
export function intrusWallet() {
  return process.env.INTRUS_SEED ? xrpl.Wallet.fromSeed(process.env.INTRUS_SEED) : null;
}

export function txLink(hash) {
  return SIM ? `${EXPLORER}#tx=${hash}` : `${EXPLORER}/transactions/${hash}`;
}

export function accountLink(address) {
  return SIM ? `${EXPLORER}#account=${address}` : `${EXPLORER}/accounts/${address}`;
}

// Signe, envoie et attend la validation. Ne lève pas d'erreur si la transaction est
// refusée : on veut pouvoir afficher le code (tecLOCKED, tecNO_AUTH...) pendant la démo.
export async function submit(client, wallet, tx, { label = tx.TransactionType, quiet = false } = {}) {
  const prepared = await client.autofill(tx);
  const signed = wallet.sign(prepared);
  const sub = await client.request({ command: "submit", tx_blob: signed.tx_blob });
  const prelim = sub.result.engine_result;

  let code = prelim;
  let result = null;
  // tem / tef / tel : la transaction n'entrera jamais dans un ledger, inutile d'attendre
  if (!/^(tem|tef|tel)/.test(prelim)) {
    result = await waitValidated(client, signed.hash, prepared.LastLedgerSequence);
    code = result ? result.meta.TransactionResult : `${prelim} (jamais validée)`;
  }
  const ok = code === "tesSUCCESS";
  if (!quiet) {
    console.log(`  [${ok ? "OK" : "KO"}] ${label} : ${code}`);
    if (result) console.log(`       ${txLink(signed.hash)}`);
  }
  return { ok, code, hash: signed.hash, result };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitValidated(client, hash, lastLedger) {
  for (;;) {
    try {
      const res = await client.request({ command: "tx", transaction: hash });
      if (res.result.validated) return res.result;
    } catch (err) {
      if (err?.data?.error !== "txnNotFound") throw err;
    }
    if ((await client.getLedgerIndex()) > lastLedger) return null;
    await sleep(1000);
  }
}

export function requireState(...keys) {
  const state = loadState();
  for (const k of keys) {
    if (!state[k]) {
      throw new Error(`"${k}" absent de ${path.relative(ROOT, STATE_FILE)}, une étape précédente n'a pas été faite`);
    }
  }
  return state;
}

export async function run(main) {
  try {
    await main();
  } catch (err) {
    console.error("Erreur :", err.message);
    process.exitCode = 1;
  }
}

// Vrai si le fichier est lancé directement (node ledger/xxx.js) et pas importé par demo.js
export function isMain(metaUrl) {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(metaUrl);
}

// Liste d'émargement : fichier local de l'organisateur, jamais publié (data/ est dans .gitignore)
const EMARGEMENT_FILE = path.join(DATA_DIR, "emargement.csv");

export function loadEmargement() {
  if (!fs.existsSync(EMARGEMENT_FILE)) return [];
  return fs
    .readFileSync(EMARGEMENT_FILE, "utf8")
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [nom, adresse] = l.split(";");
      return { nom, adresse };
    });
}

export function saveEmargement(rows) {
  fs.mkdirSync(path.dirname(EMARGEMENT_FILE), { recursive: true });
  const csv = ["nom;adresse", ...rows.map((r) => `${r.nom};${r.adresse}`)].join("\n") + "\n";
  fs.writeFileSync(EMARGEMENT_FILE, csv);
}
