// Autorise les électeurs inscrits sur la liste d'émargement.
// 2 transactions par électeur : il demande à détenir le jeton, puis l'urne valide son adresse.
import { connect, electeurWallets, loadEmargement, requireState, saveState, submit, urneWallet, isMain, run } from "./common.js";
import { holderOptInTx, issuerAuthorizeTx } from "./tx.js";

export async function authorizeVoters() {
  const { mptId, autorises = [] } = requireState("mptId");
  const urne = urneWallet();
  const inscrits = new Set(loadEmargement().map((r) => r.adresse));
  const client = await connect();
  const ok = new Set(autorises);

  for (const [i, w] of electeurWallets().entries()) {
    if (ok.has(w.address)) continue;
    console.log(`Électeur ${i + 1} (${w.address})`);
    // Contrôle hors chaîne : l'adresse doit être sur la liste d'émargement
    if (!inscrits.has(w.address)) {
      console.log("  pas sur la liste d'émargement, on ne l'autorise pas");
      continue;
    }
    const a = await submit(client, w, holderOptInTx(w.address, mptId), { label: "demande (MPTokenAuthorize)" });
    if (!a.ok && a.code !== "tecDUPLICATE") continue;
    const b = await submit(client, urne, issuerAuthorizeTx(urne.address, w.address, mptId), { label: "validation par l'urne" });
    if (b.ok) ok.add(w.address);
  }
  await client.disconnect();
  saveState({ autorises: [...ok] });
  console.log(`\n${ok.size} électeur(s) autorisé(s)`);
}

if (isMain(import.meta.url)) run(authorizeVoters);
