/**
 * Testes do envio automático com WhatsApp SIMULADO e tempo acelerado (600x):
 * 1 minuto = 0,1 s · 1 hora = 6 s. Rode com: npm test
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'prosp-wa-'));
const DATA = path.join(TMP, 'data');
const PORT = 4720;
const PASSWORD = 'senha-de-teste-123';
const SCALE = 600;
const MIN_GAP = 60000 / SCALE;
const HOUR = 3600000 / SCALE;
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : ' ' + extra}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Contatos de exemplo
function lead(i, extra = {}) {
  const now = new Date().toISOString();
  return {
    id: `lead-${i}`, name: `Empresa ${i}`, segment: i % 4 === 0 ? 'petshop' : 'odontologia',
    phone: `319${String(80000000 + i)}`, phone2: '', mobile: true, email: '', address: '', bairro: 'Centro',
    city: i % 5 === 0 ? 'Contagem' : 'Belo Horizonte', uf: 'MG', website: '', mapsUrl: '', rating: 4.5,
    ratingCount: 1000 - i, cnpj: '', placeId: `p${i}`, sources: ['google'], status: 'novo', notes: '',
    contactedAt: null, history: [], createdAt: now, updatedAt: now, ...extra
  };
}
fs.mkdirSync(DATA, { recursive: true });
const seed = [];
for (let i = 1; i <= 45; i++) seed.push(lead(i));
seed.push(lead(100, { phone: '3132221111', mobile: false, name: 'Fixo' }));
seed.push(lead(101, { status: 'sem_interesse', name: 'Pediu para sair', ratingCount: 99999 }));
seed.push(lead(102, { status: 'contatado', contactedAt: new Date().toISOString(), name: 'Já abordado', ratingCount: 99998 }));
seed.push(lead(103, { name: 'Tem site próprio', website: 'https://clinicapropria.com.br', ratingCount: 99997 }));
// Contatos de Santa Catarina (no fim da fila: menos avaliações), com a UF escrita de jeitos diferentes
seed.push(lead(104, { name: 'SC sigla', uf: 'SC', city: 'Joinville', ratingCount: 1 }));
seed.push(lead(105, { name: 'SC por extenso', uf: 'Santa Catarina', city: 'Blumenau', ratingCount: 1 }));
seed.push(lead(106, { name: 'SC no endereço', uf: '', city: 'Itajaí', address: 'Rua X, 10 - Centro, Itajaí - SC, 88301-000, Brasil', ratingCount: 1 }));
fs.writeFileSync(path.join(DATA, 'leads.json'), JSON.stringify(seed));
fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({ senderName: 'Gabriel' }));

let cookie = '';
async function call(method, p, body) {
  const res = await fetch(`http://localhost:${PORT}${p}`, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => null);
  return { s: res.status, json, headers: res.headers };
}
const leadsNow = async () => (await call('GET', '/api/leads?pageSize=200')).json.items;
const sent = async () => (await call('GET', '/api/test/wa/sent')).json;

(async () => {
  const app = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, ADMIN_PASSWORD: PASSWORD, NODE_ENV: 'test', WHATSAPP_FAKE: '1', AUTOSEND_FAST: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let appLog = ''; app.stdout.on('data', d => { appLog += d; }); app.stderr.on('data', d => { appLog += d; });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${PORT}/api/health`); break; } catch (e) { await sleep(100); } }

  try {
    let r = await call('GET', '/api/autosend');
    check('sem login: bloqueado', r.s === 401, r.s);
    r = await call('POST', '/api/login', { password: PASSWORD });
    cookie = (r.headers.get('set-cookie') || '').split(';')[0];

    // Conexão
    r = await call('PUT', '/api/autosend', { enabled: true });
    check('não liga sem WhatsApp conectado', r.s === 400, r.s);
    r = await call('POST', '/api/whatsapp/connect', {});
    check('conectar mostra o QR Code', r.json.status === 'qr' && String(r.json.qrDataUrl).startsWith('data:image/png;base64,'), r.json.status);
    await call('POST', '/api/test/wa/pair');
    r = await call('GET', '/api/whatsapp/status');
    check('depois de ler o QR fica conectado', r.json.status === 'connected' && r.json.phone === '(31) 91111-2222', JSON.stringify(r.json));

    // Regras
    r = await call('PUT', '/api/autosend', { start: '00:00', end: '23:59', days: [0, 1, 2, 3, 4, 5, 6], dailyLimit: 9999, segments: [], cities: [] });
    check('limite diário não passa de 300', r.json.config.dailyLimit === 300, r.json.config.dailyLimit);
    check('limites fixos informados (1/min, 30/h)', r.json.limits.minGapSeconds === 60 && r.json.limits.maxPerHour === 30);
    check('fila só com celulares novos nunca abordados', r.json.status.queue === 48, r.json.status.queue);
    check('estados disponíveis com a quantidade de contatos', r.json.statesAvailable.SC === 3 && r.json.statesAvailable.MG > 40, JSON.stringify(r.json.statesAvailable));
    r = await call('PUT', '/api/autosend', { states: ['SC', 'xx'] });
    check('escolher estado: só Santa Catarina na fila (sigla, nome e endereço)', r.json.config.states.join() === 'SC' && r.json.status.queue === 3, `${r.json.config.states} ${r.json.status.queue}`);
    r = await call('PUT', '/api/autosend', { states: [] });
    check('sem estado marcado = todos', r.json.status.queue === 48, r.json.status.queue);

    // Erros seguidos pausam sozinho
    await call('POST', '/api/test/wa/fail', { n: 3 });
    await call('PUT', '/api/autosend', { enabled: true });
    await sleep(2000);
    r = await call('GET', '/api/autosend');
    check('3 erros seguidos pausam o envio automaticamente', r.json.status.enabled === false && /Pausado automaticamente/.test(r.json.status.message), JSON.stringify(r.json.status));
    check('contatos com erro voltam para a fila', r.json.status.queue === 48 && r.json.log.filter(e => e.result === 'erro').length === 3, r.json.status.queue);

    // Envio normal (o 1º da fila não tem WhatsApp)
    await call('POST', '/api/test/wa/no-whatsapp', { phone: '31980000001' });
    const t0 = Date.now();
    await call('PUT', '/api/autosend', { enabled: true });
    await sleep(HOUR * 0.92); // ~55 "minutos"
    const s = await sent();
    r = await call('GET', '/api/autosend');
    check('envia até 30 por hora e para', s.length === 30, s.length);
    check('status: limite da hora atingido', r.json.status.state === 'limite_hora' && r.json.status.nextAt, JSON.stringify(r.json.status));
    const gaps = s.slice(1).map((m, i) => m.at - s[i].at);
    check('nunca menos de 1 minuto entre mensagens', gaps.every(g => g >= MIN_GAP - 5), `menor intervalo: ${Math.min(...gaps)}ms (mínimo ${MIN_GAP}ms)`);
    check('intervalos variados (não robóticos)', new Set(gaps.map(g => Math.round(g / 10))).size > 5);
    const phones = s.map(m => m.phone);
    check('ninguém recebe duas vezes', new Set(phones).size === phones.length);
    check('não envia para fixo, quem pediu para sair ou já abordado', !phones.includes('3132221111') && !phones.includes('31980000101') && !phones.includes('31980000102'));
    check('não envia para quem tem site próprio (inteligência)', !phones.includes('31980000103'));
    const pet = s.find(m => m.phone === '31980000004');
    const odonto = s.find(m => m.phone === '31980000002');
    check('mensagem do segmento certo (pet x saúde)', pet && /pet shops/.test(pet.text) && odonto && /clínicas e consultórios/.test(odonto.text));
    check('mensagem com saudação e seu nome', /^(Bom dia|Boa tarde|Boa noite)! Tudo bem\? Aqui é o Gabriel/.test(odonto.text), odonto && odonto.text.slice(0, 60));
    let all = await leadsNow();
    check('número sem WhatsApp vira "Número inválido"', all.find(l => l.id === 'lead-1').status === 'invalido');
    check('enviados viram "Mensagem enviada"', all.filter(l => l.status === 'contatado').length === 31, all.filter(l => l.status === 'contatado').length);

    // Libera depois de 1 hora
    await sleep(Math.max(0, t0 + HOUR * 1.2 - Date.now()));
    check('depois da hora, volta a enviar', (await sent()).length > 30, (await sent()).length);
    await call('PUT', '/api/autosend', { enabled: false });

    // Respostas
    const replied = s[0].phone;                       // 31980000002
    const withoutNine = replied.slice(0, 2) + replied.slice(3);
    r = await call('POST', '/api/test/wa/incoming', { phone: withoutNine, text: 'Bom dia! Pode mandar para mim' });
    check('resposta (número sem o 9) é reconhecida e vira "Respondeu"', r.json.lead && r.json.lead.status === 'respondeu', JSON.stringify(r.json));
    r = await call('POST', '/api/test/wa/incoming', { phone: s[1].phone, text: 'Não tenho interesse, obrigado' });
    check('pedido para parar vira "Não quer contato"', r.json.lead && r.json.lead.status === 'sem_interesse', JSON.stringify(r.json));
    r = await call('POST', '/api/test/wa/incoming', { phone: '31980000040', text: 'Oi, quem é?' });
    check('resposta de quem ainda estava na fila tira da fila', r.json.lead && r.json.lead.status === 'respondeu');
    r = await call('POST', '/api/test/wa/incoming', { phone: '31999990000', text: 'número desconhecido' });
    check('mensagem de número desconhecido é ignorada', r.json.lead === null);
    r = await call('GET', '/api/autosend');
    check('respostas aparecem na tela', r.json.replies.length === 3 && r.json.replies.some(x => x.optOut));
    all = await leadsNow();
    check('quem respondeu não volta para a fila', !(await call('GET', '/api/autosend')).json.status.queue || all.filter(l => l.status === 'respondeu').every(l => l.contactedAt));

    // Limite diário
    const sentToday = (await call('GET', '/api/autosend')).json.status.dayCount;
    await call('PUT', '/api/autosend', { dailyLimit: sentToday, enabled: true });
    r = await call('GET', '/api/autosend');
    check('limite diário atingido segura o envio', r.json.status.state === 'limite_dia', r.json.status.state);
    const before = (await sent()).length; await sleep(800);
    check('nada é enviado depois do limite diário', (await sent()).length === before);

    // Desconectar pausa tudo
    r = await call('POST', '/api/whatsapp/logout');
    const after = (await call('GET', '/api/autosend')).json;
    check('desconectar pausa o envio automático', r.json.status === 'off' && after.config.enabled === false);
  } catch (e) {
    fail++; console.log('FAIL erro inesperado:', e);
  } finally {
    await new Promise(r => { app.once('exit', r); app.kill('SIGTERM'); setTimeout(r, 2000); });
    if (fail) console.log('\n--- log do servidor ---\n' + appLog.slice(-3000));
    console.log(`\n${pass} ok, ${fail} falhas`);
    fs.rmSync(TMP, { recursive: true, force: true });
    process.exit(fail ? 1 : 0);
  }
})();
