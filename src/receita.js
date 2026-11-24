/**
 * Importação dos dados abertos de CNPJ da Receita Federal.
 *
 * Lê os arquivos oficiais (Estabelecimentos0..9.zip, ~vários GB no total) em sequência, sem gravar
 * em disco, e guarda só as empresas ATIVAS da UF/cidades e das atividades (CNAE) escolhidas.
 * Opcionalmente lê também Empresas0..9.zip para pegar a razão social de quem não tem nome fantasia.
 *
 * RECEITA_BASE_URL: pasta dos dados abertos (padrão abaixo). RECEITA_MES: força um mês (AAAA-MM).
 */
const { Readable } = require('stream');
const readline = require('readline');
const unzipper = require('unzipper');
const storage = require('./storage');
const leads = require('./leads');
const { BY_ID, BY_CNAE } = require('./segments');

const BASE = () => String(process.env.RECEITA_BASE_URL || 'https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj/').replace(/\/?$/, '/');
const PARTS = Number(process.env.RECEITA_PARTES) || 10;

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

async function latestMonth() {
  if (process.env.RECEITA_MES) return process.env.RECEITA_MES;
  const res = await fetch(BASE());
  if (!res.ok) throw new Error(`Não foi possível abrir ${BASE()} (HTTP ${res.status}).`);
  const html = await res.text();
  const months = [...html.matchAll(/href="(\d{4}-\d{2})\/?"/g)].map(m => m[1]).sort();
  if (!months.length) throw new Error('Não encontrei a pasta do mês mais recente nos dados abertos da Receita.');
  return months[months.length - 1];
}

/** Lê linha a linha o (único) CSV de dentro de um .zip baixado da Receita. */
async function eachLine(url, onLine) {
  const res = await fetch(url);
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
    filesTotal: 1 + PARTS + (withNames ? PARTS : 0), rowsScanned: 0, matched: 0, added: 0, merged: 0, skipped: 0,
    month: '', startedAt: new Date().toISOString(), finishedAt: null, error: null
  });

  (async () => {
    const month = await latestMonth();
    job.month = month;
    const dir = `${BASE()}${month}/`;

    // 1) Códigos das cidades (a Receita usa códigos próprios, não os do IBGE)
    job.step = 'Lendo a lista de municípios'; job.file = 'Municipios.zip';
    const codeToCity = new Map();
    await eachLine(`${dir}Municipios.zip`, f => {
      if (cities.includes(norm(f[1]))) codeToCity.set(f[0], leads.titleCase(f[1]));
    });
    job.filesDone++;
    if (!codeToCity.size) throw new Error(`Nenhuma das cidades foi encontrada na lista da Receita: ${cities.join(', ')}.`);

    // 2) Estabelecimentos ativos da UF/cidades com a atividade principal escolhida
    const found = [];
    for (let i = 0; i < PARTS; i++) {
      job.step = 'Procurando empresas (estabelecimentos)'; job.file = `Estabelecimentos${i}.zip`;
      await eachLine(`${dir}Estabelecimentos${i}.zip`, f => {
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
      for (let i = 0; i < PARTS && need.size; i++) {
        job.step = 'Buscando a razão social'; job.file = `Empresas${i}.zip`;
        await eachLine(`${dir}Empresas${i}.zip`, f => { if (need.has(f[0])) need.set(f[0], cleanCompanyName(f[1])); });
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
