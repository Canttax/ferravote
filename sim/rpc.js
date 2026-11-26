// Traduit les requêtes de type rippled (account_tx, ledger_entry, submit...) vers le moteur.
// Les réponses ont la même forme que celles d'un vrai nœud (API v2), pour que
// tally/core.js et l'interface marchent sans changement.
export class RpcError extends Error {
  constructor(error, message) {
    super(message || error);
    this.data = { error, error_message: message || error };
  }
}

const pick = (t) => ({ hash: t.hash, ledger_index: t.ledger_index, close_time_iso: t.close_time_iso, tx_json: t.tx_json, meta: t.meta, validated: true });

export function handle(engine, req) {
  const s = engine.s;
  switch (req.command) {
    case "server_info":
      return {
        info: {
          build_version: "simulateur-ferravote",
          complete_ledgers: `1-${s.ledgerIndex - 1}`,
          validated_ledger: { seq: s.ledgerIndex - 1, base_fee_xrp: 0.00001, reserve_base_xrp: 1, reserve_inc_xrp: 0.2 },
        },
      };

    case "ledger_current":
      return { ledger_current_index: s.ledgerIndex };

    case "ledger":
      return { ledger_index: s.ledgerIndex - 1, validated: true, ledger: { ledger_index: String(s.ledgerIndex - 1) } };

    case "account_info": {
      const a = engine.account(req.account);
      if (!a) throw new RpcError("actNotFound", "Account not found.");
      return { account_data: { Account: req.account, ...a, LedgerEntryType: "AccountRoot" }, validated: true };
    }

    case "account_objects": {
      if (!engine.account(req.account)) throw new RpcError("actNotFound", "Account not found.");
      const objs = [
        ...Object.values(s.issuances).filter((i) => i.Issuer === req.account),
        ...Object.values(s.mptokens).filter((m) => m.Account === req.account),
      ];
      return { account: req.account, account_objects: objs, validated: true };
    }

    case "account_tx": {
      if (!engine.account(req.account)) throw new RpcError("actNotFound", "Account not found.");
      let list = engine.accountTxs(req.account).map(pick);
      if (!req.forward) list = list.reverse();
      return { account: req.account, transactions: list, validated: true };
    }

    case "tx": {
      const t = engine.findTx(req.transaction);
      if (!t) throw new RpcError("txnNotFound", "Transaction not found.");
      return { ...t.tx_json, ...pick(t) };
    }

    case "ledger_entry": {
      let node;
      if (req.mptoken) node = engine.mptoken(req.mptoken.mpt_issuance_id, req.mptoken.account);
      else if (req.mpt_issuance) node = engine.issuance(req.mpt_issuance);
      else if (req.account_root) {
        const a = engine.account(req.account_root);
        node = a && { Account: req.account_root, ...a, LedgerEntryType: "AccountRoot" };
      }
      if (!node) throw new RpcError("entryNotFound", "Entry not found.");
      return { node, validated: true };
    }

    case "submit":
      return engine.submit(req.tx_blob);

    case "fee":
      return { drops: { base_fee: "10", open_ledger_fee: "12" }, ledger_current_index: s.ledgerIndex };

    // Commandes propres au simulateur, utilisées par le mini explorateur
    case "sim_recent":
      return { transactions: s.txs.slice(-(req.limit || 50)).reverse().map(pick), ledger_index: s.ledgerIndex - 1 };

    case "sim_fund":
      return engine.fund(req.address);

    default:
      throw new RpcError("unknownCmd", `${req.command} n'est pas géré par le simulateur`);
  }
}
