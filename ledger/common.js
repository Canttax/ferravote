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
// Serveurs Testnet essayés dans l'ordre (fiche "Accès au XRPL Testnet" du hackathon).
// Le Wi-Fi de l'école peut bloquer le port 51233, les deux suivants sont sur le port 443.
export const TESTNET_SERVERS = (
  process.env.XRPL_NETWORK || "wss://s.altnet.rippletest.net:51233,wss://testnet.xrpl-labs.com,wss://testnet.honeycluster.io"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
export const FAUCET_HOST = process.env.XRPL_FAUCET || "faucet.altnet.rippletest.net";
export const NETWORK_URL = SIM ? "simulation locale" : TESTNET_SERVERS[0];
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

export async function connect({ verbose = false } = {}) {
  if (SIM) {
    const client = new SimClient(path.join(DATA_DIR, "ledger.json"));
    await client.connect();
    return client;
  }
  // On essaie chaque serveur, le premier qui répond gagne
  for (const url of TESTNET_SERVERS) {
    const client = new xrpl.Client(url, { connectionTimeout: 10000 });
    try {
      await client.connect();
      if (verbose) console.log(`Connecté à ${url}`);
      return client;
    } catch {
      console.log(`  échec sur ${url}, serveur suivant`);
    }
  }
  throw new Error("aucun serveur Testnet ne répond (Wi-Fi qui bloque ? essayer un partage de connexion, Codespaces ou --sim)");
}

// ---------- Financement des wallets ----------
// 1. le faucet du Testnet (client.fundWallet) ;
// 2. si le faucet ne répond pas : un wallet "banque" déjà financé envoie des XRP au nouveau wallet.
//    La banque vient de BANQUE_SEED dans .env, ou du wallets.json créé par le Codespace
//    XRPL Academy (dev-training-june-2026), s'il est à côté de notre dépôt.
let faucetEnPanne = false;

function walletDepuisJson(w) {
  const seed = w.seed || w.secret || w.familySeed;
  if (seed) return xrpl.Wallet.fromSeed(seed);
  if (w.privateKey && w.publicKey) return new xrpl.Wallet(w.publicKey, w.privateKey);
  return null;
}

export function walletsBanque() {
  if (process.env.BANQUE_SEED) {
    return process.env.BANQUE_SEED.split(",").map((s) => s.trim()).filter(Boolean).map((s) => xrpl.Wallet.fromSeed(s));
  }
  const candidats = [
    process.env.BANQUE_WALLETS_JSON,
    path.join(ROOT, "..", "dev-training-june-2026", "wallets.json"),
    "/workspaces/dev-training-june-2026/wallets.json",
  ].filter(Boolean);
  for (const f of candidats) {
    if (!fs.existsSync(f)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(f, "utf8"));
      const liste = Array.isArray(data) ? data : data.wallets || Object.values(data);
      const wallets = liste.map(walletDepuisJson).filter(Boolean);
      if (wallets.length) return wallets;
    } catch {
      // fichier illisible, on passe au suivant
    }
  }
  return [];
}

export async function soldeXrp(client, address) {
  try {
    const r = await client.request({ command: "account_info", account: address, ledger_index: "validated" });
    return Number(r.result.account_data.Balance) / 1e6;
  } catch {
    return 0;
  }
}

async function financerDepuisBanque(client, montant) {
  const banque = walletsBanque();
  if (!banque.length) {
    throw new Error("faucet indisponible et pas de wallet banque (mettre BANQUE_SEED dans .env, voir README)");
  }
  // on prend le wallet banque le plus riche
  let meilleur = null;
  let max = -1;
  for (const w of banque) {
    const solde = await soldeXrp(client, w.address);
    if (solde > max) [meilleur, max] = [w, solde];
  }
  if (max < montant + 2) throw new Error(`wallet banque ${meilleur.address} presque vide (${max} XRP)`);

  const wallet = xrpl.Wallet.generate();
  const res = await submit(
    client,
    meilleur,
    { TransactionType: "Payment", Account: meilleur.address, Destination: wallet.address, Amount: xrpl.xrpToDrops(String(montant)) },
    { quiet: true }
  );
  if (!res.ok) throw new Error(`financement depuis la banque refusé (${res.code})`);
  return { wallet, balance: montant, source: `banque ${meilleur.address}` };
}

// montant : XRP envoyés par la banque si on passe par elle (le faucet donne toujours 100)
export async function fundWallet(client, { montant = Number(process.env.FUND_XRP) || 10, essais = 2 } = {}) {
  if (SIM) return { ...(await client.fundWallet()), source: "faucet simulé" };
  if (!faucetEnPanne) {
    for (let i = 1; i <= essais; i++) {
      try {
        const r = await client.fundWallet(null, { faucetHost: FAUCET_HOST, usageContext: "ferravote" });
        return { ...r, source: "faucet" };
      } catch (err) {
        const cause = err.cause?.code || err.cause?.message || "";
        console.log(`  faucet ${FAUCET_HOST} : ${err.message}${cause ? ` (${cause})` : ""}`);
        if (i < essais) await new Promise((r) => setTimeout(r, 3000));
      }
    }
    faucetEnPanne = true; // inutile de réessayer pour chaque wallet
    console.log("  faucet indisponible, on finance les wallets depuis le wallet banque");
  }
  return financerDepuisBanque(client, montant);
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
