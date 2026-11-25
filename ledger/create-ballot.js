// Ouvre le scrutin : l'urne crée le jeton MPT "VOTE"
import { connect, loadScrutin, saveState, submit, urneWallet, loadEmargement, isMain, run } from "./common.js";
import { createBallotTx, computeMptId } from "./tx.js";

export async function createBallot() {
  const scrutin = loadScrutin();
  const urne = urneWallet();
  // Plafond = nombre d'inscrits sur la liste d'émargement
  const nbElecteurs = loadEmargement().length || scrutin.nbElecteurs;
  const client = await connect();

  console.log(`Création du jeton de vote pour "${scrutin.titre}" (${nbElecteurs} inscrits max)`);
  const res = await submit(client, urne, createBallotTx(urne.address, { nbElecteurs, titre: scrutin.titre }), {
    label: "MPTokenIssuanceCreate",
  });
  await client.disconnect();
  if (!res.ok) throw new Error(`création refusée (${res.code})`);

  const tx = res.result.tx_json || res.result;
  const mptId = res.result.meta.mpt_issuance_id || computeMptId(tx.Sequence, urne.address);
  saveState({ urne: urne.address, mptId, creationHash: res.hash, autorises: [], distribues: [], cloture: null });
  console.log(`  ID du jeton : ${mptId}`);
  return mptId;
}

if (isMain(import.meta.url)) run(createBallot);
