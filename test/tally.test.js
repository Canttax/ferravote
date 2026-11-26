// Dépouillement sur un faux historique (pas besoin du réseau)
import test from "node:test";
import assert from "node:assert/strict";
import { countVotes } from "../tally/core.js";
import { encodeMemo, toHex } from "../tally/memo.js";

const URNE = "rUrne";
const MPT = "00000001AAAA";
const LISTES = [
  { code: "L1", nom: "Liste Horizon" },
  { code: "L2", nom: "Liste Phénix" },
  { code: "L3", nom: "Liste Kraken" },
];

let ledger = 100;
const ok = (tx, extraMeta = {}) => ({ hash: `H${ledger}`, ledger: ledger++, tx, meta: { TransactionResult: "tesSUCCESS", ...extraMeta } });
const auth = (holder) => ok({ TransactionType: "MPTokenAuthorize", Account: URNE, Holder: holder, MPTokenIssuanceID: MPT });
const give = (to) => ok({ TransactionType: "Payment", Account: URNE, Destination: to, DeliverMax: { mpt_issuance_id: MPT, value: "1" } });
const voteE = (from, choix, value = "1") =>
  ok({ TransactionType: "Payment", Account: from, Destination: URNE, DeliverMax: { mpt_issuance_id: MPT, value }, Memos: [encodeMemo({ type: "vote", choix })] });

function scenario() {
  ledger = 100;
  return [
    ok({ TransactionType: "MPTokenIssuanceCreate", Account: URNE, MaximumAmount: "4" }, { mpt_issuance_id: MPT }),
    auth("rA"), auth("rB"), auth("rC"), auth("rD"),
    give("rA"), give("rB"), give("rC"), give("rD"),
    voteE("rA", "L1"),
    voteE("rB", "L2"),
    voteE("rC", "L1"),
  ];
}

test("comptage simple", () => {
  const r = countVotes({ entries: scenario(), urne: URNE, mptId: MPT, listes: LISTES });
  assert.equal(r.autorises, 4);
  assert.equal(r.distribues, 4);
  assert.equal(r.votants, 3);
  assert.deepEqual(r.resultats.map((l) => [l.code, l.voix]), [["L1", 2], ["L2", 1], ["L3", 0]]);
  assert.equal(r.resultats[0].pourcentage, 66.7);
});

test("deuxième vote et adresse non autorisée rejetés", () => {
  const entries = scenario();
  entries.push(voteE("rA", "L2"), voteE("rZ", "L3"));
  const r = countVotes({ entries, urne: URNE, mptId: MPT, listes: LISTES });
  assert.equal(r.votants, 3);
  assert.equal(r.bulletins.find((b) => b.electeur === "rA" && b.choix === "L2").statut, "rejeté (deuxième vote)");
  assert.equal(r.bulletins.find((b) => b.electeur === "rZ").statut, "rejeté (adresse non autorisée)");
});

test("vote après la clôture ignoré", () => {
  const entries = scenario();
  entries.push(ok({ TransactionType: "MPTokenIssuanceSet", Account: URNE, MPTokenIssuanceID: MPT, Flags: 1 }));
  entries.push(voteE("rD", "L3"));
  const r = countVotes({ entries, urne: URNE, mptId: MPT, listes: LISTES });
  assert.ok(r.cloture);
  assert.equal(r.bulletins.at(-1).statut, "rejeté (après la clôture)");
  assert.equal(r.resultats.find((l) => l.code === "L3").voix, 0);
});

test("bulletin nul si la liste n'existe pas", () => {
  const entries = scenario();
  entries.push(voteE("rD", "L9"));
  const r = countVotes({ entries, urne: URNE, mptId: MPT, listes: LISTES });
  assert.equal(r.nuls, 1);
  assert.equal(r.votants, 4);
  assert.equal(r.exprimes, 3);
});

test("transactions échouées et autre jeton ignorés", () => {
  const entries = scenario();
  const failed = voteE("rD", "L3");
  failed.meta.TransactionResult = "tecLOCKED";
  entries.push(failed);
  entries.push(ok({ TransactionType: "Payment", Account: "rD", Destination: URNE, DeliverMax: { mpt_issuance_id: "AUTRE", value: "1" }, Memos: [{ Memo: { MemoType: toHex("ferravote"), MemoData: toHex("VOTE:L3") } }] }));
  const r = countVotes({ entries, urne: URNE, mptId: MPT, listes: LISTES });
  assert.equal(r.votants, 3);
  assert.equal(r.bulletins.length, 3);
});

test("l'ordre d'arrivée de l'historique ne change rien", () => {
  const entries = scenario();
  entries.push(voteE("rA", "L3"));
  const r = countVotes({ entries: [...entries].reverse(), urne: URNE, mptId: MPT, listes: LISTES });
  assert.deepEqual(r.resultats.map((l) => [l.code, l.voix]), [["L1", 2], ["L2", 1], ["L3", 0]]);
});

test("vote dans le même ledger que la clôture : départagé par TransactionIndex", () => {
  const entries = scenario();
  const lock = ok({ TransactionType: "MPTokenIssuanceSet", Account: URNE, MPTokenIssuanceID: MPT, Flags: 1 });
  const avant = voteE("rD", "L3");
  // même ledger pour les trois : avant (index 0), clôture (index 1), après (index 2)
  const L = 500;
  Object.assign(avant, { ledger: L }); avant.meta.TransactionIndex = 0;
  Object.assign(lock, { ledger: L }); lock.meta.TransactionIndex = 1;
  const tardif = voteE("rE", "L2");
  Object.assign(tardif, { ledger: L }); tardif.meta.TransactionIndex = 2;
  entries.splice(1, 0, auth("rE"));
  entries.push(tardif, lock, avant); // ordre d'arrivée volontairement mélangé
  const r = countVotes({ entries, urne: URNE, mptId: MPT, listes: LISTES });
  assert.equal(r.bulletins.find((b) => b.electeur === "rD").statut, "compté");
  assert.equal(r.bulletins.find((b) => b.electeur === "rE").statut, "rejeté (après la clôture)");
  assert.equal(r.resultats.find((l) => l.code === "L3").voix, 1);
  assert.equal(r.resultats.find((l) => l.code === "L2").voix, 1);
});
