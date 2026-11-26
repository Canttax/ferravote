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
| Nœud | `wss://s.altnet.rippletest.net:51233` |
| Explorateur | https://testnet.xrpl.org |
| Faucet | utilisé automatiquement par `client.fundWallet()` |

Comptes de test uniquement. Aucune seed Mainnet, et aucune seed dans Git.

## Installation

Prérequis : Node.js 20 ou plus (LTS), npm, Git.

```bash
git clone <url du dépôt>
cd ferravote
npm install
cp .env.example .env     # optionnel, npm run wallets le remplit tout seul
```

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

Le Testnet peut être réinitialisé, donc les adresses changent à chaque `npm run wallets`. On met ici celles du scrutin de référence utilisé pour la soutenance :

| Compte | Adresse |
|---|---|
| Urne (émetteur du jeton) | _à remplir après le run de référence_ |
| ID du jeton VOTE | _à remplir_ |
| Électeurs 1 à 6 | _voir `data/scrutin-state.json`_ |

Les seeds correspondantes ne sont **pas** dans le dépôt.

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
