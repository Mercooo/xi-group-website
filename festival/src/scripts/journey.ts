// The invitation page's stage: the opening curtain and the starry sky behind it.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------ the curtain
const root = document.documentElement;
if (root.classList.contains('intro')) {
  const curtain = document.getElementById('curtain')!;
  const open = () => {
    if (root.classList.contains('curtain-open')) return;
    root.classList.add('curtain-open');
    try { sessionStorage.setItem('xi74-curtain', '1'); } catch {}
    setTimeout(() => { curtain.remove(); root.classList.remove('intro', 'curtain-open'); }, 2600);
  };
  curtain.addEventListener('click', open);
  addEventListener('keydown', open, { once: true });
  // Part the curtain once the fonts are in, so the title appears fully formed.
  const ready = Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1200))]);
  ready.then(() => setTimeout(open, 450));
}

// --------------------------------------------------------------- the sky
const canvas = document.getElementById('sky') as HTMLCanvasElement | null;
if (canvas) {
  const ctx = canvas.getContext('2d')!;
  type Star = { x: number; y: number; r: number; base: number; speed: number; phase: number; warm: boolean };
  let stars: Star[] = [];
  let w = 0, h = 0, dpr = 1;
  let shooting: { x: number; y: number; vx: number; vy: number; life: number } | null = null;
  let nextShot = performance.now() + 2600;

  const build = () => {
    dpr = Math.min(2, devicePixelRatio || 1);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const count = Math.round(Math.min(320, (w * h) / 2600));
    stars = Array.from({ length: count }, () => {
      const y = Math.random() ** 1.6 * h * 0.82; // denser high in the sky, thinning towards the horizon
      return { x: Math.random() * w, y, r: Math.random() < 0.08 ? 1.4 + Math.random() * 1.1 : 0.4 + Math.random() * 0.9, base: 0.35 + Math.random() * 0.6, speed: 0.6 + Math.random() * 1.8, phase: Math.random() * Math.PI * 2, warm: Math.random() < 0.18 };
    });
  };

  const draw = (t: number) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      const a = reduce ? s.base : s.base * (0.6 + 0.4 * Math.sin(t / 1000 * s.speed + s.phase));
      ctx.globalAlpha = a;
      ctx.fillStyle = s.warm ? '#ffe2a0' : '#ffffff';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      if (s.r > 1.6) { // a soft cross on the brightest stars
        ctx.globalAlpha = a * 0.5; ctx.fillRect(s.x - s.r * 3, s.y - 0.4, s.r * 6, 0.8); ctx.fillRect(s.x - 0.4, s.y - s.r * 3, 0.8, s.r * 6);
      }
    }
    // Now and then a shooting star crosses the sky.
    if (!reduce) {
      if (!shooting && t > nextShot) {
        shooting = { x: w * (0.15 + Math.random() * 0.6), y: h * (0.05 + Math.random() * 0.2), vx: (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 3), vy: 2 + Math.random() * 1.5, life: 1 };
        nextShot = t + 9000 + Math.random() * 9000;
      }
      if (shooting) {
        const s = shooting;
        const g = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 14, s.y - s.vy * 14);
        g.addColorStop(0, `rgba(255,246,220,${s.life})`); g.addColorStop(1, 'rgba(255,246,220,0)');
        ctx.globalAlpha = 1; ctx.strokeStyle = g; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 14, s.y - s.vy * 14); ctx.stroke();
        s.x += s.vx; s.y += s.vy; s.life -= 0.014;
        if (s.life <= 0) shooting = null;
      }
    }
    ctx.globalAlpha = 1;
  };

  let running = false, raf = 0, visible = true;
  const loop = (t: number) => { draw(t); raf = requestAnimationFrame(loop); };
  const sync = () => {
    const want = visible && document.visibilityState === 'visible' && !reduce;
    if (want && !running) { running = true; raf = requestAnimationFrame(loop); }
    if (!want && running) { running = false; cancelAnimationFrame(raf); }
  };
  build();
  draw(performance.now());
  new ResizeObserver(() => { build(); draw(performance.now()); }).observe(canvas);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); }).observe(canvas);
  document.addEventListener('visibilitychange', sync);
  sync();
}
