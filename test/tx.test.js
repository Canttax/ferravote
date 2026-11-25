// Vérifie hors ligne que nos transactions sont bien formées (xrpl.validate)
import test from "node:test";
import assert from "node:assert/strict";
import xrpl from "xrpl";
import { createBallotTx, holderOptInTx, issuerAuthorizeTx, mptPaymentTx, voteTx, lockTx, computeMptId, VOTE_FLAGS } from "../ledger/tx.js";
import { decodeMemos } from "../tally/memo.js";

const urne = xrpl.Wallet.generate().address;
const electeur = xrpl.Wallet.generate().address;
const mptId = computeMptId(42, urne);

test("le MPTokenIssuanceID fait 24 octets", () => {
  assert.equal(mptId.length, 48);
  assert.ok(mptId.startsWith("0000002A"));
});

test("jeton de vote : autorisation obligatoire, verrouillable, non transférable", () => {
  const tx = createBallotTx(urne, { nbElecteurs: 6, titre: "Test" });
  xrpl.validate(tx);
  assert.equal(tx.MaximumAmount, "6");
  assert.equal(tx.AssetScale, 0);
  assert.ok(VOTE_FLAGS & xrpl.MPTokenIssuanceCreateFlags.tfMPTRequireAuth);
  assert.ok(VOTE_FLAGS & xrpl.MPTokenIssuanceCreateFlags.tfMPTCanLock);
  assert.equal(VOTE_FLAGS & xrpl.MPTokenIssuanceCreateFlags.tfMPTCanTransfer, 0);
  assert.equal(VOTE_FLAGS & xrpl.MPTokenIssuanceCreateFlags.tfMPTCanTrade, 0);
});

test("autorisation en deux temps", () => {
  xrpl.validate(holderOptInTx(electeur, mptId));
  const tx = issuerAuthorizeTx(urne, electeur, mptId);
  xrpl.validate(tx);
  assert.equal(tx.Holder, electeur);
});

test("distribution et vote", () => {
  xrpl.validate(mptPaymentTx(urne, electeur, mptId));
  const tx = voteTx(electeur, urne, mptId, "L2");
  xrpl.validate(tx);
  assert.deepEqual(tx.Amount, { mpt_issuance_id: mptId, value: "1" });
  assert.deepEqual(decodeMemos(tx.Memos), { type: "vote", choix: "L2" });
});

test("clôture", () => {
  const tx = lockTx(urne, mptId);
  xrpl.validate(tx);
  assert.equal(tx.Flags, 1);
});

test("les transactions se signent sans erreur", () => {
  const w = xrpl.Wallet.generate();
  const tx = { ...voteTx(w.address, urne, mptId, "L1"), Fee: "12", Sequence: 1, LastLedgerSequence: 100 };
  const signed = w.sign(tx);
  assert.equal(signed.hash.length, 64);
  const decoded = xrpl.decode(signed.tx_blob);
  assert.equal(decoded.Amount.mpt_issuance_id, mptId);
});
