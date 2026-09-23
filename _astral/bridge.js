/* Save bridge (runs in the hub page).
 *
 * Game saves live in the hub's origin (localStorage + IndexedDB), so they don't
 * follow the player if the hub's address changes. When the hub runs inside the
 * about:blank launcher, it hands the launcher a snapshot of all save data to
 * keep on the player's device, and restores it into any fresh origin before a
 * game starts.
 *
 * Protocol (postMessage, hub <-> launcher window):
 *   hub -> parent  {astral: "hello"}
 *   parent -> hub  {astral: "restore", snapshot: <object|null>}
 *   hub -> parent  {astral: "save", snapshot}
 */
(function () {
  var MARK = "astral.bridge.initialized";
  // One-time move of keys saved under the hub's previous name.
  try {
    [["umbra.bridge.initialized", MARK], ["umbra.recent", "astral.recent"]].forEach(function (p) {
      var v = localStorage.getItem(p[0]);
      if (v !== null) { if (localStorage.getItem(p[1]) === null) localStorage.setItem(p[1], v); localStorage.removeItem(p[0]); }
    });
  } catch (e) {}
  // Unity's asset cache holds re-downloadable build files, not saves — skip it.
  var SKIP_DB = /^(UnityCache|__astral)/;
  var MAX_VALUE_BYTES = 8 * 1024 * 1024;
  var parentWin = window.parent !== window ? window.parent : null;

  function reqP(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }

  function openDb(name, version, upgrade) {
    return new Promise(function (res, rej) {
      var r = version ? indexedDB.open(name, version) : indexedDB.open(name);
      r.onupgradeneeded = function (e) { if (upgrade) upgrade(r.result, e); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
      r.onblocked = function () { rej(new Error("blocked")); };
    });
  }

  function sizeOf(v) {
    if (v == null) return 0;
    if (v instanceof Blob) return v.size;
    if (v instanceof ArrayBuffer) return v.byteLength;
    if (ArrayBuffer.isView(v)) return v.byteLength;
    if (typeof v === "string") return v.length * 2;
    if (typeof v === "object") { var n = 0; for (var k in v) { if (Object.prototype.hasOwnProperty.call(v, k)) n += sizeOf(v[k]); } return n; }
    return 8;
  }

  async function dumpIdb() {
    if (!indexedDB.databases) return [];
    var out = [];
    var list = await indexedDB.databases();
    for (var i = 0; i < list.length; i++) {
      var info = list[i];
      if (!info.name || SKIP_DB.test(info.name)) continue;
      var db;
      try { db = await openDb(info.name); } catch (e) { continue; }
      var entry = { name: db.name, version: db.version, stores: [] };
      var names = Array.prototype.slice.call(db.objectStoreNames);
      for (var j = 0; j < names.length; j++) {
        try {
          var tx = db.transaction(names[j], "readonly");
          var st = tx.objectStore(names[j]);
          var keys = await reqP(st.getAllKeys());
          var vals = await reqP(st.getAll());
          var recs = [];
          for (var k = 0; k < keys.length; k++) if (sizeOf(vals[k]) <= MAX_VALUE_BYTES) recs.push([keys[k], vals[k]]);
          entry.stores.push({
            name: st.name, keyPath: st.keyPath, autoIncrement: st.autoIncrement,
            indexes: Array.prototype.map.call(st.indexNames, function (n) { var ix = st.index(n); return { name: ix.name, keyPath: ix.keyPath, unique: ix.unique, multiEntry: ix.multiEntry }; }),
            records: recs,
          });
        } catch (e) { /* unreadable store — skip */ }
      }
      db.close();
      out.push(entry);
    }
    return out;
  }

  async function restoreIdb(dbs) {
    for (var i = 0; i < (dbs || []).length; i++) {
      var d = dbs[i];
      try {
        var db = await openDb(d.name, d.version, function (db) {
          d.stores.forEach(function (s) {
            if (db.objectStoreNames.contains(s.name)) return;
            var os = db.createObjectStore(s.name, s.keyPath != null ? { keyPath: s.keyPath, autoIncrement: s.autoIncrement } : { autoIncrement: s.autoIncrement });
            (s.indexes || []).forEach(function (ix) { try { os.createIndex(ix.name, ix.keyPath, { unique: ix.unique, multiEntry: ix.multiEntry }); } catch (e) {} });
          });
        });
        for (var j = 0; j < d.stores.length; j++) {
          var s = d.stores[j];
          if (!db.objectStoreNames.contains(s.name)) continue;
          await new Promise(function (res) {
            var tx = db.transaction(s.name, "readwrite");
            var os = tx.objectStore(s.name);
            s.records.forEach(function (r) { try { if (s.keyPath != null) os.put(r[1]); else os.put(r[1], r[0]); } catch (e) {} });
            tx.oncomplete = tx.onerror = tx.onabort = function () { res(); };
          });
        }
        db.close();
      } catch (e) { /* version conflict etc. — leave that db alone */ }
    }
  }

  async function snapshot() {
    var ls = {};
    for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k !== MARK) ls[k] = localStorage.getItem(k); }
    return { v: 1, at: Date.now(), origin: location.origin, ls: ls, idb: await dumpIdb() };
  }

  async function restore(snap) {
    if (!snap || snap.v !== 1) return;
    Object.keys(snap.ls || {}).forEach(function (k) { if (localStorage.getItem(k) === null) { try { localStorage.setItem(k, snap.ls[k]); } catch (e) {} } });
    await restoreIdb(snap.idb);
  }

  var lastSent = 0, saving = null;
  function save() {
    if (!parentWin) return Promise.resolve();
    if (saving) return saving;
    saving = snapshot().then(function (s) {
      lastSent = Date.now();
      parentWin.postMessage({ astral: "save", snapshot: s }, "*");
    }).catch(function () {}).then(function () { saving = null; });
    return saving;
  }

  var ready = new Promise(function (resolve) {
    if (!parentWin) return resolve();
    var done = false;
    function finish() { if (!done) { done = true; window.removeEventListener("message", onMsg); resolve(); } }
    function onMsg(e) {
      if (e.source !== parentWin || !e.data || e.data.astral !== "restore") return;
      var fresh = localStorage.getItem(MARK) === null;
      (fresh ? restore(e.data.snapshot) : Promise.resolve()).catch(function () {}).then(function () {
        try { localStorage.setItem(MARK, String(Date.now())); } catch (err) {}
        finish();
      });
    }
    window.addEventListener("message", onMsg);
    parentWin.postMessage({ astral: "hello" }, "*");
    setTimeout(finish, 2500);   // launcher without a bridge (or an old one): carry on
  });

  // Back up regularly while playing, and whenever the page is hidden/closed.
  setInterval(function () { if (Date.now() - lastSent > 25000) save(); }, 30000);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") save(); });
  window.addEventListener("pagehide", save);

  window.AstralBridge = { ready: ready, save: save, snapshot: snapshot };
})();
