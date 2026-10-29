# Mini Social — Express.js + SQLite

## Lancer
```bash
npm install
npm start        # http://localhost:3000
```
Node 18+ requis. La base `social.db` est créée automatiquement.

## Fonctionnalités
- Inscription / connexion (mots de passe hachés avec bcrypt, sessions JWT)
- Profils (bio modifiable, compteurs d'abonnés / abonnements)
- Posts (280 car.) et commentaires
- Likes (toggle) et système de follow (toggle)
- Posts photo avec légende (photos redimensionnées côté navigateur, stockées dans `uploads/`)
- Photo de profil
- Défi du jour (change chaque jour) avec classement par likes
- Page d'accueil qui présente l'app et le défi
- Fil « Abonnements », « Tous » ou « Classement du défi »

## Base de données (SQLite)
`users` (avec `avatar`), `posts` (avec `image`, `challenge`), `comments`, `likes`, `followers` (voir `server.js`). Les anciennes bases sont migrées automatiquement.

## Structure
- `server.js` : API REST + schéma
- `public/` : frontend HTML / CSS / JS

Variable d'environnement conseillée en production : `JWT_SECRET`.
