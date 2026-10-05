import { Position } from '~/domain/map';

export interface CopyPositionFormat {
  id: string;
  label: string;
  render: (p: Position) => string;
}

export const COPY_POSITION_FORMATS: CopyPositionFormat[] = [
  { id: 'lua', label: 'Lua table', render: (p) => `{x = ${p.x}, y = ${p.y}, z = ${p.z}}` },
  { id: 'luaShort', label: 'Lua short', render: (p) => `{${p.x}, ${p.y}, ${p.z}}` },
  { id: 'comma', label: 'Comma separated', render: (p) => `${p.x}, ${p.y}, ${p.z}` },
  { id: 'paren', label: 'Position(x, y, z)', render: (p) => `Position(${p.x}, ${p.y}, ${p.z})` },
  { id: 'labeled', label: 'Labeled', render: (p) => `x: ${p.x}, y: ${p.y}, z: ${p.z}` }
];

export const DEFAULT_COPY_POSITION_FORMAT = 'lua';

export function formatPosition(id: string, p: Position): string {
  const format = COPY_POSITION_FORMATS.find((f) => f.id === id) ?? COPY_POSITION_FORMATS[0];
  return format.render(p);
}
