// Dans le navigateur, en mode simulation : remplace xrpl.Client.
// Les requêtes partent vers le serveur local (/sim/rpc) qui héberge le ledger simulé.
// La signature reste faite dans le navigateur avec xrpl.Wallet, la seed ne sort pas de la page.
export class RemoteSimClient {
  constructor(base = "") {
    this.base = base;
    this.connected = false;
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

  async post(path, body) {
    const res = await fetch(this.base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return res.json();
  }

  async request(req) {
    const out = await this.post("/sim/rpc", req);
    if (out.error) {
      const err = new Error(out.error_message || out.error);
      err.data = { error: out.error };
      throw err;
    }
    return out;
  }

  async autofill(tx) {
    return this.post("/sim/autofill", tx);
  }

  async submitAndWait(blob) {
    const { result } = await this.request({ command: "submit", tx_blob: blob });
    if (!result.applied) throw new Error(`${result.engine_result} : ${result.engine_result_message}`);
    return this.request({ command: "tx", transaction: result.tx_json.hash });
  }
}
