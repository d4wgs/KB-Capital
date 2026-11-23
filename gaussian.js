// The paths and the wordmark share one coordinate system.
class GaussianLogo extends HTMLElement {
  connectedCallback() {
    const widths = [0.095, 0.078, 0.061];
    const heights = [95, 128, 165];
    const speed = 0.8, variation = 0.4, travel = 0.85, baseline = 215;
    const compact = this.hasAttribute('compact');
    this.innerHTML = `<svg viewBox="${compact ? '0 0 230 230' : '0 0 600 280'}" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="${compact ? 9 : 3.8}" stroke-linecap="round" stroke-linejoin="round">
        <path/><path/><path/>
      </g>
      ${compact ? '' : `<text x="300" y="197" text-anchor="middle" font-family="Helvetica Neue, Helvetica, sans-serif"
        font-size="76" font-weight="600" letter-spacing="-3.5" fill="currentColor"
        stroke="white" stroke-width="8" paint-order="stroke fill">kb capital</text>`}</svg>`;
    const paths = this.querySelectorAll('path');
    const {x: textLeft, width: textWidth} = compact
      ? {x: 8, width: 214}
      : this.querySelector('text').getBBox();
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let phase = 2.5, previous, frame, visible = false;
    const sampleCount = compact ? 80 : 400;
    // Carry the header graph forward when a navigation link opens a new document.
    function restorePhase() {
      if (!compact) return;
      try {
        const saved = sessionStorage.getItem('kb-header-phase');
        if (saved !== null && Number.isFinite(Number(saved))) phase = Number(saved);
      } catch { /* Storage is optional. */ }
    }
    function savePhase() {
      try { sessionStorage.setItem('kb-header-phase', String(phase)); } catch { /* Storage is optional. */ }
    }
    function restoreFromCache(event) {
      if (event.persisted) { restorePhase(); draw(); }
    }
    restorePhase();
    if (compact) {
      window.addEventListener('pagehide', savePhase);
      window.addEventListener('pageshow', restoreFromCache);
    }
    function draw() {
      paths.forEach((path, k) => {
        const sigma = widths[k];
        const amplitude = (0.5 - 4 * sigma) * travel;
        const mu = 0.5 + amplitude * Math.sin(phase + k * 1.1);
        const pulse = 0.75 * Math.sin(phase * 0.73 + k * 2.1) +
                      0.25 * Math.sin(phase * 1.31 + k * 0.8);
        const h = Math.min(200, heights[k] * (1 + variation * pulse));
        const points = Array.from({length: sampleCount}, (_, i) => {
          const u = i / (sampleCount - 1);
          const z = (u - mu) / sigma;
          return (i ? 'L' : 'M') + (textLeft + u * textWidth).toFixed(3) + ' ' +
                 (baseline - h * Math.exp(-0.5 * z * z)).toFixed(3);
        });
        path.setAttribute('d', points.join(' '));
      });
    }
    function tick(time) {
      const deltaTime = previous === undefined ? 0 : (time - previous) / 1000;
      previous = time;
      phase += deltaTime * speed * 1.5;
      draw();
      frame = requestAnimationFrame(tick);
    }
    function sync() {
      cancelAnimationFrame(frame);
      previous = undefined;
      if (visible && !document.hidden && !preference.matches) frame = requestAnimationFrame(tick);
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    draw();
    observer.observe(this);
    preference.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    this.cleanup = () => {
      visible = false;
      sync();
      observer.disconnect();
      window.removeEventListener('pagehide', savePhase);
      window.removeEventListener('pageshow', restoreFromCache);
      preference.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }
  disconnectedCallback() { this.cleanup(); }
}
customElements.define('kb-gaussian', GaussianLogo);
