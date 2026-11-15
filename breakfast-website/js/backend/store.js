// The app's database, stored on the tablet itself (IndexedDB, built into Chrome).
// All tables are kept in memory for speed and every change is written to the tablet's storage straight away.

const DB_NAME = 'breakfast-manager';
const DB_VERSION = 1;
export const TABLES = ['users', 'shifts', 'guests', 'arrivals', 'audit_log'];

export const data = Object.fromEntries(TABLES.map((t) => [t, new Map()]));
export const settings = new Map();
const nextId = Object.fromEntries(TABLES.map((t) => [t, 1]));
let idb = null;

function req(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const t of TABLES) if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Close other open copies of the app and try again.'));
  });
}

async function loadAll() {
  const tx = idb.transaction([...TABLES, 'settings'], 'readonly');
  for (const t of TABLES) {
    data[t].clear();
    const rows = await req(tx.objectStore(t).getAll());
    let max = 0;
    for (const row of rows) { data[t].set(row.id, row); if (row.id > max) max = row.id; }
    nextId[t] = max + 1;
  }
  settings.clear();
  for (const s of await req(tx.objectStore('settings').getAll())) settings.set(s.key, s.value);
}

let ready = null;
export function init() {
  ready ||= (async () => {
    if (!('indexedDB' in window)) throw new Error('This browser cannot store data. Please use Chrome.');
    idb = await openDb();
    await loadAll();
    // Ask the tablet to never clear this app's data to free up space.
    try { await navigator.storage?.persist?.(); } catch { /* not supported */ }
  })();
  return ready;
}

// A set of changes that is saved all together, or not at all.
// Changes are visible in memory immediately; if saving fails, everything is reloaded from storage.
export function begin() {
  const ops = [];
  return {
    insert(table, row) {
      const id = nextId[table]++;
      const full = { ...row, id };
      data[table].set(id, full);
      ops.push({ store: table, op: 'put', value: full });
      return full;
    },
    update(table, row) {
      data[table].set(row.id, row);
      ops.push({ store: table, op: 'put', value: row });
      return row;
    },
    remove(table, id) {
      data[table].delete(id);
      ops.push({ store: table, op: 'delete', key: id });
    },
    setting(key, value) {
      if (value === null || value === undefined) { settings.delete(key); ops.push({ store: 'settings', op: 'delete', key }); }
      else { settings.set(key, value); ops.push({ store: 'settings', op: 'put', value: { key, value } }); }
    },
    async commit() {
      if (!ops.length) return;
      const stores = [...new Set(ops.map((o) => o.store))];
      try {
        await new Promise((resolve, reject) => {
          const tx = idb.transaction(stores, 'readwrite');
          for (const o of ops) {
            const s = tx.objectStore(o.store);
            if (o.op === 'put') s.put(o.value); else s.delete(o.key);
          }
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('Saving was cancelled.'));
        });
      } catch (err) {
        await loadAll();
        const e = new Error(err?.name === 'QuotaExceededError'
          ? 'The tablet is out of storage space. Free up space, then try again.'
          : 'This change could not be saved on the tablet. Please try again.');
        e.status = 500;
        throw e;
      }
    },
  };
}

// ---------- Backup & restore ----------

export function exportAll() {
  return {
    app: 'breakfast-manager',
    format: 1,
    exportedAt: new Date().toISOString(),
    tables: Object.fromEntries(TABLES.map((t) => [t, [...data[t].values()]])),
    settings: Object.fromEntries(settings),
  };
}

export async function replaceAll(backup) {
  if (!backup || backup.app !== 'breakfast-manager' || !backup.tables) {
    throw new Error('This file is not a Breakfast Manager backup.');
  }
  for (const t of TABLES) {
    if (!Array.isArray(backup.tables[t] ?? [])) throw new Error('This backup file is damaged.');
  }
  await new Promise((resolve, reject) => {
    const tx = idb.transaction([...TABLES, 'settings'], 'readwrite');
    for (const t of TABLES) {
      const s = tx.objectStore(t);
      s.clear();
      for (const row of backup.tables[t] || []) if (typeof row?.id === 'number') s.put(row);
    }
    const st = tx.objectStore('settings');
    st.clear();
    for (const [key, value] of Object.entries(backup.settings || {})) st.put({ key, value });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Restore was cancelled.'));
  });
  await loadAll();
}
