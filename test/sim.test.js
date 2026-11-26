// Règles du ledger simulé : on vérifie qu'il se comporte comme XRPL pour nos transactions
import test from "node:test";
import assert from "node:assert/strict";
import xrpl from "xrpl";
import { Engine } from "../sim/engine.js";
import { handle } from "../sim/rpc.js";
import { createBallotTx, holderOptInTx, issuerAuthorizeTx, mptPaymentTx, voteTx, lockTx } from "../ledger/tx.js";

function setup() {
  const engine = new Engine();
  const send = (wallet, tx) => {
    const signed = wallet.sign(engine.autofill(tx));
    const r = engine.submit(signed.tx_blob);
    const entry = engine.findTx(signed.hash);
    return { prelim: r.engine_result, code: entry?.meta.TransactionResult, entry, hash: signed.hash };
  };
  const fund = () => {
    const w = xrpl.Wallet.generate();
    engine.fund(w.address);
    return w;
  };
  return { engine, send, fund };
}

function scrutin(nb = 2) {
  const ctx = setup();
  const urne = ctx.fund();
  const electeurs = Array.from({ length: nb }, () => ctx.fund());
  const res = ctx.send(urne, createBallotTx(urne.address, { nbElecteurs: nb, titre: "Test" }));
  const mptId = res.entry.meta.mpt_issuance_id;
  for (const e of electeurs) {
    ctx.send(e, holderOptInTx(e.address, mptId));
    ctx.send(urne, issuerAuthorizeTx(urne.address, e.address, mptId));
    ctx.send(urne, mptPaymentTx(urne.address, e.address, mptId));
  }
  return { ...ctx, urne, electeurs, mptId };
}

test("faucet : 100 XRP et la réserve est respectée", () => {
  const { engine, fund } = setup();
  const w = fund();
  assert.equal(engine.account(w.address).Balance, "100000000");
});

test("transaction signée par un autre wallet refusée", () => {
  const { engine, fund } = setup();
  const a = fund();
  const b = fund();
  const tx = engine.autofill({ TransactionType: "Payment", Account: a.address, Destination: b.address, Amount: "1000" });
  const signed = b.sign(tx); // signé par le mauvais wallet
  assert.equal(engine.submit(signed.tx_blob).engine_result, "tefBAD_AUTH");
});

test("blob modifié après signature refusé", () => {
  const { engine, fund } = setup();
  const a = fund();
  const b = fund();
  const signed = a.sign(engine.autofill({ TransactionType: "Payment", Account: a.address, Destination: b.address, Amount: "1000" }));
  const tx = xrpl.decode(signed.tx_blob);
  tx.Amount = "50000000"; // on essaie de changer le montant
  assert.equal(engine.submit(xrpl.encode(tx)).engine_result, "temBAD_SIGNATURE");
});

test("compte non financé refusé", () => {
  const { engine } = setup();
  const w = xrpl.Wallet.generate();
  const signed = w.sign({ TransactionType: "Payment", Account: w.address, Destination: w.address, Amount: "1", Fee: "12", Sequence: 1, LastLedgerSequence: 99 });
  assert.equal(engine.submit(signed.tx_blob).engine_result, "terNO_ACCOUNT");
});

test("l'ID du MPT a le format XRPL (séquence + AccountID)", () => {
  const { mptId, urne } = scrutin();
  assert.equal(mptId.length, 48);
  assert.ok(mptId.endsWith(Buffer.from(xrpl.decodeAccountID(urne.address)).toString("hex").toUpperCase()));
});

test("un électeur vote une seule fois", () => {
  const { send, urne, electeurs, mptId, engine } = scrutin();
  assert.equal(send(electeurs[0], voteTx(electeurs[0].address, urne.address, mptId, "L1")).code, "tesSUCCESS");
  assert.equal(send(electeurs[0], voteTx(electeurs[0].address, urne.address, mptId, "L2")).code, "tecPATH_PARTIAL");
  assert.equal(engine.mptoken(mptId, electeurs[0].address).MPTAmount, "0");
});

test("pas de transfert entre électeurs (pas d'achat de voix)", () => {
  const { send, electeurs, mptId } = scrutin();
  const r = send(electeurs[0], mptPaymentTx(electeurs[0].address, electeurs[1].address, mptId));
  assert.equal(r.code, "tecNO_AUTH");
});

test("adresse non autorisée : ne peut ni recevoir ni voter", () => {
  const { send, fund, urne, mptId } = scrutin();
  const intrus = fund();
  send(intrus, holderOptInTx(intrus.address, mptId)); // il peut demander le jeton...
  assert.equal(send(urne, mptPaymentTx(urne.address, intrus.address, mptId)).code, "tecNO_AUTH"); // ...mais pas le recevoir
  assert.equal(send(intrus, voteTx(intrus.address, urne.address, mptId, "L1")).code, "tecNO_AUTH");
});

test("plafond d'émission", () => {
  const { send, fund, urne, mptId } = scrutin(2);
  const e = fund();
  send(e, holderOptInTx(e.address, mptId));
  send(urne, issuerAuthorizeTx(urne.address, e.address, mptId));
  assert.equal(send(urne, mptPaymentTx(urne.address, e.address, mptId)).code, "tecPATH_PARTIAL");
});

test("après la clôture : le ledger accepte encore le renvoi à l'urne (comme le Testnet)", () => {
  const { send, urne, electeurs, mptId } = scrutin();
  assert.equal(send(urne, lockTx(urne.address, mptId)).code, "tesSUCCESS");
  // renvoi à l'émetteur toujours possible, c'est le dépouillement qui l'écarte (ledger > clôture)
  assert.equal(send(electeurs[0], voteTx(electeurs[0].address, urne.address, mptId, "L1")).code, "tesSUCCESS");
});

test("après la clôture : l'urne ne peut plus distribuer, et pas de transfert", () => {
  const { send, fund, urne, electeurs, mptId } = scrutin(3);
  const e = fund();
  send(e, holderOptInTx(e.address, mptId));
  send(urne, issuerAuthorizeTx(urne.address, e.address, mptId));
  send(urne, lockTx(urne.address, mptId));
  assert.equal(send(urne, mptPaymentTx(urne.address, e.address, mptId)).code, "tecLOCKED");
});

test("un tec consomme les frais mais ne change rien d'autre", () => {
  const { send, electeurs, mptId, engine } = scrutin();
  const before = BigInt(engine.account(electeurs[0].address).Balance);
  send(electeurs[0], mptPaymentTx(electeurs[0].address, electeurs[1].address, mptId));
  assert.equal(BigInt(engine.account(electeurs[0].address).Balance), before - 12n);
  assert.equal(engine.mptoken(mptId, electeurs[0].address).MPTAmount, "1");
});

test("l'émetteur seul peut verrouiller", () => {
  const { send, electeurs, mptId } = scrutin();
  assert.equal(send(electeurs[0], lockTx(electeurs[0].address, mptId)).code, "tecNO_PERMISSION");
});

test("account_tx renvoie la forme API v2", () => {
  const { engine, urne } = scrutin();
  const r = handle(engine, { command: "account_tx", account: urne.address, forward: true });
  const t = r.transactions[0];
  assert.ok(t.hash && t.tx_json && t.meta && t.ledger_index);
  assert.equal(t.tx_json.TransactionType, "Payment"); // le financement par le faucet
});
