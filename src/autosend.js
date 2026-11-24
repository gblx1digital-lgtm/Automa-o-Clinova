/**
 * Envio automático das mensagens de apresentação, com limites para proteger o número.
 *
 * Limites FIXOS (não podem ser aumentados pela tela):
 *   - no mínimo 1 minuto entre uma mensagem e outra (+ um intervalo extra aleatório)
 *   - no máximo 30 mensagens por hora
 * Configuráveis: limite por dia, horário e dias da semana, segmentos, cidades e fonte.
 *
 * Quem responde sai da fila automática (você assume a conversa); quem pede para parar
 * vira "Não quer contato" e nunca mais recebe mensagem.
 */
const storage = require('./storage');
const leads = require('./leads');
const messages = require('./messages');
const whatsapp = require('./whatsapp');
const { BY_ID } = require('./segments');

// Em testes (NODE_ENV=test + AUTOSEND_FAST=1) o tempo corre 600x mais rápido
const SCALE = process.env.NODE_ENV === 'test' && process.env.AUTOSEND_FAST === '1' ? 600 : 1;
const MIN_GAP_MS = 60000 / SCALE;         // 1 minuto
const MAX_JITTER_MS = 60000 / SCALE;      // + até 1 minuto aleatório (média ~1,5 min)
const HOUR_MS = 3600000 / SCALE;
const MAX_PER_HOUR = 30;
const MAX_PER_DAY_CEILING = 300;
const TICK_MS = Math.max(5000 / SCALE, 5);
const ERROR_BACKOFF_MS = 5 * 60000 / SCALE;
const MAX_CONSECUTIVE_ERRORS = 3;

const DEFAULTS = {
  enabled: false,
  dailyLimit: 150,
  start: '09:00',
  end: '18:00',
  days: [1, 2, 3, 4, 5], // 0 = domingo ... 6 = sábado
  segments: [],
  cities: [],
  source: ''
};

let nextAt = 0;
let busy = false;
let consecutiveErrors = 0;
let pausedReason = '';
let timer = null;

function config() {
  const s = storage.read('settings', {});
  return { ...DEFAULTS, ...(s.autosend || {}) };
}

function saveConfig(changes = {}) {
  const s = storage.read('settings', {});
  const cur = { ...DEFAULTS, ...(s.autosend || {}) };
  const hhmm = (v, fb) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? String(v) : fb);
  if (changes.enabled !== undefined) {
    cur.enabled = Boolean(changes.enabled);
    if (cur.enabled) { pausedReason = ''; consecutiveErrors = 0; }
  }
  if (changes.dailyLimit !== undefined) cur.dailyLimit = Math.min(Math.max(Number(changes.dailyLimit) || DEFAULTS.dailyLimit, 1), MAX_PER_DAY_CEILING);
  if (changes.start !== undefined) cur.start = hhmm(changes.start, cur.start);
  if (changes.end !== undefined) cur.end = hhmm(changes.end, cur.end);
  if (Array.isArray(changes.days)) cur.days = [...new Set(changes.days.map(Number).filter(d => d >= 0 && d <= 6))];
  if (Array.isArray(changes.segments)) cur.segments = changes.segments.filter(id => BY_ID[id]);
  if (Array.isArray(changes.cities)) cur.cities = changes.cities.map(c => String(c).trim()).filter(Boolean).slice(0, 100);
  if (changes.source !== undefined) cur.source = ['google', 'receita'].includes(changes.source) ? changes.source : '';
  s.autosend = cur;
  storage.save('settings');
  return cur;
}

function log() { return storage.read('send-log', []); }
function replies() { return storage.read('replies', []); }

function addLog(entry) {
  const list = log();
  list.push({ at: new Date().toISOString(), ...entry });
  if (list.length > 3000) list.splice(0, list.length - 3000);
  storage.save('send-log');
}

function sentSince(ms) {
  return log().filter(e => e.result === 'enviada' && new Date(e.at).getTime() >= ms).length;
}

function brtMidnightMs(now) {
  const b = messages.brt(new Date(now));
  return Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) + 3 * 3600000;
}

function inWindow(cfg, now) {
  if (SCALE !== 1 && cfg.start === '00:00' && cfg.end === '23:59') return true;
  const b = messages.brt(new Date(now));
  if (!cfg.days.includes(b.getUTCDay())) return false;
  const mins = b.getUTCHours() * 60 + b.getUTCMinutes();
  const [sh, sm] = cfg.start.split(':').map(Number);
  const [eh, em] = cfg.end.split(':').map(Number);
  return mins >= sh * 60 + sm && mins < eh * 60 + em;
}

function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }

/** Fila: contatos novos, com celular, nunca abordados, dentro dos filtros. Melhores avaliados primeiro. */
function queue(cfg = config()) {
  const cities = cfg.cities.map(norm);
  return leads.all()
    .filter(l => l.status === 'novo' && l.mobile && !l.contactedAt &&
      (!cfg.segments.length || cfg.segments.includes(l.segment)) &&
      (!cities.length || cities.includes(norm(l.city))) &&
      (!cfg.source || (l.sources || []).includes(cfg.source)))
    .sort((a, b) => (b.ratingCount || 0) - (a.ratingCount || 0) || String(a.createdAt).localeCompare(String(b.createdAt)));
}

/** Situação atual (o que o robô está esperando e por quê). */
function describe(now = Date.now()) {
  const cfg = config();
  const wa = whatsapp.status();
  const hourCount = sentSince(now - HOUR_MS);
  const dayCount = sentSince(brtMidnightMs(now));
  const q = queue(cfg).length;
  const base = { enabled: cfg.enabled, hourCount, hourLimit: MAX_PER_HOUR, dayCount, dayLimit: cfg.dailyLimit, queue: q, nextAt: null, pausedReason };
  if (!cfg.enabled) return { ...base, state: 'desligado', message: pausedReason || 'Envio automático desligado.' };
  if (wa.status !== 'connected') return { ...base, state: 'sem_conexao', message: 'Aguardando o WhatsApp conectar.' };
  if (!inWindow(cfg, now)) return { ...base, state: 'fora_horario', message: `Fora do horário de envio (${cfg.start} às ${cfg.end}).` };
  if (dayCount >= cfg.dailyLimit) return { ...base, state: 'limite_dia', message: `Limite do dia atingido (${cfg.dailyLimit}). Continua amanhã.` };
  if (hourCount >= MAX_PER_HOUR) {
    const oldest = log().filter(e => e.result === 'enviada' && new Date(e.at).getTime() >= now - HOUR_MS)
      .map(e => new Date(e.at).getTime()).sort((a, b) => a - b)[0];
    return { ...base, state: 'limite_hora', message: 'Limite de 30 mensagens por hora atingido.', nextAt: new Date(oldest + HOUR_MS).toISOString() };
  }
  if (!q) return { ...base, state: 'sem_fila', message: 'Nenhum contato na fila com esses filtros. Busque mais contatos.' };
  if (now < nextAt) return { ...base, state: 'aguardando', message: 'Aguardando o intervalo entre mensagens.', nextAt: new Date(nextAt).toISOString() };
  return { ...base, state: 'pronto', message: 'Enviando...' };
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const now = Date.now();
    const d = describe(now);
    if (d.state !== 'pronto') return;
    const cfg = config();
    const lead = queue(cfg)[0];
    if (!lead) return;

    const text = messages.build(lead, storage.read('settings', {}), new Date(now));
    // Reserva o contato antes de enviar (não manda duas vezes, mesmo se algo travar no meio)
    lead.contactedAt = new Date().toISOString();
    storage.save('leads');
    const r = await whatsapp.sendText(lead.phone, text);
    nextAt = Date.now() + MIN_GAP_MS + Math.round(Math.random() * MAX_JITTER_MS);

    if (r.ok) {
      consecutiveErrors = 0;
      leads.update(lead.id, { status: 'contatado' });
      lead.contactedVia = 'automatico';
      if (r.waPhone) lead.waPhone = r.waPhone;
      storage.save('leads');
      addLog({ leadId: lead.id, name: lead.name, phone: lead.phone, result: 'enviada' });
    } else if (r.reason === 'no_whatsapp') {
      consecutiveErrors = 0;
      leads.update(lead.id, { status: 'invalido', notes: [lead.notes, 'Número sem WhatsApp (verificado no envio automático).'].filter(Boolean).join('\n') });
      addLog({ leadId: lead.id, name: lead.name, phone: lead.phone, result: 'sem_whatsapp' });
    } else {
      lead.contactedAt = null; // devolve para a fila
      storage.save('leads');
      consecutiveErrors++;
      nextAt = Date.now() + ERROR_BACKOFF_MS;
      addLog({ leadId: lead.id, name: lead.name, phone: lead.phone, result: 'erro', error: r.error || r.reason });
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        pausedReason = `Pausado automaticamente após ${MAX_CONSECUTIVE_ERRORS} erros seguidos (${r.error || r.reason}). Confira a conexão e ligue de novo.`;
        saveConfig({ enabled: false });
      }
    }
  } catch (e) {
    console.error('[envio automático]', e.message);
  } finally {
    busy = false;
  }
}

/** Variações do número com e sem o 9 (números antigos aparecem sem ele no WhatsApp). */
function phoneVariants(d) {
  const v = new Set([d]);
  if (d.length === 11 && d[2] === '9') v.add(d.slice(0, 2) + d.slice(3));
  if (d.length === 10 && /[6-9]/.test(d[2])) v.add(`${d.slice(0, 2)}9${d.slice(2)}`);
  return v;
}

/** Resposta recebida: tira da fila; se pediu para parar, nunca mais recebe. */
async function handleIncoming(phone, text) {
  const variants = phoneVariants(String(phone || '').replace(/\D/g, ''));
  const lead = leads.all().find(l => [l.phone, l.phone2, l.waPhone].some(p => p && variants.has(p)));
  if (!lead) return null;
  const optOut = messages.isOptOut(text);
  lead.lastReply = { at: new Date().toISOString(), text: String(text || '').slice(0, 500) };
  if (optOut && lead.status !== 'cliente') leads.update(lead.id, { status: 'sem_interesse' });
  else if (['novo', 'contatado'].includes(lead.status)) leads.update(lead.id, { status: 'respondeu' });
  if (!lead.contactedAt) lead.contactedAt = lead.lastReply.at; // garante que não entra na fila
  storage.save('leads');
  const list = replies();
  list.unshift({ at: lead.lastReply.at, leadId: lead.id, name: lead.name, phone: lead.phone, text: lead.lastReply.text, optOut });
  if (list.length > 500) list.length = 500;
  storage.save('replies');
  return lead;
}

function start() {
  whatsapp.setIncomingHandler(handleIncoming);
  clearInterval(timer);
  timer = setInterval(tick, TICK_MS);
  if (timer.unref) timer.unref();
}

module.exports = {
  start, tick, describe, config, saveConfig, queue, log, replies, handleIncoming, phoneVariants,
  LIMITS: { MIN_GAP_MS, MAX_JITTER_MS, HOUR_MS, MAX_PER_HOUR, MAX_PER_DAY_CEILING, SCALE }
};
