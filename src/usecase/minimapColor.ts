const PALETTE = buildPalette();

function buildPalette(): Uint8Array {
  const table = new Uint8Array(256 * 3);
  for (let i = 0; i < 216; i++) {
    table[i * 3] = (Math.floor(i / 36) % 6) * 51;
    table[i * 3 + 1] = (Math.floor(i / 6) % 6) * 51;
    table[i * 3 + 2] = (i % 6) * 51;
  }
  return table;
}

export function miniMapRgb(color: number): [number, number, number] {
  const i = (color & 0xff) * 3;
  return [PALETTE[i], PALETTE[i + 1], PALETTE[i + 2]];
}
