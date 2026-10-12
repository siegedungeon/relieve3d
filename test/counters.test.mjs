import assert from 'assert';
import { liftCounters } from '../src/core/raster.js';

// white field (0) with a pink letter (1) in the middle
const W = 60, H = 40;
const letter = () => {
  const L = new Int32Array(W * H).fill(0);
  for (let y = 8; y <= 32; y++) for (let x = 10; x <= 50; x++) L[y * W + x] = 1;
  return L;
};

// slanted, thin script counter (fills ~25 % of its box) ringed by 1-px anti-alias specks of a third colour
{
  const L = letter();
  const inC = (x, y) => Math.abs(y - 20) <= 9 && Math.abs(x - 30 - 0.6 * (y - 20)) <= 1.5;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inC(x, y)) L[y * W + x] = 0;
  let k = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (L[i] !== 1 || ![i - 1, i + 1, i - W, i + W].some((j) => L[j] === 0 && inC(j % W, (j / W) | 0))) continue;
    if (k++ % 2 === 0 && ![i - 1, i - W, i - W - 1, i - W + 1].some((j) => L[j] === 2)) L[i] = 2;
  }
  const c = liftCounters(L, W, H);
  assert.equal(c.n, 1, 'slanted counter with fringe specks is lifted');
  assert.equal(L[20 * W + 30], -1);
  c.restore();
  assert.equal(L[20 * W + 30], 0, 'counter restored with its colour');
  console.log('  ✓ contraformas inclinadas con halo se conservan');
}

// 1-px sliver of white inside the letter (anti-alias edge of a band): not a counter
{
  const L = letter();
  for (let x = 20; x <= 24; x++) L[20 * W + x] = 0;
  assert.equal(liftCounters(L, W, H).n, 0, 'sliver is not lifted');
  console.log('  ✓ astillas de 1 px no se tratan como contraformas');
}
console.log('counters OK');
