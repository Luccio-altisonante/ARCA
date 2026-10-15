import {STATES, SOURCES, MAX_BYTES, validatePackage, makeDecision, filtered, progress,
  newSession, exportProposals, importPlan} from './reviewer-core.mjs';
import {openDB, load, mutate} from './db.mjs';

const $ = id => document.getElementById(id);
const labels = {wiktionary: 'Wiktionary', wiktionary_ipa: 'IPA Wiktionary', wikipron: 'WikiPron', phonitalia: 'PhonItalia'};
let db, state = {package: null, decisions: new Map(), session: null}, pending = 0, chain = Promise.resolve(), waitingWorker, installPrompt, externalEpoch = 0;
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('sillabe-reviewer-v1') : null;
const tabId = crypto.randomUUID?.() || [...crypto.getRandomValues(new Uint8Array(16))].join('-');
const peers = new Map();

function message(text) { $('message').textContent = text; $('message').hidden = !text; }
function ask(text) {
  return new Promise(resolve => {
    const dialog = $('confirm-dialog'); $('confirm-message').textContent = text;
    const cancel = () => finish(false), accept = () => finish(true);
    const escape = event => { event.preventDefault(); finish(false); };
    function finish(answer) {
      $('confirm-cancel').removeEventListener('click', cancel);
      $('confirm-accept').removeEventListener('click', accept);
      dialog.removeEventListener('cancel', escape); dialog.close(); resolve(answer);
    }
    $('confirm-cancel').addEventListener('click', cancel);
    $('confirm-accept').addEventListener('click', accept);
    dialog.addEventListener('cancel', escape); dialog.showModal(); $('confirm-cancel').focus();
  });
}
function busy() {
  for (const id of ['actions', 'navigation']) $(id).disabled = pending > 0;
  for (const id of ['package-file', 'proposals-file', 'export', 'share', 'first', 'update']) $(id).disabled = pending > 0 || id !== 'package-file' && !state.package;
}
function run(task, repaint = true) {
  const epoch = externalEpoch;
  pending++; busy(); $('save-status').textContent = 'Salvataggio…';
  const operation = chain.then(() => { if (epoch !== externalEpoch) throw new Error('Sessione cambiata in un’altra scheda: ripeti la scelta sul dato aggiornato.'); return task(); }).then(() => { if (repaint) render(); $('save-status').textContent = state.session ? 'Salvato sul dispositivo' : 'Nessuna sessione'; return true; })
    .catch(async error => { message(error.message); $('save-status').textContent = 'Operazione non salvata';
      if (error.message.includes('altra scheda') || error.message.includes('un’altra scheda')) { state = await load(db); render(); }
      return false;
    }).finally(() => { pending--; busy(); });
  chain = operation; return operation;
}
async function commit(next, changes = [], replacement = null) {
  const expected = state.session;
  next = await mutate(db, expected, next, changes, replacement);
  if (replacement) state = {package: replacement, decisions: new Map(), session: next};
  else {
    for (const d of changes) { if (d.remove) state.decisions.delete(d.parola); else state.decisions.set(d.parola, d); }
    state.session = next;
  }
  channel?.postMessage({type: 'changed', tabId, packageId: next.packageId});
}
function cloneSession() { return structuredClone(state.session); }
function items() { return state.package ? filtered(state.package.record, state.decisions, state.session.skipped, state.session.filters) : []; }
function current() { return state.package?.record.find(r => r.parola === state.session.cursor); }
function showNumbers(values) { return values.length ? values.join(' / ') : '—'; }
function element(tag, text) { const e = document.createElement(tag); e.textContent = text; return e; }
function draft(word) { return Object.hasOwn(state.session.notes, word) ? state.session.notes[word] : ''; }

function render() {
  $('review').hidden = !state.package;
  $('export').disabled = !state.package; $('proposals-file').disabled = !state.package;
  if (!state.package) { busy(); return; }
  $('author').value = state.session.author;
  const p = progress(state.package.record, state.decisions, state.session.skipped);
  $('progress').textContent = `${p.decise} decise · ${p.saltate} saltate · ${p.da_fare} da fare`;
  $('progress-bar').max = p.totale; $('progress-bar').value = p.decise;
  $('package-info').textContent = `${state.package.coda} · ${p.totale} parole · ${state.session.packageId.slice(0, 12)}${state.package.base.curatela_revisione_git_base === null ? ' · Base Git non disponibile' : ''}`;
  if (document.activeElement !== $('search')) $('search').value = state.session.filters.search;
  $('state-filter').value = state.session.filters.state; $('review-filter').value = state.session.filters.review;
  const list = items(); const record = list.find(r => r.parola === state.session.cursor);
  $('no-results').hidden = list.length > 0;
  $('word-view').hidden = !record; $('navigation').hidden = !record;
  if (!record) {
    if (list.length) run(async () => { const next = cloneSession(); next.cursor = list[0].parola; await commit(next); });
    busy(); return;
  }
  const fullIndex = state.package.record.findIndex(r => r.parola === record.parola);
  $('position').textContent = `${fullIndex + 1} / ${p.totale} · ${list.indexOf(record) + 1} / ${list.length} nel filtro`;
  const wordEl = $('word'); wordEl.textContent = record.parola; wordEl.style.fontSize = '';
  // Very long single words stay readable without changing the surrounding layout.
  requestAnimationFrame(() => { if (wordEl.scrollWidth > wordEl.clientWidth) wordEl.style.fontSize = '28px'; });
  $('automatic-state').textContent = record.stato_automatico.replaceAll('_', ' ');
  const summary = $('evidence-summary'); summary.replaceChildren(element('dt', 'R1'), element('dd', String(record.r1)));
  for (const name of SOURCES) summary.append(element('dt', labels[name]), element('dd', showNumbers(record.evidenze[name].conteggi)));
  const details = $('evidence-details'); details.replaceChildren();
  details.append(element('p', 'Motivo: ' + record.motivo.replaceAll('_', ' ')), element('p', 'Candidati: ' + showNumbers(record.candidati)));
  for (const [family, ns] of Object.entries(record.macro_famiglie)) details.append(element('p', `${family}: ${showNumbers(ns)}`));
  for (const name of SOURCES) {
    const evidence = record.evidenze[name]; details.append(element('h4', labels[name]));
    for (const [n, witness] of Object.entries(evidence.testimoni)) {
      const text = Array.isArray(witness) ? witness.join(' · ') : typeof witness === 'object' ? `${witness.phone_syll} (tonica: ${witness.sillaba_tonica})` : witness;
      details.append(element('p', `${n}: ${text}`));
    }
    for (const anomaly of evidence.anomalie) details.append(element('p', 'Anomalia: ' + anomaly.replaceAll('_', ' ')));
    for (const [anomaly, witness] of Object.entries(evidence.esempi_anomalie)) details.append(element('p', `${anomaly.replaceAll('_', ' ')}: ${witness}`));
  }
  if (record.decisione_base) details.append(element('p', `Curatela di base: ${record.decisione_base.azione} ${showNumbers(record.decisione_base.conteggi)}`));
  const decision = state.decisions.get(record.parola);
  $('current-decision').textContent = decision ? `${decision.azione.replaceAll('_', ' ')}${decision.conteggi.length ? ' · ' + showNumbers(decision.conteggi) : ''}` : state.session.skipped.includes(record.parola) ? 'Saltata · Non decisa' : 'Non decisa';
  $('note').value = draft(record.parola);
  $('revoke').hidden = !decision;
  const quick = $('quick-counts'); quick.replaceChildren();
  const suggested = [...new Set([1, 2, 3, 4, ...record.candidati, ...(decision?.conteggi || [])])].sort((a, b) => a - b);
  for (const n of suggested) {
    const button = element('button', String(n)); button.type = 'button'; button.setAttribute('aria-label', `Conferma ${n} sillabe`);
    button.addEventListener('click', () => decide('CONFERMA', [n])); quick.append(button);
  }
  $('other-count').value = '';
  $('previous').disabled = list.indexOf(record) === 0; $('next').disabled = list.indexOf(record) === list.length - 1;
  busy();
}
function following(next, decisions, word) {
  const list = filtered(state.package.record, decisions, next.skipped, next.filters);
  const originalIndex = currentRecord(word).indice;
  const candidate = list.find(r => r.indice > originalIndex) || list[0];
  next.cursor = candidate?.parola || word;
}
async function decide(action, numbers) {
  const record = current(); if (!record || pending) return;
  const note = $('note').value;
  if (!state.session.author.trim()) { message('Indica l’autore della sessione.'); $('management-details').open = true; $('author').focus(); return; }
  run(async () => {
    if (action === 'ESCLUDI' && !await ask(`Proporre l’esclusione di “${record.parola}”? Il vocabolario non verrà modificato.`)) return;
    const decision = makeDecision(record, action, numbers, state.session.author, note);
    const next = cloneSession(); next.skipped = next.skipped.filter(w => w !== record.parola);
    next.notes = {...next.notes, [record.parola]: note};
    const decisions = new Map(state.decisions); decisions.set(record.parola, decision);
    following(next, decisions, record.parola);
    await commit(next, [decision]); message('');
  });
}
function navigate(direction) {
  if (pending) return;
  run(async () => { const list = items(); const index = list.findIndex(r => r.parola === state.session.cursor);
    const r = list[index + direction]; if (r) { const next = cloneSession(); next.cursor = r.parola; await commit(next); } });
}
async function readFile(input) {
  const file = input.files[0]; if (!file) return null;
  if (file.size === 0 || file.size > MAX_BYTES) throw new Error('File vuoto o superiore a 64 MiB.');
  const bytes = await file.arrayBuffer(); const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  let data; try { data = JSON.parse(text); } catch { throw new Error('File JSON non valido.'); }
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  return {data, hash};
}
$('package-file').addEventListener('change', () => run(async () => {
  try {
    const file = await readFile($('package-file')); if (!file) return;
    const packageData = validatePackage(file.data);
    if (state.session?.packageId === file.hash) { message('Questo pacchetto è già aperto: sessione conservata.'); return; }
    if (state.package && !await ask('Sostituire il pacchetto e la sessione locale? Esporta prima le decisioni da conservare.')) return;
    const next = newSession(file.hash, packageData.record, state.session?.author || $('author').value);
    await commit(next, [], packageData);
    message(''); if (!next.author) { $('management-details').open = true; $('author').focus(); }
    announce('hello');
  } finally { $('package-file').value = ''; }
}));
$('proposals-file').addEventListener('change', () => run(async () => {
  try {
    const file = await readFile($('proposals-file')); if (!file) return;
    const plan = importPlan(file.data, state.package, state.decisions);
    if (plan.conflicts.length && !await ask(`${plan.conflicts.length} decisioni locali differenti (${plan.conflicts.slice(0, 8).map(d => d.parola).join(', ')}). Sostituirle con quelle del backup?`)) return;
    const next = cloneSession();
    for (const d of plan.decisions) { next.skipped = next.skipped.filter(w => w !== d.parola); next.notes = {...next.notes, [d.parola]: d.motivazione}; }
    if (!next.author && plan.decisions.length) next.author = plan.decisions[0].autore;
    await commit(next, plan.decisions); message(`${plan.decisions.length} proposte ripristinate. Nessuna modifica alla curatela ufficiale.`);
  } finally { $('proposals-file').value = ''; }
}));
$('author').addEventListener('input', event => {
  const value = event.target.value;
  if (state.session) run(async () => { const next = cloneSession(); next.author = value; await commit(next); }, false);
});
$('note').addEventListener('input', event => {
  const word = current()?.parola, value = event.target.value;
  if (word) run(async () => { const next = cloneSession(); next.notes = {...next.notes, [word]: value};
    const existing = state.decisions.get(word);
    const changes = existing ? [makeDecision(currentRecord(word), existing.azione, existing.conteggi, existing.autore, value)] : [];
    await commit(next, changes); }, false);
});
function currentRecord(word) { return state.package.record.find(r => r.parola === word); }
$('other-form').addEventListener('submit', event => { event.preventDefault(); decide('CONFERMA', [Number($('other-count').value)]); });
$('defer').addEventListener('click', () => decide('DA_RIVEDERE', []));
$('exclude').addEventListener('click', () => decide('ESCLUDI', []));
$('revoke').addEventListener('click', () => run(async () => { const next = cloneSession(); await commit(next, [{parola: next.cursor, remove: true}]); }));
$('previous').addEventListener('click', () => navigate(-1)); $('next').addEventListener('click', () => navigate(1));
$('skip').addEventListener('click', () => run(async () => {
  const next = cloneSession(), word = next.cursor;
  if (state.decisions.has(word)) throw new Error('Revoca prima la decisione per lasciare la parola soltanto saltata.');
  if (!next.skipped.includes(word)) next.skipped.push(word);
  const list = items(), index = list.findIndex(r => r.parola === word);
  next.cursor = (list[index + 1] || list[0])?.parola || word; await commit(next);
}));
$('first').addEventListener('click', () => run(async () => { const r = state.package.record.find(x => !state.decisions.has(x.parola));
  if (!r) { message('Tutte le parole hanno una proposta.'); return; }
  const next = cloneSession(); next.filters = {search: '', state: '', review: 'non_decise'}; next.cursor = r.parola; await commit(next); }));
for (const [id, key] of [['search', 'search'], ['state-filter', 'state'], ['review-filter', 'review']]) {
  $(id).addEventListener(id === 'search' ? 'input' : 'change', event => {
    const value = event.target.value;
    run(async () => { const next = cloneSession(); next.filters[key] = value;
      const list = filtered(state.package.record, state.decisions, next.skipped, next.filters);
      if (!list.some(r => r.parola === next.cursor) && list.length) next.cursor = list[0].parola;
      await commit(next); });
  });
}
function ambiguityOption(n, checked = false) {
  if ([...$('ambiguity-counts').querySelectorAll('input')].some(x => Number(x.value) === n)) return;
  const label = element('label', ''); const input = document.createElement('input'); input.type = 'checkbox'; input.value = n; input.checked = checked;
  label.append(input, document.createTextNode(String(n))); $('ambiguity-counts').append(label);
}
$('ambiguous').addEventListener('click', () => {
  const r = current(), decision = state.decisions.get(r.parola);
  $('ambiguity-counts').replaceChildren(); $('ambiguity-error').textContent = ''; $('ambiguity-other').value = '';
  for (const n of [...new Set([1, 2, 3, 4, 5, 6, ...r.candidati, ...(decision?.conteggi || [])])].sort((a, b) => a - b)) ambiguityOption(n, decision?.azione === 'AMBIGUO' && decision.conteggi.includes(n));
  $('ambiguity-dialog').showModal();
});
$('add-ambiguity').addEventListener('click', () => {
  const n = Number($('ambiguity-other').value);
  if (!Number.isSafeInteger(n) || n < 1 || n > 1000000) { $('ambiguity-error').textContent = 'Inserisci un intero positivo.'; return; }
  ambiguityOption(n, true); $('ambiguity-other').value = ''; $('ambiguity-error').textContent = '';
});
$('ambiguity-form').addEventListener('submit', event => { event.preventDefault();
  const ns = [...$('ambiguity-counts').querySelectorAll('input:checked')].map(x => Number(x.value));
  if (ns.length < 2) { $('ambiguity-error').textContent = 'Scegli almeno due conteggi distinti.'; return; }
  $('ambiguity-dialog').close(); decide('AMBIGUO', ns);
});
$('cancel-ambiguity').addEventListener('click', () => $('ambiguity-dialog').close());
function exportFile() {
  const data = exportProposals(state.package, state.decisions, state.session.sessionId);
  return new File([JSON.stringify(data, null, 2) + '\n'], `proposte-sillabe-${state.session.sessionId}.json`, {type: 'application/json'});
}
$('export').addEventListener('click', () => {
  const file = exportFile(); const url = URL.createObjectURL(file), link = document.createElement('a');
  link.href = url; link.download = file.name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
});
$('share').hidden = !navigator.canShare;
$('share').addEventListener('click', async () => { try { const file = exportFile();
  if (navigator.canShare({files: [file]})) await navigator.share({files: [file], title: 'Proposte sillabe'});
  else message('Condivisione file non disponibile. Usa Esporta decisioni.');
} catch (error) { if (error.name !== 'AbortError') message(error.message); } });
$('persistent').addEventListener('click', async () => {
  try { const granted = await navigator.storage?.persist?.(); message(granted ? 'Archiviazione persistente concessa.' : 'Archiviazione persistente non concessa. Conserva un backup delle decisioni.'); }
  catch (error) { message(error.message); }
});
function announce(type = 'heartbeat') {
  if (state.session) channel?.postMessage({type, tabId, packageId: state.session.packageId});
  const now = Date.now(); for (const [id, peer] of peers) if (now - peer.time > 15000) peers.delete(id);
  $('multi-tab').hidden = ![...peers.values()].some(peer => peer.packageId === state.session?.packageId);
}
if (channel) channel.onmessage = event => {
  const data = event.data;
  if (data.tabId === tabId || !data.tabId) return;
  if (data.type === 'bye') peers.delete(data.tabId);
  else peers.set(data.tabId, {time: Date.now(), packageId: data.packageId});
  if (data.type === 'hello') announce();
  if (data.type === 'changed') {
    chain = chain.then(async () => { state = await load(db); externalEpoch++; render(); message('Sessione aggiornata da un’altra scheda.'); }).catch(error => message(error.message));
  }
  announce();
};
// Announcements do not answer heartbeats, avoiding a ping-pong between tabs.
if (channel) {
  const handler = channel.onmessage;
  channel.onmessage = event => {
    const data = event.data;
    if (data.type === 'heartbeat') { peers.set(data.tabId, {time: Date.now(), packageId: data.packageId});
      $('multi-tab').hidden = ![...peers.values()].some(peer => peer.packageId === state.session?.packageId); return; }
    handler(event);
  };
  setInterval(() => announce(), 5000);
  addEventListener('pagehide', () => channel.postMessage({type: 'bye', tabId}));
}
addEventListener('visibilitychange', () => { if (!document.hidden && db) chain = chain.then(async () => { const restored = await load(db); if (restored.session?.packageId !== state.session?.packageId || restored.session?.revision !== state.session?.revision) externalEpoch++; state = restored; render(); announce('hello'); }); });
addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('install').hidden = false; });
$('install').addEventListener('click', async () => { if (installPrompt) { await installPrompt.prompt(); installPrompt = null; $('install').hidden = true; } });
$('update').addEventListener('click', () => { if (pending) return; waitingWorker?.postMessage('ACTIVATE'); });
async function setupOffline() {
  if (!('serviceWorker' in navigator)) { $('offline').textContent = 'Offline non disponibile in questo browser'; return; }
  try {
    const registration = await navigator.serviceWorker.register('./service-worker.js');
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (waitingWorker) location.reload(); else $('offline').textContent = 'App pronta offline'; });
    const ready = await navigator.serviceWorker.ready;
    if (ready.active) $('offline').textContent = 'App pronta offline';
    const update = () => { waitingWorker = registration.waiting; $('update').hidden = !waitingWorker; };
    update(); registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', update));
  } catch { $('offline').textContent = 'App shell non disponibile offline'; }
}
for (const value of STATES) { const option = element('option', value.replaceAll('_', ' ')); option.value = value; $('state-filter').append(option); }
try {
  db = await openDB(); state = await load(db);
  if (state.package) validatePackage(state.package);
  render(); $('save-status').textContent = state.session ? 'Sessione ripristinata' : 'Nessuna sessione'; announce('hello');
  await setupOffline();
} catch (error) { message('Impossibile aprire la sessione: ' + error.message); }
