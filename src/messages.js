/**
 * Monta a mensagem de apresentação de cada contato e entende as respostas.
 */
const { BY_ID, DEFAULT_TEMPLATES } = require('./segments');

/** Hora de Brasília (o Brasil não tem mais horário de verão). */
function brt(date = new Date()) {
  return new Date(date.getTime() - 3 * 3600000);
}

function greeting(date = new Date()) {
  const h = brt(date).getUTCHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

/** Várias versões separadas por uma linha com --- : escolhe uma ao acaso (as mensagens não ficam idênticas). */
function variants(tpl) {
  return String(tpl || '').split(/\n\s*-{3,}\s*\n/).map(s => s.trim()).filter(Boolean);
}

function build(lead, settings, date = new Date()) {
  const group = BY_ID[lead.segment]?.group || 'saude';
  const options = variants(settings.templates?.[group] || DEFAULT_TEMPLATES[group] || DEFAULT_TEMPLATES.saude);
  const tpl = options[Math.floor(Math.random() * options.length)] || '';
  return tpl
    .replace(/\{saudacao\}/g, greeting(date))
    .replace(/\{seunome\}/g, settings.senderName || 'Clinova')
    .replace(/\{nome\}/g, lead.name || '');
}

// Pedidos para parar de receber mensagens (o contato vira "Não quer contato" e nunca mais recebe)
// Frases específicas: "para" sozinho NÃO conta (ex.: "pode mandar para mim" é interesse, não recusa)
const OPT_OUT = /(^|[^\p{L}])(pare|parar|para de|pode parar|sair da lista|me tir[ae]|remov[ae]r?|descadastr\p{L}*|stop|sem interesse|n[aã]o (tenho|temos) interesse|n[aã]o (quero|queremos)|n[aã]o (me )?(envi|mand)\p{L}*|n[aã]o precis[ao]|bloque(ar|ado|io)|denunci\p{L}*|spam)(?![\p{L}])/iu;

function isOptOut(text) {
  return OPT_OUT.test(String(text || '').normalize('NFC'));
}

module.exports = { brt, greeting, variants, build, isOptOut };
