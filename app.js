/* ═══════════════════════════════════════════════════════
   SafeZone RPG — app.js  (S-05 : Sauvegarde profil + XP)
═══════════════════════════════════════════════════════ */

/* ── API S-03 ───────────────────────────────────────── */
const API_URL = "https://script.google.com/macros/s/AKfycbx71CS0GXaFT2pLVm4aXS_OxC8mrcWvMI7be9r-KycELxy2qzYyOWMWgWyVANUywhsj/exec";

/* ── Sécurité : échappement HTML de toute donnée venant du serveur ── */
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"'`]/g, function(c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;', '`':'&#96;' }[c];
  });
}
function randomHex(nbOctets) {
  const a = new Uint8Array(nbOctets);
  crypto.getRandomValues(a);
  return Array.from(a, function(b){ return b.toString(16).padStart(2, '0'); }).join('');
}

/* Messages d'erreur serveur → texte compréhensible */
const API_ERREURS = {
  non_autorise:          '🔒 Accès refusé',
  trop_de_requetes:      '⏳ Trop de requêtes, patiente une minute',
  trop_rapide:           '⏳ Attends 30 secondes entre deux signalements',
  quete_non_terminee:    '⚔️ Quête pas encore validée par le serveur',
  quete_deja_reclamee:   '✅ Récompense déjà réclamée',
  pin_incorrect:         '❌ Code incorrect',
  trop_de_tentatives:    '⛔ Trop d\'essais : accès bloqué 15 minutes',
  description_trop_courte:'✏️ Description trop courte',
  pseudo_invalide:       '✏️ Pseudo invalide (2 à 24 caractères)',
  profil_inexistant:     '👤 Crée d\'abord ton avatar',
};
function messageErreur(code) { return API_ERREURS[code] || '⚠️ Erreur réseau'; }

/* GET : uniquement pour les données publiques (quiz, canal) */
async function apiGet(params) {
  try {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(API_URL + '?' + qs);
    const j = await res.json();
    return j.ok ? j.data : null;
  } catch(e) { return null; }
}
/* POST générique : renvoie { ok, data, error } */
async function apiCall(body) {
  try {
    const res = await fetch(API_URL, { method:'POST', body:JSON.stringify(body) });
    const j = await res.json();
    return j && j.ok ? { ok:true, data:j.data } : { ok:false, error:(j && j.error) || 'erreur' };
  } catch(e) { return { ok:false, error:'reseau' }; }
}
async function apiPost(body) {
  const r = await apiCall(body);
  return r.ok ? r.data : null;
}
/* Appel joueur : ajoute automatiquement l'identifiant et le secret du téléphone */
function apiJoueur(action, extra) {
  return apiCall(Object.assign({ action: action, userId: PROFILE.userId, secret: PROFILE.secret }, extra || {}));
}
/* Appel QSE : ajoute le jeton de session obtenu après saisie du PIN */
async function apiQSE(action, extra) {
  const r = await apiCall(Object.assign({ action: action, token: QSE_TOKEN }, extra || {}));
  if (!r.ok && r.error === 'non_autorise') qseDeconnecter(true);
  return r;
}
/* Applique le total d'XP renvoyé par le serveur (seule source de vérité) */
function appliquerXPServeur(data) {
  if (!data || typeof data.xp !== 'number') return;
  const niveauAvant = PROFILE.niveau;
  PROFILE.xp     = data.xp;
  PROFILE.niveau = calcNiveau(data.xp);
  saveProfile(PROFILE);
  if (PROFILE.niveau > niveauAvant && typeof showLevelUp === 'function') showLevelUp(PROFILE.niveau);
}

/* ═══════════════════════════════════════════════════════
   S-05 — SYNC GOOGLE SHEETS
   Stratégie : localStorage = source de vérité locale
               Google Sheets = sauvegarde cloud + classement
   Sync : au login, à chaque gain XP, à chaque modif profil
═══════════════════════════════════════════════════════ */

// Indique si une synchro est en cours (évite les doublons)
let syncInProgress = false;
let syncPending    = false;

// Synchro complète du profil vers Sheets
async function syncToSheets(silent = true) {
  if (syncInProgress) { syncPending = true; return; }
  syncInProgress = true;
  setSyncIndicator('syncing');
  try {
    // L'XP et le niveau ne sont plus envoyés : le serveur les calcule lui-même
    const rep = await apiJoueur('upsertJoueur', {
      joueur: {
        pseudo:  PROFILE.pseudo,
        avatar:  PROFILE.avatarId || 'recrue',
        badges:  PROFILE.badges,
        quetes:  PROFILE.quetes,
        color:   PROFILE.color,
        classe:  PROFILE.classe,
      }
    });
    const data = rep.ok ? rep.data : null;
    if (!rep.ok && rep.error !== 'reseau' && !silent) showToast(messageErreur(rep.error));
    if (data) {
      appliquerXPServeur(data);
      if (typeof refreshUI === 'function') refreshUI();
      PROFILE.lastSync = new Date().toISOString();
      saveProfile(PROFILE);
      setSyncIndicator('ok');
      if (!silent) showToast('☁️ Profil synchronisé !');
    } else {
      setSyncIndicator('error');
    }
  } catch(e) {
    setSyncIndicator('error');
  }
  syncInProgress = false;
  if (syncPending) { syncPending = false; syncToSheets(silent); }
}

// Chargement du profil depuis Sheets au démarrage
async function loadFromSheets() {
  if (!PROFILE.userId) return;
  setSyncIndicator('syncing');
  const rep  = await apiJoueur('getJoueur');
  const data = rep.ok ? rep.data : null;
  if (rep.ok && !data && PROFILE.pseudo) {
    // Profil pas encore connu du serveur : on le crée
    setSyncIndicator('ok');
    syncToSheets();
    return;
  }
  if (data) {
    // L'XP du serveur fait foi (elle ne peut plus être modifiée depuis le téléphone)
    const xpFinal     = Number(data.xp) || 0;
    const niveauFinal = calcNiveau(xpFinal);
    const avatarOk    = avatarParId(data.avatar);
    PROFILE = {
      ...PROFILE,
      pseudo:  data.pseudo  || PROFILE.pseudo,
      avatar:  avatarOk ? avatarOk.img : PROFILE.avatar,
      avatarId: avatarOk ? avatarOk.id : PROFILE.avatarId,
      color:   couleurValide(data.color) ? data.color : PROFILE.color,
      xp:      xpFinal,
      niveau:  niveauFinal,
      badges:  data.badges  || PROFILE.badges,
      quetes:  data.quetes  || PROFILE.quetes,
      lastSync: new Date().toISOString(),
    };
    saveProfile(PROFILE);
    refreshUI();
    setSyncIndicator('ok');
  } else {
    setSyncIndicator('error');
    // Mode hors-ligne : on continue avec localStorage
  }
}

// Gain d'XP avec sync automatique
async function gainXP(montant, raison) {
  PROFILE.xp += montant;
  const niveauAvant  = PROFILE.niveau;
  PROFILE.niveau     = calcNiveau(PROFILE.xp);
  saveProfile(PROFILE);
  refreshUI();
  // (S-SEC) L'XP n'est plus envoyée au serveur : il la calcule lui-même
  // Level up ?
  if (PROFILE.niveau > niveauAvant) {
    showLevelUp(PROFILE.niveau);
    syncToSheets();
  }
  showXpPopup(montant, raison || 'XP gagné !');
}

// Indicateur de sync dans la topbar
function setSyncIndicator(state) {
  const el = document.getElementById('sync-indicator');
  if (!el) return;
  const icons = { syncing:'⏳', ok:'☁️', error:'⚠️', offline:'📴' };
  el.textContent = icons[state] || '';
  el.title = { syncing:'Synchronisation…', ok:'Synchronisé', error:'Hors ligne', offline:'Sans connexion' }[state] || '';
  el.className = 'sync-dot sync-' + state;
}

// Level up popup
function showLevelUp(niveau) {
  const popup = document.getElementById('levelup-popup');
  if (!popup) return;
  popup.querySelector('.levelup-num').textContent = niveau;
  popup.classList.remove('hidden');
  setTimeout(() => popup.classList.add('hidden'), 3500);
}


/* ═══════════════════════════════════════════════════════
   S-06 — SYSTÈME DE BADGES
   Conditions vérifiées à chaque refreshUI + events clés
═══════════════════════════════════════════════════════ */

const BADGES_DEFS = [
  // ── Identité ──────────────────────────────────────────
  { id: 'premier_pas',   icon: '👣', label: 'Premier Pas',    color: 'var(--accent-primary)',
    desc: 'Créer son profil SafeZone',
    condition: function(p, stats) { return !!p.pseudo; } },
  { id: 'stylé',        icon: '🎨', label: 'Stylé',           color: 'var(--accent-purple)',
    desc: 'Changer la couleur de son bouclier',
    condition: function(p, stats) { return p.color && p.color !== '#00d4ff'; } },

  // ── XP & Niveaux ──────────────────────────────────────
  { id: 'apprenti',     icon: '🌱', label: 'Apprenti',        color: '#4ade80',
    desc: 'Atteindre le niveau 2 (100 XP)',
    condition: function(p, stats) { return p.niveau >= 2; } },
  { id: 'confirmé',     icon: '⚡', label: 'Confirmé',        color: 'var(--accent-secondary)',
    desc: 'Atteindre le niveau 4 (300 XP)',
    condition: function(p, stats) { return p.niveau >= 4; } },
  { id: 'expert_badge', icon: '🎯', label: 'Expert',          color: 'var(--accent-primary)',
    desc: 'Atteindre le niveau 6 (1 000 XP)',
    condition: function(p, stats) { return p.niveau >= 6; } },
  { id: 'legende',      icon: '🏆', label: 'Légende',         color: 'var(--accent-secondary)',
    desc: 'Atteindre le niveau 10 (6 000 XP)',
    condition: function(p, stats) { return p.niveau >= 10; } },

  // ── Quiz ──────────────────────────────────────────────
  { id: 'curieux',      icon: '🧠', label: 'Curieux',         color: 'var(--accent-purple)',
    desc: 'Répondre à son premier quiz',
    condition: function(p, stats) { return (stats.quizTotal || 0) >= 1; } },
  { id: 'precise',      icon: '🎯', label: 'Précis',          color: 'var(--accent-success)',
    desc: 'Réussir 5 quiz',
    condition: function(p, stats) { return (stats.quizCorrects || 0) >= 5; } },
  { id: 'crack',        icon: '💡', label: 'Crack Sécurité',  color: 'var(--accent-secondary)',
    desc: 'Réussir 20 quiz',
    condition: function(p, stats) { return (stats.quizCorrects || 0) >= 20; } },

  // ── Signalements ──────────────────────────────────────
  { id: 'vigilant',     icon: '👁️', label: 'Vigilant',        color: '#60a5fa',
    desc: 'Créer son premier signalement',
    condition: function(p, stats) { return (stats.signalementsTotal || 0) >= 1; } },
  { id: 'gardien_badge',icon: '🛡️', label: 'Gardien',         color: 'var(--accent-primary)',
    desc: 'Créer 5 signalements validés',
    condition: function(p, stats) { return (stats.signalementsValides || 0) >= 5; } },
  { id: 'sentinelle_badge',icon:'🔍',label:'Sentinelle',       color: '#34d399',
    desc: '10 signalements validés',
    condition: function(p, stats) { return (stats.signalementsValides || 0) >= 10; } },

  // ── Assiduité ─────────────────────────────────────────
  { id: 'assidu',       icon: '📅', label: 'Assidu',          color: 'var(--accent-secondary)',
    desc: 'Se connecter 7 jours consécutifs',
    condition: function(p, stats) { return (stats.streakJours || 0) >= 7; } },
  { id: 'champion_badge',icon:'🔥', label: 'En Feu',          color: 'var(--accent-danger)',
    desc: 'Se connecter 30 jours consécutifs',
    condition: function(p, stats) { return (stats.streakJours || 0) >= 30; } },

  // ── Classement ────────────────────────────────────────
  { id: 'podium',       icon: '🥉', label: 'Podium',          color: '#cd7f32',
    desc: "Terminer dans le top 3 de l'agence",
    condition: function(p, stats) { return (stats.meilleurePosition || 999) <= 3; } },
  { id: 'champion_rang',icon:'🥇',  label: "N°1 de l'agence",color: 'var(--accent-secondary)',
    desc: 'Être 1er du classement',
    condition: function(p, stats) { return (stats.meilleurePosition || 999) === 1; } },
];

// Stats du joueur (alimentées progressivement par les autres sessions)
function getStats() {
  try {
    return JSON.parse(localStorage.getItem('safezone_stats') || '{}');
  } catch(e) { return {}; }
}
function saveStats(stats) {
  try { localStorage.setItem('safezone_stats', JSON.stringify(stats)); } catch(e) {}
}

// Vérification des badges + déclenchement nouveauté
function checkBadges() {
  const stats    = getStats();
  const anciens  = PROFILE.badges || [];
  const nouveaux = [];

  BADGES_DEFS.forEach(function(b) {
    if (b.condition(PROFILE, stats) && !anciens.includes(b.id)) {
      nouveaux.push(b.id);
    }
  });

  if (nouveaux.length > 0) {
    PROFILE.badges = anciens.concat(nouveaux);
    saveProfile(PROFILE);
    // Affiche le premier badge gagné
    showBadgePopup(BADGES_DEFS.find(function(b){ return b.id === nouveaux[0]; }));
    // Synchro Sheets
    syncToSheets();
  }
  return PROFILE.badges;
}

// Popup badge gagné
function showBadgePopup(badge) {
  if (!badge) return;
  const popup = document.getElementById('badge-popup');
  if (!popup) return;
  popup.querySelector('.badge-popup-icon').textContent  = badge.icon;
  popup.querySelector('.badge-popup-label').textContent = badge.label;
  popup.querySelector('.badge-popup-desc').textContent  = badge.desc;
  popup.querySelector('.badge-popup-icon').style.filter = 'drop-shadow(0 0 12px ' + badge.color + ')';
  popup.classList.remove('hidden');
  setTimeout(function(){ popup.classList.add('hidden'); }, 3500);
}

/* ── PROFIL LOCAL ───────────────────────────────────── */
const DEFAULT_PROFILE = {
  userId:   'local_' + randomHex(8),
  secret:   randomHex(32),
  pseudo:   '', avatar: 'avatars/recrue.png', avatarId: 'recrue',
  color:    '#00d4ff', classe: 'recrue',
  xp: 0, niveau: 1, badges: [], quetes: [],
  dateInscription: new Date().toISOString(),
  lastSync: null,
};
function loadProfile() {
  try { const r=localStorage.getItem('safezone_profile'); return r?{...DEFAULT_PROFILE,...JSON.parse(r)}:{...DEFAULT_PROFILE}; }
  catch(e) { return {...DEFAULT_PROFILE}; }
}
function saveProfile(p) { try{localStorage.setItem('safezone_profile',JSON.stringify(p));}catch(e){} }
let PROFILE = loadProfile();
if (!/^[a-f0-9]{64}$/.test(PROFILE.secret || '')) PROFILE.secret = randomHex(32);
saveProfile(PROFILE);

/* ── DONNÉES AVATAR ─────────────────────────────────── */
const AVATARS = [
  {id:'recrue',     img:'avatars/recrue.png',     label:'Recrue',     unlock:0},
  {id:'sentinelle', img:'avatars/sentinelle.png', label:'Sentinelle', unlock:100},
  {id:'gardien',    img:'avatars/gardien.png',    label:'Gardien',    unlock:300},
  {id:'pompier',    img:'avatars/pompier.png',    label:'Pompier',    unlock:500},
  {id:'expert',     img:'avatars/expert.png',     label:'Expert QSE', unlock:1000},
  {id:'champion',   img:'avatars/champion.png',   label:'Champion',   unlock:6000},
];
const COLORS = [
  {value:'#00d4ff',label:'Cyan',      style:'background:#00d4ff'},
  {value:'#f7c520',label:'Or',        style:'background:#f7c520'},
  {value:'#2ed573',label:'Vert',      style:'background:#2ed573'},
  {value:'#ff4757',label:'Rouge',     style:'background:#ff4757'},
  {value:'#a855f7',label:'Violet',    style:'background:#a855f7'},
  {value:'#ff6b35',label:'Orange',    style:'background:#ff6b35'},
  {value:'#e8f4fd',label:'Blanc',     style:'background:#e8f4fd'},
  {value:'#40e0d0',label:'Turquoise', style:'background:linear-gradient(135deg,#40e0d0,#00c9ff)'},
];
const CLASSES = [
  {id:'recrue',    icon:'⚡', label:'Recrue',           desc:'Tu commences ton aventure sécurité',       req:'Disponible dès le départ',  unlock:0},
  {id:'sentinelle',icon:'👁️', label:'Sentinelle',       desc:'Tu surveilles et signales les risques',    req:'Niveau 2 requis (100 XP)',   unlock:100},
  {id:'gardien',   icon:'🛡️', label:'Gardien',          desc:'Tu maîtrises les procédures de sécurité', req:'Niveau 4 requis (300 XP)',   unlock:300},
  {id:'expert',    icon:'🎯', label:'Expert QSE',        desc:'Tu es une référence pour ton équipe',     req:'Niveau 6 requis (1000 XP)',  unlock:1000},
  {id:'champion',  icon:'🏆', label:'Champion SafeZone', desc:'Le titre ultime. Légende de l\'agence.',  req:'Niveau 10 requis (6000 XP)', unlock:6000},
];

function avatarParId(id) { return AVATARS.find(function(a){ return a.id === id; }) || null; }
function couleurValide(c) { return COLORS.some(function(x){ return x.value === c; }); }
function avatarSrc(p) {
  const a = avatarParId(p.avatarId) || AVATARS.find(function(x){ return x.img === p.avatar; }) || AVATARS[0];
  return a.img;
}

/* ── AVATAR CREATOR STATE ───────────────────────────── */
let tempAvatar = {};

function openAvatarCreator() {
  tempAvatar = {
    pseudo:   PROFILE.pseudo,
    avatarId: PROFILE.avatarId || 'recrue',
    avatar:   PROFILE.avatar   || 'avatars/recrue.png',
    color:    PROFILE.color,
    classe:   PROFILE.classe,
  };
  document.getElementById('avatar-pseudo-input').value = PROFILE.pseudo;
  renderCharGrid();
  renderColorGrid();
  renderClassGrid();
  updatePreview();
  document.getElementById('avatar-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeAvatarCreator() {
  document.getElementById('avatar-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

function renderCharGrid() {
  const grid = document.getElementById('char-grid');
  grid.innerHTML = AVATARS.map(function(a) {
    const locked = PROFILE.xp < a.unlock;
    const selected = tempAvatar.avatarId === a.id;
    let h = '<button class="avatar-char-btn ' + (selected?'selected ':'') + (locked?'locked':'') + '"';
    h += ' onclick="' + (locked ? "showToast('Débloquer à "+a.unlock+" XP')" : "selectChar('"+a.id+"','"+a.img+"',this)") + '">';
    if (selected) h += '<div class="avatar-char-check">✓</div>';
    if (locked)   h += '<div class="avatar-char-lock">🔒</div>';
    h += '<img class="avatar-char-img" src="'+a.img+'" alt="'+a.label+'" loading="lazy" />';
    h += '<div class="avatar-char-label">'+a.label+'</div>';
    if (locked) h += '<div class="avatar-char-xp">'+a.unlock+' XP</div>';
    h += '</button>';
    return h;
  }).join('');
}

function renderColorGrid() {
  const grid = document.getElementById('color-grid');
  grid.innerHTML = COLORS.map(function(c) {
    return '<button class="avatar-color-btn '+(tempAvatar.color===c.value?'selected':'')+'"'
      +' style="'+c.style+'" onclick="selectColor(\''+c.value+'\',this)" title="'+c.label+'"></button>';
  }).join('');
}

function renderClassGrid() {
  const grid = document.getElementById('class-grid');
  grid.innerHTML = CLASSES.map(function(c) {
    const locked = PROFILE.xp < c.unlock;
    const selected = tempAvatar.classe === c.id;
    return '<button class="avatar-class-btn '+(selected?'selected ':'')+(locked?'locked':'')+'"'
      +' onclick="'+(locked?"showToast('Débloquer à "+c.unlock+" XP')":'selectClass(\''+c.id+'\',this)')+'">'
      +'<div class="avatar-class-icon">'+c.icon+'</div>'
      +'<div class="avatar-class-info">'
        +'<div class="avatar-class-name">'+c.label+'</div>'
        +'<div class="avatar-class-desc">'+c.desc+'</div>'
        +'<div class="avatar-class-req">'+(locked?'🔒 ':'')+c.req+'</div>'
      +'</div>'
      +'<div class="avatar-class-check">'+(selected?'✅':locked?'🔒':'○')+'</div>'
      +'</button>';
  }).join('');
}

function updatePreview() {
  const frame = document.getElementById('avatar-preview-frame');
  const imgEl = document.getElementById('avatar-preview-img');
  if (imgEl && tempAvatar.avatar) imgEl.src = tempAvatar.avatar;
  const col = tempAvatar.color || '#00d4ff';
  frame.style.background = 'conic-gradient('+col+' 36%, #1c2d3e 36%)';
  frame.style.boxShadow  = '0 0 30px '+col+'66';
}

function onPseudoChange(val) { tempAvatar.pseudo = val.trim(); }

function selectChar(id, img, btn) {
  tempAvatar.avatarId = id;
  tempAvatar.avatar   = img;
  document.querySelectorAll('.avatar-char-btn').forEach(function(b) {
    b.classList.remove('selected');
    const chk = b.querySelector('.avatar-char-check');
    if (chk) chk.remove();
  });
  btn.classList.add('selected');
  if (!btn.querySelector('.avatar-char-check')) {
    const chk = document.createElement('div');
    chk.className = 'avatar-char-check'; chk.textContent = '✓';
    btn.prepend(chk);
  }
  updatePreview();
  const imgEl = document.getElementById('avatar-preview-img');
  if (imgEl) {
    imgEl.style.transform = 'scale(1.12) translateY(-4px)';
    setTimeout(function(){ imgEl.style.transform = ''; }, 260);
  }
}

function selectColor(color, btn) {
  tempAvatar.color = color;
  document.querySelectorAll('.avatar-color-btn').forEach(function(b){ b.classList.remove('selected'); });
  btn.classList.add('selected');
  updatePreview();
}

function selectClass(classeId, btn) {
  tempAvatar.classe = classeId;
  document.querySelectorAll('.avatar-class-btn').forEach(function(b) {
    b.classList.remove('selected');
    const chk = b.querySelector('.avatar-class-check');
    if (chk) chk.textContent = b.classList.contains('locked') ? '🔒' : '○';
  });
  btn.classList.add('selected');
  const chk = btn.querySelector('.avatar-class-check');
  if (chk) chk.textContent = '✅';
}

async function saveAvatar() {
  if (!tempAvatar.pseudo) { showToast('✏️ Entre ton pseudo héros !'); document.getElementById('avatar-pseudo-input').focus(); return; }
  const btn = document.getElementById('avatar-save-btn');
  btn.classList.add('saving'); btn.textContent = '⏳ Sauvegarde…';
  const isFirstTime = !PROFILE.pseudo;
  PROFILE.pseudo   = tempAvatar.pseudo;
  PROFILE.avatarId = tempAvatar.avatarId;
  PROFILE.avatar   = tempAvatar.avatar;
  PROFILE.color    = tempAvatar.color;
  PROFILE.classe   = tempAvatar.classe;
  if (isFirstTime) { PROFILE.xp += 25; PROFILE.niveau = calcNiveau(PROFILE.xp); }
  saveProfile(PROFILE);
  refreshUI();
  closeAvatarCreator();
  // S-05 : sync immédiate vers Sheets
  await syncToSheets(false);
  if (isFirstTime) showXpPopup(25, 'Avatar créé !');
  else showToast('✅ Avatar sauvegardé !');
  btn.classList.remove('saving'); btn.innerHTML = '💾 Sauvegarder mon Avatar';
}

/* ── REFRESH UI ─────────────────────────────────────── */
function refreshUI() {
  const p = PROFILE;
  const xpMax = xpForNextLevel(p.niveau);
  const xpPct = Math.min(100, Math.round((p.xp / xpMax) * 100));
  const cl = CLASSES.find(function(c){ return c.id===p.classe; }) || CLASSES[0];
  const img   = '<img src="'+esc(avatarSrc(p))+'" style="width:100%;height:100%;object-fit:contain;object-position:bottom;" />';
  const img88 = '<img src="'+esc(avatarSrc(p))+'" style="width:88%;height:88%;object-fit:contain;object-position:bottom;" />';

  document.getElementById('topbar-avatar').innerHTML  = img;
  document.getElementById('topbar-name').textContent  = p.pseudo || 'Mon Héros';
  document.getElementById('topbar-level').textContent = 'Nv.'+p.niveau;
  document.getElementById('xp-fill').style.width      = xpPct+'%';
  document.getElementById('xp-text').textContent      = p.xp+' / '+xpMax;
  document.getElementById('pts-val').textContent      = p.xp.toLocaleString('fr-FR');

  document.getElementById('hero-avatar-big').innerHTML  = img;
  document.getElementById('hero-name').textContent      = p.pseudo || 'Mon Héros';
  document.getElementById('hero-class').textContent     = cl.icon+' '+cl.label;
  document.getElementById('hero-level-badge').textContent = '🏆 Niveau '+p.niveau;

  document.getElementById('profile-avatar-big').innerHTML = img88;
  document.getElementById('profile-name').textContent     = p.pseudo || 'Mon Héros';
  document.getElementById('profile-class').textContent    = cl.icon+' '+cl.label+' · Niveau '+p.niveau;
  document.getElementById('profile-pts-badge').textContent = '💎 '+p.xp.toLocaleString('fr-FR')+' pts';
  document.getElementById('profile-xp').textContent       = p.xp;
  document.getElementById('profile-pts').textContent      = p.xp.toLocaleString('fr-FR');
  const since = new Date(p.dateInscription);
  document.getElementById('profile-since').textContent = since.toLocaleDateString('fr-FR',{month:'short',year:'numeric'});

  // Dernière synchro
  const syncEl = document.getElementById('profile-last-sync');
  if (syncEl) {
    syncEl.textContent = p.lastSync
      ? '☁️ Sync : ' + new Date(p.lastSync).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})
      : '☁️ Pas encore synchronisé';
  }

  const ring = document.querySelector('.profile-avatar-ring');
  if (ring) ring.style.background = 'conic-gradient('+(couleurValide(p.color)?p.color:'#00d4ff')+' '+xpPct+'%, #1c2d3e '+xpPct+'%)';

  document.getElementById('rank-my-avatar').innerHTML  = img;
  document.getElementById('rank-my-name').textContent  = (p.pseudo||'Mon Héros')+' (Moi)';
  document.getElementById('rank-my-pts').textContent   = p.xp.toLocaleString('fr-FR')+' pts';

  // Stats héros
  const statRang = document.getElementById('stat-rang');
  if (statRang) statRang.textContent = '#—';

  renderBadges();
  checkBadges();
}

function renderBadges() {
  const stats    = getStats();
  const unlocked = PROFILE.badges || [];
  const badgesCount = document.getElementById('profile-badges-count');
  const statBadges  = document.getElementById('stat-badges');
  if (badgesCount) badgesCount.textContent = unlocked.length;
  if (statBadges)  statBadges.textContent  = unlocked.length;
  const container = document.getElementById('badges-collection');
  if (!container) return;

  container.innerHTML = BADGES_DEFS.map(function(b) {
    const gained  = unlocked.includes(b.id);
    const inprogress = !gained && b.condition(PROFILE, stats);
    return '<div class="badge-item' + (gained ? ' badge-gained' : '') + '" title="' + b.desc + '">'
      + '<div class="badge-item-icon" style="filter:drop-shadow(0 0 ' + (gained?'8px':'0px') + ' ' + b.color + ')">'
      + (gained ? b.icon : (inprogress ? b.icon : '🔒')) + '</div>'
      + '<div class="badge-item-label" style="color:' + (gained ? b.color : 'var(--text-muted)') + '">'
      + b.label + '</div>'
      + (gained ? '' : '<div class="badge-item-desc">' + b.desc + '</div>')
      + '</div>';
  }).join('');
}

/* ── XP / NIVEAU ────────────────────────────────────── */
function calcNiveau(xp) {
  var s=[0,100,300,600,1000,1500,2500,4000,6000,9000];
  for(var i=s.length-1;i>=0;i--){ if(xp>=s[i]) return i+1; }
  return 1;
}
function xpForNextLevel(n) {
  var s=[100,300,600,1000,1500,2500,4000,6000,9000,12000];
  return s[Math.min(n-1,s.length-1)];
}

/* ── POPUPS ─────────────────────────────────────────── */
function showXpPopup(xp, titre) {
  const p = document.getElementById('xp-popup');
  if (!p) return;
  p.querySelector('.xp-popup-val').textContent   = '+'+xp+' XP';
  p.querySelector('.xp-popup-title').textContent = titre||'Bravo !';
  p.classList.remove('hidden');
  setTimeout(function(){p.classList.add('hidden');},2800);
}

/* ── NAVIGATION ─────────────────────────────────────── */
function navigate(screenId, el) {
  document.querySelectorAll('.screen').forEach(function(s){s.classList.remove('active');});
  const t = document.getElementById('screen-'+screenId);
  if (t) { t.classList.add('active'); document.getElementById('screens').scrollTop=0; }
  document.querySelectorAll('.nav-item').forEach(function(n){n.classList.remove('active');});
  if (el) el.classList.add('active');
}
function switchQuestTab(el, tab) {
  document.querySelectorAll('.quest-tab').forEach(function(t){t.classList.remove('active');});
  el.classList.add('active');
  ['actives','terminees','toutes'].forEach(function(t){
    const e=document.getElementById('quests-'+t);
    if(e) e.style.display=(t===tab)?'block':'none';
  });
}

/* ── TOAST ──────────────────────────────────────────── */
var toastTimer;
function showToast(msg) {
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(function(){t.classList.remove('show');},2600);
}

/* ── TIMER DÉFI ─────────────────────────────────────── */
var countdown = 2*3600+34*60+17;
function tickTimer() {
  if(countdown<=0) return; countdown--;
  var h=String(Math.floor(countdown/3600)).padStart(2,'0');
  var m=String(Math.floor((countdown%3600)/60)).padStart(2,'0');
  var s=String(countdown%60).padStart(2,'0');
  var th=document.getElementById('t-h'),tm=document.getElementById('t-m'),ts=document.getElementById('t-s');
  if(th)th.textContent=h; if(tm)tm.textContent=m; if(ts)ts.textContent=s;
}
setInterval(tickTimer,1000);

/* ── INIT ───────────────────────────────────────────── */
window.addEventListener('load', async function() {
  refreshUI();
  setTimeout(function(){
    const xpMax = xpForNextLevel(PROFILE.niveau);
    const xpPct = Math.min(100, Math.round((PROFILE.xp/xpMax)*100));
    const fill = document.getElementById('xp-fill');
    if(fill) fill.style.width = xpPct+'%';
  },300);

  // S-05 : chargement depuis Sheets si déjà inscrit
  if (PROFILE.pseudo) {
    await loadFromSheets();
  } else {
    setTimeout(openAvatarCreator, 600);
  }

  // S-06 : vérification badges au démarrage
  PROFILE.badges = PROFILE.badges || [];
  checkBadges();

  // S-09 : connexion quotidienne + quêtes
  checkDailyConnexion();
  checkQuetes();

  const frame = document.getElementById('avatar-preview-frame');
  if (frame) frame.addEventListener('click', function(){
    const imgEl = document.getElementById('avatar-preview-img');
    if(imgEl){ imgEl.style.transform='scale(1.15) translateY(-4px)'; setTimeout(function(){imgEl.style.transform='';},250); }
  });

  // Synchro périodique toutes les 5 minutes (si en ligne)
  setInterval(function(){
    if (PROFILE.pseudo && navigator.onLine) syncToSheets();
  }, 5 * 60 * 1000);

  // Détection online/offline
  window.addEventListener('online',  function(){ setSyncIndicator('ok');      if(PROFILE.pseudo) syncToSheets(); });
  window.addEventListener('offline', function(){ setSyncIndicator('offline'); });
});

/* ── PWA ────────────────────────────────────────────── */
document.body.addEventListener('touchmove',function(e){
  if(!e.target.closest('#screens')) e.preventDefault();
},{passive:false});

(function(){
  var p=new URLSearchParams(window.location.search);
  var s=p.get('screen');
  if(s){var n=document.querySelector('[data-screen="'+s+'"]');if(n)navigate(s,n);}
})();

if('serviceWorker' in navigator){
  window.addEventListener('load',async function(){
    try{
      var reg=await navigator.serviceWorker.register('./sw.js',{scope:'./'});
      reg.addEventListener('updatefound',function(){
        var nw=reg.installing;
        nw.addEventListener('statechange',function(){
          if(nw.state==='installed'&&navigator.serviceWorker.controller) showUpdateBanner();
        });
      });
    }catch(e){}
  });
}

function showUpdateBanner(){
  var b=document.createElement('div');
  b.innerHTML='<span>🔄 Mise à jour disponible</span><button onclick="applyUpdate()">Installer</button>';
  Object.assign(b.style,{position:'fixed',top:'0',left:'0',right:'0',background:'linear-gradient(135deg,#1c2d3e,#0e1f2f)',borderBottom:'1px solid rgba(0,212,255,0.4)',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px',zIndex:'99999',fontFamily:'Rajdhani,sans-serif',fontSize:'14px',fontWeight:'600',color:'#e8f4fd'});
  b.querySelector('button').style.cssText='background:#00d4ff;color:#0b1219;border:none;padding:6px 14px;border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit;';
  document.body.prepend(b);
}
function applyUpdate(){
  if(navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({type:'SKIP_WAITING'});
  window.location.reload();
}

var deferredInstallPrompt=null;
window.addEventListener('beforeinstallprompt',function(e){
  e.preventDefault(); deferredInstallPrompt=e;
  var btn=document.createElement('button');
  btn.id='install-btn'; btn.textContent='📲 Installer l\'app';
  Object.assign(btn.style,{position:'fixed',bottom:'calc(80px + env(safe-area-inset-bottom,0px) + 12px)',right:'14px',zIndex:'9990',background:'linear-gradient(135deg,#00d4ff,#007fa3)',color:'#0b1219',border:'none',borderRadius:'20px',padding:'10px 16px',fontSize:'13px',fontWeight:'700',fontFamily:'Rajdhani,sans-serif',cursor:'pointer',boxShadow:'0 0 20px rgba(0,212,255,0.4)'});
  btn.addEventListener('click',async function(){
    if(!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    var result=await deferredInstallPrompt.userChoice;
    deferredInstallPrompt=null; btn.remove();
    if(result.outcome==='accepted') showToast('🎉 SafeZone RPG installé !');
  });
  document.body.appendChild(btn);
});
window.addEventListener('appinstalled',function(){
  showToast('✅ Application installée !');
  var btn=document.getElementById('install-btn');
  if(btn) btn.remove();
});

/* ═══════════════════════════════════════════════════════
   S-07 — MOTEUR QUIZ
   Chargement depuis Google Sheets (S-03 API)
   Gestion état, réponses, XP, stats
═══════════════════════════════════════════════════════ */

/* ── État du quiz ───────────────────────────────────── */
let quizState = {
  questions:    [],
  currentIndex: 0,
  xpEarned:     0,
  correct:      0,
  wrong:        0,
  answered:     false,
  categorie:    '',
};

/* ── Démarrage ──────────────────────────────────────── */
async function startQuiz(categorie) {
  quizState = { questions:[], currentIndex:0, xpEarned:0, correct:0, wrong:0, answered:false, categorie };

  showQuizView('loading');
  showToast('⏳ Chargement des questions…');

  // Charge depuis Google Sheets
  const params = { action: 'getQuiz', limit: 10 };
  if (categorie) params.categorie = categorie;
  const data = await apiGet(params);

  if (!data || data.length === 0) {
    showToast('⚠️ Aucune question disponible');
    showQuizView('home');
    return;
  }

  quizState.questions = data;
  showQuizView('play');
  renderQuestion();
}

/* ── Afficher une vue ───────────────────────────────── */
function showQuizView(view) {
  document.getElementById('quiz-home').style.display   = (view === 'home'   || view === 'loading') ? 'block' : 'none';
  document.getElementById('quiz-play').style.display   = (view === 'play')   ? 'block' : 'none';
  document.getElementById('quiz-result').style.display = (view === 'result') ? 'block' : 'none';
}

/* ── Afficher la question courante ──────────────────── */
function renderQuestion() {
  const q     = quizState.questions[quizState.currentIndex];
  const total = quizState.questions.length;
  const num   = quizState.currentIndex + 1;

  // Progress
  document.getElementById('quiz-progress-fill').style.width = ((num - 1) / total * 100) + '%';
  document.getElementById('quiz-q-num').textContent   = num;
  document.getElementById('quiz-q-total').textContent = total;
  document.getElementById('quiz-xp-earned').textContent = quizState.xpEarned;
  document.getElementById('quiz-cat-label').textContent = q.categorie || 'Quiz';

  // Question
  document.getElementById('quiz-question-text').textContent = q.question;

  // Choix
  const choicesEl = document.getElementById('quiz-choices');
  choicesEl.innerHTML = '';
  const lettres = ['A','B','C','D'];
  lettres.forEach(function(l) {
    if (!q.choix[l]) return;
    const btn = document.createElement('button');
    btn.className = 'quiz-choice-btn';
    btn.innerHTML = '<span class="quiz-choice-letter">'+l+'</span><span class="quiz-choice-text"></span>';
    btn.querySelector('.quiz-choice-text').textContent = q.choix[l];
    btn.onclick = function() { answerQuestion(l, q.questionId, btn); };
    choicesEl.appendChild(btn);
  });

  // Reset explication
  document.getElementById('quiz-explication').classList.add('hidden');
  document.getElementById('quiz-next-btn').textContent = (num === total) ? 'Voir mon score →' : 'Question suivante →';
  quizState.answered = false;
}

/* ── Répondre ───────────────────────────────────────── */
async function answerQuestion(reponse, questionId, btnClicked) {
  if (quizState.answered) return;
  quizState.answered = true;

  // Désactiver tous les boutons
  document.querySelectorAll('.quiz-choice-btn').forEach(function(b) { b.disabled = true; });

  // Envoyer au serveur
  const rep = await apiJoueur('submitQuizAnswer', { questionId, reponse });
  const result = rep.ok ? rep.data : null;

  if (!result) {
    showToast(rep.error === 'profil_inexistant' ? messageErreur(rep.error) : '⚠️ Erreur réseau, réessaie');
    quizState.answered = false;
    document.querySelectorAll('.quiz-choice-btn').forEach(function(b) { b.disabled = false; });
    return;
  }

  const correct = result.correct;
  const bonneReponse = result.bonneReponse;
  const xpGagne = result.xpGagné || 0;

  // Colorier les boutons
  document.querySelectorAll('.quiz-choice-btn').forEach(function(btn) {
    const letter = btn.querySelector('.quiz-choice-letter').textContent;
    if (letter === bonneReponse) btn.classList.add('correct');
    if (letter === reponse && !correct) btn.classList.add('wrong');
  });

  // Stats locales
  if (correct) {
    quizState.correct++;
    quizState.xpEarned += xpGagne;
  } else {
    quizState.wrong++;
  }

  // Mettre à jour XP affiché
  document.getElementById('quiz-xp-earned').textContent = quizState.xpEarned;

  // Explication
  const explEl   = document.getElementById('quiz-explication');
  const iconEl   = document.getElementById('quiz-expl-icon');
  const textEl   = document.getElementById('quiz-expl-text');
  iconEl.textContent = correct ? '✅' : '❌';
  textEl.textContent = result.explication || (correct ? 'Bonne réponse !' : 'Ce n\'est pas la bonne réponse.');
  explEl.classList.remove('hidden');

  // Mise à jour stats localStorage
  const stats = getStats();
  stats.quizTotal    = (stats.quizTotal    || 0) + 1;
  stats.quizCorrects = (stats.quizCorrects || 0) + (correct ? 1 : 0);
  stats.quizXP       = (stats.quizXP       || 0) + xpGagne;
  saveStats(stats);

  // Gain XP profil si correct
  // XP : total calculé par le serveur
  appliquerXPServeur(result);

  // Mise à jour topbar XP
  refreshUI();
}

/* ── Question suivante ──────────────────────────────── */
function nextQuestion() {
  quizState.currentIndex++;
  if (quizState.currentIndex >= quizState.questions.length) {
    showResult();
  } else {
    renderQuestion();
  }
}

/* ── Résultat final ─────────────────────────────────── */
function showResult() {
  showQuizView('result');
  const total   = quizState.questions.length;
  const correct = quizState.correct;
  const pct     = Math.round(correct / total * 100);

  // Icône et titre selon le score
  let icon, titre;
  if (pct === 100) { icon = '🏆'; titre = 'Parfait !'; }
  else if (pct >= 80) { icon = '⭐'; titre = 'Excellent !'; }
  else if (pct >= 60) { icon = '👍'; titre = 'Bien joué !'; }
  else if (pct >= 40) { icon = '💪'; titre = 'Courage !'; }
  else { icon = '📚'; titre = 'Continue à apprendre !'; }

  document.getElementById('quiz-result-icon').textContent  = icon;
  document.getElementById('quiz-result-title').textContent = titre;
  document.getElementById('quiz-result-score').textContent = correct + ' / ' + total + ' (' + pct + '%)';
  document.getElementById('res-correct').textContent = correct;
  document.getElementById('res-wrong').textContent   = quizState.wrong;
  document.getElementById('res-xp').textContent      = quizState.xpEarned;

  // Barre de progression résultat
  setTimeout(function() {
    document.getElementById('quiz-result-bar-fill').style.width = pct + '%';
  }, 200);

  // Mise à jour stats home
  updateQuizHomeStats();

  // Vérif badges
  checkBadges();

  // Sync profil
  if (quizState.xpEarned > 0) syncToSheets();
}

/* ── Rejouer ────────────────────────────────────────── */
function restartQuiz() {
  startQuiz(quizState.categorie);
}

/* ── Quitter ────────────────────────────────────────── */
function exitQuiz() {
  showQuizView('home');
  updateQuizHomeStats();
}

/* ── Stats accueil ──────────────────────────────────── */
function updateQuizHomeStats() {
  const stats = getStats();
  const elTotal   = document.getElementById('qh-total');
  const elCorrect = document.getElementById('qh-correct');
  const elXP      = document.getElementById('qh-xp');
  if (elTotal)   elTotal.textContent   = stats.quizTotal    || 0;
  if (elCorrect) elCorrect.textContent = stats.quizCorrects || 0;
  if (elXP)      elXP.textContent      = stats.quizXP       || 0;
}

// Appel au navigate vers l'écran défi
const _navigateOrig = navigate;
// Patch navigate pour initialiser le quiz home
const _origNavigate = window.navigate;
window.navigateToDefi = function() {
  navigate('defi', document.querySelector('[data-screen="defi"]'));
  showQuizView('home');
  updateQuizHomeStats();
};

/* ═══════════════════════════════════════════════════════
   S-09 — MOTEUR DE QUÊTES
   Quêtes dynamiques basées sur les stats localStorage
   Types : daily (quotidien), weekly (hebdo), epic (long terme), special
═══════════════════════════════════════════════════════ */

/* ── Catalogue des quêtes ───────────────────────────── */
const QUETES_CATALOGUE = [

  // ── QUOTIDIENNES ──────────────────────────────────────
  {
    id: 'daily_connexion',
    type: 'daily',
    typeLabel: 'Quotidienne',
    color: 'cyan',
    icon: '📅',
    name: 'Agent Présent',
    desc: 'Se connecter à SafeZone RPG aujourd\'hui.',
    objectif: 1,
    xpReward: 10,
    getProgress: function(stats) { return stats.connexionAujourdhui ? 1 : 0; },
  },
  {
    id: 'daily_quiz',
    type: 'daily',
    typeLabel: 'Quotidienne',
    color: 'cyan',
    icon: '🧠',
    name: 'Défi du Jour',
    desc: 'Répondre à 3 questions de quiz aujourd\'hui.',
    objectif: 3,
    xpReward: 30,
    getProgress: function(stats) { return Math.min(stats.quizAujourdhui || 0, 3); },
  },

  // ── HEBDOMADAIRES ─────────────────────────────────────
  {
    id: 'weekly_quiz5',
    type: 'weekly',
    typeLabel: 'Hebdomadaire',
    color: 'gold',
    icon: '🎯',
    name: 'Semaine Studieuse',
    desc: 'Réussir 5 quiz correctement cette semaine.',
    objectif: 5,
    xpReward: 75,
    getProgress: function(stats) { return Math.min(stats.quizCorrectsSemaine || 0, 5); },
  },
  {
    id: 'weekly_signal',
    type: 'weekly',
    typeLabel: 'Hebdomadaire',
    color: 'gold',
    icon: '👁️',
    name: 'Œil du Guetteur',
    desc: 'Créer 2 signalements cette semaine.',
    objectif: 2,
    xpReward: 100,
    getProgress: function(stats) { return Math.min(stats.signalementsSemaine || 0, 2); },
  },
  {
    id: 'weekly_streak',
    type: 'weekly',
    typeLabel: 'Hebdomadaire',
    color: 'gold',
    icon: '🔥',
    name: 'Série Parfaite',
    desc: 'Se connecter 5 jours consécutifs cette semaine.',
    objectif: 5,
    xpReward: 120,
    getProgress: function(stats) { return Math.min(stats.streakJours || 0, 5); },
  },

  // ── ÉPIQUES (long terme) ──────────────────────────────
  {
    id: 'epic_quiz20',
    type: 'epic',
    typeLabel: 'Épique',
    color: 'purple',
    icon: '🏆',
    name: 'Maître des Quiz',
    desc: 'Réussir 20 quiz au total.',
    objectif: 20,
    xpReward: 300,
    getProgress: function(stats) { return Math.min(stats.quizCorrects || 0, 20); },
  },
  {
    id: 'epic_epi',
    type: 'epic',
    typeLabel: 'Épique',
    color: 'purple',
    icon: '🦺',
    name: 'Expert EPI',
    desc: 'Réussir 5 quiz de la catégorie EPI.',
    objectif: 5,
    xpReward: 200,
    getProgress: function(stats) { return Math.min(stats.quizEPICorrects || 0, 5); },
  },
  {
    id: 'epic_signal5',
    type: 'epic',
    typeLabel: 'Épique',
    color: 'purple',
    icon: '🛡️',
    name: 'Gardien de l\'Agence',
    desc: 'Créer 5 signalements validés par le QSE.',
    objectif: 5,
    xpReward: 500,
    getProgress: function(stats) { return Math.min(stats.signalementsValides || 0, 5); },
  },
  {
    id: 'epic_niveau5',
    type: 'epic',
    typeLabel: 'Épique',
    color: 'purple',
    icon: '⭐',
    name: 'Ascension',
    desc: 'Atteindre le niveau 5.',
    objectif: 5,
    xpReward: 400,
    getProgress: function(stats) { return Math.min(PROFILE.niveau, 5); },
  },

  // ── SPÉCIALES ─────────────────────────────────────────
  {
    id: 'special_avatar',
    type: 'special',
    typeLabel: 'Spéciale',
    color: 'green',
    icon: '🎭',
    name: 'Bienvenue Agent',
    desc: 'Créer ton profil et personnaliser ton avatar.',
    objectif: 1,
    xpReward: 25,
    getProgress: function(stats) { return PROFILE.pseudo ? 1 : 0; },
  },
  {
    id: 'special_quiz_first',
    type: 'special',
    typeLabel: 'Spéciale',
    color: 'green',
    icon: '🌱',
    name: 'Premier Pas',
    desc: 'Répondre à ta première question de quiz.',
    objectif: 1,
    xpReward: 15,
    getProgress: function(stats) { return Math.min(stats.quizTotal || 0, 1); },
  },
];

/* ── État des quêtes (localStorage) ─────────────────── */
function getQuestesState() {
  try { return JSON.parse(localStorage.getItem('safezone_quetes') || '{}'); } catch(e) { return {}; }
}
function saveQuestesState(state) {
  try { localStorage.setItem('safezone_quetes', JSON.stringify(state)); } catch(e) {}
}

/* ── Vérification et claim des quêtes ───────────────── */
function checkQuetes() {
  const stats  = getStats();
  const qState = getQuestesState();
  let nouvelles = [];

  QUETES_CATALOGUE.forEach(function(q) {
    const progress = q.getProgress(stats);
    const termine  = progress >= q.objectif;
    const claimed  = qState[q.id] && qState[q.id].claimed;

    if (termine && !claimed && !qState[q.id]) {
      // Auto-complétion : marquer comme terminée (pas encore réclamée)
      if (!qState[q.id]) qState[q.id] = {};
      qState[q.id].completed = true;
      qState[q.id].dateCompleted = new Date().toISOString();
      nouvelles.push(q);
    }
  });

  if (nouvelles.length > 0) {
    saveQuestesState(qState);
    // Notif pour la première nouvelle quête terminée
    showToast('⚔️ Quête terminée : ' + nouvelles[0].name + ' !');
  }
  return qState;
}

/* ── Réclamer la récompense d'une quête ─────────────── */
let claimEnCours = false;
async function claimQuete(questId) {
  const qState = getQuestesState();
  const quete  = QUETES_CATALOGUE.find(function(q) { return q.id === questId; });
  if (!quete || !qState[questId] || qState[questId].claimed || claimEnCours) return;

  claimEnCours = true;
  const rep = await apiJoueur('claimQuete', { queteId: questId });
  claimEnCours = false;

  if (!rep.ok) {
    if (rep.error === 'quete_deja_reclamee') {
      qState[questId].claimed = true;
      saveQuestesState(qState);
      renderQuetes();
    }
    showToast(messageErreur(rep.error));
    return;
  }

  qState[questId].claimed     = true;
  qState[questId].dateClaimed = new Date().toISOString();
  saveQuestesState(qState);

  // Gain XP validé par le serveur
  appliquerXPServeur(rep.data);
  refreshUI();
  syncToSheets();

  showXpPopup(rep.data.xpGagne, quete.name);
  renderQuetes();
}

/* ── Rendu de l'écran quêtes ────────────────────────── */
function renderQuetes() {
  const stats  = getStats();
  const qState = checkQuetes();

  const actives   = [];
  const terminees = [];

  QUETES_CATALOGUE.forEach(function(q) {
    const progress = q.getProgress(stats);
    const pct      = Math.min(100, Math.round(progress / q.objectif * 100));
    const state    = qState[q.id] || {};
    const claimed  = state.claimed;
    const completed = progress >= q.objectif;

    const card = buildQuesteCard(q, progress, pct, completed, claimed);

    if (claimed) {
      terminees.push({ card, date: state.dateClaimed });
    } else {
      actives.push({ card, pct });
    }
  });

  // Trier : quêtes les plus avancées en premier
  actives.sort(function(a,b) { return b.pct - a.pct; });

  // Actives
  const activesList = document.getElementById('quests-actives-list');
  const activesEmpty = document.getElementById('quests-actives-empty');
  if (activesList) {
    activesList.innerHTML = actives.map(function(a){ return a.card; }).join('');
    if (activesEmpty) activesEmpty.style.display = actives.length === 0 ? 'flex' : 'none';
  }

  // Terminées
  terminees.sort(function(a,b){ return new Date(b.date) - new Date(a.date); });
  const termineesList  = document.getElementById('quests-terminees-list');
  const termineesEmpty = document.getElementById('quests-terminees-empty');
  if (termineesList) {
    termineesList.innerHTML = terminees.map(function(t){ return t.card; }).join('');
    if (termineesEmpty) termineesEmpty.style.display = terminees.length === 0 ? 'flex' : 'none';
  }

  // Catalogue
  const catalogueList = document.getElementById('quests-catalogue-list');
  if (catalogueList) {
    catalogueList.innerHTML = QUETES_CATALOGUE.map(function(q) {
      const progress = q.getProgress(stats);
      const pct      = Math.min(100, Math.round(progress / q.objectif * 100));
      const claimed  = (qState[q.id] || {}).claimed;
      return buildQuesteCard(q, progress, pct, progress >= q.objectif, claimed);
    }).join('');
  }

  // Sous-titre
  const subtitle = document.getElementById('quetes-subtitle');
  if (subtitle) {
    subtitle.textContent = actives.length + ' active' + (actives.length > 1 ? 's' : '')
      + ' · ' + terminees.length + ' terminée' + (terminees.length > 1 ? 's' : '');
  }

  // Badge nav
  const navBadge = document.querySelector('[data-screen="quetes"] .nav-badge');
  if (navBadge) {
    const claimable = actives.filter(function(a){ return a.pct >= 100; }).length;
    navBadge.textContent = claimable || '';
    navBadge.style.display = claimable > 0 ? 'flex' : 'none';
  }
}

/* ── Builder d'une carte quête ──────────────────────── */
function buildQuesteCard(q, progress, pct, completed, claimed) {
  const colorClass = { cyan:'cyan', gold:'gold', purple:'purple', green:'green' }[q.color] || 'cyan';
  const typeColors = { daily:'badge-cyan', weekly:'badge-gold', epic:'badge-purple', special:'badge-green' };
  const badgeClass = typeColors[q.type] || 'badge-cyan';

  let footer = '';
  if (claimed) {
    footer = '<span style="font-size:11px;color:var(--accent-success)">✅ Récompense réclamée</span>'
           + '<div class="quest-xp-reward">+' + q.xpReward + ' XP</div>';
  } else if (completed) {
    footer = '<span style="font-size:11px;color:var(--accent-secondary)">🎉 Terminée !</span>'
           + '<button class="quest-claim-btn" onclick="claimQuete(\'' + q.id + '\')">Réclamer +' + q.xpReward + ' XP</button>';
  } else {
    footer = '<span style="font-size:11px;color:var(--text-muted)">' + progress + ' / ' + q.objectif + '</span>'
           + '<div class="quest-xp-reward">💎 +' + q.xpReward + ' XP</div>';
  }

  return '<div class="quest-card quest-type-' + q.type + (claimed ? '" style="opacity:0.6' : '') + '">'
    + '<div class="quest-card-accent ' + colorClass + '"></div>'
    + '<div class="quest-header">'
    +   '<div class="quest-name">' + q.icon + ' ' + q.name + '</div>'
    +   '<span class="badge ' + badgeClass + '">' + q.typeLabel.toUpperCase() + '</span>'
    + '</div>'
    + '<div class="quest-desc">' + q.desc + '</div>'
    + (claimed ? '' :
        '<div class="quest-progress-label"><span></span><span>' + pct + '%</span></div>'
      + '<div class="progress-bar" style="margin-bottom:6px;">'
      +   '<div class="progress-fill ' + colorClass + '" style="width:' + pct + '%"></div>'
      + '</div>')
    + '<div class="quest-footer">' + footer + '</div>'
    + '</div>';
}

/* ── Mise à jour stats connexion quotidienne ─────────── */
function checkDailyConnexion() {
  const stats   = getStats();
  const today   = new Date().toDateString();
  const lastDay = stats.dernierJour;

  if (lastDay === today) {
    stats.connexionAujourdhui = true;
  } else {
    // Nouveau jour
    stats.connexionAujourdhui  = true;
    stats.quizAujourdhui       = 0;
    stats.dernierJour          = today;
    // Streak
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if (lastDay === yesterday) {
      stats.streakJours = (stats.streakJours || 0) + 1;
    } else if (!lastDay) {
      stats.streakJours = 1;
    } else {
      stats.streakJours = 1; // streak cassé
    }
    // Reset stats semaine si lundi
    const dayOfWeek = new Date().getDay();
    if (dayOfWeek === 1) {
      stats.quizCorrectsSemaine  = 0;
      stats.signalementsSemaine  = 0;
    }
  }
  saveStats(stats);
}

/* ═══════════════════════════════════════════════════════
   S-10 — SIGNALEMENT FLASH
   Formulaire complet : description, localisation GPS,
   photo, priorité → envoi vers Google Sheets API S-03
═══════════════════════════════════════════════════════ */

/* ── Config XP par catégorie ────────────────────────── */
const SIGNAL_CONFIG = {
  urgence:        { label: '🚨 URGENCE / ACCIDENT', xp: 100, priorite: 'critique' },
  danger:         { label: '⚠️ Situation Dangereuse', xp: 75,  priorite: 'haute' },
  equipement:     { label: '🔧 Équipement Défectueux', xp: 50, priorite: 'normale' },
  presqueaccident:{ label: '💡 Presque-Accident',     xp: 60,  priorite: 'haute' },
  bonnepratique:  { label: '👍 Bonne Pratique',       xp: 30,  priorite: 'normale' },
};

/* ── État formulaire ────────────────────────────────── */
let signalState = {
  categorie: '',
  priorite:  'normale',
  photoData:  null,
};

/* ── Ouvrir le formulaire ───────────────────────────── */
function openSignalForm(categorie) {
  signalState = { categorie, priorite: 'normale', photoData: null };
  const cfg = SIGNAL_CONFIG[categorie] || SIGNAL_CONFIG.danger;

  // Reset form
  document.getElementById('signal-desc').value = '';
  document.getElementById('signal-loc').value  = '';
  document.getElementById('signal-char-val').textContent = '0';
  document.getElementById('signal-geo-status').textContent = '';
  document.getElementById('signal-photo-preview').style.display = 'none';
  document.getElementById('signal-photo-placeholder').style.display = 'flex';
  document.getElementById('signal-photo-zone').classList.remove('has-photo');
  document.querySelectorAll('.signal-priority-btn').forEach(function(b) {
    b.classList.remove('active');
    if (b.dataset.priority === cfg.priorite) b.classList.add('active');
  });
  signalState.priorite = cfg.priorite;

  // Header
  document.getElementById('signal-form-title').textContent = cfg.label;
  document.getElementById('signal-form-xp').textContent    = '+' + cfg.xp + ' XP';

  showSignalView('form');
}

function closeSignalForm() {
  showSignalView('home');
  renderRecentSignalements();
}

function closeSignalConfirm() {
  showSignalView('home');
  renderRecentSignalements();
}

function showSignalView(view) {
  document.getElementById('signal-home').style.display    = view === 'home'    ? 'block' : 'none';
  document.getElementById('signal-form').style.display    = view === 'form'    ? 'block' : 'none';
  document.getElementById('signal-confirm').style.display = view === 'confirm' ? 'block' : 'none';
}

/* ── Compteur caractères ────────────────────────────── */
function updateCharCount(textarea) {
  document.getElementById('signal-char-val').textContent = textarea.value.length;
}

/* ── Géolocalisation ────────────────────────────────── */
function getGeolocation() {
  const statusEl = document.getElementById('signal-geo-status');
  const locInput = document.getElementById('signal-loc');
  if (!navigator.geolocation) {
    statusEl.textContent = '❌ Géolocalisation non disponible';
    return;
  }
  statusEl.textContent = '📡 Localisation en cours…';
  navigator.geolocation.getCurrentPosition(
    function(pos) {
      const lat = pos.coords.latitude.toFixed(5);
      const lng = pos.coords.longitude.toFixed(5);
      locInput.value = 'GPS: ' + lat + ', ' + lng;
      statusEl.textContent = '✅ Position GPS récupérée';
      setTimeout(function(){ statusEl.textContent = ''; }, 3000);
    },
    function(err) {
      statusEl.textContent = '⚠️ ' + (err.message || 'Position indisponible');
    },
    { timeout: 10000, maximumAge: 60000 }
  );
}

/* ── Photo ──────────────────────────────────────────── */
function triggerPhoto() {
  document.getElementById('signal-photo-input').click();
}

function handlePhotoSelect(input) {
  if (!input.files || !input.files[0]) return;
  const file   = input.files[0];
  const reader = new FileReader();
  reader.onload = function(e) {
    signalState.photoData = e.target.result;
    const preview = document.getElementById('signal-photo-preview');
    const placeholder = document.getElementById('signal-photo-placeholder');
    preview.src = e.target.result;
    preview.style.display = 'block';
    placeholder.style.display = 'none';
    document.getElementById('signal-photo-zone').classList.add('has-photo');
  };
  reader.readAsDataURL(file);
}

/* ── Priorité ───────────────────────────────────────── */
function selectPriority(btn, priorite) {
  signalState.priorite = priorite;
  document.querySelectorAll('.signal-priority-btn').forEach(function(b) {
    b.classList.remove('active');
  });
  btn.classList.add('active');
}

/* ── Soumettre le signalement ───────────────────────── */
async function submitSignalement() {
  const desc = document.getElementById('signal-desc').value.trim();
  if (!desc || desc.length < 10) {
    showToast('✏️ Décris la situation (min. 10 caractères)');
    return;
  }

  const btn = document.getElementById('signal-submit-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Envoi en cours…';

  const cfg = SIGNAL_CONFIG[signalState.categorie] || SIGNAL_CONFIG.danger;
  const loc = document.getElementById('signal-loc').value.trim();

  const signalement = {
    userId:       PROFILE.userId,
    pseudo:       PROFILE.pseudo,
    cle:          signalState.categorie,
    categorie:    cfg.label,
    description:  desc,
    localisation: loc,
    photo:        signalState.photoData ? '📷 Photo jointe' : '',
    priorite:     signalState.priorite,
  };

  const rep = await apiJoueur('createSignalement', { signalement });
  const result = rep.ok ? rep.data : null;

  btn.disabled = false;
  btn.textContent = '🚀 Envoyer le Signalement';

  if (result) {
    // XP gagné
    const xpGagne = Number(result.xpGagne) || 0;
    appliquerXPServeur(result);

    // Stats
    const stats = getStats();
    stats.signalementsTotal    = (stats.signalementsTotal || 0) + 1;
    stats.signalementsSemaine  = (stats.signalementsSemaine || 0) + 1;
    saveStats(stats);

    // Sauvegarde locale du signalement
    saveSignalementLocal({
      sigId:        result.sigId,
      categorie:    cfg.label,
      description:  desc,
      localisation: loc,
      priorite:     signalState.priorite,
      statut:       'nouveau',
      date:         new Date().toISOString(),
      xpGagne,
    });

    refreshUI();
    checkBadges();
    checkQuetes();
    syncToSheets();

    // Écran confirmation
    document.getElementById('signal-confirm-xp').textContent = '+' + xpGagne + ' XP';
    showSignalView('confirm');
  } else {
    showToast(rep.error === 'reseau' ? '⚠️ Erreur réseau. Vérifie ta connexion et réessaie.' : messageErreur(rep.error));
  }
}

/* ── Signalements locaux ────────────────────────────── */
function saveSignalementLocal(sig) {
  try {
    const list = JSON.parse(localStorage.getItem('safezone_signalements') || '[]');
    list.unshift(sig);
    // Garder les 20 derniers
    localStorage.setItem('safezone_signalements', JSON.stringify(list.slice(0, 20)));
  } catch(e) {}
}

function getSignalementsLocaux() {
  try { return JSON.parse(localStorage.getItem('safezone_signalements') || '[]'); }
  catch(e) { return []; }
}

/* ── Rendu liste récente ────────────────────────────── */
function renderRecentSignalements() {
  const list   = getSignalementsLocaux();
  const el     = document.getElementById('signal-recent-list');
  if (!el) return;

  if (list.length === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:20px 0;">'
      + '<div class="empty-icon" style="font-size:32px;">📭</div>'
      + '<div class="empty-text">Aucun signalement pour l\'instant</div></div>';
    return;
  }

  const icons = { urgence:'🚨', danger:'⚠️', equipement:'🔧', presqueaccident:'💡', bonnepratique:'👍' };

  el.innerHTML = list.slice(0, 5).map(function(s) {
    const date = new Date(s.date).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
    const statut = ['nouveau','en-cours','résolu','rejeté'].indexOf(s.statut) >= 0 ? s.statut : 'nouveau';
    const statusClass = 'status-' + statut;
    const descr = String(s.description || '');
    return '<div class="signal-recent-item">'
      + '<div class="signal-recent-icon">⚠️</div>'
      + '<div class="signal-recent-body">'
      +   '<div class="signal-recent-desc">' + esc(descr.slice(0, 60)) + (descr.length > 60 ? '…' : '') + '</div>'
      +   '<div class="signal-recent-meta">' + esc(date) + ' · +' + (Number(s.xpGagne) || 0) + ' XP</div>'
      + '</div>'
      + '<span class="signal-recent-status ' + statusClass + '">' + esc(statut) + '</span>'
      + '</div>';
  }).join('');
}

// Init au navigate vers signaler
const _origNavigateRef = window.navigate || function(){};

/* ═══════════════════════════════════════════════════════
   S-11 — INTERFACE QSE ADMIN
   Accès : triple tap sur avatar profil + code PIN
   Fonctions : liste signalements, changement statut, XP bonus
═══════════════════════════════════════════════════════ */

/* ── Accès QSE (S-SEC) ──────────────────────────────────
   Le PIN n'est plus dans le code : il est vérifié par le serveur
   (propriété QSE_PIN d'Apps Script), qui renvoie un jeton de session
   valable 6 h, gardé seulement le temps que l'app reste ouverte. */
let QSE_TOKEN = '';
try { QSE_TOKEN = sessionStorage.getItem('safezone_qse_token') || ''; } catch(e) {}
const QSE_PIN_MAX = 12;

/* ── Triple tap détection ───────────────────────────── */
let qseTapCount = 0;
let qseTapTimer = null;

function handleQSETap() {
  qseTapCount++;
  clearTimeout(qseTapTimer);
  qseTapTimer = setTimeout(function() { qseTapCount = 0; }, 800);
  if (qseTapCount >= 3) {
    qseTapCount = 0;
    openQSE();
  }
}

/* ── Ouverture QSE ──────────────────────────────────── */
let qsePinValue = '';
let qseAuthenticated = !!QSE_TOKEN;

function qseDeconnecter(expire) {
  QSE_TOKEN = '';
  qseAuthenticated = false;
  try { sessionStorage.removeItem('safezone_qse_token'); } catch(e) {}
  const btn = document.getElementById('canal-compose-btn');
  if (btn) btn.classList.remove('visible');
  if (expire) showToast('🔒 Session QSE expirée, ressaisis le code');
}
let qseCurrentFilter = '';
let qseSignalementsCache = [];
let qseCurrentSigId = null;

function openQSE() {
  qsePinValue = '';
  updatePinDisplay();
  document.getElementById('qse-pin-error').classList.add('hidden');

  if (qseAuthenticated) {
    document.getElementById('qse-pin-gate').style.display    = 'none';
    document.getElementById('qse-dashboard').style.display   = 'flex';
    loadQSESignalements();
  } else {
    document.getElementById('qse-pin-gate').style.display    = 'flex';
    document.getElementById('qse-dashboard').style.display   = 'none';
  }
  document.getElementById('qse-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeQSE() {
  document.getElementById('qse-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

/* ── PIN ────────────────────────────────────────────── */
function pinPress(key) {
  if (key === '←') {
    qsePinValue = qsePinValue.slice(0, -1);
  } else if (key === 'OK') {
    verifierPinQSE(qsePinValue);
    qsePinValue = '';
  } else if (qsePinValue.length < QSE_PIN_MAX) {
    qsePinValue += key;
  }
  updatePinDisplay();
}

async function verifierPinQSE(pin) {
  const errEl = document.getElementById('qse-pin-error');
  if (!pin) return;
  const rep = await apiCall({ action: 'qseLogin', pin: pin });
  if (rep.ok && rep.data && rep.data.token) {
    QSE_TOKEN = rep.data.token;
    qseAuthenticated = true;
    try { sessionStorage.setItem('safezone_qse_token', QSE_TOKEN); } catch(e) {}
    document.getElementById('qse-pin-gate').style.display  = 'none';
    document.getElementById('qse-dashboard').style.display = 'flex';
    loadQSESignalements();
  } else {
    errEl.textContent = messageErreur(rep.error);
    errEl.classList.remove('hidden');
    setTimeout(function(){ errEl.classList.add('hidden'); }, 2500);
  }
}

function updatePinDisplay() {
  const dots = qsePinValue.split('').map(function(){ return '●'; });
  while (dots.length < 6) dots.push('_');
  document.getElementById('qse-pin-display').textContent = dots.join(' ');
}

/* ── Chargement signalements ────────────────────────── */
async function loadQSESignalements() {
  const listEl = document.getElementById('qse-signalements-list');
  listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><div class="empty-title">Chargement…</div></div>';

  const rep  = await apiQSE('getSignalements');
  if (!rep.ok && rep.error === 'non_autorise') { closeQSE(); return; }
  const data = rep.ok ? rep.data : null;

  if (!data || data.length === 0) {
    listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-title">Aucun signalement</div></div>';
    updateQSEStats([]);
    return;
  }

  qseSignalementsCache = data;
  updateQSEStats(data);
  renderQSEList(data, qseCurrentFilter);
}

function updateQSEStats(data) {
  const total   = data.length;
  const nouveau = data.filter(function(s){ return s.statut === 'nouveau'; }).length;
  const encours = data.filter(function(s){ return s.statut === 'en-cours'; }).length;
  const resolu  = data.filter(function(s){ return s.statut === 'résolu'; }).length;

  document.getElementById('qse-stat-total').textContent   = total;
  document.getElementById('qse-stat-nouveau').textContent = nouveau;
  document.getElementById('qse-stat-encours').textContent = encours;
  document.getElementById('qse-stat-resolu').textContent  = resolu;
}

function filterSignalements(statut, btn) {
  qseCurrentFilter = statut;
  document.querySelectorAll('#qse-overlay .quest-tab').forEach(function(t){ t.classList.remove('active'); });
  btn.classList.add('active');
  renderQSEList(qseSignalementsCache, statut);
}

function renderQSEList(data, filter) {
  const listEl = document.getElementById('qse-signalements-list');
  const filtered = filter ? data.filter(function(s){ return s.statut === filter; }) : data;

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-title">Aucun signalement ' + esc(filter || '') + '</div></div>';
    return;
  }

  const statusBadge = {
    'nouveau':  '<span class="signal-recent-status status-nouveau">NOUVEAU</span>',
    'en-cours': '<span class="signal-recent-status status-en-cours">EN COURS</span>',
    'résolu':   '<span class="signal-recent-status status-résolu">RÉSOLU</span>',
    'rejeté':   '<span class="signal-recent-status" style="background:rgba(255,71,87,0.12);color:var(--accent-danger)">REJETÉ</span>',
  };
  const priorityTag = {
    'normale':  '<span class="qse-priority-tag priority-normale">Normale</span>',
    'haute':    '<span class="qse-priority-tag priority-haute">Haute</span>',
    'critique': '<span class="qse-priority-tag priority-critique">⚠️ Critique</span>',
  };

  listEl.innerHTML = filtered.map(function(s) {
    const date = new Date(s.dateCreation).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
    const descr = String(s.description || '');
    return '<div class="qse-signal-card" data-sigid="' + esc(s.sigId) + '">'
      + '<div class="qse-signal-top">'
      +   '<div class="qse-signal-cat">' + esc(s.categorie) + '</div>'
      +   (statusBadge[s.statut] || '')
      + '</div>'
      + '<div class="qse-signal-meta">' + esc(date) + ' · ' + esc(s.localisation || 'Localisation non renseignée') + '</div>'
      + '<div class="qse-signal-desc">' + esc(descr.slice(0, 100)) + (descr.length > 100 ? '…' : '') + '</div>'
      + '<div class="qse-signal-footer">'
      +   '<div class="qse-signal-who">👤 ' + esc(s.pseudo || s.userId) + '</div>'
      +   (priorityTag[s.priorite] || '')
      + '</div>'
      + '</div>';
  }).join('');

  // Clic sur une carte : l'identifiant est lu dans l'attribut, jamais injecté dans du code
  listEl.querySelectorAll('.qse-signal-card').forEach(function(card) {
    card.addEventListener('click', function() { openQSEDetail(card.dataset.sigid); });
  });
}

/* ── Détail signalement ─────────────────────────────── */
function openQSEDetail(sigId) {
  qseCurrentSigId = sigId;
  const s = qseSignalementsCache.find(function(x){ return x.sigId === sigId; });
  if (!s) return;

  document.getElementById('qse-modal-title').textContent = s.categorie;
  document.getElementById('qse-comment').value = s.commentaireQSE || '';

  const date = new Date(s.dateCreation).toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' });

  document.getElementById('qse-modal-body').innerHTML =
    '<div class="qse-detail-row"><div class="qse-detail-label">📝 Description</div><div class="qse-detail-val">' + esc(s.description) + '</div></div>'
  + '<div class="qse-detail-row"><div class="qse-detail-label">📍 Localisation</div><div class="qse-detail-val">' + esc(s.localisation || '—') + '</div></div>'
  + '<div class="qse-detail-row"><div class="qse-detail-label">👤 Signalé par</div><div class="qse-detail-val">' + esc(s.pseudo || s.userId) + '</div></div>'
  + '<div class="qse-detail-row"><div class="qse-detail-label">📅 Date</div><div class="qse-detail-val">' + esc(date) + '</div></div>'
  + '<div class="qse-detail-row"><div class="qse-detail-label">🎯 Priorité</div><div class="qse-detail-val">' + esc(s.priorite || 'normale') + '</div></div>'
  + (s.commentaireQSE ? '<div class="qse-detail-row"><div class="qse-detail-label">💬 Commentaire QSE précédent</div><div class="qse-detail-val">' + esc(s.commentaireQSE) + '</div></div>' : '');

  document.getElementById('qse-detail-modal').classList.remove('hidden');
}

function closeQSEDetail() {
  document.getElementById('qse-detail-modal').classList.add('hidden');
  qseCurrentSigId = null;
}

/* ── Mise à jour statut ─────────────────────────────── */
async function updateStatut(statut) {
  if (!qseCurrentSigId) return;
  const comment = document.getElementById('qse-comment').value.trim();

  const btn = event.target;
  btn.disabled = true; btn.textContent = '⏳';

  const rep = await apiQSE('updateSignalement', {
    sigId:       qseCurrentSigId,
    statut,
    commentaire: comment,
  });
  const result = rep.ok ? rep.data : null;

  btn.disabled = false;
  btn.textContent = statut === 'résolu' ? '✅ Résoudre' : statut === 'en-cours' ? '🔄 En cours' : '❌ Rejeter';

  if (result) {
    // Mettre à jour le cache local
    const idx = qseSignalementsCache.findIndex(function(s){ return s.sigId === qseCurrentSigId; });
    if (idx >= 0) {
      qseSignalementsCache[idx].statut         = statut;
      qseSignalementsCache[idx].commentaireQSE = comment;
    }
    closeQSEDetail();
    updateQSEStats(qseSignalementsCache);
    renderQSEList(qseSignalementsCache, qseCurrentFilter);
    showToast(statut === 'résolu' ? '✅ Résolu ! +50 XP envoyé au salarié' : '🔄 Statut mis à jour');
  } else {
    showToast('⚠️ Erreur réseau');
  }
}

/* ═══════════════════════════════════════════════════════
   S-12 — CANAL QSE + TELEGRAM
   Messages QSE → stockés dans Sheets + envoyés via Telegram
═══════════════════════════════════════════════════════ */

/* ── Config Telegram ────────────────────────────────── */
// Lien vers ton canal/groupe Telegram (à configurer)
const TELEGRAM_CHANNEL_LINK = 'https://t.me/+LIEN_DE_TON_CANAL';  // ← À remplacer

/* ── Ouvrir Telegram ────────────────────────────────── */
function openTelegram() {
  window.open(TELEGRAM_CHANNEL_LINK, '_blank');
}

/* ── Charger les messages canal ─────────────────────── */
async function loadCanalMessages() {
  const listEl = document.getElementById('canal-messages-list');
  if (!listEl) return;

  listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><div class="empty-title">Chargement…</div></div>';

  const data = await apiGet({ action: 'getCanalMessages' });

  if (!data || data.length === 0) {
    listEl.innerHTML = renderCanalDefaut();
    return;
  }

  listEl.innerHTML = data.map(function(msg) {
    return renderCanalMessage(msg);
  }).join('');

  // Bouton compose visible si QSE authentifié
  const btn = document.getElementById('canal-compose-btn');
  if (btn && qseAuthenticated) btn.classList.add('visible');
}

/* ── Rendu message ──────────────────────────────────── */
function renderCanalMessage(msg) {
  const icons = { alerte:'🚨', info:'ℹ️', formation:'📚', bravo:'🎉' };
  const type  = icons.hasOwnProperty(msg.type) ? msg.type : 'info';
  const icon  = icons[type];
  const date  = new Date(msg.date || msg.dateCreation).toLocaleDateString('fr-FR', {
    day:'2-digit', month:'short', year:'numeric'
  });
  return '<div class="canal-msg-card type-' + type + '">'
    + '<div class="canal-msg-header">'
    +   '<span class="canal-msg-type">' + icon + ' ' + type.toUpperCase() + '</span>'
    +   '<span class="canal-msg-date">' + esc(date) + '</span>'
    + '</div>'
    + '<div class="canal-msg-title">' + esc(msg.titre || msg.title || '') + '</div>'
    + '<div class="canal-msg-body">' + esc(msg.message || msg.body || '') + '</div>'
    + '<div class="canal-msg-author">— Service QSE PIZZORNO</div>'
    + '</div>';
}

/* ── Messages de démo si Sheets vide ────────────────── */
function renderCanalDefaut() {
  const msgs = [
    {
      type: 'alerte',
      titre: 'Rappel : Port des EPI obligatoire',
      message: 'Suite à plusieurs observations terrain, nous rappelons que le port des EPI (gants, gilet HV, chaussures de sécurité) est obligatoire en toute circonstance lors des tournées de collecte.',
      date: new Date(Date.now() - 86400000 * 2).toISOString(),
    },
    {
      type: 'bravo',
      titre: '🏆 Félicitations à l\'équipe collecte !',
      message: 'Zéro accident enregistré ce mois-ci sur le secteur Nord. Bravo à toute l\'équipe pour leur vigilance et leur respect des consignes de sécurité. Continuez ainsi !',
      date: new Date(Date.now() - 86400000 * 5).toISOString(),
    },
    {
      type: 'formation',
      titre: 'Formation Gestes & Postures — Inscription',
      message: 'Une session de formation Gestes & Postures est organisée le mois prochain. Les inscriptions sont ouvertes. Contactez votre responsable d\'équipe pour vous inscrire.',
      date: new Date(Date.now() - 86400000 * 10).toISOString(),
    },
    {
      type: 'info',
      titre: 'Nouveau : Application SafeZone RPG',
      message: 'Bienvenue sur SafeZone RPG ! Cette application vous permet de renforcer votre culture sécurité tout en gagnant des points et des récompenses. Créez votre avatar et commencez dès aujourd\'hui !',
      date: new Date(Date.now() - 86400000 * 15).toISOString(),
    },
  ];
  return msgs.map(function(m) { return renderCanalMessage(m); }).join('');
}

/* ── Compose message QSE ────────────────────────────── */
let canalMsgType = 'info';

function openCanalCompose() {
  canalMsgType = 'info';
  document.getElementById('canal-msg-titre').value = '';
  document.getElementById('canal-msg-body').value  = '';
  document.querySelectorAll('[data-msgtype]').forEach(function(b) {
    b.classList.toggle('active', b.dataset.msgtype === 'info');
  });
  document.getElementById('canal-compose-modal').classList.remove('hidden');
}

function closeCanalCompose() {
  document.getElementById('canal-compose-modal').classList.add('hidden');
}

function selectMsgType(btn, type) {
  canalMsgType = type;
  document.querySelectorAll('[data-msgtype]').forEach(function(b) {
    b.classList.remove('active');
  });
  btn.classList.add('active');
}

async function publishCanalMessage() {
  const titre = document.getElementById('canal-msg-titre').value.trim();
  const body  = document.getElementById('canal-msg-body').value.trim();
  if (!titre || !body) { showToast('✏️ Titre et message obligatoires'); return; }

  const btn = document.querySelector('#canal-compose-modal .signal-submit-btn');
  btn.disabled = true; btn.textContent = '⏳ Publication…';

  const rep = await apiQSE('publishCanalMessage', {
    message: {
      type:    canalMsgType,
      titre,
      message: body,
    }
  });
  const result = rep.ok ? rep.data : null;

  btn.disabled = false; btn.textContent = '📣 Publier + Notifier Telegram';

  if (result) {
    closeCanalCompose();
    showToast('✅ Message publié' + (result.telegramSent ? ' + Telegram notifié !' : ' !'));
    loadCanalMessages();
  } else {
    showToast('⚠️ Erreur lors de la publication');
  }
}
