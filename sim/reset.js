// Remet le ledger simulé à zéro (supprime data/sim/)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "sim");
fs.rmSync(dir, { recursive: true, force: true });
console.log("Ledger simulé remis à zéro (data/sim/ supprimé)");
