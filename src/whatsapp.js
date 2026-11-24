/**
 * Conexão com o WhatsApp por QR Code (WhatsApp Web, biblioteca Baileys).
 *
 * A sessão fica salva em DATA_DIR/whatsapp-auth: depois de ler o QR uma vez, o site reconecta
 * sozinho a cada reinício. Para trocar de número, use "Desconectar" e leia um QR novo.
 *
 * Em testes (NODE_ENV=test e WHATSAPP_FAKE=1) usa um WhatsApp simulado, sem internet.
 */
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const pino = require('pino');
const storage = require('./storage');

const AUTH_DIR = path.join(storage.DATA_DIR, 'whatsapp-auth');
const FAKE = process.env.NODE_ENV === 'test' && process.env.WHATSAPP_FAKE === '1';

const state = {
  status: 'off',        // off | starting | qr | connected | reconnecting | error
  qrDataUrl: null,
  phone: '',
  name: '',
  connectedAt: null,
  lastError: null
};
let sock = null;
let starting = false;
let reconnectTimer = null;
let onIncoming = () => {};
let unpairedRetries = 0; // tentativas sem ninguém ler o QR (para não ficar gerando QR para sempre)
const MAX_UNPAIRED_RETRIES = 4;
const lidToPhone = new Map(); // WhatsApp novo usa "LID" em vez do número em algumas conversas

/** Só dígitos com DDI 55: "31999998888" -> "5531999998888". */
function toIntl(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  return d.startsWith('55') && d.length >= 12 ? d : `55${d}`;
}

/** "5531999998888@s.whatsapp.net" -> "31999998888" */
function jidToLocal(jid) {
  const raw = String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  return raw.startsWith('55') && raw.length >= 12 ? raw.slice(2) : raw;
}

function formatDisplay(d) {
  if (!d) return '';
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
}

function status() {
  return { ...state, hasSession: FAKE ? fake.paired : fs.existsSync(path.join(AUTH_DIR, 'creds.json')) };
}

function setIncomingHandler(fn) { onIncoming = fn; }

function textOf(msg) {
  const m = msg.message || {};
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText || m.listResponseMessage?.title || '';
}

async function start(forceNew = false, manual = false) {
  if (FAKE) return fake.start(forceNew);
  if (starting) return status();
  if (manual) unpairedRetries = 0;
  starting = true;
  clearTimeout(reconnectTimer);
  try {
    if (forceNew) {
      try { sock && sock.end(undefined); } catch (e) { /* ignore */ }
      sock = null;
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    Object.assign(state, { status: 'starting', qrDataUrl: null, lastError: null });

    const baileys = await import('@whiskeysockets/baileys');
    const makeWASocket = baileys.default?.default || baileys.default || baileys.makeWASocket;
    const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = baileys;
    const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    let version;
    try { version = (await fetchLatestBaileysVersion()).version; } catch (e) { /* usa a versão padrão da biblioteca */ }

    const s = makeWASocket({
      ...(version ? { version } : {}),
      auth,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: Browsers ? Browsers.macOS('Desktop') : ['Clinova Prospeccao', 'Chrome', '120.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false // não aparece "online" o tempo todo
    });
    sock = s;
    s.ev.on('creds.update', saveCreds);

    s.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        state.status = 'qr';
        state.qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } }).catch(() => null);
      }
      if (connection === 'open') {
        unpairedRetries = 0;
        Object.assign(state, {
          status: 'connected', qrDataUrl: null, lastError: null, connectedAt: new Date().toISOString(),
          phone: formatDisplay(jidToLocal(s.user?.id)), name: s.user?.name || s.user?.verifiedName || ''
        });
        console.log(`✅ WhatsApp conectado: ${state.phone}`);
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        if (sock === s) sock = null;
        if (code === DisconnectReason.loggedOut) {
          // Desconectado pelo celular: apaga a sessão e espera um QR novo
          Object.assign(state, { status: 'off', qrDataUrl: null, phone: '', name: '', lastError: 'Sessão encerrada pelo celular. Conecte de novo.' });
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        } else if (!fs.existsSync(path.join(AUTH_DIR, 'creds.json')) && ++unpairedRetries > MAX_UNPAIRED_RETRIES) {
          // Ninguém leu o QR (ou sem internet): para de tentar até você clicar em Conectar de novo
          unpairedRetries = 0;
          Object.assign(state, { status: 'off', qrDataUrl: null, lastError: 'O QR Code expirou sem ser lido. Clique em "Conectar WhatsApp" para gerar outro.' });
        } else {
          state.status = 'reconnecting';
          state.lastError = lastDisconnect?.error?.message || null;
          reconnectTimer = setTimeout(() => start(false).catch(() => {}), 5000);
        }
      }
    });

    s.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages || []) {
        const key = msg.key || {};
        if (key.fromMe) continue;
        const jids = [key.remoteJid, key.remoteJidAlt, key.senderPn, key.participant, key.participantAlt].filter(Boolean);
        if (jids.some(j => j.endsWith('@g.us') || j.endsWith('@broadcast') || j.endsWith('@newsletter'))) continue;
        let phone = '';
        const pnJid = jids.find(j => j.endsWith('@s.whatsapp.net'));
        if (pnJid) phone = jidToLocal(pnJid);
        else {
          const lid = jids.find(j => j.endsWith('@lid'));
          if (lid) phone = lidToPhone.get(lid.split('@')[0].split(':')[0]) || '';
        }
        const text = textOf(msg);
        if (phone) Promise.resolve(onIncoming(phone, text)).catch(err => console.error('[WhatsApp resposta]', err.message));
      }
    });
  } catch (e) {
    state.status = 'error';
    state.lastError = e.message;
  } finally {
    starting = false;
  }
  return status();
}

async function logout() {
  if (FAKE) return fake.logout();
  clearTimeout(reconnectTimer);
  try { if (sock) await sock.logout(); } catch (e) { /* ignore */ }
  try { sock && sock.end(undefined); } catch (e) { /* ignore */ }
  sock = null;
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  Object.assign(state, { status: 'off', qrDataUrl: null, phone: '', name: '', connectedAt: null, lastError: null });
  return status();
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Envia um texto. Confere antes se o número tem WhatsApp e mostra "digitando..." por alguns
 * segundos, como uma pessoa faria. Devolve { ok, reason, jid }.
 *   reason: not_connected | no_whatsapp | error
 */
async function sendText(localDigits, text) {
  if (FAKE) return fake.send(localDigits, text);
  if (state.status !== 'connected' || !sock) return { ok: false, reason: 'not_connected' };
  try {
    const [found] = await sock.onWhatsApp(toIntl(localDigits));
    if (!found || !found.exists) return { ok: false, reason: 'no_whatsapp' };
    const jid = found.jid;
    if (found.lid) lidToPhone.set(String(found.lid).split('@')[0].split(':')[0], jidToLocal(jid));
    try {
      await sock.presenceSubscribe(jid);
      await sock.sendPresenceUpdate('composing', jid);
      await sleep(2500 + Math.round(Math.random() * 3000) + Math.min(text.length * 15, 4000));
      await sock.sendPresenceUpdate('paused', jid);
    } catch (e) { /* "digitando" é só cortesia */ }
    await sock.sendMessage(jid, { text });
    return { ok: true, jid, waPhone: jidToLocal(jid) };
  } catch (e) {
    return { ok: false, reason: 'error', error: e.message };
  }
}

/** Reconecta sozinho ao subir o servidor se já existe sessão salva. */
function autoStart() {
  if (FAKE) return;
  if (fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) start(false).catch(() => {});
}

// ─── WhatsApp simulado (somente testes) ─────────────────────────────────────
const fake = {
  paired: false,
  sent: [],
  noWhatsApp: new Set(),
  failNext: 0,
  async start(forceNew) {
    if (forceNew) this.paired = false;
    if (!this.paired) {
      Object.assign(state, { status: 'qr', qrDataUrl: await QRCode.toDataURL('teste-qr-clinova'), phone: '', name: '' });
    }
    return status();
  },
  pair(phone = '31911112222') {
    this.paired = true;
    Object.assign(state, { status: 'connected', qrDataUrl: null, phone: formatDisplay(phone), name: 'Teste', connectedAt: new Date().toISOString() });
  },
  logout() {
    this.paired = false;
    Object.assign(state, { status: 'off', qrDataUrl: null, phone: '', name: '' });
    return status();
  },
  async send(phone, text) {
    if (state.status !== 'connected') return { ok: false, reason: 'not_connected' };
    if (this.failNext > 0) { this.failNext--; return { ok: false, reason: 'error', error: 'falha simulada' }; }
    if (this.noWhatsApp.has(phone)) return { ok: false, reason: 'no_whatsapp' };
    this.sent.push({ phone, text, at: Date.now() });
    return { ok: true, jid: `55${phone}@s.whatsapp.net`, waPhone: phone };
  },
  incoming(phone, text) { return onIncoming(phone, text); }
};

module.exports = { start, logout, status, sendText, autoStart, setIncomingHandler, FAKE, fake, formatDisplay };
