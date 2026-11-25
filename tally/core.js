// Dépouillement FerraVote.
// Tout est recalculé à partir de l'historique public de l'urne : n'importe qui peut
// relancer ce code (en CLI ou depuis la page Résultats) et doit trouver le même résultat.
// Fichier partagé Node / navigateur : on reçoit un client xrpl déjà connecté.
import { decodeMemos } from "./memo.js";

const LOCK_FLAG = 0x01; // tfMPTLock
const UNAUTHORIZE_FLAG = 0x01; // tfMPTUnauthorize

// Récupère tout l'historique d'un compte, du plus ancien au plus récent
export async function fetchAccountTx(client, account) {
  const entries = [];
  let marker;
  do {
    const res = await client.request({
      command: "account_tx",
      account,
      ledger_index_min: -1,
      ledger_index_max: -1,
      forward: true,
      limit: 200,
      marker,
    });
    entries.push(...res.result.transactions);
    marker = res.result.marker;
  } while (marker);
  return entries.map(normalize);
}

// account_tx renvoie "tx_json" en API v2 et "tx" en API v1, on gère les deux
export function normalize(e) {
  const tx = e.tx_json || e.tx || {};
  return {
    hash: e.hash || tx.hash,
    ledger: e.ledger_index ?? tx.ledger_index,
    date: e.close_time_iso || null,
    tx,
    meta: e.meta || {},
  };
}

function mptAmount(entry) {
  const amt = entry.meta.delivered_amount ?? entry.tx.DeliverMax ?? entry.tx.Amount;
  if (amt && typeof amt === "object" && amt.mpt_issuance_id) return amt;
  return null;
}

function order(a, b) {
  if (a.ledger !== b.ledger) return a.ledger - b.ledger;
  return (a.meta.TransactionIndex ?? 0) - (b.meta.TransactionIndex ?? 0);
}

/**
 * @param entries  historique normalisé de l'urne
 * @param urne     adresse de l'urne (émetteur du jeton)
 * @param mptId    MPTokenIssuanceID du scrutin
 * @param listes   [{ code, nom }]
 */
export function countVotes({ entries, urne, mptId, listes }) {
  const sameId = (id) => typeof id === "string" && id.toUpperCase() === mptId.toUpperCase();
  const codes = new Map(listes.map((l) => [l.code.toUpperCase(), l]));
  const voix = new Map(listes.map((l) => [l.code.toUpperCase(), 0]));

  const autorises = new Set();
  const distribues = new Set();
  const aVote = new Set();
  const bulletins = [];
  let creation = null;
  let cloture = null;
  let nuls = 0;

  for (const e of [...entries].sort(order)) {
    const { tx, meta } = e;
    if (meta.TransactionResult !== "tesSUCCESS") continue;

    if (tx.TransactionType === "MPTokenIssuanceCreate" && tx.Account === urne) {
      if (!meta.mpt_issuance_id || sameId(meta.mpt_issuance_id)) {
        creation = creation || { hash: e.hash, ledger: e.ledger, date: e.date, max: tx.MaximumAmount };
      }
      continue;
    }

    if (tx.TransactionType === "MPTokenAuthorize" && tx.Account === urne && tx.Holder && sameId(tx.MPTokenIssuanceID)) {
      if ((tx.Flags ?? 0) & UNAUTHORIZE_FLAG) autorises.delete(tx.Holder);
      else autorises.add(tx.Holder);
      continue;
    }

    if (tx.TransactionType === "MPTokenIssuanceSet" && tx.Account === urne && sameId(tx.MPTokenIssuanceID)) {
      if (((tx.Flags ?? 0) & LOCK_FLAG) && !cloture) {
        cloture = { hash: e.hash, ledger: e.ledger, date: e.date };
      }
      continue;
    }

    if (tx.TransactionType !== "Payment") continue;
    const amt = mptAmount(e);
    if (!amt || !sameId(amt.mpt_issuance_id)) continue;

    // Distribution : l'urne envoie 1 jeton à un électeur
    if (tx.Account === urne) {
      distribues.add(tx.Destination);
      continue;
    }

    // Bulletin : un électeur renvoie son jeton à l'urne
    if (tx.Destination !== urne) continue;
    const memo = decodeMemos(tx.Memos);
    const bulletin = {
      hash: e.hash,
      ledger: e.ledger,
      date: e.date,
      electeur: tx.Account,
      choix: memo?.choix ?? null,
      statut: "compté",
    };

    if (amt.value !== "1") bulletin.statut = "rejeté (montant différent de 1)";
    else if (!autorises.has(tx.Account)) bulletin.statut = "rejeté (adresse non autorisée)";
    else if (aVote.has(tx.Account)) bulletin.statut = "rejeté (deuxième vote)";
    else if (cloture && e.ledger > cloture.ledger) bulletin.statut = "rejeté (après la clôture)";
    else {
      aVote.add(tx.Account);
      if (memo?.type === "vote" && codes.has(memo.choix)) {
        voix.set(memo.choix, voix.get(memo.choix) + 1);
      } else {
        bulletin.statut = "nul";
        nuls++;
      }
    }
    bulletins.push(bulletin);
  }

  const exprimes = [...voix.values()].reduce((a, b) => a + b, 0);
  const resultats = listes
    .map((l) => {
      const n = voix.get(l.code.toUpperCase());
      return { code: l.code, nom: l.nom, voix: n, pourcentage: exprimes ? Math.round((n / exprimes) * 1000) / 10 : 0 };
    })
    .sort((a, b) => b.voix - a.voix);

  return {
    urne,
    mptId,
    creation,
    cloture,
    autorises: autorises.size,
    distribues: distribues.size,
    votants: aVote.size,
    exprimes,
    nuls,
    resultats,
    bulletins,
  };
}

// Raccourci : télécharge l'historique puis compte
export async function tallyFromLedger(client, { urne, mptId, listes }) {
  const entries = await fetchAccountTx(client, urne);
  return countVotes({ entries, urne, mptId, listes });
}
