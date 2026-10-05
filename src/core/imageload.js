// img.decode() never settles while the window is hidden/occluded; load events always fire.
export function imageReady(img) {
  return new Promise((res, rej) => {
    if (img.complete && img.naturalWidth) { res(); return; }
    img.addEventListener('load', () => res(), { once: true });
    img.addEventListener('error', () => rej(new Error('image')), { once: true });
  });
}
