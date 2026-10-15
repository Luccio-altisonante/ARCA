import {openDB, load, mutate} from '../revisore_sillabe/db.mjs';
import {newSession, makeDecision, exportProposals, importPlan, validatePackage} from '../revisore_sillabe/reviewer-core.mjs';

const output = document.getElementById('results'), results = [];
const assert = (ok, text) => { if (!ok) throw new Error(text); results.push('OK ' + text); output.textContent = results.join('\n'); };
const hash = 'a'.repeat(64);
const e = n => ({conteggi: [n], anomalie: [], testimoni: {}, esempi_anomalie: {}});
const p = {schema_version: 1, tipo: 'pacchetto_revisione_sillabe', creato_utc: '2026-10-02T10:00:00Z', coda: 'revisione_prioritaria',
  base: {vocabolario_sha256: hash, grafie: 3, curatela_schema_version: 1, curatela_sha256: hash, curatela_revisione_git_base: 'b'.repeat(40),
    annotazioni_schema_version: 2, politica_version: 'offline-v2-evidenze', manifesto_sha256: hash},
  intervallo: {offset: 0, record_coda: 3}, note_licenza: 'Solo fixture sintetica',
  record: ['testuno', 'testdue', 'testtre'].map((parola, indice) => ({parola, indice, r1: 2, stato_automatico: 'CONFLITTO', motivo: 'test',
    candidati: [2, 3], macro_famiglie: {wiktionary: [3], phonitalia: [2]}, evidenze: {wiktionary: e(3), wiktionary_ipa: e(3), wikipron: e(3), phonitalia: e(2)},
    decisione_base: null, priorita: 'prioritaria'}))};
const name = 'anagrammi-revisore-test-' + crypto.randomUUID();
let db;
try {
  validatePackage(p); db = await openDB(name); const session = newSession(hash, p.record, 'TEST SINTETICO');
  await mutate(db, null, session, [], p);
  let state = await load(db); assert(state.package.record.length === 3, 'Importazione atomica di tre record');
  const decision = makeDecision(p.record[0], 'CONFERMA', [4], 'TEST SINTETICO');
  const next = structuredClone(state.session); next.cursor = 'testdue'; next.notes = {testuno: 'Nota salvata'};
  const beforeNext = JSON.stringify(next); Object.freeze(next);
  const saving = mutate(db, state.session, next, [decision]);
  assert(JSON.stringify(next) === beforeNext, 'Input mutate invariato mentre il salvataggio e in corso');
  const committed = await saving;
  assert(JSON.stringify(next) === beforeNext && committed !== next && committed.revision === next.revision + 1,
    'Input mutate invariato dopo il commit; restituita copia con nuova revisione');
  db.close(); db = await openDB(name); state = await load(db);
  assert(state.decisions.get('testuno').conteggi[0] === 4 && state.session.cursor === 'testdue', 'Riapertura: decisione e cursore persistiti insieme');
  assert(state.session.notes.testuno === 'Nota salvata', 'Bozza nota persistita');
  const aborted = structuredClone(state.session), beforeAbort = JSON.stringify(aborted);
  const abortingDB = {transaction(...args) {
    const tx = db.transaction(...args);
    const sessionStore = tx.objectStore('session'), put = sessionStore.put.bind(sessionStore);
    sessionStore.put = value => {
      const written = put(value);
      written.addEventListener('success', () => tx.abort());
      return written;
    };
    return tx;
  }};
  let cancelled = false;
  try { await mutate(abortingDB, state.session, aborted, [makeDecision(p.record[1], 'CONFERMA', [5], 'TEST SINTETICO')]); }
  catch { cancelled = true; }
  const afterAbort = await load(db);
  assert(cancelled && JSON.stringify(aborted) === beforeAbort && afterAbort.session.revision === state.session.revision && !afterAbort.decisions.has('testdue'),
    'Abort dopo la scrittura: input e dati salvati invariati');
  const stale = structuredClone(state.session), updated = structuredClone(state.session);
  const ambiguous = makeDecision(p.record[1], 'AMBIGUO', [3, 2], 'TEST SINTETICO');
  await mutate(db, state.session, updated, [ambiguous]);
  let refused = false; try { await mutate(db, stale, structuredClone(stale), [makeDecision(p.record[1], 'CONFERMA', [5], 'TEST SINTETICO')]); } catch { refused = true; }
  state = await load(db);
  assert(refused && state.decisions.get('testdue').azione === 'AMBIGUO', 'Scheda obsoleta rifiutata senza sovrascrivere');
  const revoked = structuredClone(state.session); await mutate(db, state.session, revoked, [{parola: 'testuno', remove: true}]);
  state = await load(db); assert(!state.decisions.has('testuno'), 'Revoca persistita');
  const skipped = structuredClone(state.session); skipped.skipped = ['testtre']; await mutate(db, state.session, skipped);
  state = await load(db); const proposals = exportProposals(p, state.decisions, state.session.sessionId);
  assert(proposals.decisioni.length === 1 && proposals.decisioni[0].parola === 'testdue', 'Saltata non esportata');
  const plan = importPlan(proposals, p, state.decisions); await mutate(db, state.session, structuredClone(state.session), plan.decisions);
  state = await load(db); assert(state.decisions.size === 1, 'Backup compatibile/idempotente');
  const excluded = makeDecision(p.record[2], 'ESCLUDI', [], 'TEST SINTETICO');
  await mutate(db, state.session, structuredClone(state.session), [excluded]);
  state = await load(db); assert(state.decisions.get('testtre').conteggi.length === 0, 'Esclusione solo proposta, senza conteggi');
  const wrong = structuredClone(state.session); wrong.packageId = 'wrong';
  let mismatch = false; try { await mutate(db, wrong, wrong); } catch { mismatch = true; }
  assert(mismatch, 'Pacchetto concorrente incompatibile rifiutato');
  const beforeMismatch = JSON.stringify(wrong);
  let replacementRequired = false;
  try { await mutate(db, state.session, wrong, [{parola: 'testdue', remove: true}]); }
  catch { replacementRequired = true; }
  const unchanged = await load(db);
  assert(replacementRequired && JSON.stringify(wrong) === beforeMismatch && unchanged.session.packageId === state.session.packageId &&
    unchanged.session.revision === state.session.revision && unchanged.decisions.has('testdue') && unchanged.package.record.length === 3,
    'Cambio packageId senza replacement rifiutato anche con expected valido');
  const replaced = await mutate(db, unchanged.session, wrong, [], p);
  const afterReplacement = await load(db);
  assert(replaced.packageId === 'wrong' && replaced.revision === unchanged.session.revision + 1 && afterReplacement.session.packageId === 'wrong' &&
    afterReplacement.package.record.length === 3 && afterReplacement.decisions.size === 0 && JSON.stringify(wrong) === beforeMismatch,
    'Cambio packageId con vera sostituzione consentito e atomico');
  output.textContent = results.length + ' VERIFICHE SUPERATE\n' + results.join('\n');
} catch (error) { output.textContent = 'ERRORE\n' + results.join('\n') + '\n' + error.message; }
finally {
  db?.close();
  // This database contains only this test's disposable synthetic fixtures.
  indexedDB.deleteDatabase(name);
}
