import { replaceKey, QueuedReplace } from '~/domain/replaceItem';

export const queueWarning = (queue: QueuedReplace[], index: number): string | null => {
  const pair = queue[index];
  if (!pair) return null;
  if (pair.to === null) return 'No target yet, pick an item on the right and press Set target';
  const earlier = queue.slice(0, index);
  if (earlier.some((p) => p.from === pair.from)) return `Item ${pair.from} already queued, this entry is ignored`;
  if (queue.some((p, i) => i !== index && p.to === pair.from)) return 'Another entry writes this id, replacements do not chain';
  return null;
};

export const canQueue = (queue: QueuedReplace[], from: number | null, to: number | null) =>
  from !== null && to !== null && from !== to && !queue.some((p) => replaceKey(p) === `${from}>${to}`);

export const readyPairs = (queue: QueuedReplace[]) =>
  queue.filter((p): p is QueuedReplace & { to: number } => p.to !== null).map((p) => ({ from: p.from, to: p.to }));
