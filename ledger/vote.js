// Vote d'un électeur de test : il renvoie son jeton à l'urne avec le code de sa liste en Memo
//   npm run vote -- 1 L2          (électeur n°1 du .env vote pour la liste L2)
//   npm run vote -- intrus L1     (essai avec le wallet non autorisé)
import { connect, electeurWallets, intrusWallet, loadScrutin, requireState, submit, isMain, run } from "./common.js";
import { voteTx } from "./tx.js";

export async function vote(qui, choix, { client: shared } = {}) {
  const { urne, mptId } = requireState("urne", "mptId");
  const wallet = qui === "intrus" ? intrusWallet() : electeurWallets()[Number(qui) - 1];
  if (!wallet) throw new Error(`électeur "${qui}" introuvable dans .env`);

  const codes = loadScrutin().listes.map((l) => l.code);
  if (!codes.includes(choix)) console.log(`  attention : "${choix}" n'est pas une liste (${codes.join(", ")}), le bulletin sera nul`);

  const client = shared || (await connect());
  const res = await submit(client, wallet, voteTx(wallet.address, urne, mptId, choix), {
    label: `vote ${qui === "intrus" ? "intrus" : "électeur " + qui} pour ${choix}`,
  });
  if (!shared) await client.disconnect();
  return res;
}

if (isMain(import.meta.url)) {
  const [qui, choix] = process.argv.slice(2);
  if (!qui || !choix) {
    console.log("usage : npm run vote -- <numéro électeur | intrus> <code liste>");
    process.exit(1);
  }
  run(async () => {
    const res = await vote(qui, choix.toUpperCase());
    if (!res.ok) process.exitCode = 1;
  });
}
