/**
 * Contatos (leads): cadastro, junção de duplicados, filtros, andamento e exportação.
 */
const crypto = require('crypto');
const storage = require('./storage');
const { BY_ID } = require('./segments');

const STATUSES = {
  novo: 'Novo',
  contatado: 'Mensagem enviada',
  respondeu: 'Respondeu',
  video: 'Vídeo enviado',
  negociando: 'Negociando',
  cliente: 'Virou cliente',
  sem_interesse: 'Não quer contato',
  invalido: 'Número inválido'
};
// Quem pediu para não receber mais mensagens nunca volta para a fila
const DO_NOT_CONTACT = new Set(['sem_interesse', 'invalido', 'cliente']);

function all() { return storage.read('leads', []); }

/** Só dígitos, sem o 55 do país e sem zero à esquerda: "(31) 99999-8888" -> "31999998888". */
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  d = d.replace(/^0+/, '');
  return d.length >= 10 && d.length <= 11 ? d : '';
}

/** Celular (DDD + 9 + 8 dígitos): provavelmente tem WhatsApp. */
function isMobile(digits) { return /^\d{2}9\d{8}$/.test(String(digits || '')); }

function formatPhone(d) {
  if (!d) return '';
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
}

function titleCase(s) {
  const small = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
    .split(' ').map((w, i) => (i > 0 && small.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function newId() { return `lead-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`; }

/**
 * Inclui ou junta um contato. Duplicado = mesmo placeId do Google, mesmo CNPJ ou mesmo telefone.
 * Na junção, completa campos vazios e soma as fontes; nunca apaga o andamento (status, notas).
 * Devolve 'added' | 'merged' | 'skipped'.
 */
function upsert(input, index) {
  const list = all();
  const phone = normalizePhone(input.phone);
  const phone2 = normalizePhone(input.phone2);
  if (!phone && !phone2) return 'skipped'; // sem telefone não serve para prospecção

  const keys = [
    input.placeId && `p:${input.placeId}`,
    input.cnpj && `c:${input.cnpj}`,
    phone && `t:${phone}`,
    phone2 && `t:${phone2}`
  ].filter(Boolean);

  let existing = null;
  for (const k of keys) { if (index.has(k)) { existing = index.get(k); break; } }

  if (existing) {
    const fill = (field, value) => { if (value && !existing[field]) existing[field] = value; };
    fill('name', input.name); fill('phone', phone || phone2); fill('email', input.email);
    fill('address', input.address); fill('bairro', input.bairro); fill('city', input.city); fill('uf', input.uf);
    fill('website', input.website); fill('mapsUrl', input.mapsUrl); fill('cnpj', input.cnpj); fill('placeId', input.placeId);
    if (phone2 && phone2 !== existing.phone) fill('phone2', phone2);
    if (input.rating && !existing.rating) { existing.rating = input.rating; existing.ratingCount = input.ratingCount || 0; }
    existing.mobile = isMobile(existing.phone) || isMobile(existing.phone2);
    existing.sources = [...new Set([...(existing.sources || []), input.source])];
    existing.updatedAt = new Date().toISOString();
    for (const k of keys) index.set(k, existing);
    return 'merged';
  }

  const now = new Date().toISOString();
  const mainPhone = isMobile(phone2) && !isMobile(phone) ? phone2 : (phone || phone2);
  const lead = {
    id: newId(),
    name: input.name || 'Sem nome',
    segment: BY_ID[input.segment] ? input.segment : 'odontologia',
    phone: mainPhone,
    phone2: mainPhone === phone ? phone2 : phone,
    mobile: isMobile(phone) || isMobile(phone2),
    email: input.email || '',
    address: input.address || '',
    bairro: input.bairro || '',
    city: input.city || '',
    uf: input.uf || '',
    website: input.website || '',
    mapsUrl: input.mapsUrl || '',
    rating: input.rating || null,
    ratingCount: input.ratingCount || 0,
    cnpj: input.cnpj || '',
    placeId: input.placeId || '',
    sources: [input.source],
    status: 'novo',
    notes: '',
    contactedAt: null,
    history: [],
    createdAt: now,
    updatedAt: now
  };
  list.push(lead);
  for (const k of keys) index.set(k, lead);
  return 'added';
}

/** Índice de duplicados (placeId, CNPJ, telefones) — montado uma vez por busca/importação. */
function buildIndex() {
  const index = new Map();
  for (const l of all()) {
    if (l.placeId) index.set(`p:${l.placeId}`, l);
    if (l.cnpj) index.set(`c:${l.cnpj}`, l);
    if (l.phone) index.set(`t:${l.phone}`, l);
    if (l.phone2) index.set(`t:${l.phone2}`, l);
  }
  return index;
}

function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

function filter(q = {}) {
  const text = norm(q.q).trim();
  const digits = String(q.q || '').replace(/\D/g, '');
  return all().filter(l =>
    (!q.segment || l.segment === q.segment) &&
    (!q.status || (q.status === 'fila' ? l.status === 'novo' && l.mobile : l.status === q.status)) &&
    (!q.city || norm(l.city) === norm(q.city)) &&
    (!q.source || (l.sources || []).includes(q.source)) &&
    (!q.mobile || l.mobile) &&
    (!text || norm(l.name).includes(text) || norm(l.bairro).includes(text) || norm(l.notes).includes(text) ||
      (digits.length >= 4 && (String(l.phone).includes(digits) || String(l.cnpj).includes(digits))))
  );
}

function query(q = {}) {
  const items = filter(q);
  // Fila de trabalho: celulares novos primeiro, depois os mais bem avaliados no Google
  items.sort((a, b) =>
    (a.status === 'novo' ? 0 : 1) - (b.status === 'novo' ? 0 : 1) ||
    (b.mobile ? 1 : 0) - (a.mobile ? 1 : 0) ||
    (b.ratingCount || 0) - (a.ratingCount || 0) ||
    a.name.localeCompare(b.name));
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 50, 10), 200);
  const page = Math.max(Number(q.page) || 1, 1);
  return { total: items.length, page, pageSize, items: items.slice((page - 1) * pageSize, page * pageSize) };
}

function todayBR() {
  return new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
}

function stats() {
  const list = all();
  const byStatus = Object.fromEntries(Object.keys(STATUSES).map(s => [s, 0]));
  const bySegment = {};
  const cities = new Set();
  let mobile = 0, contactedToday = 0;
  const today = todayBR();
  for (const l of list) {
    byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    bySegment[l.segment] = (bySegment[l.segment] || 0) + 1;
    if (l.city) cities.add(l.city);
    if (l.mobile) mobile++;
    if (l.contactedAt && new Date(new Date(l.contactedAt).getTime() - 3 * 3600000).toISOString().slice(0, 10) === today) contactedToday++;
  }
  return { total: list.length, mobile, contactedToday, byStatus, bySegment, cities: [...cities].sort() };
}

function find(id) { return all().find(l => l.id === id) || null; }

function update(id, changes) {
  const lead = find(id);
  if (!lead) return null;
  if (changes.status && STATUSES[changes.status] && changes.status !== lead.status) {
    lead.history = [...(lead.history || []), { at: new Date().toISOString(), from: lead.status, to: changes.status }].slice(-30);
    lead.status = changes.status;
    if (changes.status === 'contatado' && !lead.contactedAt) lead.contactedAt = new Date().toISOString();
  }
  if (typeof changes.notes === 'string') lead.notes = changes.notes.slice(0, 2000);
  lead.updatedAt = new Date().toISOString();
  storage.save('leads');
  return lead;
}

/** Marca que a mensagem foi aberta no WhatsApp (conta no limite diário). */
function markContacted(id) {
  const lead = find(id);
  if (!lead) return null;
  if (DO_NOT_CONTACT.has(lead.status)) return lead;
  lead.contactedAt = new Date().toISOString();
  if (lead.status === 'novo') return update(id, { status: 'contatado' });
  lead.updatedAt = lead.contactedAt;
  storage.save('leads');
  return lead;
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  // Evita fórmula quando o arquivo é aberto no Excel/Sheets
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

function toCsv(q = {}) {
  const head = ['Nome', 'Segmento', 'Telefone', 'Celular', 'Telefone 2', 'E-mail', 'Bairro', 'Cidade', 'UF', 'Endereço',
    'Site', 'Nota Google', 'Avaliações', 'CNPJ', 'Fontes', 'Status', 'Mensagem enviada em', 'Notas', 'Google Maps'];
  const rows = filter(q).map(l => [
    l.name, BY_ID[l.segment]?.label || l.segment, formatPhone(l.phone), l.mobile ? 'sim' : 'não', formatPhone(l.phone2),
    l.email, l.bairro, l.city, l.uf, l.address, l.website, l.rating || '', l.ratingCount || '', l.cnpj,
    (l.sources || []).join(' + '), STATUSES[l.status] || l.status, l.contactedAt ? new Date(l.contactedAt).toLocaleString('pt-BR') : '',
    l.notes, l.mapsUrl
  ].map(csvCell).join(';'));
  return '﻿' + [head.map(csvCell).join(';'), ...rows].join('\r\n');
}

module.exports = {
  STATUSES, DO_NOT_CONTACT, all, upsert, buildIndex, query, stats, find, update, markContacted, toCsv,
  normalizePhone, isMobile, formatPhone, titleCase
};
