const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
let token = localStorage.getItem('token'), me = null, scope = 'following', chal = null;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = (d) => new Date(d.replace(' ', 'T') + 'Z').toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const av = (name, img, cls = '') => img
  ? `<img class="av ${cls}" src="/uploads/${esc(img)}" alt="">`
  : `<span class="av ${cls}" style="background:hsl(${([...name].reduce((a, c) => a + c.charCodeAt(0), 0) * 37) % 360} 65% 50%)">${esc(name[0].toUpperCase())}</span>`;

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401 && token) logout(); throw new Error(d.error || 'Erreur'); }
  return d;
}
function logout() { localStorage.removeItem('token'); token = me = null; location.hash = '#/'; render(); }

// Redimensionne une photo côté navigateur (JPEG) avant l'envoi
function resize(file, max) {
  return new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      ok(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => ko(new Error('Image invalide'));
    img.src = URL.createObjectURL(file);
  });
}

function nav() {
  $('#nav').innerHTML = me
    ? `<a href="#/" >Accueil</a><a class="who" href="#/u/${esc(me.username)}">${av(me.username, me.avatar, 'sm')}@${esc(me.username)}</a><button id="out">Déconnexion</button>`
    : '';
  if (me) $('#out').onclick = logout;
}

const challengeBox = (c, btn = '') => `<div class="challenge"><small>🔥 DÉFI DU JOUR</small><h3>${esc(c.title)}</h3>
  <p>${esc(c.hint)}</p><small>${c.participants} participant(s) aujourd’hui</small> ${btn}</div>`;

async function authView(mode = 'login') {
  const login = mode === 'login';
  try { chal = await api('/challenge'); } catch {}
  app.innerHTML = `<section class="hero"><h1>🌐 Mini Social</h1>
    <p class="lead">Le réseau pour partager <b>tes vraies photos</b>, sans filtre ni prise de tête.</p>
    <ul class="feat"><li>📸 Poste une photo avec une petite légende</li><li>🙋 Crée ton profil avec ta photo</li>
    <li>💜 Like, commente et suis tes potes</li><li>🏆 Relève le défi du jour et grimpe au classement</li></ul>
    ${chal ? challengeBox(chal) : ''}</section>
    <div class="card auth"><h2>${login ? 'Connexion' : 'Inscription'}</h2>
    <input id="u" placeholder="Nom d'utilisateur" autocomplete="username">
    <input id="p" type="password" placeholder="Mot de passe" autocomplete="${login ? 'current-password' : 'new-password'}">
    <div class="err" id="e"></div>
    <button class="primary" id="go">${login ? 'Se connecter' : 'Rejoindre le défi 🚀'}</button>
    <p class="mute"><a href="#" id="sw">${login ? "Pas de compte ? S'inscrire" : 'Déjà inscrit ? Se connecter'}</a></p></div>`;
  $('#sw').onclick = (e) => { e.preventDefault(); authView(login ? 'register' : 'login'); };
  $('#go').onclick = async () => {
    try {
      const d = await api(login ? '/login' : '/register', 'POST', { username: $('#u').value, password: $('#p').value });
      token = d.token; localStorage.setItem('token', token); render();
    } catch (e) { $('#e').textContent = e.message; }
  };
}

const postHTML = (p) => `<article class="card" data-id="${p.id}">
  <div class="meta"><a class="who" href="#/u/${esc(p.username)}">${av(p.username, p.avatar)}@${esc(p.username)}${p.challenge ? '<span class="badge">🔥 Défi</span>' : ''}</a><span>${date(p.created_at)}</span></div>
  ${p.image ? `<img class="post-img" loading="lazy" src="/uploads/${esc(p.image)}" alt="">` : ''}
  ${p.content ? `<p>${esc(p.content)}</p>` : ''}
  <div class="actions"><button data-a="like" class="${p.liked ? 'on' : ''}">♥ ${p.likes}</button>
  <button data-a="cm">💬 ${p.comments}</button>${p.user_id === me.id ? '<button data-a="del">🗑</button>' : ''}</div>
  <div class="cm" hidden></div></article>`;

async function loadComments(art) {
  const box = $('.cm', art), list = await api(`/posts/${art.dataset.id}/comments`);
  box.innerHTML = list.map((c) => `<div class="c"><a href="#/u/${esc(c.username)}">@${esc(c.username)}</a> ${esc(c.content)}</div>`).join('')
    + `<div class="row"><input placeholder="Votre commentaire…" maxlength="200"><button data-a="send">Envoyer</button></div>`;
}

app.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const art = b.closest('article'), a = b.dataset.a;
  try {
    if (a === 'like') { const d = await api(`/posts/${art.dataset.id}/like`, 'POST'); b.textContent = '♥ ' + d.likes; b.classList.toggle('on', d.liked); }
    if (a === 'del' && confirm('Supprimer ce post ?')) { await api(`/posts/${art.dataset.id}`, 'DELETE'); art.remove(); }
    if (a === 'cm') { const box = $('.cm', art); box.hidden = !box.hidden; if (!box.hidden) await loadComments(art); }
    if (a === 'send') {
      const inp = $('.cm input', art); if (!inp.value.trim()) return;
      await api(`/posts/${art.dataset.id}/comments`, 'POST', { content: inp.value });
      await loadComments(art);
      const n = $('[data-a="cm"]', art); n.textContent = '💬 ' + (parseInt(n.textContent.slice(2)) + 1);
    }
  } catch (err) { alert(err.message); }
});

async function feedView() {
  let img = null;
  chal = await api('/challenge');
  app.innerHTML = `${challengeBox(chal, '<div class="row"><button id="join">Participer 📸</button></div>')}
    <div class="card"><textarea id="t" rows="2" maxlength="280" placeholder="Une petite légende ?"></textarea><div id="prev"></div>
    <div class="row"><label class="btn">📷 Photo<input id="file" type="file" accept="image/*" hidden></label>
    <label class="chk"><input type="checkbox" id="ch"> 🔥 Défi du jour</label>
    <button class="primary" id="pub" style="margin-left:auto">Publier</button></div></div>
    <div class="tabs"><button data-s="following">Abonnements</button><button data-s="all">Tous</button><button data-s="challenge">🏆 Classement du défi</button></div>
    <div id="list"></div>`;
  $('#join').onclick = () => { $('#ch').checked = true; $('#file').click(); };
  $('#file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      img = await resize(f, 900);
      $('#prev').innerHTML = `<img src="${img}" alt=""><button id="rm">✕</button>`;
      $('#rm').onclick = () => { img = null; $('#prev').innerHTML = ''; $('#file').value = ''; };
    } catch (x) { alert(x.message); }
  };
  $('#pub').onclick = async () => {
    try {
      await api('/posts', 'POST', { content: $('#t').value, image: img, challenge: $('#ch').checked });
      feedView();
    } catch (e) { alert(e.message); }
  };
  document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => { scope = b.dataset.s; load(); }));
  async function load() {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.s === scope));
    const posts = await api('/feed?scope=' + scope);
    $('#list').innerHTML = posts.map(postHTML).join('') ||
      `<p class="mute">${scope === 'challenge' ? 'Personne n’a encore relevé le défi : sois le premier ! 🔥' : 'Rien ici pour l’instant. Suis des gens ou consulte « Tous ».'}</p>`;
  }
  load();
}

async function profileView(name) {
  try {
    const d = await api('/users/' + encodeURIComponent(name)), mine = d.user.id === me.id;
    app.innerHTML = `<div class="card"><div class="profile-head">${av(d.user.username, d.user.avatar, 'lg')}
      <div><h2 style="margin:0">@${esc(d.user.username)}</h2><p class="mute" style="margin:4px 0">${esc(d.user.bio) || 'Pas de bio.'}</p></div></div>
      <div class="stats"><span><b>${d.followers}</b> abonnés</span><span><b>${d.following}</b> abonnements</span><span><b>${d.posts.length}</b> posts</span></div>
      ${mine ? '<div class="row"><button id="edit">Modifier la bio</button><label class="btn">📷 Changer ma photo<input id="avf" type="file" accept="image/*" hidden></label></div>'
             : `<button id="fol" class="${d.isFollowing ? '' : 'primary'}">${d.isFollowing ? 'Ne plus suivre' : 'Suivre'}</button>`}</div>
      ${d.posts.map(postHTML).join('')}`;
    if (mine) {
      $('#edit').onclick = async () => {
        const bio = prompt('Votre bio (160 car. max)', d.user.bio); if (bio === null) return;
        await api('/me', 'PUT', { bio }); profileView(name);
      };
      $('#avf').onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try { me.avatar = (await api('/me/avatar', 'PUT', { image: await resize(f, 300) })).avatar; nav(); profileView(name); }
        catch (x) { alert(x.message); }
      };
    } else $('#fol').onclick = async () => { await api(`/users/${encodeURIComponent(name)}/follow`, 'POST'); profileView(name); };
  } catch (e) { app.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

async function render() {
  if (!token) { me = null; nav(); return authView(); }
  if (!me) { try { me = await api('/me'); } catch { return authView(); } }
  nav();
  const m = location.hash.match(/^#\/u\/(.+)$/);
  m ? profileView(decodeURIComponent(m[1])) : feedView();
}
window.addEventListener('hashchange', render);
render();
