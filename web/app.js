// Interface FerraVote (navigateur). xrpl.js est chargé en global par /vendor/xrpl.js
import { encodeMemo } from "/tally/memo.js";
import { tallyFromLedger } from "/tally/core.js";
import { RemoteSimClient } from "/web/sim-client.js";

const $ = (id) => document.getElementById(id);
let config = null;
let client = null;

// ---------- utilitaires ----------
async function getClient() {
  if (client && client.isConnected()) return client;
  client = config.mode === "simulation" ? new RemoteSimClient() : new xrpl.Client(config.network);
  await client.connect();
  return client;
}

const sim = () => config.mode === "simulation";
const txUrl = (hash) => (sim() ? `${config.explorer}#tx=${hash}` : `${config.explorer}/transactions/${hash}`);
const accUrl = (addr) => (sim() ? `${config.explorer}#account=${addr}` : `${config.explorer}/accounts/${addr}`);
const court = (s) => (s ? `${s.slice(0, 6)}...${s.slice(-4)}` : "");

function etat(el, texte, type = "") {
  el.className = `etat ${type}`;
  el.innerHTML = texte;
}

// ---------- onglets ----------
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === btn.dataset.tab));
  });
});

// ---------- voter ----------
function walletSaisi() {
  try {
    return xrpl.Wallet.fromSeed($("seed").value.trim());
  } catch {
    return null;
  }
}

// Solde de jeton VOTE de l'électeur (null s'il n'a pas d'objet MPToken = pas inscrit)
async function soldeVote(adresse) {
  const c = await getClient();
  try {
    const res = await c.request({
      command: "ledger_entry",
      mptoken: { mpt_issuance_id: config.mptId, account: adresse },
      ledger_index: "validated",
    });
    return Number(res.result.node.MPTAmount || 0);
  } catch {
    return null;
  }
}

$("btn-verifier").addEventListener("click", async () => {
  const w = walletSaisi();
  const info = $("info-electeur");
  $("btn-voter").disabled = true;
  if (!w) return etat(info, "Seed invalide.", "erreur");
  if (!config.mptId) return etat(info, "Aucun scrutin ouvert (lancer npm run create).", "erreur");
  etat(info, "Lecture du ledger...");
  const solde = await soldeVote(w.address);
  const lien = `<a href="${accUrl(w.address)}" target="_blank">${w.address}</a>`;
  if (solde === null) return etat(info, `${lien} n'est pas inscrit sur ce scrutin.`, "erreur");
  if (solde === 0) return etat(info, `${lien} n'a plus de jeton : il a déjà voté (ou n'a pas encore reçu son jeton).`, "erreur");
  etat(info, `${lien} possède ${solde} jeton VOTE, vous pouvez voter.`, "ok");
  $("btn-voter").disabled = false;
});

$("btn-voter").addEventListener("click", async () => {
  const w = walletSaisi();
  const choix = document.querySelector('input[name="liste"]:checked')?.value;
  const out = $("etat-vote");
  if (!w || !choix) return etat(out, "Choisissez une liste.", "erreur");

  $("btn-voter").disabled = true;
  etat(out, "Signature et envoi du bulletin, validation en cours (3 à 5 secondes)...");
  try {
    const c = await getClient();
    const tx = await c.autofill({
      TransactionType: "Payment",
      Account: w.address,
      Destination: config.urne,
      Amount: { mpt_issuance_id: config.mptId, value: "1" },
      Memos: [encodeMemo({ type: "vote", choix })],
    });
    const signed = w.sign(tx);
    const res = await c.submitAndWait(signed.tx_blob);
    const code = res.result.meta.TransactionResult;
    const lien = `<a href="${txUrl(signed.hash)}" target="_blank">${signed.hash}</a>`;
    if (code === "tesSUCCESS") {
      etat(out, `Bulletin enregistré dans le ledger ${res.result.ledger_index}.<br>Preuve de vote : ${lien}`, "ok");
    } else {
      etat(out, `Bulletin refusé par le ledger (${code}).<br>${lien}`, "erreur");
    }
  } catch (err) {
    etat(out, `Erreur : ${err.message}`, "erreur");
  }
});

// ---------- résultats ----------
$("btn-compter").addEventListener("click", compter);

async function compter() {
  const urne = $("urne").value.trim();
  const mptId = $("mpt").value.trim();
  const out = $("etat-compte");
  if (!urne || !mptId) return etat(out, "Renseignez l'urne et l'ID du jeton.", "erreur");

  etat(out, "Téléchargement de l'historique de l'urne...");
  try {
    const r = await tallyFromLedger(await getClient(), { urne, mptId, listes: config.scrutin.listes });
    afficherResultats(r);
    const clos = r.cloture ? `clôturé au ledger ${r.cloture.ledger}` : "scrutin encore ouvert";
    etat(out, `Recompté le ${new Date().toLocaleString("fr-FR")} (${clos}).`, "ok");
  } catch (err) {
    etat(out, `Erreur : ${err.message}`, "erreur");
  }
}

function afficherResultats(r) {
  $("bloc-resultats").hidden = false;
  $("chiffres").innerHTML = [
    ["Autorisés", r.autorises],
    ["Votants", r.votants],
    ["Exprimés", r.exprimes],
    ["Nuls", r.nuls],
  ]
    .map(([k, v]) => `<div><span>${v}</span>${k}</div>`)
    .join("");

  $("barres").innerHTML = r.resultats
    .map(
      (l) => `<div class="barre">
        <div class="nom">${l.code} · ${l.nom}</div>
        <div class="fond"><div class="plein" style="width:${l.pourcentage}%"></div></div>
        <div class="nb">${l.voix} voix (${l.pourcentage} %)</div>
      </div>`
    )
    .join("");

  $("bulletins").innerHTML = r.bulletins
    .map(
      (b) => `<tr class="${b.statut === "compté" ? "" : "rejete"}">
        <td><a href="${accUrl(b.electeur)}" target="_blank">${court(b.electeur)}</a></td>
        <td>${b.choix ?? "-"}</td>
        <td>${b.statut}</td>
        <td>${b.ledger}</td>
        <td><a href="${txUrl(b.hash)}" target="_blank">${court(b.hash)}</a></td>
      </tr>`
    )
    .join("") || `<tr><td colspan="5">Aucun bulletin pour l'instant.</td></tr>`;
}

// ---------- démarrage ----------
async function init() {
  config = await (await fetch("/api/config")).json();
  $("titre-scrutin").textContent = config.scrutin.titre;
  $("reseau").textContent = sim() ? "ledger simulé en local (mode simulation)" : config.network;
  if (sim()) $("lien-explorateur").hidden = false;
  $("urne").value = config.urne || "";
  $("mpt").value = config.mptId || "";

  $("choix-listes").insertAdjacentHTML(
    "beforeend",
    config.scrutin.listes
      .map((l) => `<label class="choix"><input type="radio" name="liste" value="${l.code}"> <strong>${l.code}</strong> ${l.nom}</label>`)
      .join("")
  );
}

init().catch((err) => etat($("etat-vote"), `Impossible de charger la configuration : ${err.message}`, "erreur"));
