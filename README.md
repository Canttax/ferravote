# FerraVote

Vote d'assemblée générale vérifiable sur le XRP Ledger.

Projet de l'équipe **Los Ferratos** pour le Blockchain Challenge XRPL 2026 (ING5, sujet Vote).

| Membre | Rôle |
|---|---|
| Médéric Rolland | Chef de projet, pitch, issues |
| Roméo Fondaneiche | Scripts XRPL (création du jeton, autorisation, distribution, clôture) |
| Sacha Tesson | Interface web et scénario de démo |
| Timothée Petit | Dépouillement, gestion des clés, secret du vote, README |

## L'idée

Les associations, coopératives, mutuelles ou copropriétés votent souvent en AG et les résultats sont parfois contestés. Avec un formulaire en ligne, l'organisateur peut tout modifier sans que personne ne puisse le prouver.

Avec FerraVote :

- l'urne (compte de l'organisateur) crée un jeton **MPT "VOTE"** avec autorisation obligatoire, **sans droit de transfert** et un plafond égal au nombre d'inscrits ;
- chaque électeur inscrit sur la liste d'émargement (hors chaîne) est autorisé puis reçoit **1 jeton** ;
- pour voter il **renvoie son jeton à l'urne** avec le code de sa liste dans un Memo, son solde passe à 0 donc il ne peut pas revoter ;
- à la clôture l'urne **verrouille** le jeton ;
- **n'importe qui peut recompter** en relisant l'historique public de l'urne (script `tally` ou page Résultats).

Pas de smart contract, uniquement des fonctions natives de XRPL : `MPTokenIssuanceCreate`, `MPTokenAuthorize`, `Payment` avec Memos, `MPTokenIssuanceSet`.

> Le vote est **vérifiable** mais seulement **pseudonyme** : le choix est lisible dans le Memo et l'organisateur connaît le lien entre adresse et personne. On en parle plus bas dans [Limites](#limites).

## Réseau

| | |
|---|---|
| Réseau | XRPL **Testnet** natif |
| Serveur principal | `wss://s.altnet.rippletest.net:51233` |
| Serveurs de secours (port 443) | `wss://testnet.xrpl-labs.com`, `wss://testnet.honeycluster.io` |
| Faucet | `https://faucet.altnet.rippletest.net/accounts`, appelé par `client.fundWallet()` |
| Explorateur | https://testnet.xrpl.org |

Pas de compte à créer ni d'inscription : le Testnet est public et les XRP de test sont donnés gratuitement par le faucet. Les scripts essaient les serveurs dans l'ordre, donc si le Wi-Fi de l'école bloque le port 51233 on passe tout seul sur un serveur en port 443. La liste est modifiable dans `.env` (`XRPL_NETWORK`).

Comptes de test uniquement. Aucune seed Mainnet, et aucune seed dans Git.

## Installation

Deux façons de faire, comme dans la fiche "Accès au XRPL Testnet" du hackathon.

### Option 1 : GitHub Codespaces (recommandée)

Rien à installer et pas de souci de Wi-Fi, le Codespace tourne dans le cloud.

1. Sur la page GitHub du dépôt : **Code** puis **Codespaces** puis **Create codespace on main**.
2. Le fichier `.devcontainer/devcontainer.json` installe Node 22 et lance `npm install` tout seul.
3. Dans le terminal du Codespace : `npm run check` puis `npm run demo`.
4. Pour l'interface, `npm run web` : le port 3000 s'ouvre dans un onglet du navigateur.

Les seeds générées restent dans le `.env` du Codespace, qui n'est pas commité.

### Option 2 : sur son poste

Prérequis : Node.js LTS (20 ou plus), npm, Git.

```bash
git clone https://github.com/Canttax/ferravote.git
cd ferravote
npm install
npm run check        # vérifie la connexion au Testnet et le faucet
```

`npm run check` se connecte (avec les serveurs de secours si besoin), affiche le dernier ledger validé et crée un wallet de test avec le faucet. Si ça échoue partout : partage de connexion, Codespaces, ou le [mode simulation](#mode-simulation-sans-réseau).

### Si le faucet est en panne : le wallet banque

Quand le faucet ne répond pas, `npm run wallets` (et donc `npm run demo`) crée quand même les wallets : un wallet déjà financé leur envoie des XRP par un simple `Payment` (10 XRP pour l'urne, 5 pour chaque électeur, environ 45 XRP au total). Le wallet banque est pris :

1. dans `BANQUE_SEED` du `.env` (une ou plusieurs seeds séparées par des virgules, par exemple un wallet financé à la main sur la page faucet de xrpl.org) ;
2. sinon dans le `wallets.json` créé par le Codespace XRPL Academy (`dev-training-june-2026`), s'il est cloné à côté de notre dépôt (cas du Codespace : `/workspaces/dev-training-june-2026/wallets.json`). On peut aussi donner un autre chemin avec `BANQUE_WALLETS_JSON`.

`npm run check` affiche les wallets banque trouvés et leur solde.

### Problèmes fréquents

| Symptôme | Ce qu'on fait |
|---|---|
| Timeout à la connexion | Le port 51233 est bloqué, les scripts passent sur les serveurs en 443. Sinon partage de connexion ou Codespaces |
| Le faucet ne répond pas (`fetch failed`) | Toute la promo l'appelle en même temps, ou le Testnet vient d'être réinitialisé. Le script réessaie, puis finance les wallets depuis un **wallet banque** déjà financé (voir plus bas). On crée nos comptes une fois et on les réutilise via `.env` |
| Un compte ou un solde a disparu | Le Testnet a été réinitialisé : `npm run wallets -- --force` recrée tout |
| Transaction envoyée mais rien ne change | On attend toujours la validation et on lit `meta.TransactionResult` (`tesSUCCESS` attendu), c'est ce que fait `submit()` dans `ledger/common.js` |

## Lancer la démo complète

```bash
npm run demo
```

Le script enchaîne tout le scénario sur le Testnet (compter 2 à 3 minutes, surtout à cause du faucet) :

1. création de 8 wallets via le faucet : l'urne, 6 électeurs et un "intrus" non inscrit ;
2. création du jeton VOTE (plafond 6) ;
3. autorisation des 6 inscrits (2 transactions chacun) ;
4. distribution de 1 VOTE à chacun ;
5. 5 votes : L1, L2, L1, L3, L1 (l'électeur 6 ne vote pas tout de suite) ;
6. l'électeur 1 essaie de revoter : **refusé par le ledger**, il n'a plus de jeton ;
7. l'électeur 6 essaie de donner son jeton à l'électeur 5 (achat de voix) : **refusé**, le jeton n'est pas transférable ;
8. l'intrus essaie de voter : **refusé**, il n'a jamais été autorisé ;
9. clôture du scrutin (verrouillage du jeton) ;
10. l'électeur 6 essaie de voter après la clôture : normalement **refusé** par le ledger (`tecLOCKED`), et de toute façon ignoré au dépouillement car validé après le ledger de clôture ;
11. dépouillement : L1 3 voix, L2 1 voix, L3 1 voix.

Chaque transaction affiche son lien vers l'explorateur.

Pour la soutenance on utilise `npm run demo -- --pas-a-pas`, qui attend Entrée entre chaque étape.

Les seeds sont écrites dans `.env` et l'état public du scrutin (adresse de l'urne, ID du jeton) dans `data/scrutin-state.json`. Si `.env` contient déjà des seeds, `npm run demo` les réutilise et ouvre un nouveau scrutin.

## Mode simulation (sans réseau)

Pas d'accès au Testnet, réseau de l'école bloqué ou faucet en panne ? Le dossier `sim/` contient un ledger XRPL simulé en local, avec les mêmes règles pour nos transactions (signatures vérifiées, réserve, frais, MPT avec autorisation, pas de transfert, verrouillage, mêmes codes de résultat).

```bash
npm run demo:sim      # même scénario, en moins d'une seconde
npm run web:sim       # interface + explorateur local (http://localhost:3000/web/explorer.html)
npm run sim:reset     # repartir d'un ledger vide
```

Chaque script accepte aussi `--sim` (`npm run vote -- 1 L2 --sim`), ou on peut mettre `XRPL_MODE=simulation` dans `.env`. Les wallets et l'état de la simulation sont dans `data/sim/`, séparés de ceux du Testnet.

Le dépouillement et l'interface sont exactement le même code dans les deux modes. La simulation sert à développer et à répéter. La démo officielle se fait sur le Testnet, parce que seules les transactions du vrai réseau sont vérifiables par le jury dans l'explorateur. Détails et notions XRPL dans [docs/guide-xrpl.md](docs/guide-xrpl.md).

## Lancer les étapes une par une

```bash
npm run check                # test de la connexion et du faucet
npm run wallets              # wallets de test + liste d'émargement fictive (data/emargement.csv)
npm run create               # l'urne crée le jeton VOTE
npm run authorize            # autorisation des inscrits
npm run distribute           # 1 VOTE par électeur autorisé
npm run vote -- 1 L2         # l'électeur n°1 vote pour la liste L2
npm run vote -- intrus L1    # essai avec le wallet non autorisé
npm run close                # clôture
npm run tally                # dépouillement
```

### Recompter en tant qu'observateur

Pas besoin de seed, seulement de l'adresse de l'urne et de l'ID du jeton :

```bash
npm run tally -- --urne rXXXXXXXX --mpt 00XXXXXXXX
```

## Interface web

```bash
npm run web
```

Puis ouvrir http://localhost:3000.

- **Voter** : coller la seed de test d'un électeur (depuis `.env`), vérifier qu'il a bien son jeton, choisir une liste et envoyer. La page affiche le hash de la transaction qui sert de preuve de vote.
- **Résultats** : recompte directement depuis le ledger, dans le navigateur, avec le statut de chaque bulletin et les liens vers l'explorateur.

La seed n'est utilisée que dans le navigateur pour signer, elle n'est envoyée à aucun serveur. Le petit serveur Node ne sert que des fichiers publics (jamais `.env` ni `data/emargement.csv`).

## Adresses de test

Le Testnet est réinitialisé de temps en temps, donc les comptes peuvent disparaître. Pour les recréer :

```bash
npm run wallets -- --force    # nouveaux wallets via le faucet, .env réécrit
npm run demo                  # nouveau scrutin complet
```

Les adresses du dernier run sont dans `data/scrutin-state.json` (adresses publiques seulement).

### Scrutin de référence (Testnet, 26 novembre 2026)

Lancé avec `npm run demo` sur le Testnet réinitialisé le 25 novembre. Tout est vérifiable dans l'explorateur :

| Compte | Adresse | |
|---|---|---|
| Urne (émetteur du jeton) | [`rEBtv2DGwZEBp6tcM3z7iRDBp2sLTCcwAz`](https://testnet.xrpl.org/accounts/rEBtv2DGwZEBp6tcM3z7iRDBp2sLTCcwAz) | |
| ID du jeton VOTE | `00003F569BA143A81FEF8AE6D5E81242E45F6D00B00BB354` | création : [3BDC3B9407...](https://testnet.xrpl.org/transactions/3BDC3B94078D661FA5C81204065A02FEE1B7013D6BFFD35012637CDEC1DDF2BE) |
| Électeur 1 | [`rJLdhDtrvMxgbiqmtCLjNq91cehraZpXCv`](https://testnet.xrpl.org/accounts/rJLdhDtrvMxgbiqmtCLjNq91cehraZpXCv) | vote L1 : [tx](https://testnet.xrpl.org/transactions/2162C94ECFA63CD7AE372101E6F1AEADC2F3E604FD6205E5E7F3C00A767428D5) |
| Électeur 2 | [`rhWsKLnmomR84T7qcNwxqsKYVNBJycK8gV`](https://testnet.xrpl.org/accounts/rhWsKLnmomR84T7qcNwxqsKYVNBJycK8gV) | vote L2 : [tx](https://testnet.xrpl.org/transactions/8AEC3F54413A3798B941874EB26FE9F3A3261222929DDAD6A2119331D9FBAFFA) |
| Électeur 3 | [`rfQwQsXyQf8aEVBcrUFJUq183UiQgBSLCv`](https://testnet.xrpl.org/accounts/rfQwQsXyQf8aEVBcrUFJUq183UiQgBSLCv) | vote L1 : [tx](https://testnet.xrpl.org/transactions/49E0B4EB0CC52C0EC07654F68440BC693841E16435F87C5C2422895231D7E6B1) |
| Électeur 4 | [`rp9sfokjdyttkXfuB6zVMyhhWNX5VLdbZc`](https://testnet.xrpl.org/accounts/rp9sfokjdyttkXfuB6zVMyhhWNX5VLdbZc) | vote L3 : [tx](https://testnet.xrpl.org/transactions/B5EDC12A7DA543EEF30BBBDB1E2885EE3F2B7BE6ED3CA31140021D8C8A63E254) |
| Électeur 5 | [`rG6Aua6z8cB32ZmZfB97vM8GsMRgA6aPPC`](https://testnet.xrpl.org/accounts/rG6Aua6z8cB32ZmZfB97vM8GsMRgA6aPPC) | vote L1 : [tx](https://testnet.xrpl.org/transactions/47F29C719CFA41F33A813E6A7F760E9B50B8A9DADB679F139C225652448E680A) |
| Électeur 6 | [`rBpbAmR5Wwv4M2A6tNZ9q9RB19ENDZ5fvr`](https://testnet.xrpl.org/accounts/rBpbAmR5Wwv4M2A6tNZ9q9RB19ENDZ5fvr) | n'a pas voté |
| Intrus (jamais autorisé) | [`rpfVDoYTWUnnzmSxNHUiDfnmGkT9hNZNcJ`](https://testnet.xrpl.org/accounts/rpfVDoYTWUnnzmSxNHUiDfnmGkT9hNZNcJ) | |

Tentatives de fraude refusées par le ledger :

| Tentative | Résultat | Transaction |
|---|---|---|
| L'électeur 1 revote | `tecPATH_PARTIAL` (plus de jeton) | [1BFC9E23FB...](https://testnet.xrpl.org/transactions/1BFC9E23FBD91197318630735742DA159E0D62AF640B4944616B83146DBEB16E) |
| L'électeur 6 donne son jeton à l'électeur 5 | `tecNO_AUTH` (jeton non transférable) | [B772026F32...](https://testnet.xrpl.org/transactions/B772026F32226003EF2F75EAAF733A55CC50C7C0E3BAFDF90E57597E55096F4D) |
| L'intrus vote | `tecNO_AUTH` (pas autorisé) | [9919900436...](https://testnet.xrpl.org/transactions/991990043665AEFC1F48102C963B06DAFECD96AAEDB98BD99EDF2BF08189C848) |

Clôture au ledger 16283 : [A8662BA2A9...](https://testnet.xrpl.org/transactions/A8662BA2A9D0C7024357ED046F6A6EFC7A7AC370D14AFACEA44CEBE0FEF3E8DB).

Dépouillement (`npm run tally`) : **L1 Liste Horizon 3 voix (60 %), L2 Liste Phénix 1 voix (20 %), L3 Liste Kraken 1 voix (20 %)**, 6 autorisés, 5 votants, 0 nul. Pour recompter soi-même :

```bash
npm run tally -- --urne rEBtv2DGwZEBp6tcM3z7iRDBp2sLTCcwAz --mpt 00003F569BA143A81FEF8AE6D5E81242E45F6D00B00BB354
```

Pendant ce run, le vote après clôture (étape 10) n'a pas pu partir : le serveur a répondu `notSynced`. Depuis, `connect()` attend que le serveur soit synchronisé et les requêtes sont réessayées (voir l'issue sur la clôture).

Les seeds correspondantes ne sont **pas** dans le dépôt. Pour demander de l'aide au mentor on partage les adresses, les hash de transaction et les codes de résultat, jamais une seed.

## Tests

```bash
npm test
```

Tests hors ligne (pas besoin du réseau) : forme des transactions vérifiée avec `xrpl.validate`, encodage des Memos, dépouillement sur un faux historique (double vote, adresse non autorisée, vote après clôture, bulletin nul) et règles du ledger simulé (signature, réserve, plafond, transfert interdit, verrouillage).

## Organisation du code

```
ledger/          scripts xrpl.js côté organisateur et électeurs
  common.js      connexion, wallets depuis .env, envoi des transactions
  tx.js          construction des transactions (fonctions pures)
  wallets.js     faucet + .env + liste d'émargement
  create-ballot.js, authorize.js, distribute.js, vote.js, close.js
tally/
  memo.js        format des Memos (partagé Node / navigateur)
  core.js        dépouillement à partir de account_tx (partagé Node / navigateur)
  cli.js         npm run tally
web/             interface (HTML/JS sans framework) + petit serveur statique
  explorer.html  mini explorateur pour le mode simulation
sim/             ledger XRPL simulé (moteur, API façon rippled, client compatible xrpl.Client)
scripts/demo.js  scénario complet
scripts/check-testnet.js   test d'accès au Testnet
.devcontainer/   config GitHub Codespaces
config/scrutin.json   titre du scrutin, listes, nombre d'inscrits
docs/            format des Memos, guide des notions XRPL
test/            tests node:test
```

### On-chain / off-chain

| On-chain (public) | Off-chain |
|---|---|
| Jeton VOTE et ses règles | Liste d'émargement nominative (`data/emargement.csv`, jamais publiée) |
| Autorisations des adresses | Seeds de test (`.env`, jamais commité) |
| Bulletins (paiements + Memo) | Cache du résultat (`data/resultat.json`) |
| Clôture | |

Aucune donnée personnelle ne part sur le ledger, seulement des adresses et des codes de liste.

## Limites

- **Secret du vote** : pseudonymat seulement. Le Memo est en clair et l'organisateur sait quelle adresse appartient à qui. Le hash de transaction permet aussi de prouver son vote à quelqu'un, donc l'achat de voix reste possible. Piste prévue : commit-reveal (voir [docs/format-memo.md](docs/format-memo.md)).
- **Inscription centralisée** : l'organisateur pourrait autoriser de fausses adresses. C'est visible (nombre d'adresses autorisées sur le ledger comparé au nombre d'inscrits) mais pas empêché.
- **Clés** : une seed perdue = un vote perdu. Pour le PoC les seeds sont générées par script.
- **Réserve XRP** : chaque électeur doit avoir un compte financé. Gratuit sur Testnet, pas à grande échelle.
- **Testnet** : aucune valeur légale, le réseau peut être remis à zéro.

## Comment on travaille

- une issue par tâche, assignée selon les rôles ci-dessus ;
- une branche par fonctionnalité (`feat/...`, `fix/...`), puis pull request vers `main` relue par un autre membre ;
- messages de commit courts en français.
