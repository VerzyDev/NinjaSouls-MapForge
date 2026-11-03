import { SpawnArea, CreaturePlacement } from '~/domain/creature';

export interface SpawnFileCreature {
  name: string;
  x: number;
  y: number;
  spawntime?: number;
  direction?: number;
}

export interface SpawnFileEntry {
  x: number;
  y: number;
  z: number;
  radius: number;
  monsters?: SpawnFileCreature[];
  npcs?: SpawnFileCreature[];
}

export interface SpawnFile {
  spawns: SpawnFileEntry[];
}

export interface ParsedSpawnCreature {
  name: string;
  isNpc: boolean;
  x: number;
  y: number;
  z: number;
  spawntime: number;
  direction: number;
}

export function parseSpawnJson(content: string): { areas: SpawnArea[]; creatures: ParsedSpawnCreature[] } {
  const file = JSON.parse(content) as Partial<SpawnFile>;
  const areas: SpawnArea[] = [];
  const creatures: ParsedSpawnCreature[] = [];
  for (const s of file.spawns ?? []) {
    areas.push({ x: s.x, y: s.y, z: s.z, radius: s.radius ?? 1 });
    const push = (list: SpawnFileCreature[] | undefined, isNpc: boolean) => {
      for (const c of list ?? []) {
        creatures.push({
          name: c.name,
          isNpc,
          x: c.x ?? s.x,
          y: c.y ?? s.y,
          z: s.z,
          spawntime: c.spawntime || 60,
          direction: c.direction ?? 2
        });
      }
    };
    push(s.monsters, false);
    push(s.npcs, true);
  }
  return { areas, creatures };
}

const covers = (a: SpawnArea, c: CreaturePlacement) =>
  a.z === c.z && Math.abs(c.x - a.x) <= a.radius && Math.abs(c.y - a.y) <= a.radius;

const toFileCreature = (c: CreaturePlacement): SpawnFileCreature => ({
  name: c.name,
  x: c.x,
  y: c.y,
  spawntime: c.spawntime,
  direction: c.direction
});

export function serializeSpawnJson(areas: SpawnArea[], placements: CreaturePlacement[]): string {
  const assigned = new Set<CreaturePlacement>();
  const entry = (a: SpawnArea, members: CreaturePlacement[]): SpawnFileEntry => {
    const out: SpawnFileEntry = { x: a.x, y: a.y, z: a.z, radius: a.radius };
    const monsters = members.filter((c) => !c.isNpc).map(toFileCreature);
    const npcs = members.filter((c) => c.isNpc).map(toFileCreature);
    if (monsters.length) out.monsters = monsters;
    if (npcs.length) out.npcs = npcs;
    return out;
  };
  const spawns: SpawnFileEntry[] = areas.map((a) => {
    const members = placements.filter((c) => !assigned.has(c) && covers(a, c));
    for (const c of members) assigned.add(c);
    return entry(a, members);
  });
  for (const c of placements) {
    if (!assigned.has(c)) spawns.push(entry({ x: c.x, y: c.y, z: c.z, radius: 1 }, [c]));
  }
  return `${JSON.stringify({ spawns } satisfies SpawnFile, null, '	')}
`;
}
