# Guide : les notions XRPL utilisées et comment le projet est construit

Ce document reprend les notions vues dans les parcours XRPL Academy (XRPL Online Dev Training, puis Advanced Payments) et montre où chacune sert dans FerraVote. L'idée est que chacun de nous puisse expliquer n'importe quelle partie du projet devant le jury.

## 1. Les notions de base

### Compte, adresse et seed

- Un **wallet** c'est une paire de clés. La **seed** (`sEd...`) permet de retrouver la clé privée, c'est le secret à ne jamais partager. L'**adresse** (`r...`) est publique.
- Un compte n'existe sur le ledger qu'à partir du moment où il reçoit des XRP. Avant, n'importe quelle transaction depuis cette adresse est refusée (`terNO_ACCOUNT`).
- Dans xrpl.js : `xrpl.Wallet.generate()` crée une paire de clés, `xrpl.Wallet.fromSeed(seed)` la retrouve.

Chez nous : `ledger/wallets.js` crée l'urne, les 6 électeurs et l'intrus. Les seeds vont dans `.env` (jamais dans Git).

### Faucet

Sur le Testnet les XRP n'ont aucune valeur, on les reçoit gratuitement via le faucet : `client.fundWallet()` crée un compte et lui donne 100 XRP de test. **Pas besoin d'acheter des XRP ni d'avoir un vrai compte** pour faire tourner le PoC.

### Réserve et frais

- **Réserve de base** : 1 XRP bloqué sur chaque compte (valeur actuelle du Testnet).
- **Réserve par objet** : 0,2 XRP pour chaque objet que le compte possède (ici un jeton MPT créé, ou le fait de détenir un MPT).
- **Frais** : chaque transaction brûle quelques drops (1 XRP = 1 000 000 drops), en général 10 à 12. Les frais sont pris même si la transaction échoue avec un code `tec`.

Chez nous : chaque électeur doit avoir de quoi payer sa réserve pour détenir le jeton VOTE. C'est gratuit sur Testnet, mais à grande échelle ce serait un vrai coût (c'est dans nos limites).

### Transaction, signature, validation

1. On construit un objet JSON (`TransactionType`, `Account`, ...).
2. `client.autofill(tx)` ajoute `Fee`, `Sequence` (compteur du compte) et `LastLedgerSequence` (date limite).
3. `wallet.sign(tx)` donne un `tx_blob` (binaire signé) et le **hash** de la transaction.
4. On l'envoie, les validateurs se mettent d'accord (consensus) et la transaction est incluse dans un **ledger** validé, en 3 à 5 secondes.
5. Une fois validée elle est **immuable** : personne, même pas l'organisateur, ne peut la modifier.

Codes de résultat utiles :

| Code | Sens |
|---|---|
| `tesSUCCESS` | ok |
| `tec...` | incluse dans le ledger mais refusée (frais payés), par exemple `tecNO_AUTH`, `tecLOCKED`, `tecPATH_PARTIAL` |
| `tem...` | transaction mal formée, jamais incluse |
| `tef...` / `ter...` | problème de séquence, de signature ou de compte, jamais incluse |

Chez nous : `submit()` dans `ledger/common.js` fait tout ça et affiche le code et le lien vers l'explorateur.

### Memos

Une transaction peut porter des Memos (champs `MemoType`, `MemoData`, `MemoFormat`, en hexadécimal). C'est public et c'est inclus dans la signature, donc on ne peut pas le modifier après coup.

Chez nous : le bulletin est dans le Memo (`VOTE:L2`). Format détaillé dans [format-memo.md](format-memo.md).

### Explorateur

https://testnet.xrpl.org permet de voir n'importe quel compte ou transaction. C'est notre preuve devant le jury : tout le monde peut vérifier sans nous faire confiance.

## 2. Les Multi-Purpose Tokens (MPT, XLS-33)

Un MPT est un jeton émis par un compte, avec ses règles fixées une fois pour toutes à la création.

| Transaction | Qui | Ce que ça fait |
|---|---|---|
| `MPTokenIssuanceCreate` | émetteur | crée le jeton : plafond (`MaximumAmount`), décimales (`AssetScale`), flags |
| `MPTokenAuthorize` sans `Holder` | détenteur | "je veux détenir ce jeton", crée l'objet MPToken (réserve 0,2 XRP) |
| `MPTokenAuthorize` avec `Holder` | émetteur | valide le détenteur (nécessaire si le jeton a `tfMPTRequireAuth`) |
| `Payment` avec `Amount: { mpt_issuance_id, value }` | tous | envoie des jetons |
| `MPTokenIssuanceSet` avec `tfMPTLock` | émetteur | verrouille le jeton, plus rien ne circule |

Les flags qu'on utilise pour le jeton VOTE :

- `tfMPTRequireAuth` : l'urne doit valider chaque adresse, sinon impossible de recevoir le jeton ;
- `tfMPTCanLock` : l'urne pourra verrouiller le jeton à la clôture ;
- **pas** de `tfMPTCanTransfer` : un détenteur ne peut envoyer son jeton qu'à l'émetteur. On ne peut donc pas donner ou vendre sa voix à un autre électeur, il ne reste qu'une destination possible, l'urne ;
- `MaximumAmount` = nombre d'inscrits, `AssetScale` = 0 (pas de demi-voix).

Pourquoi pas une trust line ? Avec une trust line classique, les jetons peuvent circuler entre détenteurs, donc un électeur pourrait récupérer le jeton d'un autre et voter deux fois. Le MPT règle ça en une seule transaction de configuration.

## 3. Comment le scrutin utilise tout ça

| Étape | Script | Transactions | Ce que le ledger garantit |
|---|---|---|---|
| Wallets | `npm run wallets` | faucet | |
| Ouvrir le scrutin | `npm run create` | `MPTokenIssuanceCreate` | règles du jeton publiques et figées |
| Inscrire | `npm run authorize` | 2 × `MPTokenAuthorize` par électeur | liste des adresses autorisées publique |
| Distribuer | `npm run distribute` | `Payment` 1 VOTE | pas plus de jetons que d'inscrits |
| Voter | `npm run vote -- 1 L2` | `Payment` électeur → urne + Memo | 1 seul vote (solde 0 après), pas de transfert |
| Clôturer | `npm run close` | `MPTokenIssuanceSet` lock | plus aucun bulletin après |
| Dépouiller | `npm run tally` | lecture `account_tx` | recalculable par tout le monde |

## 4. Le mode simulation

Le dossier `sim/` contient un **ledger simulé** qui imite XRPL pour les transactions ci-dessus. On l'a ajouté pour pouvoir travailler et faire la démo sans réseau (Wi-Fi de l'école, Testnet lent ou remis à zéro).

Ce qui est fidèle à XRPL :

- les wallets, les signatures, le format binaire et les hash sont ceux de xrpl.js ;
- la signature est vérifiée, un blob modifié est refusé (`temBAD_SIGNATURE`) ;
- séquences, frais, réserve de base et par objet ;
- règles des MPT : autorisation, plafond, pas de transfert entre détenteurs, verrouillage ;
- mêmes codes de résultat et même format de réponse que rippled (API v2), donc **le dépouillement et l'interface sont exactement le même code** dans les deux modes.

Ce qui ne l'est pas :

- un seul "validateur" local, pas de consensus, un ledger fermé par transaction ;
- aucune valeur de preuve vis-à-vis de l'extérieur : seul le Testnet est vérifiable par le jury ;
- seulement les transactions utilisées par FerraVote (le reste renvoie `temUNKNOWN`).

Concrètement : on développe et on répète en simulation, et la démo officielle se fait sur le Testnet si le réseau répond (le jury note les transactions réelles visibles dans l'explorateur).

```bash
npm run demo:sim         # scénario complet sur le ledger simulé
npm run web:sim          # interface + explorateur local sur http://localhost:3000
npm run sim:reset        # repartir d'un ledger vide
# chaque script accepte --sim, par exemple :
npm run vote -- 1 L2 --sim
```

Les données de la simulation sont dans `data/sim/` (ledger, wallets, état du scrutin), ignoré par Git.

## 5. Construire le projet pas à pas

C'est l'ordre dans lequel on a monté le PoC, utile pour reprendre une partie :

1. **TP 1 et 2** : un script qui crée deux wallets avec le faucet et fait un paiement XRP avec un Memo. C'est la base de `ledger/common.js` (connexion, `submit`).
2. **Le jeton** : `ledger/tx.js` construit chaque transaction comme une fonction pure, testée hors ligne avec `xrpl.validate()` (`test/tx.test.js`). On a commencé par `createBallotTx` puis l'autorisation.
3. **Un script par étape** dans `ledger/`, chacun lisable seul (`npm run create`, ...) et réutilisé par `scripts/demo.js`. L'état public (adresse de l'urne, ID du jeton) est gardé dans `data/scrutin-state.json`.
4. **Le format des Memos** (`tally/memo.js`) puis **le dépouillement** (`tally/core.js`), écrit sans dépendance à Node pour tourner aussi dans le navigateur. Testé sur un faux historique (`test/tally.test.js`).
5. **L'interface** (`web/`) : HTML et JS sans framework, xrpl.js dans le navigateur. La page Résultats réutilise `tally/core.js`.
6. **Le simulateur** (`sim/`) : même interface que `xrpl.Client` (`request`, `autofill`, `submitAndWait`, `fundWallet`), donc il suffit de changer le client dans `connect()`.

Pour aller plus loin (issues ouvertes) : commit-reveal pour cacher les votes pendant le scrutin, signature avec GemWallet ou Crossmark, Credentials (XLS-70) pour l'éligibilité.
