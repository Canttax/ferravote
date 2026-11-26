// Dépouillement en ligne de commande.
//   npm run tally                                  -> utilise data/scrutin-state.json
//   npm run tally -- --urne rXXX --mpt 00ABC...    -> recomptage par un observateur
import fs from "node:fs";
import path from "node:path";
import { ROOT, DATA_DIR, connect, loadScrutin, loadState, txLink, accountLink, isMain, run } from "../ledger/common.js";
import { tallyFromLedger } from "./core.js";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

export async function tally({ urne, mptId } = {}) {
  const state = loadState();
  urne = urne || state.urne;
  mptId = mptId || state.mptId;
  if (!urne || !mptId) throw new Error("adresse de l'urne ou ID du jeton inconnu (--urne et --mpt)");

  const scrutin = loadScrutin();
  const client = await connect();
  const r = await tallyFromLedger(client, { urne, mptId, listes: scrutin.listes });
  await client.disconnect();

  console.log(`\n=== Dépouillement : ${scrutin.titre} ===`);
  console.log(`Urne         : ${urne}  (${accountLink(urne)})`);
  console.log(`Jeton (MPT)  : ${mptId}`);
  console.log(`Clôture      : ${r.cloture ? `ledger ${r.cloture.ledger}  ${txLink(r.cloture.hash)}` : "pas encore clôturé"}`);
  console.log(`Autorisés    : ${r.autorises}   jetons distribués : ${r.distribues}`);
  console.log(`Votants      : ${r.votants}   exprimés : ${r.exprimes}   nuls : ${r.nuls}\n`);

  for (const l of r.resultats) {
    console.log(`  ${l.code}  ${l.nom.padEnd(20)} ${String(l.voix).padStart(3)} voix  (${l.pourcentage} %)`);
  }

  console.log("\nBulletins :");
  for (const b of r.bulletins) {
    console.log(`  ${b.electeur}  ${String(b.choix ?? "-").padEnd(4)} ${b.statut.padEnd(30)} ${txLink(b.hash)}`);
  }

  // Cache pour l'affichage, ce n'est PAS la source de vérité (le ledger l'est)
  const out = path.join(DATA_DIR, "resultat.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ calculeLe: new Date().toISOString(), ...r }, null, 2) + "\n");
  console.log(`\nRésultat enregistré dans ${path.relative(ROOT, out)}`);
  return r;
}

if (isMain(import.meta.url)) run(() => tally({ urne: arg("urne"), mptId: arg("mpt") }));
