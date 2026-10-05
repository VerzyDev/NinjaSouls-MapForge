import { StoredMapView } from '~/domain/map';
import { getSetting, setSetting } from '~/adapter/settings';

const KEY = 'mapViews';

type ViewMap = Record<string, StoredMapView>;

export async function getMapView(path: string): Promise<StoredMapView | null> {
  const all = await getSetting<ViewMap>(KEY, {});
  return all[path] ?? null;
}

export async function setMapView(path: string, view: StoredMapView): Promise<void> {
  const all = await getSetting<ViewMap>(KEY, {});
  all[path] = view;
  await setSetting(KEY, all);
}
