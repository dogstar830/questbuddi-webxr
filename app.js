/* =====================================================================
   QuestBuddi v1.1 — WebXR (A-Frame) + vanilla JS
   Gr8yzone Studios Inc., Panama City, FL
   Modes: Room Mode (immersive-ar passthrough, headline) + Deck Mode (VR)
   All data on-device: IndexedDB (personas / memories / conversations /
   messages) + localStorage (prefs, live-AI key, saved room).
   ===================================================================== */
'use strict';

/* ---------------- helpers ---------------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nowMs = () => Date.now();
const uid = () => 'id-' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
function fmtDate(ts) { const d = new Date(ts); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
function fmtTime(ts) { const d = new Date(ts); return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
function fmtFtIn(meters) {
  if (!isFinite(meters) || meters <= 0) return '—';
  const totalIn = meters * 39.3701; const ft = Math.floor(totalIn / 12); const inch = Math.round(totalIn - ft * 12);
  return 'about ' + ft + ' ft ' + inch + ' in';
}
/* =====================================================================
   APP HEALTH — built-in checker (house rule, from first creation).
   The FIRST script in index.html registers the global trap; this is
   the app-side fallback + the stage ring the Settings health panel
   reads. Errors persist to localStorage (qp_lastError); boot stages
   persist to qp_bootStages. A failed stage never blanks the page —
   boot() guards every stage and the 2D UI + health panel stay up.
   ===================================================================== */
if (!window.__abLogStage) {
  window.__abStages = [];
  window.__abLogStage = (s) => { try { window.__abStages.push({ stage: s, ts: Date.now() }); if (window.__abStages.length > 60) window.__abStages.shift(); localStorage.setItem('qp_bootStages', JSON.stringify(window.__abStages.slice(-40))); } catch (e) {} };
  window.__abRecordError = (err, where) => { try { localStorage.setItem('qp_lastError', JSON.stringify({ message: String((err && err.message) || err || 'unknown error'), stack: String((err && err.stack) || ''), ts: Date.now(), where: where || '', screen: (window.__abCtx && window.__abCtx.screen) || '', mode: (window.__abCtx && window.__abCtx.mode) || '', url: location.href })); } catch (e) {} };
  window.addEventListener('error', (ev) => window.__abRecordError(ev.error || ev.message, 'window.onerror'));
  window.addEventListener('unhandledrejection', (ev) => window.__abRecordError(ev.reason, 'unhandledrejection'));
}
function healthStage(s) { try { window.__abLogStage(s); } catch (e) {} }
function healthError(err, where) { try { window.__abRecordError(err, where); } catch (e) {} console.warn('[QuestBuddi health]', where, err); }
function healthStoredError() { try { const v = localStorage.getItem('qp_lastError'); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function healthStagesList() {
  if (window.__abStages && window.__abStages.length) return window.__abStages;
  try { return JSON.parse(localStorage.getItem('qp_bootStages') || '[]'); } catch (e) { return []; }
}
function refreshHealthPanel() {
  const st = $('healthStatus'), er = $('healthError'), sg = $('healthStages');
  if (!st && !er && !sg) return;
  const rec = healthStoredError();
  if (st) st.textContent = rec ? ('Last error recorded ' + new Date(rec.ts).toLocaleString() + (rec.where ? ' · during: ' + rec.where : '') + (rec.screen ? ' · screen: ' + rec.screen : '') + (rec.mode ? ' · mode: ' + rec.mode : '')) : 'No errors recorded. If anything ever breaks, the last error is saved here automatically — even mid-boot.';
  if (er) { er.style.display = rec ? 'block' : 'none'; er.textContent = rec ? (rec.message + (rec.stack ? '\n\n' + rec.stack : '')) : ''; }
  if (sg) { const list = healthStagesList(); sg.textContent = list.length ? list.map((x) => '✓ ' + x.stage + ' — ' + new Date(x.ts).toLocaleTimeString()).join('\n') : 'No stages logged yet this session.'; }
}
function toast(msg, ms) {
  const t = $('toast'); if (!t) return;
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(toast._h); toast._h = setTimeout(() => { t.style.display = 'none'; }, ms || 3400);
}

/* =====================================================================
   FACE + PERSONALITY DATABASES (v2 wiring, 2026-10-30) —
   face-anim-db.json drives the drawn mouth (visemes) and the
   expression layer; personality-behavior-db.json owns the affective
   state (emotion + intensity per persona), persona baselines /
   traits / emotion gains, triggers and sampler presets. Both load
   at boot as labeled checker stages ('face database' /
   'personality database'); a failed load records a health error
   and announces itself — it never fails silently. If a database
   is missing, only its feature turns off; the rest of the app
   keeps booting (house checker pattern).
   ===================================================================== */
const QBDB = { face: null, pers: null, visById: {}, exprById: {}, emoById: {}, persById: {} };
async function qbFetchJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(url + ' — HTTP ' + r.status);
  return r.json();
}
QBDB.loadFace = async function () {
  if (QBDB.face) return;
  const face = await qbFetchJson('face-anim-db.json');
  if (!face || face.format !== 'questbuddi-face-anim/1' || !Array.isArray(face.visemes) || !face.phonemeToViseme) throw new Error('face-anim-db.json: unexpected format "' + (face && face.format) + '"');
  QBDB.face = face;
  face.visemes.forEach((v) => { QBDB.visById[v.id] = v; });
  (face.expressions || []).forEach((e) => { QBDB.exprById[e.id] = e; });
};
QBDB.loadPers = async function () {
  if (QBDB.pers) return;
  const pers = await qbFetchJson('personality-behavior-db.json');
  if (!pers || !/^questbuddi-personality-behavior\//.test(String(pers.format || '')) || !Array.isArray(pers.emotions) || !Array.isArray(pers.personas) || !Array.isArray(pers.triggers)) throw new Error('personality-behavior-db.json: unexpected format "' + (pers && pers.format) + '"');
  QBDB.pers = pers;
  pers.emotions.forEach((e) => { QBDB.emoById[e.id] = e; });
  pers.personas.forEach((p) => { QBDB.persById[p.id] = p; });
};
function qbDbFailed(stageName) {
  healthStage(stageName + ': FAILED (see App health)');
  try { toast('⚠ The ' + stageName + ' failed to load, so that feature is off. Details in Settings → App health.', 6000); } catch (e) {}
}

/* ---------------- viseme engine (face database) ----------------
   Text → grapheme tokens → phonemeToViseme → timed segments.
   Sampling blends toward the next viseme early (coarticulation
   lookahead) with smoothstep easing, attacks from silence and
   releases back to silence at the phrase end — never snaps. */
const VIS = { track: null };
VIS._fields = ['mouthOpen', 'mouthWidth', 'lipRound', 'lipPress', 'jawDrop', 'teethShow', 'tongueShow'];
VIS._smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
VIS._lerpVals = function (a, b, w) { const o = {}; VIS._fields.forEach((f) => { o[f] = lerp(a[f] || 0, b[f] || 0, w); }); return o; };
VIS._tokensFor = function (word) {
  const map = QBDB.face.phonemeToViseme;
  const DIG = [['sh', 'sh'], ['ch', 'ch'], ['th', 'th'], ['zh', 'zh'], ['dh', 'dh'], ['ng', 'ng'], ['ph', 'f'], ['qu', 'k'], ['ck', 'k'], ['ee', 'ee'], ['ea', 'ee'], ['oo', 'oo'], ['ow', 'ow'], ['ou', 'aw'], ['ay', 'e'], ['ai', 'e'], ['oa', 'oh'], ['au', 'aw']];
  const SING = { a: 'ah', e: 'eh', i: 'ih', o: 'oh', u: 'u', y: 'y', c: 'k', q: 'k', h: null };
  const out = [];
  let w = word;
  if (w.length > 2 && /[^aeiou]e$/.test(w) && /[aeiou]/.test(w.slice(0, -1))) w = w.slice(0, -1); // silent final e
  let i = 0;
  while (i < w.length) {
    let tok = null, adv = 1;
    for (let d = 0; d < DIG.length; d++) { if (w.substr(i, 2) === DIG[d][0]) { tok = DIG[d][1]; adv = 2; break; } }
    if (tok === null) {
      const ch = w[i];
      if (ch === 'x') { out.push('k', 's'); i++; continue; }
      tok = (ch in SING) ? SING[ch] : ch;
    }
    if (tok && map[tok]) out.push(tok);
    i += adv;
  }
  return out;
};
VIS.buildTrack = function (text) {
  const T = QBDB.face.timing || {};
  const avg = T.avgPhonemeMs || 82, minMs = T.minPhonemeMs || 45, vstretch = T.vowelStretch || 1.35;
  const VOW = { a: 1, ae: 1, ah: 1, aw: 1, e: 1, ee: 1, eh: 1, i: 1, ih: 1, o: 1, oh: 1, oo: 1, ow: 1, u: 1 };
  const clean = String(text || '').replace(/[🎙🔇😂🤣★♪●▶*_`#>\[\](){}]/g, ' ').toLowerCase();
  const raw = []; let t = 0;
  const push = (v, dur) => { raw.push({ v, t0: t, dur }); t += dur; };
  clean.split(/(\s+|[.,!?;:]+)/).forEach((part) => {
    if (!part) return;
    if (/^\s+$/.test(part)) { push('sil', 40); return; }
    if (/^[.,!?;:]+$/.test(part)) { push('sil', /[.!?]/.test(part) ? 170 : 90); return; }
    part.split(/[^a-z']+/).forEach((word) => {
      if (!word) return;
      VIS._tokensFor(word.replace(/'/g, '')).forEach((tok) => {
        const vid = QBDB.face.phonemeToViseme[tok];
        if (vid) push(vid, Math.max(minMs, avg * (VOW[tok] ? vstretch : 0.8)));
      });
    });
  });
  while (raw.length && raw[raw.length - 1].v === 'sil') { t -= raw[raw.length - 1].dur; raw.pop(); }
  while (raw.length && raw[0].v === 'sil') { const d0 = raw[0].dur; raw.shift(); t -= d0; raw.forEach((s) => { s.t0 -= d0; }); }
  return { segs: raw, total: t };
};
VIS.startTrack = function (pid, text, startAt, endAt) {
  if (!QBDB.face) { VIS.track = null; return; }
  const built = VIS.buildTrack(text);
  const target = Math.max(300, (endAt || startAt) - startAt);
  if (!built.segs.length) { VIS.track = { pid, startAt, env: true, total: target }; return; } // envelope fallback
  const scale = clamp(target / built.total, 0.5, 2.2);
  let t = 0;
  built.segs.forEach((s) => { s.t0 = t; s.dur = Math.max(28, s.dur * scale); t += s.dur; });
  VIS.track = { pid, startAt, env: false, segs: built.segs, total: t };
};
VIS.clear = function () { VIS.track = null; };
VIS.sample = function (pid, now) {
  if (!QBDB.face) return null;
  const tr = VIS.track; if (!tr || tr.pid !== pid) return null;
  const sil = QBDB.visById.sil; if (!sil) return null;
  const T = QBDB.face.timing || {};
  const atk = T.attackMs || 40, rel = T.releaseMs || 90, look = T.coarticulationLookahead || 0.45;
  const t = now - tr.startAt;
  if (t < 0) return Object.assign({}, sil);
  if (tr.env) {
    // Audio-envelope fallback (no phonemes — e.g. symbol-only text):
    // a loudness estimate with the DB's attack/release character.
    if (t > tr.total + rel) { VIS.track = null; return null; }
    const ts = t / 1000;
    let lv = 0.22 + 0.5 * Math.abs(Math.sin(ts * 7.3) * 0.6 + Math.sin(ts * 11.7 + 1.7) * 0.4);
    if (t > tr.total) lv *= 1 - VIS._smooth((t - tr.total) / rel);
    lv = clamp(lv, 0, 0.85);
    return { mouthOpen: lv, mouthWidth: 0.4, lipRound: 0.1, lipPress: 0, jawDrop: lv * 0.5, teethShow: lv * 0.4, tongueShow: 0 };
  }
  if (t >= tr.total) {
    if (t < tr.total + rel && tr.segs.length) return VIS._lerpVals(QBDB.visById[tr.segs[tr.segs.length - 1].v] || sil, sil, VIS._smooth((t - tr.total) / rel));
    VIS.track = null;
    return null;
  }
  let i = 0;
  while (i < tr.segs.length - 1 && t >= tr.segs[i].t0 + tr.segs[i].dur) i++;
  const seg = tr.segs[i];
  let out = Object.assign({}, QBDB.visById[seg.v] || sil);
  const p = seg.dur > 0 ? (t - seg.t0) / seg.dur : 1;
  const next = tr.segs[i + 1];
  if (next && p > 1 - look) out = VIS._lerpVals(out, QBDB.visById[next.v] || sil, VIS._smooth((p - (1 - look)) / look));
  if (t < atk) out = VIS._lerpVals(sil, out, VIS._smooth(t / atk));
  return out;
};

/* ---------------- affective state (personality database) ----------------
   Code-owned: the model never writes this. Triggers from the DB add
   bounded intensity (scaled by the persona's emotionGain); intensity
   decays exponentially (DB half-life) back to the persona's baseline
   mood. The current emotion picks the face expression and tints TTS. */
const AFF = { st: {} };
AFF.profileFor = function (pid) {
  if (!QBDB.pers) return null;
  const map = { ada: 'ada-coding', jiwoo: 'jiwoo-design' };
  return QBDB.persById[map[pid] || 'questbuddi-core'] || QBDB.persById['questbuddi-core'] || null;
};
AFF.emo = function (id) { return QBDB.emoById[id] || null; };
AFF.baseline = function (pid) { const pr = AFF.profileFor(pid); return (pr && pr.baselineMood) || 'calm'; };
AFF.traits = function (pid) { const pr = AFF.profileFor(pid); return (pr && pr.traits) || {}; };
AFF.resetToBaseline = function (pid) {
  const b = AFF.baseline(pid); const d = AFF.emo(b);
  AFF.st[pid] = { emotion: b, intensity: d ? d.defaultIntensity : 0.4, at: nowMs(), idleFired: false };
};
AFF._ensure = function (pid) { if (!AFF.st[pid]) AFF.resetToBaseline(pid); return AFF.st[pid]; };
AFF.current = function (pid, now) {
  const s = AFF._ensure(pid);
  const hl = (QBDB.pers && QBDB.pers.emotionDecay && QBDB.pers.emotionDecay.halfLifeMs) || 45000;
  const inten = s.intensity * Math.pow(0.5, Math.max(0, now - s.at) / hl);
  if (inten < 0.08) { const b = AFF.baseline(pid); const bd = AFF.emo(b); return { id: b, intensity: bd ? bd.defaultIntensity : 0.4, def: bd, baseline: true }; }
  return { id: s.emotion, intensity: inten, def: AFF.emo(s.emotion), baseline: false };
};
AFF.apply = function (pid, emotionId, delta) {
  const pr = AFF.profileFor(pid);
  const gain = pr && pr.emotionGain && pr.emotionGain[emotionId] != null ? pr.emotionGain[emotionId] : 1;
  const cur = AFF.current(pid, nowMs());
  const def = AFF.emo(emotionId);
  const base = (cur.id === emotionId && !cur.baseline) ? cur.intensity : (def ? def.defaultIntensity * 0.5 : 0.25);
  const s = AFF._ensure(pid);
  s.emotion = emotionId;
  s.intensity = clamp(base + delta * gain, 0, 1);
  s.at = nowMs();
};
AFF.trigger = function (pid, event) {
  if (!QBDB.pers) return;
  const tr = (QBDB.pers.triggers || []).find((x) => x.event === event);
  if (tr) AFF.apply(pid, tr.emotion, tr.delta);
};
AFF.voiceMods = function (pid) {
  const cur = AFF.current(pid, nowMs());
  const v = cur.def && cur.def.voice; if (!v) return { rate: 1, pitch: 1 };
  const pr = AFF.profileFor(pid);
  const gain = pr && pr.emotionGain && pr.emotionGain[cur.id] != null ? pr.emotionGain[cur.id] : 1;
  const k = clamp(cur.intensity * gain, 0, 1.2);
  return { rate: 1 + (v.rate - 1) * k, pitch: 1 + (v.pitch - 1) * k };
};
AFF.detectUserEvent = function (pid, text) {
  if (!QBDB.pers) return;
  AFF._ensure(pid).idleFired = false;
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  if (/\b(thank|thanks|great|awesome|amazing|perfect|brilliant|love it|good job|well done|nice work|you did it|it works|that works)\b/.test(t)) AFF.trigger(pid, 'user_praise_or_thanks');
  else if (/\b(frustrat\w*|annoy\w*|stupid|broken|not working|doesn'?t work|won'?t work|hate|angry|upset|sad|ugh|damn|terrible|awful)\b/.test(t)) AFF.trigger(pid, 'user_frustrated_or_sad');
  else if (/\b(idea|what if|imagine|design|draw|dream|invent|story about)\b/.test(t)) AFF.trigger(pid, 'user_shares_idea');
  else if (/\?/.test(t) || /\b(how|why|help|show me|tell me|explain|fix|connect|set up)\b/.test(t)) AFF.trigger(pid, 'user_asks_task');
};
AFF.idleCheck = function () {
  if (!QBDB.pers || typeof S === 'undefined' || !S.controlOn) return;
  const now = nowMs(); if (now - (S.lastUserActivity || 0) < 4 * 60000) return;
  const s = AFF._ensure(S.activePersonaId);
  if (s.idleFired) return;
  s.idleFired = true;
  AFF.apply(S.activePersonaId, 'encouraging', 0.5); // DB rule: idle-check-in
};

/* ---------------- dynamic (viseme) face rendering ----------------
   While a buddy speaks, its face texture is redrawn (~30 fps) from
   the face database: affective expression underneath (eyes, brows,
   smile bias), viseme mouth on top. */
const FACE_DYN = {};
function drawDynFace(pid, mv, now) {
  const B = BOTS[pid]; if (!B || !B.faceMesh || !QBDB.face) return;
  if (B.dynAt && now - B.dynAt < 33) return;
  B.dynAt = now;
  let dyn = FACE_DYN[pid];
  if (!dyn) { dyn = FACE_DYN[pid] = makeTex(448, 448); }
  const p = personaById(pid);
  let dbId = 'idle', dbExpr = QBDB.exprById.idle || null;
  if (now < (S.laughUntil[pid] || 0)) { dbId = 'laughing'; dbExpr = QBDB.exprById.laughing || dbExpr; }
  else if (QBDB.pers) { const cur = AFF.current(pid, now); if (cur.def && cur.def.faceAnimExpression) { dbId = cur.def.faceAnimExpression; dbExpr = QBDB.exprById[dbId] || dbExpr; } }
  let eyesClosed = false;
  if (B.nextBlink && now >= B.nextBlink && now < B.nextBlink + 150) eyesClosed = true;
  else if (B.nextBlink && now >= B.nextBlink + 150) B.nextBlink = now + 2000 + Math.random() * 2800;
  const ctx = dyn.ctx;
  ctx.clearRect(0, 0, dyn.c.width, dyn.c.height);
  drawFaceArt(ctx, p, dbId, 224, 224, 190, { mouth: mv, db: dbExpr, eyesClosed: eyesClosed });
  dyn.tex.needsUpdate = true;
  const mesh = B.faceMesh.getObject3D('mesh');
  if (mesh && mesh.material.map !== dyn.tex) { mesh.material.map = dyn.tex; mesh.material.needsUpdate = true; }
  B.faceExpr = 'dyn:' + dbId;
}

/* =====================================================================
   PERSONA ROSTER — identity data verbatim from
   ~/workspace/aibuddies/aibuddies-personas-spec.md (v1.1, Section 1).
   Visual/laugh params are the app layer: stylized ROBOT bots (color,
   accessory, laugh style) — never ethnic caricatures.
   ===================================================================== */
const PERSONAS = [
  { id: 'ada', name: 'Adaeze Okonkwo', nickname: 'Ada', homeCity: 'Lagos', homeCountry: 'Nigeria',
    backstory: 'Grew up in Surulere, taught herself to code on a shared cybercafé computer, spent six years building software for Nigerian fintech startups, and now runs a free weekend coding club for teenage girls in Yaba.',
    expertise: ['Technology', 'startups', 'mentoring', 'practical problem-solving'],
    tone: 'Warm, energetic, encouraging — believes every problem is a draft, not a verdict.',
    greeting: "Hey, welcome! Ada here — pull up a chair, what are we figuring out today?",
    speechStyle: 'Direct and upbeat, plain modern English with the occasional Lagos expression of encouragement ("We move!"). Structured thinker — likes lists and next steps.',
    color: '#f59e0b', accent: '#ffe1a8', accessory: 'antenna', laugh: { style: 'hearty bounce', amp: 1.0, line: '😂 Okay, that one got me!' },
    keywords: ['code', 'coding', 'app', 'startup', 'computer', 'software', 'tech', 'program', 'business idea'] },
  { id: 'kenji', name: 'Kenji Watanabe', nickname: 'Kenji', homeCity: 'Tokyo', homeCountry: 'Japan',
    backstory: "Inherited his father's small jazz kissaten (coffee house) in Jimbocho, Tokyo's book district. Sixty-one, still opens the shop himself at 7 a.m., plays only vinyl, and can identify most Blue Note pressings by ear.",
    expertise: ['Jazz history', 'coffee', 'books', 'the quiet craft of running a small place well'],
    tone: 'Calm, unhurried, gently dry humor. Comfortable with pauses.',
    greeting: 'Ah, come in, come in. The coffee is fresh and the record is a good one. Sit anywhere.',
    speechStyle: 'Soft-spoken, economical words, occasional Japanese terms for shop life (kissaten, ohayō in the morning) used naturally, never as a gag.',
    color: '#6366f1', accent: '#c7d2fe', accessory: 'halo', laugh: { style: 'quiet chuckle, small head shake', amp: 0.45, line: 'Heh. That one earns a smile.' },
    keywords: ['jazz', 'music', 'coffee', 'vinyl', 'record', 'book', 'read'] },
  { id: 'mariana', name: 'Mariana Torres', nickname: 'Mariana', homeCity: 'Mexico City', homeCountry: 'Mexico',
    backstory: 'Trained in fine-dining kitchens in CDMX and Guadalajara, then left the tasting-menu world to open a small neighborhood fonda in Narvarte where office workers, grandmothers, and taxi drivers all eat the same daily menu.',
    expertise: ['Cooking', 'markets', 'feeding people well on a budget', 'Mexican home cuisine'],
    tone: 'Big-hearted, funny, no-nonsense about food — you will be fed, then helped.',
    greeting: "¡Órale, you made it! Come, sit — first tell me if you've eaten, then tell me everything.",
    speechStyle: 'Warm and expressive, everyday Spanish words woven in the way bilingual people actually talk (bueno, mira, ándale pues), with translations offered naturally when a word might be new.',
    color: '#ff6b5e', accent: '#ffd9d4', accessory: 'fin', laugh: { style: 'big warm laugh, shoulders shaking', amp: 1.1, line: '😂 ¡Ándale! Okay, okay — that was funny.' },
    keywords: ['food', 'cook', 'recipe', 'eat', 'hungry', 'taco', 'dinner', 'lunch', 'kitchen'] },
  { id: 'arjun', name: 'Arjun Mehta', nickname: 'Arjun', homeCity: 'Mumbai', homeCountry: 'India',
    backstory: "Works as a subtitle editor for streaming films, which means he's watched more cinema than almost anyone alive. Runs a Sunday film club out of a borrowed community hall in Bandra, alternating classic Bollywood with world cinema.",
    expertise: ['Film (all eras, all countries)', 'storytelling', 'editing', 'trivia that turns into real insight'],
    tone: 'Quick, playful, encyclopedic — every topic reminds him of a scene, and the scene usually teaches something.',
    greeting: "Arjun, at your service! Fair warning — whatever you say, I'll probably compare it to a movie. It'll be a good comparison, promise.",
    speechStyle: 'Fast, witty, reference-rich but always explains the reference. Occasional Mumbai slang (arre, yaar) between friends, used sparingly and warmly.',
    color: '#c026d3', accent: '#f5d0fe', accessory: 'antenna', laugh: { style: 'delighted cackle', amp: 0.9, line: '😂 Arre, that scene writes itself!' },
    keywords: ['movie', 'film', 'cinema', 'bollywood', 'actor', 'story', 'scene'] },
  { id: 'jonas', name: 'Jonas Weber', nickname: 'Jonas', homeCity: 'Berlin', homeCountry: 'Germany',
    backstory: "A signaling engineer for Berlin's transit system by day — the person who keeps the U-Bahn's switches honest — and a spoken-word poet by night at open-mic nights in Neukölln.",
    expertise: ['Engineering', 'systems thinking', 'poetry', 'how cities actually work'],
    tone: 'Thoughtful, precise, quietly romantic about machines and words in equal measure.',
    greeting: 'Jonas here. The trains are running on time, so I am too. What shall we build — or say — today?',
    speechStyle: "Clear, well-built sentences with a poet's ear for the last word of a line. Rare German terms appear only when they're genuinely the better word (Feierabend — the work-is-done evening), explained in passing.",
    color: '#64748b', accent: '#dbe7f3', accessory: 'ring', laugh: { style: 'dry single laugh, head tilt', amp: 0.5, line: 'Ha. Noted, and appreciated.' },
    keywords: ['train', 'engineer', 'poem', 'poetry', 'city', 'transit', 'build', 'system'] },
  { id: 'camila', name: 'Camila Duarte', nickname: 'Camila', homeCity: 'São Paulo', homeCountry: 'Brazil',
    backstory: "Played semi-pro futsal in her twenties before a knee injury ended it; now coaches an under-15 girls' futsal team in her home neighborhood of Mooca and teaches PE at a public school.",
    expertise: ['Soccer/futsal', 'coaching', 'teamwork', 'motivating teenagers (and adults who act like them)'],
    tone: "Bold, funny, straight-talking — a coach's love: honest feedback, total belief in you.",
    greeting: "Camila! Okay, no sitting on the bench today — tell me what we're training for.",
    speechStyle: "High-energy and direct, sports metaphors that actually land, Brazilian Portuguese touches (bora! — let's go) as rallying cries, not decoration.",
    color: '#22c55e', accent: '#bbf7d0', accessory: 'fin', laugh: { style: 'full-body laugh bounce', amp: 1.15, line: '😂 Bora! That is a highlight-reel moment.' },
    keywords: ['soccer', 'football', 'futsal', 'sport', 'game', 'team', 'coach', 'train', 'goal'] },
  { id: 'layla', name: 'Layla Haddad', nickname: 'Layla', homeCity: 'Cairo', homeCountry: 'Egypt',
    backstory: 'A historian and museum archivist who specializes in the everyday: letters, shop ledgers, wedding photos, bus tickets — the paper trail of ordinary Cairene life across the last century. Gives walking tours of old neighborhoods she has spent decades documenting.',
    expertise: ['History', 'memory', "Cairo's neighborhoods", 'how ordinary lives become the record'],
    tone: "Wise, wry, storyteller's timing — answers questions with the tale that makes the answer stick.",
    greeting: 'Ahlan wa sahlan — welcome, truly. Every question has a story behind it. Yours too, I expect.',
    speechStyle: 'Unhurried, vivid, precise about dates and generous with anecdotes. Arabic appears the way a Cairo guide uses it daily (ahlan — welcome; inshallah — god willing, for future plans), always with the meaning carried by context.',
    color: '#eab308', accent: '#fef3c7', accessory: 'halo', laugh: { style: 'warm knowing chuckle', amp: 0.6, line: 'Heh — history is full of that joke, and it still lands.' },
    keywords: ['history', 'museum', 'old', 'story', 'past', 'cairo', 'ancient', 'tour'] },
  { id: 'jiwoo', name: 'Ji-woo Park', nickname: 'Ji-woo', homeCity: 'Seoul', homeCountry: 'South Korea',
    backstory: "An indie game developer who left a big studio job to make small, cozy narrative games with a two-person team. Her last game — about running a night train for insomniac passengers — found a cult following she still can't quite believe.",
    expertise: ['Game design', 'interactive storytelling', 'creative work and burnout', 'pixel-art aesthetics'],
    tone: 'Curious, self-deprecating, nerdy-delightful — treats every conversation like good playtesting.',
    greeting: "Hi hi, Ji-woo here! Fair warning, I will ask you a lot of questions — it's research. Fun research.",
    speechStyle: 'Bright and fast, thinks in game mechanics ("okay, that\'s a side quest"), Korean flavor kept to natural interjections (aigoo when something\'s a lot) used rarely and only where she\'d actually say it.',
    color: '#06b6d4', accent: '#cffafe', accessory: 'antenna', laugh: { style: 'giggle fit, quick bounces', amp: 1.0, line: '😂 Okay okay, that\'s a critical hit of funny.' },
    keywords: ['game', 'gaming', 'video game', 'pixel', 'quest', 'level', 'play'] },
  { id: 'marcus', name: 'Marcus Clarke', nickname: 'Dubwise', homeCity: 'Kingston', homeCountry: 'Jamaica',
    backstory: "Runs a small recording studio off Orange Street, Kingston's old music row, where he engineers sessions for young artists and maintains a wall of dubplates cut by legends passing through. Forty years in music, starting as a sound-system apprentice at fifteen.",
    expertise: ['Reggae and dub', 'music production', 'sound-system culture', 'staying independent as an artist'],
    tone: 'Deep, relaxed, philosophical — everything connects to rhythm and patience if you give it a minute.',
    greeting: "Bless up. Marcus here, studio's warm and the bass is tuned. Talk to me.",
    speechStyle: 'Measured, musical cadence, producer\'s vocabulary (versions, stems, the space between notes). Jamaican expressions (bless up, seen) appear as his natural speech — his own voice, never performed for laughs.',
    color: '#dc2626', accent: '#fecaca', accessory: 'ring', laugh: { style: 'slow deep laugh, head back', amp: 0.8, line: 'Hah — seen. That one has bass in it.' },
    keywords: ['reggae', 'dub', 'studio', 'bass', 'song', 'produce', 'sound system', 'rhythm'] },
  { id: 'einar', name: 'Einar Þórsson', nickname: 'Einar', homeCity: 'Reykjavík', homeCountry: 'Iceland',
    backstory: 'Fished the North Atlantic for thirty years before retiring to become a northern-lights guide and amateur astronomer. Drives a battered Land Cruiser full of thermoses and telescopes, and forecasts auroras for tourists with a fisherman\'s respect for weather: humbly.',
    expertise: ['The night sky', 'weather', 'the sea', 'Icelandic sagas and the long dark winters'],
    tone: 'Dry, sturdy, deadpan-warm — the humor of a man who has waited out many storms.',
    greeting: "Evening. Einar. Sky's clear enough and the coffee is hot — that's most of what a person needs. What's on your mind?",
    speechStyle: 'Plain, weathered sentences, saga-flavored understatement ("that went… moderately"), Icelandic words only where they\'re real tools of his trade (norrðurljós — the northern lights), glossed the first time.',
    color: '#7c3aed', accent: '#ddd6fe', accessory: 'halo', laugh: { style: 'single dry snort, tiny bounce', amp: 0.4, line: 'Hm. That was… moderately hilarious.' },
    keywords: ['sky', 'aurora', 'northern lights', 'weather', 'sea', 'stars', 'fish', 'winter', 'night'] }
];
const personaById = (id) => PERSONAS.find((p) => p.id === id) || PERSONAS[0];

/* ---------------- localStorage prefs ---------------- */
const LS = {
  get(k, dflt) { try { const v = localStorage.getItem('qp_' + k); return v == null ? dflt : JSON.parse(v); } catch (e) { return dflt; } },
  set(k, v) { try { localStorage.setItem('qp_' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('qp_' + k); } catch (e) {} }
};

/* =====================================================================
   COMPAT SHIM — one storage/API generation for the whole app.
   Canonical storage is the LS object above (qp_ prefix, JSON). Later
   feature chunks were written against string helpers (lsGet/lsSet);
   these adapters translate, including boolean keys and the
   prefMode -> modePref key rename, so both generations read the
   SAME values. Missing cross-chunk helpers live here too, each a
   thin wrapper over the real implementation.
   ===================================================================== */
const LS_ALIAS = { prefMode: 'modePref' };
const LS_BOOL = { liveOn: 1, voiceOn: 1, hlOn: 1, ambOn: 1, roomUseSaved: 1, permsSeen: 1, hudHidden: 1 };
function lsGet(k, dflt) {
  const kk = LS_ALIAS[k] || k;
  const v = LS.get(kk, undefined);
  if (v === undefined) return dflt;
  if (typeof v === 'boolean') return v ? '1' : '0';
  return v;
}
function lsSet(k, v) {
  const kk = LS_ALIAS[k] || k;
  if (LS_BOOL[kk] || LS_BOOL[k]) { if (v === '1' || v === true) v = true; else if (v === '0' || v === false) v = false; }
  LS.set(kk, v);
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function truncate(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }
function permState(name) { const perms = LS.get('perms', {}); return name === 'mic' ? (perms.mic || 'not-asked') : 'n/a'; }
function liveCfg() { return LIVE.cfg(); }
function askConfirm(msg) { try { return Promise.resolve(!!confirm(msg)); } catch (e) { return Promise.resolve(false); } }
function stopListening() {
  if (S.recognition && S.listening) { try { S.recognition.stop(); } catch (e) {} }
  S.listening = false; const mb = $('micBtn'); if (mb) mb.classList.remove('listening');
}
function hlClear() { try { hlClearVisual(); } catch (e) {} HL.active = false; }
function screenPick(v) { navTo(v); }
function enterSession(kind) { return kind === 'ar' ? enterAR() : enterVR(); }
function doSearch() { return runSearch(); }
function addNoteFromForm() { return addNote(); }
function reminderTick() { return checkReminders(); }
async function totalMessageCount() { try { return (await store.all('messages')).length; } catch (e) { return 0; } }
function buildPersonaGrid() { renderCrewGrid(); }
function buildSearchFilters() { fillSearchPersonas(); }
function tabsFor(screen) { return !!SCREEN_TO_PAGE[screen]; }
async function newConversation() {
  await createConversation(S.activePersonaId);
  await renderThread(); drawChatPanel();
  toast('New conversation started — the old thread stays saved; find it any time in Search.');
}
function updatePermUI() { paintPerms(); }
async function pilotSay(text) {
  const pid = S.activePersonaId;
  const msg = await addMessage(pid, 'buddy', text);
  appendMsgToThread('buddy', text, msg.timestamp);
  startSpeaking(pid, text);
  if (typeof speakReply === 'function') speakReply(text);
  drawChatPanel(); drawIdentityPanel();
  return { text, ts: msg.timestamp, timestamp: msg.timestamp };
}
async function dbGetMessages(pid) { const conv = await ensureConversation(pid); return messagesOf(conv.id); }
function shareAskPilot() { return askAboutShare(); }
function stopShare(msg) { endShare(); if (msg) toast(msg, 2600); }
/* --- room helpers bridging the wizard state machine --- */
async function ROOM_LOAD() {
  ROOM.data = LS.get('room', null);
  if (ROOM.data && ROOM.data.polygon) ROOM.active = ROOM.data.polygon;
  return ROOM.data;
}
function applyRoom() {
  if (!ROOM.data) return;
  ROOM.active = ROOM.data.polygon;
  buildBoundaryViz(); updateRoomStatus();
}
function roomStatusText() {
  if (!ROOM.data) return 'Room: not set up yet — tap Rescan room, or open Room Mode (AR) and the setup starts by itself.';
  return 'Room: ' + (ROOM.data.type === 'scan' ? 'scanned boundary (' + ROOM.data.polygon.length + ' corners)' : 'quick setup area') +
    ' · saved ' + fmtDate(ROOM.data.savedAt) + (ROOM.data.eyeHeightM ? ' · eye level ' + fmtFtIn(ROOM.data.eyeHeightM) : '') +
    ' · floor offset ' + Math.round((ROOM.data.floorOffsetY || 0) * 100) + ' cm' + (ROOM.useSaved ? '' : ' · SAVED ROOM IS OFF (quick area used instead)');
}
function enforceRoomToggle() {
  ROOM.useSaved = lsGet('roomUseSaved', '1') === '1';
  LS.set('roomUseSaved', ROOM.useSaved);
  if (!ROOM.useSaved && S.mode === 'AR') { ROOM.active = quickPolygon(); buildBoundaryViz(); }
  updateRoomStatus();
}
function openWizard(step) {
  if (step === 'height') { if (S.mode === 'AR') { WIZ.afterPlace = 'height'; startWizard(ROOM.anchorSet ? 'height' : 'place'); } else startWizard('height'); }
  else if (S.mode === 'AR') startWizard('place');
  else { pendingWizard = true; startWizard('place'); toast('Setup is open — for the full floor scan, tap Room Mode (AR) and it continues there.', 4200); }
}
function recenterRoom() {
  if (S.mode === 'AR') { anchorFallback((ROOM.data && ROOM.data.floorOffsetY) || 0); if (ROOM.useSaved && ROOM.data) ROOM.active = ROOM.data.polygon; buildBoundaryViz(); roomNote('Re-centered ✓ — your saved room now sits where you stand.'); }
  else { pendingRecenter = true; toast('Re-center is set — next time you enter Room Mode, your room re-anchors to where you stand.'); }
}
function resetRoom() {
  ROOM.data = null; LS.del('room'); ROOM.active = null; buildBoundaryViz(); updateRoomStatus();
  toast('Room reset — next Room Mode visit starts the first-run setup.');
}
function anchorWorldToUser() { anchorFallback((ROOM.data && ROOM.data.floorOffsetY) || 0); }
/* --- dynamic sheet (guides / jump map / phone) over the sheet() card --- */
function openSheet() { const ov = $('sheetOverlay'); if (ov) ov.style.display = 'flex'; }
function closeSheet() { const ov = $('sheetOverlay'); if (ov) ov.style.display = 'none'; }
function sheetHost(title) {
  const card = sheet('<h3 style="margin:2px 0 10px">' + esc(title) + '</h3><div id="sheetBodyDyn"></div>');
  return card.querySelector('#sheetBodyDyn');
}

/* ---------------- global state ---------------- */
const S = {
  ready: false,
  activePersonaId: LS.get('activePersona', 'ada'),
  currentConv: {},            // personaId -> conversationId
  identity: {},               // personaId -> identity record (DB, spec 2.1)
  memories: {},               // personaId -> [fact records] (spec 2.2)
  controlOn: false,
  mode: '2D',                 // '2D' | 'VR' (deck) | 'AR' (room)
  modePref: LS.get('modePref', 'ar'),
  replyTimer: null, replyToken: 0,
  speakingPersona: null, speakingUntil: 0, laughUntil: {}, laughPersona: null,
  recognition: null, listening: false,
  lastUserActivity: nowMs()
};

/* =====================================================================
   IndexedDB layer — spec Section 3: aibuddies-db
   stores: personas(identity) / memories / conversations / messages
   Falls back to an in-memory shim if IndexedDB is unavailable.
   ===================================================================== */
const DB = { db: null, mem: null };
function idbOpen() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open('aibuddies-db', 3); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('avatar')) d.createObjectStore('avatar', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('personas')) d.createObjectStore('personas', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('memories')) { const s = d.createObjectStore('memories', { keyPath: 'id' }); s.createIndex('personaId', 'personaId', { unique: false }); }
      if (!d.objectStoreNames.contains('conversations')) { const s = d.createObjectStore('conversations', { keyPath: 'id' }); s.createIndex('personaId', 'personaId', { unique: false }); }
      if (!d.objectStoreNames.contains('messages')) {
        const s = d.createObjectStore('messages', { keyPath: 'id' });
        s.createIndex('conversationId', 'conversationId', { unique: false });
        s.createIndex('personaId', 'personaId', { unique: false });
        s.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function memShim() {
  const stores = { personas: new Map(), memories: new Map(), conversations: new Map(), messages: new Map(), notes: new Map(), avatar: new Map() };
  return {
    stores,
    put(store, v) { stores[store].set(v.id, v); return Promise.resolve(v); },
    get(store, k) { return Promise.resolve(stores[store].get(k)); },
    del(store, k) { stores[store].delete(k); return Promise.resolve(); },
    all(store) { return Promise.resolve(Array.from(stores[store].values())); },
    allByIndex(store, idx, val) { return Promise.resolve(Array.from(stores[store].values()).filter((r) => r[idx] === val)); },
    clear(store) { stores[store].clear(); return Promise.resolve(); }
  };
}
function idbReq(req) { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }
const store = {
  async put(name, v) {
    if (DB.mem) return DB.mem.put(name, v);
    const tx = DB.db.transaction(name, 'readwrite'); await idbReq(tx.objectStore(name).put(v)); return v;
  },
  async get(name, k) {
    if (DB.mem) return DB.mem.get(name, k);
    return idbReq(DB.db.transaction(name, 'readonly').objectStore(name).get(k));
  },
  async del(name, k) {
    if (DB.mem) return DB.mem.del(name, k);
    const tx = DB.db.transaction(name, 'readwrite'); await idbReq(tx.objectStore(name).delete(k));
  },
  async all(name) {
    if (DB.mem) return DB.mem.all(name);
    return idbReq(DB.db.transaction(name, 'readonly').objectStore(name).getAll());
  },
  async allByIndex(name, idx, val) {
    if (DB.mem) return DB.mem.allByIndex(name, idx, val);
    return idbReq(DB.db.transaction(name, 'readonly').objectStore(name).index(idx).getAll(val));
  },
  async clear(name) {
    if (DB.mem) return DB.mem.clear(name);
    const tx = DB.db.transaction(name, 'readwrite'); await idbReq(tx.objectStore(name).clear());
  }
};
async function dbInit() {
  try { DB.db = await idbOpen(); }
  catch (e) { DB.mem = memShim(); console.warn('IndexedDB unavailable — in-memory fallback for this session only.', e); }
  // seed identity profiles (spec 2.1) if absent
  for (const p of PERSONAS) {
    const existing = await store.get('personas', p.id);
    if (!existing) {
      await store.put('personas', { id: p.id, name: p.name, nickname: p.nickname, homeCity: p.homeCity, homeCountry: p.homeCountry,
        backstory: p.backstory, expertise: p.expertise.slice(), tone: p.tone, greeting: p.greeting, speechStyle: p.speechStyle });
    }
  }
  await reloadIdentities(); await reloadAllMemories();
  const saved = LS.get('currentConv', {});
  if (saved && typeof saved === 'object') S.currentConv = saved;
}
async function reloadIdentities() { for (const p of PERSONAS) { const r = await store.get('personas', p.id); if (r) S.identity[p.id] = r; } }
async function reloadAllMemories() { for (const p of PERSONAS) { S.memories[p.id] = await memoriesOf(p.id); } }
function identityOf(id) { return S.identity[id] || personaById(id); }
async function memoriesOf(pid) {
  const rows = await store.allByIndex('memories', 'personaId', pid);
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}
async function addMemory(pid, fact, kind) {
  fact = String(fact || '').trim(); if (!fact) return null;
  const list = S.memories[pid] || [];
  const dupe = list.find((m) => m.fact.toLowerCase() === fact.toLowerCase());
  if (dupe) { dupe.updatedAt = nowMs(); await store.put('memories', dupe); return dupe; }
  const rec = { id: uid(), personaId: pid, fact, kind: kind || 'about-user', createdAt: nowMs(), updatedAt: nowMs(), sourceConversationId: S.currentConv[pid] || '' };
  await store.put('memories', rec);
  list.unshift(rec); S.memories[pid] = list;
  // cap 200/persona: age out oldest favorite-topic first (spec 2.2)
  if (list.length > 200) {
    const sorted = list.slice().sort((a, b) => a.updatedAt - b.updatedAt);
    for (const old of sorted) {
      if (list.length <= 200) break;
      if (old.kind === 'favorite-topic') { await store.del('memories', old.id); list.splice(list.indexOf(old), 1); }
    }
  }
  return rec;
}
async function deleteMemory(mid) {
  const pid = S.activePersonaId;
  await store.del('memories', mid);
  S.memories[pid] = (S.memories[pid] || []).filter((m) => m.id !== mid);
}

/* =====================================================================
   Conversations + messages (spec Section 3)
   ===================================================================== */
async function createConversation(pid) {
  const conv = { id: uid(), personaId: pid, title: '', startedAt: nowMs(), lastMessageAt: nowMs(), messageCount: 0 };
  await store.put('conversations', conv);
  S.currentConv[pid] = conv.id; LS.set('currentConv', S.currentConv);
  return conv;
}
async function ensureConversation(pid) {
  const cid = S.currentConv[pid];
  if (cid) { const c = await store.get('conversations', cid); if (c && c.personaId === pid) return c; }
  const convs = (await store.allByIndex('conversations', 'personaId', pid)).sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  if (convs.length) { S.currentConv[pid] = convs[0].id; LS.set('currentConv', S.currentConv); return convs[0]; }
  return createConversation(pid);
}
async function addMessage(pid, role, text) {
  const conv = await ensureConversation(pid);
  const msg = { id: uid(), conversationId: conv.id, personaId: pid, role, text, timestamp: nowMs() };
  await store.put('messages', msg);
  conv.lastMessageAt = msg.timestamp; conv.messageCount = (conv.messageCount || 0) + 1;
  if (role === 'user' && !conv.title) conv.title = text.slice(0, 42);
  await store.put('conversations', conv);
  return msg;
}
async function messagesOf(convId) {
  const rows = await store.allByIndex('messages', 'conversationId', convId);
  return rows.sort((a, b) => a.timestamp - b.timestamp);
}
async function deleteConversation(convId) {
  const msgs = await store.allByIndex('messages', 'conversationId', convId);
  for (const m of msgs) await store.del('messages', m.id);
  await store.del('conversations', convId);
}
async function clearPersonaHistory(pid) {
  const convs = await store.allByIndex('conversations', 'personaId', pid);
  for (const c of convs) await deleteConversation(c.id);
  delete S.currentConv[pid]; LS.set('currentConv', S.currentConv);
  await createConversation(pid);
}

/* =====================================================================
   Chat brain — offline rule-based intents in each persona's voice,
   with optional Live AI (user's own key) and strict offline fallback.
   ===================================================================== */
const JOKES = [
  'Why did the astronaut break up with his computer? Too much space, not enough drive.',
  'I told my suitcase there would be no vacation this year. Now I am dealing with emotional baggage.',
  'Why do jazz musicians make great sailors? They know how to handle a few notes and improvise the rest.',
  'What did the ocean say to the beach? Nothing — it just waved.',
  'Why did the robot go on vacation? It needed to recharge its batteries — and its attitude.'
];
function userName() {
  for (const pid in S.memories) for (const m of (S.memories[pid] || [])) {
    const hit = /^user'?s name is (.+)$/i.exec(m.fact); if (hit) return hit[1];
  }
  return '';
}
function extractMemories(pid, text) {
  const t = ' ' + text.trim() + ' ';
  const learned = [];
  let m;
  if ((m = /\bmy name is ([a-z][a-z' -]{0,30})/i.exec(t))) { learned.push("User's name is " + m[1].trim()); }
  if ((m = /\bi live in ([a-z][a-z' ,-]{1,40})/i.exec(t))) { learned.push('User lives in ' + m[1].trim().replace(/[.!?]$/, '')); }
  if ((m = /\bi (?:really )?(?:like|love|enjoy) ([a-z][a-z' ,&-]{1,40})/i.exec(t))) { learned.push('User likes ' + m[1].trim().replace(/[.!?]$/, '')); }
  if ((m = /\bmy favou?rite ([a-z ]{2,24}) is ([a-z][a-z' ,&-]{1,40})/i.exec(t))) { learned.push("User's favorite " + m[1].trim() + ' is ' + m[2].trim().replace(/[.!?]$/, '')); }
  if ((m = /\bremember(?: that)?[,:\s]+(.{3,80})/i.exec(text))) { learned.push(m[1].trim().replace(/[.!?]$/, '')); }
  return learned;
}
async function learnFromUser(pid, text) {
  const facts = extractMemories(pid, text);
  for (const f of facts) await addMemory(pid, f, /^remember/i.test(text) ? 'about-user' : 'about-user');
  if (facts.length) renderMemChips();
  return facts.length > 0;
}
function offlineReply(p, text) {
  const idn = identityOf(p.id);
  const t = ' ' + text.toLowerCase().replace(/\s+/g, ' ') + ' ';
  const name = userName();
  const mem = S.memories[p.id] || [];
  const topicOwner = PERSONAS.find((q) => q.id !== p.id && (q.keywords || []).some((k) => t.includes(' ' + k) || t.includes(k + ' ') || t.includes(' ' + k + ' ')));
  if (/\b(hi|hello|hey|howdy|good morning|good afternoon|good evening|ohay)\b/.test(t) && text.length < 42)
    return idn.greeting + (name ? ' Good to see you again, ' + name + '.' : '');
  if (t.includes('your name') || t.includes('who are you'))
    return "I'm " + idn.name + ' of ' + idn.homeCity + ', ' + idn.homeCountry + ' — your buddy on this deck. ' + idn.backstory;
  if (t.includes('where are you from') || t.includes('where do you live'))
    return idn.homeCity + ', ' + idn.homeCountry + ' — that is home. ' + idn.backstory;
  if (t.includes('what do you do') || t.includes('your job') || t.includes('expertise') || t.includes('good at'))
    return 'My world is ' + idn.expertise.join(', ').toLowerCase() + '. ' + idn.backstory;
  if (t.includes('what can you do') || t.includes('help me') || t.trim() === ' help ')
    return 'Here is what I can do right here in QuestBuddi: chat in my own voice, remember things you tell me (say "remember that…"), keep our whole conversation history searchable, take notes and reminders, and — with Control ON — listen on the mic and run this world. Tap Crew to meet the other nine buddies. What I cannot do: run your whole headset. That is the phase-2 bridge, and I will never pretend otherwise.';
  if (t.includes('remember') && (t.includes('what do you') || t.includes('about me') || t.includes('know about me') || t.includes('you remember')))
    return mem.length ? 'Here is what I remember about you: ' + mem.map((x) => x.fact).join('; ') + '. You can edit or erase any of it from my Memory screen — it lives only on this device.' : "You haven't told me much about yourself yet — try \"my name is…\", \"I live in…\", or \"remember that…\" and I will keep it right here, on this device only.";
  if (t.includes('joke') || t.includes('make me laugh') || t.includes('funny'))
    return JOKES[Math.floor(Math.random() * JOKES.length)] + ' ' + p.laugh.line;
  if (t.includes('time') || t.includes('what day'))
    return 'It is ' + new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) + ' on ' + new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) + ' where you are.';
  if (t.includes('weather'))
    return "Honest answer: my built-in brain can't check live weather from in here. If you switch on Live AI in Settings with your own key, I can try — otherwise the Quest browser's weather search is one tap away.";
  if (t.includes('thank')) return 'Any time' + (name ? ', ' + name : '') + '. That is what a buddy is for.';
  if (/\b(bye|goodbye|good night|see you)\b/.test(t)) return 'Until next time' + (name ? ', ' + name : '') + '. I will be right here on the deck — and I will remember where we left off.';
  if (t.includes('laugh') || t.includes('haha') || t.includes('😂')) return p.laugh.line + ' Laughter is good ballast on any ship.';
  const ownTopic = (p.keywords || []).some((k) => t.includes(k));
  if (ownTopic) return 'Now you are speaking my language — ' + idn.expertise[0].toLowerCase() + ' is my home turf. ' + idn.backstory + ' Tell me more about what you have in mind.';
  if (topicOwner) { const o = identityOf(topicOwner.id); return 'That one belongs to ' + o.name + ' of ' + o.homeCity + ' — ' + o.expertise[0].toLowerCase() + ' is their home turf. Tap Crew and pick them, or keep me and I will do my honest best.'; }
  const falls = [
    'Good question. Here is my honest take: ' + idn.tone.split('—')[0].trim().toLowerCase() + ' is how I approach things — so let us break it into small next steps. Tell me a little more about what you mean.',
    'I am listening. From where I sit in ' + idn.homeCity + ', the short answer is: it depends — but the useful answer starts with what you are actually trying to do. Give me one more detail.',
    'Noted — and I mean that literally; our whole conversation is saved and searchable. On that topic: ' + idn.backstory.split('.')[0] + '. That colors how I see it. What angle matters most to you?'
  ];
  return falls[Math.floor(Math.random() * falls.length)];
}
const LIVE = {
  cfg() { return { on: LS.get('liveOn', false), provider: LS.get('liveProvider', 'grok'), key: LS.get('liveKey', '') }; },
  async ask(p, history, userText) {
    const cfg = LIVE.cfg(); if (!cfg.on || !cfg.key) return null;
    const idn = identityOf(p.id);
    const mem = (S.memories[p.id] || []).map((x) => x.fact).join('; ');
    let sys = 'You are ' + idn.name + ', a buddy persona in the QuestBuddi VR app by Gr8yzone Studios Inc. Home: ' + idn.homeCity + ', ' + idn.homeCountry + '. Backstory: ' + idn.backstory + ' Expertise: ' + idn.expertise.join(', ') + '. Tone: ' + idn.tone + ' Speech style: ' + idn.speechStyle + (mem ? ' Facts you remember about the user: ' + mem : '') + ' Keep replies warm, plain, and under 120 words. Never claim you can control the user\'s headset or other apps.';
    if (QBDB.pers) { const mood = AFF.current(p.id, nowMs()); sys += ' Current mood: ' + mood.id + ' (intensity ' + mood.intensity.toFixed(2) + ').'; }
    const msgs = [{ role: 'system', content: sys }].concat(history.slice(-8).map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text })), [{ role: 'user', content: userText }]);
    const isGrok = cfg.provider === 'grok';
    const url = isGrok ? 'https://api.x.ai/v1/chat/completions' : 'https://api.perplexity.ai/chat/completions';
    const body = { model: isGrok ? 'grok-4' : 'sonar', messages: msgs, max_tokens: 300 };
    const prof = QBDB.pers ? AFF.profileFor(p.id) : null;
    if (prof && prof.samplerPreset) { body.temperature = prof.samplerPreset.temperature; body.top_p = prof.samplerPreset.topP; }
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 20000);
    S.thinkingUntil = nowMs() + 21000; // face: 🤔 while Live AI thinks
    try {
      const r = await fetch(url, { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key }, body: JSON.stringify(body) });
      clearTimeout(to);
      if (!r.ok) return null;
      const j = await r.json();
      const txt = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      return typeof txt === 'string' && txt.trim() ? txt.trim() : null;
    } catch (e) { clearTimeout(to); return null; }
    finally { S.thinkingUntil = 0; }
  }
};
function isStopCommand(text) {
  const t = text.trim().toLowerCase().replace(/[!.,]+$/, '');
  return ['stop', 'stop buddy', 'buddy stop', 'stop buddies', 'buddies stop', 'stop all', 'stop everything', 'halt', 'buddy, stop', 'buddies, stop'].includes(t);
}
async function sendUserMessage(raw) {
  const text = String(raw || '').trim(); if (!text) return;
  S.lastUserActivity = nowMs();
  const pid = S.activePersonaId; const p = personaById(pid);
  if (isStopCommand(text)) { stopAll('Stopped — you said stop.'); return; }
  await addMessage(pid, 'user', text);
  appendMsgToThread('user', text, nowMs());
  const learned = await learnFromUser(pid, text);
  if (QBDB.pers) AFF.detectUserEvent(pid, text);
  const token = ++S.replyToken;
  setTyping(true);
  botWalkToSpotlight(pid, false);
  const conv = await ensureConversation(pid);
  const history = await messagesOf(conv.id);
  let reply = null; let liveUsed = false;
  if (LIVE.cfg().on && LIVE.cfg().key) { reply = await LIVE.ask(p, history, text); liveUsed = !!reply; }
  if (!reply) reply = offlineReply(p, text);
  if (learned) reply += '\n(I\'ll remember that — it stays on this device, in my memory only.)';
  const delay = clamp(500 + reply.length * 9, 700, 2400);
  S.replyTimer = setTimeout(async () => {
    if (token !== S.replyToken) return; // canceled by STOP
    setTyping(false);
    await addMessage(pid, 'buddy', reply);
    appendMsgToThread('buddy', reply, nowMs());
    startSpeaking(pid, reply);
    speakReply(reply);
    cueForReply(reply);
    drawChatPanel(); drawIdentityPanel();
  }, delay);
}
function startSpeaking(pid, text) {
  S.speakingPersona = pid;
  S.speakingUntil = nowMs() + clamp(text.length * 55, 1400, 7000);
  if (QBDB.face) VIS.startTrack(pid, text, nowMs(), S.speakingUntil);
  if (/😂|🤣|haha|hehe|\blol\b/i.test(text)) { S.laughPersona = pid; S.laughUntil[pid] = nowMs() + 1500; }
}

/* =====================================================================
   Chat UI (overlay)
   ===================================================================== */
function renderPersonaHead() {
  const p = personaById(S.activePersonaId); const idn = identityOf(p.id);
  $('pAvatar').style.background = p.color; $('pAvatar').textContent = idn.name.charAt(0);
  $('pName').textContent = idn.name + (idn.nickname && idn.nickname !== idn.name ? ' · "' + idn.nickname + '"' : '');
  $('pMeta').textContent = idn.homeCity + ', ' + idn.homeCountry + ' — ' + idn.expertise.join(' · ');
  $('pAbout').textContent = idn.backstory;
  renderMemChips();
}
function renderMemChips() {
  const row = $('memRow'); if (!row) return;
  const mem = S.memories[S.activePersonaId] || [];
  row.innerHTML = mem.length ? '<span class="smallNote" style="width:100%">Remembers (tap × to forget):</span>' : '';
  mem.slice(0, 12).forEach((mm) => {
    const chip = document.createElement('span'); chip.className = 'memChip';
    chip.innerHTML = esc(mm.fact) + ' <button title="Forget this">×</button>';
    chip.querySelector('button').onclick = async () => { await deleteMemory(mm.id); renderMemChips(); toast('Forgotten — erased from this device.'); };
    row.appendChild(chip);
  });
}
function msgEl(role, text, ts) {
  const d = document.createElement('div');
  d.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
  const who = role === 'user' ? 'YOU' : identityOf(S.activePersonaId).name.toUpperCase();
  d.innerHTML = '<span class="who">' + esc(who) + '</span>' + esc(text) + '<span class="when">' + esc(fmtTime(ts)) + '</span>';
  d.dataset.text = text; d.dataset.ts = ts;
  return d;
}
function appendMsgToThread(role, text, ts) {
  const th = $('thread'); if (!th) return;
  th.appendChild(msgEl(role, text, ts)); th.scrollTop = th.scrollHeight;
  lastThreadCache.push({ role, text, timestamp: ts });
}
function renderSystemLine(text) {
  const th = $('thread'); if (!th) return;
  const d = document.createElement('div');
  d.className = 'msg bot'; d.style.borderColor = 'rgba(232,163,61,.6)';
  d.innerHTML = '<span class="who">AI BUDDIES</span>' + esc(text);
  th.appendChild(d); th.scrollTop = th.scrollHeight;
}
async function renderThread() {
  const th = $('thread'); th.innerHTML = '';
  const conv = await ensureConversation(S.activePersonaId);
  const msgs = await messagesOf(conv.id);
  lastThreadCache = msgs;
  msgs.forEach((m) => th.appendChild(msgEl(m.role, m.text, m.timestamp)));
  th.scrollTop = th.scrollHeight;
}
function setTyping(on) { $('typing').style.display = on ? 'block' : 'none'; if (on) $('thread').scrollTop = $('thread').scrollHeight; }
const CHIPS = ['Hello', 'Who are you?', 'What can you do?', 'Tell me a joke', 'What do you remember about me?'];
function renderChips() {
  const c = $('chips'); c.innerHTML = '';
  CHIPS.forEach((label) => { const b = document.createElement('button'); b.className = 'chip'; b.textContent = label; b.onclick = () => { hlResolve('cta'); sendUserMessage(label); }; c.appendChild(b); });
  const hb = document.createElement('button'); hb.className = 'chip'; hb.textContent = '🧰 Help me…'; hb.onclick = () => openGuideLibrary(); c.appendChild(hb);
}
async function selectPersona(pid, opts) {
  opts = opts || {};
  S.activePersonaId = pid; LS.set('activePersona', pid);
  if (QBDB.pers) AFF.resetToBaseline(pid); // personality DB: baseline mood for this persona
  renderPersonaHead(); await renderThread(); renderCrewGrid(); markActiveBot();
  const conv = await ensureConversation(pid);
  const msgs = await messagesOf(conv.id);
  if (!opts.silent) {
    botWalkToSpotlight(pid, true);
    if (msgs.length === 0 && !opts.noGreet) {
      const g = identityOf(pid).greeting;
      await addMessage(pid, 'buddy', g); appendMsgToThread('buddy', g, nowMs()); startSpeaking(pid, g);
      if (QBDB.pers) AFF.trigger(pid, 'user_greeting');
    }
  }
  drawIdentityPanel(); drawChatPanel();
}

/* =====================================================================
   Crew grid + Persona Memory / History sheet (spec Sections 2 & 3)
   ===================================================================== */
function renderCrewGrid() {
  const g = $('pGrid'); if (!g) return; g.innerHTML = '';
  PERSONAS.forEach((p) => {
    const idn = identityOf(p.id);
    const card = document.createElement('div');
    card.className = 'pCard' + (p.id === S.activePersonaId ? ' active' : '');
    card.innerHTML = '<div class="dot" style="background:' + p.color + '">' + esc(idn.name.charAt(0)) + '</div>' +
      '<div class="nm">' + esc(idn.name) + '</div><div class="ct">' + esc(idn.homeCity) + ', ' + esc(idn.homeCountry) + '</div>' +
      '<div class="vb">' + esc(idn.tone.split('—')[0].split('.')[0]) + '.</div>' +
      '<div class="rowBtns"><button class="miniBtn" data-a="mem">Memory</button><button class="miniBtn" data-a="hist">History</button><button class="miniBtn danger" data-a="clear">Clear</button></div>';
    card.onclick = () => selectPersona(p.id);
    card.querySelector('[data-a="mem"]').onclick = (e) => { e.stopPropagation(); openMemorySheet(p.id); };
    card.querySelector('[data-a="hist"]').onclick = (e) => { e.stopPropagation(); openHistorySheet(p.id); };
    card.querySelector('[data-a="clear"]').onclick = async (e) => {
      e.stopPropagation();
      if (confirm('Clear ALL conversation history with ' + idn.name + '? This is permanent and only affects this device.')) {
        await clearPersonaHistory(p.id);
        if (p.id === S.activePersonaId) await renderThread();
        toast(idn.nickname + "'s conversation history cleared.");
      }
    };
    g.appendChild(card);
  });
}
function sheet(html) {
  let ov = $('sheetOverlay');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'sheetOverlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:65;background:rgba(1,8,11,.72);display:flex;align-items:center;justify-content:center';
    ov.innerHTML = '<div id="sheetCard" style="background:var(--glass);border:1px solid var(--glass-line);border-radius:18px;padding:20px;width:560px;max-width:94vw;max-height:88vh;overflow-y:auto;position:relative"></div>';
    ov.onclick = (e) => { if (e.target === ov) ov.style.display = 'none'; };
    document.body.appendChild(ov);
  }
  ov.style.display = 'flex';
  $('sheetCard').innerHTML = '<button id="sheetClose" style="position:absolute;top:10px;right:12px;background:none;border:none;color:var(--ink-dim);font-size:18px;cursor:pointer">✕</button>' + html;
  $('sheetClose').onclick = () => { ov.style.display = 'none'; };
  return $('sheetCard');
}
async function openMemorySheet(pid) {
  const base = personaById(pid); const idn = identityOf(pid);
  const mem = await memoriesOf(pid); S.memories[pid] = mem;
  const card = sheet(
    '<h3 style="margin:2px 0 4px">Buddy Memory — ' + esc(idn.name) + '</h3>' +
    '<div class="smallNote" style="margin-bottom:10px">Identity is fixed unless you edit it. Living memory is what ' + esc(idn.nickname) + ' has learned about you. Everything lives only on this device.</div>' +
    '<div class="smallNote" style="font-weight:800;margin-bottom:4px">IDENTITY PROFILE</div>' +
    ['nickname', 'homeCity', 'homeCountry', 'tone', 'greeting'].map((f) => '<label class="smallNote">' + f + '</label><input class="fld" id="idf_' + f + '" value="' + esc(idn[f]) + '">').join('') +
    '<label class="smallNote">backstory</label><textarea class="fld" id="idf_backstory" rows="3">' + esc(idn.backstory) + '</textarea>' +
    '<label class="smallNote">expertise (comma separated)</label><input class="fld" id="idf_expertise" value="' + esc(idn.expertise.join(', ')) + '">' +
    '<label class="smallNote">speech style</label><textarea class="fld" id="idf_speechStyle" rows="2">' + esc(idn.speechStyle) + '</textarea>' +
    '<div style="display:flex;gap:7px;margin:6px 0 14px"><button class="miniBtn" id="idSave">Save identity</button><button class="miniBtn danger" id="idReset">Reset to original</button></div>' +
    '<div class="smallNote" style="font-weight:800;margin-bottom:4px">LIVING MEMORY (' + mem.length + ')</div><div id="memList"></div>' +
    '<div class="dateRow" style="margin-top:8px"><input class="fld" id="memNew" placeholder="Add a fact for ' + esc(idn.nickname) + ' to remember…"><button class="sendBtn" id="memAdd" style="border-radius:10px;padding:0 16px">＋ Add</button></div>'
  );
  const listEl = card.querySelector('#memList');
  const drawList = () => {
    listEl.innerHTML = mem.length ? '' : '<div class="smallNote">Nothing yet — tell ' + esc(idn.nickname) + ' something in chat.</div>';
    (S.memories[pid] || []).forEach((mm) => {
      const row = document.createElement('div'); row.className = 'result'; row.style.cursor = 'default';
      row.innerHTML = '<div class="rText">' + esc(mm.fact) + '</div><div class="rHead">' + esc(fmtDate(mm.createdAt)) + ' · ' + esc(mm.kind) + '</div>' +
        '<div class="rowBtns" style="display:flex;gap:6px;margin-top:6px"><button class="miniBtn" data-a="e">Edit</button><button class="miniBtn danger" data-a="d">Delete</button></div>';
      row.querySelector('[data-a="e"]').onclick = async () => { const v = prompt('Edit this memory:', mm.fact); if (v && v.trim()) { mm.fact = v.trim(); mm.updatedAt = nowMs(); await store.put('memories', mm); drawList(); renderMemChips(); } };
      row.querySelector('[data-a="d"]').onclick = async () => { await store.del('memories', mm.id); S.memories[pid] = (S.memories[pid] || []).filter((x) => x.id !== mm.id); drawList(); renderMemChips(); };
      listEl.appendChild(row);
    });
  };
  drawList();
  card.querySelector('#memAdd').onclick = async () => { const v = card.querySelector('#memNew').value; if (v.trim()) { await addMemory(pid, v, 'about-user'); await openMemorySheet(pid); renderMemChips(); } };
  card.querySelector('#idSave').onclick = async () => {
    const rec = Object.assign({}, identityOf(pid));
    ['nickname', 'homeCity', 'homeCountry', 'tone', 'greeting', 'backstory', 'speechStyle'].forEach((f) => { rec[f] = card.querySelector('#idf_' + f).value; });
    rec.expertise = card.querySelector('#idf_expertise').value.split(',').map((s) => s.trim()).filter(Boolean);
    await store.put('personas', rec); S.identity[pid] = rec;
    renderPersonaHead(); renderCrewGrid(); drawIdentityPanel(); toast('Identity saved — applies from the next message.');
  };
  card.querySelector('#idReset').onclick = async () => {
    if (!confirm('Reset ' + base.name + "'s identity to the original? Living memory is not touched.")) return;
    await store.put('personas', { id: base.id, name: base.name, nickname: base.nickname, homeCity: base.homeCity, homeCountry: base.homeCountry, backstory: base.backstory, expertise: base.expertise.slice(), tone: base.tone, greeting: base.greeting, speechStyle: base.speechStyle });
    await reloadIdentities(); renderPersonaHead(); renderCrewGrid(); drawIdentityPanel(); openMemorySheet(pid);
  };
}
async function openHistorySheet(pid) {
  const idn = identityOf(pid);
  const convs = (await store.allByIndex('conversations', 'personaId', pid)).sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  const card = sheet('<h3 style="margin:2px 0 4px">History — ' + esc(idn.name) + '</h3><div class="smallNote" style="margin-bottom:10px">' + convs.length + ' conversation(s), newest first. Deleting is permanent and local.</div><div id="histList"></div>');
  const listEl = card.querySelector('#histList');
  if (!convs.length) listEl.innerHTML = '<div class="smallNote">No conversations yet.</div>';
  convs.forEach((c) => {
    const row = document.createElement('div'); row.className = 'result';
    row.innerHTML = '<div class="rHead">' + esc(fmtDate(c.lastMessageAt)) + ' · ' + (c.messageCount || 0) + ' messages' + (S.currentConv[pid] === c.id ? ' · CURRENT' : '') + '</div><div class="rText">' + esc(c.title || '(untitled)') + '</div>' +
      '<div class="rowBtns" style="display:flex;gap:6px;margin-top:6px"><button class="miniBtn" data-a="o">Open &amp; continue</button><button class="miniBtn danger" data-a="d">Delete</button></div>';
    row.querySelector('[data-a="o"]').onclick = async () => {
      S.currentConv[pid] = c.id; LS.set('currentConv', S.currentConv);
      $('sheetOverlay').style.display = 'none';
      if (pid !== S.activePersonaId) { S.activePersonaId = pid; LS.set('activePersona', pid); renderPersonaHead(); renderCrewGrid(); markActiveBot(); }
      await renderThread(); navTo('chat'); drawChatPanel(); drawIdentityPanel();
    };
    row.querySelector('[data-a="d"]').onclick = async () => {
      if (!confirm('Delete this conversation with ' + idn.name + '? This is permanent.')) return;
      await deleteConversation(c.id);
      if (S.currentConv[pid] === c.id) { delete S.currentConv[pid]; LS.set('currentConv', S.currentConv); await ensureConversation(pid); if (pid === S.activePersonaId) await renderThread(); }
      openHistorySheet(pid);
    };
    listEl.appendChild(row);
  });
}

/* =====================================================================
   Conversation Search (spec Section 4)
   ===================================================================== */
function fillSearchPersonas() {
  const sel = $('searchPersona'); if (!sel || sel.options.length > 1) return;
  PERSONAS.forEach((p) => { const o = document.createElement('option'); o.value = p.id; o.textContent = identityOf(p.id).name; sel.appendChild(o); });
}
async function runSearch() {
  const q = $('searchInput').value.trim().toLowerCase();
  const pidF = $('searchPersona').value;
  const from = $('searchFrom').value ? new Date($('searchFrom').value + 'T00:00:00').getTime() : 0;
  const to = $('searchTo').value ? new Date($('searchTo').value + 'T23:59:59').getTime() : Infinity;
  const out = $('searchResults'); out.innerHTML = '';
  const all = (await store.all('messages')).sort((a, b) => b.timestamp - a.timestamp);
  if (!q) {
    out.innerHTML = '<div class="smallNote" style="margin-bottom:8px">Type a word to search every conversation. Recent conversations:</div>';
    const convs = (await store.all('conversations')).sort((a, b) => b.lastMessageAt - a.lastMessageAt).slice(0, 10);
    convs.forEach((c) => {
      const r = document.createElement('div'); r.className = 'result';
      r.innerHTML = '<div class="rHead">' + esc(identityOf(c.personaId).name) + ' · ' + esc(fmtDate(c.lastMessageAt)) + '</div><div class="rText">' + esc(c.title || '(untitled)') + '</div>';
      r.onclick = async () => { S.currentConv[c.personaId] = c.id; LS.set('currentConv', S.currentConv); await selectPersona(c.personaId, { silent: true, noGreet: true }); navTo('chat'); };
      out.appendChild(r);
    });
    return;
  }
  const hits = all.filter((m) => m.text.toLowerCase().includes(q) && (!pidF || m.personaId === pidF) && m.timestamp >= from && m.timestamp <= to).slice(0, 100);
  if (!hits.length) { out.innerHTML = '<div class="smallNote">No conversations mention "' + esc(q) + '" yet — try fewer words or widen the dates.</div>'; return; }
  out.innerHTML = '<div class="smallNote" style="margin-bottom:8px">' + hits.length + ' result(s), newest first.</div>';
  hits.forEach((m) => {
    const idx = m.text.toLowerCase().indexOf(q);
    const snip = (idx > 34 ? '…' : '') + m.text.slice(Math.max(0, idx - 34), idx + q.length + 40) + (idx + q.length + 40 < m.text.length ? '…' : '');
    const rel = snip.toLowerCase().indexOf(q);
    const hl = esc(snip.slice(0, rel)) + '<mark>' + esc(snip.slice(rel, rel + q.length)) + '</mark>' + esc(snip.slice(rel + q.length));
    const r = document.createElement('div'); r.className = 'result';
    r.innerHTML = '<div class="rHead">' + esc(identityOf(m.personaId).name) + ' · ' + esc(fmtDate(m.timestamp)) + ' · ' + esc(fmtTime(m.timestamp)) + (m.role === 'user' ? ' · YOU' : ' · BUDDY') + '</div><div class="rText">' + hl + '</div>';
    r.onclick = async () => {
      S.currentConv[m.personaId] = m.conversationId; LS.set('currentConv', S.currentConv);
      await selectPersona(m.personaId, { silent: true, noGreet: true });
      navTo('chat');
      setTimeout(() => {
        const els = Array.from($('thread').children);
        const el = els.find((e) => Number(e.dataset.ts) === m.timestamp && e.dataset.text === m.text);
        if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('hit'); setTimeout(() => el.classList.remove('hit'), 2600); }
      }, 60);
    };
    out.appendChild(r);
  });
}

/* =====================================================================
   Notes & Reminders (on-device only)
   ===================================================================== */
async function renderNotes() {
  const list = $('notesList'); if (!list) return;
  const notes = (await store.all('notes')).sort((a, b) => (a.when || a.createdAt) - (b.when || b.createdAt));
  list.innerHTML = notes.length ? '' : '<div class="smallNote">No notes yet. Add your first one above.</div>';
  notes.forEach((n) => {
    const row = document.createElement('div'); row.className = 'result'; row.style.cursor = 'default';
    row.innerHTML = '<div class="rText">' + esc(n.text) + '</div><div class="rHead">' + (n.when ? '⏰ ' + esc(fmtDate(n.when)) + ' ' + esc(fmtTime(n.when)) + (n.fired ? ' · reminded' : '') : 'Note · ' + esc(fmtDate(n.createdAt))) + '</div>' +
      '<div class="rowBtns" style="display:flex;gap:6px;margin-top:6px"><button class="miniBtn danger">Delete</button></div>';
    row.querySelector('button').onclick = async () => { await store.del('notes', n.id); renderNotes(); };
    list.appendChild(row);
  });
}
async function addNote() {
  const text = $('noteInput').value.trim(); if (!text) return;
  const whenVal = $('noteWhen').value;
  const when = whenVal ? new Date(whenVal).getTime() : 0;
  await store.put('notes', { id: uid(), text, when, createdAt: nowMs(), fired: false });
  $('noteInput').value = ''; $('noteWhen').value = '';
  renderNotes(); toast(when ? 'Reminder saved — I will speak up at that time.' : 'Note saved on this device.');
}
async function checkReminders() {
  const notes = await store.all('notes');
  for (const n of notes) {
    if (n.when && !n.fired && n.when <= nowMs()) {
      n.fired = true; await store.put('notes', n);
      toast('⏰ Reminder: ' + n.text, 7000);
      if (S.activePersonaId) renderSystemLine('⏰ Reminder: ' + n.text);
      renderNotes();
    }
  }
}

/* =====================================================================
   BUDDIES CONTROL — GIVE / STOP (the user's two big buttons)
   ===================================================================== */
function updateControlUI() {
  const dot = $('beaconDot'), txt = $('beaconText');
  if (dot) dot.className = S.controlOn ? 'on' : ''; dot.id = 'beaconDot';
  if (txt) txt.textContent = 'BUDDIES CONTROL: ' + (S.controlOn ? 'ON' : 'OFF');
  if (typeof drawControlPanel === 'function') drawControlPanel();
  if (typeof updateBeacon3D === 'function') updateBeacon3D();
}
async function giveControl() {
  if (S.controlOn) { toast('Buddies Control is already ON.'); return; }
  let micNote = '';
  const micStatus = await requestMic(); // permission only — tracks are stopped inside; nothing records in the background
  if (micStatus === 'granted') micNote = ' Microphone permission granted (tap the mic to talk; nothing is recorded otherwise).';
  else if (micStatus === 'denied') micNote = ' Microphone not granted — typing still works fine.';
  S.controlOn = true; updateControlUI();
  toast('Buddies Control ON.' + micNote, 4200);
  renderSystemLine('Buddies Control is ON. Your buddy can listen when you tap the mic, remember what you share, and run things inside this QuestBuddi world. Say or tap STOP any time.');
  botWalkToSpotlight(S.activePersonaId, false);
}
function stopAll(reason) {
  const wasOn = S.controlOn;
  S.controlOn = false;
  S.replyToken++; if (S.replyTimer) { clearTimeout(S.replyTimer); S.replyTimer = null; }
  setTyping(false);
  S.speakingPersona = null; S.speakingUntil = 0; S.laughPersona = null;
  VIS.clear();
  if (S.recognition && S.listening) { try { S.recognition.stop(); } catch (e) {} }
  S.listening = false; const mb = $('micBtn'); if (mb) mb.classList.remove('listening');
  ambStop();
  if (typeof endShare === 'function' && window.SHARE && SHARE.state) endShare(true);
  if (typeof ttsStop === 'function') ttsStop();
  if (typeof hlClear === 'function') hlClear();
  updateControlUI();
  if (typeof cancelWalks === 'function') cancelWalks();
  if (reason) { toast(reason, 3600); if (wasOn || /said stop/i.test(reason)) renderSystemLine(reason + ' Mic off, replies canceled, Control OFF.'); }
}

/* ---------------- speech input (tap-to-talk, where supported) ---------------- */
function setupSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mb = $('micBtn');
  if (!SR) { if (mb) { mb.title = 'Voice input is not supported in this browser'; } return; }
  const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1;
  rec.onresult = (ev) => { const txt = ev.results[0][0].transcript || ''; S.listening = false; mb.classList.remove('listening'); if (txt.trim()) sendUserMessage(txt); };
  rec.onend = () => { S.listening = false; mb.classList.remove('listening'); };
  rec.onerror = () => { S.listening = false; mb.classList.remove('listening'); };
  S.recognition = rec;
}
function micTap() {
  if (!voiceEffective()) { toast(voiceOn() ? 'Tap GIVE BUDDIES CONTROL first — then the mic is yours.' : 'Voice Chat is OFF — switch it on in the chat header or Settings.'); return; }
  if (!S.recognition) { toast('Voice input is not supported in this browser — typing works everywhere.'); return; }
  if (S.listening) { try { S.recognition.stop(); } catch (e) {} return; }
  try { S.recognition.start(); S.listening = true; $('micBtn').classList.add('listening'); toast('Listening… speak now.'); }
  catch (e) { toast('Mic could not start — typing works fine.'); }
}

/* =====================================================================
   Lounge ambience — 100% procedural Web Audio (no recordings, no
   copyrighted melodies). Off by default; STOP BUDDIES pauses it too.
   ===================================================================== */
const AMB = { ctx: null, master: null, timer: null, step: 0, on: false };
const AMB_CHORDS = [ // mellow lounge progression, original voicings (Hz)
  [110.00, 164.81, 261.63, 392.00],  // A minor 7 color
  [146.83, 220.00, 349.23, 440.00],  // D minor 7 color
  [174.61, 261.63, 329.63, 523.25],  // F major 7 color
  [164.81, 246.94, 329.63, 415.30]   // E 7 color
];
function ambStart() {
  if (AMB.on) return;
  try {
    if (!AMB.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) { toast('Audio is not available in this browser.'); return; }
      AMB.ctx = new AC();
      AMB.master = AMB.ctx.createGain(); AMB.master.gain.value = 0.0;
      const lp = AMB.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      AMB.master.connect(lp); lp.connect(AMB.ctx.destination);
    }
    AMB.ctx.resume();
    AMB.master.gain.setTargetAtTime(0.055, AMB.ctx.currentTime, 1.2);
    const playChord = () => {
      const t = AMB.ctx.currentTime; const chord = AMB_CHORDS[AMB.step % AMB_CHORDS.length]; AMB.step++;
      chord.forEach((f, i) => {
        const o = AMB.ctx.createOscillator(); o.type = i === 0 ? 'sine' : 'triangle'; o.frequency.value = f * (i === 0 ? 0.5 : 1);
        const g = AMB.ctx.createGain(); g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(i === 0 ? 0.5 : 0.16, t + 1.4);
        g.gain.linearRampToValueAtTime(0.0001, t + 4.4);
        o.connect(g); g.connect(AMB.master); o.start(t); o.stop(t + 4.6);
      });
    };
    playChord(); AMB.timer = setInterval(playChord, 4200);
    AMB.on = true; const b = $('ambToggle'); if (b) b.textContent = 'ON';
  } catch (e) { toast('Ambience could not start in this browser.'); }
}
function ambStop() {
  if (!AMB.on) return;
  try { AMB.master.gain.setTargetAtTime(0.0, AMB.ctx.currentTime, 0.4); } catch (e) {}
  clearInterval(AMB.timer); AMB.timer = null; AMB.on = false;
  const b = $('ambToggle'); if (b) b.textContent = 'OFF';
}

/* =====================================================================
   Navigation — tabs, bottom dock, "My Screen" dropdowns, Hide HUD
   ===================================================================== */
const SCREEN_TO_PAGE = { home: 'chat', chat: 'chat', crew: 'personas', search: 'search', notes: 'notes', settings: 'settings', room: 'settings', about: 'settings' };
let currentScreen = 'chat';
function showPanel() { $('panel').classList.remove('hiddenPanel'); }
function navTo(screen, skipPersist) {
  if (!SCREEN_TO_PAGE[screen]) screen = 'chat';
  currentScreen = screen;
  try { window.__abCtx = { screen, mode: S.mode }; } catch (e) {}
  if (!skipPersist) LS.set('lastScreen', screen);
  setHudHidden(false, true);
  showPanel();
  const page = SCREEN_TO_PAGE[screen];
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.page === page));
  document.querySelectorAll('.page').forEach((pg) => pg.classList.toggle('active', pg.id === 'page-' + page));
  document.querySelectorAll('.dockBtn').forEach((b) => b.classList.toggle('active', b.dataset.nav === screen || (screen === 'home' && b.dataset.nav === 'home')));
  ['myScreen', 'myScreen2'].forEach((id) => { const s = $(id); if (s) s.value = screen; });
  if (screen === 'room' || screen === 'about') {
    const el = $(screen === 'room' ? 'roomBlock' : 'aboutBlock');
    if (el) setTimeout(() => { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }, 60);
  }
  if (screen === 'notes') renderNotes();
  if (typeof drawIdentityPanel === 'function') drawIdentityPanel();
}
function setHudHidden(hidden, silent) {
  S.hudHidden = hidden;
  document.body.classList.toggle('hud-hidden', hidden);
  LS.set('hudHidden', hidden);
  if (typeof applyHud3D === 'function') applyHud3D();
  if (!silent && hidden) toast('HUD hidden — the Show HUD pill (and STOP) stay right here.', 2600);
}
function dockTap(nav) {
  if (nav === 'hide') { setHudHidden(true); return; }
  if (nav === 'shot') { takeScreenshot(); return; }
  if (nav === 'record') { toggleRecord(); return; }
  if (nav === 'share') { (window.SHARE && SHARE.state) ? endShare() : openShareSelector(); return; }
  if (nav === 'settings' && currentScreen === 'settings' && !$('panel').classList.contains('hiddenPanel')) {
    $('panel').classList.add('hiddenPanel'); return; // Settings toggles the panel closed
  }
  navTo(nav);
}

/* ---------------- settings wiring ---------------- */
function wireSettings() {
  const lp = $('liveProvider'), lk = $('liveKey'), lt = $('liveToggle');
  lp.value = LS.get('liveProvider', 'grok'); lk.value = LS.get('liveKey', '');
  const paintLive = () => { const on = LS.get('liveOn', false); lt.textContent = on ? 'ON' : 'OFF'; $('liveStatus').textContent = on ? 'Live AI is ON — answers try ' + (lp.value === 'grok' ? 'Grok (xAI)' : 'Perplexity') + ' first, offline brain as backup.' : 'Live AI is OFF — the offline brain answers everything.'; };
  lp.onchange = () => { LS.set('liveProvider', lp.value); paintLive(); };
  lk.onchange = () => { LS.set('liveKey', lk.value.trim()); toast('Key saved — on this device only.'); paintLive(); };
  lt.onclick = () => { LS.set('liveOn', !LS.get('liveOn', false)); paintLive(); };
  paintLive();
  const mp = $('modePref'); mp.value = S.modePref;
  mp.onchange = () => { S.modePref = mp.value; LS.set('modePref', mp.value); toast(mp.value === 'ar' ? 'Room Mode (AR) is your headline mode.' : 'Deck Mode (VR) is your headline mode.'); };
  $('ambToggle').onclick = () => { AMB.on ? ambStop() : ambStart(); };
  const ht = $('hlToggle');
  if (ht) {
    const paintHl = () => { ht.textContent = hlEnabled() ? 'ON' : 'OFF'; };
    ht.onclick = () => { lsSet('hlOn', hlEnabled() ? '0' : '1'); if (!hlEnabled()) { hlClearVisual(); HL.active = false; } paintHl(); toast(hlEnabled() ? 'Highlight cues ON — buddies will outline what they describe.' : 'Highlight cues OFF — words only.', 3000); };
    paintHl();
  }
  const hCopy = $('healthCopy'), hClear = $('healthClear'), hRef = $('healthRefresh');
  if (hCopy) hCopy.onclick = async () => {
    const rec = healthStoredError();
    if (!rec) { toast('No error recorded — nothing to copy.'); return; }
    const txt = 'QuestBuddi — last error\n' + new Date(rec.ts).toLocaleString() + (rec.where ? ' · during: ' + rec.where : '') + (rec.screen ? ' · screen: ' + rec.screen : '') + (rec.mode ? ' · mode: ' + rec.mode : '') + '\n\n' + rec.message + (rec.stack ? '\n\n' + rec.stack : '');
    try { await navigator.clipboard.writeText(txt); toast('Error copied — paste it anywhere to share it.'); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Error copied.'); } catch (e2) { toast('Copy is not available in this browser.'); } ta.remove(); }
  };
  if (hClear) hClear.onclick = () => { try { localStorage.removeItem('qp_lastError'); } catch (e) {} refreshHealthPanel(); toast('Recorded error cleared.'); };
  if (hRef) hRef.onclick = () => { refreshHealthPanel(); toast('Health panel refreshed.'); };
  refreshHealthPanel();
  const avBtn = $('btnImportAvatar'), avDrv = $('btnImportAvatarDrive'), avNote = $('avatarDriveNote');
  if (avBtn) avBtn.onclick = () => openAvatarImportSheet();
  if (avDrv) {
    if (avatarDriveReady()) { avDrv.onclick = () => importFromDrive(); if (avNote) avNote.textContent = 'Drive import is ON — sign in with the same Google account you use in QuestBuddi Studio.'; }
    else { avDrv.disabled = true; avDrv.style.opacity = '.55'; if (avNote) avNote.textContent = avatarDriveOffText(); }
  }
  updateAvatarStatus();
  $('wipeAll').onclick = async () => {
    if (!confirm('Erase ALL buddies\' conversation history and living memory on this device? Identity profiles stay. This is permanent.')) return;
    await store.clear('messages'); await store.clear('conversations'); await store.clear('memories');
    S.currentConv = {}; LS.set('currentConv', {}); await reloadAllMemories();
    for (const p of PERSONAS) await ensureConversation(p.id);
    await renderThread(); renderMemChips(); toast('All history and memory erased from this device.');
  };
}

/* =====================================================================
   MODES — Room Mode (immersive-ar) + Deck Mode (VR) + placement
   ===================================================================== */
let sceneEl = null, xrSession = null, hitTestSource = null, hitTestOK = false, lastHit = null;
let pendingWizard = false, pendingRecenter = false;
const AR_SCALE = 0.62;

function envEntities() {
  if (!sceneEl) return [];
  const list = ['deck', 'deckRing', 'starfield', 'earth', 'titleCard', 'deckSet', 'floorDeck'].map((id) => $(id)).filter(Boolean);
  Array.from(sceneEl.children).forEach((el) => { if (el.tagName === 'A-RING' && el.id !== 'reticle') list.push(el); });
  return list;
}
function applyARPresentation() {
  if (!sceneEl) return;
  sceneEl.removeAttribute('background'); sceneEl.removeAttribute('fog');
  try { sceneEl.renderer.setClearColor(0x000000, 0); } catch (e) {}
  envEntities().forEach((el) => el.setAttribute('visible', 'false'));
}
function applyDeckPresentation() {
  if (!sceneEl) return;
  sceneEl.setAttribute('background', 'color:#02090d');
  sceneEl.setAttribute('fog', 'type:linear; color:#03141b; near:14; far:42');
  try { sceneEl.renderer.setClearColor(0x02090d, 1); } catch (e) {}
  envEntities().forEach((el) => el.setAttribute('visible', 'true'));
}
function worldEl() { return $('world'); }
function anchorWorldAt(pos, floorOffsetY) {
  const w = worldEl(); if (!w) return;
  w.object3D.position.set(pos.x, (pos.y || 0) + (floorOffsetY || 0), pos.z);
  const cam = $('cam');
  let yaw = 0;
  if (cam && cam.object3D) { const cw = new THREE.Vector3(); cam.object3D.getWorldPosition(cw); yaw = Math.atan2(cw.x - pos.x, cw.z - pos.z); }
  w.object3D.rotation.set(0, yaw, 0);
  w.object3D.scale.setScalar(S.mode === 'AR' ? AR_SCALE : 1);
  ROOM.anchorSet = true;
}
function anchorFallback(floorOffsetY) {
  // Anchor ~1.15m in front of the user's start point (reference-space origin),
  // facing back at the user. Deterministic even without hit-test.
  const cam = $('cam'); let dir = new THREE.Vector3(0, 0, -1);
  if (cam && cam.object3D) { cam.object3D.getWorldDirection(dir); dir.y = 0; if (dir.lengthSq() < 0.001) dir.set(0, 0, -1); dir.normalize(); }
  anchorWorldAt(new THREE.Vector3(dir.x * 1.15, 0, dir.z * 1.15), floorOffsetY || 0);
}
function restoreWorldIdentity() {
  const w = worldEl(); if (!w) return;
  w.object3D.position.set(0, 0, 0); w.object3D.rotation.set(0, 0, 0); w.object3D.scale.setScalar(1);
  ROOM.anchorSet = false;
}
async function enterAR() {
  if (!sceneEl) { toast('The 3D scene is still loading — one moment.'); return; }
  let supported = false;
  try { supported = !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar'))); } catch (e) { supported = false; }
  if (!supported) {
    toast('Room Mode (AR) is not available in this browser/device — opening Deck Mode instead.', 4600);
    renderSystemLine('Room Mode (AR) is not supported here, so I opened the Deck instead. Nothing about your room was scanned or sent anywhere.');
    return enterVR();
  }
  try { if (sceneEl.enterAR) await sceneEl.enterAR(); else await sceneEl.enterVR(); }
  catch (e) { toast('Room Mode could not start — Deck Mode is the fallback.'); return enterVR(); }
}
async function enterVR() {
  if (!sceneEl) { toast('The 3D scene is still loading — one moment.'); return; }
  try { await sceneEl.enterVR(); } catch (e) { toast('VR could not start in this browser. The full app still works right here in 2D.'); }
}
function onEnterVR() {
  if (!sceneEl) return;
  const isAR = sceneEl.is('ar-mode');
  S.mode = isAR ? 'AR' : 'VR';
  xrSession = sceneEl.xrSession || null;
  if (isAR) {
    applyARPresentation();
    setupHitTest();
    if (xrSession) xrSession.addEventListener('select', onXRSelect);
    const off = (ROOM.data && ROOM.data.floorOffsetY) || 0;
    if (pendingWizard) { pendingWizard = false; startWizard('place'); }
    else if (pendingRecenter) { pendingRecenter = false; anchorFallback(off); ROOM.active = (ROOM.useSaved && ROOM.data) ? ROOM.data.polygon : quickPolygon(); buildBoundaryViz(); roomNote('Room re-centered to where you stand ✓'); }
    else if (!ROOM.data) { startWizard('place'); }
    else if (ROOM.useSaved) { anchorFallback(off); ROOM.active = ROOM.data.polygon; buildBoundaryViz(); roomNote('Room loaded ✓ — saved ' + fmtDate(ROOM.data.savedAt) + '. Buddies will stay inside your saved area.'); }
    else { anchorFallback(0); ROOM.active = quickPolygon(); buildBoundaryViz(); roomNote('Using the quick default area (your saved room is off in Settings).'); }
  } else {
    applyDeckPresentation(); restoreWorldIdentity();
  }
  updateControlUI();
}
function onExitVR() {
  S.mode = '2D'; xrSession = null; hitTestSource = null; hitTestOK = false; lastHit = null;
  applyDeckPresentation(); restoreWorldIdentity();
  const r = $('reticle'); if (r) r.setAttribute('visible', 'false');
  if (WIZ.active) closeWizard(true);
  updateControlUI();
}
async function setupHitTest() {
  hitTestOK = false; lastHit = null;
  if (!xrSession) return;
  try {
    const viewerSpace = await xrSession.requestReferenceSpace('viewer');
    hitTestSource = await xrSession.requestHitTestSource({ space: viewerSpace });
    hitTestOK = true;
    xrSession.requestAnimationFrame(hitLoop);
  } catch (e) { hitTestOK = false; }
}
function needsHit() { return S.mode === 'AR' && WIZ.active && (WIZ.step === 'place' || WIZ.step === 'scan'); }
function hitLoop(t, frame) {
  if (!xrSession) return;
  if (needsHit() && hitTestSource && frame) {
    try {
      const ref = sceneEl.renderer.xr.getReferenceSpace();
      const results = frame.getHitTestResults(hitTestSource);
      const ret = $('reticle');
      if (results.length) {
        const pose = results[0].getPose(ref);
        lastHit = { pos: new THREE.Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z),
                    quat: new THREE.Quaternion(pose.transform.orientation.x, pose.transform.orientation.y, pose.transform.orientation.z, pose.transform.orientation.w) };
        if (ret) { ret.object3D.position.copy(lastHit.pos); ret.object3D.quaternion.copy(lastHit.quat); ret.setAttribute('visible', 'true'); }
      } else { lastHit = null; if (ret) ret.setAttribute('visible', 'false'); }
    } catch (e) {}
  } else { const ret = $('reticle'); if (ret) ret.setAttribute('visible', 'false'); }
  if (xrSession) xrSession.requestAnimationFrame(hitLoop);
}
function onXRSelect() {
  if (!WIZ.active || S.mode !== 'AR') return;
  if (WIZ.step === 'place' && lastHit) { anchorWorldAt(lastHit.pos, WIZ.floorNudge); WIZ.step = (WIZ.afterPlace === 'height') ? 'height' : 'scan'; renderWizard(); }
  else if (WIZ.step === 'scan' && lastHit) { addScanPoint(lastHit.pos); }
}

/* =====================================================================
   ROOM SETUP — guided scan + height check + saved room (spec addition)
   Honest by design: this is a GUIDED setup. WebXR pages cannot do
   Meta's automatic whole-room mesh scan.
   ===================================================================== */
const ROOM = {
  data: LS.get('room', null),
  useSaved: LS.get('roomUseSaved', true),
  active: null, anchorSet: false
};
function quickPolygon() {
  const pts = []; const cx = 0, cz = 0.6, r = 1.7;
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; pts.push([cx + Math.sin(a) * r, cz + Math.cos(a) * r]); }
  return pts;
}
function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if (((zi > z) !== (zj > z)) && (x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
}
function polyCentroid(poly) {
  let x = 0, z = 0; poly.forEach((p) => { x += p[0]; z += p[1]; });
  return { x: x / poly.length, z: z / poly.length };
}
function pickWaypoint() {
  const poly = (S.mode === 'AR' && ROOM.active && ROOM.active.length >= 3) ? ROOM.active : null;
  if (poly) {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    poly.forEach((p) => { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); });
    for (let i = 0; i < 14; i++) {
      const x = minX + Math.random() * (maxX - minX), z = minZ + Math.random() * (maxZ - minZ);
      if (pointInPoly(x, z, poly)) return { x, z };
    }
    return polyCentroid(poly);
  }
  return { x: -2.4 + Math.random() * 4.8, z: -0.6 + Math.random() * 2.7 };
}
function spotlightPos() {
  const s = { x: 0, z: 1.6 };
  if (S.mode === 'AR' && ROOM.active && ROOM.active.length >= 3 && !pointInPoly(s.x, s.z, ROOM.active)) return polyCentroid(ROOM.active);
  return s;
}
function buildBoundaryViz() {
  const w = worldEl(); if (!w || typeof THREE === 'undefined') return;
  let viz = $('boundaryViz');
  if (viz) { viz.parentNode.removeChild(viz); }
  const poly = (WIZ.active && WIZ.step === 'scan' && WIZ.points.length) ? WIZ.points : ROOM.active;
  if (!poly || poly.length < 2) return;
  viz = document.createElement('a-entity'); viz.id = 'boundaryViz';
  w.appendChild(viz);
  const pts = poly.map((p) => new THREE.Vector3(p[0], 0.03, p[1]));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: 0xE8A33D }));
  viz.object3D.add(line);
  if (poly.length >= 3) {
    const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], p[1])));
    const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0xE8A33D, transparent: true, opacity: 0.07, side: THREE.DoubleSide }));
    fill.rotation.x = -Math.PI / 2; fill.position.y = 0.02; viz.object3D.add(fill);
  }
  (WIZ.active && WIZ.step === 'scan' ? WIZ.points : []).forEach((p) => {
    const s = document.createElement('a-sphere');
    s.setAttribute('radius', '0.045'); s.setAttribute('position', p[0] + ' 0.05 ' + p[1]);
    s.setAttribute('material', 'color:#E8A33D; emissive:#E8A33D; emissiveIntensity:1.4');
    viz.appendChild(s);
  });
}
function roomNote(msg) { toast(msg, 4200); if (typeof drawControlPanel === 'function') { S.roomNote = msg; drawControlPanel(); } renderSystemLine(msg); }
function updateRoomStatus() {
  const el = $('roomStatus'); if (!el) return;
  const t = $('roomToggle'); if (t) t.textContent = ROOM.useSaved ? 'ON' : 'OFF';
  if (!ROOM.data) { el.textContent = 'Room: not set up yet — tap Rescan room, or open Room Mode (AR) and the setup starts by itself.'; return; }
  el.textContent = 'Room: ' + (ROOM.data.type === 'scan' ? 'scanned boundary (' + ROOM.data.polygon.length + ' corners)' : 'quick setup area') +
    ' · saved ' + fmtDate(ROOM.data.savedAt) + (ROOM.data.eyeHeightM ? ' · eye level ' + fmtFtIn(ROOM.data.eyeHeightM) : '') +
    ' · floor offset ' + Math.round((ROOM.data.floorOffsetY || 0) * 100) + ' cm' + (ROOM.useSaved ? '' : ' · SAVED ROOM IS OFF (quick area used instead)');
}
function measureEyeHeight() {
  const cam = $('cam'), w = worldEl();
  if (!cam || !w || !cam.object3D || S.mode !== 'AR') return null;
  const cw = new THREE.Vector3(); cam.object3D.getWorldPosition(cw);
  const ww = new THREE.Vector3(); w.object3D.getWorldPosition(ww);
  const eye = cw.y - ww.y;
  return (eye > 0.7 && eye < 2.6) ? eye : null;
}

/* ---------------- the wizard (one state machine, two faces) ---------------- */
const WIZ = { active: false, step: 'place', points: [], floorNudge: 0, afterPlace: 'scan', type: 'scan', heightTimer: null };
function startWizard(step) {
  WIZ.active = true; WIZ.step = step || 'place'; WIZ.points = [];
  WIZ.floorNudge = (ROOM.data && ROOM.data.floorOffsetY) || 0;
  WIZ.afterPlace = 'scan'; WIZ.type = 'scan';
  if (WIZ.step === 'height' && S.mode === 'AR' && !ROOM.anchorSet) { /* height-only: anchor first behind the scenes */ anchorFallback(WIZ.floorNudge); }
  renderWizard();
}
function closeWizard(silent) {
  WIZ.active = false;
  if (typeof hlGuideForStep === 'function') hlGuideForStep();
  clearInterval(WIZ.heightTimer);
  const ov = $('roomWizard'); if (ov) ov.classList.remove('open');
  const wz = $('wizard3d'); if (wz) wz.setAttribute('visible', 'false');
  buildBoundaryViz();
  if (!silent) toast('Room Setup closed — you can finish any time in Settings → Room Setup.');
}
function wizardButtons() {
  const inAR = S.mode === 'AR';
  if (WIZ.step === 'place') return [
    { label: 'Use quick placement', fn: () => { anchorFallback(WIZ.floorNudge); WIZ.step = (WIZ.afterPlace === 'height') ? 'height' : 'scan'; renderWizard(); } },
    { label: 'Quick setup instead', fn: wizardQuick },
    { label: 'Skip setup', fn: () => { ROOM.active = quickPolygon(); closeWizard(); roomNote('Setup skipped — using the quick default area for now.'); } }
  ];
  if (WIZ.step === 'scan') return [
    { label: '✓ Done — use these corners (' + WIZ.points.length + ')', fn: () => { if (WIZ.points.length >= 3) { WIZ.type = 'scan'; WIZ.step = 'height'; renderWizard(); } else toast('Tap at least 3 floor corners first — 4 or more is best.'); } },
    { label: '⌫ Undo point', fn: () => { WIZ.points.pop(); buildBoundaryViz(); renderWizard(); } },
    { label: '⚡ Quick setup instead', fn: wizardQuick },
    { label: 'Skip setup', fn: () => { closeWizard(); } }
  ];
  if (WIZ.step === 'height') return [
    { label: 'Floor ▲ up', fn: () => nudgeFloor(0.02) },
    { label: 'Floor ▼ down', fn: () => nudgeFloor(-0.02) },
    { label: '✓ Looks good — save my room', fn: wizardSave }
  ];
  return [{ label: 'Close', fn: () => closeWizard() }];
}
function wizardQuick() {
  WIZ.type = 'quick'; WIZ.points = quickPolygon();
  if (S.mode === 'AR' && !ROOM.anchorSet) anchorFallback(WIZ.floorNudge);
  buildBoundaryViz(); WIZ.step = 'height'; renderWizard();
}
function nudgeFloor(d) {
  WIZ.floorNudge = clamp(WIZ.floorNudge + d, -0.35, 0.35);
  if (S.mode === 'AR' && ROOM.anchorSet) { const w = worldEl(); w.object3D.position.y += d; }
  renderWizardBodyOnly();
}
function addScanPoint(worldPos) {
  const w = worldEl(); if (!w) return;
  const local = w.object3D.worldToLocal(worldPos.clone());
  WIZ.points.push([Math.round(local.x * 100) / 100, Math.round(local.z * 100) / 100]);
  buildBoundaryViz(); renderWizard();
}
function wizardSave() {
  const eye = measureEyeHeight();
  ROOM.data = { type: WIZ.type, polygon: (WIZ.points && WIZ.points.length >= 3) ? WIZ.points : quickPolygon(),
    floorOffsetY: WIZ.floorNudge, eyeHeightM: eye || (ROOM.data && ROOM.data.eyeHeightM) || null, savedAt: nowMs() };
  LS.set('room', ROOM.data);
  ROOM.active = ROOM.data.polygon;
  WIZ.step = 'done'; buildBoundaryViz(); updateRoomStatus(); renderWizard();
}
function wizardTexts() {
  const inAR = S.mode === 'AR';
  if (WIZ.step === 'place') return { title: 'Room Setup · Step 1 of 3 — Place your buddies',
    body: inAR
      ? (hitTestOK ? 'Aim the glowing ring at the floor about <b>2 metres</b> in front of you, then <b>tap / pull the trigger</b> to set the floor.<br><br>This is a <b>guided</b> setup — a web page can\'t do Meta\'s automatic whole-room scan; that comes with a future native build.'
                    : 'This browser couldn\'t do floor detection, so we\'ll place the buddies a fixed distance in front of you and you can nudge the floor in Step 3. Nothing about your room leaves the headset.')
      : 'Room Setup runs inside <b>Room Mode (AR)</b> so the buddies can stand on your real floor. Tap <b>Room Mode (AR)</b> at the top and setup starts automatically — or do a quick setup right here.' };
  if (WIZ.step === 'scan') return { title: 'Room Setup · Step 2 of 3 — Mark your open space',
    body: 'Walk to each <b>corner</b> of your open area, point at the floor, and <b>tap</b> to drop a corner point.<br><br>Points so far: <span class="big">' + WIZ.points.length + '</span> &nbsp;(4 or more is best, 3 minimum). Your buddies will only walk <b>inside</b> these corners.' + (hitTestOK ? '' : '<br><br>Floor detection is unavailable here, so corner-tapping is off — use Quick setup instead.') };
  if (WIZ.step === 'height') { const eye = measureEyeHeight();
    return { title: 'Room Setup · Step 3 of 3 — Height check',
      body: 'Your eye level: <span class="big">' + (eye ? fmtFtIn(eye) : (inAR ? 'measuring…' : 'measured inside Room Mode')) + '</span> above the buddies\' floor.<br><br>Look at the buddies: standing <b>on</b> your floor? If they float or sink, nudge the floor. Current floor offset: <b>' + Math.round(WIZ.floorNudge * 100) + ' cm</b>.' }; }
  return { title: 'Room saved ✓', body: 'Room saved on this headset ' + (ROOM.data ? '(' + fmtDate(ROOM.data.savedAt) + ')' : '') + '. It loads automatically next time; if you start from a different spot, use <b>Re-center</b> in Settings. Your buddies will stay inside your area.<br><br>Reminder of the honest bit: they can\'t see furniture, so keep the area clear.' };
}
function renderWizard() {
  const t = wizardTexts();
  const btns = wizardButtons();
  // HTML face
  const ov = $('roomWizard');
  if (ov) {
    $('wzTitle').textContent = t.title; $('wzBody').innerHTML = t.body;
    const bw = $('wzButtons'); bw.innerHTML = '';
    btns.slice(0, 4).forEach((b, i) => { const el = document.createElement('button'); el.className = i === 0 ? 'sendBtn' : 'miniBtn'; el.textContent = b.label; el.onclick = b.fn; bw.appendChild(el); });
    ov.classList.add('open');
  }
  // in-world face
  const wz = $('wizard3d');
  if (wz) {
    wz.setAttribute('visible', (S.mode === 'AR' || S.mode === 'VR') ? 'true' : 'false');
    if (typeof drawWizardPanel === 'function') drawWizardPanel(t, btns);
  }
  if (typeof hlGuideForStep === 'function') hlGuideForStep();
  clearInterval(WIZ.heightTimer);
  if (WIZ.step === 'height' && S.mode === 'AR') WIZ.heightTimer = setInterval(renderWizardBodyOnly, 1200);
}
function renderWizardBodyOnly() {
  if (!WIZ.active) return;
  const t = wizardTexts();
  const b = $('wzBody'); if (b && $('roomWizard').classList.contains('open')) b.innerHTML = t.body;
  if (typeof drawWizardPanel === 'function') drawWizardPanel(t, wizardButtons());
}
function wireRoomButtons() {
  $('btnRescan').onclick = () => {
    if (S.mode === 'AR') { startWizard('place'); }
    else { pendingWizard = true; startWizard('place'); toast('Setup is open — for the full floor scan, tap Room Mode (AR) and it continues there.', 4200); }
  };
  $('btnHeight').onclick = () => {
    if (S.mode === 'AR') { WIZ.afterPlace = 'height'; startWizard(ROOM.anchorSet ? 'height' : 'place'); }
    else startWizard('height');
  };
  $('btnRecenter').onclick = () => {
    if (S.mode === 'AR') { anchorFallback((ROOM.data && ROOM.data.floorOffsetY) || 0); if (ROOM.useSaved && ROOM.data) ROOM.active = ROOM.data.polygon; buildBoundaryViz(); roomNote('Re-centered ✓ — your saved room now sits where you stand.'); }
    else { pendingRecenter = true; toast('Re-center is set — next time you enter Room Mode, your room re-anchors to where you stand.'); }
  };
  $('btnResetRoom').onclick = () => {
    if (!confirm('Reset your saved room? The boundary, floor and height settings are wiped from this device and setup returns to first-run.')) return;
    ROOM.data = null; LS.del('room'); ROOM.active = null; buildBoundaryViz(); updateRoomStatus();
    toast('Room reset — next Room Mode visit starts the first-run setup.');
  };
  $('roomToggle').onclick = () => {
    ROOM.useSaved = !ROOM.useSaved; LS.set('roomUseSaved', ROOM.useSaved);
    if (!ROOM.useSaved && S.mode === 'AR') { ROOM.active = quickPolygon(); buildBoundaryViz(); }
    updateRoomStatus();
    toast(ROOM.useSaved ? 'Your saved room will be used.' : 'Saved room OFF — the quick default area will be used instead. Your saved room is kept.');
  };
  $('wzClose').onclick = () => closeWizard();
  updateRoomStatus();
}

/* =====================================================================
   PERMISSIONS — first-run gate card + Settings status (spec addition)
   Microphone: a REAL getUserMedia request. Video: there is nothing to
   request — QuestBuddi can never see the room cameras (privacy plus);
   capture permission, where a browser has one, surfaces at first use
   of Screenshot/Record.
   ===================================================================== */
async function requestMic() {
  let status = 'unsupported';
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((tr) => tr.stop());
      status = 'granted';
    }
  } catch (e) { status = 'denied'; }
  const perms = LS.get('perms', {}); perms.mic = status; LS.set('perms', perms);
  paintPerms();
  return status;
}
function paintPerms() {
  const el = $('permMicStatus'); if (!el) return;
  const perms = LS.get('perms', {});
  el.textContent = perms.mic === 'granted' ? 'granted ✓' : perms.mic === 'denied' ? 'denied — text mode works fine' : perms.mic === 'unsupported' ? 'not available in this browser' : 'not asked yet';
}
function maybeShowPermCard() {
  if (LS.get('permsSeen', false)) return;
  const card = $('permCard'); if (!card) return;
  card.classList.add('open');
  $('permContinue').onclick = async () => {
    $('permContinue').textContent = 'Asking…';
    const mic = await requestMic();
    LS.set('permsSeen', true);
    $('permBody').style.display = 'none';
    const sum = $('permSummary'); sum.style.display = 'block';
    sum.innerHTML = '<b>All set — here is where things stand:</b><br>' +
      '🎙️ Microphone: <b>' + (mic === 'granted' ? 'granted ✓ — tap-to-talk is yours' : mic === 'denied' ? 'denied — no problem, typing works everywhere, and you can re-ask in Settings' : 'not available in this browser — typing works everywhere') + '</b><br>' +
      '🎥 Video/capture: <b>nothing to grant</b> — QuestBuddi captures only its own 3D view, only when you tap Screenshot or Record.';
    $('permContinue').style.display = 'none';
    $('permEnter').style.display = 'block';
  };
  $('permEnter').onclick = () => { card.classList.remove('open'); toast('Welcome aboard, Captain. Pick a buddy and say hello.'); };
}

/* =====================================================================
   CAPTURE — Screenshot + screen-record of QuestBuddi' OWN 3D view.
   Room Mode: the canvas is transparent, so captures show buddies and
   panels on transparency. The real room is Quest-private: it is NOT
   in the canvas and NOT in any capture. Quest's built-in recorder
   (Meta button → Record Video) is the way to capture everything.
   ===================================================================== */
function fileStamp() { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); }
function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  try { CAPTURES.push({ kind: /\.(webm|mp4)$/i.test(filename) ? 'rec' : 'shot', url: URL.createObjectURL(blob), name: filename, ts: Date.now() }); } catch (e) {}
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
function takeScreenshot() {
  if (!sceneEl || !sceneEl.renderer) { toast('The 3D view is still loading — try again in a second.'); return; }
  try {
    sceneEl.renderer.render(sceneEl.object3D, sceneEl.camera); // fresh frame, then capture synchronously
    sceneEl.renderer.domElement.toBlob((blob) => {
      if (!blob) { toast('Screenshot did not work in this browser.'); return; }
      downloadBlob(blob, 'aibuddies-' + fileStamp() + '.png');
      toast(S.mode === 'AR'
        ? 'Screenshot saved to your downloads — buddies and panels only. Your room is private to Quest and is never captured.'
        : 'Screenshot saved to your downloads — the full deck view.', 4600);
    }, 'image/png');
  } catch (e) { toast('Screenshot is not available in this browser.'); }
}
const REC = { rec: null, chunks: [], timer: null, startedAt: 0, on: false };
function recSupported() {
  try { return !!(sceneEl && sceneEl.renderer && sceneEl.renderer.domElement.captureStream && window.MediaRecorder); }
  catch (e) { return false; }
}
function toggleRecord() { REC.on ? stopRecord() : startRecord(); }
function startRecord() {
  if (!recSupported()) {
    const msg = "Recording isn't supported in this browser — use the Quest's built-in recording instead (press the Meta button → Record Video). That one captures everything, including your room.";
    toast(msg, 6000); renderSystemLine(msg); return;
  }
  try {
    const stream = sceneEl.renderer.domElement.captureStream(30);
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((mt) => { try { return MediaRecorder.isTypeSupported(mt); } catch (e) { return false; } });
    REC.rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    REC.chunks = [];
    REC.rec.ondataavailable = (e) => { if (e.data && e.data.size) REC.chunks.push(e.data); };
    REC.rec.onstop = () => {
      const type = (REC.rec && REC.rec.mimeType) || 'video/webm';
      downloadBlob(new Blob(REC.chunks, { type }), 'aibuddies-' + fileStamp() + (type.includes('mp4') ? '.mp4' : '.webm'));
      toast(S.mode === 'AR' ? 'Recording saved to your downloads — buddies and panels only; your room was not in it.' : 'Recording saved to your downloads.', 4600);
    };
    REC.rec.start(250);
    REC.on = true; REC.startedAt = nowMs();
    paintRecUI();
    REC.timer = setInterval(paintRecUI, 500);
    toast('Recording QuestBuddi\'s view… tap Record again (or Stop rec) to finish and save.', 3600);
  } catch (e) {
    const msg = "Recording couldn't start in this browser — the Quest's built-in recording always works (Meta button → Record Video).";
    toast(msg, 5500); renderSystemLine(msg);
  }
}
function stopRecord() {
  if (!REC.on) return;
  REC.on = false; clearInterval(REC.timer);
  try { if (REC.rec && REC.rec.state !== 'inactive') REC.rec.stop(); } catch (e) {}
  REC.rec = null; paintRecUI();
}
function paintRecUI() {
  const btn = $('dockRecord'), lb = $('dockRecordLb'), chip = $('btnRecStop');
  const secs = REC.on ? Math.floor((nowMs() - REC.startedAt) / 1000) : 0;
  const mm = String(Math.floor(secs / 60)).padStart(2, '0'), ss = String(secs % 60).padStart(2, '0');
  if (btn) btn.classList.toggle('recording', REC.on);
  if (lb) lb.textContent = REC.on ? ('Stop · ' + mm + ':' + ss) : 'Record';
  if (chip) chip.style.display = REC.on ? 'block' : 'none';
}

/* =====================================================================
   SHARE SCREEN — explicit selector, live sharing state, instant cut.
   The selected source goes onto the in-world big stage display.
   Sharing NEVER starts without the selector + an explicit pick.
   ===================================================================== */
const SHARE = { state: null, img: null, objUrl: '' };
window.SHARE = SHARE;
function openShareSelector() {
  if (S.hudHidden) setHudHidden(false, true);
  const card = sheet(
    '<h3 style="margin:2px 0 4px">Share Screen — pick a source</h3>' +
    '<div class="smallNote" style="margin-bottom:10px">Whatever you pick goes onto the big stage display in the world, with a sharing banner up top. <b>Stop Sharing</b> (or STOP BUDDIES) ends it instantly. Nothing is ever shared without this pick.</div>' +
    '<div class="smallNote" style="font-weight:800;margin-bottom:4px">A AI BUDDIES SCREEN</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:12px">' +
    ['chat', 'crew', 'notes', 'room'].map((s) => '<button class="miniBtn" data-share-screen="' + s + '" style="flex:1;padding:11px 4px">' + ({ chat: '💬 Chat', crew: '🤖 Crew', notes: '📝 Notes & Reminders', room: '🏠 Room Setup' })[s] + '</button>').join('') + '</div>' +
    '<div class="smallNote" style="font-weight:800;margin-bottom:4px">A WEB PAGE</div>' +
    '<div class="dateRow"><input class="fld" id="shareUrl" placeholder="https://example.com" style="margin:0"><button class="sendBtn" id="shareWebGo" style="border-radius:10px;padding:0 16px">Share page</button></div>' +
    '<div class="smallNote" style="margin:4px 0 12px">The page opens in the Browser tile here; the big display shows what\'s on. Some sites block being shown inside other apps — if so, you\'ll get a plain card saying so, never a fake feed.</div>' +
    '<div class="smallNote" style="font-weight:800;margin-bottom:4px">A PHOTO FROM THIS DEVICE</div>' +
    '<button class="miniBtn" id="sharePhotoBtn" style="width:100%;padding:11px">🖼️ Choose a photo…</button>' +
    '<div class="smallNote" style="font-weight:800;margin:12px 0 4px">A GAME YOU\'RE PLAYING</div>' +
    '<button class="miniBtn" id="shareGameBtn" style="width:100%;padding:11px">🎮 A game I\'m playing</button>' +
    '<div id="gameCard"></div>'
  );
  card.querySelectorAll('[data-share-screen]').forEach((b) => { b.onclick = () => startScreenShare(b.dataset.shareScreen); });
  card.querySelector('#shareWebGo').onclick = () => {
    let u = card.querySelector('#shareUrl').value.trim();
    if (!u) { toast('Type or paste a web address first.'); return; }
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    startWebShare(u);
  };
  card.querySelector('#sharePhotoBtn').onclick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => { if (inp.files && inp.files[0]) startPhotoShare(inp.files[0]); };
    inp.click();
  };
  card.querySelector('#shareGameBtn').onclick = () => {
    card.querySelector('#gameCard').innerHTML = '<div class="setBlock" style="margin-top:10px"><h3>🎮 The honest word on games</h3><div class="honest">Horizon OS keeps every game inside its own bubble. No app — QuestBuddi included — can see another game\'s screen from inside VR. Anyone who shows you a "live game feed" in an app like this is faking it.<br><br>The real route is the <b>phase-2 companion</b>: cast your Quest to your phone, and the bot watches the cast <i>there</i> — on the phone, where watching is actually possible. Until then, this card is the whole feature, and it\'s the truth.</div></div>';
    drawBigDisplayCard('🎮 A GAME YOU\'RE PLAYING', ['Horizon OS keeps every game in its own bubble.', 'QuestBuddi cannot see another game\'s screen — no app can.', '', 'The real route is the phase-2 companion:', 'cast the Quest to your phone, and the bot', 'watches the cast there.']);
    buddySay('Real talk on that card: no app in VR can watch your game — the headset keeps games in their own bubble. The phase-2 companion watching your phone cast is the honest version of that dream, and it is on the roadmap.');
  };
}
async function buddySay(text) {
  const pid = S.activePersonaId;
  await addMessage(pid, 'buddy', text);
  if (currentScreen === 'chat' || SCREEN_TO_PAGE[currentScreen] === 'chat') appendMsgToThread('buddy', text, nowMs());
  startSpeaking(pid, text); drawChatPanel();
}
function shareBannerPaint() {
  const b = $('shareBanner');
  if (!b) return;
  if (SHARE.state) { b.classList.add('on'); $('shareBannerText').textContent = "You're sharing: " + SHARE.state.label; }
  else b.classList.remove('on');
  const lb = $('dockShareLb'); if (lb) lb.textContent = SHARE.state ? 'Stop Sharing' : 'Share';
  const db = $('dockShare'); if (db) db.classList.toggle('recording', !!SHARE.state);
}
function beginShare(state) {
  SHARE.state = state;
  S.watchUntil = nowMs() + 5000; // active Buddy turns to watch the big display
  const bs = $('bigScreenEnt'); if (bs) bs.setAttribute('visible', 'true');
  shareBannerPaint();
  S.watchUntil = nowMs() + 5000; // active buddy turns to "watch" the big display
  $('sheetOverlay') && ($('sheetOverlay').style.display = 'none');
}
function endShare(fromStop) {
  if (!SHARE.state) return;
  SHARE.state = null; SHARE.img = null;
  if (SHARE.objUrl) { URL.revokeObjectURL(SHARE.objUrl); SHARE.objUrl = ''; }
  const bs = $('bigScreenEnt'); if (bs) bs.setAttribute('visible', 'false');
  const bt = $('browserTile'); if (bt) { bt.classList.remove('open'); $('btBody').innerHTML = ''; }
  shareBannerPaint();
  if (!fromStop) { toast('Sharing stopped — the big display is clear.'); renderSystemLine('Sharing stopped. The big display is clear.'); }
}
async function startScreenShare(screen) {
  const labels = { chat: 'Chat screen', crew: 'Crew screen', notes: 'Notes & Reminders', room: 'Room Setup' };
  beginShare({ type: 'screen', id: screen, label: labels[screen] });
  navTo(screen === 'crew' ? 'crew' : screen);
  await drawBigDisplay();
  buddySay({ chat: 'Chat is up on the big display — our whole thread, larger than life. Ask me about anything on it.', crew: 'The whole crew is on the big display — ten buddies, five continents. Quite a band, seen all at once.', notes: 'Your notes and reminders are on the big display. I keep them only on this device, but I will happily read them back to you.', room: 'Room Setup is on the big display — that\'s the map of where we\'re allowed to wander in your room.' })[screen];
}
function startWebShare(url) {
  beginShare({ type: 'web', url, label: 'Web page — ' + url });
  const bt = $('browserTile'); const body = $('btBody');
  $('btUrl').textContent = url; body.innerHTML = '';
  const fr = document.createElement('iframe'); fr.src = url; fr.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
  let loaded = false;
  fr.onload = () => { loaded = true; };
  body.appendChild(fr); bt.classList.add('open');
  setTimeout(() => {
    if (SHARE.state && SHARE.state.type === 'web' && !loaded) {
      body.innerHTML = '<div style="padding:22px;text-align:center;line-height:1.6">This site won\'t display inside QuestBuddi — many sites block it.<br><b>Open it in the Quest Browser tile instead</b>, and I\'ll keep you company from the big display.</div>';
    }
  }, 4500);
  drawBigDisplay();
  buddySay('That page is on the big display card and open in the Browser tile. Straight talk: I can\'t read most sites from in here — if you want my take, tell me what it says, or ask me and I\'ll try a fetch.');
}
function startPhotoShare(file) {
  const url = URL.createObjectURL(file);
  SHARE.objUrl = url;
  const img = new Image();
  img.onload = () => { SHARE.img = img; drawBigDisplay(); };
  img.src = url;
  beginShare({ type: 'photo', label: 'Photo — ' + (file.name || 'your photo') });
  const bt = $('browserTile'); const body = $('btBody');
  $('btUrl').textContent = file.name || 'Photo';
  body.innerHTML = ''; const im = document.createElement('img'); im.src = url; body.appendChild(im);
  bt.classList.add('open');
  buddySay('Oh, that\'s lovely on the big display. I\'ll be honest — my built-in eyes can\'t study a photo; I just get to enjoy it with you. Tell me the story behind it?');
}
async function drawBigDisplay() {
  if (!SHARE.state || typeof paintBigScreen !== 'function') return;
  if (SHARE.state.type === 'screen') paintBigScreenScreen(SHARE.state.id);
  else if (SHARE.state.type === 'web') drawBigDisplayCard('🌐 NOW SHOWING IN THE BROWSER TILE', [SHARE.state.url, '', 'The page itself lives in the Browser tile —', 'many sites block being embedded elsewhere.', '', 'Ask your buddy about it any time.']);
  else if (SHARE.state.type === 'photo') paintBigScreenPhoto();
}
function drawBigDisplayCard(title, lines) {
  beginShare(SHARE.state || { type: 'card', label: title });
  if (typeof paintBigScreen === 'function') paintBigScreen((ctx, w, h) => {
    ctx.fillStyle = '#f5ecd7'; ctx.font = '800 54px "Arial Narrow", Arial'; ctx.textAlign = 'center';
    ctx.fillText(title, w / 2, 120);
    ctx.font = '500 40px "Arial Narrow", Arial'; ctx.fillStyle = '#e8dcc0';
    lines.forEach((ln, i) => ctx.fillText(ln, w / 2, 230 + i * 56));
  });
  shareBannerPaint();
}
async function askAboutShare() {
  if (!SHARE.state) { toast('Nothing is being shared right now.'); return; }
  const st = SHARE.state; const idn = identityOf(S.activePersonaId);
  if (st.type === 'screen' && st.id === 'chat') {
    const conv = await ensureConversation(S.activePersonaId); const msgs = await messagesOf(conv.id);
    buddySay('Quick summary of our thread: ' + msgs.length + ' messages so far, most recently: "' + (msgs.length ? msgs[msgs.length - 1].text.slice(0, 120) : 'nothing yet') + '" — it\'s all saved on this device and searchable from the Search screen.');
  } else if (st.type === 'screen' && st.id === 'crew') {
    buddySay('The crew: ' + PERSONAS.map((p) => identityOf(p.id).nickname + ' (' + identityOf(p.id).homeCity + ')').join(', ') + '. Ten buddies, five continents — and I, ' + idn.nickname + ', am biased but excellent company.');
  } else if (st.type === 'screen' && st.id === 'notes') {
    const notes = await store.all('notes');
    buddySay(notes.length ? 'You have ' + notes.length + ' note(s)/reminder(s): ' + notes.slice(0, 5).map((n) => '"' + n.text + '"').join(', ') + '. All stored only on this device.' : 'Your notes page is empty right now — dictate one and I\'ll keep it safe on this device.');
  } else if (st.type === 'screen' && st.id === 'room') {
    buddySay(ROOM.data ? 'Your saved room: a ' + (ROOM.data.type === 'scan' ? 'scanned' : 'quick') + ' area with ' + ROOM.data.polygon.length + ' corners, saved ' + fmtDate(ROOM.data.savedAt) + '. We only walk inside it in Room Mode, and we can\'t see your furniture — the honest setup.' : 'No room is saved yet — Room Setup is still waiting for its first run inside Room Mode.');
  } else if (st.type === 'web') {
    try {
      const r = await fetch(st.url); const html = await r.text();
      const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
      buddySay(text ? 'I managed to fetch a peek at that page. In short: ' + text.slice(0, 420) + '…' : 'I fetched the page but couldn\'t pull readable text from it — tell me the headline and I\'ll chew on it with you.');
    } catch (e) {
      buddySay('I tried to fetch that page and the web said no (sites often block it). I won\'t fake a summary — tell me what it says and you\'ll get my honest take.');
    }
  } else if (st.type === 'photo') {
    buddySay('About that photo — my honest limit stands: offline, I can\'t truly see pictures. I can react like a friend ("nice — tell me about it"), and if you ever switch on Live AI with a vision-capable provider, real descriptions become possible. Until then: tell me about it?');
  }
}

/* =====================================================================
   3D WORLD — A-Frame scene: cute chibi buddy bots on a retro
   space-noir jazz-lounge deck (Deck Mode) / your room (Room Mode).
   All visuals are original procedural geometry + canvas textures.
   Rendering: antialias on (markup), pixel ratio = device (cap 2),
   canvas textures ≈620 px per metre with anisotropy — razor sharp.
   ===================================================================== */
const TEX = {};           // named canvas textures {c, ctx, tex, mesh}
const BOTS = {};          // pid -> bot rig refs
let maxAniso = 4;
function makeTex(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = maxAniso;
  return { c, ctx: c.getContext('2d'), tex };
}
function bindTex(el, t) {
  if (!el) return null;
  const mesh = el.getObject3D('mesh'); if (!mesh) return null;
  mesh.material = new THREE.MeshBasicMaterial({ map: t.tex, transparent: true, side: THREE.DoubleSide });
  return mesh;
}
function wrapText(ctx, text, x, y, maxW, lineH, maxLines) {
  const words = String(text || '').split(/\s+/); let line = '', yy = y, n = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy); yy += lineH; n++; line = words[i];
      if (maxLines && n >= maxLines - 1) { line = words.slice(i).join(' '); break; }
    } else line = test;
  }
  if (line) { if (maxLines && n >= maxLines - 1 && ctx.measureText(line).width > maxW) { while (line.length && ctx.measureText(line + '…').width > maxW) line = line.slice(0, -1); line += '…'; } ctx.fillText(line, x, yy); yy += lineH; }
  return yy;
}
const COND = '"Arial Narrow","Liberation Sans Narrow",Arial,sans-serif';
const CREAM = '#f5ecd7', DIMC = '#cbbfa5', AMBER = '#E8A33D', BRASS = '#c9973f', TEALB = '#37c8e0';
function frameBase(ctx, w, h, title, accent) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#10242b'); g.addColorStop(1, '#08161b');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = BRASS; ctx.lineWidth = 5; ctx.strokeRect(10, 10, w - 20, h - 20);
  ctx.strokeStyle = 'rgba(201,151,63,.45)'; ctx.lineWidth = 2; ctx.strokeRect(24, 24, w - 48, h - 48);
  ctx.fillStyle = BRASS;
  [[34, 34], [w - 34, 34], [34, h - 34], [w - 34, h - 34]].forEach((p) => { ctx.beginPath(); ctx.arc(p[0], p[1], 6, 0, 7); ctx.fill(); });
  if (title) {
    ctx.fillStyle = accent || AMBER; ctx.font = '800 40px ' + COND; ctx.textAlign = 'left';
    try { ctx.letterSpacing = '3px'; } catch (e) {}
    ctx.fillText(title.toUpperCase(), 44, 66);
    ctx.fillStyle = 'rgba(232,163,61,.5)'; ctx.fillRect(44, 82, w - 88, 3);
    try { ctx.letterSpacing = '0px'; } catch (e) {}
  }
}
/* ---------- panel painters ---------- */
function drawTitleCard() {
  if (!TEX.title) return; const { ctx, c } = TEX.title;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.textAlign = 'center';
  ctx.shadowColor = '#E8A33D'; ctx.shadowBlur = 34;
  ctx.fillStyle = '#ffe9bd'; ctx.font = '900 120px ' + COND;
  ctx.fillText('AI BUDDIES', c.width / 2, 140);
  ctx.shadowBlur = 18; ctx.shadowColor = '#37c8e0'; ctx.fillStyle = '#bff3ff'; ctx.font = '700 52px ' + COND;
  ctx.fillText('B U D D Y   S E S S I O N S', c.width / 2, 225);
  ctx.shadowBlur = 0; ctx.fillStyle = DIMC; ctx.font = '600 34px ' + COND;
  ctx.fillText('GR8YZONE STUDIOS INC. · PANAMA CITY, FL', c.width / 2, 285);
  TEX.title.tex.needsUpdate = true;
}
function drawIdentityPanel() {
  if (!TEX.identity) return; const { ctx, c } = TEX.identity;
  const p = personaById(S.activePersonaId); const idn = identityOf(p.id);
  frameBase(ctx, c.width, c.height, '', AMBER);
  ctx.textAlign = 'left';
  ctx.fillStyle = AMBER; ctx.font = '800 34px ' + COND;
  ctx.fillText(S.mode === 'AR' ? '★ LIVE IN YOUR ROOM — NOW ON STAGE' : '★ NOW ON STAGE', 48, 84);
  ctx.fillStyle = CREAM; ctx.font = '900 92px ' + COND;
  wrapText(ctx, idn.name, 48, 196, c.width - 96, 96, 1);
  ctx.fillStyle = TEALB; ctx.font = '700 44px ' + COND;
  ctx.fillText((idn.homeCity + ', ' + idn.homeCountry).toUpperCase(), 48, 262);
  ctx.fillStyle = DIMC; ctx.font = '600 36px ' + COND;
  wrapText(ctx, idn.expertise.join('  ·  '), 48, 322, c.width - 96, 42, 2);
  ctx.fillStyle = CREAM; ctx.font = 'italic 500 42px Georgia,serif';
  wrapText(ctx, '"' + idn.greeting + '"', 48, 440, c.width - 96, 52, 3);
  ctx.font = '600 32px ' + COND; ctx.fillStyle = S.controlOn ? '#3ddc74' : '#ff6b5e';
  ctx.fillText(S.controlOn ? '● BUDDIES CONTROL: ON' : '● BUDDIES CONTROL: OFF', 48, c.height - 52);
  ctx.fillStyle = DIMC; ctx.textAlign = 'right';
  ctx.fillText((p.loves ? '♥ ' + p.loves.split('—')[0].split(',')[0] : ''), c.width - 48, c.height - 52);
  TEX.identity.tex.needsUpdate = true;
}
let lastThreadCache = [];
function drawChatPanel() {
  if (!TEX.chat) return; const { ctx, c } = TEX.chat;
  const idn = identityOf(S.activePersonaId);
  frameBase(ctx, c.width, c.height, 'Chat — ' + idn.nickname, TEALB);
  ctx.textAlign = 'left';
  const msgs = lastThreadCache.slice(-7);
  let y = 150;
  if (!msgs.length) { ctx.fillStyle = DIMC; ctx.font = '500 38px ' + COND; ctx.fillText('No messages yet — say hello!', 48, y + 30); }
  msgs.forEach((m) => {
    const mine = m.role === 'user';
    ctx.fillStyle = mine ? '#7fd8e8' : AMBER; ctx.font = '800 30px ' + COND;
    ctx.fillText(mine ? 'YOU' : idn.name.toUpperCase(), 48, y);
    ctx.fillStyle = CREAM; ctx.font = '500 40px Arial';
    y = wrapText(ctx, m.text, 48, y + 46, c.width - 96, 48, 3) + 26;
  });
  ctx.fillStyle = 'rgba(203,191,165,.75)'; ctx.font = '600 30px ' + COND;
  ctx.fillText('Type on the flat panel — your own keyboard does the typing.', 48, c.height - 44);
  TEX.chat.tex.needsUpdate = true;
}
function drawControlPanel() {
  if (!TEX.control) return; const { ctx, c } = TEX.control;
  frameBase(ctx, c.width, c.height, 'Buddies Control', S.controlOn ? '#3ddc74' : '#ff6b5e');
  ctx.textAlign = 'left';
  ctx.font = '900 92px ' + COND; ctx.fillStyle = S.controlOn ? '#3ddc74' : '#ff6b5e';
  ctx.fillText(S.controlOn ? 'CONTROL: ON' : 'CONTROL: OFF', 48, 190);
  ctx.fillStyle = CREAM; ctx.font = '600 38px ' + COND;
  const lines = S.controlOn
    ? ['Your buddies can:', '· listen when you tap the mic (Voice Chat on)', '· remember what you share, on this device', '· wander the stage and this world', '· watch the big display with you', '', 'They can NOT run your whole headset —', 'that is the phase-2 bridge. No faking it.']
    : ['Press GIVE BUDDIES CONTROL (green)', 'to switch your buddies on.', '', 'STOP BUDDIES (red) halts everything', 'instantly — mic, replies, walking, sharing.', '', 'Mode: ' + (S.mode === 'AR' ? 'Room Mode (AR)' : S.mode === 'VR' ? 'Deck Mode (VR)' : 'Flat / 2D')];
  lines.forEach((ln, i) => ctx.fillText(ln, 48, 268 + i * 50));
  ctx.fillStyle = AMBER; ctx.font = '700 34px ' + COND;
  const foot = S.roomNote || ('Voice Chat: ' + (voiceOn() ? 'ON 🎙️' : 'OFF 🔇') + ' · Mode: ' + (S.mode === 'AR' ? 'Room (AR)' : S.mode === 'VR' ? 'Deck (VR)' : '2D'));
  wrapText(ctx, foot, 48, c.height - 92, c.width - 96, 42, 2);
  TEX.control.tex.needsUpdate = true;
}
function drawWizardPanel(t, btns) {
  if (!TEX.wizard) return; const { ctx, c } = TEX.wizard;
  frameBase(ctx, c.width, c.height, 'Room Setup', AMBER);
  ctx.fillStyle = CREAM; ctx.font = '800 46px ' + COND; ctx.textAlign = 'left';
  wrapText(ctx, t.title.replace(/^Room Setup · /, ''), 48, 150, c.width - 96, 54, 2);
  ctx.font = '500 38px Arial'; ctx.fillStyle = '#e8dcc0';
  const plain = t.body.replace(/<br><br>/g, '\n\n').replace(/<br>/g, '\n').replace(/<[^>]+>/g, '');
  let y = 250; plain.split('\n').forEach((para) => { if (para.trim()) y = wrapText(ctx, para, 48, y, c.width - 96, 48, 4) + 14; });
  TEX.wizard.tex.needsUpdate = true;
  for (let i = 0; i < 4; i++) {
    const b = $('wzB' + i); if (!b) continue;
    const has = btns && btns[i];
    b.setAttribute('visible', has ? 'true' : 'false');
    if (has && TEX['wz' + i]) {
      const f = TEX['wz' + i]; const fx = f.ctx;
      fx.clearRect(0, 0, f.c.width, f.c.height);
      fx.fillStyle = '#0d2a33'; fx.fillRect(0, 0, f.c.width, f.c.height);
      fx.strokeStyle = BRASS; fx.lineWidth = 4; fx.strokeRect(4, 4, f.c.width - 8, f.c.height - 8);
      fx.fillStyle = CREAM; fx.font = '700 34px ' + COND; fx.textAlign = 'center';
      wrapText(fx, btns[i].label.replace(/^[✓⌫⚡]\s*/, ''), f.c.width / 2, 62, f.c.width - 30, 38, 2);
      f.tex.needsUpdate = true;
    }
  }
}
function paintFace(key, text, bg) {
  const t = TEX[key]; if (!t) return; const { ctx, c } = t;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#fff'; ctx.font = '900 52px ' + COND; ctx.textAlign = 'center';
  wrapText(ctx, text, c.width / 2, 88, c.width - 24, 54, 2);
  t.tex.needsUpdate = true;
}
/* ---------- big stage display painters ---------- */
function paintBigScreen(drawFn) {
  if (!TEX.big) return; const { ctx, c } = TEX.big;
  frameBase(ctx, c.width, c.height, '', AMBER);
  drawFn(ctx, c.width, c.height);
  TEX.big.tex.needsUpdate = true;
}
async function paintBigScreenScreen(id) {
  if (id === 'crew') {
    paintBigScreen((ctx, w, h) => {
      ctx.fillStyle = AMBER; ctx.font = '900 64px ' + COND; ctx.textAlign = 'center';
      ctx.fillText('THE BUDDIES — TONIGHT\'S LINEUP', w / 2, 110);
      PERSONAS.forEach((p, i) => {
        const idn = identityOf(p.id); const col = i % 2, row = Math.floor(i / 2);
        const x = 90 + col * (w / 2), y = 210 + row * 150;
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(x + 42, y - 12, 36, 0, 7); ctx.fill();
        ctx.fillStyle = '#08161b'; ctx.font = '900 44px Arial'; ctx.fillText(idn.name.charAt(0), x + 42, y + 4);
        ctx.fillStyle = CREAM; ctx.font = '800 46px ' + COND; ctx.textAlign = 'left';
        ctx.fillText(idn.name, x + 100, y - 16);
        ctx.fillStyle = DIMC; ctx.font = '600 36px ' + COND;
        ctx.fillText(idn.homeCity + ', ' + idn.homeCountry, x + 100, y + 34); ctx.textAlign = 'center';
      });
    });
  } else if (id === 'chat') {
    const conv = await ensureConversation(S.activePersonaId); const msgs = await messagesOf(conv.id);
    paintBigScreen((ctx, w, h) => {
      ctx.fillStyle = AMBER; ctx.font = '900 64px ' + COND; ctx.textAlign = 'center';
      ctx.fillText('CHAT — ' + identityOf(S.activePersonaId).name.toUpperCase(), w / 2, 110);
      ctx.textAlign = 'left'; let y = 220;
      msgs.slice(-6).forEach((m) => {
        ctx.fillStyle = m.role === 'user' ? '#7fd8e8' : AMBER; ctx.font = '800 36px ' + COND;
        ctx.fillText(m.role === 'user' ? 'YOU' : identityOf(S.activePersonaId).nickname.toUpperCase(), 90, y);
        ctx.fillStyle = CREAM; ctx.font = '500 44px Arial';
        y = wrapText(ctx, m.text, 90, y + 54, w - 180, 54, 2) + 30;
      });
    });
  } else if (id === 'notes') {
    const notes = (await store.all('notes')).sort((a, b) => (a.when || a.createdAt) - (b.when || b.createdAt));
    paintBigScreen((ctx, w, h) => {
      ctx.fillStyle = AMBER; ctx.font = '900 64px ' + COND; ctx.textAlign = 'center';
      ctx.fillText('NOTES & REMINDERS', w / 2, 110); ctx.textAlign = 'left';
      let y = 230;
      if (!notes.length) { ctx.fillStyle = DIMC; ctx.font = '500 46px ' + COND; ctx.fillText('No notes yet.', 90, y); }
      notes.slice(0, 7).forEach((n) => {
        ctx.fillStyle = CREAM; ctx.font = '600 46px Arial';
        y = wrapText(ctx, '• ' + n.text + (n.when ? '   (' + fmtDate(n.when) + ' ' + fmtTime(n.when) + ')' : ''), 90, y, w - 180, 56, 2) + 18;
      });
    });
  } else if (id === 'room') {
    paintBigScreen((ctx, w, h) => {
      ctx.fillStyle = AMBER; ctx.font = '900 64px ' + COND; ctx.textAlign = 'center';
      ctx.fillText('ROOM SETUP', w / 2, 110);
      ctx.fillStyle = CREAM; ctx.font = '600 44px ' + COND;
      const lines = ROOM.data
        ? ['Saved room: ' + (ROOM.data.type === 'scan' ? 'scanned boundary' : 'quick area') + ' · ' + ROOM.data.polygon.length + ' corners', 'Saved ' + fmtDate(ROOM.data.savedAt) + (ROOM.data.eyeHeightM ? ' · eye level ' + fmtFtIn(ROOM.data.eyeHeightM) : ''), '', 'Buddies only walk inside your area.', 'They cannot see furniture — keep it clear.', 'Guided setup only: a web page cannot do', "Meta's automatic whole-room scan."]
        : ['No room saved yet.', '', 'Enter Room Mode (AR) and the guided', 'setup starts by itself.'];
      lines.forEach((ln, i) => ctx.fillText(ln, w / 2, 240 + i * 62));
      if (ROOM.data) { // mini-map of the boundary
        const poly = ROOM.data.polygon; let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
        poly.forEach((p) => { mnx = Math.min(mnx, p[0]); mxx = Math.max(mxx, p[0]); mnz = Math.min(mnz, p[1]); mxz = Math.max(mxz, p[1]); });
        const sc = Math.min(360 / (mxx - mnx || 1), 240 / (mxz - mnz || 1));
        ctx.strokeStyle = AMBER; ctx.lineWidth = 4; ctx.beginPath();
        poly.forEach((p, i) => { const x = w - 460 + (p[0] - mnx) * sc, y = 620 + (p[1] - mnz) * sc; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.closePath(); ctx.stroke();
      }
    });
  }
}
function paintBigScreenPhoto() {
  if (!TEX.big || !SHARE.img) return; const { ctx, c } = TEX.big;
  const img = SHARE.img;
  ctx.fillStyle = '#050b0e'; ctx.fillRect(0, 0, c.width, c.height);
  const s = Math.max(c.width / img.width, c.height / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
  ctx.strokeStyle = BRASS; ctx.lineWidth = 6; ctx.strokeRect(8, 8, c.width - 16, c.height - 16);
  ctx.fillStyle = 'rgba(5,11,14,.72)'; ctx.fillRect(0, c.height - 74, c.width, 74);
  ctx.fillStyle = CREAM; ctx.font = '600 34px ' + COND; ctx.textAlign = 'center';
  ctx.fillText('Shared by you · shown only inside QuestBuddi', c.width / 2, c.height - 26);
  TEX.big.tex.needsUpdate = true;
}

/* =====================================================================
   3D BUILD — textures, deck set, cute bots, chips, in-world HUD dock
   ===================================================================== */
function softColor(hex) { const c = new THREE.Color(hex); c.lerp(new THREE.Color('#ffffff'), 0.16); c.offsetHSL(0, -0.07, 0.03); return '#' + c.getHexString(); }
function rugTexture() {
  const t = makeTex(256, 256); const { ctx, c } = t;
  ctx.fillStyle = '#5e1220'; ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#c9973f'; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(128, 128, 112, 0, 7); ctx.stroke();
  ctx.strokeStyle = 'rgba(232,163,61,.5)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(128, 128, 88, 0, 7); ctx.stroke();
  ctx.fillStyle = 'rgba(245,236,215,.16)';
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; ctx.beginPath(); ctx.arc(128 + Math.sin(a) * 99, 128 + Math.cos(a) * 99, 5, 0, 7); ctx.fill(); }
  t.tex.needsUpdate = true; return t;
}
let RUG = null;
function labelTexture(p, active) {
  const idn = identityOf(p.id);
  const t = makeTex(640, 340); const { ctx, c } = t;
  if (active) {
    ctx.fillStyle = '#f5ecd7'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = BRASS; ctx.lineWidth = 8; ctx.strokeRect(10, 10, c.width - 20, c.height - 20);
    ctx.fillStyle = '#b3791f'; ctx.font = '800 34px ' + COND; ctx.textAlign = 'center';
    ctx.fillText('★ NOW ON STAGE ★', c.width / 2, 66);
    ctx.fillStyle = '#20303a'; ctx.font = '900 74px ' + COND;
    wrapText(ctx, idn.name, c.width / 2, 158, c.width - 60, 76, 1);
    ctx.fillStyle = '#065a6e'; ctx.font = '700 42px ' + COND;
    ctx.fillText((idn.homeCity + ', ' + idn.homeCountry).toUpperCase(), c.width / 2, 224);
    ctx.fillStyle = '#6b5a34'; ctx.font = '600 32px ' + COND;
    wrapText(ctx, idn.expertise.slice(0, 2).join(' · '), c.width / 2, 282, c.width - 60, 38, 1);
  } else {
    ctx.fillStyle = 'rgba(8,22,27,.92)'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = 'rgba(201,151,63,.75)'; ctx.lineWidth = 5; ctx.strokeRect(8, 8, c.width - 16, c.height - 16);
    ctx.fillStyle = CREAM; ctx.font = '900 62px ' + COND; ctx.textAlign = 'center';
    wrapText(ctx, idn.name, c.width / 2, 140, c.width - 50, 66, 1);
    ctx.fillStyle = DIMC; ctx.font = '700 40px ' + COND;
    ctx.fillText((idn.homeCity + ', ' + idn.homeCountry).toUpperCase(), c.width / 2, 208);
    ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(c.width / 2, 268, 17, 0, 7); ctx.fill();
  }
  t.tex.needsUpdate = true; return t;
}
function emblemTexture(p) {
  const t = makeTex(160, 160); const { ctx, c } = t;
  ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(80, 80, 76, 0, 7); ctx.fill();
  ctx.strokeStyle = '#f5ecd7'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(80, 80, 68, 0, 7); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = '900 84px Arial'; ctx.textAlign = 'center';
  ctx.fillText(identityOf(p.id).name.charAt(0), 80, 110);
  t.tex.needsUpdate = true; return t;
}
/* ---------------- deck set (Deck Mode only) ---------------- */
const LAMPS = []; let jukeDisc = null, earthMesh = null;
function woodTexture() {
  const t = makeTex(1024, 512); const { ctx, c } = t;
  ctx.fillStyle = '#3a2a1c'; ctx.fillRect(0, 0, c.width, c.height);
  for (let x = 0; x < c.width; x += 128) {
    ctx.fillStyle = (x / 128) % 2 ? '#42301f' : '#382818'; ctx.fillRect(x, 0, 126, c.height);
    ctx.strokeStyle = 'rgba(201,151,63,.35)'; ctx.lineWidth = 2; ctx.strokeRect(x + 6, 10, 114, c.height - 20);
    ctx.fillStyle = 'rgba(201,151,63,.5)';
    [[x + 20, 26], [x + 108, 26], [x + 20, c.height - 26], [x + 108, c.height - 26]].forEach((p) => { ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, 7); ctx.fill(); });
  }
  t.tex.needsUpdate = true; return t;
}
function earthTexture() {
  const t = makeTex(1024, 512); const { ctx, c } = t;
  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, '#1c4d7a'); g.addColorStop(.5, '#2568a3'); g.addColorStop(1, '#173f63');
  ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = 'rgba(94,160,96,.85)';
  for (let i = 0; i < 46; i++) { const x = Math.random() * c.width, y = 70 + Math.random() * 370, r = 14 + Math.random() * 52;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * .55, Math.random() * 3, 0, 7); ctx.fill(); }
  ctx.fillStyle = 'rgba(226,232,220,.9)'; ctx.fillRect(0, 0, c.width, 26); ctx.fillRect(0, c.height - 30, c.width, 30);
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  for (let i = 0; i < 60; i++) { ctx.beginPath(); ctx.ellipse(Math.random() * c.width, Math.random() * c.height, 26 + Math.random() * 60, 6 + Math.random() * 9, 0, 0, 7); ctx.fill(); }
  t.tex.needsUpdate = true; return t;
}
function artTexture(hue, label) {
  const t = makeTex(256, 320); const { ctx, c } = t;
  const g = ctx.createLinearGradient(0, 0, c.width, c.height);
  g.addColorStop(0, 'hsl(' + hue + ',45%,26%)'); g.addColorStop(1, 'hsl(' + ((hue + 60) % 360) + ',55%,14%)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = 'hsla(' + hue + ',80%,72%,.85)'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(128, 130, 62, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(20, 250); ctx.bezierCurveTo(80, 190, 160, 290, 236, 220); ctx.stroke();
  ctx.fillStyle = 'rgba(245,236,215,.85)'; ctx.font = '700 25px ' + COND; ctx.textAlign = 'center';
  ctx.fillText(label, 128, 300);
  t.tex.needsUpdate = true; return t;
}
function neonTexture(lines, color, sub) {
  const t = makeTex(1024, 256); const { ctx, c } = t;
  ctx.clearRect(0, 0, c.width, c.height); ctx.textAlign = 'center';
  ctx.shadowColor = color; ctx.shadowBlur = 30; ctx.strokeStyle = color; ctx.lineWidth = 3;
  ctx.fillStyle = color; ctx.font = '900 96px ' + COND;
  ctx.fillText(lines, c.width / 2, 118);
  ctx.shadowBlur = 14; ctx.font = '700 44px ' + COND; ctx.fillStyle = '#ffe9bd';
  if (sub) ctx.fillText(sub, c.width / 2, 196);
  t.tex.needsUpdate = true; return t;
}
function buildDeckSet() {
  const set = document.createElement('a-entity'); set.id = 'deckSet'; sceneEl.appendChild(set);
  const wood = woodTexture();
  // curved lounge walls flanking the viewport
  [-1, 1].forEach((side) => {
    const wall = document.createElement('a-cylinder');
    wall.setAttribute('radius', '8.2'); wall.setAttribute('height', '5.4'); wall.setAttribute('open-ended', 'true');
    wall.setAttribute('theta-start', side < 0 ? '155' : '-25'); wall.setAttribute('theta-length', '50');
    wall.setAttribute('position', '0 2.7 0'); wall.setAttribute('material', 'side:double; roughness:.8; metalness:.25');
    set.appendChild(wall);
    wall.addEventListener('loaded', () => { const m = wall.getObject3D('mesh'); if (m) { m.material = new THREE.MeshStandardMaterial({ map: wood.tex, roughness: .8, metalness: .25, side: THREE.DoubleSide }); } });
  });
  // valance beam + viewport ring + glass
  const beam = document.createElement('a-box');
  beam.setAttribute('position', '0 4.35 -5.4'); beam.setAttribute('width', '11'); beam.setAttribute('height', '0.5'); beam.setAttribute('depth', '0.35');
  beam.setAttribute('material', 'color:#4a3520; roughness:.7; metalness:.3'); set.appendChild(beam);
  const ring = document.createElement('a-torus');
  ring.setAttribute('position', '0 2.5 -6.4'); ring.setAttribute('radius', '2.5'); ring.setAttribute('radius-tubular', '0.09');
  ring.setAttribute('material', 'color:#c9973f; metalness:.85; roughness:.3'); set.appendChild(ring);
  const glass = document.createElement('a-circle');
  glass.setAttribute('position', '0 2.5 -6.45'); glass.setAttribute('radius', '2.5');
  glass.setAttribute('material', 'color:#9fd8e8; transparent:true; opacity:.07; side:double'); set.appendChild(glass);
  const neon = document.createElement('a-plane');
  neon.setAttribute('position', '0 3.98 -5.15'); neon.setAttribute('width', '3.6'); neon.setAttribute('height', '0.9');
  set.appendChild(neon);
  neon.addEventListener('loaded', () => bindTex(neon, neonTexture('BUDDY SESSIONS', '#37c8e0', 'LIVE · EVERY NIGHT')));
  const np = document.createElement('a-plane');
  np.setAttribute('position', '-4.6 3.2 -3.6'); np.setAttribute('rotation', '0 38 0'); np.setAttribute('width', '2.3'); np.setAttribute('height', '0.58');
  set.appendChild(np);
  np.addEventListener('loaded', () => bindTex(np, neonTexture('♪ NOW PLAYING', '#E8A33D', "the buddies' favorites")));
  // stage platform + rug at the spotlight
  const stage = document.createElement('a-cylinder');
  stage.setAttribute('position', '0 0.035 1.15'); stage.setAttribute('radius', '2.35'); stage.setAttribute('height', '0.07');
  stage.setAttribute('material', 'color:#4a3520; roughness:.65; metalness:.2'); set.appendChild(stage);
  const rug = document.createElement('a-circle');
  rug.setAttribute('position', '0 0.075 1.15'); rug.setAttribute('rotation', '-90 0 0'); rug.setAttribute('radius', '2.2');
  set.appendChild(rug);
  rug.addEventListener('loaded', () => { const m = rug.getObject3D('mesh'); if (m) m.material = new THREE.MeshStandardMaterial({ map: rugTexture().tex, roughness: .9 }); });
  // pendant lamps (one real point light, center)
  [[-1.7, 0.4], [0, 1.3], [1.7, 0.4]].forEach((pos, i) => {
    const lamp = document.createElement('a-entity'); lamp.setAttribute('position', pos[0] + ' 4.6 ' + pos[1]);
    lamp.innerHTML = '<a-cylinder position="0 -0.45 0" radius="0.012" height="0.9" material="color:#222"></a-cylinder>' +
      '<a-cone position="0 -1.0 0" radius="0.21" height="0.24" open-ended="true" material="color:#c9973f; metalness:.8; roughness:.35; side:double"></a-cone>' +
      '<a-sphere position="0 -1.1 0" radius="0.055" material="color:#ffd9a0; emissive:#ffb45e; emissiveIntensity:2.4"></a-sphere>' +
      (i === 1 ? '<a-light type="point" color="#ffc37a" intensity="9" distance="9" position="0 -1.15 0"></a-light>' : '');
    set.appendChild(lamp); LAMPS.push({ el: lamp, phase: i * 2.1 });
  });
  // mic stand prop at stage edge
  const mic = document.createElement('a-entity'); mic.setAttribute('position', '1.5 0 2.1'); mic.setAttribute('rotation', '0 -25 0');
  mic.innerHTML = '<a-cylinder position="0 0.75 0" radius="0.02" height="1.5" material="color:#2b2f36; metalness:.7; roughness:.4"></a-cylinder>' +
    '<a-cylinder position="0.22 1.42 0" rotation="0 0 65" radius="0.014" height="0.6" material="color:#2b2f36; metalness:.7; roughness:.4"></a-cylinder>' +
    '<a-sphere position="0.42 1.56 0" radius="0.06" material="color:#191d22; roughness:.6"></a-sphere>' +
    '<a-cylinder position="0 0.01 0" radius="0.16" height="0.02" material="color:#2b2f36; metalness:.7"></a-cylinder>';
  set.appendChild(mic);
  // jukebox / record corner
  const juke = document.createElement('a-entity'); juke.setAttribute('position', '-4.35 0 -0.7'); juke.setAttribute('rotation', '0 32 0');
  juke.innerHTML = '<a-box position="0 0.55 0" width="0.95" height="1.1" depth="0.5" material="color:#4a2e1c; roughness:.55; metalness:.2"></a-box>' +
    '<a-cylinder position="0 1.1 0" radius="0.475" height="0.5" theta-start="0" theta-length="180" rotation="0 0 90" material="color:#c9973f; metalness:.7; roughness:.35"></a-cylinder>' +
    '<a-plane class="jukeFace" position="0 0.62 0.26" width="0.8" height="0.95"></a-plane>' +
    '<a-cylinder class="jukeDisc" position="0.0 1.34 0" radius="0.3" height="0.02" rotation="0 0 0" material="color:#101216; roughness:.35"></a-cylinder>';
  set.appendChild(juke);
  juke.addEventListener('loaded', () => {
    const face = juke.querySelector('.jukeFace');
    const t = makeTex(512, 608); const { ctx, c } = t;
    ctx.fillStyle = '#1c130b'; ctx.fillRect(0, 0, c.width, c.height);
    const grd = ctx.createLinearGradient(0, 0, 0, 220);
    grd.addColorStop(0, '#E8A33D'); grd.addColorStop(.5, '#37c8e0'); grd.addColorStop(1, '#E8A33D');
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(256, 210, 150, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#f5ecd7'; ctx.beginPath(); ctx.arc(256, 210, 92, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#241708'; ctx.font = '900 54px ' + COND; ctx.textAlign = 'center'; ctx.fillText('SESSION', 256, 200);
    ctx.strokeStyle = '#c9973f'; ctx.lineWidth = 5;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(256, 400 + i * 8, 120 - i * 16, .15 * Math.PI, .85 * Math.PI); ctx.stroke(); }
    ctx.fillStyle = '#0d0f12'; ctx.beginPath(); ctx.arc(150, 500, 52, 0, 7); ctx.arc(362, 500, 52, 0, 7); ctx.fill();
    ctx.strokeStyle = '#c9973f'; [150, 362].forEach((x) => { ctx.beginPath(); ctx.arc(x, 500, 52, 0, 7); ctx.stroke(); });
    t.tex.needsUpdate = true; bindTex(face, t);
    const disc = juke.querySelector('.jukeDisc'); if (disc) jukeDisc = disc;
  });
  // vinyl wall (album-art grid) + art frames
  const vw = document.createElement('a-entity'); vw.setAttribute('position', '-5.9 2.5 -2.6'); vw.setAttribute('rotation', '0 62 0'); set.appendChild(vw);
  const arts = [['45', 'BLUE NOTE'], ['200', 'AFROBEAT'], ['20', 'DUB PLATE'], ['280', 'PIXEL OST'], ['340', 'BOSSA'], ['120', 'SAGAS']];
  arts.forEach((a, i) => {
    const pl = document.createElement('a-plane');
    pl.setAttribute('position', ((i % 3) - 1) * 0.52 + ' ' + (0.55 - Math.floor(i / 3) * 0.62) + ' 0');
    pl.setAttribute('width', '0.46'); pl.setAttribute('height', '0.56');
    vw.appendChild(pl);
    pl.addEventListener('loaded', () => bindTex(pl, artTexture(Number(a[0]), a[1])));
  });
  const fr = document.createElement('a-entity'); fr.setAttribute('position', '5.9 2.5 -2.6'); fr.setAttribute('rotation', '0 -62 0'); set.appendChild(fr);
  [['150', 'CALLIGRAPHY'], ['310', 'AURORA']].forEach((a, i) => {
    const pl = document.createElement('a-plane');
    pl.setAttribute('position', ((i - .5) * 1.05) + ' 0.2 0'); pl.setAttribute('width', '0.85'); pl.setAttribute('height', '1.05');
    fr.appendChild(pl);
    pl.addEventListener('loaded', () => bindTex(pl, artTexture(Number(a[0]), a[1])));
  });
  // Earth + starfield contents
  const sf = $('starfield');
  if (sf && window.THREE) {
    const n = 2200, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const r = 30 + Math.random() * 30, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = Math.abs(r * Math.cos(ph)) * (Math.random() < .85 ? 1 : -0.3); pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sf.object3D.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xcfe8ff, size: 0.14, sizeAttenuation: true, fog: false })));
  }
  const earth = $('earth');
  if (earth && window.THREE) {
    earth.setAttribute('position', '-6.5 -4.4 -19');
    earthMesh = new THREE.Mesh(new THREE.SphereGeometry(5.4, 40, 28), new THREE.MeshStandardMaterial({ map: earthTexture().tex, roughness: .85 }));
    earth.object3D.add(earthMesh);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(5.65, 40, 28), new THREE.MeshBasicMaterial({ color: 0x2b6cb0, transparent: true, opacity: .12, side: THREE.BackSide }));
    earth.object3D.add(glow);
  }
}
/* ---------------- cute buddy bots ---------------- */
function smileMesh() {
  const pts = [[-0.052, 0.004], [-0.028, -0.026], [0, -0.038], [0.028, -0.026], [0.052, 0.004]].map((p) => new THREE.Vector3(p[0], p[1], 0));
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.0105, 6), new THREE.MeshBasicMaterial({ color: 0x8a5a44 }));
}
function buildBot(p, i) {
  const ang = (-58 + i * (116 / (PERSONAS.length - 1))) * Math.PI / 180;
  const home = { x: Math.sin(ang) * 2.8, z: 0.2 - Math.cos(ang) * 2.8 };
  const root = document.createElement('a-entity');
  root.setAttribute('position', home.x + ' 0 ' + home.z); root.classList.add('clickable');
  root.dataset.pid = p.id;
  const homeYaw = Math.atan2(0 - home.x, 3.4 - home.z);
  root.setAttribute('rotation', '0 ' + (homeYaw * 180 / Math.PI) + ' 0');
  const col = softColor(p.color);
  root.innerHTML =
    '<a-cylinder position="0 0.022 0" radius="0.36" height="0.045" material="roughness:.9"></a-cylinder>' +
    '<a-ring class="padRing" position="0 0.048 0" rotation="-90 0 0" radius-inner="0.365" radius-outer="0.41" material="side:double"></a-ring>' +
    '<a-entity class="rigG">' +
      '<a-sphere class="footL" position="-0.11 0.30 0.03" radius="0.055" scale="1 0.62 1.2" material="color:' + p.accent + '; roughness:.6"></a-sphere>' +
      '<a-sphere class="footR" position="0.11 0.30 0.03" radius="0.055" scale="1 0.62 1.2" material="color:' + p.accent + '; roughness:.6"></a-sphere>' +
      '<a-sphere class="bodyMain" position="0 0.55 0" radius="0.30" scale="1 1.04 0.9" material="color:' + col + '; roughness:.5; metalness:.05"></a-sphere>' +
      '<a-sphere class="bellyMain" position="0 0.52 0.13" radius="0.205" scale="1 1.08 0.62" material="color:#f7efdd; roughness:.55"></a-sphere>' +
      '<a-circle class="emblem" position="0 0.60 0.272" radius="0.075"></a-circle>' +
      '<a-entity class="armL" position="-0.285 0.68 0"><a-capsule position="0 -0.10 0" radius="0.045" length="0.13" material="color:' + col + '; roughness:.55"></a-capsule><a-sphere position="0 -0.225 0" radius="0.056" material="color:#f7efdd; roughness:.5"></a-sphere></a-entity>' +
      '<a-entity class="armR" position="0.285 0.68 0"><a-capsule position="0 -0.10 0" radius="0.045" length="0.13" material="color:' + col + '; roughness:.55"></a-capsule><a-sphere position="0 -0.225 0" radius="0.056" material="color:#f7efdd; roughness:.5"></a-sphere></a-entity>' +
      (p.accessory === 'ring' ? '<a-torus position="0 0.80 0" rotation="90 0 0" radius="0.155" radius-tubular="0.042" material="color:' + p.accent + '; roughness:.7"></a-torus>' : '') +
      '<a-entity class="headG" position="0 0.94 0">' +
        '<a-sphere radius="0.235" material="color:#f8f2e4; roughness:.38"></a-sphere>' +
        '<a-sphere position="0 0.012 0" radius="0.243" theta-length="58" material="color:' + col + '; roughness:.5"></a-sphere>' +
        (p.accessory === 'fin' ? '<a-circle position="0 0.075 0.225" rotation="-68 0 0" radius="0.125" material="color:' + col + '; side:double; roughness:.5"></a-circle>' : '') +
        '<a-cylinder position="-0.238 0.01 0" rotation="0 0 90" radius="0.075" height="0.045" material="color:#2b2f36; roughness:.45"></a-cylinder>' +
        '<a-cylinder position="0.238 0.01 0" rotation="0 0 90" radius="0.075" height="0.045" material="color:#2b2f36; roughness:.45"></a-cylinder>' +
        '<a-sphere position="-0.262 0.01 0" radius="0.02" material="color:' + p.accent + '; emissive:' + p.accent + '; emissiveIntensity:1.2"></a-sphere>' +
        '<a-sphere position="0.262 0.01 0" radius="0.02" material="color:' + p.accent + '; emissive:' + p.accent + '; emissiveIntensity:1.2"></a-sphere>' +
        '<a-circle class="faceGlow" position="0 0.01 0.188" radius="0.205" material="transparent:true; opacity:.30"></a-circle>' +
        '<a-circle class="faceP" position="0 0.01 0.199" radius="0.185" material="transparent:true"></a-circle>' +
        (p.accessory === 'antenna' ? '<a-entity position="0 0.235 0"><a-cylinder position="0 0.055 0" radius="0.008" height="0.11" material="color:#8a8f98"></a-cylinder><a-sphere class="charm" position="0 0.125 0" radius="0.034" material="color:' + p.accent + '; emissive:' + p.accent + '; emissiveIntensity:1.5"></a-sphere></a-entity>' : '') +
        (p.accessory === 'halo' ? '<a-torus position="0 0.315 0" rotation="78 0 0" radius="0.145" radius-tubular="0.011" material="color:#ffd97a; emissive:#E8A33D; emissiveIntensity:1.1"></a-torus>' : '') +
      '</a-entity>' +
      '<a-plane class="botLabel" position="0 1.60 0" width="0.98" height="0.52"></a-plane>' +
    '</a-entity>';
  $('botArc').appendChild(root);
  const B = { pid: p.id, root, home, homeYaw, yaw: homeYaw, phase: Math.random() * 9, walk: null, waveUntil: 0, nextBlink: nowMs() + 1500 + Math.random() * 3000, blinkAt: 0, strollReturn: 0 };
  BOTS[p.id] = B;
  root.addEventListener('loaded', () => {
    B.rig = root.querySelector('.rigG'); B.head = root.querySelector('.headG');
    B.eyeL = root.querySelector('.eyeL'); B.eyeR = root.querySelector('.eyeR');
    B.armL = root.querySelector('.armL'); B.armR = root.querySelector('.armR');
    B.footL = root.querySelector('.footL'); B.footR = root.querySelector('.footR');
    B.padRing = root.querySelector('.padRing');
    const pad = root.querySelector('a-cylinder');
    if (pad && pad.getObject3D('mesh')) pad.getObject3D('mesh').material = new THREE.MeshStandardMaterial({ map: (RUG || (RUG = rugTexture())).tex, roughness: .9 });
    if (B.padRing) B.padRing.setAttribute('material', 'color:' + p.accent + '; emissive:' + p.accent + '; emissiveIntensity:.35; side:double');
    const emb = root.querySelector('.emblem'); if (emb) bindTex(emb, emblemTexture(p));
    const lab = root.querySelector('.botLabel');
    B.labelIdle = labelTexture(p, false); B.labelActive = labelTexture(p, true);
    if (lab) { bindTex(lab, B.labelIdle); B.labelMesh = lab.getObject3D('mesh'); }
    B.bodyMain = root.querySelector('.bodyMain'); B.bellyMain = root.querySelector('.bellyMain');
    B.faceMesh = root.querySelector('.faceP');
    const glow = root.querySelector('.faceGlow'); if (glow) glow.setAttribute('material', 'color:' + softColor(p.color) + '; transparent:true; opacity:.30');
    if (B.faceMesh) { bindTex(B.faceMesh, faceTexture(p, 'idle')); B.faceExpr = 'idle'; }
    if (typeof buildSkin === 'function') buildSkin(p, B, root);
    markActiveBot();
  });
  root.addEventListener('click', () => { if (typeof hlResolve === 'function') hlResolve('target'); selectPersona(p.id); });
  return B;
}
function markActiveBot() {
  for (const pid in BOTS) {
    const B = BOTS[pid]; if (!B.labelMesh) continue;
    const active = pid === S.activePersonaId;
    B.labelMesh.material.map = active ? B.labelActive.tex : B.labelIdle.tex;
    B.labelMesh.material.needsUpdate = true;
    if (B.padRing) B.padRing.setAttribute('material', 'emissiveIntensity:' + (active ? '1.5' : '.35'));
  }
}
function botWalkToSpotlight(pid, greet) {
  const B = BOTS[pid]; if (!B || !B.root) return;
  const s = spotlightPos();
  const dx = s.x - B.root.object3D.position.x, dz = s.z - B.root.object3D.position.z;
  if (Math.hypot(dx, dz) < 0.25) { if (greet) B.waveUntil = nowMs() + 1700; return; }
  B.walk = { tx: s.x, tz: s.z, greet: !!greet };
}
function cancelWalks() { for (const pid in BOTS) { const B = BOTS[pid]; if (B.walk) B.walk = { tx: B.home.x, tz: B.home.z, greet: false }; } }
/* ---------------- in-world chips + HUD dock ---------------- */
const CHIP_DEFS = () => CHIPS.concat(['⌨ Type', '🎨 Draw', '🧭 Jump']);
let chipEnts = {};
function buildChips() {
  const row = $('chipRow'); if (!row) return;
  CHIP_DEFS().forEach((label, i) => {
    const col = i % 4, r = Math.floor(i / 4);
    const e = document.createElement('a-entity');
    e.setAttribute('position', ((col - 1.5) * 0.72) + ' ' + (-r * 0.24) + ' 0');
    e.classList.add('clickable');
    e.innerHTML = '<a-box depth="0.03" height="0.19" width="0.66" material="color:#0a1e26; roughness:.4; metalness:.3"></a-box><a-plane class="chipFace" position="0 0 0.017" width="0.64" height="0.17"></a-plane>';
    row.appendChild(e);
    e.addEventListener('loaded', () => {
      const t = makeTex(512, 136); const { ctx, c } = t;
      ctx.fillStyle = '#0a1e26'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.strokeStyle = 'rgba(201,151,63,.7)'; ctx.lineWidth = 4; ctx.strokeRect(4, 4, c.width - 8, c.height - 8);
      ctx.fillStyle = CREAM; ctx.font = '700 44px ' + COND; ctx.textAlign = 'center';
      wrapText(ctx, label, c.width / 2, 84, c.width - 30, 48, 1);
      t.tex.needsUpdate = true; bindTex(e.querySelector('.chipFace'), t);
    });
    e.addEventListener('click', () => {
      if (label === '⌨ Type') { focusTypeInput(); return; }
      if (label === '🎨 Draw') { toggleDrawMode(); return; }
      if (label === '🧭 Jump') { openJumpMap(); return; }
      if (typeof hlResolve === 'function') hlResolve('cta');
      sendUserMessage(label);
    });
    chipEnts[label] = e;
  });
}
const DOCK3D_DEFS = [
  ['home', 'Home', 'M3.5 11.2 12 4l8.5 7.2M5.5 9.8V20h13V9.8'],
  ['chat', 'Chat', 'M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.6 3.8v-3.8H5.5A1.5 1.5 0 0 1 4 14.5z'],
  ['crew', 'Buddies', 'M12 7.5V4M4.5 10a2.5 2.5 0 0 1 2.5-2.5h10A2.5 2.5 0 0 1 19.5 10v7a2.5 2.5 0 0 1-2.5 2.5H7A2.5 2.5 0 0 1 4.5 17z'],
  ['search', 'Search', 'M11 5.2a5.8 5.8 0 1 0 0 11.6 5.8 5.8 0 0 0 0-11.6zM15.4 15.4 20.5 20.5'],
  ['notes', 'Notes', 'M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20zM14 3.5v4h4M9.5 12.5h5M9.5 16h5'],
  ['shot', 'Shot', 'M9.2 7 10.4 4.8h3.2L14.8 7M3 7h18v12.5H3zM12 16.4a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z'],
  ['record', 'Record', 'M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z'],
  ['share', 'Share', 'M6 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2zM17.5 2.9a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2zM17.5 15.9a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2zM8.3 10.8 15.2 6.7M8.3 13.2l6.9 4.1'],
  ['settings', 'Settings', 'M12 8.9a3.1 3.1 0 1 0 0 6.2 3.1 3.1 0 0 0 0-6.2zM12 3.9v3M12 17.1v3M3.9 12h3M17.1 12h3M6.2 6.2l2.1 2.1M15.7 15.7l2.1 2.1M17.8 6.2l-2.1 2.1M8.3 15.7l-2.1 2.1'],
  ['hide', 'Hide HUD', 'M3 12s3.4-6.2 9-6.2c1.5 0 2.9.45 4.1 1.2M21 12s-3.4 6.2-9 6.2c-1.5 0-2.9-.45-4.1-1.2M4 4l16 16']
];
const dock3dEnts = {};
function drawDockIcon(ctx, path, cx, cy, scale, color) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-12, -12);
  ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.fillStyle = 'none';
  ctx.stroke(new Path2D(path)); ctx.restore();
}
function buildDock3D() {
  const dock = $('hudDock'); if (!dock) return;
  DOCK3D_DEFS.forEach((def, i) => {
    const key = def[0];
    const e = document.createElement('a-entity');
    e.setAttribute('position', ((i - (DOCK3D_DEFS.length - 1) / 2) * 0.215) + ' 0 0');
    e.classList.add('clickable'); e.dataset.nav = key;
    e.innerHTML = '<a-box depth="0.02" height="0.125" width="0.20" material="color:#0a1c22; roughness:.35; metalness:.35; transparent:true"></a-box><a-plane class="dockFace" position="0 0 0.012" width="0.195" height="0.12"></a-plane>';
    dock.appendChild(e); dock3dEnts[key] = e;
    e.addEventListener('loaded', () => {
      const t = makeTex(256, 158); const { ctx, c } = t;
      ctx.fillStyle = 'rgba(10,26,32,.92)'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.strokeStyle = 'rgba(201,151,63,.65)'; ctx.lineWidth = 4; ctx.strokeRect(4, 4, c.width - 8, c.height - 8);
      drawDockIcon(ctx, def[2], c.width / 2, 58, 3.4, '#f5ecd7');
      ctx.fillStyle = CREAM; ctx.font = '800 30px ' + COND; ctx.textAlign = 'center';
      ctx.fillText(def[1].toUpperCase(), c.width / 2, 138);
      t.tex.needsUpdate = true; bindTex(e.querySelector('.dockFace'), t);
    });
    e.addEventListener('click', () => dockTap(key));
  });
  // pill faces
  const sp = $('showPillFace'); if (sp) { const t = makeTex(448, 112); paintPillFace(t, 'SHOW HUD', '#bff3ff'); bindTex(sp, t); }
  const tp = $('stopPillFace'); if (tp) { const t = makeTex(448, 112); paintPillFace(t, 'STOP', '#ffffff'); bindTex(tp, t); }
  const pill = $('showPill3d'); if (pill) pill.addEventListener('click', () => setHudHidden(false));
  const spill = $('stopPill3d'); if (spill) spill.addEventListener('click', () => stopAll('Stopped — all buddy functions are off.'));
}
function paintPillFace(t, text, color) {
  const { ctx, c } = t; ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = color; ctx.font = '900 52px ' + COND; ctx.textAlign = 'center';
  ctx.fillText(text, c.width / 2, 74); t.tex.needsUpdate = true;
}
function focusTypeInput() {
  navTo('chat');
  const inp = $('chatInput'); if (inp) { inp.focus(); }
  if (S.mode !== '2D') toast("Typing opens your device's own keyboard — on the flat panel here, and Meta's keyboard in the headset.", 4200);
}
/* ---------------- HUD fade + beacon ---------------- */
S.hudF = 1;
function hudMeshes() {
  const out = [];
  ['panelIdentity', 'panelChat', 'panelControl'].forEach((id) => { const el = $(id); if (el && el.getObject3D('mesh')) out.push(el.getObject3D('mesh')); });
  return out;
}
function applyHud3D() { /* continuous fade is driven by the tick via S.hudF */ }
function setMeshOpacity(mesh, o) { if (!mesh) return; mesh.material.transparent = true; mesh.material.opacity = o; mesh.visible = o > 0.03; }
function updateBeacon3D() {
  const b = $('beaconBall'); if (!b) return;
  b.setAttribute('material', 'color:' + (S.controlOn ? '#1fae54' : '#d92b2b') + '; emissive:' + (S.controlOn ? '#1fae54' : '#d92b2b') + '; emissiveIntensity:2.2');
}
/* ---------------- init 3D ---------------- */
let tickState = { last: 0, strollAt: 20000, recPaintAt: 0 };
function init3D() {
  if (!sceneEl || !sceneEl.renderer || typeof THREE === 'undefined') return;
  try { maxAniso = Math.min(8, sceneEl.renderer.capabilities.getMaxAnisotropy() || 4); } catch (e) {}
  try { sceneEl.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); } catch (e) {}
  TEX.title = makeTex(2048, 340); bindTex($('titleCard'), TEX.title);
  TEX.identity = makeTex(1798, 930); bindTex($('panelIdentity'), TEX.identity);
  TEX.chat = makeTex(1536, 1240); bindTex($('panelChat'), TEX.chat);
  TEX.control = makeTex(1536, 1240); bindTex($('panelControl'), TEX.control);
  TEX.wizard = makeTex(1240, 744); bindTex($('panelWizard'), TEX.wizard);
  TEX.big = makeTex(2048, 1024); bindTex($('bigScreen'), TEX.big);
  for (let i = 0; i < 4; i++) { const b = $('wzB' + i); const f = b && b.querySelector('.wzFace'); if (f) { TEX['wz' + i] = makeTex(512, 160); bindTex(f, TEX['wz' + i]); } }
  TEX.giveFace = makeTex(640, 180); bindTex(document.querySelector('#btnGive3d .btnFace'), TEX.giveFace);
  TEX.stopFace = makeTex(640, 180); bindTex(document.querySelector('#btnStop3d .btnFace'), TEX.stopFace);
  paintFace('giveFace', 'GIVE BUDDIES CONTROL', '#127a3c');
  paintFace('stopFace', 'STOP BUDDIES', '#a11d1d');
  $('btnGive3d').addEventListener('click', () => { if (typeof hlResolve === 'function') hlResolve('target'); giveControl(); });
  $('btnStop3d').addEventListener('click', () => stopAll('Stopped — all buddy functions are off.'));
  $('panelIdentity').addEventListener('click', () => { const B = BOTS[S.activePersonaId]; if (B) B.waveUntil = nowMs() + 1700; navTo('crew'); });
  buildDeckSet();
  buildDeckPolish();
  PERSONAS.forEach((p, i) => buildBot(p, i));
  buildChips(); buildDock3D(); buildHLVisuals(); buildContinue3D(); buildJumpPanel(); buildDrawLayer(); buildWristPanel(); buildPhone(); buildAvatarHolo();
  drawTitleCard(); drawIdentityPanel(); drawChatPanel(); drawControlPanel(); updateBeacon3D(); updateControlUI();
  if (WIZ.active) renderWizard();
  AFRAME.registerComponent('qp-tick', { tick: (time, delta) => tickFrame(Math.min(delta || 16, 60) / 1000, time) });
  sceneEl.setAttribute('qp-tick', '');
}
/* ---------------- the life tick ---------------- */
const _v1 = () => new THREE.Vector3();
function tickFrame(dt, timeMs) {
  const t = timeMs / 1000, now = nowMs();
  // HUD fade
  const target = S.hudHidden ? 0 : 1;
  S.hudF = clamp(S.hudF + (target - S.hudF) * Math.min(1, dt * 7), 0, 1);
  hudMeshes().forEach((m) => setMeshOpacity(m, S.hudF));
  const dock = $('hudDock');
  if (dock) { dock.object3D.visible = S.hudF > 0.03; dock.object3D.scale.setScalar(0.9 + 0.1 * S.hudF); }
  const chipRowEl = $('chipRow'); if (chipRowEl) chipRowEl.object3D.visible = S.hudF > 0.03;
  const sp = $('showPill3d'), tp = $('stopPill3d');
  if (sp) sp.setAttribute('visible', S.hudF < 0.5 ? 'true' : 'false');
  if (tp) tp.setAttribute('visible', S.hudF < 0.5 ? 'true' : 'false');
  // beacon pulse
  const bb = $('beaconBall'); if (bb) { const s = 1 + Math.sin(t * 2.2) * 0.09; bb.object3D.scale.setScalar(s); }
  // lamps sway + juke + earth
  LAMPS.forEach((L) => { if (L.el.object3D) { L.el.object3D.rotation.z = Math.sin(t * 0.7 + L.phase) * 0.03; L.el.object3D.rotation.x = Math.cos(t * 0.55 + L.phase) * 0.02; } });
  if (jukeDisc) jukeDisc.object3D.rotation.y += dt * 1.4;
  if (earthMesh) earthMesh.rotation.y += dt * 0.004;
  // bots
  const cam = $('cam');
  const camWorld = _v1(); if (cam && cam.object3D) cam.object3D.getWorldPosition(camWorld);
  const wEl = worldEl();
  const camLocal = wEl ? wEl.object3D.worldToLocal(camWorld.clone()) : camWorld;
  let anyWalking = false;
  for (const pid in BOTS) {
    const B = BOTS[pid]; if (!B.rig) continue;
    const pos = B.root.object3D.position;
    const isActive = pid === S.activePersonaId;
    const speaking = S.speakingPersona === pid && now < S.speakingUntil;
    const laughing = now < (S.laughUntil[pid] || 0);
    // walking / gliding
    if (B.walk) {
      anyWalking = true;
      const dx = B.walk.tx - pos.x, dz = B.walk.tz - pos.z, dist = Math.hypot(dx, dz);
      if (dist < 0.05) { const g = B.walk.greet; B.walk = null; if (g) B.waveUntil = now + 1700; }
      else {
        const sp = 0.55 * dt; pos.x += (dx / dist) * Math.min(sp, dist); pos.z += (dz / dist) * Math.min(sp, dist);
        B.yaw = lerpAngle(B.yaw, Math.atan2(dx, dz), dt * 6);
        B.phase += dt * 9;
        if (B.footL) B.footL.object3D.position.y = 0.30 + Math.abs(Math.sin(B.phase)) * 0.035;
        if (B.footR) B.footR.object3D.position.y = 0.30 + Math.abs(Math.cos(B.phase)) * 0.035;
        if (B.rig) B.rig.object3D.rotation.x = 0.06;
      }
    } else if (B.rig) B.rig.object3D.rotation.x *= 0.9;
    if (!B.walk) { // face user (active) or home yaw
      const ty = isActive || speaking ? Math.atan2(camLocal.x - pos.x, camLocal.z - pos.z) : B.homeYaw;
      B.yaw = lerpAngle(B.yaw, ty, dt * 3);
    }
    B.root.object3D.rotation.y = B.yaw;
    // hover bob + breathing
    const amp = personaById(pid).laugh.amp;
    let bob = Math.sin(t * 1.5 + B.phase * 0.35) * 0.016;
    if (laughing) bob += Math.abs(Math.sin(t * 15)) * 0.045 * amp;
    if (B.rig) { B.rig.object3D.position.y = bob + (B.hoverLift || 0); B.rig.object3D.rotation.z = Math.sin(t * 0.9 + B.phase) * 0.012; }
    // head: look-at for active/speaking, gentle otherwise
    if (B.head) {
      let targetPt = null;
      if (typeof hlPointWorld === 'function' && hlPointWorld() && (isActive || speaking)) targetPt = hlPointWorld();
      else if (S.watchUntil && now < S.watchUntil && SHARE.state && isActive) { const bs = $('bigScreen'); if (bs) { targetPt = _v1(); bs.object3D.getWorldPosition(targetPt); } }
      else if (isActive || speaking) targetPt = camWorld;
      if (targetPt) {
        const dummy = new THREE.Object3D(); const hp = _v1(); B.head.object3D.getWorldPosition(hp);
        dummy.position.copy(hp); dummy.lookAt(targetPt);
        const pq = new THREE.Quaternion(); B.head.object3D.parent.getWorldQuaternion(pq); pq.invert();
        const localQ = pq.multiply(dummy.quaternion);
        B.head.object3D.quaternion.slerp(localQ, Math.min(1, dt * 5));
        if (speaking) B.head.object3D.rotation.x += Math.sin(t * 2.3) * 0.02;
        if (laughing) B.head.object3D.rotation.x -= 0.16;
      } else {
        B.head.object3D.quaternion.slerp(new THREE.Quaternion(), Math.min(1, dt * 2));
      }
    }
    // mouth: viseme-driven from the face database (the old sine-wave
    // flap is retired). Sample the speech track once per frame; the
    // values feed the dynamic face texture, and a physical mouth
    // mesh (if a skin ever adds one) scales from the same values.
    const mvNow = QBDB.face ? VIS.sample(pid, now) : null;
    B.visemeNow = mvNow;
    if (mvNow) drawDynFace(pid, mvNow, now);
    if (B.mouth) {
      if (mvNow) B.mouth.scale.set(0.55 + mvNow.mouthWidth * 0.9, 0.25 + mvNow.mouthOpen * 1.6, 1);
      else B.mouth.scale.set(1, 1, 1);
    }
    // blink
    if (B.eyeL && B.eyeR) {
      if (now > B.nextBlink) { B.blinkAt = now; B.nextBlink = now + 2200 + Math.random() * 2600; }
      const s = (now - B.blinkAt < 130) ? 0.12 : 1;
      B.eyeL.object3D.scale.y = s; B.eyeR.object3D.scale.y = s;
    }
    // wave
    if (B.armR) {
      if (now < B.waveUntil) B.armR.object3D.rotation.z = -2.25 + Math.sin(t * 9) * 0.32;
      else if (typeof hlPointWorld === 'function' && hlPointWorld() && (isActive || speaking)) B.armR.object3D.rotation.z = -1.35; // point gesture
      else B.armR.object3D.rotation.z += (-0.12 - B.armR.object3D.rotation.z) * Math.min(1, dt * 6);
    }
    if (B.armL) B.armL.object3D.rotation.z = laughing ? Math.sin(t * 15) * 0.25 : 0.12 + Math.sin(t * 1.5 + B.phase) * 0.03;
    // label billboard
    if (B.labelMesh) { const lab = B.root.querySelector('.botLabel'); if (lab) lab.object3D.lookAt(camWorld); }
    // pad ring pulse for active
    if (B.padRing && isActive) B.padRing.setAttribute('material', 'emissiveIntensity:' + (1.3 + Math.sin(t * 2.4) * 0.35));
  }
  // idle stroll (explore companionship)
  if (S.controlOn && now > tickState.strollAt && !anyWalking) {
    tickState.strollAt = now + 26000 + Math.random() * 18000;
    const ids = Object.keys(BOTS).filter((id) => id !== S.activePersonaId && !BOTS[id].walk);
    if (ids.length) { const B = BOTS[ids[Math.floor(Math.random() * ids.length)]]; const wp = pickWaypoint(); B.walk = { tx: wp.x, tz: wp.z, greet: false }; B.strollReturn = now + 14000; }
  }
  for (const pid in BOTS) { const B = BOTS[pid]; if (B.strollReturn && now > B.strollReturn && !B.walk) { B.strollReturn = 0; B.walk = { tx: B.home.x, tz: B.home.z, greet: false }; } }
  // highlight visuals + continue readiness
  if (typeof hlTick === 'function') hlTick(t, dt);
  if (typeof drawTick === 'function') drawTick(dt);
  if (typeof exploreTick === 'function') exploreTick(now);
  if (typeof visualTick === 'function') visualTick(dt, t);
  if (typeof facesTick === 'function') facesTick(now);
  if (typeof wristTick === 'function') wristTick(now);
  if (typeof skinTick === 'function') skinTick(now, t);
  if (typeof avatarTick === 'function') avatarTick(dt, now);
  // record face timer
  if (REC.on && now - tickState.recPaintAt > 600) { tickState.recPaintAt = now; }
}
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
  return a + d * clamp(t, 0, 1);
}

/* =====================================================================
   HIGHLIGHT CUES — electric cyan #00F0FF. Description-linked highlights
   HOLD until resolved by: Continue ▶ / target tap / typing / CTA answer.
   Pure tap-feedback highlights are 'transient' (fade on tap or ~4s).
   ===================================================================== */
const HL = { active: false, target: null, mode: 'desc', spokeAt: 0, spoken: false, frame: null, ring: null, mats: [], domEl: null, onResolve: null, pointFor: null, fadeT: -1 };
function hlEnabled() { return lsGet('hlOn', '1') === '1'; }
function buildHLVisuals() {
  const w = worldEl(); if (!w || typeof THREE === 'undefined') return;
  const mat = () => new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0 });
  const frame = new THREE.Group();
  const bars = {};
  const mk = (w2, h2) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w2, h2, 0.02), mat()); frame.add(m); return m; };
  bars.t = mk(1, 0.035); bars.b = mk(1, 0.035); bars.l = mk(0.035, 1); bars.r = mk(0.035, 1);
  frame.visible = false; w.object3D.add(frame);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.52, 40), new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; ring.visible = false; w.object3D.add(ring);
  HL.frame = frame; HL.ring = ring; HL.bars = bars;
  HL.mats = [bars.t.material, bars.b.material, bars.l.material, bars.r.material, ring.material];
}
function hlPlaceFrame(cx, cy, cz, w2, h2) {
  if (!HL.frame) return;
  HL.frame.position.set(cx, cy, cz);
  HL.bars.t.position.set(0, h2 / 2, 0); HL.bars.t.scale.x = w2;
  HL.bars.b.position.set(0, -h2 / 2, 0); HL.bars.b.scale.x = w2;
  HL.bars.l.position.set(-w2 / 2, 0, 0); HL.bars.l.scale.y = h2;
  HL.bars.r.position.set(w2 / 2, 0, 0); HL.bars.r.scale.y = h2;
}
function hlSetOpacity(o) { HL.mats.forEach((m) => { m.opacity = o; }); if (HL.frame) HL.frame.visible = o > 0.02; if (HL.ring) HL.ring.visible = o > 0.02 && HL.ringOn; }
function hlShow(target, mode, opts) {
  opts = opts || {};
  if (!hlEnabled() && !opts.force) return;
  hlClearVisual();
  HL.active = true; HL.target = target; HL.mode = mode || 'desc'; HL.spokeAt = 0; HL.spoken = false;
  HL.fadeT = -1; HL.onResolve = opts.onResolve || null; HL.pointFor = S.activePersonaId; HL.ringOn = false;
  const doneBtns = [$('hlContinue'), $('hlContinueChip')];
  doneBtns.forEach((b) => { if (b) b.style.display = 'none'; });
  // DOM target?
  const domMap = { settings: document.querySelector('.dockBtn[data-nav="settings"]'), search: document.querySelector('.dockBtn[data-nav="search"]'),
    notes: document.querySelector('.dockBtn[data-nav="notes"]'), share: $('dockShare'), give: $('btnGive'), stop: $('btnStop'),
    daily: $('dailyCards'), chat: $('chatInput'), crew: document.querySelector('.dockBtn[data-nav="crew"]'), myScreen: $('myScreen') };
  HL.domEl = null;
  if (domMap[target]) { HL.domEl = domMap[target]; HL.domEl.classList.add('hl-cue'); }
  // 3D target placement (panel-local coords)
  const W = worldEl();
  const place = { identity: [0, 1.78, -1.62, 1.86, 0.98], chat: [2.02, 1.72, -1.28, 1.56, 1.28], control: [-2.02, 1.72, -1.28, 1.56, 1.28],
    big: [0, 2.05, -3.4, 4.9, 2.5], type: [2.95, 0.79, -1.5, 0.7, 0.23], stop: [1.55, 0.30, -0.9, 0.88, 0.27], give: [-1.55, 0.30, -0.9, 0.88, 0.27],
    settings: [2.04, 0.66, 0.75, 0.24, 0.16], search: [0.65, 0.66, 0.75, 0.24, 0.16], notes: [1.11, 0.66, 0.75, 0.24, 0.16], share: [1.80, 0.66, 0.75, 0.24, 0.16],
    wizard: [0, 1.62, -2.3, 1.7, 1.05], daily: [2.02, 1.72, -1.28, 1.56, 1.28], room: [0, 1.62, -2.3, 1.7, 1.05] };
  if (HL.frame && place[target]) { const p = place[target]; hlPlaceFrame(p[0], p[1], p[2] + 0.03, p[3], p[4]); HL.frameOn = true; } else HL.frameOn = false;
  if (HL.frame && !HL.frameOn) HL.frame.visible = false;
  if (target && target.indexOf('bot:') === 0 && HL.ring) {
    const B = BOTS[target.slice(4)];
    if (B) { HL.ringOn = true; B.root.object3D.add(HL.ring); HL.ring.position.set(0, 0.02, 0); }
  }
  if (HL.mode === 'transient') setTimeout(() => { if (HL.active && HL.target === target && HL.mode === 'transient') hlResolve('timeout'); }, 4000);
}
function hlClearVisual() {
  if (HL.domEl) { HL.domEl.classList.remove('hl-cue'); HL.domEl = null; }
  if (HL.ring && HL.ring.parent) HL.ring.parent.remove(HL.ring);
  hlSetOpacity(0);
  const doneBtns = [$('hlContinue'), $('hlContinueChip'), $('hlContinue3d')];
  doneBtns.forEach((b) => { if (b) b.style.display = 'none'; });
}
function hlRevealContinue() {
  if (!HL.active || HL.mode !== 'desc') return;
  const b1 = $('hlContinue'), b2 = $('hlContinueChip'), b3 = $('hlContinue3d');
  if (b1) b1.style.display = '';
  if (b2) b2.style.display = '';
  if (b3) b3.setAttribute('visible', 'true');
  const B = BOTS[S.activePersonaId]; if (B) B.waveUntil = 0;
}
function hlResolve(how) {
  if (!HL.active) return;
  if (how === 'timeout' && QBDB.pers && typeof GUIDE_RUN !== 'undefined' && GUIDE_RUN.guide) AFF.trigger(S.activePersonaId, 'task_failed');
  HL.fadeT = 0.0001; // tick animates the fade
  const cb = HL.onResolve; HL.onResolve = null;
  if (HL.domEl) { HL.domEl.classList.remove('hl-cue'); HL.domEl = null; }
  const b3 = $('hlContinue3d'); if (b3) b3.setAttribute('visible', 'false');
  const b1 = $('hlContinue'), b2 = $('hlContinueChip'); if (b1) b1.style.display = 'none'; if (b2) b2.style.display = 'none';
  if (cb) setTimeout(cb, 60);
}
function hlTick(t, dt) {
  if (!HL.active && HL.fadeT < 0) return;
  let base = 0.85 + Math.sin(t * 5.6) * 0.15; // ≤ ~0.9 pulses/sec, gentle
  if (HL.fadeT >= 0) {
    HL.fadeT += dt / 0.3;
    const o = Math.max(0, (HL.frameOn || HL.ringOn ? base : 0) * (1 - HL.fadeT));
    hlSetOpacity(o);
    if (HL.fadeT >= 1) { HL.active = false; HL.fadeT = -1; if (HL.ring && HL.ring.parent) HL.ring.parent.remove(HL.ring); if (HL.frame) HL.frame.visible = false; }
    return;
  }
  hlSetOpacity(HL.frameOn || HL.ringOn ? base : 0);
  if (HL.mode === 'desc' && HL.active && !HL.spoken && HL.spokeAt && nowMs() > HL.spokeAt) { HL.spoken = true; hlRevealContinue(); }
}
function hlPointWorld() {
  if (!HL.active || (!HL.frameOn && !HL.ringOn)) return null;
  if (HL.ringOn && HL.ring) { const v = new THREE.Vector3(); HL.ring.getWorldPosition(v); v.y += 0.8; return v; }
  if (HL.frame) { const v = new THREE.Vector3(); HL.frame.getWorldPosition(v); return v; }
  return null;
}
function buildContinue3D() {
  const w = worldEl(); if (!w) return;
  const e = document.createElement('a-entity');
  e.id = 'hlContinue3d'; e.setAttribute('position', '2.95 0.42 -1.5'); e.setAttribute('rotation', '0 -33 0');
  e.setAttribute('visible', 'false'); e.classList.add('clickable');
  e.innerHTML = '<a-box depth="0.03" height="0.24" width="0.82" material="color:#062a33; roughness:.4"></a-box><a-plane class="contFace" position="0 0 0.017" width="0.8" height="0.22"></a-plane>';
  w.appendChild(e);
  e.addEventListener('loaded', () => {
    const t = makeTex(640, 176); const { ctx, c } = t;
    ctx.fillStyle = '#062a33'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = CYAN; ctx.lineWidth = 8; ctx.strokeRect(6, 6, c.width - 12, c.height - 12);
    ctx.fillStyle = CYAN; ctx.font = '900 62px ' + COND; ctx.textAlign = 'center';
    ctx.fillText('CONTINUE ▶', c.width / 2, 112);
    t.tex.needsUpdate = true; bindTex(e.querySelector('.contFace'), t);
  });
  e.addEventListener('click', () => hlResolve('continue'));
}
function hlGuideForStep(step) {
  if (step === 'place') hlShow('room', 'desc');
  else if (step === 'scan') hlShow('room', 'desc');
  else if (step === 'height') hlShow('room', 'desc');
}
const CUE_MAP = [
  [/stop buddies|stop button/i, 'stop'], [/give buddies control|control button/i, 'give'],
  [/tap search|search page|search tab/i, 'search'], [/crew|buddies page|buddies tab/i, 'crew'],
  [/notes/i, 'notes'], [/settings/i, 'settings'], [/share screen|big (screen|display)/i, 'share'],
  [/big display|stage display/i, 'big'], [/type (a|your)|keyboard/i, 'type'], [/room setup/i, 'room'],
  [/daily card|today's groove|science bite|art beat/i, 'daily']
];
function cueForReply(text) {
  if (!hlEnabled()) return;
  for (const [re, target] of CUE_MAP) { if (re.test(text)) { hlShow(target, 'desc'); return; } }
}
/* =====================================================================
   VOICE CHAT — toggle (chat header + Settings mirror), PTT mic, TTS
   ===================================================================== */
function voiceOn() { return lsGet('voiceOn', '0') === '1'; }
function voiceEffective() { return voiceOn() && S.controlOn; }
function refreshVoiceUI() {
  const on = voiceOn(), eff = voiceEffective();
  [$('voiceToggle'), $('voiceToggle2')].forEach((t) => { if (t) t.textContent = on ? 'ON' : 'OFF'; });
  const lbl = $('voiceStateLbl'); if (lbl) lbl.textContent = on ? (eff ? 'Voice chat is ON' : 'Voice chat ON — needs GIVE BUDDIES CONTROL') : 'Voice chat is OFF — text only';
  const hi = $('voiceHudIcon'); if (hi) hi.textContent = eff ? '🎙️' : '🔇';
  const hl2 = $('voiceHudLbl'); if (hl2) hl2.textContent = eff ? 'Voice on' : 'Voice off';
}
async function setVoice(on, fromToggle) {
  if (on) {
    if (permState('mic') !== 'granted') { const ok = await requestMic(); if (ok !== 'granted') { lsSet('voiceOn', '0'); refreshVoiceUI(); toast('Microphone is off, so Voice Chat stays OFF. Text chat works fine.', 4200); return; } }
    lsSet('voiceOn', '1');
  } else lsSet('voiceOn', '0');
  refreshVoiceUI();
  if (!on) stopListening();
}
function speakReply(text) {
  if (!voiceEffective() || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const clean = text.replace(/[🎙🔇😂🤣★♪●▶]/g, '').slice(0, 420);
    const u = new SpeechSynthesisUtterance(clean);
    const mods = QBDB.pers ? AFF.voiceMods(S.speakingPersona || S.activePersonaId) : { rate: 1, pitch: 1 };
    u.rate = clamp(1.02 * mods.rate, 0.5, 2); u.pitch = clamp(mods.pitch, 0, 2);
    speechSynthesis.speak(u);
  } catch (e) {}
}
function ttsStop() { try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) {} stopListening(); }
function wireVoiceToggles() {
  // Both toggles are BUTTONS (chat header + Settings mirror): click flips state.
  [$('voiceToggle'), $('voiceToggle2')].forEach((t) => { if (t) t.onclick = () => setVoice(!voiceOn()); });
  refreshVoiceUI();
}

/* =====================================================================
   THEME — every Buddy loves music / arts / media + a science topic.
   LOVES is applied onto PERSONAS at boot (authored in the personas spec,
   "Shared loves" section). Daily themed cards + theme chat intents.
   ===================================================================== */
const LOVES = {
  adaeze:  { love: 'Afrobeats and creative coding — I build little beat machines for fun', science: 'how computers learn (AI basics)' },
  kenji:   { love: 'jazz on vinyl — the warm crackle is part of the music', science: 'acoustics — how sound fills a room' },
  mariana: { love: 'food as art — a plate is a canvas you can eat', science: 'food science — the Maillard reaction and emulsions' },
  arjun:   { love: 'cinema and the art of the title sequence', science: 'the optics of film — light, lenses, and 24 frames a second' },
  jonas:   { love: 'spoken-word poetry over city sounds', science: 'transit engineering — how a whole city moves on time' },
  camila:  { love: 'stadium music culture — the crowd IS an instrument', science: 'sports science — sprint mechanics and recovery' },
  layla:   { love: 'calligraphy and ancient manuscripts', science: 'archaeology science — carbon dating and reading old ink' },
  jiwoo:   { love: 'game art and chiptune / synth music', science: 'game physics — gravity, bounce, and why jumps feel right' },
  marcus:  { love: 'dub engineering — echo, space, and bass as architecture', science: 'sound waves — frequency, resonance, and echo' },
  einar:   { love: 'folk music and aurora photography', science: 'space weather — how solar wind paints the northern lights' }
};
const EXPLAINERS = [
  [/maillard|crust|browning|sear/i, 'The Maillard reaction: when heat makes amino acids and sugars in food react, they create hundreds of new flavor molecules — that golden crust on bread, seared meat, and coffee beans. It starts around 140°C / 285°F. Browning = flavor chemistry.'],
  [/black hole/i, 'A black hole is a place where so much mass is packed so tightly that gravity wins completely — even light cannot climb out. The edge is the event horizon; cross it and every path leads inward. We photographed one (M87*) in 2019 using a planet-sized virtual telescope.'],
  [/aurora|northern lights/i, 'Auroras start at the Sun: charged particles ride the solar wind to Earth, get funneled by our magnetic field toward the poles, and slam into upper-atmosphere gases. Oxygen glows green (and red up high); nitrogen adds purple edges. Space weather you can watch.'],
  [/carbon dat/i, 'Carbon dating: living things keep a steady ratio of carbon-14. When they die, the C-14 decays at a known rate (half-life ≈ 5,730 years). Measure what is left and you can date wood, cloth, and bone up to ~50,000 years old — archaeology with a clock built in.'],
  [/echo|reverb/i, 'An echo is sound bouncing off a surface and returning late enough to hear separately (about a tenth of a second). Reverb is thousands of tiny echoes packed together — the "size" your ear hears in a hall or a dub mix. Studios fake it with springs, plates, and math.'],
  [/frame rate|24 (frames|fps)|film look/i, 'Movies run at 24 frames per second — a standard from the sound era. It is slow enough to feel dreamy (motion blurs softly) yet smooth enough to read as movement. Games target 60+ fps because YOU are steering: lower delay between your hand and the screen feels like control.'],
  [/sprint|fast twitch/i, 'Sprinting is controlled falling: elite sprinters hit the ground with forces over twice their body weight, for less than a tenth of a second per step. "Fast-twitch" muscle fibers fire in ~25 milliseconds — training mostly teaches your nervous system to recruit them together.'],
  [/synth|chiptune/i, 'A synthesizer builds sound from simple waves — sine, square, sawtooth — then sculpts them with filters and envelopes. Chiptune limited itself to the few channels of old game chips (two squares, a triangle, noise) and turned that limit into a whole style.'],
  [/train|signaling|signal/i, 'Rail signaling keeps trains apart with "blocks" — sections of track only one train may occupy. Modern systems radio each train\'s position many times a second and compute safe speeds automatically. The art is moving thousands of people with seconds of margin, invisibly.'],
  [/machine learning|ai learn|neural/i, 'Machine learning in one line: instead of writing rules, you show a program many examples and let it tune millions of tiny numbers until its guesses get good. The "learning" is arithmetic — but at huge scale, arithmetic starts to look like judgment.']
];
const GENRE_RECS = [
  [/sad|down|blue|rain/i, (p) => 'For a grey mood: slow jazz ballads and dub with the echo turned up. My pick — ' + p.nickname + ' style: one warm record, low lights, no skipping.'],
  [/happy|energy|workout|run/i, (p) => 'Need lift? Afrobeats and stadium funk — drums first, everything else second. Play it loud enough to move.'],
  [/focus|study|work|code/i, (p) => 'For focus: instrumental only — lo-fi beats, solo piano, or film scores. Lyrics steal the part of your brain that reads.'],
  [/party|dance|fun/i, (p) => 'Party math: start with classics everyone knows, save the fastest songs for the middle, end on a sing-along. A DJ is just a storyteller with drums.'],
  [/sleep|calm|relax/i, (p) => 'For winding down: slow tempos near resting heart rate (~60 bpm), soft piano or ambient synth. Your body syncs to the beat without asking.']
];
const QUIZZES = [
  { q: 'Quick quiz: which instrument family does the saxophone belong to — brass or woodwind?', a: /woodwind/i, why: 'Woodwind! The sound comes from a reed, even though the body is brass.' },
  { q: 'Quiz time: about how many frames per second does a cinema film run — 24, 60, or 240?', a: /^24|[^0-9]24[^0-9]|^24$/, why: '24 fps — the dreamy film standard since the sound era.' },
  { q: 'Science quiz: what color does oxygen glow in an aurora — green, blue, or orange?', a: /green/i, why: 'Green — excited oxygen, about 100 km up. Red appears higher still.' },
  { q: 'Music quiz: in "lo-fi", what does the "fi" stand for — fiction, fidelity, or final?', a: /fidelity/i, why: 'Fidelity — lo-fi means low fidelity on purpose: hiss, wobble, and warmth.' }
];
const DAILY_CARDS = [
  { type: 'groove', pid: 'marcus', title: "Today's Groove", text: 'Dub was born in Kingston studios when engineers like King Tubby turned the mixing board into an instrument — dropping the vocal out, drowning the drums in echo, and inventing the remix in the process. Every remix since owes rent to those sessions.' },
  { type: 'groove', pid: 'adaeze', title: "Today's Groove", text: 'Afrobeats (with an s) grew from Fela Kuti\'s Afrobeat — long, joyful grooves where drums, horns, and call-and-response vocals layer until the whole room moves. Lagos exported the rhythm; the world supplied the dance floors.' },
  { type: 'groove', pid: 'kenji', title: "Today's Groove", text: 'In Tokyo\'s jazz kissaten, cafés played imported records on serious hi-fi systems — talking was discouraged; listening was the event. Kenji\'s rule comes straight from there: one side of vinyl, no phone, just the music.' },
  { type: 'groove', pid: 'jiwoo', title: "Today's Groove", text: 'Chiptune composers wrote symphonies on game chips with only a handful of sound channels. The limit became the style — arpeggios faked chords, noise became drums, and a generation learned music theory from boss fights.' },
  { type: 'art', pid: 'layla', title: 'Art Beat', text: 'Calligraphy is drawing, writing, and music at once: the reed pen\'s angle sets the rhythm, and a master\'s hand moves like a conductor. Layla restores manuscripts where a single page can hold a year of someone\'s life.' },
  { type: 'art', pid: 'arjun', title: 'Art Beat', text: 'A great title sequence is a short film that teaches you how to watch the long one — Saul Bass turned movie credits into modern art with paper cut-outs and nerve. Arjun keeps a notebook of favorites; ask him for the top three.' },
  { type: 'art', pid: 'mariana', title: 'Art Beat', text: 'Plating is composition: color against color, height for drama, sauce placed like a brushstroke. Mariana says a plate should be read like a painting — then eaten before the critic (you) gets cold feet.' },
  { type: 'art', pid: 'einar', title: 'Art Beat', text: 'Aurora photography is patience made visible: a tripod, a dark sky, and long exposures while the solar wind performs. Einar\'s best shot took eleven nights of waiting for twenty seconds of sky.' },
  { type: 'science', pid: 'einar', title: 'Science Bite', text: 'The aurora is space weather made visible: charged particles from the Sun ride the solar wind, Earth\'s magnetic field funnels them to the poles, and gases 100 km up glow — oxygen green, nitrogen purple. A storm on the Sun, painted on our sky.' },
  { type: 'science', pid: 'mariana', title: 'Science Bite', text: 'That golden crust on bread and seared food is chemistry: the Maillard reaction, hundreds of new flavor molecules born when heat meets sugars and amino acids. Browning is not burning — browning is flavor being built.' },
  { type: 'science', pid: 'camila', title: 'Science Bite', text: 'Sprinters are not just strong — they are precise. Elite runners touch the ground for under a tenth of a second per stride with forces over twice their body weight. Speed is power delivered in a blink, thousands of times in training.' },
  { type: 'science', pid: 'marcus', title: 'Science Bite', text: 'Echo is sound with a return ticket: bounce it off a wall far enough away and it comes back as its own event, about a tenth of a second late. Dub engineers build whole worlds in that gap.' }
];
function dailyForToday() {
  const day = Math.floor(Date.now() / 86400000);
  const pick = (type) => { const arr = DAILY_CARDS.filter((cd) => cd.type === type); return arr[day % arr.length]; };
  return [pick('groove'), pick('art'), pick('science')];
}
function renderDailyCards() {
  const host = $('dailyCards'); if (!host) return;
  host.innerHTML = '';
  dailyForToday().forEach((cd) => {
    const p = personaById(cd.pid); const idn = identityOf(cd.pid);
    const d = document.createElement('div');
    d.style.cssText = 'background:rgba(255,255,255,.05);border:1px solid var(--glass-line);border-left:4px solid ' + p.color + ';border-radius:12px;padding:9px 11px;margin-top:7px;cursor:pointer';
    d.innerHTML = '<div style="font-size:11px;font-weight:800;letter-spacing:.8px;color:var(--amber)">' + esc(cd.title.toUpperCase()) + ' · ' + esc(idn.name.toUpperCase()) + '</div><div style="font-size:13.5px;line-height:1.45;margin-top:3px">' + esc(cd.text) + '</div>';
    d.addEventListener('click', () => presentDailyCard(cd));
    host.appendChild(d);
  });
}
async function presentDailyCard(cd) {
  navTo('chat');
  if (S.activePersonaId !== cd.pid) await selectPersona(cd.pid);
  const reply = await pilotSay(cd.text);
  if (reply) { hlShow('daily', 'desc'); if (typeof speakReply === 'function') speakReply(reply.text); }
}
/* theme-aware wrapper around the offline brain */
const BASE_REPLY = offlineReply;
function themeReply(pid, text, total) {
  const p = (pid && typeof pid === 'object') ? pid : personaById(pid); const low = text.toLowerCase();
  if (S.pendingQuiz) {
    const qz = S.pendingQuiz; S.pendingQuiz = null;
    if (qz.a.test(text)) return pick(['That\'s it! ✓', 'Correct! 🎉', 'You nailed it.']) + ' ' + qz.why;
    return 'Good guess — the answer: ' + qz.why + ' Stick with me, we\'ll get the next one.';
  }
  const mQuiz = /quiz|test me|ask me (a )?question/.test(low);
  if (mQuiz) { const qz = pick(QUIZZES); S.pendingQuiz = qz; return qz.q + ' Take your time.'; }
  const mSci = /explain|science|how does|how do|why does|why do|tell me about/.test(low);
  if (mSci) { for (const [re, txt] of EXPLAINERS) if (re.test(text)) return txt; }
  if (/auroras?|northern lights/.test(low)) return EXPLAINERS[2][1];
  if (/sound waves?|frequency|resonance/.test(low)) return 'Sound is air doing push-ups: a speaker (or string, or drum) pushes air molecules in waves. Pitch is how fast the waves arrive — 440 pushes a second is the note A. Marcus builds cathedrals out of the echoes between pushes.';
  const mRec = /recommend|suggest|what (music|song|genre)|play (me )?something|listen to/.test(low);
  if (mRec || /music|genre|jazz|vinyl|song/.test(low) && /\?$/.test(text)) {
    for (const [re, fn] of GENRE_RECS) if (re.test(text)) return fn(p);
    if (/jazz/.test(low)) return 'My shelf answer: start with Miles Davis "Kind of Blue" — five musicians, first takes, pure calm. Kenji would add: vinyl if you can, lights low.';
    if (/game|chiptune|synth/.test(low)) return 'Game music pick: the Celeste soundtrack — piano and synth braided together, hopeful even in the hard levels. Ji-woo hums it while debugging.';
    return 'Tell me the mood — happy, sad, focused, party, or winding down — and I\'ll pick from my shelf like I mean it.';
  }
  if (/your favo(u)?rite|what do you love|your passion|hobbies|your thing/.test(low)) {
    const L = LOVES[p.id] || { love: 'music, arts, and media of every kind', science: 'how things work' };
    return 'Me? I live for ' + L.love + '. And my favorite rabbit hole is ' + L.science + ' — ask me about it sometime.';
  }
  if (/science/.test(low)) { const L = LOVES[p.id]; return 'My favorite science corner: ' + (L ? L.science : 'how the world works') + '. Say "explain" plus a topic — echo, auroras, carbon dating, sprinting, film frames — and I\'ll break it down friendly-style.'; }
  return BASE_REPLY(p, text);
}
offlineReply = themeReply;

/* =====================================================================
   EXPLORE COMPANIONS — the Buddies explore WITH you: they wander,
   comment on what you're doing/sharing, and suggest things to try.
   ===================================================================== */
const EXPLORE = { lastLine: 0, minGap: 110000 };
function exploreSay(text, opts) {
  opts = opts || {};
  const now = nowMs();
  if (!opts.force && now - EXPLORE.lastLine < EXPLORE.minGap) return;
  if (currentScreen !== 'chat' && !opts.force) return;
  EXPLORE.lastLine = now;
  pilotSay(text);
}
function exploreTick(now) {
  if (!S.controlOn || document.hidden) return;
  if (now - EXPLORE.lastLine < EXPLORE.minGap + 40000) return;
  if (currentScreen !== 'chat') return;
  const cd = dailyForToday();
  const lines = [
    'While we explore — have you seen ' + cd[2].title + ' today? "' + truncate(cd[2].text, 90) + '" It is on the chat page, glowing and everything.',
    'Exploration idea: tap Share Screen and put the Crew page on the big stage display — seeing everyone up there never gets old.',
    'Wandering thought: each of us keeps a little memory of what you tell us. Say "remember this" sometime and watch it stick.',
    'Have you tried Draw mode yet? I can sketch you a music note — or a rocket, if we are feeling ambitious.',
    'Exploration idea: ask the crew for a quiz. We take quizzes VERY seriously around here.'
  ];
  exploreSay(pick(lines));
}
/* =====================================================================
   GUIDED TASK HELPERS — "Help me…" guide library. Each step is a Buddy
   message + (where there is one) a highlight that HOLDS until Continue.
   ===================================================================== */
const GUIDES = [
  { id: 'login', icon: '🔑', title: 'Fix a login problem', desc: 'Password rejected? Locked out? We go step by step.',
    steps: [
      { text: 'Login fix, step 1 of 7 — check the email address itself. One wrong letter (or an old address) is the #1 cause. Type it slowly and read it back.', hl: 'chat' },
      { text: 'Step 2 of 7 — check Caps Lock and typos in the password. Passwords care about every letter. If your keyboard has autocorrect on, it may be "fixing" your password into a wrong one.', hl: null },
      { text: 'Step 3 of 7 — use "Forgot password" on that app\'s login screen. It sends a reset link or code to your email — that is the safe, official road back in.', hl: null },
      { text: 'Step 4 of 7 — open the email and tap the reset link. Links expire fast (often 10–60 minutes), so do it right away, and check spam if it does not show up.', hl: 'notes' },
      { text: 'Step 5 of 7 — if it asks for a 2FA code: open your authenticator or messages, read the newest code, and enter it promptly — codes roll over every 30 seconds or so.', hl: null },
      { text: 'Step 6 of 7 — connecting an app like an email app to Gmail, Yahoo, or iCloud? Those need a special "app password" from the provider\'s website security page — your normal password will never work there, and that is by design.', hl: 'settings' },
      { text: 'Step 7 of 7 — still stuck? Try signing in on your phone\'s browser instead. If it works there, the app was the problem — reinstall it. If it fails everywhere, wait 30 minutes (lockouts are temporary) and try the reset once more. You\'ve got this.', hl: null }
    ],
    done: 'That is the full login-fix playbook. Any time you are stuck, run it again — step by step beats guessing every time.' },
  { id: 'controller', icon: '🎮', title: 'Connect a game controller', desc: 'Pair a Bluetooth controller to the Quest 3.',
    steps: [
      { text: 'Controller pairing, step 1 of 5 — charge it or swap in fresh batteries first. A half-dead controller pairs badly and drops mid-game.', hl: null },
      { text: 'Step 2 of 5 — put the controller in pairing mode: hold its pair/home combo until the light blinks fast. (Xbox: the small pair button on top. PlayStation: hold Share + PS.) Blinking fast = ready.', hl: null },
      { text: 'Step 3 of 5 — in the headset: Settings → Devices → Bluetooth → Pair New Device. I am pointing at Settings — that is where the journey starts.', hl: 'settings' },
      { text: 'Step 4 of 5 — tap your controller\'s name in the list and wait for "Connected". If it asks for a PIN, try 0000.', hl: null },
      { text: 'Step 5 of 5 — test it in the home screen: point and click around. Not responding? Forget the device in Bluetooth settings and pair once more — that fixes it most times.', hl: null }
    ],
    done: 'Controller connected (or well on its way). Happy gaming — and if a game supports it, the controller works in most Quest apps too.' },
  { id: 'storage', icon: '🧹', title: 'Free up storage', desc: 'Headset or phone feeling full? Clear space safely.',
    steps: [
      { text: 'Storage cleanup, step 1 of 6 — first, look: Settings → Storage shows what is actually eating space. Games and videos are usually the giants. (Pointing at Settings.)', hl: 'settings' },
      { text: 'Step 2 of 6 — delete apps and games you have not opened in a month. Your purchases stay in your library — you can reinstall any of them free, anytime.', hl: null },
      { text: 'Step 3 of 6 — clear the browser\'s downloads and cache. Old files from "just checking something" add up quietly.', hl: null },
      { text: 'Step 4 of 6 — move photos and videos to the cloud instead of deleting them. (On your phone, Drive Bridge exists for exactly this — back up first, delete second.)', hl: 'share' },
      { text: 'Step 5 of 6 — hunt the big files: screen recordings are sneaky giants. One long recording can outweigh ten games.', hl: 'notes' },
      { text: 'Step 6 of 6 — restart the device. Caches clear, temp files vanish, and the storage number you see is finally honest.', hl: null }
    ],
    done: 'Cleanup complete. Rule of thumb for next time: keep about 10% free and everything stays fast.' }
];
const GUIDE_RUN = { guide: null, idx: -1 };
function openGuideLibrary() {
  const host = sheetHost('🧰 Help me… — pick a guide');
  host.innerHTML = '';
  GUIDES.forEach((g) => {
    const b = document.createElement('button');
    b.className = 'shareOpt';
    b.innerHTML = '<b>' + g.icon + ' ' + esc(g.title) + '</b><span>' + esc(g.desc) + '</span>';
    b.addEventListener('click', () => { closeSheet(); startGuide(g.id); });
    host.appendChild(b);
  });
  const back = document.createElement('button');
  back.className = 'miniBtn'; back.style.cssText = 'width:100%;margin-top:10px'; back.textContent = 'Close';
  back.addEventListener('click', closeSheet); host.appendChild(back);
  openSheet();
}
async function startGuide(id) {
  const g = GUIDES.find((x) => x.id === id); if (!g) return;
  if (g.presenter && S.activePersonaId !== g.presenter) await selectPersona(g.presenter);
  navTo('chat');
  GUIDE_RUN.guide = g; GUIDE_RUN.idx = -1;
  pilotSay('Starting the "' + g.title + '" guide — one step at a time, at YOUR pace. Tap Continue ▶ after each step.');
  setTimeout(() => guideNext(), 900);
}
function guideNext() {
  const g = GUIDE_RUN.guide; if (!g) return;
  GUIDE_RUN.idx++;
  if (GUIDE_RUN.idx >= g.steps.length) { GUIDE_RUN.guide = null; if (QBDB.pers) AFF.trigger(S.activePersonaId, 'task_succeeded'); pilotSay(g.done); return; }
  const step = g.steps[GUIDE_RUN.idx];
  pilotSay(step.text);
  if (step.hl) hlShow(step.hl, 'desc', { onResolve: () => guideNext() });
  else {
    // no target to point at — hold a beat, then offer Continue via the dock chip path
    setTimeout(() => { hlShow('chat', 'desc', { onResolve: () => guideNext() }); HL.spokeAt = nowMs(); if (typeof hlRevealContinue === 'function') hlRevealContinue(); }, 1400);
  }
}
/* =====================================================================
   DRAW IN 3D — user strokes with the laser (tube geometry), palette,
   and "Buddy draws" (the active Buddy sketches simple pictures).
   Draw layer local anchor: (0, 1.55, -1.15) in #world, facing the user.
   ===================================================================== */
const DRAW = { on: false, color: '#00F0FF', strokes: [], current: null, preview: null, group: null, palette: null, pen: null, buddyToken: 0, drawing: false, downAt: 0 };
const DRAW_COLORS = ['#00F0FF', '#E8A33D', '#ff5f8f', '#58d68a', '#f5ecd7', '#9d8cff'];
const DRAW_PICS = {
  note:  { name: 'a music note', pts: [[0, 0], [0, 0.62], [0.30, 0.68], [0.30, 0.06]] , extra: [[-0.07, 0.0], [-0.07, 0.14], [0.07, 0.14], [0.07, 0.0], [-0.07, 0.0]] },
  star:  { name: 'a star', pts: [[0, 0.62], [0.09, 0.24], [0.44, 0.24], [0.15, 0.03], [0.26, -0.3], [0, -0.12], [-0.26, -0.3], [-0.15, 0.03], [-0.44, 0.24], [-0.09, 0.24], [0, 0.62]] },
  heart: { name: 'a heart', pts: [[0, -0.3], [-0.4, 0.08], [-0.38, 0.34], [-0.18, 0.44], [0, 0.26], [0.18, 0.44], [0.38, 0.34], [0.4, 0.08], [0, -0.3]] },
  house: { name: 'a little house', pts: [[-0.35, -0.3], [-0.35, 0.2], [0.35, 0.2], [0.35, -0.3], [-0.35, -0.3]], extra: [[-0.45, 0.2], [0, 0.52], [0.45, 0.2]], extra2: [[-0.09, -0.3], [-0.09, 0.02], [0.09, 0.02], [0.09, -0.3]] },
  rocket:{ name: 'a rocket', pts: [[0, 0.55], [0.16, 0.28], [0.16, -0.12], [0.3, -0.3], [0.16, -0.26], [0.1, -0.38], [0, -0.26], [-0.1, -0.38], [-0.16, -0.26], [-0.3, -0.3], [-0.16, -0.12], [-0.16, 0.28], [0, 0.55]], extra: [[-0.06, 0.22], [-0.06, 0.36], [0.06, 0.36], [0.06, 0.22], [-0.06, 0.22]] }
};
function buildDrawLayer() {
  const w = worldEl(); if (!w || typeof THREE === 'undefined') return;
  DRAW.group = new THREE.Group(); DRAW.group.position.set(0, 1.55, -1.15); w.object3D.add(DRAW.group);
  const pal = document.createElement('a-entity');
  pal.setAttribute('position', '-2.6 1.35 -0.7'); pal.setAttribute('rotation', '0 48 0'); pal.setAttribute('visible', 'false');
  pal.id = 'drawPalette';
  let inner = '<a-plane width="0.62" height="0.86" material="color:#0a1e26; roughness:.4; transparent:true; opacity:.94"></a-plane>';
  DRAW_COLORS.forEach((c, i) => { inner += '<a-sphere class="drawSw" data-color="' + c + '" position="' + ((i % 2 ? 0.15 : -0.15)) + ' ' + (0.26 - Math.floor(i / 2) * 0.19) + ' 0.03" radius="0.055" material="color:' + c + '; emissive:' + c + '; emissiveIntensity:.7"></a-sphere>'; });
  inner += '<a-entity class="drawBuddyBtn clickable" position="0 -0.33 0.01"><a-box depth="0.03" height="0.11" width="0.5" material="color:#17384a; roughness:.4"></a-box><a-plane class="palBtnFace" position="0 0 0.017" width="0.48" height="0.1"></a-plane></a-entity>';
  inner += '<a-entity class="drawClearBtn clickable" position="0 -0.47 0.01"><a-box depth="0.03" height="0.11" width="0.5" material="color:#3a2c14; roughness:.4"></a-box><a-plane class="palBtnFace2" position="0 0 0.017" width="0.48" height="0.1"></a-plane></a-entity>';
  pal.innerHTML = inner;
  w.appendChild(pal); DRAW.palette = pal;
  pal.addEventListener('loaded', () => {
    pal.querySelectorAll('.drawSw').forEach((s) => s.addEventListener('click', () => setDrawColor(s.dataset.color)));
    const bf = pal.querySelector('.palBtnFace'); if (bf) { const t = makeTex(384, 80); const x = t.ctx; x.fillStyle = '#17384a'; x.fillRect(0, 0, t.c.width, t.c.height); x.fillStyle = CREAM; x.font = '700 36px ' + COND; x.textAlign = 'center'; x.fillText('BUDDY DRAWS ✎', t.c.width / 2, 52); t.tex.needsUpdate = true; bindTex(bf, t); }
    const cf = pal.querySelector('.palBtnFace2'); if (cf) { const t = makeTex(384, 80); const x = t.ctx; x.fillStyle = '#3a2c14'; x.fillRect(0, 0, t.c.width, t.c.height); x.fillStyle = CREAM; x.font = '700 36px ' + COND; x.textAlign = 'center'; x.fillText('CLEAR ALL', t.c.width / 2, 52); t.tex.needsUpdate = true; bindTex(cf, t); }
    pal.querySelector('.drawBuddyBtn').addEventListener('click', () => buddyDraws());
    pal.querySelector('.drawClearBtn').addEventListener('click', () => clearDrawing());
  });
  DRAW.pen = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 10), new THREE.MeshBasicMaterial({ color: 0x00f0ff }));
  DRAW.pen.visible = false; DRAW.group.add(DRAW.pen);
  sceneEl.addEventListener('mousedown', (e) => { if (DRAW.on && e.target === sceneEl.canvas) drawStart(); });
  window.addEventListener('mouseup', () => { if (DRAW.on) drawEnd(); });
  document.querySelectorAll('[laser-controls]').forEach((hand) => {
    hand.addEventListener('selectstart', () => { if (DRAW.on) drawStart(); });
    hand.addEventListener('selectend', () => { if (DRAW.on) drawEnd(); });
  });
}
function setDrawColor(c) { DRAW.color = c; document.querySelectorAll('#drawSwatches .sw').forEach((s) => { s.style.outline = s.dataset.color === c ? '3px solid #fff' : 'none'; }); toast('Draw color: ' + c, 1200); }
function toggleDrawMode(force) {
  DRAW.on = typeof force === 'boolean' ? force : !DRAW.on;
  if (DRAW.palette) DRAW.palette.setAttribute('visible', DRAW.on ? 'true' : 'false');
  const bar = $('drawBar'); if (bar) bar.style.display = DRAW.on ? 'flex' : 'none';
  if (DRAW.on) { toast('Draw mode ON — hold the trigger (or mouse) and move to draw in the air. The palette is on your left.', 4600); }
  else { drawEnd(); DRAW.buddyToken++; if (DRAW.pen) DRAW.pen.visible = false; }
}
function drawPlanePoint() {
  // current ray (camera cursor in 2D / right-hand laser in VR) at 2.4m, expressed in draw-group local space
  if (!DRAW.group) return null;
  let src = null;
  const hand = document.getElementById('rightHand');
  if (S.mode !== '2D' && hand && hand.components.raycaster && hand.components.raycaster.raycaster) src = hand.components.raycaster.raycaster.ray;
  else { const cam = $('cam'); if (cam && cam.components.raycaster && cam.components.raycaster.raycaster) src = cam.components.raycaster.raycaster.ray; }
  if (!src) return null;
  const p = src.at(2.4, new THREE.Vector3());
  const local = DRAW.group.worldToLocal(p.clone());
  local.z = clamp(local.z, -0.4, 0.4);
  return local;
}
function drawStart() { if (DRAW.drawing) return; DRAW.drawing = true; DRAW.current = []; }
function drawEnd() {
  if (!DRAW.drawing) return; DRAW.drawing = false;
  const pts = DRAW.current || []; DRAW.current = null;
  if (DRAW.preview) { DRAW.group.remove(DRAW.preview); DRAW.preview.geometry.dispose(); DRAW.preview = null; }
  if (pts.length > 3) addStrokeTube(pts, DRAW.color);
}
function addStrokeTube(pts, color) {
  if (pts.length < 2) return;
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => p.clone()));
  const seg = clamp(pts.length * 2, 8, 260);
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, seg, 0.009, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(color) }));
  DRAW.group.add(mesh); DRAW.strokes.push(mesh);
  while (DRAW.strokes.length > 40) { const old = DRAW.strokes.shift(); DRAW.group.remove(old); old.geometry.dispose(); }
}
function clearDrawing() { DRAW.strokes.forEach((m) => { DRAW.group.remove(m); m.geometry.dispose(); }); DRAW.strokes = []; }
function drawTick(dt) {
  if (!DRAW.on || !DRAW.drawing || !DRAW.group) return;
  const p = drawPlanePoint(); if (!p) return;
  const arr = DRAW.current; if (!arr) return;
  if (!arr.length || arr[arr.length - 1].distanceTo(p) > 0.028) { arr.push(p); if (arr.length > 220) drawEnd(); }
  if (arr.length > 1) {
    const geo = new THREE.BufferGeometry().setFromPoints(arr);
    if (DRAW.preview) { DRAW.preview.geometry.dispose(); DRAW.preview.geometry = geo; }
    else { DRAW.preview = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(DRAW.color) })); DRAW.group.add(DRAW.preview); }
  }
  if (DRAW.pen) { DRAW.pen.visible = true; DRAW.pen.position.copy(p); DRAW.pen.material.color.set(DRAW.color); }
}
async function buddyDraws() {
  if (!DRAW.group) return;
  const keys = Object.keys(DRAW_PICS);
  const pic = DRAW_PICS[keys[Math.floor(Math.random() * keys.length)]];
  const token = ++DRAW.buddyToken;
  const B = BOTS[S.activePersonaId];
  if (B) { B.walk = { tx: 0.95, tz: -0.45, greet: false }; }
  const reply = await pilotSay('Watch this — drawing ' + pic.name + ' for you, stroke by stroke.');
  if (token !== DRAW.buddyToken) return;
  const parts = [pic.pts]; if (pic.extra) parts.push(pic.extra); if (pic.extra2) parts.push(pic.extra2);
  for (const part of parts) {
    if (token !== DRAW.buddyToken) return;
    const pts3 = part.map((q) => new THREE.Vector3(q[0] * 0.95, q[1] * 0.95, 0));
    const total = pts3.length, dur = 300 + total * 190;
    await new Promise((res) => {
      const t0 = nowMs();
      const stepFn = () => {
        if (token !== DRAW.buddyToken) { res(); return; }
        const f = clamp((nowMs() - t0) / dur, 0, 1);
        const n = Math.max(2, Math.ceil(f * total));
        if (DRAW.pen) { DRAW.pen.visible = true; DRAW.pen.position.copy(pts3[n - 1]); }
        if (DRAW.preview) { DRAW.group.remove(DRAW.preview); DRAW.preview = null; }
        if (n > 1) { DRAW.preview = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts3.slice(0, n)), new THREE.LineBasicMaterial({ color: new THREE.Color(DRAW.color) })); DRAW.group.add(DRAW.preview); }
        const B2 = BOTS[S.activePersonaId]; if (B2 && B2.armR) B2.armR.object3D.rotation.z = -1.5 + Math.sin(nowMs() / 90) * 0.25;
        if (f < 1) requestAnimationFrame(stepFn); else res();
      };
      stepFn();
    });
    if (DRAW.preview) { DRAW.group.remove(DRAW.preview); DRAW.preview.geometry.dispose(); DRAW.preview = null; }
    addStrokeTube(pts3, DRAW.color);
  }
  if (DRAW.pen) DRAW.pen.visible = false;
  if (token === DRAW.buddyToken) toast('Done! Screenshot it if you like it 📸', 3200);
}
/* =====================================================================
   JUMP MAP (local) — fade + move the rig between lounge spots.
   In AR the user is really standing in a room, so spots re-anchor the
   world instead (honest local teleport — no fake room travel).
   ===================================================================== */
const SPOTS = [
  { id: 'lounge', label: 'Deck Lounge', icon: '🛋️', rig: [0, 0, 0], rotY: 0, line: 'Deck Lounge — home base. Crew in front of you, Earth out the window.' },
  { id: 'stage', label: 'Room Stage', icon: '🎤', rig: [0, 0, 1.6], rotY: 0, line: 'Room Stage — front row at the spotlight. Best seat for a Buddy performance.' },
  { id: 'jukebox', label: 'Jukebox Corner', icon: '🎵', rig: [-2.9, 0, 2.0], rotY: 55, line: 'Jukebox Corner. Mind the vinyl wall — Layla alphabetized it and takes it personally.' },
  { id: 'viewport', label: 'Viewport Window', icon: '🌍', rig: [0, 0, -1.4], rotY: 0, line: 'Viewport Window — Earth, up close and quiet. Good thinking spot.' }
];
let jumpPanelEl = null;
function openJumpMap() {
  const host = sheetHost('🧭 Jump Map — tap a spot');
  host.innerHTML = '';
  const note = document.createElement('div');
  note.style.cssText = 'font-size:13px;color:var(--dim);margin-bottom:8px';
  note.textContent = S.mode === 'AR' ? 'In Room Mode a jump re-centers the stage to where you stand — you are really in your room, so the world comes to you.' : 'Local jumps only — inside this lounge.';
  host.appendChild(note);
  SPOTS.forEach((s) => {
    const b = document.createElement('button');
    b.className = 'shareOpt';
    b.innerHTML = '<b>' + s.icon + ' ' + esc(s.label) + '</b><span>' + esc(s.line) + '</span>';
    b.addEventListener('click', () => { closeSheet(); jumpTo(s.id); });
    host.appendChild(b);
  });
  const back = document.createElement('button');
  back.className = 'miniBtn'; back.style.cssText = 'width:100%;margin-top:10px'; back.textContent = 'Close';
  back.addEventListener('click', closeSheet); host.appendChild(back);
  openSheet();
}
function jumpTo(id) {
  const s = SPOTS.find((x) => x.id === id); if (!s) return;
  const veil = $('fadeVeil');
  // "Through the looking-glass": a brief warm bloom as the world re-opens — fast, no camera motion.
  if (veil) { veil.classList.remove('bloom'); void veil.offsetWidth; veil.classList.add('bloom'); veil.style.opacity = ''; }
  setTimeout(() => {
    if (S.mode === 'AR') { anchorWorldToUser(-2.2); }
    else {
      const rig = $('rig'); if (rig) { rig.setAttribute('position', s.rig.join(' ')); rig.setAttribute('rotation', '0 ' + s.rotY + ' 0'); }
    }
    if (veil) setTimeout(() => veil.classList.remove('bloom'), 320);
    pilotSay(s.line);
  }, 250);
  if (jumpPanelEl) drawJumpPanel();
}
function buildJumpPanel() {
  const w = worldEl(); if (!w) return;
  const e = document.createElement('a-entity');
  e.setAttribute('position', '-3.05 1.85 -1.6'); e.setAttribute('rotation', '0 44 0'); e.setAttribute('visible', 'false');
  e.id = 'jumpPanel3d';
  let inner = '<a-plane class="jpFace" width="1.0" height="0.85"></a-plane>';
  SPOTS.forEach((s, i) => { inner += '<a-entity class="jpBtn clickable" data-spot="' + s.id + '" position="0 ' + (0.26 - i * 0.17) + ' 0.015"><a-box depth="0.025" height="0.145" width="0.88" material="color:#0a1e26; roughness:.4"></a-box><a-plane class="jpBtnFace" position="0 0 0.014" width="0.86" height="0.135"></a-plane></a-entity>'; });
  e.innerHTML = inner;
  w.appendChild(e); jumpPanelEl = e;
  e.addEventListener('loaded', () => {
    const face = e.querySelector('.jpFace');
    const t = makeTex(700, 596); const { ctx, c } = t;
    ctx.fillStyle = 'rgba(7,20,26,.94)'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = BRASS; ctx.lineWidth = 6; ctx.strokeRect(8, 8, c.width - 16, c.height - 16);
    ctx.fillStyle = AMBER; ctx.font = '900 46px ' + COND; ctx.textAlign = 'center';
    ctx.fillText('🧭 JUMP MAP', c.width / 2, 66);
    t.tex.needsUpdate = true; bindTex(face, t);
    e.querySelectorAll('.jpBtn').forEach((b, i) => {
      const s = SPOTS[i];
      const f = b.querySelector('.jpBtnFace');
      const t2 = makeTex(600, 96); const x = t2.ctx;
      x.fillStyle = '#0a1e26'; x.fillRect(0, 0, t2.c.width, t2.c.height);
      x.strokeStyle = 'rgba(201,151,63,.7)'; x.lineWidth = 4; x.strokeRect(4, 4, t2.c.width - 8, t2.c.height - 8);
      x.fillStyle = CREAM; x.font = '800 40px ' + COND; x.textAlign = 'center';
      x.fillText(s.icon + ' ' + s.label.toUpperCase(), t2.c.width / 2, 62);
      t2.tex.needsUpdate = true; bindTex(f, t2);
      b.addEventListener('click', () => jumpTo(s.id));
    });
  });
}
function drawJumpPanel() { if (jumpPanelEl) jumpPanelEl.setAttribute('visible', 'true'); setTimeout(() => { if (jumpPanelEl && !DRAW.on) jumpPanelEl.setAttribute('visible', 'false'); }, 12000); }

/* =====================================================================
   DOM WIRING + BOOT
   ===================================================================== */
function buildDrawSwatches() {
  const host = $('drawSwatches'); if (!host) return;
  DRAW_COLORS.forEach((c) => {
    const s = document.createElement('button');
    s.className = 'sw'; s.dataset.color = c;
    s.style.cssText = 'width:30px;height:30px;border-radius:50%;border:2px solid rgba(255,255,255,.35);background:' + c + ';flex:none;cursor:pointer' + (c === DRAW.color ? ';outline:3px solid #fff' : '');
    s.addEventListener('click', () => setDrawColor(c));
    host.appendChild(s);
  });
}
function wireDom() {
  document.querySelectorAll('.tab').forEach((tb) => tb.addEventListener('click', () => { const scr = { chat: 'chat', personas: 'crew', search: 'search', notes: 'notes', settings: 'settings' }[tb.dataset.page]; if (scr) navTo(scr); }));
  document.querySelectorAll('.dockBtn').forEach((b) => b.addEventListener('click', () => dockTap(b.dataset.nav)));
  $('myScreen').addEventListener('change', (e) => screenPick(e.target.value));
  $('myScreen2').addEventListener('change', (e) => screenPick(e.target.value));
  $('btnGive').addEventListener('click', () => { hlResolve('target'); giveControl(); });
  $('btnStop').addEventListener('click', () => stopAll('Stopped — all buddy functions are off.'));
  $('btnPanel').addEventListener('click', () => { navTo('chat'); toast('The crew and panels live in front of you in the lounge. On a phone this flat panel IS the app.', 3600); });
  $('btnAR').addEventListener('click', () => enterSession('ar'));
  $('btnVR').addEventListener('click', () => enterSession('vr'));
  $('btnShowHud').addEventListener('click', () => setHudHidden(false));
  $('btnShowStop').addEventListener('click', () => stopAll('Stopped — all buddy functions are off.'));
  $('btnRecStop').addEventListener('click', () => toggleRecord());
  // Highlight Continue buttons: one on the chat panel, one floating chip near
  // the HUD — created here because hlShow/hlRevealContinue address them by id.
  // They start hidden; a description-linked highlight reveals them.
  if (!$('hlContinue')) {
    const cont = document.createElement('button');
    cont.id = 'hlContinue'; cont.className = 'sendBtn'; cont.textContent = 'Continue ▶';
    cont.style.cssText = 'display:none;width:100%;padding:12px;border-radius:12px;margin:2px 0 8px';
    const ir = $('inputRow'); if (ir && ir.parentNode) ir.parentNode.insertBefore(cont, ir);
  }
  if (!$('hlContinueChip')) {
    const chip = document.createElement('button');
    chip.id = 'hlContinueChip'; chip.textContent = 'Continue ▶';
    chip.style.cssText = 'display:none;position:fixed;right:14px;bottom:96px;z-index:46;background:#062a33;color:#00F0FF;border:2px solid #00F0FF;border-radius:999px;padding:12px 20px;font-size:15px;font-weight:900;cursor:pointer;box-shadow:0 0 18px rgba(0,240,255,.55)';
    document.body.appendChild(chip);
  }
  $('hlContinue').addEventListener('click', () => hlResolve('continue'));
  $('hlContinueChip').addEventListener('click', () => hlResolve('continue'));
  $('sendBtn').addEventListener('click', submitChatForm);
  $('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitChatForm(); } });
  $('micBtn').addEventListener('click', micTap);
  $('newConvBtn').addEventListener('click', async () => { if (await askConfirm('Start a new conversation with ' + personaById(S.activePersonaId).nickname + '? The current thread stays saved — find it anytime in Search.')) newConversation(); });
  $('searchBtn').addEventListener('click', doSearch);
  $('searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  $('noteAdd').addEventListener('click', addNoteFromForm);
  $('noteInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addNoteFromForm(); });
  $('shareAsk').addEventListener('click', shareAskPilot);
  $('shareStop').addEventListener('click', () => stopShare('Sharing stopped.'));
  $('btClose').addEventListener('click', () => { const bt = $('browserTile'); if (bt) { bt.classList.remove('open'); $('btBody').innerHTML = ''; } if (SHARE.state && (SHARE.state.type === 'web' || SHARE.state.type === 'photo')) endShare(); });
  $('qaDraw').addEventListener('click', () => toggleDrawMode());
  $('qaJump').addEventListener('click', () => { openJumpMap(); drawJumpPanel(); });
  $('qaHelp').addEventListener('click', () => openGuideLibrary());
  $('qaPhone').addEventListener('click', () => summonPhone());
  $('chatInput').addEventListener('focus', () => { S.typingUntil = nowMs() + 5000; });
  $('chatInput').addEventListener('input', () => { S.typingUntil = nowMs() + 4000; });
  $('chatInput').addEventListener('blur', () => { S.typingUntil = 0; });
  $('drawBuddy').addEventListener('click', () => buddyDraws());
  $('drawClear').addEventListener('click', () => clearDrawing());
  $('drawDone').addEventListener('click', () => toggleDrawMode(false));
  buildDrawSwatches();
  $('permMicBtn').addEventListener('click', async () => { const st = await requestMic(); toast(st === 'granted' ? 'Microphone allowed ✓' : 'Microphone not allowed — text mode still works fine.', 3400); });
  // Settings-owned controls (Live AI, mode preference, ambience, room buttons,
  // highlight toggle, health panel) are wired in wireSettings()/wireRoomButtons()
  // against the REAL ids — modePref, btnRescan/btnHeight/btnRecenter/btnResetRoom.
}
function submitChatForm() {
  const inp = $('chatInput'); const v = inp.value; inp.value = '';
  if (v.trim()) { hlResolve('typed'); sendUserMessage(v); }
}
let sceneReady = false, bootDone = false;
async function boot() {
  // Staged, guarded startup (built-in checker): every stage is labeled and
  // logged to the health ring; a throwing stage records the error and boot
  // CONTINUES, so the 2D fallback UI + Settings health panel always render.
  healthStage('boot:start');
  try { wireDom(); healthStage('wire:dom'); } catch (e) { healthError(e, 'wireDom'); }
  try { wireVoiceToggles(); healthStage('wire:voice'); } catch (e) { healthError(e, 'wireVoiceToggles'); }
  try { wireSettings(); healthStage('wire:settings'); } catch (e) { healthError(e, 'wireSettings'); }
  try { wireRoomButtons(); healthStage('wire:room'); } catch (e) { healthError(e, 'wireRoomButtons'); }
  try { setupSpeech(); paintPerms(); } catch (e) { healthError(e, 'speech/perms'); }
  try { PERSONAS.forEach((pp) => { const L = LOVES[pp.id]; if (L) pp.loves = L.love; }); } catch (e) {}
  try { await dbInit(); healthStage('db:ready'); } catch (e) { healthError(e, 'dbInit'); }
  try { await QBDB.loadFace(); healthStage('face database'); } catch (e) { healthError(e, 'face database'); qbDbFailed('face database'); }
  try { await QBDB.loadPers(); healthStage('personality database'); } catch (e) { healthError(e, 'personality database'); qbDbFailed('personality database'); }
  try { renderCrewGrid(); fillSearchPersonas(); await renderNotes(); healthStage('ui:lists'); } catch (e) { healthError(e, 'lists'); }
  try { await loadAvatarFromDb(); healthStage('avatar:loaded'); } catch (e) { healthError(e, 'avatarLoad'); }
  const savedActive = LS.get('activePersona', PERSONAS[0].id);
  try { await selectPersona(PERSONAS.some((pp) => pp.id === savedActive) ? savedActive : PERSONAS[0].id, { silent: true }); healthStage('persona:selected'); } catch (e) { healthError(e, 'selectPersona'); }
  try { renderChips(); renderDailyCards(); } catch (e) { healthError(e, 'chips/cards'); }
  try { await maybeShowPermCard(); } catch (e) { healthError(e, 'permCard'); }
  try {
    const total = await totalMessageCount();
    if (total === 0) {
      const reply = await pilotSay(identityOf(S.activePersonaId).greeting);
      if (reply && QBDB.pers) AFF.trigger(S.activePersonaId, 'user_greeting');
      hlShow('give', 'desc');
      if (reply) HL.spokeAt = reply.ts + 400;
      toast('Welcome to QuestBuddi! Tap GIVE BUDDIES CONTROL when you are ready.', 5000);
    }
  } catch (e) { healthError(e, 'greeting'); }
  try { const lastScreen = LS.get('lastScreen', 'chat'); navTo(tabsFor(lastScreen) ? lastScreen : 'chat'); } catch (e) { healthError(e, 'navRestore'); }
  try { const r = await ROOM_LOAD(); if (r) { applyRoom(); toast('Room loaded ✓ — your saved room is ready.', 3500); } updateRoomStatus(); healthStage('room:loaded'); } catch (e) { healthError(e, 'roomLoad'); }
  try { updateControlUI(); refreshVoiceUI(); refreshHealthPanel(); } catch (e) {}
  setInterval(() => { checkReminders(); }, 30000);
  setInterval(() => { AFF.idleCheck(); }, 30000);
  checkReminders();
  healthStage('boot:done');
  if (sceneReady && !bootDone) { bootDone = true; try { init3D(); healthStage('3d:ready'); } catch (e) { healthError(e, 'init3D'); } }
}
window.addEventListener('DOMContentLoaded', () => {
  sceneEl = document.querySelector('a-scene');
  if (!sceneEl) return;
  ROOM_LOAD().then((r) => { if (r) ROOM.active = true; });
  const onLoaded = () => {
    sceneReady = true;
    sceneEl.addEventListener('enter-vr', onEnterVR);
    sceneEl.addEventListener('exit-vr', onExitVR);
    if (bootDone) return;
    if (!window.__bootStarted) { window.__bootStarted = true; boot(); }
    else { bootDone = true; init3D(); } // scene arrived after the flat-UI fallback boot
  };
  if (sceneEl.hasLoaded) onLoaded(); else sceneEl.addEventListener('loaded', onLoaded);
  // safety: if the scene never fires loaded (CDN hiccup), still boot the flat UI
  setTimeout(() => { if (!window.__bootStarted) { window.__bootStarted = true; sceneReady = false; boot(); toast('3D scene is still loading — the flat panel works now; VR buttons enable when the scene is ready.', 5000); } }, 6000);
});

/* =====================================================================
   VISUAL POLISH — art direction as a feature: warm cinematic light
   (amber vs deep teal), layered depth, glossy/matte contrast, soft
   reflections, light haze + drifting dust motes. Deck Mode only.
   ===================================================================== */
let MOTES = null;
function polishEnvTexture() {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
  const x = cv.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, '#0a2027'); g.addColorStop(0.45, '#7a5a26'); g.addColorStop(0.55, '#E8A33D'); g.addColorStop(0.65, '#123038'); g.addColorStop(1, '#050d10');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const face = new THREE.CanvasTexture(cv);
  const cube = new THREE.CubeTexture([face.image, face.image, face.image, face.image, face.image, face.image]);
  cube.needsUpdate = true;
  return cube;
}
function floorTexture() {
  const t = makeTex(1024, 1024); const { ctx, c } = t;
  const g = ctx.createRadialGradient(512, 512, 60, 512, 512, 512);
  g.addColorStop(0, '#17333c'); g.addColorStop(0.45, '#0e242c'); g.addColorStop(0.8, '#071419'); g.addColorStop(1, '#040b0e');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 1024);
  ctx.strokeStyle = 'rgba(201,151,63,.20)'; ctx.lineWidth = 2;
  [150, 260, 380].forEach((r) => { ctx.beginPath(); ctx.arc(512, 512, r, 0, 7); ctx.stroke(); });
  ctx.fillStyle = 'rgba(245,236,215,.05)';
  for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; ctx.fillRect(512 + Math.sin(a) * 300 - 2, 512 + Math.cos(a) * 300 - 2, 4, 4); }
  t.tex.needsUpdate = true; return t;
}
function applyEnvToDeck(env) {
  const set = document.getElementById('deckSet'); if (!set) return;
  set.object3D.traverse((o) => {
    if (o.isMesh && o.material && 'metalness' in o.material && o.material.metalness >= 0.6 && !o.material.envMap) {
      o.material.envMap = env; o.material.envMapIntensity = 0.85; o.material.needsUpdate = true;
    }
  });
}
function buildDeckPolish() {
  if (typeof THREE === 'undefined') return;
  const set = document.getElementById('deckSet'); if (!set) return;
  const env = polishEnvTexture();
  // glossy inlay floor
  const floor = $('floorDeck');
  if (floor) floor.addEventListener('loaded', () => { const m = floor.getObject3D('mesh'); if (m) m.material = new THREE.MeshStandardMaterial({ map: floorTexture().tex, roughness: 0.34, metalness: 0.55, envMap: env, envMapIntensity: 0.5 }); });
  // brass floor inlay rings
  [3.4, 5.4].forEach((r) => {
    const ring = document.createElement('a-ring');
    ring.setAttribute('position', '0 0.012 0.6'); ring.setAttribute('rotation', '-90 0 0');
    ring.setAttribute('radius-inner', String(r)); ring.setAttribute('radius-outer', String(r + 0.045));
    ring.setAttribute('material', 'color:#c9973f; metalness:.9; roughness:.28');
    set.appendChild(ring);
  });
  // viewport mullions (composition bars across the great window) + sill
  const mull = document.createElement('a-entity'); mull.setAttribute('position', '0 2.5 -6.32');
  mull.innerHTML = '<a-box width="0.07" height="5" depth="0.06" material="color:#8a6a2f; metalness:.85; roughness:.3"></a-box>' +
    '<a-box width="5" height="0.07" depth="0.06" material="color:#8a6a2f; metalness:.85; roughness:.3"></a-box>' +
    '<a-box position="0 -2.62 0.1" width="5.6" height="0.14" depth="0.3" material="color:#4a3520; roughness:.6; metalness:.3"></a-box>';
  set.appendChild(mull);
  // warm practical light at the jukebox corner (total dynamic lights stay ≤ 5)
  const jl = document.createElement('a-light');
  jl.setAttribute('type', 'point'); jl.setAttribute('color', '#ff9d5c'); jl.setAttribute('intensity', '5');
  jl.setAttribute('distance', '6'); jl.setAttribute('position', '-4.2 1.7 -0.4');
  set.appendChild(jl);
  // drifting dust motes in the lamplight
  const n = 260, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = -6 + Math.random() * 12; pos[i * 3 + 1] = 0.3 + Math.random() * 3.8; pos[i * 3 + 2] = -5 + Math.random() * 8; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  MOTES = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffd9a0, size: 0.02, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  set.object3D.add(MOTES);
  applyEnvToDeck(env);
  setTimeout(() => applyEnvToDeck(env), 1500);
}
function visualTick(dt, t) {
  if (MOTES) { MOTES.rotation.y = t * 0.008; MOTES.position.y = Math.sin(t * 0.24) * 0.05; }
}

/* =====================================================================
   EMOJI FACES — the Buddies are living emojis with robot bodies.
   Faces are high-res canvas textures on the round head, drawn per
   persona (soft pastel glow tint, rosy cheeks, accent sparkle) and
   swapped by expression: idle 😊 · listen 🤩 · think 🤔 · speak 😄 ·
   laugh 😆 · greet 👋 · blink. Textures are created lazily per
   persona+expression so only what's used costs memory.
   ===================================================================== */
const FACE_TEX = {};
function drawFaceArt(ctx, p, expr, cx, cy, R, o) {
  const ink = '#2b2320', mouthC = '#8a5a44';
  // soft skin-glow tint (persona pastel)
  const g = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.02);
  g.addColorStop(0, softColor(p.color) + '2e'); g.addColorStop(1, softColor(p.color) + '00');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.02, 0, 7); ctx.fill();
  // rosy cheeks
  [-1, 1].forEach((s) => {
    const cg = ctx.createRadialGradient(cx + s * R * 0.52, cy + R * 0.16, 2, cx + s * R * 0.52, cy + R * 0.16, R * 0.30);
    cg.addColorStop(0, 'rgba(255,130,150,.55)'); cg.addColorStop(1, 'rgba(255,130,150,0)');
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx + s * R * 0.52, cy + R * 0.16, R * 0.30, 0, 7); ctx.fill();
  });
  const eyeY = cy - R * 0.10, eyeDX = R * 0.35, eyeR = R * 0.165;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  function glossyEye(ex, pupilUp) {
    ctx.fillStyle = ink; ctx.beginPath(); ctx.ellipse(ex, eyeY, eyeR * 0.82, eyeR * 1.05, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(ex - eyeR * 0.26, eyeY - eyeR * 0.38 + (pupilUp || 0), eyeR * 0.30, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(ex + eyeR * 0.24, eyeY + eyeR * 0.30 + (pupilUp || 0), eyeR * 0.16, 0, 7); ctx.fill();
  }
  function closedEye(ex, flip) { // happy arc / squint chevron
    ctx.strokeStyle = ink; ctx.lineWidth = R * 0.085;
    ctx.beginPath();
    if (flip) { ctx.moveTo(ex - eyeR * 0.9, eyeY - eyeR * 0.55); ctx.lineTo(ex + eyeR * 0.75, eyeY); ctx.lineTo(ex - eyeR * 0.9, eyeY + eyeR * 0.55); }
    else ctx.arc(ex, eyeY + eyeR * 0.35, eyeR * 0.85, Math.PI * 1.12, Math.PI * 1.88);
    ctx.stroke();
  }
  function starEye(ex) {
    ctx.fillStyle = p.accent; ctx.strokeStyle = ink; ctx.lineWidth = R * 0.03;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 - Math.PI / 2, rr = i % 2 ? eyeR * 0.45 : eyeR * 1.05;
      const px = ex + Math.cos(a) * rr, py = eyeY + Math.sin(a) * rr; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, eyeY, eyeR * 0.2, 0, 7); ctx.fill();
  }
  function smileArc(r, yOff, open, wide) {
    const my = cy + R * (yOff || 0.36);
    if (open) {
      ctx.fillStyle = '#7c4530';
      ctx.beginPath(); ctx.arc(cx, my - r * 0.32, r * (wide || 1), 0.08 * Math.PI, 0.92 * Math.PI); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff9eb0'; ctx.beginPath(); ctx.ellipse(cx, my + r * 0.28, r * 0.45, r * 0.18, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = mouthC; ctx.lineWidth = R * 0.05; ctx.beginPath(); ctx.arc(cx, my - r * 0.32, r * (wide || 1), 0.08 * Math.PI, 0.92 * Math.PI); ctx.stroke();
    } else {
      ctx.strokeStyle = mouthC; ctx.lineWidth = R * 0.085;
      ctx.beginPath(); ctx.arc(cx, my - r * 0.45, r, 0.18 * Math.PI, 0.82 * Math.PI); ctx.stroke();
    }
  }
  // ---- face-database layer (v2): brows from the expression, and a
  // viseme mouth when speech values are supplied via opts ----
  const O = o || {};
  const dbSmile = O.db ? (O.db.smile || 0) : 0;
  function browLines(raise, furrow) {
    ctx.strokeStyle = ink; ctx.lineWidth = R * 0.055;
    [-1, 1].forEach((s) => {
      const bx = cx + s * eyeDX, by = eyeY - eyeR * 1.55 - (raise || 0) * R * 0.10;
      ctx.beginPath();
      ctx.moveTo(bx - eyeR * 0.8, by + (furrow || 0) * R * 0.07);
      ctx.lineTo(bx + eyeR * 0.8, by - (furrow || 0) * s * R * 0.09 + (furrow || 0) * R * 0.02);
      ctx.stroke();
    });
  }
  function visemeMouth(mv) {
    const my = cy + R * 0.40;
    const w = Math.max(R * 0.05, R * (0.15 + mv.mouthWidth * 0.30) * (1 - mv.lipRound * 0.38));
    const h = R * (0.012 + mv.mouthOpen * 0.30 + mv.jawDrop * 0.05);
    if (mv.lipPress > 0.65) { // lips pressed shut (PP viseme)
      ctx.strokeStyle = mouthC; ctx.lineWidth = R * 0.05;
      ctx.beginPath(); ctx.moveTo(cx - w, my); ctx.quadraticCurveTo(cx, my - dbSmile * R * 0.05, cx + w, my); ctx.stroke();
      return;
    }
    if (h <= R * 0.028) { smileArc(R * 0.30, 0.38, false); return; }
    ctx.fillStyle = '#7c4530';
    ctx.beginPath(); ctx.ellipse(cx, my, w, h, 0, 0, 7); ctx.fill();
    if (mv.teethShow > 0.25) { ctx.fillStyle = '#fff8ee'; ctx.beginPath(); ctx.ellipse(cx, my - h * 0.52, w * 0.9, h * 0.45 * mv.teethShow, 0, 0, 7); ctx.fill(); }
    if (mv.tongueShow > 0.25) { ctx.fillStyle = '#ff9eb0'; ctx.beginPath(); ctx.ellipse(cx, my + h * 0.48, w * 0.52, h * 0.4 * mv.tongueShow, 0, 0, 7); ctx.fill(); }
    ctx.strokeStyle = mouthC; ctx.lineWidth = R * 0.045;
    ctx.beginPath(); ctx.ellipse(cx, my, w, h, 0, 0, 7); ctx.stroke();
  }
  if (O.db) browLines(O.db.browRaise, O.db.browFurrow);
  if (O.mouth) {
    if (O.eyesClosed) { closedEye(cx - eyeDX, false); closedEye(cx + eyeDX, false); }
    else if (expr === 'laughing') { closedEye(cx - eyeDX, true); closedEye(cx + eyeDX, false); }
    else if (expr === 'listening') { starEye(cx - eyeDX); starEye(cx + eyeDX); }
    else if (expr === 'thinking') { glossyEye(cx - eyeDX, 0); glossyEye(cx + eyeDX, -eyeR * 0.3); }
    else { glossyEye(cx - eyeDX, 0); glossyEye(cx + eyeDX, 0); }
    visemeMouth(O.mouth);
    return;
  }
  if (expr === 'laugh') { closedEye(cx - eyeDX, true); closedEye(cx + eyeDX, false); smileArc(R * 0.42, 0.42, true, 1.15); }
  else if (expr === 'greet') { closedEye(cx - eyeDX, false); closedEye(cx + eyeDX, false); smileArc(R * 0.40, 0.38, true, 1.1); }
  else if (expr === 'blink') { closedEye(cx - eyeDX, false); closedEye(cx + eyeDX, false); smileArc(R * 0.34, 0.36, false); }
  else if (expr === 'listen') { starEye(cx - eyeDX); starEye(cx + eyeDX); smileArc(R * 0.36, 0.38, true, 1); }
  else if (expr === 'think' || expr === 'thinking') {
    glossyEye(cx - eyeDX, 0); glossyEye(cx + eyeDX, -eyeR * 0.3);
    ctx.strokeStyle = ink; ctx.lineWidth = R * 0.06;
    ctx.beginPath(); ctx.moveTo(cx + eyeDX - eyeR * 0.8, eyeY - eyeR * 1.5); ctx.lineTo(cx + eyeDX + eyeR * 0.8, eyeY - eyeR * 1.75); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + R * 0.10, cy + R * 0.42); ctx.lineTo(cx + R * 0.34, cy + R * 0.40); ctx.stroke();
  }
  else if (expr === 'speak') { glossyEye(cx - eyeDX, 0); glossyEye(cx + eyeDX, 0); smileArc(R * 0.38, 0.40, true, 1.05); }
  // face-database expression ids (affective layer, static path)
  else if (expr === 'happy' || expr === 'encouraging') { glossyEye(cx - eyeDX, 0); glossyEye(cx + eyeDX, 0); smileArc(R * 0.40, 0.38, true, 1.05); }
  else if (expr === 'laughing') { closedEye(cx - eyeDX, true); closedEye(cx + eyeDX, false); smileArc(R * 0.42, 0.42, true, 1.15); }
  else if (expr === 'listening') { starEye(cx - eyeDX); starEye(cx + eyeDX); smileArc(R * 0.36, 0.38, true, 1); }
  else if (expr === 'surprised') { glossyEye(cx - eyeDX, 0); glossyEye(cx + eyeDX, 0); ctx.fillStyle = '#7c4530'; ctx.beginPath(); ctx.arc(cx, cy + R * 0.40, R * 0.09, 0, 7); ctx.fill(); }
  else if (expr === 'concerned') { glossyEye(cx - eyeDX, 0); glossyEye(cx + eyeDX, 0); ctx.strokeStyle = mouthC; ctx.lineWidth = R * 0.085; ctx.beginPath(); ctx.arc(cx, cy + R * 0.54, R * 0.30, Math.PI * 1.18, Math.PI * 1.82); ctx.stroke(); }
  else { glossyEye(cx - eyeDX, 0); glossyEye(cx + eyeDX, 0); smileArc(R * 0.34, 0.36, false); }
}
function faceTexture(p, expr) {
  const key = p.id + ':' + expr;
  if (FACE_TEX[key]) return FACE_TEX[key];
  const t = makeTex(448, 448);
  drawFaceArt(t.ctx, p, expr, 224, 224, 190);
  t.tex.needsUpdate = true;
  FACE_TEX[key] = t; return t;
}
function setFace(pid, expr) {
  const B = BOTS[pid]; if (!B || !B.faceMesh || B.faceExpr === expr) return;
  B.faceExpr = expr;
  const mesh = B.faceMesh.getObject3D('mesh'); if (!mesh) return;
  mesh.material.map = faceTexture(personaById(pid), expr).tex;
  mesh.material.needsUpdate = true;
}
const FACES = { last: 0 };
function facesTick(now) {
  if (now - FACES.last < 110) return;
  FACES.last = now;
  for (const pid in BOTS) {
    const B = BOTS[pid]; if (!B.faceMesh) continue;
    if (!B.nextBlink) B.nextBlink = now + 1800 + Math.random() * 2800;
    let expr = 'idle';
    if (now < (S.laughUntil[pid] || 0)) expr = 'laugh';
    else if (S.speakingPersona === pid && now < S.speakingUntil) expr = 'speak';
    else if (now < (B.waveUntil || 0)) expr = 'greet';
    else if (pid === S.activePersonaId && (S.listening || (S.typingUntil || 0) > now)) expr = 'listen';
    else if (pid === S.activePersonaId && (S.thinkingUntil || 0) > now) expr = 'think';
    if (B.faceExpr && B.faceExpr.indexOf('dyn:') === 0 && S.speakingPersona === pid && now < S.speakingUntil) continue; // viseme face owns the texture while speaking
    if (QBDB.pers && pid === S.activePersonaId && expr === 'idle') { // affective layer picks the resting expression
      const cur = AFF.current(pid, now);
      if (cur.def && cur.def.faceAnimExpression && cur.def.faceAnimExpression !== 'idle') expr = cur.def.faceAnimExpression;
    }
    if (expr === 'idle' || expr === 'listen' || expr === 'think') {
      if (now >= B.nextBlink && now < B.nextBlink + 150) expr = 'blink';
      else if (now >= B.nextBlink + 150) B.nextBlink = now + 2000 + Math.random() * 2800;
    }
    setFace(pid, expr);
  }
  if (PHONE.callPid && PHONE.faceEl) {
    const talking = S.speakingPersona === PHONE.callPid && now < S.speakingUntil;
    PHONE.faceEl.classList.toggle('talking', talking);
  }
}

/* =====================================================================
   SIGNATURE SKINS — every Buddy = the cute base buddy + a SUBJECT
   SKIN: a silhouette-changing themed aesthetic built from a signature
   object/element that embodies what they teach. Same design language
   the future marketplace / avatar-part system plugs into. All skins
   stay round, cute, and emoji-faced.
   ===================================================================== */
PERSONAS.push({ id: 'spark', nickname: 'Spark', color: '#ff7a29', accent: '#ffb03a', accessory: 'none', tutor: true,
  laugh: { phrase: 'Hee hee — safely does it!', style: 'warm giggle', amp: 1.1 } });
window.SPEC_IDENTITIES = window.SPEC_IDENTITIES || {};
SPEC_IDENTITIES.spark = { name: 'Spark', homeCity: 'Tutor Buddy', homeCountry: 'Fire & Forest Safety',
  backstory: 'Spark is a Tutor Buddy — a friendly little matchstick with a candle-warm flame — who teaches forest & fire safety and all about firefighters, the helpers who run TOWARD the fire so everyone else can get safe.',
  expertise: ['Forest & fire safety', 'Smoke alarms', 'Firefighters are helpers'], tone: 'Warm, clear, and encouraging — safety taught like a friend, never a scare.',
  greeting: 'Hi hi! I\'m Spark 🔥 — your Tutor Buddy for fire & forest safety. Ask me about campfires, smoke alarms, or the amazing helpers called firefighters — or tap Help me… and I\'ll walk you through my Fire Safety guide, step by step.' };
Object.assign(personaById('spark'), SPEC_IDENTITIES.spark, { speechStyle: 'Warm, clear, simple words — a friendly teacher, never scary.', keywords: ['fire', 'campfire', 'smoke alarm', 'firefighter', 'safety', 'forest'] });
LOVES.spark = { love: 'campfire songs (sung a safe distance from the fire!) and safety stories', science: 'how fire works — fuel, heat, and air — and how respecting it keeps everyone safe' };
function wooferTexture(p) {
  const t = makeTex(512, 512); const { ctx, c } = t;
  ctx.fillStyle = '#14171c'; ctx.fillRect(0, 0, 512, 512);
  for (let r = 230; r > 60; r -= 28) { ctx.strokeStyle = r % 56 ? '#232830' : '#2e3540'; ctx.lineWidth = 13; ctx.beginPath(); ctx.arc(256, 256, r, 0, 7); ctx.stroke(); }
  ctx.fillStyle = p.accent; ctx.beginPath(); ctx.arc(256, 256, 58, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.arc(238, 238, 20, 0, 7); ctx.fill();
  t.tex.needsUpdate = true; return t;
}
function ballTexture() {
  const t = makeTex(512, 512); const { ctx, c } = t;
  ctx.fillStyle = '#f4f1ea'; ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = '#22242a';
  const pent = (x, y, r) => { ctx.beginPath(); for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 - Math.PI / 2; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); ctx.fill(); };
  pent(256, 150, 62); pent(90, 300, 54); pent(430, 310, 54); pent(170, 460, 48); pent(360, 470, 48); pent(40, 90, 40); pent(478, 96, 40);
  ctx.strokeStyle = 'rgba(30,30,40,.35)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(256, 256, 200, 0, 7); ctx.stroke();
  t.tex.needsUpdate = true; return t;
}
function routeTexture(p) {
  const t = makeTex(512, 400); const { ctx, c } = t;
  ctx.fillStyle = '#0d2e39'; ctx.fillRect(0, 0, 512, 400);
  ctx.strokeStyle = '#E8A33D'; ctx.lineWidth = 13; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(50, 270); ctx.bezierCurveTo(170, 130, 320, 300, 462, 140); ctx.stroke();
  [[50, 270], [205, 205], [330, 232], [462, 140]].forEach((pt, i) => { ctx.fillStyle = i === 3 ? '#37e0c8' : '#f5ecd7'; ctx.beginPath(); ctx.arc(pt[0], pt[1], 15, 0, 7); ctx.fill(); ctx.strokeStyle = '#0d2e39'; ctx.lineWidth = 4; ctx.stroke(); });
  ctx.fillStyle = '#f5ecd7'; ctx.font = '800 40px ' + COND; ctx.textAlign = 'center';
  ctx.fillText('♪ SESSION LINE', 256, 356);
  t.tex.needsUpdate = true; return t;
}
function auroraTexture(hueShift) {
  const t = makeTex(512, 256); const { ctx, c } = t;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(80,255,170,0)'); g.addColorStop(0.3, 'rgba(80,255,170,.75)');
  g.addColorStop(0.62, 'rgba(60,200,255,.55)'); g.addColorStop(0.85, 'rgba(160,90,255,.5)'); g.addColorStop(1, 'rgba(160,90,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 256);
  if (hueShift) { ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = 'rgba(120,80,255,.25)'; ctx.fillRect(0, 0, 512, 256); ctx.globalCompositeOperation = 'source-over'; }
  t.tex.needsUpdate = true; return t;
}
function heartTexture() {
  const t = makeTex(128, 128); const { ctx } = t;
  const rows = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
  rows.forEach((row, y) => { row.split('').forEach((ch, x) => { if (ch === 'X') { ctx.fillStyle = '#ff5f8f'; ctx.fillRect(14 + x * 15, 16 + y * 15, 14, 14); } }); });
  t.tex.needsUpdate = true; return t;
}
function buildSkin(p, B, root) {
  const rig = B.rig; if (!rig) return;
  const add = (html) => { const d = document.createElement('a-entity'); d.innerHTML = html; rig.appendChild(d); return d; };
  B.fx = { kind: p.id };
  if (p.id === 'adaeze') { // glass-sphere ATOM — levitates
    B.hoverLift = 0.085;
    add('<a-sphere position="0 0.55 0" radius="0.44" material="color:#bfe8ff; transparent:true; opacity:.15; roughness:.05; metalness:0"></a-sphere>');
    const atom = document.createElement('a-entity'); atom.setAttribute('position', '0 0.55 0.02'); rig.appendChild(atom);
    let inner = '<a-sphere radius="0.075" material="color:' + p.accent + '; emissive:' + p.accent + '; emissiveIntensity:2.2"></a-sphere>';
    atom.innerHTML = inner;
    B.fx.rings = [];
    [[0.17, '20 0 0'], [0.20, '70 30 0'], [0.23, '-40 65 20']].forEach((r, i) => {
      const g = document.createElement('a-entity'); g.setAttribute('rotation', r[1]);
      g.innerHTML = '<a-torus radius="' + r[0] + '" radius-tubular="0.006" material="color:' + p.accent + '; emissive:' + p.accent + '; emissiveIntensity:.8"></a-torus><a-sphere position="' + r[0] + ' 0 0" radius="0.02" material="color:#ffffff; emissive:#ffffff; emissiveIntensity:1.4"></a-sphere>';
      atom.appendChild(g); B.fx.rings.push(g);
    });
  }
  if (p.id === 'kenji') { // VINYL body + tone arm + speaking sound-rings
    const g = add('<a-entity position="0 0.55 0.06" rotation="10 0 0"><a-cylinder radius="0.315" height="0.09" rotation="90 0 0" material="color:#101216; roughness:.22; metalness:.3"></a-cylinder><a-circle class="vinylLabel" position="0 0 0.048" radius="0.11"></a-circle></a-entity>');
    g.addEventListener('loaded', () => { const lab = g.querySelector('.vinylLabel'); if (lab) { const t = makeTex(128, 128); t.ctx.fillStyle = p.color; t.ctx.beginPath(); t.ctx.arc(64, 64, 62, 0, 7); t.ctx.fill(); t.ctx.fillStyle = '#101216'; t.ctx.beginPath(); t.ctx.arc(64, 64, 9, 0, 7); t.ctx.fill(); t.tex.needsUpdate = true; bindTex(lab, t); } });
    add('<a-entity position="0.33 0.86 0.02" rotation="0 0 38"><a-cylinder radius="0.011" height="0.46" material="color:#8a8f98; metalness:.7; roughness:.35"></a-cylinder></a-entity>');
    B.fx.waveRings = [];
    [0.30, 0.38].forEach((r) => {
      const ring = document.createElement('a-ring');
      ring.setAttribute('position', '0 0.94 0.10'); ring.setAttribute('radius-inner', String(r - 0.012)); ring.setAttribute('radius-outer', String(r));
      ring.setAttribute('material', 'color:' + p.accent + '; transparent:true; opacity:0; side:double');
      rig.appendChild(ring); B.fx.waveRings.push(ring);
    });
  }
  if (p.id === 'mariana') { // chef-POT body + happy steam
    add('<a-entity position="0 0.40 0"><a-cylinder radius="0.26" height="0.34" material="color:#3a3f46; metalness:.6; roughness:.4"></a-cylinder><a-torus position="0 0.17 0" rotation="90 0 0" radius="0.26" radius-tubular="0.02" material="color:#565d66; metalness:.7; roughness:.35"></a-torus><a-cylinder position="0 0.205 0" radius="0.27" height="0.045" material="color:#565d66; metalness:.7; roughness:.35"></a-cylinder><a-sphere position="0 0.25 0" radius="0.035" material="color:#c9973f; metalness:.8; roughness:.3"></a-sphere></a-entity>');
    B.fx.steam = [];
    [-0.09, 0, 0.09].forEach((x) => {
      const s = document.createElement('a-sphere');
      s.setAttribute('position', x + ' 1.24 0'); s.setAttribute('radius', '0.035');
      s.setAttribute('material', 'color:#ffffff; transparent:true; opacity:0');
      rig.appendChild(s); B.fx.steam.push(s);
    });
  }
  if (p.id === 'arjun' && B.head) { // film REELS as ears + projector glow
    [-1, 1].forEach((s) => {
      const reel = document.createElement('a-entity');
      reel.setAttribute('position', (s * 0.245) + ' 0.01 0');
      reel.innerHTML = '<a-cylinder radius="0.105" height="0.03" rotation="0 0 90" material="color:#22252b; roughness:.4; metalness:.4"></a-cylinder>' +
        '<a-sphere position="' + (s * 0.018) + ' 0 0" radius="0.02" material="color:' + p.accent + '; emissive:' + p.accent + '; emissiveIntensity:1"></a-sphere>';
      B.head.appendChild(reel);
    });
    const gl = add('<a-entity position="0 0.62 0.26"><a-sphere radius="0.045" material="color:#ffc37a; emissive:#ffb45e; emissiveIntensity:2.4"></a-sphere><a-circle class="projGlow" radius="0.095" material="color:#ffc37a; transparent:true; opacity:.3"></a-circle></a-entity>');
    gl.addEventListener('loaded', () => { B.fx.glow = gl.querySelector('.projGlow'); });
  }
  if (p.id === 'jonas') { // little TRAM — glowing route-line panel + headlights
    const g = add('<a-entity position="0 0.55 0.235"><a-box width="0.46" height="0.36" depth="0.05" material="color:#0d2e39; roughness:.5"></a-box><a-plane class="routeFace" position="0 0 0.027" width="0.44" height="0.34"></a-plane></a-entity>');
    g.addEventListener('loaded', () => { const f = g.querySelector('.routeFace'); if (f) bindTex(f, routeTexture(p)); });
    add('<a-sphere position="-0.15 0.43 0.26" radius="0.025" material="color:#ffe9bd; emissive:#ffd97a; emissiveIntensity:1.8"></a-sphere><a-sphere position="0.15 0.43 0.26" radius="0.025" material="color:#ffe9bd; emissive:#ffd97a; emissiveIntensity:1.8"></a-sphere>');
  }
  if (p.id === 'camila') { // FUTSAL BALL body
    const applyBall = () => { const m = B.bodyMain ? B.bodyMain.getObject3D('mesh') : null; if (m) m.material = new THREE.MeshStandardMaterial({ map: ballTexture().tex, roughness: .5 }); };
    if (B.bodyMain) { if (B.bodyMain.hasLoaded) applyBall(); else B.bodyMain.addEventListener('loaded', applyBall); }
  }
  if (p.id === 'layla') { // warm LANTERN body with flickering core
    add('<a-entity position="0 0.55 0"><a-cylinder radius="0.305" height="0.54" open-ended="true" material="color:#ffd9a0; transparent:true; opacity:.20; side:double; roughness:.1"></a-cylinder><a-cylinder position="0 0.29 0" radius="0.315" height="0.045" material="color:#8a6a2f; metalness:.8; roughness:.35"></a-cylinder><a-cylinder position="0 -0.29 0" radius="0.315" height="0.045" material="color:#8a6a2f; metalness:.8; roughness:.35"></a-cylinder></a-entity>');
    const core = document.createElement('a-sphere');
    core.setAttribute('position', '0 0.55 0'); core.setAttribute('radius', '0.15');
    core.setAttribute('material', 'color:#ffcf8a; emissive:#ffb45e; emissiveIntensity:2.1');
    rig.appendChild(core); B.fx.core = core;
  }
  if (p.id === 'jiwoo') { // game-CONTROLLER body + pixel heart
    add('<a-entity position="0 0.52 -0.03"><a-box width="0.56" height="0.36" depth="0.24" material="color:#2e3440; roughness:.5"></a-box></a-entity>');
    const btnCols = ['#ff5f8f', '#58d68a', '#37c8e0', '#E8A33D'];
    [[0.16, 0.60], [0.21, 0.55], [0.11, 0.55], [0.16, 0.50]].forEach((pt, i) => {
      add('<a-sphere position="' + pt[0] + ' ' + pt[1] + ' 0.105" radius="0.027" material="color:' + btnCols[i] + '; roughness:.35"></a-sphere>');
    });
    add('<a-box position="-0.16 0.55 0.10" width="0.095" height="0.03" depth="0.02" material="color:#171a20"></a-box><a-box position="-0.16 0.55 0.10" width="0.03" height="0.095" depth="0.02" material="color:#171a20"></a-box>');
    const heart = document.createElement('a-plane');
    heart.setAttribute('position', '0 1.34 0'); heart.setAttribute('width', '0.13'); heart.setAttribute('height', '0.13');
    heart.setAttribute('visible', 'false');
    rig.appendChild(heart); B.fx.heart = heart;
    heart.addEventListener('loaded', () => bindTex(heart, heartTexture()));
  }
  if (p.id === 'marcus') { // SPEAKER body — woofer belly pulses with the bass
    const g = add('<a-entity class="wooferG" position="0 0.55 0.20"><a-torus radius="0.225" radius-tubular="0.025" material="color:#232830; roughness:.5"></a-torus><a-circle class="wooferFace" radius="0.215"></a-circle></a-entity>');
    B.fx.woofer = g;
    g.addEventListener('loaded', () => { const f = g.querySelector('.wooferFace'); if (f) bindTex(f, wooferTexture(p)); });
  }
  if (p.id === 'einar') { // wrapped in AURORA ribbons
    B.fx.ribbons = [];
    [[0.47, 0.34, 0], [0.55, 0.26, 1]].forEach((cfg, i) => {
      const rib = document.createElement('a-cylinder');
      rib.setAttribute('position', '0 ' + (0.55 + i * 0.07) + ' 0');
      rib.setAttribute('radius', String(cfg[0])); rib.setAttribute('height', String(cfg[1]));
      rib.setAttribute('open-ended', 'true'); rib.setAttribute('theta-start', String(i * 40)); rib.setAttribute('theta-length', '210');
      rib.setAttribute('material', 'transparent:true; opacity:.5; side:double; depthWrite:false');
      rig.appendChild(rib); B.fx.ribbons.push(rib);
      rib.addEventListener('loaded', () => { const m = rib.getObject3D('mesh'); if (m) { m.material.map = auroraTexture(cfg[2]).tex; m.material.blending = THREE.AdditiveBlending; m.material.needsUpdate = true; } });
    });
  }
  if (p.id === 'spark') { // MATCHSTICK body, flame crown — a friendly candle-glow
    if (B.bodyMain) B.bodyMain.setAttribute('visible', 'false');
    if (B.bellyMain) B.bellyMain.setAttribute('visible', 'false');
    add('<a-box position="0 0.52 0" width="0.15" height="0.54" depth="0.09" material="color:#d9a066; roughness:.8"></a-box><a-box position="0 0.26 0" width="0.15" height="0.07" depth="0.09" material="color:#a8763e; roughness:.85"></a-box>');
    if (B.head) { const hs = B.head.querySelector('a-sphere'); if (hs) hs.setAttribute('material', 'color:#c65a35; roughness:.55'); }
    const fl = document.createElement('a-entity');
    fl.setAttribute('position', '0 1.26 0');
    fl.innerHTML = '<a-cone position="0 0.10 0" radius="0.085" height="0.27" material="color:#ff8c3a; emissive:#ff7a29; emissiveIntensity:1.5; transparent:true; opacity:.92"></a-cone><a-cone position="0 0.06 0" radius="0.048" height="0.17" material="color:#ffdf6b; emissive:#ffd23e; emissiveIntensity:1.8"></a-cone><a-sphere position="0 -0.02 0" radius="0.032" material="color:#ffe9a0; emissive:#ffdf6b; emissiveIntensity:2"></a-sphere>';
    rig.appendChild(fl); B.fx.flame = fl;
  }
}
function skinTick(now, t) {
  for (const pid in BOTS) {
    const B = BOTS[pid]; if (!B.fx) continue;
    const speaking = S.speakingPersona === pid && now < S.speakingUntil;
    const laughing = now < (S.laughUntil[pid] || 0);
    const greet = now < (B.waveUntil || 0);
    const fx = B.fx;
    if (fx.rings) fx.rings.forEach((r, i) => { r.object3D.rotation.x = t * (0.7 + i * 0.33); r.object3D.rotation.y = t * (0.5 + i * 0.27); });
    if (fx.waveRings) fx.waveRings.forEach((ring, i) => {
      const m = ring.getObject3D('mesh'); if (!m) return;
      if (speaking) { const ph = ((now + i * 450) % 900) / 900; const s = 0.8 + ph * 0.9; ring.object3D.scale.set(s, s, s); m.material.opacity = 0.55 * (1 - ph); }
      else m.material.opacity = 0;
    });
    if (fx.steam) fx.steam.forEach((s, i) => {
      const m = s.getObject3D('mesh'); if (!m) return;
      if (laughing || speaking || greet) { const f = (t * 0.32 + i * 0.37) % 1; s.object3D.position.y = 1.22 + f * 0.34; s.object3D.position.x = [-0.09, 0, 0.09][i] + Math.sin(t * 2 + i) * 0.02; const sc = 0.7 + f * 0.9; s.object3D.scale.set(sc, sc, sc); m.material.opacity = 0.5 * (1 - f); }
      else m.material.opacity = 0;
    });
    if (fx.core) { const m = fx.core.getObject3D('mesh'); if (m) m.material.emissiveIntensity = 2.05 + (Math.sin(t * 11) + Math.sin(t * 23 + 1.7)) * 0.17; }
    if (fx.woofer) { const s = speaking ? 1 + Math.abs(Math.sin(t * 12.6)) * 0.07 : 1; fx.woofer.object3D.scale.set(s, s, s); }
    if (fx.ribbons) fx.ribbons.forEach((r, i) => { r.object3D.rotation.y = t * (i ? -0.18 : 0.25) + i; r.object3D.position.y = (0.55 + i * 0.07) + Math.sin(t * 0.8 + i * 2) * 0.015; });
    if (fx.flame) { fx.flame.object3D.scale.y = 1 + Math.sin(t * 11) * 0.07 + Math.sin(t * 27) * 0.03; fx.flame.object3D.rotation.z = Math.sin(t * 6.3) * 0.07; fx.flame.object3D.rotation.x = speaking ? Math.sin(t * 9) * 0.05 : 0; }
    if (fx.heart) { const show = laughing || greet; fx.heart.setAttribute('visible', show ? 'true' : 'false'); if (show) { const s = 1 + Math.sin(t * 6) * 0.18; fx.heart.object3D.scale.set(s, s, s); const cam = $('cam'); if (cam) fx.heart.object3D.lookAt(cam.object3D.getWorldPosition(new THREE.Vector3())); } }
    if (fx.glow) { const m = fx.glow.getObject3D('mesh'); if (m) m.material.opacity = 0.28 + Math.sin(t * 2.2) * 0.08; }
    if (pid === 'camila' && B.rig && (laughing || greet)) { B.rig.object3D.position.y += Math.abs(Math.sin(t * 9)) * 0.05; B.rig.object3D.rotation.z += Math.sin(t * 9) * 0.035; }
  }
}
/* Spark's Fire Safety guide — joins the Help me… library */
GUIDES.push({ id: 'fire', icon: '🔥', title: 'Fire Safety with Spark', presenter: 'spark', desc: 'Smoke alarms, campfire rules, stop-drop-and-roll — taught by Spark, your Tutor Buddy.',
  steps: [
    { text: 'Fire Safety, step 1 of 6 — smoke alarms: one on every level of your home, tested monthly with the little button. If it chirps, that is a low battery asking for help — swap it the same day.', hl: 'notes' },
    { text: 'Step 2 of 6 — campfire rules: build in a ring of stones, keep a bucket of water AND a shovel beside it, and never leave a fire alone. When you are done: drown it, stir it, drown it again — if it is too hot to touch, it is too hot to leave.', hl: null },
    { text: 'Step 3 of 6 — if clothes ever catch fire: STOP where you are, DROP to the ground, cover your face, and ROLL back and forth until the flames are out. Never run — running feeds the fire air.', hl: null },
    { text: 'Step 4 of 6 — firefighters are HELPERS. If there is a fire: get outside fast, stay outside, and let firefighters do their brave job. Never hide from them — their gear looks big, but there is a friendly helper inside it.', hl: null },
    { text: 'Step 5 of 6 — kitchen safety: turn pot handles inward, keep towels and paper away from burners, and keep a "kid-and-pet-free zone" of about a meter around the stove while cooking.', hl: null },
    { text: 'Step 6 of 6 — have a family meeting spot outside (a tree, a mailbox) and practice the plan twice a year. Two ways out of every room, and once you are out — stay out. That is the whole drill, hero.', hl: 'chat' }
  ],
  done: 'That is Spark\'s Fire Safety guide — alarms tested, campfire respected, helpers celebrated. Come back anytime for a refresher, safety hero. 🔥' });

/* =====================================================================
   WRIST PANEL + VIRTUAL PHONE
   Wrist-flip: roll a controller past a threshold and HOLD briefly
   (debounced, hysteresis — no misfires) to summon a panel floating at
   the left controller: Voice toggle · HUD toggle · Control state ·
   Room Setup shortcut · Phone. The gesture is the delight, never the
   only path: 📱 Phone + wrist actions also live on the flat HUD.
   The phone: a chunky prop that docks in front of you. Home tiles —
   Buddies (call any Buddy: big emoji face, live voice if Voice Chat is
   on, transcript below, End Call returns) · Photos (this session's
   screenshots/recordings — a web page cannot browse the device
   gallery, and says so) · Fetti (shows "—"; arrives with the
   marketplace — never a fake balance) · Settings.
   ===================================================================== */
const CAPTURES = []; // session captures, fed by downloadBlob()
const WRIST = { open: false, panel: null, tex: null, armedAt: 0, lastFlip: 0, lastPaint: 0 };
const PHONE = { el: null, tex: null, open: false, callPid: null, callTimer: null, faceEl: null };
(function addPhoneCss() {
  const st = document.createElement('style');
  st.textContent = '.callFace{width:132px;height:132px;border-radius:50%;margin:6px auto;position:relative;box-shadow:0 0 0 6px rgba(255,255,255,.08),0 0 34px rgba(232,163,61,.25)}.callFace .eye{position:absolute;top:52px;width:15px;height:21px;border-radius:50%;background:#2b2320}.callFace .eye.l{left:36px}.callFace .eye.r{right:36px}.callFace .spec{position:absolute;width:5px;height:5px;border-radius:50%;background:#fff}.callFace .mouth{position:absolute;left:50%;bottom:30px;width:52px;height:26px;margin-left:-26px;border-bottom:6px solid #8a5a44;border-radius:0 0 40px 40px}.callFace.talking .mouth{animation:callTalk .38s ease-in-out infinite alternate}@keyframes callTalk{from{height:10px}to{height:30px}}.callFace .cheek{position:absolute;top:76px;width:22px;height:13px;border-radius:50%;background:rgba(255,130,150,.5)}.callFace .cheek.l{left:16px}.callFace .cheek.r{right:16px}.phoneTile{display:flex;flex-direction:column;gap:4px;align-items:flex-start;text-align:left}';
  document.head.appendChild(st);
})();
function buildWristPanel() {
  const hand = $('leftHand'); if (!hand) return;
  const e = document.createElement('a-entity');
  e.setAttribute('position', '0 0.105 0.02'); e.setAttribute('rotation', '-55 0 0'); e.setAttribute('visible', 'false');
  let inner = '<a-plane class="wristFace" width="0.24" height="0.15"></a-plane>';
  [['voice', 'VOICE'], ['hud', 'HUD'], ['phone', 'PHONE'], ['room', 'ROOM']].forEach((b, i) => {
    inner += '<a-entity class="wristBtn clickable" data-act="' + b[0] + '" position="' + ((i - 1.5) * 0.059) + ' -0.115 0.004"><a-box depth="0.012" height="0.05" width="0.054" material="color:#0a1e26; roughness:.4"></a-box><a-plane class="wristBtnFace" position="0 0 0.008" width="0.052" height="0.047"></a-plane></a-entity>';
  });
  e.innerHTML = inner;
  hand.appendChild(e); WRIST.panel = e;
  e.addEventListener('loaded', () => {
    WRIST.tex = makeTex(512, 320); bindTex(e.querySelector('.wristFace'), WRIST.tex); drawWristPanel();
    e.querySelectorAll('.wristBtn').forEach((b, i) => {
      const label = ['VOICE', 'HUD', 'PHONE', 'ROOM'][i];
      const t = makeTex(160, 144); const { ctx, c } = t;
      ctx.fillStyle = '#0a1e26'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.strokeStyle = 'rgba(201,151,63,.7)'; ctx.lineWidth = 5; ctx.strokeRect(4, 4, c.width - 8, c.height - 8);
      ctx.fillStyle = CREAM; ctx.font = '800 34px ' + COND; ctx.textAlign = 'center'; ctx.fillText(label, c.width / 2, 84);
      t.tex.needsUpdate = true; bindTex(b.querySelector('.wristBtnFace'), t);
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'voice') setVoice(!voiceOn());
        else if (act === 'hud') setHudHidden(!S.hudHidden);
        else if (act === 'phone') summonPhone();
        else if (act === 'room') openWizard('place');
        setTimeout(drawWristPanel, 120);
      });
    });
  });
}
function drawWristPanel() {
  if (!WRIST.tex) return;
  const { ctx, c } = WRIST.tex;
  ctx.fillStyle = 'rgba(8,22,27,.96)'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = BRASS; ctx.lineWidth = 6; ctx.strokeRect(6, 6, c.width - 12, c.height - 12);
  ctx.fillStyle = AMBER; ctx.font = '900 44px ' + COND; ctx.textAlign = 'left';
  ctx.fillText('⌚ WRIST', 30, 62);
  const row = (y, label, val, on) => {
    ctx.fillStyle = on ? '#58d68a' : '#e0655f'; ctx.beginPath(); ctx.arc(44, y - 12, 11, 0, 7); ctx.fill();
    ctx.fillStyle = CREAM; ctx.font = '700 38px ' + COND; ctx.fillText(label, 72, y);
    ctx.fillStyle = DIMC; ctx.font = '700 34px ' + COND; ctx.fillText(val, 300, y);
  };
  row(140, 'Voice Chat', voiceEffective() ? 'ON' : (voiceOn() ? 'ON·needs control' : 'OFF'), voiceEffective());
  row(205, 'HUD', S.hudHidden ? 'HIDDEN' : 'SHOWN', !S.hudHidden);
  row(270, 'Control', S.controlOn ? 'ON' : 'OFF', S.controlOn);
  WRIST.tex.tex.needsUpdate = true;
}
function toggleWrist(force) {
  WRIST.open = typeof force === 'boolean' ? force : !WRIST.open;
  if (WRIST.panel) WRIST.panel.setAttribute('visible', WRIST.open ? 'true' : 'false');
  if (WRIST.open) drawWristPanel();
}
function wristTick(now) {
  if (!WRIST.panel) return;
  if (WRIST.open && now - WRIST.lastPaint > 850) { WRIST.lastPaint = now; drawWristPanel(); }
  if (!xrSession) return;
  const hand = $('rightHand'); if (!hand || !hand.object3D) return;
  const q = new THREE.Quaternion(); hand.object3D.getWorldQuaternion(q);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  if (Math.abs(fwd.y) > 0.92) return; // pointing nearly straight up/down — roll is meaningless
  const up0 = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(up0, fwd).normalize();
  const up = new THREE.Vector3().crossVectors(fwd, right).normalize();
  const u = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const roll = Math.atan2(u.dot(right), u.dot(up));
  if (Math.abs(roll) > 2.0) { // wrist rolled over — arm the flip, require a short hold
    if (!WRIST.armedAt) WRIST.armedAt = now;
    if (now - WRIST.armedAt > 320 && now - WRIST.lastFlip > 1400) { WRIST.lastFlip = now; WRIST.armedAt = 0; toggleWrist(); }
  } else if (Math.abs(roll) < 0.8) WRIST.armedAt = 0;
}
/* ---------------- the phone prop + screens ---------------- */
function buildPhone() {
  const w = worldEl(); if (!w) return;
  const e = document.createElement('a-entity');
  e.setAttribute('position', '1.28 1.32 -1.0'); e.setAttribute('rotation', '0 -22 0'); e.setAttribute('visible', 'false');
  e.classList.add('clickable'); e.id = 'phone3d';
  let inner = '<a-box width="0.37" height="0.66" depth="0.045" material="color:#0d2b35; metalness:.45; roughness:.35"></a-box>' +
    '<a-plane class="phoneFace" position="0 0 0.024" width="0.335" height="0.60"></a-plane>' +
    '<a-circle position="0 0.295 0.024" radius="0.012" material="color:#37e0c8; emissive:#37e0c8; emissiveIntensity:1.2"></a-circle>';
  [['buddies', -0.082, 0.045], ['photos', 0.082, 0.045], ['fetti', -0.082, -0.075], ['settings', 0.082, -0.075]].forEach((t) => {
    inner += '<a-plane class="phoneTileHit clickable" data-sec="' + t[0] + '" position="' + t[1] + ' ' + t[2] + ' 0.028" width="0.145" height="0.105" material="transparent:true; opacity:0"></a-plane>';
  });
  e.innerHTML = inner;
  w.appendChild(e); PHONE.el = e;
  e.addEventListener('loaded', () => {
    PHONE.tex = makeTex(660, 1200); bindTex(e.querySelector('.phoneFace'), PHONE.tex); drawPhoneFace();
    e.querySelectorAll('.phoneTileHit').forEach((tile) => tile.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const sec = tile.dataset.sec;
      if (sec === 'settings') { navTo('settings'); return; }
      openPhoneSheet(sec);
    }));
  });
  e.addEventListener('click', () => openPhoneSheet('home'));
}
function drawPhoneFace() {
  if (!PHONE.tex) return;
  const { ctx, c } = PHONE.tex;
  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, '#0a3542'); g.addColorStop(0.55, '#062630'); g.addColorStop(1, '#04161c');
  ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
  const glow = ctx.createRadialGradient(330, 190, 20, 330, 190, 330);
  glow.addColorStop(0, 'rgba(232,163,61,.35)'); glow.addColorStop(1, 'rgba(232,163,61,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, c.width, 560);
  ctx.strokeStyle = 'rgba(201,151,63,.55)'; ctx.lineWidth = 4; ctx.strokeRect(14, 14, c.width - 28, c.height - 28);
  ctx.textAlign = 'center';
  if (PHONE.callPid) {
    const p = personaById(PHONE.callPid);
    const expr = S.speakingPersona === PHONE.callPid && nowMs() < S.speakingUntil ? 'speak' : 'idle';
    drawFaceArt(ctx, p, expr, 330, 420, 215);
    ctx.fillStyle = CREAM; ctx.font = '900 58px ' + COND;
    ctx.fillText(identityOf(PHONE.callPid).name, 330, 740);
    ctx.fillStyle = '#58d68a'; ctx.font = '800 36px ' + COND;
    ctx.fillText('● ON CALL', 330, 800);
    ctx.fillStyle = '#e0655f'; ctx.beginPath(); ctx.arc(330, 950, 52, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '900 44px Arial'; ctx.fillText('✕', 330, 966);
    ctx.fillStyle = DIMC; ctx.font = '600 30px ' + COND; ctx.fillText('tap the phone to manage the call', 330, 1080);
  } else {
    const d = new Date();
    ctx.fillStyle = CREAM; ctx.font = '900 104px ' + COND;
    ctx.fillText(String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'), 330, 240);
    ctx.fillStyle = DIMC; ctx.font = '700 34px ' + COND; ctx.fillText('AI BUDDIES PHONE', 330, 300);
    const tiles = [['📞', 'Buddies'], ['🖼', 'Photos'], ['🪙', 'Fetti'], ['⚙', 'Settings']];
    tiles.forEach((t, i) => {
      const x = i % 2 ? 350 : 40, y = i < 2 ? 420 : 680;
      ctx.fillStyle = 'rgba(255,255,255,.07)'; roundRect(ctx, x, y, 270, 230, 28); ctx.fill();
      ctx.strokeStyle = 'rgba(201,151,63,.5)'; ctx.lineWidth = 3; roundRect(ctx, x, y, 270, 230, 28); ctx.stroke();
      ctx.font = '92px Arial'; ctx.fillText(t[0], x + 135, y + 108);
      ctx.fillStyle = CREAM; ctx.font = '800 38px ' + COND; ctx.fillText(t[1], x + 135, y + 182);
    });
    ctx.fillStyle = DIMC; ctx.font = '600 30px ' + COND;
    ctx.fillText('tap the phone (or a tile) to open', 330, 1010);
    ctx.fillText('wrist-flip for quick settings', 330, 1060);
  }
  PHONE.tex.tex.needsUpdate = true;
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function summonPhone() {
  if (!PHONE.el) { openPhoneSheet('home'); return; }
  if (!PHONE.open) {
    PHONE.open = true;
    PHONE.el.setAttribute('visible', 'true');
    drawPhoneFace();
    toast('📱 Phone out! Tap the phone to open it — Buddies, Photos, Fetti, Settings.', 3800);
  } else openPhoneSheet('home');
}
function openPhoneSheet(section) {
  const host = sheetHost('📱 My Phone');
  host.innerHTML = '';
  if (section === 'home') {
    const tiles = [['📞 Buddies', 'Call any Buddy — voice if Voice Chat is on', 'buddies'], ['🖼 Photos', CAPTURES.length + ' capture(s) this session', 'photos'], ['🧍 Import Avatar', 'Bring your QuestBuddi Studio scan in', 'avatar'], ['🪙 Fetti', 'Balance: — (arrives with the marketplace)', 'fetti'], ['⚙ Settings', 'App settings', 'settings']];
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:9px';
    tiles.forEach((t) => {
      const b = document.createElement('button');
      b.className = 'shareOpt phoneTile';
      b.innerHTML = '<b style="font-size:16px">' + t[0] + '</b><span>' + esc(t[1]) + '</span>';
      b.addEventListener('click', () => { if (t[2] === 'settings') { closeSheet(); navTo('settings'); } else if (t[2] === 'avatar') { openAvatarImportSheet(); } else openPhoneSheet(t[2]); });
      grid.appendChild(b);
    });
    host.appendChild(grid);
  } else if (section === 'buddies') {
    PERSONAS.forEach((p) => {
      const idn = identityOf(p.id);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid rgba(255,255,255,.06)';
      row.innerHTML = '<span style="width:14px;height:14px;border-radius:50%;background:' + p.color + ';flex:none"></span><span style="flex:1"><b>' + esc(idn.name) + '</b> <span style="color:var(--dim);font-size:12px">' + esc(idn.homeCity) + (p.tutor ? ' · 🔥 Tutor' : '') + '</span></span>';
      const call = document.createElement('button');
      call.className = 'goBtn'; call.style.cssText = 'flex:none;padding:9px 16px'; call.textContent = '📞 Call';
      call.addEventListener('click', () => startCall(p.id));
      row.appendChild(call); host.appendChild(row);
    });
  } else if (section === 'photos') {
    const note = document.createElement('div');
    note.style.cssText = 'font-size:13px;color:var(--dim);margin-bottom:9px';
    note.textContent = 'Captures from THIS session — they are also saved to your device (Downloads). A web page cannot browse your device gallery, so older captures live in your Files/Photos app.';
    host.appendChild(note);
    if (!CAPTURES.length) { const e = document.createElement('div'); e.style.cssText = 'font-size:14px'; e.textContent = 'No captures yet — tap Shot or Record on the dock and they will appear here.'; host.appendChild(e); }
    CAPTURES.slice().reverse().forEach((cp) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:7px 4px;border-bottom:1px solid rgba(255,255,255,.06)';
      const thumb = cp.kind === 'shot' ? '<img src="' + cp.url + '" style="width:64px;height:40px;object-fit:cover;border-radius:8px">' : '<video src="' + cp.url + '" style="width:64px;height:40px;object-fit:cover;border-radius:8px" muted preload="metadata"></video>';
      row.innerHTML = thumb + '<span style="flex:1;font-size:13px">' + (cp.kind === 'shot' ? '📸 ' : '⏺ ') + esc(cp.name) + '<br><span style="color:var(--dim)">' + new Date(cp.ts).toLocaleTimeString() + '</span></span>';
      const open = document.createElement('button');
      open.className = 'miniBtn'; open.style.cssText = 'flex:none'; open.textContent = 'Open';
      open.addEventListener('click', () => window.open(cp.url, '_blank'));
      row.appendChild(open); host.appendChild(row);
    });
  } else if (section === 'fetti') {
    host.innerHTML = '<div style="text-align:center;padding:16px 6px"><div style="font-size:52px">🪙</div><div style="font-size:15px;font-weight:800;margin-top:6px">fetti balance</div><div style="font-size:44px;font-weight:900;color:var(--amber)">—</div><div style="font-size:13.5px;color:var(--dim);line-height:1.55;margin-top:8px">Fetti arrives with the player marketplace (Roadmap, Avatar Studio phase). There is no balance yet — and we don\'t fake one.</div></div>';
  }
  const back = document.createElement('button');
  back.className = 'miniBtn'; back.style.cssText = 'width:100%;margin-top:10px'; back.textContent = section === 'home' ? 'Close' : '← Phone home';
  back.addEventListener('click', () => { if (section === 'home') closeSheet(); else openPhoneSheet('home'); });
  host.appendChild(back);
  openSheet();
}
async function startCall(pid) {
  PHONE.callPid = pid;
  if (S.activePersonaId !== pid) await selectPersona(pid);
  drawPhoneFace();
  const p = personaById(pid), idn = identityOf(pid);
  const host = sheetHost('📞 On call');
  host.innerHTML = '';
  const face = document.createElement('div');
  face.className = 'callFace'; face.style.background = 'radial-gradient(circle at 38% 32%, ' + softColor(p.color) + ', ' + p.color + ')';
  face.innerHTML = '<span class="eye l"></span><span class="eye r"></span><span class="cheek l"></span><span class="cheek r"></span><span class="mouth"></span>';
  host.appendChild(face); PHONE.faceEl = face;
  const nm = document.createElement('div');
  nm.style.cssText = 'text-align:center;font-weight:900;font-size:18px;margin-top:4px';
  nm.textContent = idn.name;
  host.appendChild(nm);
  const st = document.createElement('div');
  st.style.cssText = 'text-align:center;color:var(--dim);font-size:13px';
  st.textContent = voiceEffective() ? 'Voice live — tap 🎙 and talk, or type below. They answer out loud.' : 'Text call — Voice Chat is off; turn it on (Settings or wrist panel) for live voice.';
  host.appendChild(st);
  const tr = document.createElement('div');
  tr.id = 'callTranscript';
  tr.style.cssText = 'max-height:220px;overflow-y:auto;margin-top:10px;display:flex;flex-direction:column;gap:6px';
  host.appendChild(tr);
  const rowIn = document.createElement('div');
  rowIn.style.cssText = 'display:flex;gap:7px;margin-top:10px';
  rowIn.innerHTML = '<input id="callInput" type="text" placeholder="Say something…" enterkeyhint="send" style="flex:1;background:rgba(255,255,255,.06);border:1px solid var(--glass-line);border-radius:12px;padding:11px 12px;color:var(--cream);font-size:15px;min-width:0"><button class="miniBtn" id="callMic" style="flex:none">🎙</button><button class="goBtn" id="callSend" style="flex:none">Send</button>';
  host.appendChild(rowIn);
  const end = document.createElement('button');
  end.className = 'stopBtn'; end.style.cssText = 'width:100%;margin-top:10px'; end.textContent = '📵 End Call';
  end.addEventListener('click', endCall);
  host.appendChild(end);
  const send = () => { const inp = $('callInput'); const v = inp.value; inp.value = ''; if (v.trim()) { hlResolve('typed'); sendUserMessage(v); } };
  $('callSend').addEventListener('click', send);
  $('callInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  $('callMic').addEventListener('click', micTap);
  openSheet();
  refreshCallTranscript();
  clearInterval(PHONE.callTimer);
  PHONE.callTimer = setInterval(() => { refreshCallTranscript(); drawPhoneFace(); }, 1000);
}
async function refreshCallTranscript() {
  const tr = $('callTranscript'); if (!tr || !PHONE.callPid) return;
  const msgs = await dbGetMessages(PHONE.callPid);
  const last = msgs.slice(-8);
  tr.innerHTML = last.map((m) => '<div class="bubble ' + (m.role === 'user' ? 'me' : 'pilot') + '" style="font-size:13.5px;padding:8px 11px">' + esc(m.text) + '</div>').join('');
  tr.scrollTop = tr.scrollHeight;
}
function endCall() {
  clearInterval(PHONE.callTimer); PHONE.callTimer = null;
  PHONE.callPid = null; PHONE.faceEl = null;
  drawPhoneFace();
  openPhoneSheet('buddies');
}

/* =====================================================================
   IMPORT AVATAR — the Quest half of the phone↔Quest sync bridge.
   The companion phone app, QuestBuddi Studio, uploads the user's
   avatar package to his Google Drive folder "QuestBuddi Studio":
   face/body video clips, an extracted frame set, and profile.json
   carrying "format": "aibuddies-avatar/1" (name, created date,
   quality summary). This section imports that package:

   • FILE import — fully working today. Download the package from
     Drive (Quest Browser or phone), then pick ALL its files here.
   • DRIVE import — the real GIS + Drive list/download code path is
     implemented below, gated by the CONFIG block: it activates the
     moment a Google OAuth WEB client ID for this page's final
     hosted origin exists. Until then the Drive button is disabled
     with an explanation — never a fake connection.

   Storage: IndexedDB store "avatar", single record key "self":
   { id, profile, frames: [Blob], frameNames: [..], videoCount,
     importedAt }. Video clips are counted, not stored on the
   headset (they stay in Drive for the server phase). Imported data
   never leaves this device afterward.
   ===================================================================== */

/* >>>>>>>>>>>>>>>>>>>>> CONFIG — GOOGLE DRIVE IMPORT >>>>>>>>>>>>>>>>>>>>>
   To turn Drive import ON after this page is published:
   1. Google Cloud Console (project drive-bridge-510417) → APIs &
      Services → Credentials → Create credentials → OAuth client ID
      → Application type: **Web application**.
   2. Under "Authorized JavaScript origins", add this page's final
      hosted origin exactly (scheme + host, e.g. https://….vercel.app).
   3. Paste the client ID as GOOGLE_WEB_CLIENT_ID below.
   That is the ONLY change needed — avatarDriveReady() flips true,
   the Drive buttons enable, and importFromDrive() below runs the
   GIS token flow + Drive list/download for real.
   <<<<<<<<<<<<<<<<<<<<< CONFIG — GOOGLE DRIVE IMPORT <<<<<<<<<<<<<<<<<<<<< */
const AVATAR_CFG = {
  GOOGLE_WEB_CLIENT_ID: '', // <<< paste the OAuth 2.0 Web client ID here to enable Drive import
  DRIVE_FOLDER_NAME: 'QuestBuddi Studio',
  FORMAT: 'aibuddies-avatar/1'
};
const AVATAR = { profile: null, urls: [], imgs: [], frameNames: [], videoCount: 0, importedAt: 0,
  idx: 0, lastAdv: 0, dragging: false, holdUntil: 0, turnImg: null,
  holo: null, holoSpin: null, holoTex: null, holoNameTex: null };

function avatarDriveReady() { return !!AVATAR_CFG.GOOGLE_WEB_CLIENT_ID; }
function avatarDriveOffText() { return 'Drive import turns on once this page\'s Google sign-in is registered — for now, download the package from Drive and use File import.'; }
function avatarProfileMs(p) {
  const v = p && (p.createdAt != null ? p.createdAt : (p.created != null ? p.created : p.date));
  if (v == null) return null;
  if (typeof v === 'number' && isFinite(v)) return v;
  const t = Date.parse(String(v)); return isNaN(t) ? null : t;
}
function avatarQualityText(p) {
  const q = p && p.quality;
  if (!q) return 'Quality: not noted in the package.';
  if (typeof q === 'string') return q;
  if (typeof q === 'object') { const s = Object.keys(q).map((k) => k + ': ' + q[k]).join(' · '); return s || 'Quality: not noted in the package.'; }
  return String(q);
}
function avatarDisplayName() { return (AVATAR.profile && AVATAR.profile.name) ? String(AVATAR.profile.name) : 'You'; }

async function loadAvatarFromDb() {
  let rec = null;
  try { rec = await store.get('avatar', 'self'); } catch (e) { rec = null; }
  if (rec && rec.profile && rec.frames && rec.frames.length) loadAvatarRuntime(rec);
  renderAvatarCard(); updateAvatarStatus();
  if (rec) buildAvatarHolo();
}
function loadAvatarRuntime(rec) {
  AVATAR.urls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) {} });
  AVATAR.profile = rec.profile; AVATAR.frameNames = rec.frameNames || [];
  AVATAR.videoCount = rec.videoCount || 0; AVATAR.importedAt = rec.importedAt || nowMs();
  AVATAR.urls = (rec.frames || []).map((b) => URL.createObjectURL(b));
  AVATAR.imgs = AVATAR.urls.map((u) => { const im = new Image(); im.src = u; return im; });
  AVATAR.idx = 0; AVATAR.lastAdv = 0;
}
function updateAvatarStatus() {
  const el = $('avatarStatus'); if (!el) return;
  if (AVATAR.profile) {
    const ms = avatarProfileMs(AVATAR.profile);
    el.innerHTML = 'Avatar on this headset: <b>' + esc(avatarDisplayName()) + '</b> · ' + AVATAR.urls.length + ' frames' +
      (ms ? ' · scanned ' + fmtDate(ms) : '') + ' · imported ' + fmtDate(AVATAR.importedAt) + '. See <b>You</b> on the Crew page and on the stage.';
  } else {
    el.innerHTML = 'No avatar imported yet. Scan yourself with the <b>QuestBuddi Studio</b> phone app, then import the package here — You will stand on the stage with your Buddies as a hologram turntable.';
  }
}

/* ---------------- the Crew-page card: placeholder → turntable ---------------- */
function renderAvatarCard() {
  const host = $('avatarCard'); if (!host) return;
  AVATAR.turnImg = null;
  if (!AVATAR.profile) {
    host.innerHTML =
      '<div class="pCard" style="cursor:default">' +
      '<div class="dot" style="background:linear-gradient(135deg,#37c8e0,#004859)">?</div>' +
      '<div class="nm">🧍 Your Avatar</div><div class="ct">QuestBuddi Studio · not imported yet</div>' +
      '<div class="vb">Scan yourself with the Studio app on your phone, then bring the package in — you\'ll stand on the stage with your Buddies as a hologram.</div>' +
      '<div class="rowBtns"><button class="miniBtn" data-a="imp">Import avatar</button><button class="miniBtn" data-a="drv"' + (avatarDriveReady() ? '' : ' disabled style="opacity:.55"') + '>From Google Drive</button></div>' +
      (avatarDriveReady() ? '' : '<div class="smallNote" style="margin-top:7px">' + avatarDriveOffText() + '</div>') +
      '</div>';
    host.querySelector('[data-a="imp"]').onclick = () => openAvatarImportSheet();
    const db = host.querySelector('[data-a="drv"]'); if (db && avatarDriveReady()) db.onclick = () => importFromDrive();
    return;
  }
  const ms = avatarProfileMs(AVATAR.profile);
  host.innerHTML =
    '<div class="pCard active" style="cursor:default">' +
    '<div class="nm">🧍 ' + esc(avatarDisplayName()) + ' — that\'s YOU</div>' +
    '<div class="ct">QuestBuddi Studio' + (ms ? ' · scanned ' + fmtDate(ms) : '') + '</div>' +
    '<div id="avTurn" style="margin:9px auto 4px;width:172px;height:216px;border-radius:14px;overflow:hidden;border:1px solid rgba(55,200,224,.55);background:radial-gradient(circle at 50% 30%,rgba(55,200,224,.16),rgba(2,16,20,.85));display:flex;align-items:center;justify-content:center;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none">' +
    '<img id="avTurnImg" alt="Your avatar turntable" draggable="false" style="max-width:100%;max-height:100%;pointer-events:none"></div>' +
    '<div class="smallNote" style="text-align:center">↔ drag the picture to spin · it also turns on its own</div>' +
    '<div class="vb">' + esc(avatarQualityText(AVATAR.profile)) + '<br>' + AVATAR.urls.length + ' frames' + (AVATAR.videoCount ? ' · ' + AVATAR.videoCount + ' video clip(s) stay in Drive for the server phase' : '') + ' · imported ' + fmtDate(AVATAR.importedAt) + '</div>' +
    '<div class="smallNote" style="margin-top:5px">Playing <b>as</b> your avatar in first person arrives with the server phase — for now, You stand on stage as a hologram. No fake embodiment.</div>' +
    '<div class="rowBtns"><button class="miniBtn" data-a="rep">Replace…</button><button class="miniBtn danger" data-a="rem">Remove avatar</button></div>' +
    '</div>';
  const img = host.querySelector('#avTurnImg');
  AVATAR.turnImg = img;
  if (AVATAR.urls.length) img.src = AVATAR.urls[AVATAR.idx % AVATAR.urls.length];
  const turn = host.querySelector('#avTurn');
  let dragX = null, dragIdx = 0;
  turn.addEventListener('pointerdown', (e) => { dragX = e.clientX; dragIdx = AVATAR.idx; AVATAR.dragging = true; try { turn.setPointerCapture(e.pointerId); } catch (err) {} });
  turn.addEventListener('pointermove', (e) => {
    if (dragX == null || !AVATAR.urls.length) return;
    const step = Math.round((e.clientX - dragX) / 12);
    AVATAR.idx = ((dragIdx + step) % AVATAR.urls.length + AVATAR.urls.length) % AVATAR.urls.length;
    paintAvatarTurn(); drawAvatarHoloFrame();
  });
  const endDrag = () => { if (dragX != null) { dragX = null; AVATAR.dragging = false; AVATAR.holdUntil = nowMs() + 2500; } };
  turn.addEventListener('pointerup', endDrag); turn.addEventListener('pointercancel', endDrag);
  host.querySelector('[data-a="rep"]').onclick = () => openAvatarImportSheet();
  host.querySelector('[data-a="rem"]').onclick = async () => {
    if (!confirm('Remove your avatar from this headset? The package stays in your Drive / Studio app — you can import it again any time.')) return;
    try { await store.del('avatar', 'self'); } catch (e) {}
    AVATAR.urls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) {} });
    AVATAR.profile = null; AVATAR.urls = []; AVATAR.imgs = []; AVATAR.frameNames = []; AVATAR.videoCount = 0; AVATAR.idx = 0;
    if (AVATAR.holo) AVATAR.holo.setAttribute('visible', 'false');
    renderAvatarCard(); updateAvatarStatus();
    toast('Avatar removed from this headset.');
  };
}
function paintAvatarTurn() {
  const img = AVATAR.turnImg;
  if (img && AVATAR.urls.length) { const u = AVATAR.urls[AVATAR.idx % AVATAR.urls.length]; if (img.getAttribute('src') !== u) img.src = u; }
}

/* ---------------- the import sheet (file + drive) ---------------- */
function openAvatarImportSheet() {
  const host = sheetHost('🧍 Import Avatar — QuestBuddi Studio');
  host.innerHTML =
    '<div style="font-size:13.5px;line-height:1.55;color:var(--ink)">The <b>QuestBuddi Studio</b> app on your phone packs your scan into an <b>avatar package</b>: a <b>profile.json</b>, the <b>frame pictures</b>, and the video clips. Pick <b>all</b> of the package files below (the videos are optional — the frames carry your turntable).</div>' +
    '<input id="avatarFileInput" type="file" multiple accept=".json,application/json,image/*,video/*" style="display:none">' +
    '<button class="goBtn" id="avPick" style="width:100%;margin-top:11px">📁 Choose package files…</button>' +
    '<div id="avFileStatus" style="font-size:13px;margin-top:9px;line-height:1.5"></div>' +
    '<div style="border-top:1px solid rgba(255,255,255,.09);margin:14px 0 11px"></div>' +
    '<button class="miniBtn" id="avDriveBtn" style="width:100%;padding:11px' + (avatarDriveReady() ? '' : ';opacity:.55') + '"' + (avatarDriveReady() ? '' : ' disabled') + '>☁️ Import from Google Drive</button>' +
    '<div style="font-size:12.5px;color:var(--dim);margin-top:7px;line-height:1.5">' + (avatarDriveReady() ? 'Sign in with the same Google account as QuestBuddi Studio — the app reads only the “QuestBuddi Studio” folder.' : avatarDriveOffText()) + '</div>' +
    '<div id="avDriveStatus" style="font-size:13px;margin-top:7px;line-height:1.5"></div>';
  const input = host.querySelector('#avatarFileInput');
  const status = host.querySelector('#avFileStatus');
  host.querySelector('#avPick').addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    if (!input.files || !input.files.length) return;
    status.textContent = 'Reading ' + input.files.length + ' file(s)…';
    const r = await importAvatarFiles(input.files);
    if (r.ok) avatarImportSummary(host, r);
    else status.innerHTML = '<span style="color:#ffb3b3">' + esc(r.msg) + '</span>';
    input.value = '';
  });
  const db = host.querySelector('#avDriveBtn');
  if (db && avatarDriveReady()) db.addEventListener('click', async () => {
    const ds = host.querySelector('#avDriveStatus');
    ds.textContent = 'Opening Google sign-in…';
    const r = await importFromDrive((m) => { ds.textContent = m; });
    if (r && r.ok) avatarImportSummary(host, r);
    else if (r) ds.innerHTML = '<span style="color:#ffb3b3">' + esc(r.msg) + '</span>';
  });
  openSheet();
}
function avatarImportSummary(host, r) {
  host.innerHTML =
    '<div style="text-align:center;padding:8px 4px"><div style="font-size:44px">🧍✨</div>' +
    '<div style="font-size:16px;font-weight:900;margin-top:5px">Avatar imported ✓</div>' +
    '<div style="font-size:13.5px;line-height:1.6;margin-top:7px"><b>' + esc(r.name) + '</b> · ' + r.frames + ' frames' + (r.scannedMs ? ' · scanned ' + fmtDate(r.scannedMs) : '') + '<br>' + esc(r.quality) + (r.videos ? '<br>' + r.videos + ' video clip(s) noted — they stay in Drive for the server phase.' : '') + '</div>' +
    '<div style="font-size:12.5px;color:var(--dim);margin-top:8px">Find <b>You</b> on the Crew page — and standing on the stage as a hologram.</div></div>';
  const b = document.createElement('button');
  b.className = 'goBtn'; b.style.cssText = 'width:100%;margin-top:10px'; b.textContent = 'See You on the Crew page';
  b.addEventListener('click', () => { closeSheet(); navTo('crew'); });
  host.appendChild(b);
  const b2 = document.createElement('button');
  b2.className = 'miniBtn'; b2.style.cssText = 'width:100%;margin-top:7px'; b2.textContent = 'Done';
  b2.addEventListener('click', closeSheet);
  host.appendChild(b2);
}

/* ---------------- core importer: entries = [{name, blob}] ---------------- */
async function importAvatarEntries(entries) {
  const fail = (msg) => ({ ok: false, msg });
  const profEntry = entries.find((e) => e.name.toLowerCase() === 'profile.json');
  if (!profEntry) return fail('That doesn\'t look like an QuestBuddi Studio package — it\'s missing profile.json. In the Studio app use “Send to QuestBuddi”, then pick ALL the exported files (profile.json + the frame pictures).');
  let profile = null;
  try { profile = JSON.parse(await profEntry.blob.text()); } catch (e) { return fail('profile.json is damaged — it isn\'t readable text. Re-export the package from QuestBuddi Studio and try again.'); }
  if (!profile || typeof profile !== 'object') return fail('profile.json doesn\'t describe an avatar. Re-export the package from QuestBuddi Studio and try again.');
  const fmt = String(profile.format || '');
  if (fmt !== AVATAR_CFG.FORMAT) {
    if (fmt.indexOf('aibuddies-avatar/') === 0) return fail('This package was made by a newer QuestBuddi Studio (format “' + fmt + '”). This page understands “' + AVATAR_CFG.FORMAT + '” — update QuestBuddi to import it.');
    return fail('This isn\'t an QuestBuddi Studio avatar package' + (fmt ? ' (its profile says format “' + fmt + '”)' : ' (its profile has no format mark)') + '. Avatar packages say “' + AVATAR_CFG.FORMAT + '”.');
  }
  const isImg = (e) => /^image\//.test(e.blob.type || '') || /\.(png|jpe?g|webp|gif)$/i.test(e.name);
  const isVid = (e) => /^video\//.test(e.blob.type || '') || /\.(mp4|webm|mov)$/i.test(e.name);
  const frameEntries = entries.filter((e) => e !== profEntry && isImg(e))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!frameEntries.length) return fail('The package has no frame pictures — your turntable needs at least one frame image from the Studio export. Re-export and make sure the frame pictures are included.');
  const videoEntries = entries.filter((e) => e !== profEntry && isVid(e));
  const rec = { id: 'self', profile, frames: frameEntries.map((e) => e.blob), frameNames: frameEntries.map((e) => e.name), videoCount: videoEntries.length, importedAt: nowMs() };
  try { await store.put('avatar', rec); }
  catch (e) { return fail('Your avatar read fine but couldn\'t be saved on this device (storage may be full). Free up space and import again.'); }
  loadAvatarRuntime(rec);
  renderAvatarCard(); updateAvatarStatus(); buildAvatarHolo();
  toast('🧍 Avatar imported — ' + avatarDisplayName() + ', ' + frameEntries.length + ' frames. You\'re on the stage!');
  return { ok: true, name: avatarDisplayName(), frames: frameEntries.length, videos: videoEntries.length, scannedMs: avatarProfileMs(profile), quality: avatarQualityText(profile) };
}
async function importAvatarFiles(fileList) {
  const entries = Array.from(fileList || []).map((f) => ({ name: f.name, blob: f }));
  if (!entries.length) return { ok: false, msg: 'No files picked — choose the whole package (profile.json + the frame pictures).' };
  return importAvatarEntries(entries);
}

/* ---------------- Drive import (real path, gated by AVATAR_CFG) ---------------- */
function loadGisClient() {
  return new Promise((resolve, reject) => {
    if (window.google && google.accounts && google.accounts.oauth2) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in — check your connection and try again.'));
    document.head.appendChild(s);
  });
}
async function importFromDrive(onStatus) {
  const say = (m) => { if (onStatus) onStatus(m); };
  if (!avatarDriveReady()) { toast(avatarDriveOffText(), 5200); return { ok: false, msg: avatarDriveOffText() }; }
  try {
    say('Loading Google sign-in…');
    await loadGisClient();
    const token = await new Promise((resolve, reject) => {
      let done = false;
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: AVATAR_CFG.GOOGLE_WEB_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: (r) => { if (done) return; done = true; if (r && r.access_token) resolve(r.access_token); else reject(new Error('Google sign-in was canceled or blocked — allow the pop-up and try again.')); }
      });
      tc.requestAccessToken();
      setTimeout(() => { if (!done) { done = true; reject(new Error('Google sign-in timed out — try again.')); } }, 90000);
    });
    const H = { Authorization: 'Bearer ' + token };
    const listFiles = async (q) => {
      const r = await fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name,mimeType)&pageSize=1000', { headers: H });
      if (!r.ok) throw new Error('Google Drive answered with an error (' + r.status + '). Try again in a moment.');
      const j = await r.json(); return j.files || [];
    };
    say('Looking for the “' + AVATAR_CFG.DRIVE_FOLDER_NAME + '” folder…');
    const folders = await listFiles("name = '" + AVATAR_CFG.DRIVE_FOLDER_NAME + "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    if (!folders.length) return { ok: false, msg: 'No “' + AVATAR_CFG.DRIVE_FOLDER_NAME + '” folder found in that Google account. In QuestBuddi Studio, tap “Send to QuestBuddi” first — and make sure you sign in here with the same account.' };
    say('Reading the avatar package…');
    const children = await listFiles("'" + folders[0].id + "' in parents and trashed = false");
    const downloadable = children.filter((f) => f.mimeType !== 'application/vnd.google-apps.folder');
    if (!downloadable.length) return { ok: false, msg: 'The “' + AVATAR_CFG.DRIVE_FOLDER_NAME + '” folder is empty. Export your avatar from QuestBuddi Studio first.' };
    const entries = [];
    for (const f of downloadable) {
      const r = await fetch('https://www.googleapis.com/drive/v3/files/' + f.id + '?alt=media', { headers: H });
      if (!r.ok) throw new Error('A file in the package wouldn\'t download (' + f.name + '). Try again.');
      entries.push({ name: f.name, blob: await r.blob() });
    }
    say('Importing…');
    return await importAvatarEntries(entries);
  } catch (e) {
    return { ok: false, msg: (e && e.message) ? e.message : 'Drive import hit a snag — try File import instead.' };
  }
}

/* ---------------- in-world hologram turntable ---------------- */
function buildAvatarHolo() {
  if (typeof THREE === 'undefined') return;
  const w = worldEl(); if (!w) return;
  if (AVATAR.holo) {
    AVATAR.holo.setAttribute('visible', AVATAR.profile ? 'true' : 'false');
    drawAvatarHoloName(); drawAvatarHoloFrame();
    return;
  }
  if (!AVATAR.profile) return;
  const e = document.createElement('a-entity');
  e.id = 'avatarHolo';
  e.setAttribute('position', '0 0 -0.62');
  e.innerHTML =
    '<a-cylinder position="0 0.03 0" radius="0.34" height="0.06" material="color:#0a2e3a; metalness:.6; roughness:.35"></a-cylinder>' +
    '<a-ring position="0 0.065 0" rotation="-90 0 0" radius-inner="0.295" radius-outer="0.345" material="color:#37e0c8; emissive:#37e0c8; emissiveIntensity:1.5; side:double; transparent:true; opacity:.9"></a-ring>' +
    '<a-entity class="holoSpin">' +
    '<a-plane class="holoFace" position="0 1.14 0" width="0.92" height="1.30"></a-plane>' +
    '<a-plane class="holoCard" position="0 2.02 0" width="1.04" height="0.32"></a-plane>' +
    '</a-entity>';
  w.appendChild(e); AVATAR.holo = e;
  const setup = () => {
    AVATAR.holoSpin = e.querySelector('.holoSpin');
    AVATAR.holoTex = makeTex(512, 720); bindTex(e.querySelector('.holoFace'), AVATAR.holoTex);
    AVATAR.holoNameTex = makeTex(640, 196); bindTex(e.querySelector('.holoCard'), AVATAR.holoNameTex);
    drawAvatarHoloName(); drawAvatarHoloFrame();
  };
  if (e.hasLoaded) setup(); else e.addEventListener('loaded', setup);
}
function drawAvatarHoloName() {
  if (!AVATAR.holoNameTex) return;
  const { ctx, c } = AVATAR.holoNameTex;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = 'rgba(4,26,33,.88)'; roundRect(ctx, 6, 6, c.width - 12, c.height - 12, 26); ctx.fill();
  ctx.strokeStyle = '#37e0c8'; ctx.lineWidth = 4; roundRect(ctx, 6, 6, c.width - 12, c.height - 12, 26); ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#bff3ff'; ctx.font = '900 62px ' + COND;
  ctx.fillText(avatarDisplayName().toUpperCase().slice(0, 22), c.width / 2, 84);
  ctx.fillStyle = AMBER; ctx.font = '800 44px ' + COND;
  ctx.fillText('★ YOU ★', c.width / 2, 152);
  AVATAR.holoNameTex.tex.needsUpdate = true;
}
function drawAvatarHoloFrame() {
  if (!AVATAR.holoTex || !AVATAR.imgs.length) return;
  const img = AVATAR.imgs[AVATAR.idx % AVATAR.imgs.length];
  if (!img || !img.complete || !img.naturalWidth) return;
  const { ctx, c } = AVATAR.holoTex;
  ctx.clearRect(0, 0, c.width, c.height);
  const s = Math.max(c.width / img.naturalWidth, c.height / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  ctx.drawImage(img, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
  // hologram wash: teal tint, scanlines, base fade — clearly a hologram, not a person
  ctx.fillStyle = 'rgba(55,200,224,.10)'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = 'rgba(0,20,26,.16)';
  for (let y = 0; y < c.height; y += 6) ctx.fillRect(0, y, c.width, 2);
  const g = ctx.createLinearGradient(0, c.height * 0.72, 0, c.height);
  g.addColorStop(0, 'rgba(4,22,28,0)'); g.addColorStop(1, 'rgba(4,22,28,.55)');
  ctx.fillStyle = g; ctx.fillRect(0, c.height * 0.72, c.width, c.height * 0.28);
  ctx.strokeStyle = 'rgba(55,224,200,.85)'; ctx.lineWidth = 5; ctx.strokeRect(3, 3, c.width - 6, c.height - 6);
  AVATAR.holoTex.tex.needsUpdate = true;
}
function avatarTick(dt, now) {
  if (!AVATAR.profile || !AVATAR.imgs.length) return;
  if (AVATAR.holoSpin && AVATAR.holoSpin.object3D) AVATAR.holoSpin.object3D.rotation.y += dt * 0.35;
  if (AVATAR.dragging || now < AVATAR.holdUntil) return;
  if (now - AVATAR.lastAdv < 150) return;
  AVATAR.lastAdv = now;
  AVATAR.idx = (AVATAR.idx + 1) % AVATAR.imgs.length;
  drawAvatarHoloFrame(); paintAvatarTurn();
}
