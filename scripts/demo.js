// Scénario de démo complet, de la création des wallets au dépouillement.
//   npm run demo                 enchaîne tout
//   npm run demo -- --pas-a-pas  attend Entrée entre chaque étape (pour la soutenance)
import readline from "node:readline/promises";
import { connect, loadEmargement, run } from "../ledger/common.js";
import { createWallets } from "../ledger/wallets.js";
import { createBallot } from "../ledger/create-ballot.js";
import { authorizeVoters } from "../ledger/authorize.js";
import { distribute } from "../ledger/distribute.js";
import { vote } from "../ledger/vote.js";
import { closeBallot } from "../ledger/close.js";
import { tally } from "../tally/cli.js";

const pasAPas = process.argv.includes("--pas-a-pas");
const rl = pasAPas ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
let n = 0;

async function etape(titre) {
  n++;
  console.log(`\n----- Étape ${n} : ${titre} -----`);
  if (rl) await rl.question("(Entrée pour continuer) ");
}

// Qui vote quoi. L'électeur 6 s'abstient puis essaie de voter après la clôture.
const VOTES = [
  ["1", "L1"],
  ["2", "L2"],
  ["3", "L1"],
  ["4", "L3"],
  ["5", "L1"],
];

run(async () => {
  await etape("wallets de test (faucet)");
  await createWallets();

  await etape("ouverture du scrutin, création du jeton VOTE");
  await createBallot();

  await etape(`autorisation des ${loadEmargement().length} inscrits`);
  await authorizeVoters();

  await etape("distribution d'un jeton par électeur");
  await distribute();

  const client = await connect();

  await etape("votes");
  for (const [qui, choix] of VOTES) await vote(qui, choix, { client });

  await etape("l'électeur 1 essaie de voter une deuxième fois (doit échouer)");
  await vote("1", "L2", { client });

  await etape("un wallet non autorisé essaie de voter (doit échouer)");
  await vote("intrus", "L3", { client });

  await client.disconnect();

  await etape("clôture du scrutin");
  await closeBallot();

  await etape("l'électeur 6 vote après la clôture (doit échouer)");
  await vote("6", "L2");

  await etape("dépouillement à partir du ledger");
  await tally();

  rl?.close();
});
