# SafeZone RPG : mise à jour de sécurité (S-SEC-01)

## Ce qui change

| Avant | Après |
|---|---|
| Le PIN « 1234 » était écrit dans `app.js` et ne protégeait que l'écran | Le PIN est vérifié **par le serveur**. Il est stocké dans les propriétés Apps Script et n'apparaît plus dans le code. Il est bloqué 15 min après 5 erreurs. |
| N'importe qui pouvait lire, modifier ou publier via l'API | Les actions QSE exigent un **jeton de session** (valable 6 h) |
| Un message ou un signalement piégé pouvait exécuter du code chez les agents ou chez le QSE | Tout texte venant du serveur est **échappé** avant d'être affiché |
| Le téléphone décidait de son XP (`addXP`) | L'XP est **calculée par le serveur** : quiz corrigé, signalement réel, quête vérifiée dans les journaux |
| Le profil d'un joueur pouvait être écrasé par un autre | Chaque téléphone possède un **secret** propre à son profil |
| Un texte commençant par `=` devenait une formule dans le Sheet | Les formules sont neutralisées à l'écriture |
| Les réponses de l'API étaient gardées en cache sur le téléphone | L'API n'est plus jamais mise en cache |
| Aucune trace | L'onglet **JOURNAL** trace connexions QSE, refus, changements de statut et publications |

Limites anti-abus : un signalement toutes les 30 s par joueur, au maximum 5 signalements qui rapportent de l'XP par jour, l'XP d'une question de quiz une fois par jour, et 40 requêtes par minute par joueur.

---

## Déploiement pas à pas (environ 20 min)

### 1. Sauvegarder
- Copie ton `Code.gs` actuel dans un fichier texte.
- Dans Google Sheets, fais **Fichier → Créer une copie** du classeur.

### 2. Remplacer le serveur
1. Ouvre le projet Apps Script.
2. Remplace tout le contenu de `Code.gs` par le fichier `apps-script/Code.gs` fourni. Tu peux garder `seed_questions_S08.gs`.
3. Va dans **⚙️ Paramètres du projet → Propriétés du script** et ajoute :
   - `QSE_PIN` : un code de **6 à 12 chiffres**, à communiquer uniquement à l'équipe QSE (pas 123456 ni une date de naissance)
   - `TELEGRAM_TOKEN` et `TELEGRAM_CHAT_ID`, si tu actives Telegram
   - `SPREADSHEET_ID`, seulement si le script n'est **pas** ouvert depuis le Sheet (menu Extensions → Apps Script)
4. Dans l'éditeur, choisis la fonction `initialiserSecurite` puis clique sur **▶ Exécuter** et accepte les autorisations. Cette fonction génère `PEPPER`, crée les onglets `REPONSES`, `QUETES_LOG` et `JOURNAL`, puis ajoute les colonnes manquantes.

> ⚠️ Ne modifie **jamais** `PEPPER` après coup : tous les joueurs perdraient l'accès à leur profil.

### 3. Vérifier l'onglet QUIZ
Le serveur lit les colonnes par leur nom :
- `questionId`, `categorie`, `question`
- `choixA` à `choixD` (sont aussi acceptés : `A`/`B`/`C`/`D` ou `reponseA`…)
- `bonneReponse` (sont aussi acceptés : `reponse` ou `bonne_reponse`)
- `explication`, `xp` (20 par défaut), `actif` (mettre `non` pour masquer une question)

Si tes colonnes portent d'autres noms, renomme les en-têtes.

### 4. Redéployer en gardant la même URL
1. Clique sur **Déployer → Gérer les déploiements**.
2. Sur le déploiement actuel, clique sur ✏️ puis sur **Version : Nouvelle version**.
3. Vérifie **Exécuter en tant que : Moi** et **Qui a accès : Tout le monde**, puis clique sur **Déployer**.
4. **Archive tous les autres déploiements** de la liste : une ancienne version reste appelable avec l'ancien code non protégé.

### 5. Mettre à jour GitHub
Remplace `app.js`, `index.html` et `sw.js` dans le dépôt `safezone-rpg`. Le cache passe en **v13**.
Ne mets pas le dossier `apps-script/` sur GitHub. Le fichier ne contient aucun secret, mais il n'a rien à faire dans un dépôt public.

> L'ordre compte : déploie le serveur (étape 4) **avant** GitHub. Sinon, l'application ne pourra plus se connecter le temps de la transition.

### 6. Fermer les accès annexes
- **Partage du Google Sheet** : limite-le aux personnes nommées et retire « Toute personne disposant du lien ».
- **Telegram** : si un token de bot a été écrit un jour dans un fichier (Code.gs, capture, mail), révoque-le avec @BotFather (`/revoke`) puis mets le nouveau dans les propriétés du script.
- **Mot de passe Google** du compte qui héberge le script : active la validation en deux étapes.

### 7. Tester (5 min)
- [ ] Ouvrir l'app, créer un avatar → une ligne apparaît dans JOUEURS avec 25 XP et un `secretHash`
- [ ] Répondre juste à un quiz → l'XP monte, puis rejouer la même question → plus d'XP ce jour-là
- [ ] Envoyer un signalement → l'XP monte, puis en renvoyer un tout de suite → message « attends 30 secondes »
- [ ] Triple-tap sur l'avatar, taper 1234 → refusé, puis le vrai code → la liste s'affiche
- [ ] Résoudre un signalement → +50 XP pour l'auteur, une ligne dans JOURNAL
- [ ] Publier un message dans le Canal → il s'affiche, et Telegram le reçoit s'il est configuré

---

## Ce que les agents vont remarquer
- **Rien**, dans la plupart des cas. Leur XP est désormais celle enregistrée sur le serveur : si quelqu'un avait gonflé ses points sur son téléphone, ils reviennent à la valeur du serveur.
- Un profil est lié au **téléphone** qui l'a synchronisé en premier. Si un agent change de téléphone ou efface les données de l'app, il repart avec un nouveau profil. Pour lui rendre son ancien profil, il faudrait une procédure manuelle, qu'on peut ajouter dans une prochaine session.

## Risques qui restent (connus et acceptés)
- L'application reste **sans compte nominatif** : n'importe qui ayant le lien peut créer un profil et envoyer des signalements. Les limites de débit et le JOURNAL réduisent l'abus. Une vraie identification (compte Google de l'entreprise, code agence) serait l'étape suivante.
- Après 5 mauvais codes, l'accès QSE est bloqué 15 min pour **tout le monde**, y compris le vrai QSE.
- **RGPD** : la localisation et le pseudo des signalements sont des données personnelles. Il faut informer les agents (finalité, durée de conservation) et purger les signalements anciens, par exemple après 2 ans.
- La CSP autorise encore les scripts « inline », parce que l'interface utilise des `onclick` dans le HTML. Pour l'enlever, il faudrait réécrire ces boutons.
