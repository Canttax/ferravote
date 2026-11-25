import test from "node:test";
import assert from "node:assert/strict";
import { encodeMemo, decodeMemos, toHex, fromHex } from "../tally/memo.js";

test("hex aller-retour avec accents", () => {
  assert.equal(fromHex(toHex("Liste Phénix")), "Liste Phénix");
});

test("memo de vote", () => {
  assert.deepEqual(decodeMemos([encodeMemo({ type: "vote", choix: "L3" })]), { type: "vote", choix: "L3" });
});

test("memo d'une autre appli ignoré", () => {
  assert.equal(decodeMemos([{ Memo: { MemoType: toHex("autre"), MemoData: toHex("VOTE:L1") } }]), null);
  assert.equal(decodeMemos(undefined), null);
});

test("memo FerraVote mal formé", () => {
  const r = decodeMemos([{ Memo: { MemoType: toHex("ferravote"), MemoData: toHex("pour la liste 1 svp") } }]);
  assert.equal(r.type, "inconnu");
});
