// Moteur du ledger simulé FerraVote.
//
// But : pouvoir faire tourner le PoC sans réseau, avec les mêmes règles que XRPL
// pour les transactions qu'on utilise. Ce n'est PAS un vrai nœud (pas de consensus,
// un seul "validateur", un ledger fermé par transaction), mais :
//   - les transactions sont signées avec de vrais wallets xrpl.js et la signature est vérifiée ;
//   - le format binaire, les hash et les ID de MPT sont ceux de XRPL ;
//   - les codes de résultat (tesSUCCESS, tecNO_AUTH, tecLOCKED...) sont ceux de XRPL.
//
// Transactions gérées : Payment (XRP et MPT), MPTokenIssuanceCreate, MPTokenAuthorize,
// MPTokenIssuanceSet. Le reste renvoie temUNKNOWN.
import xrpl from "xrpl";

export const BASE_RESERVE = 1_000_000; // 1 XRP (valeurs actuelles du Testnet)
export const OWNER_RESERVE = 200_000; // 0,2 XRP par objet possédé
export const FEE = 12; // drops
export const FAUCET_AMOUNT = 100_000_000; // 100 XRP comme le faucet Testnet

// Seed "masterpassphrase" : compte genesis de tout réseau XRPL de test
const GENESIS = xrpl.Wallet.fromSeed("snoPBrXtMeMyMHUVTgbuqAfg1SUTb");

// Flags des objets du ledger (mêmes valeurs que rippled)
const lsfMPTLocked = 0x01;
const lsfMPTCanLock = 0x02;
const lsfMPTRequireAuth = 0x04;
const lsfMPTCanTransfer = 0x20;
const lsfMPTAuthorized = 0x02; // sur l'objet MPToken du détenteur

const tfMPTUnauthorize = 0x01;
const tfMPTLock = 0x01;
const tfMPTUnlock = 0x02;

export function emptyLedger() {
  return {
    ledgerIndex: 1,
    accounts: {
      [GENESIS.address]: { Balance: String(100_000_000_000 * 1_000_000), Sequence: 1, OwnerCount: 0 },
    },
    issuances: {},
    mptokens: {},
    txs: [],
  };
}

export class TxError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

const tokenKey = (id, account) => `${id}:${account}`;
const reserve = (owners) => BASE_RESERVE + owners * OWNER_RESERVE;

export class Engine {
  constructor(state) {
    this.s = state || emptyLedger();
  }

  // ---------- lecture ----------
  account(addr) {
    return this.s.accounts[addr];
  }

  issuance(id) {
    return this.s.issuances[id?.toUpperCase()];
  }

  mptoken(id, account) {
    return this.s.mptokens[tokenKey(id?.toUpperCase(), account)];
  }

  findTx(hash) {
    return this.s.txs.find((t) => t.hash === hash?.toUpperCase());
  }

  // Transactions où le compte apparaît (émetteur, destinataire ou Holder)
  accountTxs(addr) {
    return this.s.txs.filter((t) => t.affected.includes(addr));
  }

  // ---------- faucet ----------
  fund(address) {
    const tx = {
      TransactionType: "Payment",
      Account: GENESIS.address,
      Destination: address,
      Amount: String(FAUCET_AMOUNT),
    };
    const genesis = this.account(GENESIS.address);
    const filled = { ...tx, Fee: String(FEE), Sequence: genesis.Sequence, LastLedgerSequence: this.s.ledgerIndex + 20 };
    const signed = GENESIS.sign(filled);
    return this.submit(signed.tx_blob);
  }

  autofill(tx) {
    const acct = this.account(tx.Account);
    return {
      ...tx,
      Fee: tx.Fee ?? String(FEE),
      Sequence: tx.Sequence ?? acct?.Sequence ?? 0,
      LastLedgerSequence: tx.LastLedgerSequence ?? this.s.ledgerIndex + 20,
      Flags: tx.Flags ?? 0,
    };
  }

  // ---------- soumission ----------
  // Renvoie la même forme que la commande "submit" de rippled
  submit(txBlob) {
    let tx;
    try {
      tx = xrpl.decode(txBlob);
    } catch {
      return this.prelim("temMALFORMED", "blob illisible");
    }
    const hash = xrpl.hashes.hashSignedTx(txBlob);

    if (this.findTx(hash)) return this.prelim("tefALREADY", "transaction déjà dans le ledger", tx, hash);
    try {
      xrpl.validate(structuredClone(tx));
    } catch (err) {
      return this.prelim("temMALFORMED", err.message, tx, hash);
    }
    if (!xrpl.verifySignature(txBlob)) return this.prelim("temBAD_SIGNATURE", "signature invalide", tx, hash);

    // La clé qui a signé doit être celle du compte (pas de RegularKey ni de multisign ici)
    if (xrpl.deriveAddress(tx.SigningPubKey) !== tx.Account) {
      return this.prelim("tefBAD_AUTH", "la clé qui signe n'est pas celle du compte", tx, hash);
    }

    const acct = this.account(tx.Account);
    if (!acct) return this.prelim("terNO_ACCOUNT", "le compte n'existe pas (pas financé)", tx, hash);
    if (tx.Sequence < acct.Sequence) return this.prelim("tefPAST_SEQ", "séquence déjà utilisée", tx, hash);
    if (tx.Sequence > acct.Sequence) return this.prelim("terPRE_SEQ", "séquence trop grande", tx, hash);
    if (tx.LastLedgerSequence && tx.LastLedgerSequence < this.s.ledgerIndex) {
      return this.prelim("tefMAX_LEDGER", "LastLedgerSequence dépassé", tx, hash);
    }
    const fee = Number(tx.Fee);
    if (BigInt(acct.Balance) < BigInt(fee)) return this.prelim("terINSUF_FEE_B", "pas assez de XRP pour les frais", tx, hash);

    // La transaction entre dans le ledger : frais et séquence consommés même en cas de tec
    const before = structuredClone(this.s);
    acct.Balance = String(BigInt(acct.Balance) - BigInt(fee));
    acct.Sequence += 1;

    const meta = { TransactionIndex: 0, TransactionResult: "tesSUCCESS" };
    const affected = new Set([tx.Account]);
    if (tx.Destination) affected.add(tx.Destination);
    if (tx.Holder) affected.add(tx.Holder);

    try {
      this.apply(tx, meta);
    } catch (err) {
      if (!(err instanceof TxError)) throw err;
      // on annule tout sauf les frais et la séquence
      const fees = acct.Balance;
      const seq = acct.Sequence;
      this.s = before;
      this.s.accounts[tx.Account].Balance = fees;
      this.s.accounts[tx.Account].Sequence = seq;
      meta.TransactionResult = err.code;
      delete meta.delivered_amount;
      delete meta.mpt_issuance_id;
    }

    // Les MPT : l'émetteur est concerné par toutes les transactions de son jeton
    const mptId = tx.MPTokenIssuanceID || (typeof tx.Amount === "object" && tx.Amount.mpt_issuance_id);
    const iss = mptId && this.issuance(mptId);
    if (iss) affected.add(iss.Issuer);

    const ledgerIndex = this.s.ledgerIndex;
    this.s.ledgerIndex += 1; // un ledger fermé par transaction, c'est plus simple
    const entry = {
      hash,
      ledger_index: ledgerIndex,
      close_time_iso: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      tx_json: { ...tx, hash },
      meta,
      affected: [...affected],
    };
    this.s.txs.push(entry);

    const code = meta.TransactionResult;
    return {
      engine_result: code,
      engine_result_message: code === "tesSUCCESS" ? "The transaction was applied." : "Applied but failed (tec), fee claimed.",
      accepted: true,
      applied: true,
      tx_blob: txBlob,
      tx_json: { ...tx, hash },
    };
  }

  prelim(code, message, tx = {}, hash = undefined) {
    return { engine_result: code, engine_result_message: message, accepted: false, applied: false, tx_json: { ...tx, hash } };
  }

  // ---------- règles ----------
  apply(tx, meta) {
    switch (tx.TransactionType) {
      case "Payment":
        return typeof tx.Amount === "string" ? this.payXrp(tx, meta) : this.payMpt(tx, meta);
      case "MPTokenIssuanceCreate":
        return this.mptCreate(tx, meta);
      case "MPTokenAuthorize":
        return this.mptAuthorize(tx);
      case "MPTokenIssuanceSet":
        return this.mptSet(tx);
      default:
        throw new TxError("temUNKNOWN", `${tx.TransactionType} n'est pas géré par le simulateur`);
    }
  }

  payXrp(tx, meta) {
    const src = this.account(tx.Account);
    const amount = BigInt(tx.Amount);
    if (BigInt(src.Balance) - amount < BigInt(reserve(src.OwnerCount))) {
      throw new TxError("tecUNFUNDED_PAYMENT", "pas assez de XRP (réserve comprise)");
    }
    let dst = this.account(tx.Destination);
    if (!dst) {
      if (amount < BigInt(BASE_RESERVE)) throw new TxError("tecNO_DST_INSUF_XRP", "montant inférieur à la réserve de base");
      dst = this.s.accounts[tx.Destination] = { Balance: "0", Sequence: this.s.ledgerIndex, OwnerCount: 0 };
    }
    src.Balance = String(BigInt(src.Balance) - amount);
    dst.Balance = String(BigInt(dst.Balance) + amount);
    meta.delivered_amount = tx.Amount;
  }

  payMpt(tx, meta) {
    const { mpt_issuance_id: id, value } = tx.Amount;
    const iss = this.issuance(id);
    if (!iss) throw new TxError("tecOBJECT_NOT_FOUND", "jeton inconnu");
    if (!this.account(tx.Destination)) throw new TxError("tecNO_DST", "destinataire inexistant");
    const v = BigInt(value);

    const fromIssuer = tx.Account === iss.Issuer;
    const toIssuer = tx.Destination === iss.Issuer;
    if (fromIssuer && toIssuer) throw new TxError("temREDUNDANT");

    // Entre deux détenteurs il faut tfMPTCanTransfer. C'est ce qui empêche de donner sa voix.
    if (!fromIssuer && !toIssuer && !(iss.Flags & lsfMPTCanTransfer)) {
      throw new TxError("tecNO_AUTH", "jeton non transférable entre détenteurs");
    }

    const check = (holder) => {
      const tok = this.mptoken(id, holder);
      if (!tok) throw new TxError(iss.Flags & lsfMPTRequireAuth ? "tecNO_AUTH" : "tecOBJECT_NOT_FOUND", `${holder} ne détient pas ce jeton`);
      if ((iss.Flags & lsfMPTRequireAuth) && !(tok.Flags & lsfMPTAuthorized)) {
        throw new TxError("tecNO_AUTH", `${holder} n'est pas autorisé par l'émetteur`);
      }
      if ((iss.Flags & lsfMPTLocked) || (tok.Flags & lsfMPTLocked)) throw new TxError("tecLOCKED", "jeton verrouillé");
      return tok;
    };

    if (fromIssuer) {
      const tok = check(tx.Destination);
      const max = BigInt(iss.MaximumAmount ?? "9223372036854775807");
      if (BigInt(iss.OutstandingAmount) + v > max) throw new TxError("tecPATH_PARTIAL", "émission maximale atteinte");
      tok.MPTAmount = String(BigInt(tok.MPTAmount) + v);
      iss.OutstandingAmount = String(BigInt(iss.OutstandingAmount) + v);
    } else {
      const src = check(tx.Account);
      if (BigInt(src.MPTAmount) < v) throw new TxError("tecPATH_PARTIAL", "solde de jeton insuffisant");
      src.MPTAmount = String(BigInt(src.MPTAmount) - v);
      if (toIssuer) {
        iss.OutstandingAmount = String(BigInt(iss.OutstandingAmount) - v);
      } else {
        const dst = check(tx.Destination);
        dst.MPTAmount = String(BigInt(dst.MPTAmount) + v);
      }
    }
    meta.delivered_amount = { mpt_issuance_id: id, value };
  }

  mptCreate(tx, meta) {
    const acct = this.account(tx.Account);
    if (BigInt(acct.Balance) < BigInt(reserve(acct.OwnerCount + 1))) {
      throw new TxError("tecINSUFFICIENT_RESERVE", "pas assez de XRP pour la réserve");
    }
    const seq = tx.Sequence.toString(16).padStart(8, "0");
    const id = (seq + Buffer.from(xrpl.decodeAccountID(tx.Account)).toString("hex")).toUpperCase();
    this.s.issuances[id] = {
      LedgerEntryType: "MPTokenIssuance",
      mpt_issuance_id: id,
      Issuer: tx.Account,
      Sequence: tx.Sequence,
      Flags: tx.Flags & 0x7e, // les tf de création deviennent des lsf (même valeurs)
      AssetScale: tx.AssetScale ?? 0,
      MaximumAmount: tx.MaximumAmount,
      OutstandingAmount: "0",
      MPTokenMetadata: tx.MPTokenMetadata,
    };
    acct.OwnerCount += 1;
    meta.mpt_issuance_id = id;
  }

  mptAuthorize(tx) {
    const iss = this.issuance(tx.MPTokenIssuanceID);
    if (!iss) throw new TxError("tecOBJECT_NOT_FOUND", "jeton inconnu");

    if (tx.Holder) {
      // Côté émetteur : valider (ou retirer) un détenteur
      if (tx.Account !== iss.Issuer) throw new TxError("tecNO_PERMISSION", "seul l'émetteur peut autoriser");
      if (!(iss.Flags & lsfMPTRequireAuth)) throw new TxError("tecNO_AUTH", "le jeton n'exige pas d'autorisation");
      const tok = this.mptoken(iss.mpt_issuance_id, tx.Holder);
      if (!tok) throw new TxError("tecOBJECT_NOT_FOUND", "le détenteur n'a pas encore demandé le jeton");
      if ((tx.Flags ?? 0) & tfMPTUnauthorize) tok.Flags &= ~lsfMPTAuthorized;
      else tok.Flags |= lsfMPTAuthorized;
      return;
    }

    // Côté détenteur : créer (ou supprimer) son objet MPToken
    if (tx.Account === iss.Issuer) throw new TxError("tecNO_PERMISSION", "l'émetteur ne peut pas détenir son propre jeton");
    const key = tokenKey(iss.mpt_issuance_id, tx.Account);
    const acct = this.account(tx.Account);
    const tok = this.s.mptokens[key];
    if ((tx.Flags ?? 0) & tfMPTUnauthorize) {
      if (!tok) throw new TxError("tecOBJECT_NOT_FOUND");
      if (tok.MPTAmount !== "0") throw new TxError("tecHAS_OBLIGATIONS", "solde non nul");
      delete this.s.mptokens[key];
      acct.OwnerCount -= 1;
      return;
    }
    if (tok) throw new TxError("tecDUPLICATE", "déjà détenteur de ce jeton");
    if (BigInt(acct.Balance) < BigInt(reserve(acct.OwnerCount + 1))) {
      throw new TxError("tecINSUFFICIENT_RESERVE", "pas assez de XRP pour la réserve");
    }
    this.s.mptokens[key] = {
      LedgerEntryType: "MPToken",
      Account: tx.Account,
      MPTokenIssuanceID: iss.mpt_issuance_id,
      MPTAmount: "0",
      Flags: 0,
    };
    acct.OwnerCount += 1;
  }

  mptSet(tx) {
    const iss = this.issuance(tx.MPTokenIssuanceID);
    if (!iss) throw new TxError("tecOBJECT_NOT_FOUND", "jeton inconnu");
    if (tx.Account !== iss.Issuer) throw new TxError("tecNO_PERMISSION", "seul l'émetteur peut verrouiller");
    if (!(iss.Flags & lsfMPTCanLock)) throw new TxError("tecNO_PERMISSION", "jeton créé sans tfMPTCanLock");
    const target = tx.Holder ? this.mptoken(iss.mpt_issuance_id, tx.Holder) : iss;
    if (!target) throw new TxError("tecOBJECT_NOT_FOUND");
    const flags = tx.Flags ?? 0;
    if (flags & tfMPTLock) target.Flags |= lsfMPTLocked;
    else if (flags & tfMPTUnlock) target.Flags &= ~lsfMPTLocked;
  }
}
