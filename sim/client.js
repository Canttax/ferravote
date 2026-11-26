// Client Node qui imite xrpl.Client mais parle au ledger simulé.
// Le ledger est enregistré dans data/sim/ledger.json pour que les scripts lancés
// les uns après les autres (npm run create, puis authorize, etc.) voient le même état.
import fs from "node:fs";
import path from "node:path";
import xrpl from "xrpl";
import { Engine, emptyLedger } from "./engine.js";
import { handle } from "./rpc.js";

export class SimLedgerStore {
  constructor(file) {
    this.file = file;
  }
  load() {
    if (!fs.existsSync(this.file)) return new Engine(emptyLedger());
    return new Engine(JSON.parse(fs.readFileSync(this.file, "utf8")));
  }
  save(engine) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(engine.s));
    fs.renameSync(tmp, this.file);
  }
  // Charge, exécute, enregistre si quelque chose a changé
  run(fn, { write = false } = {}) {
    const engine = this.load();
    const out = fn(engine);
    if (write) this.save(engine);
    return out;
  }
}

const WRITES = new Set(["submit", "sim_fund"]);

export function rpc(store, req) {
  return store.run((engine) => handle(engine, req), { write: WRITES.has(req.command) });
}

export class SimClient {
  constructor(file) {
    this.store = new SimLedgerStore(file);
    this.connected = false;
    this.url = "simulation";
  }

  async connect() {
    this.connected = true;
  }
  async disconnect() {
    this.connected = false;
  }
  isConnected() {
    return this.connected;
  }

  async request(req) {
    // même forme que xrpl.Client : { result } ou une erreur avec .data.error
    return { result: rpc(this.store, req) };
  }

  async autofill(tx) {
    return this.store.run((engine) => engine.autofill(tx));
  }

  async getLedgerIndex() {
    return this.store.run((engine) => engine.s.ledgerIndex - 1);
  }

  async submitAndWait(blob) {
    const { result } = await this.request({ command: "submit", tx_blob: typeof blob === "string" ? blob : blob.tx_blob });
    if (!result.applied) {
      const err = new Error(`${result.engine_result} : ${result.engine_result_message}`);
      err.data = { engine_result: result.engine_result };
      throw err;
    }
    return this.request({ command: "tx", transaction: result.tx_json.hash });
  }

  // Equivalent de client.fundWallet() : crée un wallet et le finance depuis le compte genesis
  async fundWallet() {
    const wallet = xrpl.Wallet.generate();
    const { result } = await this.request({ command: "sim_fund", address: wallet.address });
    if (result.engine_result !== "tesSUCCESS") throw new Error(`faucet simulé : ${result.engine_result}`);
    return { wallet, balance: 100 };
  }
}
