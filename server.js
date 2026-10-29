const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET || 'dev-secret-a-changer';
const db = new Database(path.join(__dirname, 'social.db'));
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  bio TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS likes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, post_id)
);
CREATE TABLE IF NOT EXISTS followers (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (follower_id, followed_id),
  CHECK (follower_id != followed_id)
);`);

for (const sql of ['ALTER TABLE users ADD COLUMN avatar TEXT', 'ALTER TABLE posts ADD COLUMN image TEXT', 'ALTER TABLE posts ADD COLUMN challenge TEXT']) {
  try { db.exec(sql); } catch {}
}

// ---- Images (envoyées en base64, redimensionnées côté client) ----
const UP = path.join(__dirname, 'uploads');
fs.mkdirSync(UP, { recursive: true });
function saveImage(d) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(d || '');
  if (!m) return null;
  const f = crypto.randomBytes(12).toString('hex') + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
  fs.writeFileSync(path.join(UP, f), Buffer.from(m[2], 'base64'));
  return f;
}

// ---- Défi du jour (change chaque jour, UTC) ----
const CHALLENGES = [
  { title: '📸 Mon coin préféré', hint: 'Montre-nous l’endroit où tu te sens le mieux.' },
  { title: '🥞 Ton petit-déj du jour', hint: 'Cadre-le comme un chef, ou montre le chaos.' },
  { title: '🔵 Tout en bleu', hint: 'Une photo où le bleu domine.' },
  { title: '🐾 Ton animal (ou celui d’un pote)', hint: 'Les chats comme les chiens sont acceptés.' },
  { title: '🪞 Ton style du jour', hint: 'Ton outfit, ta paire de baskets, ton accessoire fétiche.' },
  { title: '🎧 Ce que tu écoutes en ce moment', hint: 'Capture l’ambiance de ta playlist.' },
  { title: '🌅 Le ciel d’aujourd’hui', hint: 'Lève les yeux et partage ce que tu vois.' },
];
const today = () => new Date().toISOString().slice(0, 10);
const challenge = () => {
  const id = today(), c = CHALLENGES[Math.floor(Date.now() / 864e5) % CHALLENGES.length];
  const n = db.prepare('SELECT COUNT(DISTINCT user_id) n FROM posts WHERE challenge = ?').get(id).n;
  return { id, ...c, participants: n };
};

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use('/uploads', express.static(UP));
app.use(express.static(path.join(__dirname, 'public')));

const auth = (req, res, next) => {
  try { req.uid = jwt.verify((req.headers.authorization || '').slice(7), SECRET).id; next(); }
  catch { res.status(401).json({ error: 'Non authentifié' }); }
};
const token = (u) => jwt.sign({ id: u.id }, SECRET, { expiresIn: '7d' });
const clean = (s, max) => String(s || '').trim().slice(0, max);

// ---- Auth ----
app.post('/api/register', (req, res) => {
  const username = clean(req.body.username, 20), password = String(req.body.password || '');
  if (!/^\w{3,20}$/.test(username)) return res.status(400).json({ error: "Nom d'utilisateur : 3-20 caractères (lettres, chiffres, _)" });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum' });
  try {
    const r = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, bcrypt.hashSync(password, 10));
    res.json({ token: token({ id: r.lastInsertRowid }) });
  } catch { res.status(409).json({ error: "Ce nom d'utilisateur existe déjà" }); }
});

app.post('/api/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(clean(req.body.username, 20));
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.password))
    return res.status(401).json({ error: 'Identifiants incorrects' });
  res.json({ token: token(u) });
});

app.get('/api/me', auth, (req, res) => {
  const u = db.prepare('SELECT id, username, bio, avatar FROM users WHERE id = ?').get(req.uid);
  u ? res.json(u) : res.status(401).json({ error: 'Utilisateur introuvable' });
});

app.put('/api/me', auth, (req, res) => {
  db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(clean(req.body.bio, 160), req.uid);
  res.json({ ok: true });
});

app.put('/api/me/avatar', auth, (req, res) => {
  const f = saveImage(req.body.image);
  if (!f) return res.status(400).json({ error: 'Image invalide' });
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(f, req.uid);
  res.json({ avatar: f });
});

app.get('/api/challenge', (req, res) => res.json(challenge()));

// ---- Posts ----
const POST_SELECT = `
SELECT p.id, p.user_id, p.content, p.image, p.challenge, p.created_at, u.username, u.avatar,
  (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS likes,
  (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comments,
  EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = @me) AS liked
FROM posts p JOIN users u ON u.id = p.user_id`;

app.get('/api/feed', auth, (req, res) => {
  const sc = req.query.scope, p = { me: req.uid };
  let where = 'WHERE p.user_id = @me OR p.user_id IN (SELECT followed_id FROM followers WHERE follower_id = @me)';
  let order = 'p.created_at DESC, p.id DESC';
  if (sc === 'all') where = '';
  if (sc === 'challenge') { where = 'WHERE p.challenge = @ch'; order = 'likes DESC, p.id DESC'; p.ch = today(); }
  res.json(db.prepare(`${POST_SELECT} ${where} ORDER BY ${order} LIMIT 50`).all(p));
});

app.post('/api/posts', auth, (req, res) => {
  const content = clean(req.body.content, 280);
  const image = req.body.image ? saveImage(req.body.image) : null;
  if (req.body.image && !image) return res.status(400).json({ error: 'Image invalide' });
  if (!content && !image) return res.status(400).json({ error: 'Ajoutez un texte ou une photo' });
  db.prepare('INSERT INTO posts (user_id, content, image, challenge) VALUES (?, ?, ?, ?)')
    .run(req.uid, content, image, req.body.challenge ? today() : null);
  res.json({ ok: true });
});

app.delete('/api/posts/:id', auth, (req, res) => {
  const r = db.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?').run(req.params.id, req.uid);
  r.changes ? res.json({ ok: true }) : res.status(403).json({ error: 'Interdit' });
});

app.post('/api/posts/:id/like', auth, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(id)) return res.status(404).json({ error: 'Post introuvable' });
  const del = db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?').run(req.uid, id);
  if (!del.changes) db.prepare('INSERT INTO likes (user_id, post_id) VALUES (?, ?)').run(req.uid, id);
  const likes = db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id = ?').get(id).c;
  res.json({ liked: !del.changes, likes });
});

// ---- Comments ----
app.get('/api/posts/:id/comments', auth, (req, res) => {
  res.json(db.prepare(`SELECT c.id, c.content, c.created_at, u.username FROM comments c
    JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.id`).all(req.params.id));
});

app.post('/api/posts/:id/comments', auth, (req, res) => {
  const content = clean(req.body.content, 200);
  if (!content) return res.status(400).json({ error: 'Commentaire vide' });
  if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Post introuvable' });
  db.prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)').run(req.params.id, req.uid, content);
  res.json({ ok: true });
});

// ---- Profils & follow ----
app.get('/api/users/:username', auth, (req, res) => {
  const u = db.prepare('SELECT id, username, bio, avatar, created_at FROM users WHERE username = ?').get(req.params.username);
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const count = (col, other) => db.prepare(`SELECT COUNT(*) c FROM followers WHERE ${col} = ?`).get(u.id).c;
  res.json({
    user: u,
    followers: count('followed_id'),
    following: count('follower_id'),
    isFollowing: !!db.prepare('SELECT 1 FROM followers WHERE follower_id = ? AND followed_id = ?').get(req.uid, u.id),
    posts: db.prepare(`${POST_SELECT} WHERE p.user_id = @uid ORDER BY p.created_at DESC, p.id DESC`).all({ me: req.uid, uid: u.id }),
  });
});

app.post('/api/users/:username/follow', auth, (req, res) => {
  const u = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (u.id === req.uid) return res.status(400).json({ error: 'Impossible de se suivre soi-même' });
  const del = db.prepare('DELETE FROM followers WHERE follower_id = ? AND followed_id = ?').run(req.uid, u.id);
  if (!del.changes) db.prepare('INSERT INTO followers (follower_id, followed_id) VALUES (?, ?)').run(req.uid, u.id);
  res.json({ isFollowing: !del.changes });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Mini Social sur http://localhost:${PORT}`));
