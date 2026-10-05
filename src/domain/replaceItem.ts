export const REPLACE_ITEM_EVENTS = {
  hello: 'replace-item:hello',
  context: 'replace-item:context',
  replaced: 'replace-item:replaced',
  enqueue: 'replace-item:enqueue',
  selectionRequest: 'replace-item:selection-request',
  selection: 'replace-item:selection'
} as const;

export type ReplaceScopeId = 'map' | 'floor' | 'selection';

export interface ReplaceItemContext {
  mapId: number | null;
  title: string | null;
  floorZ: number;
  names: [number, string][];
}

export interface ReplaceSelection {
  zs: number[];
  xs: number[];
  ys: number[];
  all: boolean[];
}

export interface QueuedReplace {
  from: number;
  to: number | null;
  fromName: string;
  toName: string;
}

export interface EnqueueRequest {
  items: Array<{ from: number; fromName: string }>;
}

export const replaceKey = (pair: QueuedReplace) => `${pair.from}>${pair.to ?? '?'}`;
