// Crée les wallets de test via le faucet Testnet et écrit les seeds dans .env
//   npm run wallets              (refuse d'écraser un .env existant)
//   npm run wallets -- --force
import fs from "node:fs";
import path from "node:path";
import { ROOT, connect, loadScrutin, saveEmargement, saveState, accountLink, isMain, run } from "./common.js";

// Noms fictifs pour la liste d'émargement de la démo
const NOMS = ["Alice Martin", "Bilal Haddad", "Chloé Bernard", "David Nguyen", "Emma Lefèvre",
  "Farid Benali", "Gaëlle Moreau", "Hugo Lambert", "Inès Garcia", "Jules Fontaine"];

export async function createWallets({ force = false } = {}) {
  const envFile = path.join(ROOT, ".env");
  if (fs.existsSync(envFile) && fs.readFileSync(envFile, "utf8").includes("URNE_SEED=s") && !force) {
    console.log(".env contient déjà des seeds, on les garde (npm run wallets -- --force pour recommencer)");
    return;
  }
  const { nbElecteurs } = loadScrutin();
  const client = await connect();

  console.log("Financement des comptes via le faucet Testnet (ça peut prendre une minute)...");
  const fund = async (label) => {
    const { wallet, balance } = await client.fundWallet();
    console.log(`  ${label.padEnd(12)} ${wallet.address}  ${balance} XRP`);
    return wallet;
  };

  const urne = await fund("urne");
  const electeurs = [];
  for (let i = 0; i < nbElecteurs; i++) electeurs.push(await fund(`électeur ${i + 1}`));
  const intrus = await fund("intrus");
  await client.disconnect();

  // On repart du modèle .env.example pour garder les commentaires
  let env = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  env = env
    .replace(/^URNE_SEED=.*$/m, `URNE_SEED=${urne.seed}`)
    .replace(/^ELECTEUR_SEEDS=.*$/m, `ELECTEUR_SEEDS=${electeurs.map((w) => w.seed).join(",")}`)
    .replace(/^INTRUS_SEED=.*$/m, `INTRUS_SEED=${intrus.seed}`);
  fs.writeFileSync(envFile, env);

  saveEmargement(electeurs.map((w, i) => ({ nom: NOMS[i % NOMS.length], adresse: w.address })));
  // Nouveau jeu de wallets = nouveau scrutin, on repart d'un état propre
  saveState({ urne: urne.address, mptId: null, electeurs: electeurs.map((w) => w.address), intrus: intrus.address, autorises: [] });

  console.log(`\nSeeds écrites dans .env (jamais commité). Urne : ${accountLink(urne.address)}`);
}

if (isMain(import.meta.url)) run(() => createWallets({ force: process.argv.includes("--force") }));
