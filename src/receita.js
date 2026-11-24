/**
 * Importação dos dados abertos de CNPJ da Receita Federal.
 *
 * Lê os arquivos oficiais (Estabelecimentos0..9.zip, ~vários GB no total) em sequência, sem gravar
 * em disco, e guarda só as empresas ATIVAS da UF/cidades e das atividades (CNAE) escolhidas.
 * Opcionalmente lê também Empresas0..9.zip para pegar a razão social de quem não tem nome fantasia.
 *
 * Desde 2025 a Receita publica os arquivos num compartilhamento público (Nextcloud/WebDAV).
 * O site descobre sozinho a pasta do mês mais recente (AAAA-MM) e os arquivos dentro dela.
 *
 * RECEITA_SHARE_URL: endereço do compartilhamento (padrão abaixo; funciona também com uma
 *   listagem HTML simples, como o endereço antigo). RECEITA_MES: força um mês (AAAA-MM).
 */
const { Readable } = require('stream');
const readline = require('readline');
const unzipper = require('unzipper');
const storage = require('./storage');
const leads = require('./leads');
const { BY_ID, BY_CNAE } = require('./segments');

const DEFAULT_SHARE = 'https://arquivos.receitafederal.gov.br/public.php/dav/files/YggdBLfdninEJX9/';
const ROOT = () => String(process.env.RECEITA_SHARE_URL || process.env.RECEITA_BASE_URL || DEFAULT_SHARE).replace(/\/?$/, '/');

const job = {
  running: false, cancelRequested: false, step: '', file: '', filesDone: 0, filesTotal: 0,
  rowsScanned: 0, matched: 0, added: 0, merged: 0, skipped: 0, month: '', startedAt: null, finishedAt: null, error: null
};
let current = null; // stream em leitura (para cancelar)

function status() { return { ...job }; }

function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim(); }

function parseLine(line) {
  const s = line.trim();
  if (!s) return null;
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).split('";"');
  return s.split(';').map(v => v.replace(/^"|"$/g, ''));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Compartilhamentos Nextcloud às vezes pedem o código do compartilhamento como usuário (sem senha).
// Só é usado se o servidor responder 401 sem ele.
let useShareAuth = false;
function shareAuth(url) {
  const token = (String(url).match(/\/public\.php\/(?:dav\/files|webdav)\/?([A-Za-z0-9]+)?/) || [])[1] ||
    (String(ROOT()).match(/\/dav\/files\/([A-Za-z0-9]+)\//) || [])[1];
  return useShareAuth && token ? { Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}` } : {};
}
async function shareFetch(url, opts = {}) {
  let res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), ...shareAuth(url) } });
  if (res.status === 401 && !useShareAuth) {
    useShareAuth = true;
    res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), ...shareAuth(url) } });
  }
  return res;
}

/**
 * Lista uma pasta. Tenta WebDAV (PROPFIND, usado pelo compartilhamento da Receita) e, se o
 * servidor não entender, lê uma listagem HTML comum. Devolve [{ name, url, isDir }].
 * O servidor da Receita às vezes responde vazio: tenta de novo algumas vezes.
 */
async function listDir(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await shareFetch(url, {
        method: 'PROPFIND',
        headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
        body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>'
      });
      const text = await res.text();
      let entries = [];
      if (res.status === 207 || /<(\w+:)?multistatus/i.test(text)) {
        for (const block of text.match(/<(\w+:)?response\b[\s\S]*?<\/(\w+:)?response>/gi) || []) {
          const href = (block.match(/<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/i) || [])[1];
          if (!href) continue;
          const abs = new URL(href.trim(), url).href;
          if (abs.replace(/\/$/, '') === url.replace(/\/$/, '')) continue; // a própria pasta
          const isDir = /<(\w+:)?collection\s*\/?>/i.test(block) || abs.endsWith('/');
          const name = decodeURIComponent(abs.replace(/\/$/, '').split('/').pop());
          entries.push({ name, url: isDir ? abs.replace(/\/?$/, '/') : abs, isDir });
        }
      } else {
        // Listagem HTML (ex.: servidor que não fala WebDAV): usa os links da página
        const html = res.ok ? text : await (await shareFetch(url)).text();
        for (const m of html.matchAll(/href="([^"?#]+)"/gi)) {
          const href = m[1];
          if (href.startsWith('..') || href === '/' || /^[a-z]+:/i.test(href) && !href.startsWith(url)) continue;
          const abs = new URL(href, url).href;
          if (!abs.startsWith(url) || abs === url) continue;
          const isDir = abs.endsWith('/');
          entries.push({ name: decodeURIComponent(abs.replace(/\/$/, '').split('/').pop()), url: abs, isDir });
        }
      }
      if (entries.length) return entries;
      lastError = new Error(`resposta vazia (HTTP ${res.status})`);
    } catch (e) {
      lastError = e;
    }
    await sleep(1500 * attempt);
  }
  throw new Error(`Não foi possível listar ${url} (${lastError ? lastError.message : 'sem resposta'}).`);
}

function pickFiles(entries) {
  const files = entries.filter(e => !e.isDir);
  const num = (n) => Number((n.match(/(\d+)\.zip$/i) || [])[1] || 0);
  return {
    municipios: files.find(f => /^munic\w*\.zip$/i.test(f.name)),
    estabelecimentos: files.filter(f => /^estabelecimentos?\d*\.zip$/i.test(f.name)).sort((a, b) => num(a.name) - num(b.name)),
    empresas: files.filter(f => /^empresas?\d*\.zip$/i.test(f.name)).sort((a, b) => num(a.name) - num(b.name))
  };
}

/**
 * Procura (até 4 níveis abaixo do endereço) a pasta do mês mais recente que já tenha
 * todos os arquivos (Municípios + Estabelecimentos). Devolve { month, municipios, estabelecimentos, empresas }.
 */
async function discover() {
  const root = ROOT();
  const seenAtRoot = [];
  const queue = [{ url: root, depth: 0 }];
  while (queue.length) {
    const { url, depth } = queue.shift();
    const entries = await listDir(url);
    if (depth === 0) seenAtRoot.push(...entries.map(e => e.name + (e.isDir ? '/' : '')));

    // Arquivos direto nesta pasta (sem pastas por mês)
    const direct = pickFiles(entries);
    if (direct.municipios && direct.estabelecimentos.length) return { month: '', ...direct };

    const months = entries.filter(e => e.isDir && /^\d{4}-\d{2}$/.test(e.name)).sort((a, b) => b.name.localeCompare(a.name));
    const wanted = process.env.RECEITA_MES ? months.filter(m => m.name === process.env.RECEITA_MES) : months;
    for (const m of wanted.slice(0, 3)) { // o mês mais novo pode estar sendo publicado ainda: tenta os anteriores
      const files = pickFiles(await listDir(m.url));
      if (files.municipios && files.estabelecimentos.length) return { month: m.name, ...files };
    }
    if (months.length) break;

    if (depth < 4) {
      const dirs = entries.filter(e => e.isDir);
      const relevant = dirs.filter(d => /dados|cadastr|cnpj/i.test(d.name));
      for (const d of (relevant.length ? relevant : dirs.length <= 15 ? dirs : [])) queue.push({ url: d.url, depth: depth + 1 });
    }
  }
  throw new Error(`Não encontrei os arquivos de CNPJ no endereço da Receita (${root}). Itens encontrados: ${seenAtRoot.slice(0, 15).join(', ') || 'nenhum'}. A Receita pode ter mudado o local dos arquivos.`);
}

/** Lê linha a linha o (único) CSV de dentro de um .zip baixado da Receita. */
async function eachLine(url, onLine) {
  const res = await shareFetch(url);
  if (!res.ok || !res.body) throw new Error(`Falha ao baixar ${url.split('/').pop()} (HTTP ${res.status}).`);
  const csv = Readable.fromWeb(res.body).pipe(unzipper.ParseOne());
  csv.setEncoding('latin1'); // os arquivos da Receita são ISO-8859-1
  current = csv;
  const rl = readline.createInterface({ input: csv, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (job.cancelRequested) throw new Error('Importação cancelada.');
      const f = parseLine(line);
      if (f) onLine(f);
    }
  } finally {
    rl.close();
    csv.destroy();
    current = null;
  }
}

function cleanCompanyName(razao) {
  // MEI costuma ter o CPF no fim da razão social ("MARIA SILVA 12345678901")
  return leads.titleCase(String(razao || '').replace(/\s*\d{11}\s*$/, '').replace(/\s*\d{3}\.?\d{3}\.?\d{3}-?\d{2}\s*$/, ''));
}

/**
 * Inicia a importação em segundo plano.
 * opts: { uf: 'MG', cities: ['BELO HORIZONTE', ...], segments: ['odontologia', ...], withNames: true }
 */
function start(opts = {}) {
  if (job.running) throw Object.assign(new Error('Já existe uma importação em andamento.'), { status: 409 });
  const uf = norm(opts.uf || 'MG').slice(0, 2);
  const cities = (opts.cities || []).map(norm).filter(Boolean);
  const segs = (opts.segments || []).filter(s => BY_ID[s]);
  if (!cities.length || !segs.length) throw Object.assign(new Error('Escolha ao menos uma cidade e um segmento.'), { status: 400 });
  const cnaes = new Set(segs.flatMap(s => BY_ID[s].cnaes));
  const withNames = opts.withNames !== false;

  Object.assign(job, {
    running: true, cancelRequested: false, step: 'Procurando os arquivos mais recentes', file: '', filesDone: 0,
    filesTotal: 0, rowsScanned: 0, matched: 0, added: 0, merged: 0, skipped: 0,
    month: '', startedAt: new Date().toISOString(), finishedAt: null, error: null
  });

  (async () => {
    const share = await discover();
    job.month = share.month;
    job.filesTotal = 1 + share.estabelecimentos.length + (withNames ? share.empresas.length : 0);

    // 1) Códigos das cidades (a Receita usa códigos próprios, não os do IBGE)
    job.step = 'Lendo a lista de municípios'; job.file = 'Municipios.zip';
    const codeToCity = new Map();
    await eachLine(share.municipios.url, f => {
      if (cities.includes(norm(f[1]))) codeToCity.set(f[0], leads.titleCase(f[1]));
    });
    job.filesDone++;
    if (!codeToCity.size) throw new Error(`Nenhuma das cidades foi encontrada na lista da Receita: ${cities.join(', ')}.`);

    // 2) Estabelecimentos ativos da UF/cidades com a atividade principal escolhida
    const found = [];
    for (const file of share.estabelecimentos) {
      job.step = 'Procurando empresas (estabelecimentos)'; job.file = file.name;
      await eachLine(file.url, f => {
        job.rowsScanned++;
        if (f[5] !== '02' || f[19] !== uf || !codeToCity.has(f[20]) || !cnaes.has(f[11])) return;
        job.matched++;
        const addr = [[f[13], f[14]].filter(Boolean).join(' '), f[15], f[16]].filter(Boolean).join(', ');
        found.push({
          source: 'receita',
          segment: BY_CNAE[f[11]],
          cnpj: `${f[0]}${f[1]}${f[2]}`,
          basico: f[0],
          name: f[4] ? leads.titleCase(f[4]) : '',
          phone: `${f[21] || ''}${f[22] || ''}`,
          phone2: `${f[23] || ''}${f[24] || ''}`,
          email: String(f[27] || '').toLowerCase(),
          address: leads.titleCase(addr),
          bairro: leads.titleCase(f[17]),
          city: codeToCity.get(f[20]),
          uf
        });
      });
      job.filesDone++;
    }

    // 3) Razão social para quem não tem nome fantasia
    if (withNames) {
      const need = new Map(found.filter(l => !l.name).map(l => [l.basico, null]));
      for (const file of share.empresas) {
        if (!need.size) break;
        job.step = 'Buscando a razão social'; job.file = file.name;
        await eachLine(file.url, f => { if (need.has(f[0])) need.set(f[0], cleanCompanyName(f[1])); });
        job.filesDone++;
      }
      for (const l of found) if (!l.name) l.name = need.get(l.basico) || '';
    }

    // 4) Junta com os contatos que você já tem (mesmo telefone, CNPJ ou empresa do Google)
    job.step = 'Salvando os contatos'; job.file = '';
    await storage.withLock('leads', async () => {
      const index = leads.buildIndex();
      for (const l of found) {
        if (!l.name) l.name = `CNPJ ${l.cnpj}`;
        delete l.basico;
        job[leads.upsert(l, index)]++;
      }
      storage.save('leads');
    });
    job.step = 'Concluído';
  })().catch(err => {
    job.error = err.message;
    job.step = job.cancelRequested ? 'Cancelada' : 'Falhou';
  }).finally(() => {
    job.running = false;
    job.finishedAt = new Date().toISOString();
  });

  return status();
}

function cancel() {
  if (!job.running) return status();
  job.cancelRequested = true;
  try { current && current.destroy(new Error('Importação cancelada.')); } catch (e) { /* ignore */ }
  return status();
}

module.exports = { start, cancel, status, parseLine, cleanCompanyName };
