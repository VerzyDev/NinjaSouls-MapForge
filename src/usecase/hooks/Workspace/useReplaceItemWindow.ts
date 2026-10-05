import React from 'react';
import { emit, listen } from '@tauri-apps/api/event';

import { ReplaceResult } from '~/adapter/map';
import { REPLACE_ITEM_EVENTS } from '~/domain/replaceItem';

interface Options {
  mapId: number | null;
  title: string | null;
  floorZ: number;
  itemNames: Map<number, string> | null;
  onReplaced: (result: ReplaceResult) => void;
}

export const useReplaceItemWindow = ({ mapId, title, floorZ, itemNames, onReplaced }: Options) => {
  const ctxRef = React.useRef({ mapId, title, floorZ, itemNames });
  ctxRef.current = { mapId, title, floorZ, itemNames };
  const replacedRef = React.useRef(onReplaced);
  replacedRef.current = onReplaced;

  const push = React.useCallback(() => {
    const ctx = ctxRef.current;
    void emit(REPLACE_ITEM_EVENTS.context, {
      mapId: ctx.mapId,
      title: ctx.title,
      floorZ: ctx.floorZ,
      names: ctx.itemNames ? [...ctx.itemNames] : []
    });
  }, []);

  React.useEffect(() => {
    const pending = Promise.all([
      listen(REPLACE_ITEM_EVENTS.hello, push),
      listen<ReplaceResult>(REPLACE_ITEM_EVENTS.replaced, (e) => replacedRef.current(e.payload))
    ]);
    return () => {
      void pending.then((fns) => fns.forEach((fn) => fn()));
    };
  }, [push]);

  React.useEffect(push, [mapId, title, floorZ, itemNames, push]);
};
