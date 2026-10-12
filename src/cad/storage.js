// Persistência local das abas do CAD (IndexedDB, com fallback em localStorage).
// Guarda documentos serializados e o estado de vista de cada aba; nunca sai do navegador.

const DB_NAME = 'mvp-cad';
const STORE = 'workspaces';
const KEY_PREFIX = 'mvp-cad:workspace:';

function openDb() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return resolve(null);
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        return null;
    });
}

export async function saveWorkspace(scope, payload) {
    const key = `${KEY_PREFIX}${scope}`;
    try {
        const db = await openDb();
        if (db) {
            await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put(payload, key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
            db.close();
            return 'indexeddb';
        }
    } catch (error) {
        // cai para localStorage
    }
    try {
        localStorage.setItem(key, JSON.stringify(payload));
        return 'localstorage';
    } catch (error) {
        return null;
    }
}

export async function loadWorkspace(scope) {
    const key = `${KEY_PREFIX}${scope}`;
    try {
        const db = await openDb();
        if (db) {
            const value = await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, 'readonly');
                const req = tx.objectStore(STORE).get(key);
                req.onsuccess = () => resolve(req.result ?? null);
                req.onerror = () => reject(req.error);
            });
            db.close();
            if (value) return value;
        }
    } catch (error) {
        // tenta localStorage
    }
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

export async function clearWorkspace(scope) {
    const key = `${KEY_PREFIX}${scope}`;
    try {
        const db = await openDb();
        if (db) {
            await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).delete(key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
            db.close();
        }
    } catch (error) {
        // ignora
    }
    try { localStorage.removeItem(key); } catch (error) { /* ignora */ }
}

// Serialização de um documento: entidades são objetos simples; remove campos derivados.
export function serializeDocument(doc) {
    return {
        entities: doc.entities,
        blocks: doc.blocks ?? {},
        textStyle: doc.textStyle,
        layers: doc.layers,
        currentLayer: doc.currentLayer,
        units: doc.units,
        name: doc.name,
        filePath: doc.filePath ?? null,
        dimStyle: doc.dimStyle,
        insBase: doc.insBase ?? null,
        sourceFormat: doc.sourceFormat ?? null,
    };
}

export function debounce(fn, wait) {
    let timer = null;
    const wrapped = (...args) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; fn(...args); }, wait);
    };
    wrapped.flush = (...args) => {
        if (timer) { clearTimeout(timer); timer = null; }
        fn(...args);
    };
    return wrapped;
}

export const PENDING_IMPORT_KEY = 'mvp-cad:pending-import';

export function savePendingImport({ name, text, kind = 'dxf' }, storageMock = null) {
    const payload = {
        name: name || 'desenho.dxf',
        text,
        kind,
        timestamp: Date.now(),
    };
    const json = JSON.stringify(payload);
    const store = storageMock || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (store) {
        try { store.setItem(PENDING_IMPORT_KEY, json); } catch {}
    }
    if (typeof sessionStorage !== 'undefined' && !storageMock) {
        try { sessionStorage.setItem(PENDING_IMPORT_KEY, json); } catch {}
    }
    return payload;
}

export function popPendingImport(storageMock = null) {
    let raw = null;
    const store = storageMock || (typeof localStorage !== 'undefined' ? localStorage : null);
    const session = !storageMock && typeof sessionStorage !== 'undefined' ? sessionStorage : null;

    if (store) {
        try {
            raw = store.getItem(PENDING_IMPORT_KEY);
            if (raw) store.removeItem(PENDING_IMPORT_KEY);
        } catch {}
    }
    if (!raw && session) {
        try {
            raw = session.getItem(PENDING_IMPORT_KEY);
            if (raw) session.removeItem(PENDING_IMPORT_KEY);
        } catch {}
    }
    if (!raw) return null;
    try {
        const data = JSON.parse(raw);
        if (data?.timestamp && Date.now() - data.timestamp > 120000) return null;
        return data;
    } catch {
        return null;
    }
}

export const CAD_SETTINGS_KEY = 'mvp-cad:settings';

export function loadCadSettings(storageMock = null) {
    const store = storageMock || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!store) return null;
    try {
        const raw = store.getItem(CAD_SETTINGS_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function saveCadSettings(settings, storageMock = null) {
    const store = storageMock || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!store || !settings) return null;
    try {
        const payload = {
            ortho: Boolean(settings.ortho),
            softAxis: settings.softAxis !== undefined ? Boolean(settings.softAxis) : true,
            polar: Boolean(settings.polar),
            polarIncrement: Number(settings.polarIncrement) || 45,
            osnap: settings.osnap !== undefined ? Boolean(settings.osnap) : true,
            otrack: settings.otrack !== undefined ? Boolean(settings.otrack) : true,
            grid: settings.grid !== undefined ? Boolean(settings.grid) : true,
            snaps: typeof settings.snaps === 'object' && settings.snaps ? { ...settings.snaps } : undefined,
        };
        store.setItem(CAD_SETTINGS_KEY, JSON.stringify(payload));
        return payload;
    } catch {
        return null;
    }
}

