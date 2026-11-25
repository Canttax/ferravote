// Format des Memos FerraVote. Fichier utilisé à la fois par Node et par le navigateur,
// donc pas de dépendance (ni xrpl, ni Buffer).
//
//   MemoType = "ferravote"
//   MemoData = "VOTE:<code liste>"           ex : VOTE:L2
//   (prévu pour le commit-reveal : "COMMIT:<sha256>" puis "REVEAL:<code>:<sel>")

export const MEMO_TYPE = "ferravote";

export function toHex(str) {
  return Array.from(new TextEncoder().encode(str))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export function fromHex(hex) {
  if (!hex || hex.length % 2 !== 0) return "";
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return new TextDecoder().decode(bytes);
}

export function encodeMemo({ type, choix }) {
  if (type !== "vote") throw new Error(`type de memo inconnu : ${type}`);
  return {
    Memo: {
      MemoType: toHex(MEMO_TYPE),
      MemoFormat: toHex("text/plain"),
      MemoData: toHex(`VOTE:${choix}`),
    },
  };
}

// Renvoie { type: "vote", choix } ou null si la transaction n'a pas de memo FerraVote
export function decodeMemos(memos) {
  if (!Array.isArray(memos)) return null;
  for (const m of memos) {
    const memo = m.Memo || m;
    if (fromHex(memo.MemoType) !== MEMO_TYPE) continue;
    const data = fromHex(memo.MemoData).trim();
    const match = /^VOTE:([A-Za-z0-9_-]{1,16})$/.exec(data);
    if (match) return { type: "vote", choix: match[1].toUpperCase() };
    return { type: "inconnu", brut: data };
  }
  return null;
}
