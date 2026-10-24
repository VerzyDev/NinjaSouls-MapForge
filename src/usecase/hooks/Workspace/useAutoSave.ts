import React from 'react';

import { AutoSaveMode } from '~/adapter/preferences';

const BUSY_RETRY_MS = 2000;

interface AutoSaveParams {
  mode: AutoSaveMode;
  delaySeconds: number;
  isDirty: () => boolean;
  isBusy: () => boolean;
  save: () => Promise<void>;
}

export const useAutoSave = (params: AutoSaveParams) => {
  const ref = React.useRef(params);
  ref.current = params;
  const timer = React.useRef<number | undefined>(undefined);
  const { mode, delaySeconds } = params;

  const run = React.useCallback(() => {
    timer.current = undefined;
    const p = ref.current;
    if (!p.isDirty()) return;
    if (p.isBusy()) {
      timer.current = window.setTimeout(run, BUSY_RETRY_MS);
      return;
    }
    void p.save();
  }, []);

  React.useEffect(() => () => window.clearTimeout(timer.current), [mode, delaySeconds]);

  React.useEffect(() => {
    if (mode !== 'onWindowChange') return;
    window.addEventListener('blur', run);
    return () => window.removeEventListener('blur', run);
  }, [mode, run]);

  return React.useCallback(() => {
    if (mode !== 'afterDelay') return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(run, Math.max(1, delaySeconds) * 1000);
  }, [mode, delaySeconds, run]);
};
