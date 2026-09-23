/* Astral fit helper — scales a fixed-size game to fit the window, centered,
 * and re-fits on every resize. Added to games that don't resize themselves.
 *
 *   <script src="/_astral/fit.js" data-target="#canvas"></script>
 *
 * data-target  CSS selector of the element to fit (required)
 * data-w/h     natural size; default = the element's own layout size
 * data-max     max scale (default 4); use 1 to only ever shrink
 * data-bg      page background (default #000)
 * data-remap   for engines that ignore the scale when mapping clicks:
 *              "1"   remap clientX/Y (Unity 5 JSEvents: clientX - rect.left)
 *              "all" also remap pageX/Y (GameMaker: pageX - offsetLeft)
 *
 * Uses a CSS transform. getBoundingClientRect()-aware input (Emscripten SDL,
 * Construct, DOM clicks) stays correct on its own; use data-remap for the rest.
 */
(function () {
  var me = document.currentScript;
  var sel = me.getAttribute("data-target");
  var W = +me.getAttribute("data-w") || 0;
  var H = +me.getAttribute("data-h") || 0;
  var MAX = +me.getAttribute("data-max") || 4;
  var bg = me.getAttribute("data-bg") || "#000";
  var REMAP = me.getAttribute("data-remap");
  var REMAP_PAGE = REMAP === "all";
  var scale = 1;

  var css = document.createElement("style");
  css.textContent =
    "html,body{margin:0!important;padding:0!important;overflow:hidden!important;width:100%;height:100%;background:" + bg + "}" +
    sel + "{position:absolute!important;margin:0!important;transform-origin:0 0!important}";
  (document.head || document.documentElement).appendChild(css);

  var el, pending = false;
  function fit() {
    pending = false;
    el = el && el.isConnected ? el : document.querySelector(sel);
    if (!el) return;
    var prev = el.style.transform;
    el.style.transform = "none";
    var w = W || el.offsetWidth, h = H || el.offsetHeight;
    if (!w || !h) { el.style.transform = prev; return; }
    var vw = window.innerWidth, vh = window.innerHeight;
    var s = Math.min(vw / w, vh / h, MAX);
    el.style.left = Math.round((vw - w * s) / 2) + "px";
    el.style.top = Math.round((vh - h * s) / 2) + "px";
    el.style.transform = "scale(" + s + ")";
    scale = s;
  }

  if (REMAP) {
    var remap = function (e) {
      if (scale === 1 || !el || !(e.target === el || el.contains(e.target))) return;
      var r = el.getBoundingClientRect();
      var x = r.left + (e.clientX - r.left) / scale, y = r.top + (e.clientY - r.top) / scale;
      try {
        Object.defineProperty(e, "clientX", { value: x }); Object.defineProperty(e, "clientY", { value: y });
        Object.defineProperty(e, "offsetX", { value: x - r.left }); Object.defineProperty(e, "offsetY", { value: y - r.top });
        if (REMAP_PAGE) { Object.defineProperty(e, "pageX", { value: x + scrollX }); Object.defineProperty(e, "pageY", { value: y + scrollY }); }
      } catch (err) {}
    };
    ["mousedown", "mouseup", "mousemove", "click", "dblclick", "wheel", "contextmenu",
     "pointerdown", "pointerup", "pointermove"].forEach(function (t) { window.addEventListener(t, remap, true); });
  }
  function schedule() { if (!pending) { pending = true; requestAnimationFrame(fit); } }

  window.addEventListener("resize", schedule);
  document.addEventListener("fullscreenchange", schedule);
  // games often create/resize their element after load
  var tries = 0, iv = setInterval(function () { schedule(); if (++tries > 40) clearInterval(iv); }, 250);
  if (window.ResizeObserver) {
    // transforms don't trigger ResizeObserver, so this only fires on real size changes
    var ro = new ResizeObserver(schedule);
    var watch = setInterval(function () { var t = document.querySelector(sel); if (t) { el = t; ro.observe(t); clearInterval(watch); } }, 100);
  }
  schedule();
})();
