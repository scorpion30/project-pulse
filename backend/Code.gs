/**
 * Project Pulse backend — Google Apps Script bound to the "Project Pulse Database" sheet.
 * Every request: POST text/plain JSON {action, token, ...}. Every reply: JSON {ok, ...} or {ok:false, error}.
 * Team isolation is enforced here: each action checks the caller's membership before reading or writing.
 */

const SCHEMA = {
  Users:      ['id','name','email','passHash','salt','createdAt'],
  Sessions:   ['token','userId','createdAt','expiresAt'],
  Teams:      ['id','name','createdBy','createdAt','logo'],
  Members:    ['teamId','userId','role','color','joinedAt'],
  Invites:    ['code','teamId','role','createdBy','createdAt','usedBy'],
  Projects:   ['id','teamId','name','createdBy','createdAt'],
  Tasks:      ['id','projectId','title','to','by','at','due','about','ms','deliv','status','seenAt','stuckOn','stuckNote','doneAt','kudos','dueAt','startedAt'],
  Updates:    ['id','projectId','by','at','about','text','pinned','seenBy'],
  Milestones: ['id','projectId','name','date','items'],
  Log:        ['at','projectId','who','txt']
};
const DATE_FIELDS = {due:1, date:1};
const COLORS = ['#e0478a','#0f9d8c','#f08a1c','#6b4fd8','#2f6fe0','#c2410c','#0e7490','#be123c','#15803d','#a16207'];
const SESSION_DAYS = 30;

/* ---------- setup (run once from the editor) ---------- */
function setup() {
  const ss = db_();
  Object.keys(SCHEMA).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const h = SCHEMA[name];
    sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#141b2b').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), h.length).setNumberFormat('@');
  });
  const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Feuille 1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  ['Users','Sessions'].forEach(n => ss.getSheetByName(n).protect().setWarningOnly(true));
  return 'Project Pulse database is ready';
}

/* ---------- table helpers ---------- */
const SHEET_ID = "1Yj9SwPMkka0uk-SWWnuzB6Hozl-oKWopIDiojTJgZqc";
let ss_ = null;
function db_() { return ss_ || (ss_ = SpreadsheetApp.openById(SHEET_ID)); }
function sheet_(name) { return db_().getSheetByName(name); }
function rows_(name) {
  const sh = sheet_(name), last = sh.getLastRow();
  if (last < 2) return [];
  const h = SCHEMA[name], v = sh.getRange(2, 1, last - 1, h.length).getValues(), tz = Session.getScriptTimeZone();
  return v.map((r, i) => {
    const o = {_row: i + 2};
    h.forEach((k, j) => {
      let x = r[j];
      if (x instanceof Date) x = DATE_FIELDS[k] ? Utilities.formatDate(x, tz, 'yyyy-MM-dd') : x.getTime();
      o[k] = x;
    });
    return o;
  });
}
function cell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v; // no formulas from user text
  return v;
}
function insert_(name, obj) {
  const h = SCHEMA[name], sh = sheet_(name), row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, h.length).setNumberFormat('@').setValues([h.map(k => cell_(obj[k]))]);
  return obj;
}
function save_(name, obj) {
  const h = SCHEMA[name];
  sheet_(name).getRange(obj._row, 1, 1, h.length).setNumberFormat('@').setValues([h.map(k => cell_(obj[k]))]);
}
function remove_(name, obj) { sheet_(name).deleteRow(obj._row); }
function strip_(o) { const c = Object.assign({}, o); delete c._row; return c; }
function id_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 10); }
function now_() { return Date.now(); }
function dueAt_(v) { const n = Number(v); return n > 1e12 && n < 1e13 ? Math.round(n) : ''; }
function headers_(name) { const sh = sheet_(name), h = SCHEMA[name]; if (sh.getLastColumn() < h.length) sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#141b2b').setFontColor('#ffffff'); }
function num_(v) { return v === '' || v === null || v === undefined ? null : Number(v); }
function list_(v) { return String(v || '').split(',').map(s => s.trim()).filter(Boolean); }

/* ---------- passwords & sessions ---------- */
function hash_(pw, salt) {
  let h = salt + '|' + pw;
  for (let i = 0; i < 2000; i++) {
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt, Utilities.Charset.UTF_8));
  }
  return h;
}
function newSession_(userId) {
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  insert_('Sessions', {token, userId, createdAt: now_(), expiresAt: now_() + SESSION_DAYS * 864e5});
  return token;
}
function auth_(token) {
  if (!token) throw new Error('Please sign in');
  const s = rows_('Sessions').find(x => x.token === token);
  if (!s || Number(s.expiresAt) < now_()) throw new Error('Your session ended. Please sign in again');
  const u = rows_('Users').find(x => x.id === s.userId);
  if (!u) throw new Error('Account not found');
  return u;
}
function member_(userId, teamId) {
  const m = rows_('Members').find(x => x.teamId === teamId && x.userId === userId);
  if (!m) throw new Error('You are not on this team');
  return m;
}
function project_(user, projectId) {
  const p = rows_('Projects').find(x => x.id === projectId);
  if (!p) throw new Error('Project not found');
  const m = member_(user.id, p.teamId);
  return {p, m, mgr: m.role === 'mgr'};
}
function needMgr_(ctx) { if (!ctx.mgr) throw new Error('Only managers can do this'); }
function log_(projectId, who, txt) { insert_('Log', {at: now_(), projectId, who, txt: String(txt).slice(0, 500)}); }
function clean_(s, max) { return String(s || '').trim().slice(0, max || 500); }

/* ---------- serializers ---------- */
function taskOut_(t) {
  return {id: t.id, title: t.title, to: t.to, by: t.by, at: num_(t.at), due: t.due, about: t.about || '', ms: t.ms || '',
    deliv: String(t.deliv) === 'true', status: t.status, seenAt: num_(t.seenAt), stuckOn: t.stuckOn || '', stuckNote: t.stuckNote || '',
    doneAt: num_(t.doneAt), kudos: list_(t.kudos), dueAt: num_(t.dueAt), startedAt: num_(t.startedAt)};
}
function updOut_(u) { return {id: u.id, by: u.by, at: num_(u.at), about: u.about || '', text: u.text, pinned: String(u.pinned) === 'true', seenBy: list_(u.seenBy)}; }
function msOut_(m) { let items = []; try { items = JSON.parse(m.items || '[]'); } catch (e) {} return {id: m.id, name: m.name, date: m.date, items}; }

/* ---------- actions ---------- */
const ACTIONS = {
  signup(b) {
    const name = clean_(b.name, 60), email = clean_(b.email, 120).toLowerCase(), pw = String(b.password || '');
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Add your name and a valid email');
    if (pw.length < 8) throw new Error('Password needs at least 8 characters');
    if (rows_('Users').some(u => u.email === email)) throw new Error('This email already has an account. Sign in instead');
    let invite = null;
    if (b.invite) {
      invite = rows_('Invites').find(i => i.code === clean_(b.invite, 20).toUpperCase() && !i.usedBy);
      if (!invite) throw new Error('That invite code is not valid or was already used');
    } else if (!clean_(b.teamName, 80)) throw new Error('Type your team or company name, or use an invite code');
    const salt = Utilities.getUuid(), user = {id: id_(), name, email, salt, passHash: hash_(pw, salt), createdAt: now_()};
    insert_('Users', user);
    if (invite) {
      const n = rows_('Members').filter(m => m.teamId === invite.teamId).length;
      insert_('Members', {teamId: invite.teamId, userId: user.id, role: invite.role, color: COLORS[n % COLORS.length], joinedAt: now_()});
      invite.usedBy = user.id; save_('Invites', invite);
    } else {
      const team = {id: id_(), name: clean_(b.teamName, 80), createdBy: user.id, createdAt: now_()};
      insert_('Teams', team);
      insert_('Members', {teamId: team.id, userId: user.id, role: 'mgr', color: '#141b2b', joinedAt: now_()});
    }
    return {token: newSession_(user.id)};
  },
  login(b) {
    const email = clean_(b.email, 120).toLowerCase(), u = rows_('Users').find(x => x.email === email);
    if (!u || hash_(String(b.password || ''), u.salt) !== u.passHash) { Utilities.sleep(800); throw new Error('Email or password is wrong'); }
    return {token: newSession_(u.id)};
  },
  logout(b, user) {
    const s = rows_('Sessions').find(x => x.token === b.token);
    if (s) { s.expiresAt = 0; save_('Sessions', s); }
    return {};
  },
  joinTeam(b, user) {
    const invite = rows_('Invites').find(i => i.code === clean_(b.invite, 20).toUpperCase() && !i.usedBy);
    if (!invite) throw new Error('That invite code is not valid or was already used');
    if (rows_('Members').some(m => m.teamId === invite.teamId && m.userId === user.id)) throw new Error('You are already on this team');
    const n = rows_('Members').filter(m => m.teamId === invite.teamId).length;
    insert_('Members', {teamId: invite.teamId, userId: user.id, role: invite.role, color: COLORS[n % COLORS.length], joinedAt: now_()});
    invite.usedBy = user.id; save_('Invites', invite);
    return {teamId: invite.teamId};
  },
  me(b, user) {
    const mine = rows_('Members').filter(m => m.userId === user.id), teams = rows_('Teams');
    return {user: {id: user.id, name: user.name, email: user.email},
      teams: mine.map(m => { const t = teams.find(x => x.id === m.teamId) || {}; return {id: m.teamId, name: t.name, role: m.role}; })};
  },
  load(b, user) {
    const teamId = b.teamId, me = member_(user.id, teamId);
    const users = rows_('Users'), team = rows_('Teams').find(t => t.id === teamId);
    const members = rows_('Members').filter(m => m.teamId === teamId).map(m => {
      const u = users.find(x => x.id === m.userId) || {}; return {id: m.userId, name: u.name || 'Someone', mgr: m.role === 'mgr', color: m.color};
    });
    const projects = rows_('Projects').filter(p => p.teamId === teamId).map(p => ({id: p.id, name: p.name}));
    const out = {team: {id: teamId, name: team ? team.name : '', logo: team ? String(team.logo || '') : ''}, role: me.role, members, projects, invites: []};
    if (me.role === 'mgr') out.invites = rows_('Invites').filter(i => i.teamId === teamId && !i.usedBy).map(i => ({code: i.code, role: i.role}));
    const pid = projects.some(p => p.id === b.projectId) ? b.projectId : (projects[0] || {}).id;
    out.projectId = pid || null;
    if (pid) {
      out.tasks = rows_('Tasks').filter(t => t.projectId === pid).map(taskOut_);
      out.updates = rows_('Updates').filter(u => u.projectId === pid).map(updOut_);
      out.milestones = rows_('Milestones').filter(m => m.projectId === pid).map(msOut_);
      out.log = rows_('Log').filter(l => l.projectId === pid).slice(-400).map(l => ({at: num_(l.at), who: l.who, txt: l.txt}));
    }
    return out;
  },
  createProject(b, user) {
    const me = member_(user.id, b.teamId); if (me.role !== 'mgr') throw new Error('Only managers can create projects');
    const name = clean_(b.name, 100); if (!name) throw new Error('Give the project a name');
    const p = insert_('Projects', {id: id_(), teamId: b.teamId, name, createdBy: user.id, createdAt: now_()});
    log_(p.id, user.id, 'created the project ' + name);
    if (b.msName && b.msDate) insert_('Milestones', {id: id_(), projectId: p.id, name: clean_(b.msName, 100), date: clean_(b.msDate, 10), items: '[]'});
    return {projectId: p.id};
  },
  createTasks(b, user) {
    const ctx = project_(user, b.projectId); needMgr_(ctx);
    const team = rows_('Members').filter(m => m.teamId === ctx.p.teamId).map(m => m.userId);
    headers_('Tasks');
    const made = (b.tasks || []).slice(0, 50).map(x => {
      if (!team.includes(x.to)) throw new Error('That person is not on this team');
      const t = {id: id_(), projectId: b.projectId, title: clean_(x.title, 300), to: x.to, by: user.id, at: now_(), due: clean_(x.due, 10),
        about: clean_(x.about, 80), ms: clean_(x.ms, 20), deliv: !!x.deliv, status: 'new', seenAt: '', stuckOn: '', stuckNote: '', doneAt: '', kudos: '', dueAt: dueAt_(x.dueAt), startedAt: ''};
      insert_('Tasks', t); log_(b.projectId, user.id, x.logTxt || ('assigned “' + t.title + '”'));
      return taskOut_(t);
    });
    mailTasks_(user, ctx.p, made);
    return {tasks: made};
  },
  taskAction(b, user) {
    const t = rows_('Tasks').find(x => x.id === b.id); if (!t) throw new Error('Task not found');
    const ctx = project_(user, t.projectId), mine = t.to === user.id, a = b.do;
    if (['got','start','done','stuck','unstuck'].includes(a) && !mine) throw new Error('Only the person on this task can do that');
    if (['kudos','reopen'].includes(a)) needMgr_(ctx);
    if (a === 'got') { t.seenAt = now_(); if (t.status === 'new') { t.status = 'doing'; if (!t.startedAt) t.startedAt = now_(); } }
    if (a === 'start') { t.status = 'doing'; if (!t.seenAt) t.seenAt = now_(); if (!t.startedAt) t.startedAt = now_(); }
    if (a === 'done') { t.status = 'done'; t.doneAt = Math.min(Number(b.doneAt) || now_(), now_()); }
    if (a === 'stuck') { t.status = 'stuck'; t.stuckOn = clean_(b.stuckOn, 60); t.stuckNote = clean_(b.stuckNote, 200); }
    if (a === 'unstuck') t.status = 'doing';
    if (a === 'reopen') { t.status = 'doing'; t.doneAt = ''; }
    if (a === 'kudos') { const k = list_(t.kudos); if (!k.includes(user.id)) k.push(user.id); t.kudos = k.join(','); }
    if (a !== 'nudge') save_('Tasks', t);
    if (b.logTxt) log_(t.projectId, user.id, b.logTxt);
    return {task: taskOut_(t)};
  },
  postUpdate(b, user) {
    const ctx = project_(user, b.projectId);
    const text = clean_(b.text, 2000); if (!text) throw new Error('Write the update first');
    const u = insert_('Updates', {id: id_(), projectId: b.projectId, by: user.id, at: now_(), about: clean_(b.about, 80), text, pinned: false, seenBy: user.id});
    log_(b.projectId, user.id, 'posted an update: ' + text);
    return {update: updOut_(u)};
  },
  updateAction(b, user) {
    const u = rows_('Updates').find(x => x.id === b.id); if (!u) throw new Error('Update not found');
    const ctx = project_(user, u.projectId);
    if (b.do === 'seen') { const s = list_(u.seenBy); if (!s.includes(user.id)) s.push(user.id); u.seenBy = s.join(','); }
    if (b.do === 'pin') { needMgr_(ctx); u.pinned = String(u.pinned) !== 'true'; log_(u.projectId, user.id, (u.pinned ? 'pinned' : 'unpinned') + ' an update'); }
    save_('Updates', u);
    return {update: updOut_(u)};
  },
  saveMilestone(b, user) {
    const ctx = project_(user, b.projectId); needMgr_(ctx);
    const items = JSON.stringify((b.items || []).slice(0, 200).map(i => ({t: clean_(i.t, 200), ok: !!i.ok, g: clean_(i.g, 60), k: clean_(i.k, 20)})));
    let m = b.id ? rows_('Milestones').find(x => x.id === b.id && x.projectId === b.projectId) : null;
    if (m) { m.items = items; if (b.name) m.name = clean_(b.name, 100); if (b.date) m.date = clean_(b.date, 10); save_('Milestones', m); }
    else { m = insert_('Milestones', {id: id_(), projectId: b.projectId, name: clean_(b.name, 100), date: clean_(b.date, 10), items}); }
    if (b.logTxt) log_(b.projectId, user.id, b.logTxt);
    return {milestone: msOut_(m)};
  },
  setRole(b, user) {
    const me = member_(user.id, b.teamId); if (me.role !== 'mgr') throw new Error('Only managers can change roles');
    const all = rows_('Members').filter(m => m.teamId === b.teamId), m = all.find(x => x.userId === b.userId);
    if (!m) throw new Error('Person not found');
    const role = b.role === 'mgr' ? 'mgr' : 'team';
    if (role === 'team' && m.role === 'mgr' && all.filter(x => x.role === 'mgr').length === 1) throw new Error('The team needs at least one manager');
    m.role = role; save_('Members', m);
    return {};
  },
  createInvite(b, user) {
    const me = member_(user.id, b.teamId); if (me.role !== 'mgr') throw new Error('Only managers can invite people');
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let code = '';
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    insert_('Invites', {code, teamId: b.teamId, role: b.role === 'mgr' ? 'mgr' : 'team', createdBy: user.id, createdAt: now_(), usedBy: ''});
    return {code};
  },
  editMe(b, user) {
    const name = clean_(b.name, 60); if (!name) throw new Error('Type your name');
    const u = rows_('Users').find(x => x.id === user.id); u.name = name; save_('Users', u);
    return {name};
  },
  editTeam(b, user) {
    const me = member_(user.id, b.teamId); if (me.role !== 'mgr') throw new Error('Only managers can change team settings');
    const t = rows_('Teams').find(x => x.id === b.teamId);
    if (b.name !== undefined) { const n = clean_(b.name, 80); if (!n) throw new Error('Type the team name'); t.name = n; }
    if (b.logo !== undefined) {
      const logo = String(b.logo || '');
      if (logo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo)) throw new Error('Logo must be a PNG or JPG image');
      if (logo.length > 48000) throw new Error('Logo is too big. Try a smaller image');
      t.logo = logo;
    }
    save_('Teams', t);
    return {team: {id: t.id, name: t.name, logo: String(t.logo || '')}};
  },
  renameProject(b, user) {
    const ctx = project_(user, b.projectId); needMgr_(ctx);
    const name = clean_(b.name, 100); if (!name) throw new Error('Give the project a name');
    const old = ctx.p.name; ctx.p.name = name; save_('Projects', ctx.p);
    log_(ctx.p.id, user.id, 'renamed the project from “' + old + '” to “' + name + '”');
    return {};
  },
  editTask(b, user) {
    const t = rows_('Tasks').find(x => x.id === b.id); if (!t) throw new Error('Task not found');
    const ctx = project_(user, t.projectId); needMgr_(ctx);
    const team = rows_('Members').filter(m => m.teamId === ctx.p.teamId).map(m => m.userId);
    if (b.to !== undefined && !team.includes(b.to)) throw new Error('That person is not on this team');
    const changes = [];
    [['title', 300], ['to', 20], ['due', 10], ['about', 80], ['ms', 20]].forEach(([k, max]) => {
      if (b[k] === undefined) return;
      const v = clean_(b[k], max); if (k === 'title' && !v) throw new Error('The task needs a title');
      if (String(t[k] || '') !== v) { changes.push(k); t[k] = v; }
    });
    if (b.dueAt !== undefined) { const v = dueAt_(b.dueAt); if (String(t.dueAt || '') !== String(v)) { changes.push('dueAt'); t.dueAt = v; } }
    if (b.deliv !== undefined) t.deliv = !!b.deliv;
    if (changes.includes('to')) { t.seenAt = ''; t.startedAt = ''; if (t.status === 'stuck') t.status = 'doing'; }
    save_('Tasks', t);
    if (b.logTxt && changes.length) log_(t.projectId, user.id, b.logTxt);
    return {task: taskOut_(t)};
  },
  deleteTask(b, user) {
    const t = rows_('Tasks').find(x => x.id === b.id); if (!t) throw new Error('Task not found');
    const ctx = project_(user, t.projectId); needMgr_(ctx);
    remove_('Tasks', t); log_(t.projectId, user.id, 'deleted the task “' + t.title + '”');
    return {};
  },
  editUpdate(b, user) {
    const u = rows_('Updates').find(x => x.id === b.id); if (!u) throw new Error('Update not found');
    const ctx = project_(user, u.projectId); if (u.by !== user.id) needMgr_(ctx);
    const text = clean_(b.text, 2000); if (!text) throw new Error('The update cannot be empty');
    const old = u.text; u.text = text; u.about = clean_(b.about, 80); save_('Updates', u);
    log_(u.projectId, user.id, 'edited an update: “' + String(old).slice(0, 120) + '” → “' + text.slice(0, 200) + '”');
    return {update: updOut_(u)};
  },
  deleteUpdate(b, user) {
    const u = rows_('Updates').find(x => x.id === b.id); if (!u) throw new Error('Update not found');
    const ctx = project_(user, u.projectId); if (u.by !== user.id) needMgr_(ctx);
    remove_('Updates', u); log_(u.projectId, user.id, 'deleted an update: “' + String(u.text).slice(0, 200) + '”');
    return {};
  },
  deleteMilestone(b, user) {
    const m = rows_('Milestones').find(x => x.id === b.id); if (!m) throw new Error('Delivery not found');
    const ctx = project_(user, m.projectId); needMgr_(ctx);
    rows_('Tasks').filter(t => t.ms === m.id).forEach(t => { t.ms = ''; save_('Tasks', t); });
    remove_('Milestones', m); log_(m.projectId, user.id, 'removed the delivery ' + m.name + ' (' + m.date + ')');
    return {};
  },
  report(b, user) {
    const me = member_(user.id, b.teamId);
    const projects = rows_('Projects').filter(p => p.teamId === b.teamId);
    const ids = b.projectId ? projects.filter(p => p.id === b.projectId).map(p => p.id) : projects.map(p => p.id);
    if (b.projectId && !ids.length) throw new Error('Project not found');
    const from = Number(b.from) || 0, to = Number(b.to) || now_();
    const inRange = x => { const t = num_(x); return t !== null && t >= from && t <= to; };
    const log = rows_('Log').filter(l => ids.includes(l.projectId) && inRange(l.at)).map(l => ({at: num_(l.at), projectId: l.projectId, who: l.who, txt: l.txt}));
    const tasks = rows_('Tasks').filter(t => ids.includes(t.projectId)).map(t => Object.assign(taskOut_(t), {projectId: t.projectId}));
    const updates = rows_('Updates').filter(u => ids.includes(u.projectId) && inRange(u.at)).map(u => Object.assign(updOut_(u), {projectId: u.projectId}));
    const milestones = rows_('Milestones').filter(m => ids.includes(m.projectId)).map(m => Object.assign(msOut_(m), {projectId: m.projectId}));
    return {log, tasks, updates, milestones, projects: projects.filter(p => ids.includes(p.id)).map(p => ({id: p.id, name: p.name}))};
  }
};
const PUBLIC = {signup: 1, login: 1};
const WRITES = {signup:1, login:1, logout:1, joinTeam:1, createProject:1, createTasks:1, taskAction:1, postUpdate:1, updateAction:1, saveMilestone:1, setRole:1, createInvite:1, editMe:1, editTeam:1, renameProject:1, editTask:1, deleteTask:1, editUpdate:1, deleteUpdate:1, deleteMilestone:1};

/* ---------- web entry points ---------- */
function doPost(e) {
  let out;
  try {
    const b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = ACTIONS[b.action];
    if (!fn) throw new Error('Unknown action');
    const run = () => { const user = PUBLIC[b.action] ? null : auth_(b.token); return fn(b, user); };
    if (WRITES[b.action]) {
      const lock = LockService.getScriptLock(); lock.waitLock(20000);
      try { out = Object.assign({ok: true}, run()); } finally { lock.releaseLock(); }
    } else out = Object.assign({ok: true}, run());
  } catch (err) {
    out = {ok: false, error: String(err && err.message || err)};
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ok: true, app: 'Project Pulse API'})).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- email alert when someone gets a task ---------- */
const SITE_URL = 'https://scorpion30.github.io/project-pulse/';
function esc_(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c])); }
function mailTasks_(by, project, tasks) {
  try {
    const users = rows_('Users'), groups = {};
    tasks.forEach(t => { if (t.to !== by.id) (groups[t.to] = groups[t.to] || []).push(t); });
    Object.keys(groups).forEach(uid => {
      const u = users.find(x => x.id === uid);
      if (!u || !u.email || /@test\.local$/i.test(u.email) || MailApp.getRemainingDailyQuota() < 1) return;
      const list = groups[uid], tz = Session.getScriptTimeZone();
      const due = t => t.dueAt ? Utilities.formatDate(new Date(t.dueAt), tz, 'EEE d MMM, HH:mm') : t.due ? Utilities.formatDate(new Date(t.due + 'T12:00:00'), tz, 'EEE d MMM') : 'no date';
      const subject = list.length > 1 ? by.name + ' gave you ' + list.length + ' new tasks · ' + project.name : 'New task from ' + by.name + ': ' + list[0].title;
      const rows = list.map(t => '<tr><td style="padding:8px 10px;border-bottom:1px solid #eee"><b>' + esc_(t.title) + '</b>' + (t.about ? '<br><span style="color:#6b7280;font-size:12px">' + esc_(t.about) + '</span>' : '') +
        '</td><td style="padding:8px 10px;border-bottom:1px solid #eee;color:#b42318;white-space:nowrap">' + esc_(due(t)) + '</td></tr>').join('');
      const html = '<div style="font-family:Arial,sans-serif;max-width:560px;color:#141b2b"><div style="font-size:13px;color:#6b7280">Project Pulse · ' + esc_(project.name) + '</div>' +
        '<h2 style="margin:6px 0 12px">' + esc_(by.name) + ' gave you ' + (list.length > 1 ? list.length + ' new tasks' : 'a new task') + '</h2>' +
        '<table style="border-collapse:collapse;width:100%;font-size:14px"><tr><th align="left" style="padding:6px 10px;background:#141b2b;color:#fff">Task</th><th align="left" style="padding:6px 10px;background:#141b2b;color:#fff">Due</th></tr>' + rows + '</table>' +
        '<p style="margin:18px 0"><a href="' + SITE_URL + '" style="background:#ff5a36;color:#fff;padding:10px 18px;border-radius:99px;text-decoration:none;font-weight:bold">Open Project Pulse and tap Got it</a></p>' +
        '<p style="font-size:12px;color:#9ca3af">You get this email because you are on the ' + esc_(project.name) + ' team in Project Pulse.</p></div>';
      MailApp.sendEmail({to: u.email, subject: subject, htmlBody: html, name: 'Project Pulse'});
    });
  } catch (e) { console.log('mail failed: ' + e); }
}
function authorizeMail() { return 'Mail quota left today: ' + MailApp.getRemainingDailyQuota(); }
