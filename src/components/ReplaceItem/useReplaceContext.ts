import React from 'react';
import { emit, listen } from '@tauri-apps/api/event';

import { ReplaceSelection, ReplaceItemContext, REPLACE_ITEM_EVENTS } from '~/domain/replaceItem';

const EMPTY_SELECTION: ReplaceSelection = { zs: [], xs: [], ys: [], all: [] };
const SELECTION_TIMEOUT = 1000;

export const useReplaceContext = () => {
  const [context, setContext] = React.useState<ReplaceItemContext>({ mapId: null, title: null, floorZ: 7, names: [] });
  const [itemNames, setItemNames] = React.useState<Map<number, string> | null>(null);

  React.useEffect(() => {
    let unlisten: (() => void) | null = null;
    void (async () => {
      unlisten = await listen<ReplaceItemContext>(REPLACE_ITEM_EVENTS.context, (e) => {
        setContext(e.payload);
        setItemNames(new Map(e.payload.names));
      });
      await emit(REPLACE_ITEM_EVENTS.hello);
    })();
    return () => unlisten?.();
  }, []);

  const requestSelection = React.useCallback(
    () =>
      new Promise<ReplaceSelection>((resolve) => {
        let done = false;
        let unlisten: (() => void) | null = null;
        const finish = (value: ReplaceSelection) => {
          if (done) return;
          done = true;
          unlisten?.();
          resolve(value);
        };
        const timer = setTimeout(() => finish(EMPTY_SELECTION), SELECTION_TIMEOUT);
        void listen<ReplaceSelection>(REPLACE_ITEM_EVENTS.selection, (e) => {
          clearTimeout(timer);
          finish(e.payload);
        }).then((fn) => {
          unlisten = fn;
          if (done) fn();
          else void emit(REPLACE_ITEM_EVENTS.selectionRequest);
        });
      }),
    []
  );

  return { mapId: context.mapId, title: context.title, floorZ: context.floorZ, itemNames, requestSelection };
};
