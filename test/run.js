/**
 * Testes de ponta a ponta com o Google e a Receita SIMULADOS (sem internet e sem custo).
 * Rode com: npm test
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'prosp-test-'));
const PORT_APP = 4700, PORT_PLACES = 4600, PORT_RF = 4601;
const PASSWORD = 'senha-de-teste-123';
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : ' ' + extra}`); };

// ─── Google Places simulado ──────────────────────────────────────────────────
let placesCalls = 0;
const placesQueries = [];
function place(id, name, phone, extra = {}) {
  return {
    id, displayName: { text: name }, nationalPhoneNumber: phone, formattedAddress: `Rua ${name}, 10 - Savassi, Belo Horizonte - MG`,
    addressComponents: [
      { longText: 'Savassi', types: ['sublocality_level_1', 'sublocality'] },
      { longText: 'Belo Horizonte', types: ['administrative_area_level_2'] },
      { longText: 'Minas Gerais', shortText: 'MG', types: ['administrative_area_level_1'] }
    ],
    rating: 4.8, userRatingCount: 120, googleMapsUri: `https://maps.google.com/?cid=${id}`, businessStatus: 'OPERATIONAL', ...extra
  };
}
const placesServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    placesCalls++;
    if (req.headers['x-goog-api-key'] !== 'chave-teste' || !String(req.headers['x-goog-fieldmask']).includes('places.nationalPhoneNumber')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'API key inválida' } }));
    }
    const q = JSON.parse(body);
    placesQueries.push(q.textQuery);
    let places = [], next = null;
    if (q.textQuery.startsWith('dentista em Savassi')) {
      if (!q.pageToken) {
        places = Array.from({ length: 20 }, (_, i) => place(`d${i}`, `Odonto ${i}`, `(31) 9${String(8000000 + i).padStart(8, '0')}`));
        next = 'pagina2';
      } else {
        places = [
          place('d20', 'Odonto <img src=x onerror=alert(1)>', '(31) 98888-7777'), // nome malicioso
          place('d21', 'Clínica Fechada', '(31) 97777-1111', { businessStatus: 'CLOSED_PERMANENTLY' }),
          place('d22', 'Sem Telefone', ''),
          place('d23', 'Consultório Fixo', '(31) 3222-1111'),
          place('d0', 'Odonto 0 (repetido)', '(31) 98000-0000') // mesmo placeId da página 1
        ];
      }
    } else if (q.textQuery.startsWith('nutricionista em Lourdes')) {
      places = [
        place('s1', 'Nutri Site Próprio', '(31) 97000-0001', { websiteUri: 'https://nutrisite.com.br' }),
        place('s2', 'Nutri Instagram', '(31) 97000-0002', { websiteUri: 'https://www.instagram.com/nutri' }),
        place('s3', 'Nutri Doctoralia', '(31) 97000-0003', { websiteUri: 'https://www.doctoralia.com.br/nutri' }),
        place('s4', 'Nutri Sem Site', '(31) 97000-0004', { userRatingCount: 50, rating: 4.9 })
      ];
    } else if (q.textQuery.startsWith('clínica odontológica em Savassi')) {
      places = [place('d0', 'Odonto 0', '(31) 98000-0000'), place('o1', 'Mesmo telefone outro id', '(31) 98000-0001')];
    } else {
      places = [place(`x-${q.textQuery}`, `Lugar ${q.textQuery}`, '(31) 99111-2222')];
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ places, ...(next ? { nextPageToken: next } : {}) }));
  });
});

// ─── Receita Federal simulada ────────────────────────────────────────────────
const RF_DIR = path.join(TMP, 'rf');
function makeZip(file, inner, lines) {
  const csv = path.join(TMP, `${inner}.tmp`);
  fs.writeFileSync(csv, Buffer.from(lines.map(l => l.map(v => `"${v}"`).join(';')).join('\n') + '\n', 'latin1'));
  execFileSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED); z.write(sys.argv[2], sys.argv[3]); z.close()', file, csv, inner]);
}
function est({ basico, ordem = '0001', dv = '10', fantasia = '', sit = '02', cnae, uf = 'MG', mun, ddd1 = '31', tel1 = '', ddd2 = '', tel2 = '', email = '', bairro = 'CENTRO' }) {
  return [basico, ordem, dv, '1', fantasia, sit, '20200101', '00', '', '', '20200101', cnae, '', 'RUA', 'DA BAHIA', '100', 'SALA 2',
    bairro, '30160011', uf, mun, ddd1, tel1, ddd2, tel2, '', '', email, '', ''];
}
// Estrutura igual à do compartilhamento da Receita: pastas aninhadas e uma pasta por mês.
// 2025-11 ainda está sendo publicado (sem arquivos): deve usar 2025-10.
const SHARE = '/public.php/dav/files/TOKENTESTE/';
const CNPJ_DIR = path.join(RF_DIR, 'Dados', 'Cadastros', 'CNPJ');
function buildReceita() {
  const month = path.join(CNPJ_DIR, '2025-10');
  fs.mkdirSync(month, { recursive: true });
  fs.mkdirSync(path.join(CNPJ_DIR, '2025-09'), { recursive: true });
  fs.mkdirSync(path.join(CNPJ_DIR, '2025-11'), { recursive: true });
  fs.mkdirSync(path.join(RF_DIR, 'Dados', 'Outros'), { recursive: true });
  fs.writeFileSync(path.join(CNPJ_DIR, '2025-11', 'LEIAME.txt'), 'em publicação');
  makeZip(path.join(month, 'Municipios.zip'), 'MUNICCSV', [['4123', 'BELO HORIZONTE'], ['4305', 'CONTAGEM'], ['7107', 'SAO PAULO'], ['9999', 'SANTA LUZIA']]);
  makeZip(path.join(month, 'Estabelecimentos0.zip'), 'ESTABELE0', [
    est({ basico: '11111111', fantasia: 'ODONTO SAVASSI', cnae: '8630504', mun: '4123', tel1: '908000000', email: 'CONTATO@ODONTO.COM.BR' }), // = Google d0 (merge)
    est({ basico: '22222222', fantasia: 'SORRISO FECHADO', sit: '08', cnae: '8630504', mun: '4123', tel1: '991110000' }), // baixada
    est({ basico: '33333333', fantasia: 'DENTISTA SP', cnae: '8630504', uf: 'SP', mun: '7107', ddd1: '11', tel1: '991112222' }) // outro estado
  ]);
  makeZip(path.join(month, 'Estabelecimentos1.zip'), 'ESTABELE1', [
    est({ basico: '44444444', fantasia: '', cnae: '9609208', mun: '4305', tel1: '32225555', ddd2: '31', tel2: '997776666', bairro: 'ELDORADO' }), // pet sem fantasia
    est({ basico: '55555555', fantasia: 'PADARIA', cnae: '1091102', mun: '4123', tel1: '993334444' }), // atividade fora
    est({ basico: '66666666', fantasia: 'PSICÓLOGA ÂNGELA', cnae: '8650003', mun: '4123', tel1: '32334455' }) // só fixo, com acento
  ]);
  makeZip(path.join(month, 'Empresas0.zip'), 'EMPRECSV0', [['44444444', 'MARIA SOUZA 12345678901', '2135', '50', '0,00', '01', '']]);
  makeZip(path.join(month, 'Empresas1.zip'), 'EMPRECSV1', [['66666666', 'ANGELA LIMA', '2135', '50', '0,00', '01', '']]);
}
let rfPropfinds = 0;
const rfServer = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (!url.startsWith(SHARE)) { res.writeHead(404); return res.end(); }
  const rel = url.slice(SHARE.length);
  const file = path.join(RF_DIR, rel);
  if (!file.startsWith(RF_DIR) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  if (req.method === 'PROPFIND') {
    rfPropfinds++;
    if (rfPropfinds === 1) { res.writeHead(200); return res.end(); } // o servidor real às vezes responde vazio
    if (!fs.statSync(file).isDirectory()) { res.writeHead(207); return res.end('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>'); }
    const self = SHARE + (rel ? rel.replace(/\/?$/, '/') : '');
    const items = [`<d:response><d:href>${encodeURI(self)}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>`];
    for (const name of fs.readdirSync(file)) {
      const dir = fs.statSync(path.join(file, name)).isDirectory();
      items.push(`<d:response><d:href>${encodeURI(self + name + (dir ? '/' : ''))}</d:href><d:propstat><d:prop><d:resourcetype>${dir ? '<d:collection/>' : ''}</d:resourcetype></d:prop></d:propstat></d:response>`);
    }
    res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
    return res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${items.join('')}</d:multistatus>`);
  }
  if (fs.statSync(file).isDirectory()) { res.writeHead(405); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'application/zip' });
  fs.createReadStream(file).pipe(res);
});

// ─── App ─────────────────────────────────────────────────────────────────────
let cookie = '';
async function call(method, p, body, headers = {}) {
  const res = await fetch(`http://localhost:${PORT_APP}${p}`, {
    method, redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  // Lê os bytes crus (res.text() removeria o BOM do CSV)
  const text = Buffer.from(await res.arrayBuffer()).toString('utf8');
  let json = null; try { json = JSON.parse(text); } catch (e) { /* texto */ }
  return { s: res.status, json, text, headers: res.headers };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  buildReceita();
  await new Promise(r => placesServer.listen(PORT_PLACES, r));
  await new Promise(r => rfServer.listen(PORT_RF, r));
  const app = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT_APP), DATA_DIR: path.join(TMP, 'data'), ADMIN_PASSWORD: PASSWORD,
      GOOGLE_PLACES_API_KEY: 'chave-teste', PLACES_API_URL: `http://localhost:${PORT_PLACES}/v1/places:searchText`,
      RECEITA_SHARE_URL: `http://localhost:${PORT_RF}${SHARE}`, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let appLog = ''; app.stdout.on('data', d => { appLog += d; }); app.stderr.on('data', d => { appLog += d; });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${PORT_APP}/api/health`); break; } catch (e) { await sleep(100); } }

  try {
    // Acesso
    let r = await call('GET', '/api/leads');
    check('sem login: API bloqueada (401)', r.s === 401, r.s);
    r = await call('GET', '/');
    check('sem login: página redireciona para /login', r.s === 302 && r.headers.get('location') === '/login', r.s);
    r = await call('POST', '/api/login', { password: 'errada' });
    check('senha errada recusada', r.s === 401, r.s);
    r = await call('POST', '/api/login', { password: PASSWORD });
    cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    check('login com a senha certa', r.s === 200 && cookie.startsWith('prosp_sessao='), r.s);
    check('cookie é httpOnly e sameSite', /HttpOnly/i.test(r.headers.get('set-cookie')) && /SameSite=Strict/i.test(r.headers.get('set-cookie')));
    r = await call('GET', '/api/leads', null, { Cookie: 'prosp_sessao=9999999999999.assinatura-falsa' });
    check('cookie forjado recusado', r.s === 401, r.s);
    r = await call('GET', '/');
    check('com login: página principal abre', r.s === 200 && r.text.includes('CLINOVA'), r.s);

    // Google
    r = await call('POST', '/api/google/search', { segments: ['odontologia'], areas: ['Savassi, Belo Horizonte'], maxCalls: 40 });
    const g = r.json || {};
    check('Google: busca roda', r.s === 200, JSON.stringify(r.json));
    check('Google: paginação (2 páginas na 1ª busca)', g.calls === 4, `calls=${g.calls}`); // dentista: 2 páginas + clínica odontológica: 1 + ortodontista: 1
    check('Google: ignora fechados e sem telefone', g.closed === 1 && g.skipped === 1, JSON.stringify(g));
    check('Google: junta repetidos (mesmo id/telefone)', g.merged === 2, JSON.stringify(g));
    r = await call('GET', '/api/leads?pageSize=200');
    const all = r.json.items;
    check('Google: 24 contatos únicos', r.json.total === 24, r.json.total);
    const fixo = all.find(l => l.name === 'Consultório Fixo');
    check('Google: fixo marcado como não-celular', fixo && fixo.mobile === false && fixo.phone === '3132221111', JSON.stringify(fixo));
    const d0 = all.find(l => l.placeId === 'd0');
    check('Google: bairro/cidade/nota preenchidos', d0 && d0.bairro === 'Savassi' && d0.city === 'Belo Horizonte' && d0.rating === 4.8, JSON.stringify(d0));
    const calls1 = placesCalls;
    r = await call('POST', '/api/google/search', { segments: ['odontologia'], areas: ['Savassi, Belo Horizonte'] });
    check('Google: busca repetida não gasta cota', placesCalls === calls1 && r.json.calls === 0, `${placesCalls} vs ${calls1}`);
    r = await call('POST', '/api/google/search', { segments: ['psicologia'], areas: ['Sion, Belo Horizonte', 'Serra, Belo Horizonte'], maxCalls: 1 });
    check('Google: respeita o limite e informa o que falta', r.json.calls === 1 && r.json.queriesLeft === 3, JSON.stringify(r.json));

    // Inteligência: quem tem site próprio ou usa plataforma de agendamento não entra
    r = await call('POST', '/api/google/search', { segments: ['nutricao'], areas: ['Lourdes, Belo Horizonte'] });
    check('Google: guarda só quem não tem site próprio', r.json.added === 2 && r.json.withSite === 2, JSON.stringify(r.json));
    r = await call('GET', '/api/leads?q=Nutri&pageSize=50');
    const nutri = Object.fromEntries(r.json.items.map(l => [l.name, l.intel]));
    check('Inteligência: "Sem site" e "Só Instagram" classificados', nutri['Nutri Sem Site']?.site.kind === 'nenhum' && nutri['Nutri Instagram']?.site.kind === 'social', JSON.stringify(nutri));
    check('Inteligência: sem site + celular + bem avaliado = prioridade alta', nutri['Nutri Sem Site']?.level === 'alta' && nutri['Nutri Sem Site'].reasons.includes('Sem site'), JSON.stringify(nutri['Nutri Sem Site']));
    r = await call('POST', '/api/google/search', { segments: ['nutricao'], areas: ['Lourdes, Belo Horizonte'], redo: true, onlyWithoutSite: false });
    check('Google: com a opção desligada, guarda também quem tem site', r.json.added === 2, JSON.stringify(r.json));
    r = await call('GET', '/api/leads?site=agendamento');
    check('Filtro: "já usa plataforma de agendamento"', r.json.total === 1 && r.json.items[0].intel.site.label === 'Usa Doctoralia', JSON.stringify(r.json.items.map(i => i.intel.site)));
    r = await call('GET', '/api/leads?site=sem&pageSize=200');
    check('Filtro: "sem site próprio"', r.json.items.length > 0 && r.json.items.every(l => ['nenhum', 'social'].includes(l.intel.site.kind)));
    r = await call('GET', '/api/leads?q=Nutri&pageSize=50');
    check('Lista ordenada pela prioridade', r.json.items[0].name === 'Nutri Sem Site' && r.json.items[r.json.items.length - 1].name === 'Nutri Doctoralia', r.json.items.map(i => i.name).join(', '));
    r = await call('GET', '/api/leads?priority=alta&pageSize=200');
    check('Filtro por prioridade', r.json.items.every(l => l.intel.level === 'alta'));
    r = await call('GET', '/api/leads?state=MG&pageSize=10');
    check('Filtro por estado (MG) e contagem por estado', r.json.total === r.json.stats.total && r.json.stats.byState.MG === r.json.stats.total, `${r.json.total} ${JSON.stringify(r.json.stats.byState)}`);
    r = await call('GET', '/api/leads?state=SC');
    check('Filtro por estado sem contatos', r.json.total === 0);
    check('Indicadores: "sem site próprio" e prioridade', typeof r.json.stats.noSite === 'number' && r.json.stats.bySite.agendamento === 1 && r.json.stats.byPriority.alta > 0, JSON.stringify(r.json.stats.bySite));

    // Andamento
    const target = all.find(l => l.mobile);
    r = await call('POST', `/api/leads/${target.id}/contacted`);
    check('WhatsApp: marca "mensagem enviada" e conta no dia', r.json.lead.status === 'contatado' && r.json.stats.contactedToday === 1, JSON.stringify(r.json.lead));
    r = await call('PATCH', `/api/leads/${target.id}`, { status: 'sem_interesse', notes: 'Pediu para não mandar mais.' });
    check('Status e notas salvos', r.json.status === 'sem_interesse' && r.json.notes.includes('não mandar'), JSON.stringify(r.json));
    r = await call('POST', `/api/leads/${target.id}/contacted`);
    check('Quem pediu para sair não volta para "enviada"', r.json.lead.status === 'sem_interesse');
    r = await call('GET', '/api/leads?status=fila&pageSize=200');
    check('Fila só tem novos com celular', r.json.items.every(l => l.status === 'novo' && l.mobile), r.json.total);

    // Receita
    r = await call('POST', '/api/receita/import', { uf: 'MG', cities: ['Belo Horizonte', 'Contagem'], segments: ['odontologia', 'petshop', 'psicologia'], withNames: true });
    check('Receita: importação iniciada', r.s === 200 && r.json.running, JSON.stringify(r.json));
    r = await call('POST', '/api/receita/import', { uf: 'MG', cities: ['Belo Horizonte'], segments: ['odontologia'] });
    check('Receita: não deixa rodar duas ao mesmo tempo', r.s === 409, r.s);
    let st;
    for (let i = 0; i < 100; i++) { st = (await call('GET', '/api/receita/status')).json; if (!st.running) break; await sleep(100); }
    check('Receita: concluída sem erro', st.step === 'Concluído' && !st.error, JSON.stringify(st));
    check('Receita: acha a pasta do mês no compartilhamento (WebDAV) e pula o mês incompleto', st.month === '2025-10' && st.filesTotal === 5, `${st.month} ${st.filesTotal}`);
    check('Receita: tenta de novo quando o servidor responde vazio', rfPropfinds > 3, rfPropfinds);
    check('Receita: só ativas, da UF, cidades e atividades certas (3 de 6)', st.matched === 3, JSON.stringify(st));
    check('Receita: 2 novos + 1 juntado com o Google', st.added === 2 && st.merged === 1, JSON.stringify(st));
    r = await call('GET', '/api/leads?pageSize=200&q=');
    const leads = r.json.items;
    const merged = leads.find(l => l.placeId === 'd0');
    check('Junção: contato do Google ganhou CNPJ e e-mail da Receita', merged.cnpj === '11111111000110' && merged.email === 'contato@odonto.com.br' && merged.sources.includes('receita'), JSON.stringify(merged));
    const pet = leads.find(l => l.cnpj === '44444444000110');
    check('Receita: sem nome fantasia usa a razão social (sem o CPF)', pet && pet.name === 'Maria Souza' && pet.segment === 'petshop', JSON.stringify(pet));
    check('Receita: celular do 2º telefone vira o principal', pet && pet.phone === '31997776666' && pet.mobile && pet.phone2 === '3132225555', JSON.stringify(pet));
    const psi = leads.find(l => l.cnpj === '66666666000110');
    check('Receita: acentos corretos (latin1)', psi && psi.name === 'Psicóloga Ângela' && psi.city === 'Belo Horizonte', JSON.stringify(psi));
    check('Receita: baixada, outro estado e outra atividade ficaram de fora', !leads.some(l => ['22222222000110', '33333333000110', '55555555000110'].includes(l.cnpj)));
    r = await call('GET', '/api/leads?source=receita&city=Contagem');
    check('Filtros por fonte e cidade', r.json.total === 1 && r.json.items[0].name === 'Maria Souza', r.json.total);
    r = await call('GET', '/api/leads?q=11111111');
    check('Busca por CNPJ', r.json.total === 1, r.json.total);

    // Estado inteiro
    r = await call('GET', '/api/cities?uf=MG&min=50000');
    check('Cidades de MG com 50 mil+ (IBGE 2022): 72, BH primeiro', r.json.total === 72 && r.json.cities[0].name === 'Belo Horizonte' && r.json.cities[0].pop === 2315560, JSON.stringify(r.json).slice(0, 120));
    r = await call('GET', '/api/config');
    check('Lista dos 27 estados na tela', r.json.states.length === 27 && r.json.states.find(x => x.uf === 'MG').cities === 853);
    placesQueries.length = 0;
    r = await call('POST', '/api/google/search', { segments: ['psicologia'], areas: ['MG'], minPopulation: 500000, maxCalls: 50 });
    const expected = ['Belo Horizonte', 'Uberlândia', 'Contagem', 'Juiz de Fora'].flatMap(c => [`psicólogo em ${c}, MG`, `clínica de psicologia em ${c}, MG`]);
    check('Google: "MG" vira as cidades do estado (500 mil+)', expected.every(q => placesQueries.includes(q)) && placesQueries.length === 8, JSON.stringify(placesQueries));
    placesQueries.length = 0;
    r = await call('POST', '/api/google/search', { segments: ['nutricao'], areas: ['São Paulo'], maxCalls: 5 });
    check('Google: "São Paulo" sozinho é a cidade, não o estado', placesQueries.length === 1 && placesQueries[0] === 'nutricionista em São Paulo', JSON.stringify(placesQueries));
    r = await call('POST', '/api/receita/import', { uf: 'MG', cities: [], segments: ['odontologia', 'petshop', 'psicologia'], withNames: false });
    for (let i = 0; i < 100; i++) { st = (await call('GET', '/api/receita/status')).json; if (!st.running) break; await sleep(100); }
    check('Receita: cidades vazias = estado inteiro', st.step === 'Concluído' && st.matched === 3 && !st.error, JSON.stringify(st));

    // Planilha
    r = await call('GET', '/api/leads.csv');
    check('Planilha: BOM + cabeçalho com prioridade + linhas', r.text.charCodeAt(0) === 0xFEFF && r.text.includes('"Prioridade";"Nota";"Site";"Motivos";"Nome"') && r.text.split('\r\n').length === 31, r.text.split('\r\n').length);
    check('Planilha: nome perigoso exportado como texto', r.text.includes('Odonto <img src=x onerror=alert(1)>') && !/;"=/.test(r.text));

    // Configurações
    r = await call('PUT', '/api/settings', { senderName: 'Gabriel', dailyLimit: 30, templates: { pet: 'Oi {nome}, aqui é {seunome}' } });
    check('Configurações salvas', r.json.senderName === 'Gabriel' && r.json.dailyLimit === 30 && r.json.templates.pet.includes('{seunome}') && r.json.templates.saude.length > 50);

    // Proteção de força bruta no login
    cookie = '';
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await call('POST', '/api/login', { password: 'x' })).s;
    check('Login: bloqueia muitas tentativas (429)', last === 429, last);

    // Persistência
    app.kill('SIGTERM'); await sleep(500);
    const saved = JSON.parse(fs.readFileSync(path.join(TMP, 'data', 'leads.json'), 'utf8'));
    check('Dados gravados em disco ao desligar', saved.length === 30, saved.length);
  } catch (e) {
    fail++; console.log('FAIL erro inesperado:', e);
  } finally {
    app.kill('SIGTERM');
    placesServer.close(); rfServer.close();
    if (fail) console.log('\n--- log do servidor ---\n' + appLog.slice(-3000));
    console.log(`\n${pass} ok, ${fail} falhas`);
    fs.rmSync(TMP, { recursive: true, force: true });
    process.exit(fail ? 1 : 0);
  }
})();
