// Construction des transactions FerraVote.
// Fonctions pures (pas de réseau) pour pouvoir les tester avec xrpl.validate().
import xrpl from "xrpl";
import { encodeMemo } from "../tally/memo.js";

const { MPTokenIssuanceCreateFlags, MPTokenIssuanceSetFlags } = xrpl;

// Jeton de vote : autorisation obligatoire, verrouillable, PAS de tfMPTCanTransfer.
// Sans CanTransfer un détenteur ne peut envoyer son jeton qu'à l'émetteur (l'urne).
export const VOTE_FLAGS =
  MPTokenIssuanceCreateFlags.tfMPTRequireAuth | MPTokenIssuanceCreateFlags.tfMPTCanLock;

export function createBallotTx(urne, { nbElecteurs, titre }) {
  return {
    TransactionType: "MPTokenIssuanceCreate",
    Account: urne,
    AssetScale: 0,
    MaximumAmount: String(nbElecteurs),
    Flags: VOTE_FLAGS,
    MPTokenMetadata: xrpl.encodeMPTokenMetadata({
      ticker: "VOTE",
      name: titre.slice(0, 60),
      desc: "Jeton de vote FerraVote, 1 jeton = 1 voix",
      icon: "https://xrpl.org/favicon.ico",
      asset_class: "other",
      issuer_name: "FerraVote",
    }),
  };
}

// Étape 1 de l'autorisation : l'électeur crée son objet MPToken (il "demande" le jeton)
export function holderOptInTx(electeur, mptId) {
  return {
    TransactionType: "MPTokenAuthorize",
    Account: electeur,
    MPTokenIssuanceID: mptId,
  };
}

// Étape 2 : l'urne valide l'adresse après contrôle de la liste d'émargement
export function issuerAuthorizeTx(urne, electeur, mptId) {
  return {
    TransactionType: "MPTokenAuthorize",
    Account: urne,
    MPTokenIssuanceID: mptId,
    Holder: electeur,
  };
}

export function mptPaymentTx(from, to, mptId, memos) {
  const tx = {
    TransactionType: "Payment",
    Account: from,
    Destination: to,
    Amount: { mpt_issuance_id: mptId, value: "1" },
  };
  if (memos) tx.Memos = memos;
  return tx;
}

export function voteTx(electeur, urne, mptId, choix) {
  return mptPaymentTx(electeur, urne, mptId, [encodeMemo({ type: "vote", choix })]);
}

export function lockTx(urne, mptId) {
  return {
    TransactionType: "MPTokenIssuanceSet",
    Account: urne,
    MPTokenIssuanceID: mptId,
    Flags: MPTokenIssuanceSetFlags.tfMPTLock,
  };
}

// L'ID d'un MPT = séquence de la transaction de création (4 octets) + AccountID de l'émetteur.
// Sert de secours si la métadonnée mpt_issuance_id n'est pas renvoyée.
export function computeMptId(sequence, account) {
  const seq = sequence.toString(16).padStart(8, "0");
  const accountId = Buffer.from(xrpl.decodeAccountID(account)).toString("hex");
  return (seq + accountId).toUpperCase();
}
