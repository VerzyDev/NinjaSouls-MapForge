import { emit, listen } from '@tauri-apps/api/event';

import { openReplaceItem } from '~/adapter/windows';
import { EnqueueRequest, REPLACE_ITEM_EVENTS } from '~/domain/replaceItem';

const HANDSHAKE_WINDOW = 5000;

export async function sendToReplaceList(items: EnqueueRequest['items']): Promise<void> {
  const payload: EnqueueRequest = { items };
  const unlisten = await listen(REPLACE_ITEM_EVENTS.hello, () => void emit(REPLACE_ITEM_EVENTS.enqueue, payload));
  setTimeout(unlisten, HANDSHAKE_WINDOW);
  await openReplaceItem();
  await emit(REPLACE_ITEM_EVENTS.enqueue, payload);
}
