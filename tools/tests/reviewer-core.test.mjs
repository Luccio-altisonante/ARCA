import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePackage, validateDecision, makeDecision, DEFAULT_REASON, newSession, progress,
  filtered, exportProposals, compatible, importPlan} from '../revisore_sillabe/reviewer-core.mjs';

const hash = 'a'.repeat(64);
const evidence = (n = 3) => ({conteggi: [n], anomalie: [], testimoni: {}, esempi_anomalie: {}});
export function fixture() {
  return {schema_version: 1, tipo: 'pacchetto_revisione_sillabe', creato_utc: '2026-10-02T10:00:00Z',
    coda: 'revisione_prioritaria', base: {vocabolario_sha256: hash, grafie: 3, curatela_schema_version: 1,
      curatela_sha256: hash, curatela_revisione_git_base: 'b'.repeat(40), annotazioni_schema_version: 2,
      politica_version: 'offline-v2-evidenze', manifesto_sha256: hash},
    intervallo: {offset: 0, record_coda: 3}, note_licenza: 'Fixture sintetica',
    record: ['bugia', 'regia', 'viola'].map((parola, indice) => ({parola, indice, r1: 2,
      stato_automatico: 'CONFLITTO', motivo: 'fixture', candidati: [2, 3],
      macro_famiglie: {wiktionary: [3], phonitalia: [2]},
      evidenze: {wiktionary: evidence(), wiktionary_ipa: evidence(), wikipron: evidence(), phonitalia: evidence(2)},
      decisione_base: null, priorita: 'prioritaria'}))};
}
const decision = (r, action = 'CONFERMA', ns = [3]) => makeDecision(r, action, ns, 'Autore', '', '2026-10-02T10:00:00Z');
test('pacchetto valido e schema/base', () => { const p = fixture(); assert.equal(validatePackage(p), p); assert.ok(compatible(p.base, structuredClone(p.base))); });
test('pacchetti malformati/duplicati/raw/hash/stati', () => {
  for (const mutate of [p => p.schema_version = true, p => p.record[1].parola = 'bugia', p => p.base.manifesto_sha256 = 'abc',
    p => p.record[0].r1 = -1, p => p.record[0].parola = 'bu gia', p => p.record[0].stato_automatico = 'FALSO',
    p => p.record[0].raw = 'raw', p => delete p.record[0].evidenze.wikipron,
    p => p.record[0].macro_famiglie.wiktionary = [2], p => p.record[0].candidati = [4]]) {
    const p = fixture(); mutate(p); assert.throws(() => validatePackage(p));
  }
});
test('CONFERMA libero, motivazione automatica o nota', () => {
  const r = fixture().record[0], d = decision(r, 'CONFERMA', [4]); assert.deepEqual(d.conteggi, [4]); assert.equal(d.motivazione, DEFAULT_REASON);
  assert.equal(makeDecision(r, 'CONFERMA', [4], 'Autore', ' Nota ').motivazione, 'Nota');
});
test('AMBIGUO ordina e deduplica, richiede due', () => {
  const r = fixture().record[0]; assert.deepEqual(decision(r, 'AMBIGUO', [4, 2, 4]).conteggi, [2, 4]);
  assert.throws(() => decision(r, 'AMBIGUO', [3, 3]));
});
test('DA_RIVEDERE ed ESCLUDI non hanno conteggi', () => {
  for (const action of ['DA_RIVEDERE', 'ESCLUDI']) { assert.deepEqual(decision(fixture().record[0], action, []).conteggi, []); assert.throws(() => decision(fixture().record[0], action, [3])); }
});
test('rifiuta numeri booleani/frazionari/zero e autore vuoto', () => {
  for (const value of [true, 1.5, 0, -1, '3', NaN]) assert.throws(() => decision(fixture().record[0], 'CONFERMA', [value]));
  assert.throws(() => makeDecision(fixture().record[0], 'CONFERMA', [3], ' '));
});
test('salta non esportato; progressi non contano salto come decisione', () => {
  const p = fixture(), session = newSession(hash, p.record, 'Autore'); session.skipped = ['regia'];
  const ds = new Map([['bugia', decision(p.record[0])]]);
  assert.equal(exportProposals(p, ds, session.sessionId).decisioni.length, 1);
  assert.deepEqual(progress(p.record, ds, session.skipped), {totale: 3, decise: 1, non_decise: 2, saltate: 1, da_fare: 1});
});
test('progresso disgiunto; non_decise conserva anche le saltate', () => {
  const p = fixture(), ds = new Map([['bugia', decision(p.record[0])]]);
  for (const skipped of [[], ['regia'], ['bugia', 'regia', 'regia', 'viola', 'assente']]) {
    const result = progress(p.record, ds, skipped);
    assert.equal(result.decise + result.saltate + result.da_fare, result.totale);
    assert.equal(result.non_decise, result.saltate + result.da_fare);
    assert.ok(result.da_fare >= 0);
  }
  assert.equal(progress(p.record, ds, ['regia', 'viola']).da_fare, 0);
  assert.deepEqual(progress([], new Map(), []), {totale: 0, decise: 0, non_decise: 0, saltate: 0, da_fare: 0});
});
test('modifica e revoca, export deterministico secondo pacchetto', () => {
  const p = fixture(), ds = new Map([['viola', decision(p.record[2])], ['bugia', decision(p.record[0])]]);
  ds.set('bugia', decision(p.record[0], 'CONFERMA', [4]));
  assert.deepEqual(exportProposals(p, ds, 'session').decisioni.map(d => d.parola), ['bugia', 'viola']);
  ds.delete('bugia'); assert.deepEqual(exportProposals(p, ds, 'session').decisioni.map(d => d.parola), ['viola']);
});
test('compatibilita base include hash e revisione Git', () => {
  const p = fixture(), other = structuredClone(p.base); other.curatela_revisione_git_base = null; assert.equal(compatible(p.base, other), false);
});
test('ripristino, conflitti locali e import non mutante', () => {
  const p = fixture(), d = decision(p.record[0]), current = new Map([['bugia', decision(p.record[0], 'CONFERMA', [4])]]);
  const x = exportProposals(p, new Map([['bugia', d]]), 'backup');
  assert.equal(importPlan(x, p, current).conflicts.length, 1); assert.deepEqual(current.get('bugia').conteggi, [4]);
  assert.equal(importPlan(x, p, new Map([['bugia', d]])).conflicts.length, 0);
});
test('backup incompatibile/duplicato/parola estranea/base per parola', () => {
  const p = fixture(), original = exportProposals(p, new Map([['bugia', decision(p.record[0])]]), 'backup');
  for (const mutate of [x => x.base.grafie++, x => x.decisioni.push(x.decisioni[0]), x => x.decisioni[0].parola = 'assente',
    x => x.decisioni[0].decisione_base = {azione: 'CONFERMA', conteggi: [3], autore: 'Altro', data: '2026-10-02', motivazione: 'Precedente'}]) {
    const x = structuredClone(original); mutate(x); assert.throws(() => importPlan(x, p, new Map()));
  }
});
test('ricerca parziale/esatta, stati e categorie', () => {
  const p = fixture(), ds = new Map([['bugia', decision(p.record[0])]]);
  assert.equal(filtered(p.record, ds, ['regia'], {search: 'BUGIA', state: '', review: 'tutte'}).length, 1);
  assert.equal(filtered(p.record, ds, ['regia'], {search: 'gia', state: 'CONFLITTO', review: 'non_decise'}).length, 1);
  assert.equal(filtered(p.record, ds, ['regia'], {search: '', state: '', review: 'saltate'})[0].parola, 'regia');
  assert.equal(filtered(p.record, ds, [], {search: '', state: '', review: 'decise'})[0].parola, 'bugia');
});
test('decisione ufficiale di base preservata', () => {
  const p = fixture(); p.record[0].decisione_base = {azione: 'CONFERMA', conteggi: [5], autore: 'Autore', data: '2026-10-02', motivazione: 'Base'};
  validatePackage(p); const d = decision(p.record[0]); assert.deepEqual(d.decisione_base.conteggi, [5]); validateDecision(d);
});
