import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
import { createMascot } from './mascot.js';

// Tudo do Intensivão mora no schema "enem" (o projeto é compartilhado com outro app)
const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { db: { schema: 'enem' } });
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const mascot = createMascot($('#mascot'));

const L = 'ABCDE';
const N = 10;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const fmtTime = s => `${Math.floor(s / 60)}:${pad(s % 60)}`;
const pdf = q => `https://download.inep.gov.br/enem/provas_e_gabaritos/${q.year}_PV_impresso_D1_CD1.pdf#page=${q.page}`;
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = a => a[Math.floor(Math.random() * a.length)];

// Preferências locais (tema visual, prova em andamento). Dados de progresso ficam no Supabase.
const store = {
  get(k, d) { try { const v = localStorage.getItem('ie:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ie:' + k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
  del(k) { try { localStorage.removeItem('ie:' + k); } catch { /* sem armazenamento */ } },
};

// Mesma fórmula da função level_for() do banco
const levelFor = xp => Math.floor(Math.sqrt(Math.max(xp, 0) / 50)) + 1;
const xpFor = lvl => 50 * (lvl - 1) ** 2;
const TITLES = ['Calouro', 'Leitor atento', 'Intérprete', 'Analista de texto', 'Crítico', 'Linguista', 'Mestre das Linguagens', 'Lenda do ENEM'];
const titleFor = lvl => TITLES[Math.min(TITLES.length - 1, Math.floor((lvl - 1) / 2))];

const PHRASES = [
  'Seu cérebro foi convocado.', 'Leia a pergunta antes do texto.', 'O enunciado sempre dá a pista.',
  'Elimine as alternativas que exageram ou generalizam.', 'Estratégia é o que o texto faz, não o que ele diz.',
  'Variação linguística: adequação, não "certo ou errado".', 'Função emotiva mora na primeira pessoa.',
  'Respira. É só interpretação de texto.',
];

const SKINS = [
  { id: 'noite', name: 'Noite', need: () => true, hint: '' },
  { id: 'papel', name: 'Papel', need: () => levelFor(S.profile?.xp || 0) >= 3, hint: 'Libera no nível 3' },
  { id: 'fliperama', name: 'Fliperama', need: () => S.unlocked.has('curioso'), hint: 'Segredo escondido no site' },
];

const S = {
  user: null, profile: null, questions: [], byId: new Map(), themes: [],
  seen: new Set(), unlocked: new Set(), exam: null, result: null, room: null, coop: null, tick: null,
};

/* ---------- utilidades de interface ---------- */

function toast(html, ms = 4500) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = html;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['var(--accent)', 'var(--violet)', 'var(--good)', 'var(--fg)'];
  for (let i = 0; i < 60; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = pick(colors);
    c.style.animationDelay = Math.random() * 0.6 + 's';
    document.body.append(c);
    setTimeout(() => c.remove(), 2600);
  }
}

function applySkin() {
  const id = store.get('skin', 'noite');
  const ok = SKINS.find(s => s.id === id && (!S.profile || s.need()));
  if (ok && id !== 'noite') document.documentElement.dataset.skin = id;
  else delete document.documentElement.dataset.skin;
}

function renderWho() {
  const p = S.profile;
  $('#who').innerHTML = p ? `${esc(p.username)} · Nv <b>${levelFor(p.xp)}</b>` : '';
}

function errMsg(e) { return e?.message || 'Algo deu errado. Tente de novo.'; }

/* ---------- dados ---------- */

async function loadProfile() {
  const { data, error } = await sb.rpc('ensure_profile', { p_username: S.user.user_metadata?.username || null });
  if (error) throw error;
  S.profile = data;
  renderWho();
}

async function loadQuestions() {
  if (S.questions.length) return;
  const { data, error } = await sb.from('questions').select('id,year,number,page,theme,stem,options');
  if (error) throw error;
  S.questions = data;
  S.byId = new Map(data.map(q => [q.id, q]));
  S.themes = [...new Set(data.map(q => q.theme))].sort();
}

async function loadMine() {
  const [h, a] = await Promise.all([
    sb.from('answer_history').select('question_id').limit(5000),
    sb.from('user_achievements').select('code'),
  ]);
  S.seen = new Set((h.data || []).map(r => r.question_id));
  S.unlocked = new Set((a.data || []).map(r => r.code));
}

/* ---------- rotas ---------- */

const VIEWS = { painel: viewPainel, prova: viewProva, resultado: viewResultado, salas: viewSalas, sala: viewSala,
  stats: viewStats, conquistas: viewConquistas, ranking: viewRanking, perfil: viewPerfil };

function go(v) { if (location.hash === '#' + v) route(); else location.hash = v; }

function route() {
  clearInterval(S.tick);
  if (!S.user) { $('#nav').hidden = true; return viewAuth(); }
  $('#nav').hidden = false;
  let v = location.hash.slice(1) || 'painel';
  if (!VIEWS[v]) v = 'painel';
  if (v === 'prova' && !S.exam) v = 'painel';
  if (v === 'resultado' && !S.result) v = 'painel';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + v));
  document.body.classList.toggle('focus', v === 'prova' && store.get('focus', true));
  VIEWS[v]().catch(e => { app.innerHTML = `<div class="panel"><p class="error">${esc(errMsg(e))}</p></div>`; });
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', route);

/* ---------- login ---------- */

function viewAuth() {
  let mode = 'entrar';
  const draw = () => {
    app.innerHTML = `
      <h1>Bora pro ENEM.</h1>
      <p class="muted">Questões reais de Linguagens, XP, conquistas, desafios e modo coop com os amigos.</p>
      <form class="panel" id="auth">
        <div class="row">
          <button type="button" class="${mode === 'entrar' ? '' : 'quiet'}" data-mode="entrar">Entrar</button>
          <button type="button" class="${mode === 'criar' ? '' : 'quiet'}" data-mode="criar">Criar conta</button>
        </div>
        ${mode === 'criar' ? `<label class="field"><span>Apelido (3 a 24 letras, números ou _)</span>
          <input type="text" id="username" required pattern="[A-Za-z0-9_]{3,24}" autocomplete="nickname"></label>` : ''}
        <label class="field"><span>E-mail</span><input type="email" id="email" required autocomplete="email"></label>
        <label class="field"><span>Senha (mínimo 6 caracteres)</span><input type="password" id="password" required minlength="6"
          autocomplete="${mode === 'criar' ? 'new-password' : 'current-password'}"></label>
        <p class="error" id="autherr" hidden></p>
        <div class="row"><button type="submit">${mode === 'criar' ? 'Criar conta' : 'Entrar'}</button></div>
      </form>`;
    app.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; draw(); });
    $('#auth').onsubmit = async e => {
      e.preventDefault();
      const err = $('#autherr'); err.hidden = true;
      const email = $('#email').value.trim(), password = $('#password').value;
      const btn = e.submitter; btn.disabled = true;
      try {
        if (mode === 'criar') {
          const { data, error } = await sb.auth.signUp({ email, password, options: {
            data: { username: $('#username').value.trim() }, emailRedirectTo: location.origin + location.pathname } });
          if (error) throw error;
          if (!data.session) { err.textContent = 'Conta criada. Abra o link que mandamos para o seu e-mail e depois entre aqui.'; err.hidden = false; }
        } else {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message);
        }
      } catch (ex) { err.textContent = errMsg(ex); err.hidden = false; }
      btn.disabled = false;
    };
  };
  draw();
  mascot.mood('idle', 'Oi! Entra aí que eu te ajudo a estudar.');
}

/* ---------- painel ---------- */

function themeChips(id) {
  const off = store.get('off', []);
  return `<div class="chips" id="${id}">${S.themes.map((t, i) =>
    `<label class="chip"><input type="checkbox" id="${id}${i}" value="${esc(t)}" ${off.includes(t) ? '' : 'checked'}>${esc(t)}
      <small>${S.questions.filter(q => q.theme === t).length}</small></label>`).join('')}</div>`;
}
function chosenThemes(id) {
  const box = $('#' + id);
  const on = [...box.querySelectorAll('input:checked')].map(x => x.value);
  store.set('off', S.themes.filter(t => !on.includes(t)));
  return on;
}

function sample(themes, n = N) {
  const cand = S.questions.filter(q => themes.includes(q.theme));
  const fresh = shuffle(cand.filter(q => !S.seen.has(q.id))), old = shuffle(cand.filter(q => S.seen.has(q.id)));
  const out = [], per = {}, cap = Math.ceil(n / Math.max(themes.length, 1)) + 1;
  for (const q of [...fresh, ...old]) { if (out.length >= n) break; if ((per[q.theme] || 0) < cap) { out.push(q.id); per[q.theme] = (per[q.theme] || 0) + 1; } }
  for (const q of [...fresh, ...old]) { if (out.length >= n) break; if (!out.includes(q.id)) out.push(q.id); }
  return shuffle(out);
}

async function viewPainel() {
  const p = S.profile, lvl = levelFor(p.xp), from = xpFor(lvl), to = xpFor(lvl + 1);
  const [{ data: missions }, { data: last }] = await Promise.all([
    sb.rpc('my_missions'),
    sb.from('exam_attempts').select('question_ids,score,total,created_at').order('created_at', { ascending: false }).limit(1),
  ]);
  const saved = store.get('exam', null);
  app.innerHTML = `
    <section class="panel hero">
      <div class="lvl">${lvl}<small>NÍVEL</small></div>
      <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
        <h2>${esc(titleFor(lvl))}</h2>
        <div class="xpbar" title="${p.xp - from} de ${to - from} XP"><i style="width:${Math.min(100, (p.xp - from) / (to - from) * 100)}%"></i></div>
        <div class="kpis"><span><b>${p.xp - from}</b>/ ${to - from} XP</span><span><b>${p.streak}</b>dias seguidos</span><span><b>${S.seen.size}</b>questões vistas</span></div>
      </div>
    </section>
    ${saved ? `<section class="panel"><p>Você tem uma prova em andamento.</p>
      <div class="row"><button id="resume">Continuar prova</button><button class="ghost" id="discard">Descartar</button></div></section>` : ''}
    <section class="panel">
      <div class="row"><span class="label">Nova prova</span><span class="spacer"></span><span class="small muted">${esc(pick(PHRASES))}</span></div>
      ${themeChips('th')}
      <div class="row">
        <button id="new">Gerar prova de ${N} questões</button>
        ${last?.length ? `<button class="ghost" id="revenge">Revanche da última (${last[0].score}/${last[0].total})</button>` : ''}
      </div>
    </section>
    <section class="panel">
      <span class="label">Missões de hoje</span>
      ${(missions || []).map(m => `<div class="mission ${m.claimed ? 'done' : ''}">
        <span>${esc(m.name)} <span class="muted small">${m.progress}/${m.goal}${m.code === 'prova80' ? '%' : ''}</span></span>
        <span class="xp">${m.claimed ? 'FEITO' : '+' + m.xp + ' XP'}</span>
        <div class="bar"><i style="width:${Math.min(100, m.progress / m.goal * 100)}%"></i></div></div>`).join('')}
    </section>
    <section class="grid2">
      <a class="panel btn quiet" href="#salas" style="text-align:left;align-items:flex-start"><h3>Desafio</h3><span class="small muted">Mesma prova para todos, ganha quem acertar mais.</span></a>
      <a class="panel btn quiet" href="#salas" style="text-align:left;align-items:flex-start"><h3>Coop</h3><span class="small muted">Respondam juntos, em tempo real.</span></a>
    </section>`;
  $('#new').onclick = () => {
    const t = chosenThemes('th');
    if (!t.length) return toast('Escolha pelo menos um tema.');
    startExam({ ids: sample(t), mode: 'solo' });
  };
  if ($('#revenge')) $('#revenge').onclick = () => startExam({ ids: last[0].question_ids, mode: 'solo' });
  if ($('#resume')) $('#resume').onclick = () => { S.exam = saved; go('prova'); };
  if ($('#discard')) $('#discard').onclick = () => { store.del('exam'); route(); };
  mascot.mood('idle', false);
}

/* ---------- prova (solo, desafio e coop) ---------- */

function startExam({ ids, mode, roomCode = null, startedAt = Date.now(), answers, flipped, by }) {
  const known = ids.filter(id => S.byId.has(id));
  if (!known.length) return toast('Nenhuma questão encontrada para esses temas.');
  S.exam = { ids: known, mode, roomCode, startedAt, cur: 0,
    answers: answers || known.map(() => null), flipped: flipped || known.map(() => false), by: by || known.map(() => null) };
  saveExam();
  mascot.mood('thinking', pick(PHRASES));
  go('prova');
}
function saveExam() { if (S.exam && S.exam.mode === 'solo') store.set('exam', S.exam); }

function setAnswer(i, v, who) {
  const e = S.exam;
  if (e.answers[i] !== null && e.answers[i] !== v) e.flipped[i] = true;
  e.answers[i] = v;
  e.by[i] = who || null;
  saveExam();
}

async function viewProva() {
  const e = S.exam, q = S.byId.get(e.ids[e.cur]), coop = e.mode === 'coop';
  app.innerHTML = `
    <div class="examhead">
      <span class="label">${coop ? 'Coop · sala ' + esc(e.roomCode) : e.mode === 'desafio' ? 'Desafio · sala ' + esc(e.roomCode) : 'Prova'}</span>
      <span class="spacer"></span>
      <span class="timer" id="timer">0:00</span>
      <button class="quiet" id="focus" type="button">${store.get('focus', true) ? 'Sair do foco' : 'Modo foco'}</button>
      ${coop ? '' : '<button class="ghost" id="quit" type="button">Sair</button>'}
    </div>
    ${coop ? `<div class="members" id="members"></div>` : ''}
    <div class="qmap" id="qmap">${e.ids.map((_, i) => `<button type="button" data-i="${i}" class="${e.answers[i] !== null ? 'ans' : ''} ${i === e.cur ? 'cur' : ''}" aria-label="Questão ${i + 1}">${i + 1}</button>`).join('')}</div>
    <section class="panel">
      <div class="qtop"><span class="tag">${esc(q.theme)}</span><span class="src">ENEM ${q.year} · Questão ${pad(q.number)} · ${e.cur + 1} de ${e.ids.length}</span></div>
      <a class="btn ghost" href="${pdf(q)}" target="_blank" rel="noopener" style="align-self:flex-start">Ver texto e imagens na prova oficial (pág. ${q.page}) ↗</a>
      <p class="stem">${q.stem ? esc(q.stem) : 'Leia o enunciado completo na prova oficial.'}</p>
      <div id="opts" style="display:flex;flex-direction:column;gap:8px">
        ${(q.options || L.split('').map(l => `Alternativa ${l} (veja na prova)`)).map((o, j) => `
          <label class="opt"><input type="radio" name="opt" value="${j}" ${e.answers[e.cur] === j ? 'checked' : ''}>
          <b>${L[j]}</b><span>${esc(o)}</span>${coop && e.answers[e.cur] === j && e.by[e.cur] ? `<span class="by">${esc(e.by[e.cur])}</span>` : ''}</label>`).join('')}
      </div>
      <p class="tip">Se o texto-base começar antes, volte uma página no PDF.</p>
    </section>
    <div class="row">
      <button class="ghost" id="prev" ${e.cur === 0 ? 'disabled' : ''}>Anterior</button>
      <span class="spacer"></span>
      <button id="next">${e.cur === e.ids.length - 1 ? 'Entregar prova' : 'Próxima'}</button>
    </div>
    <section class="panel" id="confirm" hidden>
      <p id="confirmMsg"></p>
      <div class="row"><button id="yes">Entregar mesmo assim</button><button class="ghost" id="no">Voltar</button></div>
    </section>
    ${coop ? `<section class="panel"><span class="label">Chat da equipe</span><div class="chat" id="chat"></div>
      <form class="row" id="chatform"><input type="text" id="chatmsg" maxlength="140" placeholder="Acho que é a C..." style="flex:1"><button class="quiet">Enviar</button></form></section>` : ''}`;

  const tick = () => { const t = $('#timer'); if (t) t.textContent = fmtTime(Math.floor((Date.now() - e.startedAt) / 1000)); };
  tick(); S.tick = setInterval(tick, 1000);

  const goto = (i, broadcast = true) => { e.cur = i; saveExam(); if (coop && broadcast) coopSend({ t: 'goto', i }); viewProva(); };
  $('#qmap').onclick = ev => { const b = ev.target.closest('button'); if (b) goto(+b.dataset.i); };
  $('#prev').onclick = () => goto(e.cur - 1);
  $('#opts').onchange = ev => {
    const v = +ev.target.value;
    setAnswer(e.cur, v, coop ? S.profile.username : null);
    if (coop) coopSend({ t: 'pick', i: e.cur, v, who: S.profile.username });
    $('#qmap').children[e.cur].classList.add('ans');
    if (Math.random() < 0.3) mascot.mood('thinking');
    if (coop) viewProva();
  };
  $('#next').onclick = () => {
    if (e.cur < e.ids.length - 1) return goto(e.cur + 1);
    const blank = e.answers.filter(a => a === null).length;
    if (blank) {
      $('#confirmMsg').textContent = `Faltam ${blank} ${blank > 1 ? 'questões' : 'questão'} sem resposta. Elas contam como erro.`;
      $('#confirm').hidden = false; $('#confirm').scrollIntoView({ block: 'center' });
      mascot.mood('panic');
      return;
    }
    finishExam();
  };
  $('#yes').onclick = finishExam;
  $('#no').onclick = () => { $('#confirm').hidden = true; mascot.mood('thinking', false); };
  $('#focus').onclick = () => { store.set('focus', !store.get('focus', true)); route(); };
  if ($('#quit')) $('#quit').onclick = () => { saveExam(); go('painel'); };
  if (coop) {
    renderMembers(); renderChat();
    $('#chatform').onsubmit = ev => { ev.preventDefault(); const m = $('#chatmsg').value.trim(); if (!m) return;
      coopSend({ t: 'chat', who: S.profile.username, m }); pushChat(S.profile.username, m); $('#chatmsg').value = ''; };
  }
}

function finishExam() {
  if (S.exam.mode === 'coop') coopSend({ t: 'finish', answers: S.exam.answers, flipped: S.exam.flipped });
  submitExam();
}

async function submitExam() {
  const e = S.exam;
  if (e.sending) return;
  e.sending = true;
  app.innerHTML = '<p class="loading">Corrigindo no servidor...</p>';
  const levelBefore = levelFor(S.profile.xp);
  const { data, error } = await sb.rpc('submit_attempt', {
    p_question_ids: e.ids, p_answers: e.answers, p_flipped: e.flipped,
    p_duration_s: Math.floor((Date.now() - e.startedAt) / 1000), p_room_code: e.roomCode,
  });
  e.sending = false;
  if (error) {
    app.innerHTML = `<section class="panel"><p class="error">${esc(errMsg(error))}</p><div class="row"><button id="back">Voltar para a prova</button></div></section>`;
    $('#back').onclick = () => go('prova');
    return;
  }
  store.del('exam');
  e.ids.forEach(id => S.seen.add(id));
  (data.achievements || []).forEach(a => S.unlocked.add(a.code));
  S.profile.xp = data.xp; S.profile.streak = data.streak;
  renderWho();
  S.result = { exam: e, res: data, levelUp: data.level > levelBefore ? data.level : 0 };
  S.exam = null;
  if (S.coop && e.mode === 'coop') coopLeave();
  go('resultado');
}

function viewResultado() {
  const { exam: e, res, levelUp } = S.result;
  const ratio = res.score / res.total;
  app.innerHTML = `
    <section class="panel">
      <span class="label">${e.mode === 'coop' ? 'Resultado da equipe' : 'Resultado'}</span>
      <div class="score" id="score">0/${res.total}</div>
      <div class="reward">
        <span>+${res.xp_gained} XP</span>
        ${levelUp ? `<span>Nível ${levelUp}!</span>` : ''}
        ${(res.missions || []).map(m => `<span>Missão: ${esc(m.name)} (+${m.xp})</span>`).join('')}
        ${(res.achievements || []).map(a => `<span>Conquista: ${esc(a.name)} (+${a.xp})</span>`).join('')}
      </div>
      ${res.xp_gained === 0 ? '<p class="small muted">Prova entregue rápido demais não rende XP.</p>' : ''}
      <div class="row">
        <button id="revenge">Revanche (mesmas questões)</button>
        <button class="ghost" id="again">Nova prova</button>
        ${e.roomCode ? '<button class="ghost" id="room">Ver placar da sala</button>' : ''}
      </div>
    </section>
    <h2>Gabarito</h2>
    ${e.ids.map((id, i) => {
      const q = S.byId.get(id), a = e.answers[i], k = res.keys[i], ok = a === k;
      return `<div class="item ${ok ? 'ok' : 'no'}">
        <div class="qtop"><span><b>${i + 1}.</b> <span class="pill ${ok ? 'ok' : 'no'}">${ok ? 'Acertou' : 'Errou'}</span></span>
        <span class="src">ENEM ${q.year} · Questão ${pad(q.number)} · ${esc(q.theme)}</span></div>
        ${q.stem ? `<p class="small muted">${esc(q.stem)}</p>` : ''}
        <p>Gabarito: <b>${L[k]}</b>${q.options ? ' · ' + esc(q.options[k]) : ''}</p>
        ${ok ? '' : `<p>Sua resposta: <b>${a === null ? 'em branco' : L[a]}</b>${a !== null && q.options ? ' · ' + esc(q.options[a]) : ''}</p>`}
        <a class="small" href="${pdf(q)}" target="_blank" rel="noopener">Rever na prova (pág. ${q.page}) ↗</a></div>`;
    }).join('')}`;

  let n = 0;
  const step = () => { $('#score') && ($('#score').textContent = `${n}/${res.total}`); if (n++ < res.score) setTimeout(step, 90); };
  step();
  mascot.mood(ratio >= 0.8 ? 'happy' : ratio >= 0.5 ? 'thinking' : 'sad');
  if (ratio === 1 || levelUp || res.achievements?.length) confetti();
  if (levelUp) toast(`<strong>Subiu para o nível ${levelUp}!</strong> Agora você é ${esc(titleFor(levelUp))}.`);
  if (levelUp >= 3 && levelUp - 1 < 3) toast('<strong>Tema Papel liberado.</strong> Troque no Perfil.');
  (res.achievements || []).forEach(a => toast(`<strong>Conquista:</strong> ${esc(a.name)} (+${a.xp} XP)`));
  $('#revenge').onclick = () => startExam({ ids: e.ids, mode: 'solo' });
  $('#again').onclick = () => go('painel');
  if ($('#room')) $('#room').onclick = () => openRoom(e.roomCode);
  return Promise.resolve();
}

/* ---------- salas: desafio e coop ---------- */

async function viewSalas() {
  app.innerHTML = `
    <h1>Salas</h1>
    <section class="panel">
      <span class="label">Criar sala</span>
      <p class="small muted"><b>Desafio:</b> cada um faz a mesma prova sozinho e vocês comparam a nota.
        <b>Coop:</b> a equipe responde junta, em tempo real, com chat. Todos ganham XP.</p>
      ${themeChips('rth')}
      <div class="row"><button id="mkd">Criar desafio</button><button id="mkc">Criar sala coop</button></div>
    </section>
    <form class="panel" id="join">
      <span class="label">Entrar com código</span>
      <div class="row"><input type="text" id="code" maxlength="6" placeholder="Ex.: 3F9A1C" style="flex:1;text-transform:uppercase" required><button>Entrar</button></div>
    </form>`;
  const make = async mode => {
    const t = chosenThemes('rth');
    if (!t.length) return toast('Escolha pelo menos um tema.');
    const { data, error } = await sb.rpc('create_room', { p_themes: t, p_n: N, p_mode: mode });
    if (error) return toast(esc(errMsg(error)));
    openRoom(data.code);
  };
  $('#mkd').onclick = () => make('desafio');
  $('#mkc').onclick = () => make('coop');
  $('#join').onsubmit = ev => { ev.preventDefault(); openRoom($('#code').value.trim().toUpperCase()); };
}

async function openRoom(code) {
  const { data, error } = await sb.rpc('get_room', { p_code: code });
  if (error || !data) return toast('Sala não encontrada. Confira o código.');
  S.room = data;
  store.set('room', data.code);
  go('sala');
}

async function viewSala() {
  if (!S.room) { const c = store.get('room', null); if (!c) return go('salas'); return openRoom(c); }
  const r = S.room;
  const copy = `<button class="quiet" id="copy" type="button">Copiar código</button>`;
  if (r.mode === 'desafio') {
    const { data: board } = await sb.rpc('room_scoreboard', { p_code: r.code });
    const done = (board || []).some(b => b.is_me);
    app.innerHTML = `
      <section class="panel">
        <span class="label">Desafio de ${esc(r.owner)} · ${r.question_ids.length} questões</span>
        <div class="row"><span class="code">${esc(r.code)}</span>${copy}</div>
        <p class="small muted">Mande o código para os amigos. Cada um faz uma vez; empate é decidido pelo tempo.</p>
        <div class="row">${done ? '<span class="muted">Você já fez este desafio.</span>' : '<button id="play">Fazer a prova do desafio</button>'}
          <button class="ghost" id="refresh">Atualizar placar</button></div>
      </section>
      <section class="panel"><span class="label">Placar</span>
        <div class="list">${(board || []).map((b, i) => `<div class="${b.is_me ? 'me' : ''}"><span class="pos">${i + 1}</span>
          <span>${esc(b.username)}</span><span>${b.score}/${b.total} · ${fmtTime(b.duration_s)}</span></div>`).join('') || '<p class="muted">Ninguém terminou ainda.</p>'}</div>
      </section>`;
    if ($('#play')) $('#play').onclick = () => startExam({ ids: r.question_ids, mode: 'desafio', roomCode: r.code });
    $('#refresh').onclick = () => viewSala();
  } else {
    if (r.done) {
      app.innerHTML = `<section class="panel"><span class="label">Sala coop ${esc(r.code)}</span><p>Sua equipe já entregou esta prova.</p>
        <div class="row"><a class="btn" href="#salas">Criar outra sala</a></div></section>`;
      return;
    }
    coopJoin(r);
    app.innerHTML = `
      <section class="panel">
        <span class="label">Sala coop de ${esc(r.owner)} · ${r.question_ids.length} questões</span>
        <div class="row"><span class="code">${esc(r.code)}</span>${copy}</div>
        <p class="small muted">Quando todo mundo entrar, alguém clica em Começar. As respostas aparecem para todos na hora,
          e quem entregar entrega pela equipe.</p>
        <span class="label">Na sala agora</span>
        <div class="members" id="members"></div>
        <div class="row"><button id="startcoop">Começar</button><button class="ghost" id="leave">Sair da sala</button></div>
      </section>
      <section class="panel"><span class="label">Chat</span><div class="chat" id="chat"></div>
        <form class="row" id="chatform"><input type="text" id="chatmsg" maxlength="140" placeholder="Bora?" style="flex:1"><button class="quiet">Enviar</button></form></section>`;
    renderMembers(); renderChat();
    $('#startcoop').onclick = () => {
      const startedAt = Date.now();
      coopSend({ t: 'start', startedAt });
      startExam({ ids: r.question_ids, mode: 'coop', roomCode: r.code, startedAt });
    };
    $('#leave').onclick = () => { coopLeave(); store.del('room'); S.room = null; go('salas'); };
    $('#chatform').onsubmit = ev => { ev.preventDefault(); const m = $('#chatmsg').value.trim(); if (!m) return;
      coopSend({ t: 'chat', who: S.profile.username, m }); pushChat(S.profile.username, m); $('#chatmsg').value = ''; };
  }
  $('#copy').onclick = async () => {
    try { await navigator.clipboard.writeText(r.code); toast('Código copiado.'); } catch { toast(`Código: <strong>${esc(r.code)}</strong>`); }
  };
}

/* ---------- coop em tempo real (Supabase Realtime: broadcast + presence) ---------- */

function coopJoin(room) {
  if (S.coop?.code === room.code) return;
  coopLeave();
  const ch = sb.channel('coop-' + room.code, { config: { broadcast: { self: false }, presence: { key: S.user.id } } });
  S.coop = { code: room.code, room, ch, members: [], chat: [] };
  ch.on('presence', { event: 'sync' }, () => {
    S.coop.members = Object.values(ch.presenceState()).map(p => p[0]?.name).filter(Boolean);
    renderMembers();
  });
  ch.on('broadcast', { event: 'msg' }, ({ payload: m }) => onCoop(m));
  ch.subscribe(async status => {
    if (status !== 'SUBSCRIBED') return;
    await ch.track({ name: S.profile.username });
    coopSend({ t: 'hello' });
  });
}

function coopLeave() {
  if (S.coop) { sb.removeChannel(S.coop.ch); S.coop = null; }
}

function coopSend(payload) { S.coop?.ch.send({ type: 'broadcast', event: 'msg', payload }); }

function onCoop(m) {
  const e = S.exam, inRoom = e && e.mode === 'coop' && e.roomCode === S.coop.code;
  const onProva = location.hash === '#prova';
  switch (m.t) {
    case 'hello': // alguém chegou: quem já está na prova manda o estado atual
      if (inRoom) coopSend({ t: 'state', startedAt: e.startedAt, answers: e.answers, flipped: e.flipped, by: e.by, cur: e.cur });
      break;
    case 'state':
      if (!inRoom) { startExam({ ids: S.coop.room.question_ids, mode: 'coop', roomCode: S.coop.code, startedAt: m.startedAt, answers: m.answers, flipped: m.flipped, by: m.by }); S.exam.cur = m.cur || 0; }
      break;
    case 'start':
      if (!inRoom) startExam({ ids: S.coop.room.question_ids, mode: 'coop', roomCode: S.coop.code, startedAt: m.startedAt });
      break;
    case 'pick':
      if (inRoom) { setAnswer(m.i, m.v, m.who); if (onProva) viewProva(); }
      break;
    case 'goto':
      if (inRoom) { e.cur = m.i; if (onProva) viewProva(); }
      break;
    case 'finish':
      if (inRoom && !e.sending) { e.answers = m.answers; e.flipped = m.flipped; toast('A equipe entregou a prova.'); submitExam(); }
      break;
    case 'chat':
      pushChat(m.who, m.m);
      break;
  }
}

function renderMembers() {
  const box = $('#members');
  if (box && S.coop) box.innerHTML = S.coop.members.map(n => `<span>${esc(n)}</span>`).join('') || '<span>Só você por enquanto</span>';
}
function pushChat(who, m) {
  if (!S.coop) return;
  S.coop.chat.push({ who, m: String(m).slice(0, 140) });
  S.coop.chat = S.coop.chat.slice(-50);
  renderChat();
}
function renderChat() {
  const box = $('#chat');
  if (!box || !S.coop) return;
  box.innerHTML = S.coop.chat.map(c => `<div><b>${esc(c.who)}:</b> ${esc(c.m)}</div>`).join('') || '<span class="muted">Sem mensagens.</span>';
  box.scrollTop = box.scrollHeight;
}

/* ---------- estatísticas ---------- */

async function viewStats() {
  const [{ data: hist }, { data: att }] = await Promise.all([
    sb.from('answer_history').select('theme,correct').limit(5000),
    sb.from('exam_attempts').select('score,total,created_at').order('created_at', { ascending: false }).limit(15),
  ]);
  const by = {};
  (hist || []).forEach(h => { by[h.theme] = by[h.theme] || [0, 0]; by[h.theme][1]++; if (h.correct) by[h.theme][0]++; });
  const rows = Object.entries(by).map(([t, [ok, n]]) => ({ t, ok, n, p: ok / n })).sort((a, b) => a.p - b.p);
  const total = (hist || []).length, right = (hist || []).filter(h => h.correct).length;
  const series = (att || []).slice().reverse();
  app.innerHTML = `
    <h1>Estatísticas</h1>
    <section class="panel"><div class="kpis">
      <span><b>${total}</b>questões respondidas</span>
      <span><b>${total ? Math.round(right / total * 100) : 0}%</b>de acerto</span>
      <span><b>${S.profile.best_streak || 0}</b>dias seguidos (recorde)</span></div></section>
    <section class="panel"><span class="label">Acerto por tema (do mais difícil para o mais fácil)</span>
      ${rows.map(r => `<div class="hbar"><span>${esc(r.t)}</span><span class="track"><i style="width:${r.p * 100}%"></i></span>
        <span class="n">${r.ok}/${r.n} · ${Math.round(r.p * 100)}%</span></div>`).join('') || '<p class="muted">Faça uma prova para ver seus números.</p>'}
      ${rows.length ? `<p class="tip">Revise primeiro: <b>${esc(rows[0].t)}</b>.</p>` : ''}
    </section>
    <section class="panel"><span class="label">Últimas ${series.length} provas (% de acerto)</span>
      <div class="cols">${series.map(a => `<i style="height:${Math.max(2, a.score / a.total * 100)}%" title="${a.score}/${a.total} em ${new Date(a.created_at).toLocaleDateString('pt-BR')}"></i>`).join('')}</div>
      <p class="small muted">A barra roxa é a prova mais recente.</p>
    </section>`;
}

/* ---------- conquistas ---------- */

async function viewConquistas() {
  const [{ data: all }, { data: mine }] = await Promise.all([
    sb.from('achievements').select('*').order('sort'),
    sb.from('user_achievements').select('code,unlocked_at'),
  ]);
  const got = new Map((mine || []).map(m => [m.code, m.unlocked_at]));
  app.innerHTML = `
    <h1>Conquistas</h1>
    <p class="muted">${got.size} de ${(all || []).length} desbloqueadas. As secretas só aparecem quando você acha.</p>
    <div class="ach">${(all || []).map(a => {
      const on = got.has(a.code), hide = a.secret && !on;
      return `<div class="badge ${on ? 'on' : 'off'}"><span class="ico">${on ? '★' : hide ? '?' : '☆'}</span>
        <b>${hide ? 'Secreta' : esc(a.name)}</b><span class="small muted">${hide ? '???' : esc(a.description)}</span>
        <span class="small" style="color:var(--accent)">${on ? 'Desbloqueada em ' + new Date(got.get(a.code)).toLocaleDateString('pt-BR') : '+' + a.xp + ' XP'}</span></div>`;
    }).join('')}</div>`;
}

/* ---------- ranking ---------- */

async function viewRanking() {
  const { data, error } = await sb.rpc('weekly_ranking');
  if (error) throw error;
  app.innerHTML = `
    <h1>Ranking da semana</h1>
    <p class="muted">XP ganho nos últimos 7 dias. Só aparece quem ativou no Perfil${S.profile.show_in_ranking ? '' : ' (você está oculto para os outros)'}.</p>
    <section class="panel"><div class="list">${(data || []).map((r, i) => `<div class="${r.is_me ? 'me' : ''}"><span class="pos">${i + 1}</span>
      <span>${esc(r.username)} <span class="small muted">Nv ${r.level} · ${esc(titleFor(r.level))}</span></span><span>${r.xp_week} XP</span></div>`).join('')
      || '<p class="muted">Ninguém pontuou esta semana ainda.</p>'}</div></section>`;
}

/* ---------- perfil ---------- */

async function viewPerfil() {
  const p = S.profile, cur = store.get('skin', 'noite');
  app.innerHTML = `
    <h1>Perfil</h1>
    <form class="panel" id="pf">
      <label class="field"><span>Apelido</span><input type="text" id="uname" value="${esc(p.username)}" pattern="[A-Za-z0-9_]{3,24}" required></label>
      <label class="row"><input type="checkbox" id="rank" ${p.show_in_ranking ? 'checked' : ''}> Aparecer no ranking semanal</label>
      <label class="row"><input type="checkbox" id="focusdef" ${store.get('focus', true) ? 'checked' : ''}> Modo foco nas provas (esconde o menu)</label>
      <p class="error" id="pferr" hidden></p>
      <div class="row"><button>Salvar</button></div>
    </form>
    <section class="panel"><span class="label">Tema visual</span>
      <div class="row">${SKINS.map(s => s.need()
        ? `<button type="button" class="${s.id === cur ? '' : 'quiet'}" data-skin="${s.id}">${s.name}</button>`
        : `<button type="button" class="quiet" disabled title="${esc(s.hint)}">${s.name} · ${esc(s.hint)}</button>`).join('')}</div></section>
    <section class="panel"><div class="row"><span class="muted small">${esc(S.user.email)}</span><span class="spacer"></span><button class="ghost" id="out">Sair da conta</button></div></section>`;
  $('#pf').onsubmit = async ev => {
    ev.preventDefault();
    const err = $('#pferr'); err.hidden = true;
    store.set('focus', $('#focusdef').checked);
    const upd = { username: $('#uname').value.trim(), show_in_ranking: $('#rank').checked };
    const { error } = await sb.from('profiles').update(upd).eq('id', S.user.id);
    if (error) { err.textContent = error.code === '23505' ? 'Esse apelido já está em uso.' : errMsg(error); err.hidden = false; return; }
    Object.assign(S.profile, upd); renderWho(); toast('Perfil salvo.');
  };
  app.querySelectorAll('[data-skin]').forEach(b => b.onclick = () => { store.set('skin', b.dataset.skin); applySkin(); viewPerfil(); });
  $('#out').onclick = () => sb.auth.signOut();
}

/* ---------- easter eggs ---------- */

async function unlock(code) {
  if (!S.user) return;
  const { data } = await sb.rpc('unlock_secret', { p_code: code });
  if (data) {
    S.unlocked.add(code); S.profile.xp += data.xp; renderWho();
    toast(`<strong>Conquista secreta:</strong> ${esc(data.name)} (+${data.xp} XP)`); confetti();
  }
  return data;
}

let logoClicks = 0, logoTimer;
$('#logo').onclick = async () => {
  logoClicks++;
  clearTimeout(logoTimer);
  logoTimer = setTimeout(() => { logoClicks = 0; }, 2500);
  if (logoClicks === 3) mascot.say('Ei, para de cutucar o logo.');
  if (logoClicks === 5) mascot.mood('panic', 'Sério, vai quebrar!');
  if (logoClicks >= 7) {
    logoClicks = 0;
    mascot.mood('happy', 'Achou! Tema Fliperama liberado no Perfil.');
    await unlock('curioso');
    store.set('skin', 'fliperama'); applySkin();
    return;
  }
  if (logoClicks === 1 && S.user) go('painel');
};

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
let kpos = 0;
addEventListener('keydown', ev => {
  kpos = ev.key === KONAMI[kpos] ? kpos + 1 : (ev.key === KONAMI[0] ? 1 : 0);
  if (kpos === KONAMI.length) { kpos = 0; mascot.mood('happy', '+30 vidas! Brincadeira, é só XP mesmo.'); unlock('konami'); }
});

/* ---------- inicialização ---------- */

async function enter(session) {
  S.user = session?.user || null;
  if (!S.user) { S.profile = null; renderWho(); applySkin(); coopLeave(); return route(); }
  app.innerHTML = `<p class="loading">${esc(pick(PHRASES))}</p>`;
  try {
    await Promise.all([loadProfile(), loadQuestions(), loadMine()]);
  } catch (e) {
    app.innerHTML = `<section class="panel"><p class="error">Não consegui falar com o banco: ${esc(errMsg(e))}</p>
      <p class="small muted">Confira se o schema.sql e os seeds foram rodados no Supabase.</p></section>`;
    return;
  }
  applySkin();
  if (S.exam?.mode === 'coop') return route();
  route();
}

applySkin();
let lastUser;
sb.auth.onAuthStateChange((_evt, session) => {
  const id = session?.user?.id || null;
  if (id === lastUser) return;
  lastUser = id;
  // fora do callback para não travar o cliente do Supabase
  setTimeout(() => enter(session), 0);
});
