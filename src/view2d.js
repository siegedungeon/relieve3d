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
    this.underlays = [];
    this.bounds = null;
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

  // underlays: [{ shapes, color }] drawn below the pieces (base, ring, sleeve footprints…)
  setUnderlays(list) { this.underlays = (list || []).map((u) => ({ color: u.color, alpha: u.alpha ?? 1, dashed: u.dashed, path: shapesToPath(u.shapes) })); }
  setBounds(b) { this.bounds = b; }

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
    const [x0, y0, x1, y1] = this.bounds || this.result.fgBBox;
    const pad = 40;
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
        this.cb.onPlace(x, y, { free: e.altKey });
        return;
      }
      const body = this.cb.getDrawData?.()?.body;
      if (body && this.onBodyHandle(...this.toImage(sx, sy), body)) {
        const [x, y] = this.toImage(sx, sy);
        drag = { type: 'body', dx: body.x - x, dy: body.y - y }; c.style.cursor = 'move'; return;
      }
      const ring = this.cb.getDrawData?.()?.ring;
      if (ring) {
        const [x, y] = this.toImage(sx, sy);
        if (Math.hypot(x - ring.x, y - ring.y) <= Math.max(ring.ro, 10 / this.scale)) { drag = { type: 'ring', dx: ring.x - x, dy: ring.y - y }; c.style.cursor = 'move'; return; }
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
      if (drag?.type === 'body') {
        const [x, y] = this.toImage(sx, sy);
        drag.pos = [x + drag.dx, y + drag.dy];
        this.cb.onBodyMove?.(...drag.pos);
        this.draw();
        return;
      }
      if (drag?.type === 'ring') {
        const [x, y] = this.toImage(sx, sy);
        drag.pos = [x + drag.dx, y + drag.dy];
        this.cb.onRingMove?.(...drag.pos, { free: e.altKey });
        this.draw();
        return;
      }
      if (drag?.type === 'select' && Math.hypot(sx - drag.sx, sy - drag.sy) > 4) {
        this.rect = [drag.sx, drag.sy, sx, sy];
        this.draw();
        return;
      }
      const [x, y] = this.toImage(sx, sy);
      if (this.placing && !drag) {
        this.cb.onRingMove?.(x, y, { hover: true, free: e.altKey });
        c.style.cursor = 'crosshair';
        this.draw();
        return;
      }
      const h = this.pieceAt(x, y);
      if (h !== this.hover) { this.hover = h; this.cb.onHover(h); this.draw(); }
      const bd = this.cb.getDrawData?.()?.body;
      if (bd && !this.placing && this.onBodyHandle(x, y, bd)) { c.style.cursor = 'move'; return; }
      const rg = this.cb.getDrawData?.()?.ring;
      if (rg && !this.placing && Math.hypot(x - rg.x, y - rg.y) <= Math.max(rg.ro, 10 / this.scale)) { c.style.cursor = 'move'; return; }
      c.style.cursor = this.placing ? 'crosshair' : (this.tool === 'pan' || this.space) ? 'grab' : h >= 0 ? 'pointer' : 'default';
    });

    c.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      c.style.cursor = 'default';
      if (d.type === 'ring') { if (d.pos) this.cb.onRingDrop?.(...d.pos); return; }
      if (d.type === 'body') { if (d.pos) this.cb.onBodyDrop?.(...d.pos); return; }
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

    c.addEventListener('pointerleave', () => {
      if (this.placing) { this.cb.onRingMove?.(null, null, { hover: true }); this.draw(); }
      if (this.hover !== -1) { this.hover = -1; this.cb.onHover(-1); this.draw(); }
    });

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

    if (d.body) {
      const p = new Path2D();
      d.body.outline.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
      p.closePath();
      ctx.globalAlpha = 0.9; ctx.fillStyle = d.body.color; ctx.fill(p); ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1.5 * px; ctx.setLineDash([6 * px, 4 * px]); ctx.stroke(p); ctx.setLineDash([]);
    }
    for (const u of this.underlays) {
      ctx.globalAlpha = u.alpha;
      ctx.fillStyle = u.color;
      ctx.fill(u.path, 'evenodd');
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,.35)';
      ctx.lineWidth = px;
      if (u.dashed) ctx.setLineDash([5 * px, 4 * px]);
      ctx.stroke(u.path);
      ctx.setLineDash([]);
    }
    for (const p of r.pieces) {
      if (d.hidePieces) break;
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
    if (d.marks) {
      ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 1.5 * px; ctx.setLineDash([4 * px, 3 * px]);
      for (const m of d.marks) { ctx.beginPath(); ctx.arc(m.c[0], m.c[1], m.r, 0, Math.PI * 2); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    if (d.ring) this.drawRing(ctx, d.ring, px);
    if (d.body) this.drawBodyHandle(ctx, d.body, px);

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

  onBodyHandle(x, y, b) { return Math.hypot(x - b.x, y - b.y) <= 13 / this.scale; }

  // body handle (move icon) at the body centre
  drawBodyHandle(ctx, b, px) {
    const R = 11 * px, a = 7 * px, h = 2.5 * px;
    ctx.beginPath(); ctx.arc(b.x, b.y, R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fill();
    ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 1.5 * px; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(b.x - a, b.y); ctx.lineTo(b.x + a, b.y); ctx.moveTo(b.x, b.y - a); ctx.lineTo(b.x, b.y + a);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const tx = b.x + dx * a, ty = b.y + dy * a; ctx.moveTo(tx - dy * h - dx * h, ty - dx * h - dy * h); ctx.lineTo(tx, ty); ctx.lineTo(tx + dy * h - dx * h, ty + dx * h - dy * h); }
    ctx.stroke();
  }

  // ring handle: the ring itself is part of the underlays; draw a draggable marker on top.
  // ring.ghost: live preview while placing / dragging (full tab + hole + neck towards the body)
  drawRing(ctx, ring, px) {
    const tx = ring.tx ?? 1, ty = ring.ty ?? 0, h = ring.half || 0;
    const capsule = (r) => {
      const ax = ring.x - tx * h, ay = ring.y - ty * h, bx = ring.x + tx * h, by = ring.y + ty * h, a = Math.atan2(ty, tx);
      ctx.moveTo(bx + Math.cos(a - Math.PI / 2) * r, by + Math.sin(a - Math.PI / 2) * r);
      ctx.arc(bx, by, r, a - Math.PI / 2, a + Math.PI / 2);
      ctx.arc(ax, ay, r, a + Math.PI / 2, a + Math.PI * 1.5);
      ctx.closePath();
    };
    if (ring.ghost) {
      const g = ring.ghost;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = g.color || '#93c5fd';
      ctx.strokeStyle = g.color || '#93c5fd';
      if (g.qx != null) {
        ctx.lineCap = 'round';
        ctx.lineWidth = ring.ro * 1.6;
        ctx.beginPath(); ctx.moveTo(ring.x, ring.y); ctx.lineTo(g.qx, g.qy); ctx.stroke();
      }
      ctx.beginPath(); capsule(ring.ro); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); capsule(ring.ri); ctx.fill();
      ctx.restore();
      if (g.snapped && g.qx != null) {
        ctx.beginPath(); ctx.arc(g.qx, g.qy, 3 * px, 0, Math.PI * 2);
        ctx.fillStyle = '#16a34a'; ctx.fill();
      }
    }
    ctx.beginPath();
    capsule(ring.ro);
    ctx.strokeStyle = ring.ghost ? '#16a34a' : '#2563eb';
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([4 * px, 3 * px]);
    ctx.stroke();
    ctx.setLineDash([]);
    const a = Math.max(ring.ri * 0.6, 3 * px);
    ctx.beginPath();
    ctx.moveTo(ring.x - a, ring.y); ctx.lineTo(ring.x + a, ring.y);
    ctx.moveTo(ring.x, ring.y - a); ctx.lineTo(ring.x, ring.y + a);
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
