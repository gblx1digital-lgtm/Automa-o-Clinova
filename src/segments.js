/**
 * Tipos de negócio que o CLINOVA atende, com:
 *  - termos de busca no Google Maps
 *  - códigos CNAE (atividade na Receita Federal)
 *  - grupo de mensagem (saude, psicologia, pet, servicos)
 */
const SEGMENTS = [
  { id: 'odontologia', label: 'Odontologia', group: 'saude',
    terms: ['dentista', 'clínica odontológica', 'ortodontista'], cnaes: ['8630504'] },
  { id: 'medica', label: 'Clínica médica / consultório', group: 'saude',
    terms: ['clínica médica', 'consultório médico'], cnaes: ['8630503', '8630501', '8630502'] },
  { id: 'estetica', label: 'Estética e dermatologia', group: 'saude',
    terms: ['clínica de estética', 'dermatologista'], cnaes: ['9602502'] },
  { id: 'fisioterapia', label: 'Fisioterapia', group: 'saude',
    terms: ['fisioterapia', 'clínica de fisioterapia'], cnaes: ['8650004'] },
  { id: 'nutricao', label: 'Nutrição', group: 'saude',
    terms: ['nutricionista'], cnaes: ['8650002'] },
  { id: 'psicologia', label: 'Psicologia / terapias', group: 'psicologia',
    terms: ['psicólogo', 'clínica de psicologia'], cnaes: ['8650003'] },
  { id: 'veterinaria', label: 'Clínica veterinária', group: 'pet',
    terms: ['clínica veterinária', 'veterinário'], cnaes: ['7500100'] },
  { id: 'petshop', label: 'Pet shop / banho e tosa', group: 'pet',
    terms: ['pet shop', 'banho e tosa'], cnaes: ['4789004', '9609208'] },
  { id: 'beleza', label: 'Salão de beleza / barbearia', group: 'servicos',
    terms: ['salão de beleza', 'barbearia', 'manicure'], cnaes: ['9602501'] }
];

const BY_ID = Object.fromEntries(SEGMENTS.map(s => [s.id, s]));
const BY_CNAE = {};
for (const s of SEGMENTS) for (const c of s.cnaes) BY_CNAE[c] = s.id;

/** Mensagens padrão por grupo. Variáveis: {nome}, {seunome}. */
const DEFAULT_TEMPLATES = {
  saude:
`Bom dia! Tudo bem? Aqui é o {seunome}, da Clinova.

Ajudo clínicas e consultórios a encher a agenda sem a recepção ficar presa no WhatsApp: o paciente agenda sozinho pelo link do Instagram, a qualquer hora, e recebe confirmação e lembrete automáticos, o que ajuda a reduzir as faltas.

Gravei um vídeo curto mostrando funcionando. Posso te mandar por aqui?

(Se não fizer sentido, é só me avisar que eu não mando mais mensagens.)`,
  psicologia:
`Bom dia! Tudo bem? Aqui é o {seunome}, da Clinova.

Ajudo psicólogos e terapeutas a organizar a agenda sem perder tempo no WhatsApp: o paciente marca a sessão sozinho pelo link, presencial ou online, e recebe confirmação e lembrete automáticos, o que ajuda a reduzir as faltas.

Gravei um vídeo curto mostrando funcionando. Posso te mandar por aqui?

(Se não fizer sentido, é só me avisar que eu não mando mais mensagens.)`,
  pet:
`Bom dia! Tudo bem? Aqui é o {seunome}, da Clinova.

Ajudo pet shops e veterinárias a encher a agenda sem a recepção ficar presa no WhatsApp: o tutor agenda sozinho pelo link do Instagram, informando os dados do pet, e recebe confirmação e lembrete automáticos, o que ajuda a reduzir as faltas no banho e tosa e nas consultas.

Gravei um vídeo curto mostrando funcionando. Posso te mandar por aqui?

(Se não fizer sentido, é só me avisar que eu não mando mais mensagens.)`,
  servicos:
`Bom dia! Tudo bem? Aqui é o {seunome}, da Clinova.

Ajudo salões e barbearias a encher a agenda sem ficar presos no WhatsApp: o cliente agenda sozinho pelo link do Instagram, a qualquer hora, e recebe confirmação e lembrete automáticos, o que ajuda a reduzir as faltas.

Gravei um vídeo curto mostrando funcionando. Posso te mandar por aqui?

(Se não fizer sentido, é só me avisar que eu não mando mais mensagens.)`
};

/** Áreas padrão: bairros de BH (o Google devolve no máximo 60 resultados por busca) + região metropolitana. */
const DEFAULT_AREAS = [
  'Savassi, Belo Horizonte', 'Funcionários, Belo Horizonte', 'Lourdes, Belo Horizonte', 'Centro, Belo Horizonte',
  'Santo Agostinho, Belo Horizonte', 'Sion, Belo Horizonte', 'Anchieta, Belo Horizonte', 'Serra, Belo Horizonte',
  'Santa Efigênia, Belo Horizonte', 'Floresta, Belo Horizonte', 'Santa Tereza, Belo Horizonte', 'Cidade Nova, Belo Horizonte',
  'Pampulha, Belo Horizonte', 'Castelo, Belo Horizonte', 'Ouro Preto, Belo Horizonte', 'Buritis, Belo Horizonte',
  'Gutierrez, Belo Horizonte', 'Prado, Belo Horizonte', 'Barreiro, Belo Horizonte', 'Venda Nova, Belo Horizonte',
  'Padre Eustáquio, Belo Horizonte', 'Caiçara, Belo Horizonte', 'Belvedere, Belo Horizonte', 'Mangabeiras, Belo Horizonte',
  'Contagem, MG', 'Betim, MG', 'Nova Lima, MG', 'Lagoa Santa, MG', 'Sabará, MG', 'Ribeirão das Neves, MG', 'Santa Luzia, MG'
];

const DEFAULT_CITIES = ['BELO HORIZONTE', 'CONTAGEM', 'BETIM', 'NOVA LIMA', 'LAGOA SANTA', 'SABARA', 'RIBEIRAO DAS NEVES', 'SANTA LUZIA'];

module.exports = { SEGMENTS, BY_ID, BY_CNAE, DEFAULT_TEMPLATES, DEFAULT_AREAS, DEFAULT_CITIES };
