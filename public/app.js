/* CLINOVA Prospecção — interface (sem bibliotecas externas) */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { config: null, page: 1, data: null, notesLead: null, pollTimer: null };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (res.status === 401) { window.location.href = '/login'; throw new Error('Faça login.'); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Erro ${res.status}`);
  return json;
}

function toast(msg, kind = 'ok') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast ${kind}`;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
}

function formatPhone(d) {
  if (!d) return '';
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
}

const segLabel = (id) => state.config.segments.find(s => s.id === id)?.label || id;
const segGroup = (id) => state.config.segments.find(s => s.id === id)?.group || 'saude';

// ─── Abas ────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
  if (btn.dataset.tab === 'receita') pollReceita();
  if (btn.dataset.tab === 'whatsapp') loadAutosend();
}));

$('btn-logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); window.location.href = '/login'; });

// ─── Contatos ────────────────────────────────────────────────────────────────
function filters() {
  return {
    q: $('f-q').value.trim(), segment: $('f-segment').value, city: $('f-city').value,
    status: $('f-status').value, source: $('f-source').value, mobile: $('f-mobile').checked ? '1' : ''
  };
}

function qs(obj) {
  return new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== '' && v != null)).toString();
}

async function loadLeads() {
  const f = filters();
  $('btn-csv').href = `/api/leads.csv?${qs(f)}`;
  const data = await api(`/api/leads?${qs({ ...f, page: state.page, pageSize: 50 })}`);
  state.data = data;
  renderKpis(data.stats);
  renderCities(data.stats.cities);
  renderList(data);
}

function renderKpis(s) {
  const limit = state.config.settings.dailyLimit;
  const queue = state.data.stats.byStatus.novo;
  const over = s.contactedToday >= limit;
  $('kpis').innerHTML = [
    ['Contatos', s.total],
    ['Com celular', s.mobile],
    ['Ainda não abordados', queue],
    ['Mensagens hoje', `${s.contactedToday} / ${limit}`, over ? 'warn' : ''],
    ['Responderam', s.byStatus.respondeu + s.byStatus.video + s.byStatus.negociando],
    ['Clientes', s.byStatus.cliente, 'good']
  ].map(([k, v, cls]) => `<div class="kpi ${cls || ''}"><small>${esc(k)}</small><strong>${esc(v)}</strong></div>`).join('');
  $('daily-hint').textContent = over
    ? `Você já enviou ${s.contactedToday} mensagens hoje (limite ${limit}). Para proteger seu número, continue amanhã.`
    : '';
}

function renderCities(cities) {
  const sel = $('f-city');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Todas as cidades</option>' + cities.map(c => `<option${c === cur ? ' selected' : ''}>${esc(c)}</option>`).join('');
}

function leadRow(l) {
  const statusOpts = Object.entries(state.config.statuses)
    .map(([k, v]) => `<option value="${k}"${k === l.status ? ' selected' : ''}>${esc(v)}</option>`).join('');
  const rating = l.rating ? `<span class="badge">★ ${esc(l.rating)} (${esc(l.ratingCount)})</span>` : '';
  const sources = (l.sources || []).map(s => `<span class="badge src-${esc(s)}">${s === 'google' ? 'Google' : 'Receita'}</span>`).join('');
  const where = [l.bairro, l.city].filter(Boolean).join(' · ');
  const phone = l.phone ? `<span class="phone">${esc(formatPhone(l.phone))}</span> <span class="badge ${l.mobile ? 'mobile' : 'landline'}">${l.mobile ? 'celular' : 'fixo'}</span>` : '';
  const blocked = ['sem_interesse', 'invalido', 'cliente'].includes(l.status);
  return `
    <article class="lead status-${esc(l.status)}" data-id="${esc(l.id)}">
      <div class="lead-main">
        <div class="lead-name">${l.mapsUrl ? `<a href="${esc(l.mapsUrl)}" target="_blank" rel="noopener noreferrer">${esc(l.name)}</a>` : esc(l.name)}</div>
        <div class="lead-meta">${esc(segLabel(l.segment))}${where ? ' · ' + esc(where) : ''} ${rating} ${sources}</div>
        <div class="lead-meta">${phone}${l.email ? ` · ${esc(l.email)}` : ''}${l.website ? ` · <a href="${esc(l.website)}" target="_blank" rel="noopener noreferrer">site</a>` : ''}${l.cnpj ? ` · CNPJ ${esc(l.cnpj)}` : ''}</div>
        ${l.notes ? `<div class="lead-notes">📝 ${esc(l.notes)}</div>` : ''}
      </div>
      <div class="lead-actions">
        <select class="status-select" aria-label="Status">${statusOpts}</select>
        <div class="btn-row">
          ${l.mobile && !blocked ? '<button class="btn btn-wa btn-sm" data-act="wa">WhatsApp</button>' : ''}
          ${l.phone ? `<a class="btn btn-ghost btn-sm" href="tel:+55${esc(l.phone)}">Ligar</a>` : ''}
          <button class="btn btn-ghost btn-sm" data-act="notes">Notas</button>
        </div>
        ${l.contactedAt ? `<small class="muted">Mensagem: ${esc(new Date(l.contactedAt).toLocaleDateString('pt-BR'))}</small>` : ''}
      </div>
    </article>`;
}

function renderList(data) {
  $('lead-list').innerHTML = data.items.length
    ? data.items.map(leadRow).join('')
    : `<div class="empty">${data.stats.total ? 'Nenhum contato com esses filtros.' : 'Nenhum contato ainda. Comece em <strong>Buscar no Google</strong> ou <strong>Receita Federal</strong>.'}</div>`;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  $('pager').innerHTML = data.total > data.pageSize
    ? `<button class="btn btn-ghost btn-sm" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>Anterior</button>
       <span>Página ${data.page} de ${pages} · ${data.total} contatos</span>
       <button class="btn btn-ghost btn-sm" data-page="${data.page + 1}" ${data.page >= pages ? 'disabled' : ''}>Próxima</button>`
    : `<span>${data.total} contato(s)</span>`;
}

function greeting() {
  const h = new Date(Date.now() - 3 * 3600000).getUTCHours(); // horário de Brasília
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

function buildMessage(lead) {
  const s = state.config.settings;
  const options = String(s.templates[segGroup(lead.segment)] || s.templates.saude).split(/\n\s*-{3,}\s*\n/).map(t => t.trim()).filter(Boolean);
  const tpl = options[Math.floor(Math.random() * options.length)] || '';
  return tpl.replace(/\{saudacao\}/g, greeting()).replace(/\{seunome\}/g, s.senderName || 'Clinova').replace(/\{nome\}/g, lead.name);
}

$('lead-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('.lead').dataset.id;
  const lead = state.data.items.find(l => l.id === id);
  if (!lead) return;

  if (btn.dataset.act === 'wa') {
    const s = state.data.stats;
    if (lead.status === 'novo' && s.contactedToday >= state.config.settings.dailyLimit &&
        !window.confirm(`Você já enviou ${s.contactedToday} mensagens hoje. Enviar mais pode levar ao bloqueio do seu número. Continuar mesmo assim?`)) return;
    window.open(`https://wa.me/55${lead.phone}?text=${encodeURIComponent(buildMessage(lead))}`, '_blank', 'noopener');
    try {
      await api(`/api/leads/${encodeURIComponent(id)}/contacted`, { method: 'POST' });
      await loadLeads();
    } catch (err) { toast(err.message, 'err'); }
  }

  if (btn.dataset.act === 'notes') {
    state.notesLead = lead;
    $('notes-title').textContent = `Notas — ${lead.name}`;
    $('notes-text').value = lead.notes || '';
    $('notes-dialog').showModal();
  }
});

$('lead-list').addEventListener('change', async (e) => {
  if (!e.target.classList.contains('status-select')) return;
  const id = e.target.closest('.lead').dataset.id;
  try {
    await api(`/api/leads/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: e.target.value } });
    toast('Status atualizado.');
    await loadLeads();
  } catch (err) { toast(err.message, 'err'); }
});

$('notes-dialog').addEventListener('close', async () => {
  if ($('notes-dialog').returnValue !== 'save' || !state.notesLead) return;
  try {
    await api(`/api/leads/${encodeURIComponent(state.notesLead.id)}`, { method: 'PATCH', body: { notes: $('notes-text').value } });
    toast('Notas salvas.');
    await loadLeads();
  } catch (err) { toast(err.message, 'err'); }
});

$('pager').addEventListener('click', (e) => {
  const b = e.target.closest('[data-page]');
  if (!b || b.disabled) return;
  state.page = Number(b.dataset.page);
  loadLeads().catch(err => toast(err.message, 'err'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

let qTimer = null;
['f-segment', 'f-city', 'f-status', 'f-source', 'f-mobile'].forEach(id => $(id).addEventListener('change', () => { state.page = 1; loadLeads().catch(err => toast(err.message, 'err')); }));
$('f-q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.page = 1; loadLeads().catch(err => toast(err.message, 'err')); }, 300); });

// ─── Google ──────────────────────────────────────────────────────────────────
function chips(containerId, name) {
  $(containerId).innerHTML = state.config.segments.map(s =>
    `<label class="chip"><input type="checkbox" name="${name}" value="${esc(s.id)}"> ${esc(s.label)}</label>`).join('');
}
const checked = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);

// Estado inteiro: preenche a lista com as cidades do estado (IBGE, Censo 2022)
const stateCount = {}; // "MG|50000" -> número de cidades
async function citiesCount(uf, min) {
  const key = `${uf}|${min}`;
  if (stateCount[key] === undefined) {
    const r = await api(`/api/cities?uf=${encodeURIComponent(uf)}&min=${min}`);
    stateCount[key] = r.total;
  }
  return stateCount[key];
}
const isStateLine = (line) => /^[A-Za-z]{2}$/.test(line.trim()) || /^(todo (o )?)?(o )?estado /i.test(line.trim());

async function updateEstimate() {
  const lines = $('g-areas').value.split('\n').map(s => s.trim()).filter(Boolean);
  const segs = checked('g-seg');
  const terms = state.config.segments.filter(s => segs.includes(s.id)).reduce((n, s) => n + s.terms.length, 0);
  let areas = 0;
  try {
    for (const line of lines) {
      if (isStateLine(line)) {
        const uf = line.trim().length === 2 ? line.trim().toUpperCase() : line;
        areas += await citiesCount(uf, $('g-minpop').value).catch(() => 1);
      } else areas++;
    }
  } catch (e) { /* estimativa é só informativa */ }
  $('g-estimate').textContent = terms && areas
    ? `${areas.toLocaleString('pt-BR')} lugares × ${terms} termos de busca = cerca de ${(areas * terms).toLocaleString('pt-BR')} buscas (cada uma usa 1 a 3 consultas do Google). Buscas já feitas nos últimos 30 dias não contam de novo.`
    : '';
}
let estTimer = null;
const scheduleEstimate = () => { clearTimeout(estTimer); estTimer = setTimeout(updateEstimate, 300); };
$('g-areas').addEventListener('input', scheduleEstimate);
$('g-minpop').addEventListener('change', scheduleEstimate);
$('g-segments').addEventListener('change', scheduleEstimate);

$('btn-fill-state').addEventListener('click', async () => {
  const uf = $('g-uf').value;
  if (!uf) return toast('Escolha o estado.', 'err');
  try {
    const r = await api(`/api/cities?uf=${uf}&min=${$('g-minpop').value}`);
    $('g-areas').value = r.cities.map(c => `${c.name}, ${r.uf}`).join('\n');
    toast(`${r.total} cidades de ${r.name} na lista.`);
    updateEstimate();
  } catch (err) { toast(err.message, 'err'); }
});

$('btn-google').addEventListener('click', async () => {
  const segments = checked('g-seg');
  const areas = $('g-areas').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!segments.length) return toast('Escolha ao menos um segmento.', 'err');
  const btn = $('btn-google');
  btn.disabled = true; btn.textContent = 'Buscando... (pode levar alguns minutos)';
  const out = $('g-result');
  try {
    const r = await api('/api/google/search', { method: 'POST', body: { segments, areas, maxCalls: Number($('g-max').value) || 40, minPopulation: Number($('g-minpop').value) } });
    out.hidden = false;
    out.innerHTML = `
      <strong>${r.added} contatos novos</strong> · ${r.merged} já existiam (dados completados) · ${r.skipped} sem telefone · ${r.closed} fechados<br>
      ${r.queriesDone} buscas feitas em ${r.calls} consultas ao Google.
      ${r.queriesLeft ? `<br><strong>Faltam ${r.queriesLeft} buscas.</strong> Clique em Buscar de novo para continuar.` : '<br>Todas as buscas desta seleção foram feitas.'}
      ${r.errors.length ? `<div class="err-list">${r.errors.slice(0, 5).map(esc).join('<br>')}</div>` : ''}`;
    await loadLeads();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'Buscar';
  }
});

$('btn-save-areas').addEventListener('click', async () => {
  try {
    state.config.settings = await api('/api/settings', { method: 'PUT', body: { areas: $('g-areas').value } });
    toast('Bairros salvos como padrão.');
  } catch (err) { toast(err.message, 'err'); }
});

// ─── Receita ─────────────────────────────────────────────────────────────────
function renderReceita(s) {
  const box = $('r-status');
  const running = s.running;
  $('btn-receita').disabled = running;
  $('btn-receita-cancel').hidden = !running;
  if (!s.startedAt) { box.hidden = true; return; }
  box.hidden = false;
  const pct = s.filesTotal ? Math.round((s.filesDone / s.filesTotal) * 100) : 0;
  box.innerHTML = `
    <div><strong>${esc(s.step)}</strong>${s.file ? ` — ${esc(s.file)}` : ''}${s.month ? ` · dados de ${esc(s.month)}` : ''}</div>
    <div class="progress"><span id="r-bar"></span></div>
    <div class="muted small">${s.filesDone} de ${s.filesTotal} arquivos · ${Number(s.rowsScanned).toLocaleString('pt-BR')} empresas lidas · ${s.matched} encontradas</div>
    ${!running && !s.error ? `<div><strong>${s.added} contatos novos</strong> · ${s.merged} juntados com os que você já tinha · ${s.skipped} sem telefone</div>` : ''}
    ${s.error ? `<div class="err-list">${esc(s.error)}</div>` : ''}`;
  $('r-bar').style.width = `${pct}%`; // via JS: a política de segurança bloqueia style="" no HTML
}

async function pollReceita() {
  clearTimeout(state.pollTimer);
  try {
    const s = await api('/api/receita/status');
    renderReceita(s);
    if (s.running) state.pollTimer = setTimeout(pollReceita, 3000);
    else if (s.finishedAt && pollReceita.wasRunning) { loadLeads().catch(() => {}); }
    pollReceita.wasRunning = s.running;
  } catch (err) { /* tenta de novo na próxima */ }
}

$('btn-receita').addEventListener('click', async () => {
  const segments = checked('r-seg');
  const cities = $('r-cities').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!segments.length) return toast('Escolha ao menos um segmento.', 'err');
  try {
    await api('/api/settings', { method: 'PUT', body: { cities, uf: $('r-uf').value } });
    renderReceita(await api('/api/receita/import', { method: 'POST', body: { uf: $('r-uf').value, cities, segments, withNames: $('r-names').checked } }));
    pollReceita.wasRunning = true;
    pollReceita();
  } catch (err) { toast(err.message, 'err'); }
});

$('btn-receita-cancel').addEventListener('click', async () => {
  try { renderReceita(await api('/api/receita/cancel', { method: 'POST' })); pollReceita(); } catch (err) { toast(err.message, 'err'); }
});

// ─── WhatsApp automático ─────────────────────────────────────────────────────
const WA_LABEL = { off: 'Desconectado', starting: 'Conectando...', qr: 'Aguardando leitura do QR', connected: 'Conectado', reconnecting: 'Reconectando...', error: 'Erro' };
const DAY_LABEL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const RESULT_LABEL = { enviada: 'Enviada', sem_whatsapp: 'Sem WhatsApp', erro: 'Erro' };
state.as = null;
state.asTimer = null;
state.asFormDirty = false;

function setBar(id, value, max) { const el = $(id); if (el) el.style.width = `${Math.min(100, max ? Math.round((value / max) * 100) : 0)}%`; }
const show = (id, visible) => { $(id).hidden = !visible; };
const time = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function renderWhatsapp(wa) {
  const pill = $('wa-pill');
  pill.textContent = WA_LABEL[wa.status] || wa.status;
  pill.className = `pill pill-${wa.status}`;
  show('wa-connected', wa.status === 'connected');
  show('wa-qr-box', wa.status === 'qr' && Boolean(wa.qrDataUrl));
  if (wa.qrDataUrl && $('wa-qr').src !== wa.qrDataUrl) $('wa-qr').src = wa.qrDataUrl;
  $('wa-number').textContent = wa.phone ? `${wa.phone}${wa.name ? ' · ' + wa.name : ''}` : '';
  $('wa-since').textContent = wa.connectedAt ? `Conectado desde ${time(wa.connectedAt)}` : '';
  $('wa-msg').textContent = wa.status === 'qr' ? 'O QR Code muda a cada poucos segundos; esta tela atualiza sozinha.' : (wa.lastError || '');
  show('btn-wa-connect', ['off', 'error'].includes(wa.status));
  show('btn-wa-newqr', ['qr', 'reconnecting', 'error'].includes(wa.status));
  show('btn-wa-logout', ['connected', 'reconnecting'].includes(wa.status) || wa.hasSession);
}

function renderAutosendStatus(st) {
  $('as-message').textContent = st.message;
  $('as-status').className = `as-status st-${st.state}`;
  $('as-hour').textContent = `${st.hourCount} / ${st.hourLimit}`;
  $('as-day').textContent = `${st.dayCount} / ${st.dayLimit}`;
  $('as-queue').textContent = st.queue;
  setBar('as-hour-bar', st.hourCount, st.hourLimit);
  setBar('as-day-bar', st.dayCount, st.dayLimit);
  const tg = $('btn-as-toggle');
  tg.textContent = st.enabled ? 'Pausar envio' : 'Ligar envio automático';
  tg.className = st.enabled ? 'btn btn-ghost' : 'btn btn-primary';
  updateCountdown();
}

function updateCountdown() {
  const st = state.as?.status;
  if (!st || !st.nextAt) { $('as-next').textContent = ''; return; }
  const secs = Math.max(0, Math.round((new Date(st.nextAt).getTime() - Date.now()) / 1000));
  const m = Math.floor(secs / 60), s2 = secs % 60;
  $('as-next').textContent = `Próximo envio em ${m ? m + ' min ' : ''}${s2} s`;
}
setInterval(updateCountdown, 1000);

function renderAutosendForm(cfg) {
  if (state.asFormDirty) return; // não apaga o que você está editando
  $('as-daily').value = cfg.dailyLimit;
  $('as-start').value = cfg.start;
  $('as-end').value = cfg.end;
  $('as-source').value = cfg.source || '';
  $('as-cities').value = (cfg.cities || []).join('\n');
  $('as-days').innerHTML = DAY_LABEL.map((d, i) => `<label class="chip"><input type="checkbox" name="as-day" value="${i}"${cfg.days.includes(i) ? ' checked' : ''}> ${d}</label>`).join('');
  $('as-segments').innerHTML = state.config.segments.map(sg => `<label class="chip"><input type="checkbox" name="as-seg" value="${esc(sg.id)}"${cfg.segments.includes(sg.id) ? ' checked' : ''}> ${esc(sg.label)}</label>`).join('');
}

function renderAutosendLists(data) {
  $('as-log').innerHTML = data.log.length ? data.log.map(e => `
    <tr><td>${esc(time(e.at))}</td><td>${esc(e.name)}<div class="muted small">${esc(formatPhone(e.phone))}</div></td>
    <td><span class="badge res-${esc(e.result)}">${esc(RESULT_LABEL[e.result] || e.result)}</span>${e.error ? `<div class="muted small">${esc(e.error)}</div>` : ''}</td></tr>`).join('')
    : '<tr><td colspan="3" class="muted">Nenhum envio ainda.</td></tr>';
  $('as-replies').innerHTML = data.replies.length ? data.replies.map(r => `
    <div class="reply${r.optOut ? ' optout' : ''}">
      <div class="reply-head"><strong>${esc(r.name)}</strong> <span class="muted small">${esc(time(r.at))}</span>
        ${r.optOut ? '<span class="badge res-erro">Pediu para parar</span>' : '<span class="badge res-enviada">Respondeu</span>'}</div>
      <div class="reply-text">${esc(r.text) || '<em class="muted">(mídia ou mensagem sem texto)</em>'}</div>
      <a class="btn btn-ghost btn-sm" href="https://wa.me/55${esc(r.phone)}" target="_blank" rel="noopener noreferrer">Abrir conversa</a>
    </div>`).join('') : '<p class="muted">Quando alguém responder, aparece aqui e sai da fila automática.</p>';
}

async function loadAutosend() {
  clearTimeout(state.asTimer);
  try {
    const data = await api('/api/autosend');
    state.as = data;
    renderWhatsapp(data.whatsapp);
    renderAutosendStatus(data.status);
    renderAutosendForm(data.config);
    renderAutosendLists(data);
  } catch (err) { /* tenta de novo */ }
  if ($('tab-whatsapp').classList.contains('active')) {
    const fast = state.as && ['starting', 'qr', 'reconnecting'].includes(state.as.whatsapp.status);
    state.asTimer = setTimeout(loadAutosend, fast ? 2000 : 5000);
  }
}

['as-daily', 'as-start', 'as-end', 'as-source', 'as-cities'].forEach(id => $(id).addEventListener('input', () => { state.asFormDirty = true; }));
['as-days', 'as-segments'].forEach(id => $(id).addEventListener('change', () => { state.asFormDirty = true; }));

$('btn-wa-connect').addEventListener('click', async () => {
  try { renderWhatsapp(await api('/api/whatsapp/connect', { method: 'POST', body: {} })); loadAutosend(); } catch (err) { toast(err.message, 'err'); }
});
$('btn-wa-newqr').addEventListener('click', async () => {
  try { renderWhatsapp(await api('/api/whatsapp/connect', { method: 'POST', body: { forceNew: true } })); loadAutosend(); } catch (err) { toast(err.message, 'err'); }
});
$('btn-wa-logout').addEventListener('click', async () => {
  if (!window.confirm('Desconectar este WhatsApp? O envio automático será pausado.')) return;
  try { renderWhatsapp(await api('/api/whatsapp/logout', { method: 'POST' })); loadAutosend(); } catch (err) { toast(err.message, 'err'); }
});
$('btn-as-toggle').addEventListener('click', async () => {
  const enable = !state.as?.status?.enabled;
  try {
    const data = await api('/api/autosend', { method: 'PUT', body: { enabled: enable } });
    state.as = data;
    renderAutosendStatus(data.status);
    toast(enable ? 'Envio automático ligado.' : 'Envio automático pausado.');
  } catch (err) { toast(err.message, 'err'); }
});
$('btn-as-save').addEventListener('click', async () => {
  try {
    const data = await api('/api/autosend', { method: 'PUT', body: {
      dailyLimit: Number($('as-daily').value), start: $('as-start').value, end: $('as-end').value, source: $('as-source').value,
      days: checked('as-day').map(Number), segments: checked('as-seg'),
      cities: $('as-cities').value.split('\n').map(c => c.trim()).filter(Boolean)
    } });
    state.asFormDirty = false;
    state.as = data;
    renderAutosendForm(data.config);
    renderAutosendStatus(data.status);
    toast('Regras salvas.');
  } catch (err) { toast(err.message, 'err'); }
});

// ─── Mensagens ───────────────────────────────────────────────────────────────
const GROUP_LABEL = { saude: 'Saúde (clínicas, consultórios, estética, fisio, nutrição)', psicologia: 'Psicologia e terapias', pet: 'Pet (veterinárias, pet shops, banho e tosa)', servicos: 'Beleza e serviços (salões, barbearias)' };

function renderMessages() {
  const s = state.config.settings;
  $('m-sender').value = s.senderName;
  $('m-limit').value = s.dailyLimit;
  $('m-templates').innerHTML = Object.keys(GROUP_LABEL).map(g => `
    <label class="tpl"><span>${esc(GROUP_LABEL[g])}</span>
      <textarea data-group="${g}" rows="9" maxlength="2000">${esc(s.templates[g] || '')}</textarea>
    </label>`).join('');
}

$('btn-save-msgs').addEventListener('click', async () => {
  const templates = {};
  document.querySelectorAll('#m-templates textarea').forEach(t => { templates[t.dataset.group] = t.value; });
  try {
    state.config.settings = await api('/api/settings', { method: 'PUT', body: { senderName: $('m-sender').value, dailyLimit: Number($('m-limit').value), templates } });
    toast('Mensagens salvas.');
    loadLeads().catch(() => {});
  } catch (err) { toast(err.message, 'err'); }
});

// ─── Início ──────────────────────────────────────────────────────────────────
(async function init() {
  try {
    state.config = await api('/api/config');
    const c = state.config;
    $('f-segment').innerHTML += c.segments.map(s => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('');
    $('f-status').innerHTML = '<option value="">Todos os status</option><option value="fila">Fila: novos com celular</option>' +
      Object.entries(c.statuses).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    chips('g-segments', 'g-seg');
    chips('r-segments', 'r-seg');
    $('g-areas').value = c.settings.areas.join('\n');
    $('g-uf').innerHTML = '<option value="">Escolha...</option>' + c.states.map(st => `<option value="${esc(st.uf)}"${st.uf === 'MG' ? ' selected' : ''}>${esc(st.name)} (${esc(st.uf)})</option>`).join('');
    updateEstimate();
    $('r-cities').value = c.settings.cities.join('\n');
    $('r-uf').value = c.settings.uf;
    $('google-off').hidden = c.googleConfigured;
    renderMessages();
    await loadLeads();
    pollReceita();
  } catch (err) {
    toast(err.message, 'err');
  }
})();
