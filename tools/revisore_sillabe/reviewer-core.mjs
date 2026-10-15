export const STATES = ['RISOLTO', 'STIMA_CORROBORATA', 'SOLO_STIMA', 'CONFLITTO', 'DA_RIVEDERE', 'AMBIGUO', 'ESCLUDI'];
export const QUEUES = ['revisione_prioritaria', 'stime_corroborate', 'stime_non_verificate'];
export const SOURCES = ['wiktionary', 'wiktionary_ipa', 'wikipron', 'phonitalia'];
export const MAX_BYTES = 64 * 1024 * 1024;
const BASE_KEYS = ['vocabolario_sha256', 'grafie', 'curatela_schema_version', 'curatela_sha256',
  'curatela_revisione_git_base', 'annotazioni_schema_version', 'politica_version', 'manifesto_sha256'];
export const DEFAULT_REASON = 'Revisione manuale tramite revisore sillabico';

function check(ok, message) { if (!ok) throw new Error(message); }
function object(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function keys(x, allowed) {
  check(object(x) && Object.keys(x).every(k => allowed.includes(k)), 'Campi non riconosciuti.');
}
function string(x, max = 240) { check(typeof x === 'string' && x.trim().length > 0 && x.length <= max, 'Testo mancante o troppo lungo.'); }
export function counts(x) {
  check(Array.isArray(x) && x.length <= 64 && x.every((n, i) => Number.isSafeInteger(n) && n > 0 && n <= 1000000 && (!i || n > x[i - 1])), 'Conteggi positivi, distinti e ordinati richiesti.');
  return x;
}
function word(x) {
  string(x, 200);
  check(x === x.normalize('NFC').toLowerCase().trim() && !/[\s\p{Cc}]/u.test(x), 'Grafia non canonica.');
}
function date(x) { string(x, 64); check(/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(x) && Number.isFinite(Date.parse(x)), 'Data non valida.'); }
export function validateBase(base) {
  keys(base, BASE_KEYS);
  check(BASE_KEYS.every(k => Object.hasOwn(base, k)), 'Base incompleta.');
  for (const k of ['vocabolario_sha256', 'curatela_sha256', 'manifesto_sha256']) check(/^[a-f0-9]{64}$/.test(base[k]), 'SHA-256 di base non valido.');
  check(Number.isSafeInteger(base.grafie) && base.grafie > 0 && base.curatela_schema_version === 1 && base.annotazioni_schema_version === 2 && base.politica_version === 'offline-v2-evidenze', 'Versioni di base incompatibili.');
  check(base.curatela_revisione_git_base === null || typeof base.curatela_revisione_git_base === 'string' && /^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(base.curatela_revisione_git_base), 'Revisione Git non valida.');
  return base;
}
export function validateDecision(d, withWord = true) {
  keys(d, ['parola', 'azione', 'conteggi', 'autore', 'data', 'motivazione', 'decisione_base']);
  if (withWord) word(d.parola);
  counts(d.conteggi); string(d.autore, 200); string(d.motivazione, 2000); date(d.data);
  check(['CONFERMA', 'AMBIGUO', 'DA_RIVEDERE', 'ESCLUDI'].includes(d.azione), 'Azione non valida.');
  check(d.azione === 'CONFERMA' ? d.conteggi.length === 1 : d.azione === 'AMBIGUO' ? d.conteggi.length >= 2 : d.conteggi.length === 0, 'Conteggi incompatibili con l’azione.');
  if (withWord) {
    check(Object.hasOwn(d, 'decisione_base'), 'Decisione di base mancante.');
    if (d.decisione_base !== null) {
      keys(d.decisione_base, ['azione', 'conteggi', 'autore', 'data', 'motivazione']);
      validateDecision(d.decisione_base, false);
    }
  }
  return d;
}
export function validatePackage(p) {
  keys(p, ['schema_version', 'tipo', 'creato_utc', 'coda', 'base', 'intervallo', 'record', 'note_licenza']);
  check(p.schema_version === 1 && p.tipo === 'pacchetto_revisione_sillabe' && QUEUES.includes(p.coda), 'Tipo/schema del pacchetto incompatibile.');
  validateBase(p.base); date(p.creato_utc); string(p.note_licenza, 2000);
  keys(p.intervallo, ['offset', 'record_coda']);
  check(Number.isSafeInteger(p.intervallo.offset) && p.intervallo.offset >= 0 && Number.isSafeInteger(p.intervallo.record_coda) && p.intervallo.record_coda >= 1, 'Intervallo non valido.');
  check(Array.isArray(p.record) && p.record.length > 0 && p.record.length <= 100000 && p.intervallo.offset + p.record.length <= p.intervallo.record_coda, 'Dimensione del pacchetto non valida.');
  const seen = new Set(); let previous = -1;
  for (const r of p.record) {
    keys(r, ['parola', 'indice', 'r1', 'stato_automatico', 'motivo', 'candidati', 'macro_famiglie', 'evidenze', 'decisione_base', 'priorita']);
    word(r.parola); check(!seen.has(r.parola), 'Parola duplicata.'); seen.add(r.parola);
    check(Number.isSafeInteger(r.indice) && previous < r.indice && r.indice < p.base.grafie, 'Ordine/indice non valido.'); previous = r.indice;
    check(Number.isSafeInteger(r.r1) && r.r1 >= 0 && r.r1 <= 1000000 && STATES.includes(r.stato_automatico), 'R1/stato non valido.');
    string(r.motivo); counts(r.candidati);
    check(r.priorita === (p.coda === 'revisione_prioritaria' ? 'prioritaria' : p.coda), 'Priorità non coerente.');
    keys(r.macro_famiglie, ['wiktionary', 'phonitalia']);
    for (const family of ['wiktionary', 'phonitalia']) counts(r.macro_famiglie[family]);
    keys(r.evidenze, SOURCES);
    for (const name of SOURCES) {
      const e = r.evidenze[name]; keys(e, ['conteggi', 'anomalie', 'testimoni', 'esempi_anomalie']); counts(e.conteggi);
      check(Array.isArray(e.anomalie) && e.anomalie.length <= 64, 'Anomalie non valide.'); e.anomalie.forEach(x => string(x));
      check(object(e.testimoni) && Object.keys(e.testimoni).length <= 64 && object(e.esempi_anomalie) && Object.keys(e.esempi_anomalie).length <= 64, 'Testimoni non validi.');
      for (const [n, v] of Object.entries(e.testimoni)) {
        check(e.conteggi.map(String).includes(n), 'Testimone senza conteggio.');
        if (name === 'wiktionary') { check(Array.isArray(v) && v.length > 0 && v.length <= 128, 'Sillabazione non valida.'); v.forEach(x => string(x, 200)); }
        else if (name === 'phonitalia') { keys(v, ['phone_syll', 'sillaba_tonica']); string(v.phone_syll); check(Number.isSafeInteger(v.sillaba_tonica) && v.sillaba_tonica >= 0, 'Accento non valido.'); }
        else string(v);
      }
      for (const [n, v] of Object.entries(e.esempi_anomalie)) { string(n); string(v); }
    }
    const union = [...new Set(['wiktionary', 'wiktionary_ipa', 'wikipron'].flatMap(n => r.evidenze[n].conteggi))].sort((a, b) => a - b);
    check(same(union, r.macro_famiglie.wiktionary) && same(r.evidenze.phonitalia.conteggi, r.macro_famiglie.phonitalia), 'Famiglie non coerenti con le evidenze.');
    check(same([...new Set([...union, ...r.evidenze.phonitalia.conteggi])].sort((a, b) => a - b), r.candidati), 'Candidati non coerenti con le evidenze.');
    check(Object.hasOwn(r, 'decisione_base'), 'Decisione di base mancante.');
    if (r.decisione_base !== null) validateDecision(r.decisione_base, false);
  }
  return p;
}
function canonical(x) {
  if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
  if (object(x)) return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
  return JSON.stringify(x);
}
export function same(a, b) { return canonical(a) === canonical(b); }
export function compatible(a, b) { validateBase(a); validateBase(b); return same(a, b); }
export function makeDecision(record, action, numbers, author, note = '', now = new Date().toISOString()) {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  return validateDecision({parola: record.parola, azione: action, conteggi: sorted, autore: author.trim(),
    data: now, motivazione: note.trim() || DEFAULT_REASON, decisione_base: record.decisione_base});
}
export function filtered(records, decisions, skipped, filters) {
  const needle = filters.search.trim().normalize('NFC').toLowerCase();
  return records.filter(r => (!needle || r.parola.includes(needle)) &&
    (!filters.state || r.stato_automatico === filters.state) &&
    (filters.review === 'tutte' || filters.review === 'decise' && decisions.has(r.parola) ||
      filters.review === 'non_decise' && !decisions.has(r.parola) || filters.review === 'saltate' && skipped.includes(r.parola)));
}
export function progress(records, decisions, skipped) {
  const decided = records.filter(r => decisions.has(r.parola)).length;
  const skippedCount = records.filter(r => !decisions.has(r.parola) && skipped.includes(r.parola)).length;
  return {totale: records.length, decise: decided, non_decise: records.length - decided,
    saltate: skippedCount, da_fare: records.length - decided - skippedCount};
}
export function exportProposals(p, decisions, sessionId) {
  const proposal = {schema_version: 1, tipo: 'proposte_curatela_ufficiale', sessione_id: sessionId,
    base: p.base, decisioni: p.record.filter(r => decisions.has(r.parola)).map(r => decisions.get(r.parola))};
  validateProposals(proposal, p); return proposal;
}
export function validateProposals(x, p) {
  keys(x, ['schema_version', 'tipo', 'sessione_id', 'base', 'decisioni']);
  check(x.schema_version === 1 && x.tipo === 'proposte_curatela_ufficiale', 'Tipo/schema delle proposte incompatibile.');
  string(x.sessione_id, 200); check(compatible(x.base, p.base), 'Base diversa dal pacchetto aperto.');
  check(Array.isArray(x.decisioni) && x.decisioni.length <= p.record.length, 'Numero di decisioni non valido.');
  const byWord = new Map(p.record.map(r => [r.parola, r])); const seen = new Set();
  for (const d of x.decisioni) {
    validateDecision(d); check(!seen.has(d.parola), 'Decisione duplicata.'); seen.add(d.parola);
    check(byWord.has(d.parola) && same(d.decisione_base, byWord.get(d.parola).decisione_base), 'Parola o decisione di base incompatibile.');
  }
  return x;
}
export function importPlan(x, p, current) {
  validateProposals(x, p);
  const conflicts = x.decisioni.filter(d => current.has(d.parola) && !same(current.get(d.parola), d));
  return {decisions: x.decisioni, conflicts};
}
export function newSession(packageId, records, author = '') {
  const uuid = globalThis.crypto?.randomUUID?.() || Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  return {id: 'current', packageId, sessionId: uuid, revision: 0, cursor: records[0].parola,
    filters: {search: '', state: '', review: 'tutte'}, skipped: [], notes: {}, author};
}
