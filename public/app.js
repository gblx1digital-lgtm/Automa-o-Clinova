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

function buildMessage(lead) {
  const s = state.config.settings;
  const tpl = s.templates[segGroup(lead.segment)] || s.templates.saude;
  return tpl.replace(/\{seunome\}/g, s.senderName || 'Clinova').replace(/\{nome\}/g, lead.name);
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

$('btn-google').addEventListener('click', async () => {
  const segments = checked('g-seg');
  const areas = $('g-areas').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!segments.length) return toast('Escolha ao menos um segmento.', 'err');
  const btn = $('btn-google');
  btn.disabled = true; btn.textContent = 'Buscando... (pode levar alguns minutos)';
  const out = $('g-result');
  try {
    const r = await api('/api/google/search', { method: 'POST', body: { segments, areas, maxCalls: Number($('g-max').value) || 40 } });
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
