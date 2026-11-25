// Envoie 1 jeton VOTE à chaque adresse autorisée
import { connect, requireState, saveState, submit, urneWallet, isMain, run } from "./common.js";
import { mptPaymentTx } from "./tx.js";

export async function distribute() {
  const { mptId, autorises = [], distribues = [] } = requireState("mptId");
  const urne = urneWallet();
  const client = await connect();
  const done = new Set(distribues);

  for (const adresse of autorises) {
    if (done.has(adresse)) continue;
    const res = await submit(client, urne, mptPaymentTx(urne.address, adresse, mptId), { label: `1 VOTE -> ${adresse}` });
    if (res.ok) done.add(adresse);
  }
  await client.disconnect();
  saveState({ distribues: [...done] });
  console.log(`\n${done.size} jeton(s) distribué(s)`);
}

if (isMain(import.meta.url)) run(distribute);
