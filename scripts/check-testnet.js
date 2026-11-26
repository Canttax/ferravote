// Vérifie l'accès au Testnet avant de lancer la démo (même principe que le script de la fiche du hackathon)
//   npm run check
import { SIM, connect, fundWallet, accountLink, run } from "../ledger/common.js";

run(async () => {
  const client = await connect({ verbose: true });
  const info = await client.request({ command: "server_info" });
  const ledger = await client.request({ command: "ledger", ledger_index: "validated" });
  console.log(`Version du serveur : ${info.result.info.build_version}`);
  console.log(`Dernier ledger validé : ${ledger.result.ledger_index}`);

  console.log("Test du faucet...");
  const { wallet, balance } = await fundWallet(client);
  console.log(`Wallet de test créé : ${wallet.address} | solde ${balance} XRP`);
  console.log(`  ${accountLink(wallet.address)}`);
  await client.disconnect();
  console.log(`\nTout est bon, on peut lancer : npm run ${SIM ? "demo:sim" : "demo"}`);
});
