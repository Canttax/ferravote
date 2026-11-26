// Vérifie l'accès au Testnet avant de lancer la démo (même principe que le script de la fiche du hackathon)
//   npm run check
import { SIM, FAUCET_HOST, connect, fundWallet, walletsBanque, soldeXrp, accountLink, run } from "../ledger/common.js";

run(async () => {
  const client = await connect({ verbose: true });
  const info = await client.request({ command: "server_info" });
  const ledger = await client.request({ command: "ledger", ledger_index: "validated" });
  console.log(`Version du serveur : ${info.result.info.build_version}`);
  console.log(`Dernier ledger validé : ${ledger.result.ledger_index}`);

  if (!SIM) {
    const banque = walletsBanque();
    console.log(`Faucet : https://${FAUCET_HOST}/accounts`);
    if (!banque.length) console.log("Wallet banque (secours si le faucet tombe) : aucun");
    for (const w of banque) console.log(`Wallet banque : ${w.address}  ${await soldeXrp(client, w.address)} XRP`);
  }
  console.log("Test de création d'un wallet...");
  const { wallet, balance, source } = await fundWallet(client, { montant: 2 });
  console.log(`Wallet de test créé : ${wallet.address} | solde ${balance} XRP (${source})`);
  console.log(`  ${accountLink(wallet.address)}`);
  await client.disconnect();
  console.log(`\nTout est bon, on peut lancer : npm run ${SIM ? "demo:sim" : "demo"}`);
});
