import React from 'react';

import { Position } from '~/domain/map';
import { SelTile } from '~/components/MapCanvas/types';

import { ChunkMeshCache } from './useChunkMeshes';

export interface BoxSelection {
  startTile: Position;
  curTile: Position;
  additive: boolean;
}

export interface SelectionSnapshot {
  entries: SelTile[];
  spawn: Position | null;
  creature: Position | null;
  waypoint: Position | null;
  spawns: Position[];
  creatures: Position[];
}

const markerSig = (p: Position | null) => (p ? `${p.z},${p.x},${p.y}` : '-');

export function selectionSig(s: SelectionSnapshot): string {
  const e = s.entries
    .map((t) => `${t.z},${t.x},${t.y},${t.all ? 1 : 0}`)
    .sort()
    .join('|');
  const sp = s.spawns.map(markerSig).sort().join('|');
  const cr = s.creatures.map(markerSig).sort().join('|');
  return `${e}#${sp}#${cr}#${markerSig(s.spawn)}#${markerSig(s.creature)}#${markerSig(s.waypoint)}`;
}

export interface Selection {
  entries: React.MutableRefObject<Map<string, SelTile>>;
  box: React.MutableRefObject<BoxSelection | null>;
  spawn: React.MutableRefObject<Position | null>;
  creature: React.MutableRefObject<Position | null>;
  waypoint: React.MutableRefObject<Position | null>;
  spawns: React.MutableRefObject<Map<string, Position>>;
  creatures: React.MutableRefObject<Map<string, Position>>;
  selectTile: (pos: Position, all: boolean) => void;
  toggleTile: (pos: Position) => void;
  toggleSpawn: (pos: Position) => void;
  toggleCreature: (pos: Position) => void;
  selectSpawn: (pos: Position | null) => void;
  selectCreature: (pos: Position | null) => void;
  selectWaypoint: (pos: Position | null) => void;
  selectBox: (z: number, ax: number, ay: number, bx: number, by: number, additive: boolean) => void;
  addSpawn: (pos: Position) => void;
  addCreature: (pos: Position) => void;
  setTiles: (list: SelTile[]) => void;
  snapshot: () => SelectionSnapshot;
  restore: (s: SelectionSnapshot) => void;
  clear: () => void;
}

export function useSelection(meshes: ChunkMeshCache): Selection {
  const entries = React.useRef(new Map<string, SelTile>());
  const box = React.useRef<BoxSelection | null>(null);
  const spawn = React.useRef<Position | null>(null);
  const creature = React.useRef<Position | null>(null);
  const waypoint = React.useRef<Position | null>(null);
  const spawns = React.useRef(new Map<string, Position>());
  const creatures = React.useRef(new Map<string, Position>());

  function selectMarker(ref: React.MutableRefObject<Position | null>, pos: Position | null) {
    const prev = ref.current;
    if (prev && (!pos || prev.x !== pos.x || prev.y !== pos.y || prev.z !== pos.z)) {
      meshes.discardAt(prev.x, prev.y, prev.z);
    }
    ref.current = pos;
    if (pos) meshes.discardAt(pos.x, pos.y, pos.z);
  }

  function selectSpawn(pos: Position | null) {
    selectMarker(spawn, pos);
  }

  function selectCreature(pos: Position | null) {
    selectMarker(creature, pos);
  }

  function selectWaypoint(pos: Position | null) {
    selectMarker(waypoint, pos);
  }

  function clear() {
    selectSpawn(null);
    selectCreature(null);
    selectWaypoint(null);
    for (const pos of spawns.current.values()) meshes.discardAt(pos.x, pos.y, pos.z);
    for (const pos of creatures.current.values()) meshes.discardAt(pos.x, pos.y, pos.z);
    spawns.current.clear();
    creatures.current.clear();
    if (entries.current.size === 0) return;
    meshes.discardTiles(entries.current.values());
    entries.current.clear();
  }

  function addSpawn(pos: Position) {
    spawns.current.set(`${pos.z},${pos.x},${pos.y}`, pos);
    meshes.discardAt(pos.x, pos.y, pos.z);
  }

  function addCreature(pos: Position) {
    creatures.current.set(`${pos.z},${pos.x},${pos.y}`, pos);
    meshes.discardAt(pos.x, pos.y, pos.z);
  }

  function selectTile(pos: Position, all: boolean) {
    clear();
    entries.current.set(`${pos.z},${pos.x},${pos.y}`, { x: pos.x, y: pos.y, z: pos.z, all });
    meshes.discardAt(pos.x, pos.y, pos.z);
  }

  function toggleTile(pos: Position) {
    const key = `${pos.z},${pos.x},${pos.y}`;
    if (entries.current.has(key)) entries.current.delete(key);
    else entries.current.set(key, { x: pos.x, y: pos.y, z: pos.z, all: false });
    meshes.discardAt(pos.x, pos.y, pos.z);
  }

  function toggleMarker(map: React.MutableRefObject<Map<string, Position>>, pos: Position) {
    const key = `${pos.z},${pos.x},${pos.y}`;
    if (map.current.has(key)) map.current.delete(key);
    else map.current.set(key, pos);
    meshes.discardAt(pos.x, pos.y, pos.z);
  }

  function toggleSpawn(pos: Position) {
    toggleMarker(spawns, pos);
  }

  function toggleCreature(pos: Position) {
    toggleMarker(creatures, pos);
  }

  function selectBox(z: number, ax: number, ay: number, bx: number, by: number, additive: boolean) {
    if (!additive) clear();
    const minX = Math.min(ax, bx);
    const maxX = Math.max(ax, bx);
    const minY = Math.min(ay, by);
    const maxY = Math.max(ay, by);
    const added: SelTile[] = [];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const tile = { x, y, z, all: true };
        entries.current.set(`${z},${x},${y}`, tile);
        added.push(tile);
      }
    }
    meshes.discardTiles(added);
  }

  function setTiles(list: SelTile[]) {
    if (entries.current.size > 0) {
      meshes.discardTiles(entries.current.values());
      entries.current.clear();
    }
    for (const t of list) entries.current.set(`${t.z},${t.x},${t.y}`, t);
    meshes.discardTiles(list);
  }

  function snapshot(): SelectionSnapshot {
    return {
      entries: Array.from(entries.current.values()).map((t) => ({ ...t })),
      spawn: spawn.current ? { ...spawn.current } : null,
      creature: creature.current ? { ...creature.current } : null,
      waypoint: waypoint.current ? { ...waypoint.current } : null,
      spawns: Array.from(spawns.current.values()).map((p) => ({ ...p })),
      creatures: Array.from(creatures.current.values()).map((p) => ({ ...p }))
    };
  }

  function restore(s: SelectionSnapshot) {
    clear();
    for (const t of s.entries) entries.current.set(`${t.z},${t.x},${t.y}`, t);
    meshes.discardTiles(s.entries);
    for (const p of s.spawns) addSpawn(p);
    for (const p of s.creatures) addCreature(p);
    selectSpawn(s.spawn);
    selectCreature(s.creature);
    selectWaypoint(s.waypoint);
  }

  return {
    entries,
    box,
    spawn,
    creature,
    waypoint,
    spawns,
    creatures,
    selectTile,
    toggleTile,
    toggleSpawn,
    toggleCreature,
    selectSpawn,
    selectCreature,
    selectWaypoint,
    selectBox,
    addSpawn,
    addCreature,
    setTiles,
    snapshot,
    restore,
    clear
  };
}
