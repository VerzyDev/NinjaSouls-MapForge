import { Waypoint } from '~/domain/waypoint';

export interface WaypointFile {
  waypoints: Waypoint[];
}

export function parseWaypointJson(content: string): Waypoint[] {
  const file = JSON.parse(content) as Partial<WaypointFile>;
  return (file.waypoints ?? []).filter((w) => w.name).map((w) => ({ name: w.name, x: w.x ?? 0, y: w.y ?? 0, z: w.z ?? 0 }));
}

export function serializeWaypointJson(waypoints: Waypoint[]): string {
  const list = waypoints.map((w) => ({ name: w.name, x: w.x, y: w.y, z: w.z }));
  return `${JSON.stringify({ waypoints: list } satisfies WaypointFile, null, '\t')}\n`;
}
