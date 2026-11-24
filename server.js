/**
 * CLINOVA Prospecção — encontre clínicas, consultórios, psicólogos, pet shops e salões
 * (Google Maps + Receita Federal) e acompanhe a abordagem pelo WhatsApp.
 */
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const auth = require('./src/auth');
const storage = require('./src/storage');
const leads = require('./src/leads');
const google = require('./src/google');
const receita = require('./src/receita');
const whatsapp = require('./src/whatsapp');
const autosend = require('./src/autosend');
const cities = require('./src/cities');
const { SEGMENTS, DEFAULT_TEMPLATES, DEFAULT_AREAS, DEFAULT_CITIES } = require('./src/segments');

const app = express();
const IS_PROD = process.env.NODE_ENV === 'production';
if (IS_PROD || process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: '200kb' }));
app.use((req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });

// ─── Login ────────────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos.' } });

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/login.css', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.css')));
app.get('/login.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.js')));

app.post('/api/login', loginLimiter, (req, res) => {
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 8) {
    return res.status(503).json({ error: 'Defina ADMIN_PASSWORD (mínimo 8 caracteres) nas variáveis do servidor.' });
  }
  if (!auth.checkPassword(req.body?.password)) return res.status(401).json({ error: 'Senha incorreta.' });
  auth.issue(res);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { auth.clear(res); res.json({ ok: true }); });
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Daqui para baixo, só com login
app.use(auth.requireLogin);
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

// ─── Configurações ────────────────────────────────────────────────────────────
function settings() {
  const s = storage.read('settings', {});
  return {
    senderName: s.senderName || '',
    dailyLimit: Number(s.dailyLimit) || 25,
    templates: { ...DEFAULT_TEMPLATES, ...(s.templates || {}) },
    areas: Array.isArray(s.areas) && s.areas.length ? s.areas : DEFAULT_AREAS,
    cities: Array.isArray(s.cities) && s.cities.length ? s.cities : DEFAULT_CITIES,
    uf: s.uf || 'MG'
  };
}

app.get('/api/config', (req, res) => {
  res.json({
    segments: SEGMENTS.map(({ id, label, group, terms }) => ({ id, label, group, terms })),
    statuses: leads.STATUSES,
    settings: settings(),
    states: cities.states(),
    googleConfigured: google.isConfigured()
  });
});

app.put('/api/settings', (req, res) => {
  const b = req.body || {};
  const cur = storage.read('settings', {});
  const lines = (v, max) => (Array.isArray(v) ? v : String(v || '').split('\n')).map(x => String(x).trim()).filter(Boolean).slice(0, max);
  if (b.senderName !== undefined) cur.senderName = String(b.senderName).slice(0, 60);
  if (b.dailyLimit !== undefined) cur.dailyLimit = Math.min(Math.max(Number(b.dailyLimit) || 25, 1), 200);
  if (b.templates && typeof b.templates === 'object') {
    cur.templates = {};
    for (const k of Object.keys(DEFAULT_TEMPLATES)) if (typeof b.templates[k] === 'string') cur.templates[k] = b.templates[k].slice(0, 2000);
  }
  if (b.areas !== undefined) cur.areas = lines(b.areas, 200);
  if (b.cities !== undefined) cur.cities = lines(b.cities, 100);
  if (b.uf !== undefined) cur.uf = String(b.uf).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'MG';
  storage.save('settings');
  res.json(settings());
});

// ─── Cidades por estado (IBGE, Censo 2022) ────────────────────────────────────
app.get('/api/cities', (req, res) => {
  const uf = cities.ufFromText(req.query.uf || '');
  if (!uf) return res.status(400).json({ error: 'Estado não encontrado.' });
  const list = cities.citiesOf(uf, Number(req.query.min) || 0);
  res.json({ uf, name: cities.STATE_NAMES[uf], total: list.length, cities: list });
});

// ─── Contatos ─────────────────────────────────────────────────────────────────
app.get('/api/leads', (req, res) => res.json({ ...leads.query(req.query), stats: leads.stats() }));

app.get('/api/leads.csv', (req, res) => {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="contatos-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(leads.toCsv(req.query));
});

app.patch('/api/leads/:id', (req, res) => {
  const lead = leads.update(req.params.id, { status: req.body?.status, notes: req.body?.notes });
  if (!lead) return res.status(404).json({ error: 'Contato não encontrado.' });
  res.json(lead);
});

app.post('/api/leads/:id/contacted', (req, res) => {
  const lead = leads.markContacted(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Contato não encontrado.' });
  res.json({ lead, stats: leads.stats() });
});

// ─── Busca no Google Maps ─────────────────────────────────────────────────────
app.post('/api/google/search', async (req, res) => {
  try {
    res.json(await google.run(req.body || {}));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ─── Importação da Receita Federal ───────────────────────────────────────────
app.get('/api/receita/status', (req, res) => res.json(receita.status()));
app.post('/api/receita/import', (req, res) => {
  try {
    res.json(receita.start(req.body || {}));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
app.post('/api/receita/cancel', (req, res) => res.json(receita.cancel()));

// ─── WhatsApp (QR Code) e envio automático ────────────────────────────────────
app.get('/api/whatsapp/status', (req, res) => res.json(whatsapp.status()));
app.post('/api/whatsapp/connect', async (req, res) => res.json(await whatsapp.start(Boolean(req.body?.forceNew), true)));
app.post('/api/whatsapp/logout', async (req, res) => {
  autosend.saveConfig({ enabled: false }); // sem WhatsApp, não faz sentido continuar ligado
  res.json(await whatsapp.logout());
});

function autosendPayload() {
  return {
    config: autosend.config(),
    status: autosend.describe(),
    limits: { minGapSeconds: 60, maxPerHour: autosend.LIMITS.MAX_PER_HOUR, maxPerDay: autosend.LIMITS.MAX_PER_DAY_CEILING },
    log: autosend.log().slice(-60).reverse(),
    replies: autosend.replies().slice(0, 40),
    whatsapp: whatsapp.status()
  };
}
app.get('/api/autosend', (req, res) => res.json(autosendPayload()));
app.put('/api/autosend', (req, res) => {
  const b = req.body || {};
  if (b.enabled === true && whatsapp.status().status !== 'connected') {
    return res.status(400).json({ error: 'Conecte o WhatsApp pelo QR Code antes de ligar o envio automático.' });
  }
  autosend.saveConfig(b);
  res.json(autosendPayload());
});

// Rotas só para os testes automáticos (WhatsApp simulado)
if (whatsapp.FAKE) {
  app.post('/api/test/wa/pair', (req, res) => { whatsapp.fake.pair(); res.json(whatsapp.status()); });
  app.post('/api/test/wa/incoming', async (req, res) => res.json({ lead: await whatsapp.fake.incoming(req.body.phone, req.body.text) }));
  app.get('/api/test/wa/sent', (req, res) => res.json(whatsapp.fake.sent));
  app.post('/api/test/wa/no-whatsapp', (req, res) => { whatsapp.fake.noWhatsApp.add(req.body.phone); res.json({ ok: true }); });
  app.post('/api/test/wa/fail', (req, res) => { whatsapp.fake.failNext = Number(req.body.n) || 0; res.json({ ok: true }); });
}

app.use((err, req, res, next) => {
  console.error('[erro]', err);
  res.status(500).json({ error: 'Erro interno.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🔎 CLINOVA Prospecção rodando na porta ${PORT}`);
  if (!process.env.ADMIN_PASSWORD) console.warn('⚠️  Defina ADMIN_PASSWORD para conseguir entrar.');
  if (!google.isConfigured()) console.warn('ℹ️  Sem GOOGLE_PLACES_API_KEY: a busca no Google fica desligada (a importação da Receita funciona).');
  whatsapp.autoStart();  // reconecta se já leu o QR antes
  autosend.start();      // motor de envio (só envia se estiver ligado na tela)
});
