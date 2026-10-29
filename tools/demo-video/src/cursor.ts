/**
 * Runs in every page before its scripts: a visible arrow cursor that follows the (otherwise invisible) Playwright
 * mouse, a ripple on each click, and a watcher that remembers any Sonner error toast so the recorder can fail the run.
 */
export function pageOverlay() {
  const w = window as unknown as { __demoError?: string; __demoX?: number; __demoY?: number };
  const install = () => {
    if (document.getElementById("__demo-cursor")) return;
    const c = document.createElement("div");
    c.id = "__demo-cursor";
    c.innerHTML =
      '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 2l16 9-7 1.6L9.6 20z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none", transform: `translate(${w.__demoX ?? -40}px, ${w.__demoY ?? -40}px)` });
    document.documentElement.appendChild(c);
    document.addEventListener("mousemove", (e) => {
      w.__demoX = e.clientX;
      w.__demoY = e.clientY;
      c.style.transform = `translate(${e.clientX - 3}px, ${e.clientY - 2}px)`;
    }, true);
    document.addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      Object.assign(r.style, {
        position: "fixed", left: `${e.clientX - 18}px`, top: `${e.clientY - 18}px`, width: "36px", height: "36px", borderRadius: "50%",
        background: "rgba(37,99,235,.35)", border: "2px solid rgba(37,99,235,.8)", zIndex: "2147483646", pointerEvents: "none",
        transition: "transform .45s ease-out, opacity .45s ease-out",
      });
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = "scale(1.8)"; r.style.opacity = "0"; });
      setTimeout(() => r.remove(), 500);
    }, true);
    new MutationObserver(() => {
      const t = document.querySelector('[data-sonner-toast][data-type="error"]');
      if (t && !w.__demoError) w.__demoError = (t.textContent ?? "").trim() || "error";
    }).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
}
