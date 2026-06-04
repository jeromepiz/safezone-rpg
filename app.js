/* ═══════════════════════════════════════════════════════
   SafeZone RPG — app.js  (S-04 avec images personnages)
═══════════════════════════════════════════════════════ */

/* ── API S-03 ───────────────────────────────────────── */
const API_URL = "https://script.google.com/macros/s/AKfycbx71CS0GXaFT2pLVm4aXS_OxC8mrcWvMI7be9r-KycELxy2qzYyOWMWgWyVANUywhsj/exec";

async function apiGet(params) {
  try {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(API_URL + '?' + qs);
    const j = await res.json();
    return j.ok ? j.data : null;
  } catch(e) { return null; }
}
async function apiPost(body) {
  try {
    const res = await fetch(API_URL, { method:'POST', body:JSON.stringify(body) });
    const j = await res.json();
    return j.ok ? j.data : null;
  } catch(e) { return null; }
}

/* ── PROFIL LOCAL ───────────────────────────────────── */
const DEFAULT_PROFILE = {
  userId:   'local_' + Math.random().toString(36).slice(2,10),
  pseudo:   '', avatar: 'avatars/recrue.png', avatarId: 'recrue',
  color:    '#00d4ff', classe: 'recrue',
  xp: 0, niveau: 1, badges: [], quetes: [],
  dateInscription: new Date().toISOString()
};
function loadProfile() {
  try { const r=localStorage.getItem('safezone_profile'); return r?{...DEFAULT_PROFILE,...JSON.parse(r)}:{...DEFAULT_PROFILE}; }
  catch(e) { return {...DEFAULT_PROFILE}; }
}
function saveProfile(p) { try{localStorage.setItem('safezone_profile',JSON.stringify(p));}catch(e){} }
let PROFILE = loadProfile();

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
  {value:'#00d4ff',label:'Cyan',   style:'background:#00d4ff'},
  {value:'#f7c520',label:'Or',     style:'background:#f7c520'},
  {value:'#2ed573',label:'Vert',   style:'background:#2ed573'},
  {value:'#ff4757',label:'Rouge',  style:'background:#ff4757'},
  {value:'#a855f7',label:'Violet', style:'background:#a855f7'},
  {value:'#ff6b35',label:'Orange', style:'background:#ff6b35'},
  {value:'#e8f4fd',label:'Blanc',  style:'background:#e8f4fd'},
  {value:'#40e0d0',label:'Turquoise',style:'background:linear-gradient(135deg,#40e0d0,#00c9ff)'},
];
const CLASSES = [
  {id:'recrue',    icon:'⚡',label:'Recrue',          desc:'Tu commences ton aventure sécurité',          req:'Disponible dès le départ', unlock:0},
  {id:'sentinelle',icon:'👁️',label:'Sentinelle',      desc:'Tu surveilles et signales les risques',         req:'Niveau 2 requis (100 XP)', unlock:100},
  {id:'gardien',   icon:'🛡️',label:'Gardien',         desc:'Tu maîtrises les procédures de sécurité',      req:'Niveau 4 requis (300 XP)', unlock:300},
  {id:'expert',    icon:'🎯',label:'Expert QSE',       desc:'Tu es une référence pour ton équipe',          req:'Niveau 6 requis (1000 XP)',unlock:1000},
  {id:'champion',  icon:'🏆',label:'Champion SafeZone',desc:'Le titre ultime. Légende de l\'agence.',       req:'Niveau 10 requis (6000 XP)',unlock:6000},
];

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
  apiPost({action:'upsertJoueur',joueur:{userId:PROFILE.userId,pseudo:PROFILE.pseudo,avatar:PROFILE.avatar,xp:PROFILE.xp,niveau:PROFILE.niveau}}).catch(function(){});
  refreshUI();
  closeAvatarCreator();
  if (isFirstTime) showXpPopup(25,'Avatar créé !');
  else showToast('✅ Avatar mis à jour !');
  btn.classList.remove('saving'); btn.innerHTML = '💾 Sauvegarder mon Avatar';
}

/* ── REFRESH UI ─────────────────────────────────────── */
function refreshUI() {
  const p = PROFILE;
  const xpMax = xpForNextLevel(p.niveau);
  const xpPct = Math.min(100, Math.round((p.xp / xpMax) * 100));
  const cl = CLASSES.find(function(c){ return c.id===p.classe; }) || CLASSES[0];
  const img = '<img src="'+(p.avatar||'avatars/recrue.png')+'" style="width:100%;height:100%;object-fit:contain;" />';
  const img88 = '<img src="'+(p.avatar||'avatars/recrue.png')+'" style="width:88%;height:88%;object-fit:contain;" />';

  document.getElementById('topbar-avatar').innerHTML = img;
  document.getElementById('topbar-name').textContent = p.pseudo || 'Mon Héros';
  document.getElementById('topbar-level').textContent = 'Nv.'+p.niveau;
  document.getElementById('xp-fill').style.width = xpPct+'%';
  document.getElementById('xp-text').textContent = p.xp+' / '+xpMax;
  document.getElementById('pts-val').textContent = p.xp.toLocaleString('fr-FR');

  document.getElementById('hero-avatar-big').innerHTML = img;
  document.getElementById('hero-name').textContent = p.pseudo || 'Mon Héros';
  document.getElementById('hero-class').textContent = cl.icon+' '+cl.label;
  document.getElementById('hero-level-badge').textContent = '🏆 Niveau '+p.niveau;

  document.getElementById('profile-avatar-big').innerHTML = img88;
  document.getElementById('profile-name').textContent = p.pseudo || 'Mon Héros';
  document.getElementById('profile-class').textContent = cl.icon+' '+cl.label+' · Niveau '+p.niveau;
  document.getElementById('profile-pts-badge').textContent = '💎 '+p.xp.toLocaleString('fr-FR')+' pts';
  document.getElementById('profile-xp').textContent = p.xp;
  document.getElementById('profile-pts').textContent = p.xp.toLocaleString('fr-FR');
  const since = new Date(p.dateInscription);
  document.getElementById('profile-since').textContent = since.toLocaleDateString('fr-FR',{month:'short',year:'numeric'});

  const ring = document.querySelector('.profile-avatar-ring');
  if (ring) ring.style.background = 'conic-gradient('+(p.color||'#00d4ff')+' '+xpPct+'%, #1c2d3e '+xpPct+'%)';

  document.getElementById('rank-my-avatar').innerHTML = img;
  document.getElementById('rank-my-name').textContent = (p.pseudo||'Mon Héros')+' (Moi)';
  document.getElementById('rank-my-pts').textContent = p.xp.toLocaleString('fr-FR')+' pts';

  renderBadges();
}

function renderBadges() {
  const defs = [
    {id:'first_avatar',icon:'🎭',label:'Identité', color:'var(--accent-primary)',   ok:function(){return !!PROFILE.pseudo;}},
    {id:'first_quiz',  icon:'🎯',label:'Précis',   color:'var(--accent-success)',   ok:function(){return false;}},
    {id:'first_signal',icon:'⚠️',label:'Vigilant', color:'var(--accent-secondary)', ok:function(){return false;}},
    {id:'level5',      icon:'⭐',label:'Niveau 5', color:'var(--accent-secondary)', ok:function(){return PROFILE.niveau>=5;}},
    {id:'guardian',    icon:'🛡️',label:'Gardien',  color:'var(--accent-primary)',   ok:function(){return PROFILE.niveau>=4;}},
  ];
  const unlocked = defs.filter(function(b){return b.ok();});
  document.getElementById('profile-badges-count').textContent = unlocked.length;
  document.getElementById('stat-badges').textContent = unlocked.length;
  document.getElementById('badges-collection').innerHTML = defs.map(function(b){
    const u = b.ok();
    return '<div style="text-align:center;flex:0 0 60px;'+(u?'':'opacity:0.2;')+'">'
      +'<div style="font-size:32px;filter:drop-shadow(0 0 6px '+(u?b.color:'transparent')+')">'+(u?b.icon:'🔒')+'</div>'
      +'<div style="font-size:9px;color:'+(u?b.color:'var(--text-muted)')+';margin-top:3px;">'+b.label+'</div></div>';
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

/* ── XP POPUP ───────────────────────────────────────── */
function showXpPopup(xp, titre) {
  const p = document.getElementById('xp-popup');
  p.querySelector('.xp-popup-val').textContent = '+'+xp+' XP';
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
window.addEventListener('load', function() {
  refreshUI();
  setTimeout(function(){
    const xpMax = xpForNextLevel(PROFILE.niveau);
    const xpPct = Math.min(100, Math.round((PROFILE.xp/xpMax)*100));
    const fill = document.getElementById('xp-fill');
    if(fill) fill.style.width = xpPct+'%';
  },300);
  if (!PROFILE.pseudo) setTimeout(openAvatarCreator, 600);
  const frame = document.getElementById('avatar-preview-frame');
  if (frame) frame.addEventListener('click', function(){
    const imgEl = document.getElementById('avatar-preview-img');
    if(imgEl){ imgEl.style.transform='scale(1.15) translateY(-4px)'; setTimeout(function(){imgEl.style.transform='';},250); }
  });
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
