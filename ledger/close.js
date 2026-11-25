// Clôture : l'urne verrouille le jeton, plus aucun jeton ne peut circuler donc plus aucun vote
import { connect, requireState, saveState, submit, urneWallet, isMain, run } from "./common.js";
import { lockTx } from "./tx.js";

export async function closeBallot() {
  const { mptId } = requireState("mptId");
  const urne = urneWallet();
  const client = await connect();
  const res = await submit(client, urne, lockTx(urne.address, mptId), { label: "clôture (MPTokenIssuanceSet tfMPTLock)" });
  await client.disconnect();
  if (!res.ok) throw new Error(`clôture refusée (${res.code})`);
  saveState({ cloture: { hash: res.hash, ledger: res.result.ledger_index } });
}

if (isMain(import.meta.url)) run(closeBallot);
