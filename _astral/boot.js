/* Runs first in every game page (the build adds it to each .html file).
 *
 * The page itself comes from rawcdn.githack.com, which serves GitHub files as
 * real web pages. Everything the page loads from there on is pointed at
 * jsDelivr instead, a much sturdier CDN (githack hands images and other
 * binary files off to raw.githubusercontent.com, which GitHub rate-limits).
 *
 * Because the files then come from a different origin than the page:
 *   - files over jsDelivr's 20 MB cap are stored as name.part0, .part1, ...
 *     (listed in data-parts, relative to the repo root); requests for the
 *     original are answered with the pieces joined back together
 *   - workers must load from the page's own origin, so they stay on githack
 *   - the game's images are requested with CORS, so WebGL can still draw them
 * Games' own service workers are turned off; they'd cache the wrong origin.
 */
(function () {
  var me = document.currentScript;
  var m = /^https:\/\/rawcdn\.githack\.com\/([^/]+\/[^/]+)\/([^/]+)\//.exec(location.href);
  if (!m) return;   // not served from githack: leave the page alone
  var PAGE_ROOT = m[0];
  var CDN_ROOT = "https://cdn.jsdelivr.net/gh/" + m[1] + "@" + m[2] + "/";

  var base = document.createElement("base");
  base.href = CDN_ROOT + location.href.slice(PAGE_ROOT.length).replace(/[?#].*$/, "").replace(/[^/]*$/, "");
  me.after(base);

  function abs(u) { try { return new URL(String(u), document.baseURI).href; } catch (e) { return null; } }

  // ── split files ──
  var parts = {};                                 // absolute URL -> piece count
  var list = JSON.parse(me.getAttribute("data-parts") || "{}");
  Object.keys(list).forEach(function (p) { parts[CDN_ROOT + p] = list[p]; });
  var TYPES = { wasm: "application/wasm", js: "text/javascript", json: "application/json" };
  var joined = {};                                // URL -> Promise<Blob>
  var fetch0 = window.fetch.bind(window);

  function splitUrl(u) {
    var a = u == null ? null : abs(u);
    return a && parts[a.split(/[?#]/)[0]] ? a.split(/[?#]/)[0] : null;
  }

  function join(url) {
    if (!joined[url]) {
      var pieces = [];
      for (var i = 0; i < parts[url]; i++) {
        pieces.push(fetch0(url + ".part" + i).then(function (r) {
          if (!r.ok) throw new Error(r.url + ": HTTP " + r.status);
          return r.blob();
        }));
      }
      var type = TYPES[url.split(".").pop().toLowerCase()] || "application/octet-stream";
      joined[url] = Promise.all(pieces).then(function (b) { return new Blob(b, { type: type }); });
      joined[url].catch(function () { delete joined[url]; });   // let a retry download again
    }
    return joined[url];
  }

  window.fetch = function (input, init) {
    var url = splitUrl(input instanceof Request ? input.url : input);
    if (!url) return fetch0(input, init);
    return join(url).then(function (b) {
      return new Response(b, { headers: { "Content-Type": b.type, "Content-Length": String(b.size) } });
    });
  };

  // XHR: hold open() for split files, then open the joined blob when send() is called.
  var X = XMLHttpRequest.prototype, open0 = X.open, send0 = X.send, header0 = X.setRequestHeader;
  X.open = function (method, url) {
    var split = splitUrl(url);
    this.__split = split ? { method: method, url: split, rest: [].slice.call(arguments, 2), headers: [] } : null;
    if (!split) return open0.apply(this, arguments);
  };
  X.setRequestHeader = function (k, v) {
    if (this.__split) this.__split.headers.push([k, v]);
    else header0.call(this, k, v);
  };
  X.send = function (body) {
    var p = this.__split, xhr = this;
    if (!p) return send0.call(this, body);
    join(p.url).then(function (b) {
      open0.apply(xhr, [p.method, URL.createObjectURL(b)].concat(p.rest.length ? p.rest : [true]));
      p.headers.forEach(function (h) { try { header0.call(xhr, h[0], h[1]); } catch (e) {} });
      send0.call(xhr, body);
    }, function (err) {
      console.error("could not load", p.url, err);
      xhr.dispatchEvent(new ProgressEvent("error"));
    });
  };

  // ── workers ──
  ["Worker", "SharedWorker"].forEach(function (name) {
    var W = window[name];
    if (!W) return;
    window[name] = function (url, opts) {
      var a = typeof url === "string" || url instanceof URL ? abs(url) : null;
      if (a && a.indexOf(CDN_ROOT) === 0) url = PAGE_ROOT + a.slice(CDN_ROOT.length);
      return new W(url, opts);
    };
    window[name].prototype = W.prototype;
  });

  // ── images ──
  var src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    configurable: true, enumerable: true, get: src.get,
    set: function (v) {
      if (this.crossOrigin == null && (abs(v) || "").indexOf(CDN_ROOT) === 0) this.crossOrigin = "anonymous";
      src.set.call(this, v);
    },
  });

  // ── service workers ──
  if (navigator.serviceWorker) {
    navigator.serviceWorker.register = function () { return Promise.reject(new Error("service workers are disabled here")); };
  }
})();
