// Separable diffusion of a node field. Each pass has variance 2/3 of a cell squared per axis.
export function blurGrid(F, n, passes = 2) {
  const strides = [1, n[0], n[0] * n[1]], tmp = new Float32Array(F.length);
  for (let p = 0; p < passes; p++) for (let axis = 0; axis < 3; axis++) {
    const stride = strides[axis], length = n[axis], block = stride * length;
    for (let start = 0; start < F.length; start += block) for (let c = 0; c < length; c++) {
      const offset = start + c * stride, left = c ? -stride : 0, right = c + 1 < length ? stride : 0;
      for (let j = 0; j < stride; j++) {
        const i = offset + j;
        tmp[i] = (F[i + left] + F[i] + F[i + right]) / 3;
      }
    }
    F.set(tmp);
  }
  return F;
}
