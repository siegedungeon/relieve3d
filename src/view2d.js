// 2D editor canvas: shows vectorized pieces, handles selection, zoom and pan.
export class View2D {
  constructor(canvas, cb) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cb = cb;
    this.scale = 1; this.ox = 0; this.oy = 0;
    this.tool = 'select';
    this.showOriginal = false;
    this.showEdges = true;
    this.placing = false;
    this.paths = new Map();
    this.basePath = null;
    this.hover = -1;
    this.rect = null;
    this.space = false;
    this.data = null;

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.bindEvents();
  }

  setContent(result, image) {
    this.result = result;
    this.image = image;
    this.paths.clear();
    for (const p of result.pieces) this.paths.set(p.id, shapesToPath(p.shapes));
    this.hover = -1;
    this.fit();
  }

  setBaseShapes(shapes) { this.basePath = shapes ? shapesToPath(shapes) : null; }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    if (!this._fitted && this.result) this.fit();
    else this.draw();
  }

  fit() {
    if (!this.result) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = this.canvas.width / dpr, ch = this.canvas.height / dpr;
    if (cw < 10 || ch < 10) return;
    const [x0, y0, x1, y1] = this.result.fgBBox;
    const pad = 60;
    const w = x1 - x0, h = y1 - y0;
    this.scale = Math.min((cw - pad * 2) / w, (ch - pad * 2) / h);
    this.ox = cw / 2 - (x0 + w / 2) * this.scale;
    this.oy = ch / 2 - (y0 + h / 2) * this.scale;
    this._fitted = true;
    this.draw();
  }

  zoomAt(factor, sx, sy) {
    const ns = Math.min(80, Math.max(0.05, this.scale * factor));
    const f = ns / this.scale;
    this.ox = sx - (sx - this.ox) * f;
    this.oy = sy - (sy - this.oy) * f;
    this.scale = ns;
    this.draw();
  }

  zoomCenter(factor) {
    const dpr = window.devicePixelRatio || 1;
    this.zoomAt(factor, this.canvas.width / dpr / 2, this.canvas.height / dpr / 2);
  }

  toImage(sx, sy) { return [(sx - this.ox) / this.scale, (sy - this.oy) / this.scale]; }

  pieceAt(x, y) {
    const r = this.result;
    if (!r) return -1;
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= r.width || iy >= r.height) return -1;
    return r.comp[iy * r.width + ix];
  }

  bindEvents() {
    const c = this.canvas;
    let drag = null;
    const local = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [sx, sy] = local(e);
      this.zoomAt(Math.exp(-e.deltaY * 0.0015), sx, sy);
    }, { passive: false });

    c.addEventListener('pointerdown', (e) => {
      if (!this.result) return;
      c.setPointerCapture(e.pointerId);
      const [sx, sy] = local(e);
      const pan = e.button === 1 || e.button === 2 || this.tool === 'pan' || this.space;
      if (pan) { drag = { type: 'pan', sx, sy, ox: this.ox, oy: this.oy }; c.style.cursor = 'grabbing'; return; }
      if (e.button !== 0) return;
      if (this.placing) {
        const [x, y] = this.toImage(sx, sy);
        this.cb.onPlace(x, y);
        return;
      }
      drag = { type: 'select', sx, sy, additive: e.shiftKey || e.ctrlKey || e.metaKey };
    });

    c.addEventListener('pointermove', (e) => {
      if (!this.result) return;
      const [sx, sy] = local(e);
      if (drag?.type === 'pan') {
        this.ox = drag.ox + sx - drag.sx;
        this.oy = drag.oy + sy - drag.sy;
        this.draw();
        return;
      }
      if (drag?.type === 'select' && Math.hypot(sx - drag.sx, sy - drag.sy) > 4) {
        this.rect = [drag.sx, drag.sy, sx, sy];
        this.draw();
        return;
      }
      const [x, y] = this.toImage(sx, sy);
      const h = this.pieceAt(x, y);
      if (h !== this.hover) { this.hover = h; this.cb.onHover(h); this.draw(); }
      c.style.cursor = this.placing ? 'crosshair' : (this.tool === 'pan' || this.space) ? 'grab' : h >= 0 ? 'pointer' : 'default';
    });

    c.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      c.style.cursor = 'default';
      if (d.type !== 'select') return;
      if (this.rect) {
        const [ax, ay] = this.toImage(Math.min(this.rect[0], this.rect[2]), Math.min(this.rect[1], this.rect[3]));
        const [bx, by] = this.toImage(Math.max(this.rect[0], this.rect[2]), Math.max(this.rect[1], this.rect[3]));
        this.rect = null;
        this.cb.onRect([ax, ay, bx, by], d.additive);
      } else {
        const [x, y] = this.toImage(...local(e));
        this.cb.onClick(this.pieceAt(x, y), d.additive);
      }
      this.draw();
    });

    c.addEventListener('pointerleave', () => { if (this.hover !== -1) { this.hover = -1; this.cb.onHover(-1); this.draw(); } });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !isTyping(e)) { this.space = true; e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.space = false; });
  }

  draw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); });
  }

  _draw() {
    const ctx = this.ctx, dpr = window.devicePixelRatio || 1;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawChecker(ctx, W, H, 12 * dpr);
    const r = this.result, d = this.cb.getDrawData?.();
    if (!r || !d) return;

    ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, dpr * this.ox, dpr * this.oy);
    const px = 1 / this.scale;

    if (this.basePath && d.base) {
      ctx.fillStyle = d.base.color;
      ctx.fill(this.basePath, 'evenodd');
      ctx.strokeStyle = 'rgba(0,0,0,.35)';
      ctx.lineWidth = px;
      ctx.stroke(this.basePath);
    }
    for (const p of r.pieces) {
      const path = this.paths.get(p.id);
      const st = d.pieces[p.id];
      ctx.globalAlpha = st.enabled ? 1 : 0.18;
      ctx.fillStyle = st.color;
      ctx.fill(path, 'evenodd');
    }
    ctx.globalAlpha = 1;

    if (this.showOriginal && this.image) {
      ctx.globalAlpha = 0.55;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.image, 0, 0, r.width, r.height);
      ctx.globalAlpha = 1;
    }

    if (this.showEdges) {
      ctx.strokeStyle = 'rgba(30,30,40,.35)';
      ctx.lineWidth = px;
      for (const path of this.paths.values()) ctx.stroke(path);
    }

    if (d.selection.size) {
      ctx.fillStyle = 'rgba(37,99,235,.22)';
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 2 * px;
      for (const id of d.selection) {
        const path = this.paths.get(id);
        if (!path) continue;
        ctx.fill(path, 'evenodd');
        ctx.stroke(path);
      }
    }
    if (this.hover >= 0 && this.paths.get(this.hover)) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.5 * px;
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.stroke(this.paths.get(this.hover));
      ctx.setLineDash([]);
    }
    if (d.ring) this.drawRing(ctx, d.ring, px);

    if (this.rect) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const [a, b, c2, e] = this.rect;
      ctx.fillStyle = 'rgba(37,99,235,.08)';
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 3]);
      ctx.fillRect(Math.min(a, c2), Math.min(b, e), Math.abs(c2 - a), Math.abs(e - b));
      ctx.strokeRect(Math.min(a, c2), Math.min(b, e), Math.abs(c2 - a), Math.abs(e - b));
      ctx.setLineDash([]);
    }
  }

  drawRing(ctx, ring, px) {
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.ro, 0, Math.PI * 2);
    if (ring.ri > 0) { ctx.moveTo(ring.x + ring.ri, ring.y); ctx.arc(ring.x, ring.y, ring.ri, 0, Math.PI * 2, true); }
    ctx.fillStyle = ring.color;
    ctx.fill('evenodd');
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 1.5 * px;
    ctx.stroke();
  }
}

export function shapesToPath(shapes) {
  const path = new Path2D();
  for (const s of shapes) {
    for (const loop of [s.outer, ...s.holes]) {
      path.moveTo(loop[0][0], loop[0][1]);
      for (let i = 1; i < loop.length; i++) path.lineTo(loop[i][0], loop[i][1]);
      path.closePath();
    }
  }
  return path;
}

let checkerPattern = null, checkerSize = 0;
function drawChecker(ctx, W, H, size) {
  if (!checkerPattern || checkerSize !== size) {
    const t = document.createElement('canvas');
    t.width = t.height = size * 2;
    const c = t.getContext('2d');
    c.fillStyle = '#f4f5f7'; c.fillRect(0, 0, size * 2, size * 2);
    c.fillStyle = '#e8eaee'; c.fillRect(0, 0, size, size); c.fillRect(size, size, size, size);
    checkerPattern = ctx.createPattern(t, 'repeat');
    checkerSize = size;
  }
  ctx.fillStyle = checkerPattern;
  ctx.fillRect(0, 0, W, H);
}

export function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
