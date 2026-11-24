/**
 * Inteligência de qualificação: quem tem mais chance de comprar o CLINOVA.
 *
 * A ideia: quem NÃO tem site próprio (ou só tem Instagram/Facebook/Linktree/WhatsApp)
 * normalmente agenda tudo na mão pelo WhatsApp: é o cliente ideal. Quem já usa uma
 * plataforma de agendamento (Doctoralia, Booksy, Trinks...) já tem um concorrente.
 */

// Redes sociais e "links na bio": não é site próprio
const SOCIAL = [
  'instagram.com', 'instagr.am', 'facebook.com', 'fb.com', 'fb.me', 'm.facebook.com', 'linktr.ee', 'linktree.com',
  'wa.me', 'api.whatsapp.com', 'whatsapp.com', 'chat.whatsapp.com', 'tiktok.com', 'linkedin.com', 'youtube.com',
  'youtu.be', 'twitter.com', 'x.com', 'beacons.ai', 'bio.link', 'lnk.bio', 'taplink.cc', 'linkbio.co', 'campsite.bio',
  'business.site', 'negocio.site', 'g.page', 'goo.gl', 'maps.app.goo.gl', 'linkme.bio', 'msha.ke', 'carrd.co'
];

// Plataformas de agendamento / sistemas de clínica: já usam um concorrente
const BOOKING = {
  'doctoralia.com.br': 'Doctoralia', 'doctoralia.com': 'Doctoralia', 'boaconsulta.com': 'BoaConsulta',
  'zocdoc.com': 'Zocdoc', 'booksy.com': 'Booksy', 'trinks.com': 'Trinks', 'avec.app': 'Avec', 'avec.beauty': 'Avec',
  'salaovip.com.br': 'SalãoVIP', 'agendasalao.com.br': 'Agenda Salão', 'calendly.com': 'Calendly',
  'simplesagenda.com.br': 'Simples Agenda', 'agendor.com.br': 'Agendor', 'iclinic.com.br': 'iClinic',
  'feegow.com.br': 'Feegow', 'feegow.com': 'Feegow', 'clinicorp.com': 'Clinicorp', 'amplimed.com.br': 'Amplimed',
  'ninsaude.com': 'Ninsaúde', 'medicinadireta.com.br': 'Medicina Direta', 'agendamento.online': 'Agendamento Online',
  'simplesvet.com.br': 'SimplesVet', 'vetsmart.com.br': 'VetSmart', 'petsys.com.br': 'PetSys', 'zenvet.com.br': 'ZenVet',
  'agendapro.com': 'AgendaPro', 'gendo.app': 'Gendo', 'fresha.com': 'Fresha', 'beautydate.com.br': 'Beauty Date',
  'appbarber.com.br': 'AppBarber', 'cashbarber.com.br': 'CashBarber', 'clinicaexperts.com.br': 'Clínica Experts',
  'psicomanager.com.br': 'PsicoManager', 'psicologiaviva.com.br': 'Psicologia Viva', 'zenklub.com.br': 'Zenklub',
  'vittude.com': 'Vittude', 'simples.dental': 'Simples Dental', 'simplesdental.com': 'Simples Dental',
  'dentalspeed.com': 'Dental Speed', 'easydental.com.br': 'EasyDental', 'controleodonto.com.br': 'Controle Odonto'
};

// E-mails gratuitos: não indicam domínio (site) próprio
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.com.br', 'outlook.com', 'outlook.com.br', 'live.com',
  'msn.com', 'yahoo.com', 'yahoo.com.br', 'ymail.com', 'bol.com.br', 'uol.com.br', 'terra.com.br', 'ig.com.br',
  'globo.com', 'globomail.com', 'icloud.com', 'me.com', 'zipmail.com.br', 'r7.com', 'oi.com.br', 'protonmail.com', 'proton.me'
]);

function hostOf(url) {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch (e) { return ''; }
}

const matches = (host, domain) => host === domain || host.endsWith(`.${domain}`);

/**
 * Tipo de presença na internet:
 *  nenhum      não tem site (confirmado pelo Google)
 *  social      só rede social / link na bio
 *  agendamento usa plataforma de agendamento (concorrente)
 *  proprio     site próprio (ou e-mail com domínio próprio)
 *  desconhecido não verificado (ex.: só veio da Receita, sem e-mail com domínio)
 */
function classifySite(lead) {
  const site = String(lead.website || '').trim();
  if (site) {
    const host = hostOf(site);
    const booking = Object.keys(BOOKING).find(d => matches(host, d));
    if (booking) return { kind: 'agendamento', label: `Usa ${BOOKING[booking]}`, platform: BOOKING[booking] };
    if (SOCIAL.some(d => matches(host, d))) {
      const net = /instagr/.test(host) ? 'Instagram' : /facebook|fb\./.test(host) ? 'Facebook' : /whatsapp|wa\.me/.test(host) ? 'WhatsApp' : 'rede social';
      return { kind: 'social', label: `Só ${net}` };
    }
    if (host) return { kind: 'proprio', label: 'Site próprio', host };
  }
  const emailDomain = String(lead.email || '').toLowerCase().split('@')[1] || '';
  if (emailDomain && !FREE_MAIL.has(emailDomain)) return { kind: 'proprio', label: 'Domínio próprio (e-mail)', host: emailDomain };
  // Veio do Google e o Google não tem site cadastrado = sem site (contato ainda novo usa "source")
  const sources = lead.sources || (lead.source ? [lead.source] : []);
  if (sources.includes('google')) return { kind: 'nenhum', label: 'Sem site' };
  return { kind: 'desconhecido', label: 'Site não verificado' };
}

/** Sem site próprio = nenhum ou só rede social. */
function hasNoOwnSite(lead) {
  const k = classifySite(lead).kind;
  return k === 'nenhum' || k === 'social';
}

/**
 * Nota de 0 a 100 e os motivos. Alta >= 70, Média >= 45, Baixa < 45.
 */
function score(lead) {
  const site = classifySite(lead);
  const reasons = [];
  let s = 0;
  const add = (pts, why) => { s += pts; if (why) reasons.push(why); };

  if (site.kind === 'nenhum') add(40, 'Sem site');
  else if (site.kind === 'social') add(38, `${site.label} (sem site próprio)`);
  else if (site.kind === 'desconhecido') add(22, 'Site não verificado');
  else if (site.kind === 'proprio') add(5, site.label);
  else if (site.kind === 'agendamento') add(-15, `Já usa ${site.platform}`);

  if (lead.mobile) add(25, 'Celular (WhatsApp)');
  else add(0, 'Só telefone fixo');

  const n = Number(lead.ratingCount) || 0;
  if (n >= 10 && n <= 400) add(15, `${n} avaliações no Google (negócio ativo)`);
  else if (n > 400) add(8, `${n} avaliações no Google (negócio grande)`);
  else if (n > 0) add(6, `${n} avaliações no Google`);

  if (Number(lead.rating) >= 4.5) add(10, `Nota ${lead.rating} no Google`);
  else if (Number(lead.rating) >= 4) add(5);

  if ((lead.sources || []).includes('google') && (lead.sources || []).includes('receita')) add(5, 'Confirmado no Google e na Receita');

  s = Math.max(0, Math.min(100, s));
  return { score: s, level: s >= 70 ? 'alta' : s >= 45 ? 'media' : 'baixa', site, reasons };
}

module.exports = { classifySite, hasNoOwnSite, score, hostOf };
