import { House } from '~/domain/house';

export interface HouseFileEntry {
  id: number;
  name: string;
  entryX: number;
  entryY: number;
  entryZ: number;
  rent: number;
  townId: number;
  size: number;
  guildhall?: boolean;
}

export interface HouseFile {
  houses: HouseFileEntry[];
}

export function parseHouseJson(content: string): House[] {
  const file = JSON.parse(content) as Partial<HouseFile>;
  return (file.houses ?? [])
    .filter((h) => h.id)
    .map((h) => ({
      id: h.id,
      name: h.name ?? `House #${h.id}`,
      townId: h.townId ?? 0,
      rent: h.rent ?? 0,
      guildhall: !!h.guildhall,
      entryX: h.entryX ?? 0,
      entryY: h.entryY ?? 0,
      entryZ: h.entryZ ?? 0
    }));
}

export function serializeHouseJson(houses: House[], sizes: Record<number, number>): string {
  const list = houses.map((h) => {
    const out: HouseFileEntry = {
      id: h.id,
      name: h.name,
      entryX: h.entryX,
      entryY: h.entryY,
      entryZ: h.entryZ,
      rent: h.rent,
      townId: h.townId,
      size: sizes[h.id] ?? 0
    };
    if (h.guildhall) out.guildhall = true;
    return out;
  });
  return `${JSON.stringify({ houses: list } satisfies HouseFile, null, '	')}
`;
}
