/**
 * Busca de empresas pela API oficial do Google Maps (Places API "New": Text Search).
 *
 * GOOGLE_PLACES_API_KEY: chave do Google Cloud (APIs e serviços → Credenciais).
 * Cada busca devolve até 20 empresas por página e no máximo 3 páginas (60). Por isso a
 * busca é feita por bairro/cidade. Buscas já feitas ficam registradas e não são repetidas.
 */
const storage = require('./storage');
const leads = require('./leads');
const { BY_ID } = require('./segments');
const cities = require('./cities');
const intel = require('./intel');

const PLACES_URL = () => (process.env.PLACES_API_URL || 'https://places.googleapis.com/v1/places:searchText').trim();
const FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.addressComponents', 'places.nationalPhoneNumber',
  'places.internationalPhoneNumber', 'places.websiteUri', 'places.rating', 'places.userRatingCount',
  'places.googleMapsUri', 'places.businessStatus', 'nextPageToken'
].join(',');
const REDO_AFTER_DAYS = 30; // depois disso, uma busca igual pode ser refeita (empresas novas)

function apiKey() { return String(process.env.GOOGLE_PLACES_API_KEY || '').trim(); }
function isConfigured() { return apiKey().length > 10; }

async function searchPage(textQuery, pageToken) {
  const body = { textQuery, languageCode: 'pt-BR', regionCode: 'BR', pageSize: 20 };
  if (pageToken) body.pageToken = pageToken;
  const res = await fetch(PLACES_URL(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey(), 'X-Goog-FieldMask': FIELD_MASK },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return { places: Array.isArray(json.places) ? json.places : [], nextPageToken: json.nextPageToken || null };
}

function component(place, type) {
  const c = (place.addressComponents || []).find(x => (x.types || []).includes(type));
  return c ? (c.longText || c.shortText || '') : '';
}

function toLead(place, segment) {
  return {
    source: 'google',
    segment,
    placeId: place.id,
    name: place.displayName?.text || '',
    phone: place.nationalPhoneNumber || place.internationalPhoneNumber || '',
    address: place.formattedAddress || '',
    bairro: component(place, 'sublocality_level_1') || component(place, 'sublocality'),
    city: component(place, 'administrative_area_level_2'),
    uf: (place.addressComponents || []).find(x => (x.types || []).includes('administrative_area_level_1'))?.shortText || '',
    website: place.websiteUri || '',
    mapsUrl: place.googleMapsUri || '',
    rating: place.rating || null,
    ratingCount: place.userRatingCount || 0
  };
}

function log() { return storage.read('google-log', {}); }

/**
 * Roda as buscas (termo do segmento × área) até o limite de chamadas.
 * Pode ser chamada de novo para continuar de onde parou.
 */
async function run({ segments = [], areas = [], maxCalls = 40, redo = false, minPopulation = 20000, onlyWithoutSite = true }) {
  if (!isConfigured()) throw Object.assign(new Error('Defina GOOGLE_PLACES_API_KEY nas variáveis do servidor.'), { status: 400 });
  const segs = segments.filter(s => BY_ID[s]);
  // Uma linha só com o estado ("MG", "Minas Gerais") vira a lista das cidades do estado
  const areaList = cities.expandAreas(areas.map(a => String(a || '').trim()).filter(Boolean), Number(minPopulation) || 0).slice(0, 6000);
  if (!segs.length || !areaList.length) throw Object.assign(new Error('Escolha ao menos um segmento e uma área.'), { status: 400 });
  maxCalls = Math.min(Math.max(Number(maxCalls) || 40, 1), 200);

  const history = log();
  const limit = Date.now() - REDO_AFTER_DAYS * 86400000;
  const pending = [];
  for (const seg of segs) for (const term of BY_ID[seg].terms) for (const area of areaList) {
    const q = `${term} em ${area}`;
    const done = history[q];
    if (!redo && done && new Date(done.at).getTime() > limit) continue;
    pending.push({ seg, q });
  }

  const result = { calls: 0, queriesDone: 0, queriesLeft: 0, added: 0, merged: 0, skipped: 0, closed: 0, withSite: 0, errors: [] };
  return storage.withLock('leads', async () => {
    const index = leads.buildIndex();
    for (let i = 0; i < pending.length; i++) {
      const { seg, q } = pending[i];
      if (result.calls >= maxCalls) { result.queriesLeft = pending.length - i; break; }
      let token = null, found = 0;
      try {
        do {
          const page = await searchPage(q, token);
          result.calls++;
          for (const place of page.places) {
            found++;
            if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') { result.closed++; continue; }
            const lead = toLead(place, seg);
            // Quem tem site próprio ou já usa plataforma de agendamento tem pouca chance de comprar:
            // não entra como contato novo (mas completa os dados de um contato que já existe)
            if (onlyWithoutSite && !leads.exists(lead, index) && !intel.hasNoOwnSite(lead)) { result.withSite++; continue; }
            result[leads.upsert(lead, index)]++;
          }
          token = page.nextPageToken;
        } while (token && result.calls < maxCalls);
        history[q] = { at: new Date().toISOString(), found };
        result.queriesDone++;
      } catch (e) {
        result.errors.push(`${q}: ${e.message}`);
        if (e.status === 400 || e.status === 401 || e.status === 403 || e.status === 429) {
          result.queriesLeft = pending.length - i; // chave inválida, sem permissão ou cota: para tudo
          break;
        }
      }
    }
    storage.save('leads');
    storage.save('google-log');
    return result;
  });
}

module.exports = { run, isConfigured, log };
