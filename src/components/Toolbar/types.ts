import { PaletteCategoryId } from '~/domain/palette';

export interface MenuState {
  loading: boolean;
  hasActive: boolean;
  recent: string[];
  minimapOpen: boolean;
  propertiesOpen: boolean;
  idMarkersOpen: boolean;
}

export interface FileMenuActions {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onCloseMap: () => void;
  onImportMap: () => void;
  onClearRecent: () => void;
  onRequestExit: () => void;
  onOpenRecent: (path: string) => void;
}

export interface EditMenuActions {
  onJumpToItem: () => void;
  onReplaceItems: () => void;
  onOpenScripts: () => void;
  onOpenPreferences: () => void;
  onStripActionIds: () => void;
  onStripUniqueIds: () => void;
}

export interface MapMenuActions {
  onEditTowns: () => void;
  onMapProperties: () => void;
  onMapStatistics: () => void;
  onExportMinimap: () => void;
  onReferenceImage: () => void;
}

export interface WindowMenuActions {
  onNewPalette: () => void;
  onToggleMinimap: () => void;
  onToggleProperties: () => void;
  onToggleIdMarkers: () => void;
  onSelectPaletteCategory: (category: PaletteCategoryId) => void;
}

export interface HelpMenuActions {
  onCheckUpdates: () => void;
  onShortcuts: () => void;
  onAbout: () => void;
}
