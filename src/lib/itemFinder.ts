import { Thing } from '~/domain/thing';
import { ItemCaps } from '~/adapter/assets';

export interface FinderRow {
  serverId: number;
  name: string;
  type: string;
  terms: string[];
  caps: ItemCaps | null;
  thing: Thing | null;
}

export interface FinderFilter {
  id: string;
  label: string;
  test: (row: FinderRow) => boolean;
}

export interface FinderGroup {
  id: string;
  label: string;
  mode: 'any' | 'all';
  filters: FinderFilter[];
}

const field = (key: string) => (row: FinderRow) => Boolean((row.thing as unknown as Record<string, unknown> | null)?.[key]);

const ofType = (type: string) => (row: FinderRow) => row.type === type;

const hasCap = (key: keyof ItemCaps) => (row: FinderRow) => Boolean(row.caps?.[key]);

const TYPE_GROUP: FinderGroup = {
  id: 'types',
  label: 'Types',
  mode: 'any',
  filters: [
    { id: 'container', label: 'Container', test: (row) => hasCap('container')(row) || field('isContainer')(row) },
    { id: 'door', label: 'Door', test: hasCap('door') },
    { id: 'teleport', label: 'Teleport', test: hasCap('teleport') },
    { id: 'depot', label: 'Depot', test: (row) => hasCap('depot')(row) || ofType('depot')(row) },
    { id: 'writableItem', label: 'Writable', test: hasCap('writable') },
    { id: 'fluidItem', label: 'Fluid', test: hasCap('fluid') },
    { id: 'mailbox', label: 'Mailbox', test: ofType('mailbox') },
    { id: 'trashholder', label: 'Trash holder', test: ofType('trashholder') },
    { id: 'magicfield', label: 'Magic field', test: ofType('magicfield') },
    { id: 'bed', label: 'Bed', test: ofType('bed') },
    { id: 'key', label: 'Key', test: ofType('key') },
    { id: 'podium', label: 'Podium', test: ofType('podium') }
  ]
};

const PROPERTY_GROUP: FinderGroup = {
  id: 'properties',
  label: 'Properties',
  mode: 'all',
  filters: [
    { id: 'unpassable', label: 'Unpassable', test: field('isUnpassable') },
    { id: 'unmovable', label: 'Unmovable', test: field('isUnmoveable') },
    { id: 'blockMissile', label: 'Blocks missiles', test: field('blockMissile') },
    { id: 'blockPathfind', label: 'Blocks path', test: field('blockPathfind') },
    { id: 'hasElevation', label: 'Has elevation', test: field('hasElevation') },
    { id: 'floorChange', label: 'Floor change', test: field('floorChange') },
    { id: 'ground', label: 'Ground', test: (row) => field('isGround')(row) || field('isFullGround')(row) },
    { id: 'onTop', label: 'Always on top', test: field('isOnTop') }
  ]
};

const INTERACTION_GROUP: FinderGroup = {
  id: 'interaction',
  label: 'Interaction',
  mode: 'all',
  filters: [
    { id: 'readable', label: 'Readable', test: field('writableOnce') },
    { id: 'writable', label: 'Writable', test: field('writable') },
    { id: 'pickupable', label: 'Pickupable', test: field('pickupable') },
    { id: 'stackable', label: 'Stackable', test: field('stackable') },
    { id: 'rotatable', label: 'Rotatable', test: field('rotatable') },
    { id: 'hangable', label: 'Hangable', test: field('hangable') },
    { id: 'hookEast', label: 'Hook east', test: field('isVertical') },
    { id: 'hookSouth', label: 'Hook south', test: field('isHorizontal') },
    { id: 'usable', label: 'Usable', test: (row) => field('multiUse')(row) || field('forceUse')(row) }
  ]
};

const VISUAL_GROUP: FinderGroup = {
  id: 'visual',
  label: 'Visual',
  mode: 'all',
  filters: [
    { id: 'hasLight', label: 'Has light', test: field('hasLight') },
    { id: 'animated', label: 'Animated', test: (row) => field('isAnimation')(row) || (row.thing?.frames ?? 0) > 1 },
    { id: 'translucent', label: 'Translucent', test: field('isTranslucent') },
    { id: 'ignoreLook', label: 'Ignore look', test: field('ignoreLook') },
    { id: 'fluidContainer', label: 'Fluid container', test: field('isFluidContainer') },
    { id: 'fluid', label: 'Splash / fluid', test: field('isFluid') },
    { id: 'minimap', label: 'On minimap', test: field('miniMap') }
  ]
};

export const FINDER_GROUPS: FinderGroup[] = [TYPE_GROUP, PROPERTY_GROUP, INTERACTION_GROUP, VISUAL_GROUP];

export interface FinderSources {
  clientIds: number[];
  caps: ItemCaps[];
  things: Map<number, Thing>;
  names: Map<number, string>;
  types: Map<number, string>;
}

export const buildFinderRows = (serverIds: number[], { clientIds, caps, things, names, types }: FinderSources): FinderRow[] =>
  serverIds.map((serverId, i) => {
    const name = names.get(serverId) ?? '';
    return {
      serverId,
      name,
      type: types.get(serverId) ?? '',
      terms: name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean),
      caps: caps[i] ?? null,
      thing: things.get(clientIds[i] ?? 0) ?? null
    };
  });

const matchesText = (row: FinderRow, tokens: string[]) => {
  const id = String(row.serverId);
  return tokens.every((token) => {
    if (id.startsWith(token)) return true;
    return row.terms.some((term) => term.startsWith(token));
  });
};

const matchesGroup = (row: FinderRow, group: FinderGroup, active: Set<string>) => {
  const picked = group.filters.filter((f) => active.has(f.id));
  if (picked.length === 0) return true;
  return group.mode === 'any' ? picked.some((f) => f.test(row)) : picked.every((f) => f.test(row));
};

export const filterFinderRows = (rows: FinderRow[], query: string, active: Set<string>, limit: number): FinderRow[] => {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 && active.size === 0) return [];
  const out: FinderRow[] = [];
  for (const row of rows) {
    if (!matchesText(row, tokens)) continue;
    if (!FINDER_GROUPS.every((group) => matchesGroup(row, group, active))) continue;
    out.push(row);
  }
  const exact = tokens.length === 1 ? Number(tokens[0]) : NaN;
  if (!Number.isNaN(exact)) {
    const at = out.findIndex((row) => row.serverId === exact);
    if (at > 0) out.unshift(out.splice(at, 1)[0]);
  }
  return out.slice(0, limit);
};

export const availableFilters = (rows: FinderRow[], group: FinderGroup): FinderFilter[] =>
  group.id === 'types' ? group.filters.filter((f) => rows.some((row) => f.test(row))) : group.filters;
