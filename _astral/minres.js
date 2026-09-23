/* Astral min-resolution helper — for Unity games whose UI is a fixed pixel size
 * and overflows small windows (Slope). Below data-min-w x data-min-h:
 *   * the game canvas reports a larger clientWidth/clientHeight, so Unity renders
 *     a bigger backbuffer into the same on-screen canvas (UI fits), and
 *   * mouse/pointer coordinates over the canvas are scaled by the same factor
 *     before Unity reads them, so clicks land where they look.
 * Must load in <head>, before the Unity loader.
 *   <script src="/_astral/minres.js" data-min-w="1100" data-min-h="720"></script>
 */
(function () {
  var me = document.currentScript;
  var MW = +me.getAttribute("data-min-w") || 1100, MH = +me.getAttribute("data-min-h") || 720;
  function k() { return Math.max(1, MW / Math.max(1, innerWidth), MH / Math.max(1, innerHeight)); }
  function isGame(el) { return el instanceof HTMLCanvasElement && (el.id === "#canvas" || el.id === "canvas" || !!el.closest("#gameContainer")); }

  var cw = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth");
  var ch = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight");
  Object.defineProperty(HTMLCanvasElement.prototype, "clientWidth", {
    configurable: true, get: function () { var v = cw.get.call(this); return isGame(this) ? Math.round(v * k()) : v; },
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "clientHeight", {
    configurable: true, get: function () { var v = ch.get.call(this); return isGame(this) ? Math.round(v * k()) : v; },
  });

  function remap(e) {
    var f = k();
    if (f === 1 || !isGame(e.target)) return;
    var r = e.target.getBoundingClientRect();
    var x = r.left + (e.clientX - r.left) * f, y = r.top + (e.clientY - r.top) * f;
    try {
      Object.defineProperty(e, "clientX", { value: x }); Object.defineProperty(e, "clientY", { value: y });
      Object.defineProperty(e, "pageX", { value: x + scrollX }); Object.defineProperty(e, "pageY", { value: y + scrollY });
      Object.defineProperty(e, "offsetX", { value: x - r.left }); Object.defineProperty(e, "offsetY", { value: y - r.top });
    } catch (err) {}
  }
  ["mousedown", "mouseup", "mousemove", "click", "dblclick", "wheel", "contextmenu",
   "pointerdown", "pointerup", "pointermove"].forEach(function (t) { window.addEventListener(t, remap, true); });
})();
