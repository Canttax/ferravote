// Crée les wallets de test via le faucet Testnet et écrit les seeds dans .env
//   npm run wallets              (refuse d'écraser un .env existant)
//   npm run wallets -- --force
import fs from "node:fs";
import path from "node:path";
import { ROOT, ENV_FILE, SIM, connect, fundWallet, loadScrutin, saveEmargement, saveState, accountLink, isMain, run } from "./common.js";

// Noms fictifs pour la liste d'émargement de la démo
const NOMS = ["Alice Martin", "Bilal Haddad", "Chloé Bernard", "David Nguyen", "Emma Lefèvre",
  "Farid Benali", "Gaëlle Moreau", "Hugo Lambert", "Inès Garcia", "Jules Fontaine"];

export async function createWallets({ force = false } = {}) {
  const envFile = ENV_FILE;
  const nomEnv = path.relative(ROOT, envFile);
  if (fs.existsSync(envFile) && fs.readFileSync(envFile, "utf8").includes("URNE_SEED=s") && !force) {
    console.log(`${nomEnv} contient déjà des seeds, on les garde (ajouter --force pour recommencer)`);
    return;
  }
  const { nbElecteurs } = loadScrutin();
  const client = await connect({ verbose: true });

  console.log(SIM ? "Financement des comptes par le faucet simulé..." : "Financement des comptes via le faucet Testnet (ça peut prendre une minute)...");
  // L'urne a besoin d'un peu plus (réserve du jeton + frais de toutes les autorisations)
  const fund = async (label, montant = 5) => {
    const { wallet, balance, source } = await fundWallet(client, { montant });
    console.log(`  ${label.padEnd(12)} ${wallet.address}  ${balance} XRP  (${source})`);
    return wallet;
  };

  const urne = await fund("urne", 10);
  const electeurs = [];
  for (let i = 0; i < nbElecteurs; i++) electeurs.push(await fund(`électeur ${i + 1}`));
  const intrus = await fund("intrus");
  await client.disconnect();

  // On repart du modèle .env.example pour garder les commentaires
  let env = SIM
    ? "# Wallets du ledger SIMULÉ (aucune valeur, recréés à chaque reset)\nURNE_SEED=\nELECTEUR_SEEDS=\nINTRUS_SEED=\n"
    : fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  env = env
    .replace(/^URNE_SEED=.*$/m, `URNE_SEED=${urne.seed}`)
    .replace(/^ELECTEUR_SEEDS=.*$/m, `ELECTEUR_SEEDS=${electeurs.map((w) => w.seed).join(",")}`)
    .replace(/^INTRUS_SEED=.*$/m, `INTRUS_SEED=${intrus.seed}`);
  fs.mkdirSync(path.dirname(envFile), { recursive: true });
  fs.writeFileSync(envFile, env);
  // pour que la suite du script (npm run demo) utilise tout de suite les nouvelles seeds
  process.env.URNE_SEED = urne.seed;
  process.env.ELECTEUR_SEEDS = electeurs.map((w) => w.seed).join(",");
  process.env.INTRUS_SEED = intrus.seed;

  saveEmargement(electeurs.map((w, i) => ({ nom: NOMS[i % NOMS.length], adresse: w.address })));
  // Nouveau jeu de wallets = nouveau scrutin, on repart d'un état propre
  saveState({ urne: urne.address, mptId: null, electeurs: electeurs.map((w) => w.address), intrus: intrus.address, autorises: [] });

  console.log(`\nSeeds écrites dans ${nomEnv} (jamais commité). Urne : ${accountLink(urne.address)}`);
}

if (isMain(import.meta.url)) run(() => createWallets({ force: process.argv.includes("--force") }));
