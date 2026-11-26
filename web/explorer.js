// Mini explorateur pour le ledger simulé. Routes : #tx=HASH, #account=ADRESSE, sinon dernières transactions.
import { RemoteSimClient } from "/web/sim-client.js";
import { decodeMemos, fromHex } from "/tally/memo.js";

const client = new RemoteSimClient();
const $ = (id) => document.getElementById(id);
const court = (s) => (s ? `${s.slice(0, 8)}...${s.slice(-6)}` : "");
const lienTx = (h) => `<a href="#tx=${h}">${court(h)}</a>`;
const lienAcc = (a) => (a ? `<a href="#account=${a}">${court(a)}</a>` : "-");
const badge = (code) => `<span class="badge ${code === "tesSUCCESS" ? "ok" : "ko"}">${code}</span>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function montant(a) {
  if (a == null) return "-";
  if (typeof a === "string") return `${Number(a) / 1e6} XRP`;
  return `${a.value} MPT (${court(a.mpt_issuance_id)})`;
}

function ligneTx(t) {
  const tx = t.tx_json;
  return `<tr>
    <td>${t.ledger_index}</td>
    <td>${lienTx(t.hash)}</td>
    <td>${tx.TransactionType}</td>
    <td>${lienAcc(tx.Account)}</td>
    <td>${lienAcc(tx.Destination || tx.Holder)}</td>
    <td>${montant(tx.Amount)}</td>
    <td>${badge(t.meta.TransactionResult)}</td>
  </tr>`;
}

const table = (rows) => `<table><thead><tr><th>Ledger</th><th>Hash</th><th>Type</th><th>De</th><th>Vers</th><th>Montant</th><th>Résultat</th></tr></thead><tbody>${rows || '<tr><td colspan="7">Rien pour l\'instant</td></tr>'}</tbody></table>`;

async function recentes() {
  const { result } = await client.request({ command: "sim_recent", limit: 60 });
  $("contenu").innerHTML = `<h2>Dernières transactions</h2><p class="aide">Dernier ledger validé : ${result.ledger_index}</p>${table(result.transactions.map(ligneTx).join(""))}`;
}

async function compte(addr) {
  const [{ result: info }, { result: objs }, { result: txs }] = await Promise.all([
    client.request({ command: "account_info", account: addr }),
    client.request({ command: "account_objects", account: addr }),
    client.request({ command: "account_tx", account: addr }),
  ]);
  const a = info.account_data;
  const objets = objs.account_objects
    .map((o) =>
      o.LedgerEntryType === "MPTokenIssuance"
        ? `<li>Émetteur du jeton <code>${o.mpt_issuance_id}</code> : ${o.OutstandingAmount} en circulation / max ${o.MaximumAmount ?? "illimité"}${o.Flags & 1 ? " (verrouillé)" : ""}</li>`
        : `<li>Détient <code>${court(o.MPTokenIssuanceID)}</code> : solde ${o.MPTAmount}${o.Flags & 2 ? ", autorisé" : ", pas encore autorisé"}</li>`
    )
    .join("");
  $("contenu").innerHTML = `<h2>Compte</h2>
    <dl class="fiche">
      <dt>Adresse</dt><dd>${a.Account}</dd>
      <dt>Solde</dt><dd>${Number(a.Balance) / 1e6} XRP</dd>
      <dt>Séquence</dt><dd>${a.Sequence}</dd>
      <dt>Objets possédés</dt><dd>${a.OwnerCount} (réserve : ${1 + a.OwnerCount * 0.2} XRP)</dd>
    </dl>
    <h3>Jetons MPT</h3><ul>${objets || "<li>aucun</li>"}</ul>
    <h3>Historique</h3>${table(txs.transactions.map(ligneTx).join(""))}`;
}

async function transaction(hash) {
  const { result: t } = await client.request({ command: "tx", transaction: hash });
  const tx = t.tx_json;
  const memo = decodeMemos(tx.Memos);
  const memosBruts = (tx.Memos || []).map((m) => `${fromHex(m.Memo.MemoType)} : ${fromHex(m.Memo.MemoData)}`).join("<br>");
  $("contenu").innerHTML = `<h2>Transaction</h2>
    <dl class="fiche">
      <dt>Hash</dt><dd>${t.hash}</dd>
      <dt>Résultat</dt><dd>${badge(t.meta.TransactionResult)}</dd>
      <dt>Type</dt><dd>${tx.TransactionType}</dd>
      <dt>Ledger</dt><dd>${t.ledger_index} (${t.close_time_iso})</dd>
      <dt>Compte</dt><dd>${lienAcc(tx.Account)}</dd>
      ${tx.Destination ? `<dt>Destination</dt><dd>${lienAcc(tx.Destination)}</dd>` : ""}
      ${tx.Holder ? `<dt>Holder</dt><dd>${lienAcc(tx.Holder)}</dd>` : ""}
      ${tx.Amount ? `<dt>Montant</dt><dd>${montant(tx.Amount)}</dd>` : ""}
      ${tx.MPTokenIssuanceID ? `<dt>Jeton</dt><dd>${tx.MPTokenIssuanceID}</dd>` : ""}
      ${t.meta.mpt_issuance_id ? `<dt>Jeton créé</dt><dd>${t.meta.mpt_issuance_id}</dd>` : ""}
      <dt>Frais</dt><dd>${tx.Fee} drops</dd>
      ${memosBruts ? `<dt>Memos (décodés)</dt><dd>${esc(memosBruts).replace(/&lt;br&gt;/g, "<br>")}${memo?.type === "vote" ? ` <strong>bulletin pour ${esc(memo.choix)}</strong>` : ""}</dd>` : ""}
    </dl>
    <h3>JSON brut</h3><pre>${esc(JSON.stringify({ tx_json: tx, meta: t.meta }, null, 2))}</pre>`;
}

async function route() {
  const h = location.hash.slice(1);
  const [k, v] = h.split("=");
  try {
    if (k === "tx" && v) await transaction(v);
    else if (k === "account" && v) await compte(v);
    else await recentes();
  } catch (err) {
    $("contenu").innerHTML = `<p class="etat erreur">${esc(err.message)}</p>`;
  }
}

$("go").addEventListener("click", () => {
  const q = $("q").value.trim();
  location.hash = q.startsWith("r") ? `account=${q}` : `tx=${q}`;
});
$("recent").addEventListener("click", () => (location.hash = ""));
window.addEventListener("hashchange", route);
route();
