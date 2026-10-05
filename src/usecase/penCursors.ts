const PEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
<path d="M3 21 L6 14 L16 4 L20 8 L10 18 Z" fill="#111" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/>
<path d="M3 21 L5.6 19 L6.7 20.1 Z" fill="#fff"/>
</svg>`;

const MOVE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
<path d="M12 1 L8 6 L11 6 L11 11 L6 11 L6 8 L1 12 L6 16 L6 13 L11 13 L11 18 L8 18 L12 23 L16 18 L13 18 L13 13 L18 13 L18 16 L23 12 L18 8 L18 11 L13 11 L13 6 L16 6 Z" fill="#111" stroke="#fff" stroke-width="1"/>
</svg>`;

const CONVERT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
<path d="M3 15 L12 6 L21 15" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M3 15 L12 6 L21 15" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const toCursor = (svg: string, hx: number, hy: number): string =>
  `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}, crosshair`;

export const PEN_CURSOR = toCursor(PEN_SVG, 3, 21);
export const PEN_MOVE_CURSOR = toCursor(MOVE_SVG, 12, 12);
export const PEN_CONVERT_CURSOR = toCursor(CONVERT_SVG, 12, 11);
