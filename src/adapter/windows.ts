import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

interface ChildWindowOptions {
  label: string;
  url: string;
  title: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

async function openChildWindow({ label, url, title, width, height, minWidth, minHeight }: ChildWindowOptions): Promise<void> {
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setDecorations(false);
    await existing.setShadow(true);
    await existing.setFocus();
    return;
  }
  const win = new WebviewWindow(label, {
    url,
    title,
    width,
    height,
    minWidth,
    minHeight,
    resizable: true,
    decorations: false,
    transparent: true,
    shadow: true,
    backgroundColor: [0, 0, 0, 0]
  });
  win.once('tauri://created', () => {
    void win.setDecorations(false);
    void win.setShadow(true);
  });
  win.once('tauri://error', (e) => console.error(`Failed to open ${label}`, e));
}

export async function openTilesetEditor(): Promise<void> {
  await openChildWindow({
    label: 'tileset-editor',
    url: 'tileset-editor.html',
    title: 'Tileset Editor',
    width: 1080,
    height: 745,
    minWidth: 820,
    minHeight: 560
  });
}

export async function openReplaceItem(): Promise<void> {
  await openChildWindow({
    label: 'replace-item',
    url: 'replace-item.html',
    title: 'Replace Item',
    width: 760,
    height: 560,
    minWidth: 560,
    minHeight: 420
  });
}
