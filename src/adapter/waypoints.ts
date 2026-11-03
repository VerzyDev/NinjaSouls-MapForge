import { isJsonText } from '~/lib/map/sidecars';
import { readSidecarText } from '~/adapter/sidecarText';
import { parseWaypointJson } from '~/lib/map/waypointFile';
import { Waypoint, MapWaypoints, buildMapWaypoints, emptyMapWaypoints } from '~/domain/waypoint';

const intAttr = (el: Element, name: string): number => Number(el.getAttribute(name) ?? 0);

export async function loadWaypoints(path: string): Promise<MapWaypoints> {
  const content = await readSidecarText(path);
  if (content == null) return emptyMapWaypoints();
  if (isJsonText(content)) return buildMapWaypoints(parseWaypointJson(content));

  const doc = new DOMParser().parseFromString(content, 'text/xml');
  const list: Waypoint[] = [];
  for (const el of Array.from(doc.getElementsByTagName('waypoint'))) {
    const name = el.getAttribute('name') ?? '';
    if (!name) continue;
    list.push({ name, x: intAttr(el, 'x'), y: intAttr(el, 'y'), z: intAttr(el, 'z') });
  }
  return buildMapWaypoints(list);
}
