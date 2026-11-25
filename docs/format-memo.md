# Format des Memos FerraVote

Chaque bulletin est un `Payment` de 1 jeton VOTE de l'électeur vers l'urne. Le choix est dans le premier Memo dont le type est `ferravote`.

| Champ | Valeur (avant conversion en hexa) | Exemple |
|---|---|---|
| `MemoType` | `ferravote` | `6665727261766F7465` en hexa |
| `MemoFormat` | `text/plain` | |
| `MemoData` | `VOTE:<code liste>` | `VOTE:L2` |

Règles appliquées au dépouillement (`tally/core.js`) :

- seules les transactions `tesSUCCESS` sont prises en compte ;
- le paiement doit porter sur le bon `mpt_issuance_id` et valoir exactement `1` ;
- l'adresse doit avoir été autorisée par l'urne (`MPTokenAuthorize` avec `Holder`) ;
- on garde le premier bulletin de chaque adresse, les suivants sont marqués "deuxième vote" ;
- un bulletin validé après le ledger de clôture (`MPTokenIssuanceSet` avec `tfMPTLock`) est ignoré ;
- un code qui ne correspond à aucune liste donne un bulletin nul.

Normalement le ledger empêche déjà le double vote, le vote non autorisé et le vote après clôture. Le script refait quand même les contrôles pour qu'un observateur n'ait pas à faire confiance à notre configuration du jeton.

## Prévu pour le commit-reveal (pas encore codé)

- pendant le vote : `MemoData = COMMIT:<sha256(code + ":" + sel)>`
- après la clôture : l'électeur publie `REVEAL:<code>:<sel>` (par exemple un paiement de 1 drop vers l'urne avec ce Memo)
