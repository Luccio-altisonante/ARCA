const NAME = 'anagrammi-revisore-sillabe';
export function openDB(name = NAME) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('packages', {keyPath: 'id'});
      db.createObjectStore('records', {keyPath: 'parola'});
      db.createObjectStore('decisions', {keyPath: 'parola'});
      db.createObjectStore('session', {keyPath: 'id'});
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Chiudi le altre schede del revisore per aggiornare il database.'));
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}
function request(r) { return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
function complete(tx) {
  return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error || new Error('Salvataggio annullato.')); tx.onerror = () => {}; });
}
function transaction(db, stores) {
  try { return db.transaction(stores, 'readwrite', {durability: 'strict'}); }
  catch { return db.transaction(stores, 'readwrite'); }
}
export async function load(db) {
  const tx = db.transaction(['packages', 'records', 'decisions', 'session'], 'readonly');
  const done = complete(tx);
  const [packages, records, decisions, session] = await Promise.all([
    request(tx.objectStore('packages').getAll()), request(tx.objectStore('records').getAll()),
    request(tx.objectStore('decisions').getAll()), request(tx.objectStore('session').get('current'))]);
  await done;
  records.sort((a, b) => a.indice - b.indice);
  const metadata = packages[0];
  return {package: metadata ? {...metadata.package, record: records} : null,
    decisions: new Map(decisions.map(d => [d.parola, d])), session};
}
// Package replacement, decisions and cursor are committed together. A stale tab
// cannot write after another tab advances the session revision.
export async function mutate(db, expected, next, changes = [], replacement = null) {
  const tx = transaction(db, ['packages', 'records', 'decisions', 'session']);
  let reason, committed;
  const done = complete(tx).catch(error => { throw reason || error; });
  const current = tx.objectStore('session').get('current');
  current.onsuccess = () => {
    const saved = current.result;
    if ((expected && (!saved || saved.packageId !== expected.packageId || saved.revision !== expected.revision)) || (!expected && saved)) {
      reason = new Error('La sessione è cambiata in un’altra scheda. Ricarica prima di continuare.'); tx.abort(); return;
    }
    if (replacement === null && saved && next.packageId !== saved.packageId) {
      reason = new Error('Il pacchetto può cambiare solo insieme alla sua sostituzione.'); tx.abort(); return;
    }
    committed = {...next, revision: (saved?.revision ?? -1) + 1};
    if (replacement) {
      for (const name of ['packages', 'records', 'decisions']) tx.objectStore(name).clear();
      const {record, ...metadata} = replacement;
      tx.objectStore('packages').put({id: next.packageId, package: metadata});
      for (const r of record) tx.objectStore('records').put(r);
    }
    for (const change of changes) {
      if (change.remove) tx.objectStore('decisions').delete(change.parola);
      else tx.objectStore('decisions').put(change);
    }
    tx.objectStore('session').put(committed);
  };
  await done; return committed;
}
