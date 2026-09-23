/* Split-file loader (runs first inside a game page).
 *
 * Static hosts cap file size (Cloudflare Pages: 25 MiB), so the build splits
 * bigger files into name.part0, name.part1, ... and adds this script with the
 * list:  <script src="../_astral/parts.js" data-parts='{"Build/x.wasm": 3}'>
 *
 * Requests the game makes for the original file (fetch or XHR) are answered
 * with the parts joined back together, so the game itself is unchanged.
 */
(function () {
  var me = document.currentScript;
  var list;
  try { list = JSON.parse(me.dataset.parts || "{}"); } catch (e) { return; }
  var TYPES = { wasm: "application/wasm", js: "text/javascript", json: "application/json" };

  var wanted = {};                                   // absolute path -> part count
  Object.keys(list).forEach(function (p) { wanted[new URL(p, document.baseURI).pathname] = list[p]; });

  function match(u) {
    if (u == null) return null;
    var abs;
    try { abs = new URL(String(u), document.baseURI); } catch (e) { return null; }
    if (abs.origin !== location.origin) return null;
    return wanted[abs.pathname] ? abs.pathname : null;
  }

  var joined = {};                                   // path -> Promise<Blob>
  function join(path) {
    if (!joined[path]) {
      var n = wanted[path], reqs = [];
      for (var i = 0; i < n; i++) {
        reqs.push(fetch0(path + ".part" + i).then(function (r) {
          if (!r.ok) throw new Error(r.url + ": HTTP " + r.status);
          return r.blob();
        }));
      }
      var type = TYPES[path.split(".").pop().toLowerCase()] || "application/octet-stream";
      joined[path] = Promise.all(reqs).then(function (parts) { return new Blob(parts, { type: type }); });
      joined[path].catch(function () { delete joined[path]; });   // let a retry fetch again
    }
    return joined[path];
  }

  var fetch0 = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var path = match(input instanceof Request ? input.url : input);
    if (!path) return fetch0(input, init);
    return join(path).then(function (b) {
      return new Response(b, { status: 200, headers: { "Content-Type": b.type, "Content-Length": String(b.size) } });
    });
  };

  // XHR: hold open() for split files, then open the joined blob when send() is called.
  var X = XMLHttpRequest.prototype, open0 = X.open, send0 = X.send, header0 = X.setRequestHeader;
  X.open = function (method, url) {
    var path = match(url);
    this.__astralParts = path ? { method: method, path: path, rest: [].slice.call(arguments, 2), headers: [] } : null;
    if (!path) return open0.apply(this, arguments);
  };
  X.setRequestHeader = function (k, v) {
    if (this.__astralParts) { this.__astralParts.headers.push([k, v]); return; }
    return header0.call(this, k, v);
  };
  X.send = function (body) {
    var p = this.__astralParts, xhr = this;
    if (!p) return send0.call(this, body);
    join(p.path).then(function (b) {
      open0.apply(xhr, [p.method, URL.createObjectURL(b)].concat(p.rest.length ? p.rest : [true]));
      p.headers.forEach(function (h) { try { header0.call(xhr, h[0], h[1]); } catch (e) {} });
      send0.call(xhr, body);
    }, function (err) {
      console.error("[astral] could not load split file", p.path, err);
      xhr.dispatchEvent(new ProgressEvent("error"));
      if (typeof xhr.onerror === "function") xhr.onerror(new ProgressEvent("error"));
    });
  };
})();
