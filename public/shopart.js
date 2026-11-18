// Procedural interior art for the mall shops: the back wall of each shop, drawn on a canvas.
// Every shop type gets shelves / racks / a menu board filled with its own kind of goods.
const W = 1024, H = 448;
const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const pick = a => a[Math.floor(rnd() * a.length)];
const PAL = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#f06292', '#6d4c41', '#eceff1', '#212121', '#7cb342'];

function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function wall(g, top, bottom) {
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, top); gr.addColorStop(1, bottom);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  // ceiling spotlights glow
  for (let x = 90; x < W; x += 210) { const r = g.createRadialGradient(x, 0, 4, x, 0, 170); r.addColorStop(0, 'rgba(255,250,230,.55)'); r.addColorStop(1, 'rgba(255,250,230,0)'); g.fillStyle = r; g.fillRect(x - 170, 0, 340, 200); }
}
function shelves(g, rows, wood = '#8d6e63', drawItem, x0 = 30, x1 = W - 30) {
  const top = 70, step = (H - top - 40) / rows;
  for (let r = 0; r < rows; r++) {
    const y = top + (r + 1) * step;
    let x = x0 + 6;
    while (x < x1 - 30) x += drawItem(x, y, step - 14, r) + 8;
    g.fillStyle = wood; g.fillRect(x0, y, x1 - x0, 10);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x0, y + 10, x1 - x0, 5);
  }
  g.fillStyle = wood; g.fillRect(x0 - 10, top, 10, H - top - 30); g.fillRect(x1, top, 10, H - top - 30);
}
function board(g, x, y, w, h, title, lines, accent) {
  g.fillStyle = '#4e342e'; rr(g, x - 8, y - 8, w + 16, h + 16, 8); g.fill();
  g.fillStyle = '#263238'; rr(g, x, y, w, h, 6); g.fill();
  g.fillStyle = accent; g.font = 'bold 30px Segoe UI, sans-serif'; g.textAlign = 'center'; g.fillText(title, x + w / 2, y + 40);
  g.font = '19px Segoe UI, sans-serif';
  lines.forEach((l, i) => { g.textAlign = 'left'; g.fillStyle = '#eceff1'; g.fillText(l[0], x + 18, y + 78 + i * 30); g.textAlign = 'right'; g.fillStyle = accent; g.fillText(l[1], x + w - 18, y + 78 + i * 30); });
  g.textAlign = 'left';
}
function poster(g, x, y, w, h, c1, c2, text) {
  const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
  g.fillStyle = gr; g.fillRect(x, y, w, h); g.strokeStyle = '#fff'; g.lineWidth = 4; g.strokeRect(x, y, w, h);
  g.fillStyle = 'rgba(255,255,255,.85)'; g.font = `bold ${Math.round(w / 6)}px Segoe UI, sans-serif`; g.textAlign = 'center'; g.fillText(text, x + w / 2, y + h - 18); g.textAlign = 'left';
}

const DRAW = {
  FASHION(g) {
    wall(g, '#f3e5f5', '#d1c4e9');
    for (const ry of [120, 290]) {
      g.fillStyle = '#9e9e9e'; g.fillRect(40, ry, W - 80, 6);
      for (let x = 70; x < W - 70; x += 46) {
        const c = pick(PAL);
        g.strokeStyle = '#616161'; g.lineWidth = 3; g.beginPath(); g.arc(x, ry + 6, 7, Math.PI, 0); g.stroke();
        g.fillStyle = c; g.beginPath(); g.moveTo(x - 20, ry + 14); g.lineTo(x + 20, ry + 14); g.lineTo(x + 26, ry + 40); g.lineTo(x + 16, ry + 42); g.lineTo(x + 16, ry + 120); g.lineTo(x - 16, ry + 120); g.lineTo(x - 16, ry + 42); g.lineTo(x - 26, ry + 40); g.closePath(); g.fill();
        g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(x - 16, ry + 100, 32, 20);
      }
    }
  },
  SHOES(g) {
    wall(g, '#eceff1', '#cfd8dc');
    shelves(g, 4, '#bdbdbd', (x, y) => {
      const c = pick(PAL);
      g.fillStyle = c; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 26); g.lineTo(x + 18, y - 30); g.quadraticCurveTo(x + 30, y - 14, x + 52, y - 12); g.quadraticCurveTo(x + 60, y - 6, x + 58, y); g.closePath(); g.fill();
      g.fillStyle = '#fafafa'; g.fillRect(x, y - 5, 58, 5);
      return 62;
    });
  },
  BOOKS(g) {
    wall(g, '#4e342e', '#3e2723');
    shelves(g, 5, '#795548', (x, y, h) => {
      const w = 12 + rnd() * 14, bh = h * (0.65 + rnd() * 0.3);
      g.fillStyle = pick(PAL); g.fillRect(x, y - bh, w, bh);
      g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(x + 2, y - bh + 8, w - 4, 3); g.fillRect(x + 2, y - 14, w - 4, 3);
      return w - 6;
    });
  },
  CAFE(g) {
    wall(g, '#d7ccc8', '#a1887f');
    board(g, 330, 40, 360, 260, 'COFFEE', [['Espresso', '7'], ['Cappuccino', '11'], ['Latte', '12'], ['Flat white', '12'], ['Cold brew', '13'], ['Croissant', '8']], '#ffcc80');
    for (const x0 of [40, 730]) for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) {
      const x = x0 + i * 62, y = 120 + r * 110;
      g.fillStyle = '#fafafa'; g.fillRect(x, y - 40, 40, 40); g.fillStyle = '#6d4c41'; g.fillRect(x, y - 40, 40, 8);
      g.strokeStyle = '#fafafa'; g.lineWidth = 5; g.beginPath(); g.arc(x + 44, y - 22, 9, -1.4, 1.4); g.stroke();
      if (i === 3) { g.fillStyle = '#8d6e63'; g.fillRect(x0 - 10, y, 260, 8); }
    }
  },
  TOYS(g) {
    wall(g, '#fff9c4', '#ffe082');
    shelves(g, 4, '#ff7043', (x, y, h) => {
      const k = Math.floor(rnd() * 3), c = pick(PAL);
      g.fillStyle = c;
      if (k === 0) { g.beginPath(); g.arc(x + 22, y - 22, 22, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(x + 22, y - 22, 14, 0, 3); g.stroke(); return 46; }
      if (k === 1) { for (let i = 0; i < 3; i++) { g.fillStyle = pick(PAL); g.fillRect(x + (i % 2) * 14, y - 22 * (i + 1), 26, 22); } return 44; }
      g.beginPath(); g.arc(x + 20, y - 46, 14, 0, 7); g.fill(); g.beginPath(); g.arc(x + 20, y - 18, 20, 0, 7); g.fill();
      g.beginPath(); g.arc(x + 8, y - 58, 6, 0, 7); g.arc(x + 32, y - 58, 6, 0, 7); g.fill();
      g.fillStyle = '#000'; g.fillRect(x + 14, y - 49, 3, 3); g.fillRect(x + 23, y - 49, 3, 3);
      return 42;
    });
  },
  PHONES(g) {
    wall(g, '#fafafa', '#e0e0e0');
    g.fillStyle = '#212121'; g.font = 'bold 44px Segoe UI, sans-serif'; g.textAlign = 'center'; g.fillText('NEW  ·  PRO  ·  MAX', W / 2, 60); g.textAlign = 'left';
    for (let r = 0; r < 3; r++) for (let i = 0; i < 11; i++) {
      const x = 50 + i * 86, y = 100 + r * 110;
      g.fillStyle = '#263238'; rr(g, x, y, 44, 84, 8); g.fill();
      const gr = g.createLinearGradient(x, y, x + 44, y + 84); gr.addColorStop(0, pick(PAL)); gr.addColorStop(1, pick(PAL));
      g.fillStyle = gr; rr(g, x + 4, y + 6, 36, 72, 4); g.fill();
    }
  },
  SPORT(g) {
    wall(g, '#e8f5e9', '#a5d6a7');
    shelves(g, 3, '#546e7a', (x, y, h) => {
      const k = Math.floor(rnd() * 3);
      if (k === 0) { g.fillStyle = '#fafafa'; g.beginPath(); g.arc(x + 26, y - 26, 26, 0, 7); g.fill(); g.fillStyle = '#212121'; g.beginPath(); g.arc(x + 26, y - 26, 9, 0, 7); g.fill(); return 52; }
      if (k === 1) { g.fillStyle = '#ef6c00'; g.beginPath(); g.arc(x + 26, y - 26, 26, 0, 7); g.fill(); g.strokeStyle = '#3e2723'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y - 26); g.lineTo(x + 52, y - 26); g.moveTo(x + 26, y - 52); g.lineTo(x + 26, y); g.stroke(); return 52; }
      g.strokeStyle = pick(PAL); g.lineWidth = 6; g.beginPath(); g.ellipse(x + 20, y - h + 34, 18, 26, 0, 0, 7); g.stroke(); g.fillStyle = '#424242'; g.fillRect(x + 17, y - h + 58, 6, h - 58); return 40;
    });
  },
  PERFUME(g) {
    wall(g, '#fce4ec', '#f8bbd0');
    shelves(g, 4, '#fafafa', (x, y) => {
      const c = pick(['#f48fb1', '#ce93d8', '#90caf9', '#ffe082', '#80cbc4']), w = 26 + rnd() * 10, h = 36 + rnd() * 20;
      g.globalAlpha = .85; g.fillStyle = c; rr(g, x, y - h, w, h, 6); g.fill(); g.globalAlpha = 1;
      g.fillStyle = '#ffd54f'; g.fillRect(x + w / 2 - 5, y - h - 12, 10, 12);
      g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(x + 4, y - h + 6, 4, h - 12);
      return w + 6;
    }, 30, W - 30);
  },
  JEWELS(g) {
    wall(g, '#1a1a2e', '#0f0f1e');
    for (let i = 0; i < 5; i++) {
      const x = 40 + i * 196, y = 90;
      g.fillStyle = '#3949ab'; g.fillRect(x, y, 160, 300); g.strokeStyle = '#ffd54f'; g.lineWidth = 4; g.strokeRect(x, y, 160, 300);
      for (let k = 0; k < 3; k++) {
        const cy = y + 60 + k * 90;
        g.strokeStyle = '#ffd54f'; g.lineWidth = 3; g.beginPath(); g.arc(x + 80, cy - 20, 34, 0.2, Math.PI - 0.2); g.stroke();
        g.fillStyle = pick(['#e1f5fe', '#ef5350', '#66bb6a', '#42a5f5']); g.beginPath(); g.moveTo(x + 80, cy + 26); g.lineTo(x + 70, cy + 14); g.lineTo(x + 80, cy + 4); g.lineTo(x + 90, cy + 14); g.closePath(); g.fill();
        g.fillStyle = '#fff'; for (let s = 0; s < 3; s++) g.fillRect(x + 20 + rnd() * 120, cy - 40 + rnd() * 60, 2, 2);
      }
    }
  },
  MUSIC(g) {
    wall(g, '#263238', '#102027');
    for (let i = 0; i < 4; i++) { // guitars
      const x = 70 + i * 90, c = pick(['#d84315', '#fbc02d', '#5d4037', '#1565c0']);
      g.fillStyle = '#3e2723'; g.fillRect(x - 4, 70, 8, 170);
      g.fillStyle = c; g.beginPath(); g.ellipse(x, 270, 34, 44, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(x, 220, 26, 30, 0, 0, 7); g.fill();
      g.fillStyle = '#212121'; g.beginPath(); g.arc(x, 250, 10, 0, 7); g.fill();
    }
    for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) { // vinyl wall
      const x = 470 + i * 90, y = 90 + r * 110;
      g.fillStyle = pick(PAL); g.fillRect(x, y, 80, 80);
      g.fillStyle = '#111'; g.beginPath(); g.arc(x + 52, y + 40, 34, 0, 7); g.fill(); g.fillStyle = pick(PAL); g.beginPath(); g.arc(x + 52, y + 40, 10, 0, 7); g.fill();
    }
  },
  GAMES(g) {
    wall(g, '#1a237e', '#0d1335');
    g.fillStyle = '#000'; rr(g, 340, 40, 340, 190, 8); g.fill();
    const gr = g.createLinearGradient(350, 50, 670, 220); gr.addColorStop(0, '#7c4dff'); gr.addColorStop(1, '#00e5ff'); g.fillStyle = gr; g.fillRect(352, 52, 316, 166);
    g.fillStyle = '#fff'; g.font = 'bold 34px Segoe UI, sans-serif'; g.textAlign = 'center'; g.fillText('PRESS START', 510, 145); g.textAlign = 'left';
    const boxes = (x0, x1, y0) => { for (let r = 0; r < 3; r++) for (let x = x0; x < x1 - 40; x += 48) { const y = y0 + r * 120; g.fillStyle = pick(PAL); g.fillRect(x, y, 40, 56); g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(x + 4, y + 4, 32, 8); g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.arc(x + 20, y + 34, 10, 0, 7); g.fill(); } };
    boxes(30, 320, 60); boxes(700, 1000, 60); boxes(360, 680, 290);
  },
  BAKERY(g) {
    wall(g, '#fff3e0', '#ffcc80');
    shelves(g, 4, '#a1887f', (x, y) => {
      const k = Math.floor(rnd() * 3);
      if (k === 0) { g.fillStyle = '#c68642'; g.beginPath(); g.ellipse(x + 34, y - 18, 34, 18, 0, Math.PI, 0); g.fill(); g.fillRect(x, y - 18, 68, 18); g.strokeStyle = '#8d5524'; g.lineWidth = 3; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(x + 14 + i * 18, y - 30); g.lineTo(x + 22 + i * 18, y - 20); g.stroke(); } return 70; }
      if (k === 1) { g.fillStyle = '#e0a458'; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 28, y - 46, x + 56, y); g.closePath(); g.fill(); return 58; }
      g.fillStyle = '#d7a86e'; g.beginPath(); g.arc(x + 20, y - 20, 20, 0, 7); g.fill(); g.fillStyle = '#fff3e0'; g.beginPath(); g.arc(x + 20, y - 20, 7, 0, 7); g.fill(); g.fillStyle = pick(['#f06292', '#6d4c41', '#fff']); g.beginPath(); g.arc(x + 20, y - 24, 16, Math.PI, 0); g.fill(); return 42;
    });
  },
  TEA(g) {
    wall(g, '#e0f2f1', '#80cbc4');
    shelves(g, 4, '#5d4037', (x, y) => {
      if (rnd() < 0.35) { g.fillStyle = pick(['#fafafa', '#26a69a', '#c62828']); g.beginPath(); g.ellipse(x + 26, y - 20, 24, 20, 0, 0, 7); g.fill(); g.fillRect(x + 20, y - 44, 12, 6); g.strokeStyle = g.fillStyle; g.lineWidth = 5; g.beginPath(); g.moveTo(x + 48, y - 22); g.lineTo(x + 62, y - 34); g.stroke(); return 66; }
      g.fillStyle = pick(['#2e7d32', '#c62828', '#283593', '#f9a825', '#4e342e']); g.fillRect(x, y - 52, 32, 52); g.fillStyle = '#ffd54f'; g.fillRect(x, y - 52, 32, 6); g.fillStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.arc(x + 16, y - 26, 8, 0, 7); g.fill(); return 34;
    });
  },
  PHARMACY(g) {
    wall(g, '#fafafa', '#e8f5e9');
    g.fillStyle = '#2e7d32'; g.fillRect(480, 40, 64, 160); g.fillRect(432, 88, 160, 64);
    const items = (x, y) => { g.fillStyle = pick(['#fafafa', '#e3f2fd', '#fff8e1']); g.fillRect(x, y - 40, 34, 40); g.fillStyle = pick(['#1e88e5', '#e53935', '#43a047', '#8e24aa']); g.fillRect(x, y - 30, 34, 8); return 36; };
    shelves(g, 4, '#b0bec5', items, 30, 400); shelves(g, 4, '#b0bec5', items, 624, W - 30);
  },
  FLOWERS(g) {
    wall(g, '#f1f8e9', '#c5e1a5');
    shelves(g, 3, '#8d6e63', (x, y, h) => {
      g.fillStyle = pick(['#a1887f', '#ff8a65', '#90a4ae']); g.beginPath(); g.moveTo(x, y - 34); g.lineTo(x + 40, y - 34); g.lineTo(x + 34, y); g.lineTo(x + 6, y); g.closePath(); g.fill();
      g.strokeStyle = '#558b2f'; g.lineWidth = 3;
      const c = pick(['#e91e63', '#ffeb3b', '#ff5722', '#9c27b0', '#fafafa', '#f44336']);
      for (let i = 0; i < 4; i++) {
        const fx = x + 8 + i * 8 + rnd() * 6, fy = y - 40 - h * 0.35 - rnd() * h * 0.3;
        g.beginPath(); g.moveTo(x + 20, y - 34); g.lineTo(fx, fy); g.stroke();
        g.fillStyle = c; for (let p = 0; p < 5; p++) { g.beginPath(); g.arc(fx + Math.cos(p * 1.26) * 6, fy + Math.sin(p * 1.26) * 6, 5, 0, 7); g.fill(); }
        g.fillStyle = '#ffd54f'; g.beginPath(); g.arc(fx, fy, 3.5, 0, 7); g.fill();
      }
      return 44;
    });
  },
  CINEMA(g) {
    wall(g, '#311b92', '#1a0033');
    const cols = [['#ff5722', '#311b92', 'SPACE'], ['#00bcd4', '#004d40', 'DEEP'], ['#ffeb3b', '#bf360c', 'HEIST'], ['#e91e63', '#1a237e', 'NIGHT'], ['#8bc34a', '#1b5e20', 'WILD']];
    cols.forEach(([a, b, t], i) => poster(g, 40 + i * 196, 60, 150, 220, a, b, t));
    g.fillStyle = '#ffd54f'; for (let x = 20; x < W; x += 30) { g.beginPath(); g.arc(x, 320, 6, 0, 7); g.fill(); }
    g.fillStyle = '#fafafa'; g.font = 'bold 40px Segoe UI, sans-serif'; g.textAlign = 'center'; g.fillText('NOW SHOWING · TICKETS', W / 2, 390); g.textAlign = 'left';
  },
  PIZZA(g) {
    wall(g, '#fbe9e7', '#ffab91');
    board(g, 560, 40, 420, 300, 'PIZZA', [['Margherita', '24'], ['Pepperoni', '29'], ['Funghi', '27'], ['Four cheese', '31'], ['Hawaii', '28'], ['Diavola', '30'], ['Calzone', '32']], '#ffab40');
    for (let i = 0; i < 3; i++) {
      const cx = 120 + (i % 2) * 230, cy = 120 + i * 105;
      g.fillStyle = '#d7a86e'; g.beginPath(); g.arc(cx, cy, 70, 0, 7); g.fill(); g.fillStyle = '#e53935'; g.beginPath(); g.arc(cx, cy, 60, 0, 7); g.fill();
      g.fillStyle = '#fff59d'; for (let k = 0; k < 9; k++) { g.beginPath(); g.arc(cx + Math.cos(k * 2.4) * 36 * rnd(), cy + Math.sin(k * 2.4) * 36 * rnd(), 11, 0, 7); g.fill(); }
      g.fillStyle = '#b71c1c'; for (let k = 0; k < 7; k++) { g.beginPath(); g.arc(cx + Math.cos(k) * 40, cy + Math.sin(k) * 40, 7, 0, 7); g.fill(); }
      g.fillStyle = '#43a047'; for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(cx + (rnd() - .5) * 70, cy + (rnd() - .5) * 70, 7, 4, k, 0, 7); g.fill(); }
    }
  },
  SUSHI(g) {
    wall(g, '#fafafa', '#ffccbc');
    g.fillStyle = '#b71c1c'; g.beginPath(); g.arc(160, 150, 90, 0, 7); g.fill();
    board(g, 600, 40, 380, 260, 'SUSHI', [['Maki set', '22'], ['Nigiri', '26'], ['Sashimi', '34'], ['Ramen', '29'], ['Gyoza', '16'], ['Miso soup', '9']], '#ef9a9a');
    for (let i = 0; i < 7; i++) {
      const x = 60 + i * 72, y = 360;
      g.fillStyle = '#212121'; g.beginPath(); g.arc(x, y, 26, 0, 7); g.fill(); g.fillStyle = '#fafafa'; g.beginPath(); g.arc(x, y, 20, 0, 7); g.fill();
      g.fillStyle = pick(['#ff7043', '#ef5350', '#9ccc65']); g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill();
    }
    g.fillStyle = '#5d4037'; g.fillRect(20, 392, 560, 10);
  },
};

const cache = {};
export function shopArt(name, accent) {
  if (cache[name]) return cache[name];
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  (DRAW[name] || DRAW.FASHION)(g);
  // small shop-colour stripe along the top and soft vignette
  g.fillStyle = accent; g.fillRect(0, 0, W, 10);
  const v = g.createLinearGradient(0, H - 60, 0, H); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.25)'); g.fillStyle = v; g.fillRect(0, H - 60, W, 60);
  return (cache[name] = c);
}
export const SHOP_NAMES = Object.keys(DRAW);
