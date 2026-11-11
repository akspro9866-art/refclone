function luminance(hex: string): number | undefined {
  const match = /^#([a-f\d]{3}|[a-f\d]{6})$/i.exec(hex);
  if (!match) return undefined;
  const digits = match[1].length === 3
    ? [...match[1]].map((digit) => digit.repeat(2)).join('')
    : match[1];
  const [r, g, b] = [0, 2, 4].map((offset) => {
    const channel = parseInt(digits.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

/** Choose readable text on an opaque hex surface. Check custom/transparent surfaces in the render. */
export function readableInk(surface: string, preferred = '#171716'): string {
  const backdrop = luminance(surface);
  const ink = luminance(preferred);
  if (backdrop === undefined || ink === undefined) return preferred;
  const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  if (contrast(backdrop, ink) >= 4.5) return preferred;
  return contrast(backdrop, 0) >= contrast(backdrop, 1) ? '#000000' : '#FFFFFF';
}
