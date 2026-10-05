import React from 'react';
import { open } from '@tauri-apps/plugin-dialog';

import { ItemSource } from '~/adapter/assets';
import { CLIENT_VERSIONS } from '~/domain/tibia';
import { ClientConfig } from '~/adapter/preferences';
import { Label } from '~/components/commons/ui/label';
import ClientRow from '~/components/Preferences/ClientRow';
import { Checkbox } from '~/components/commons/ui/checkbox';
import { Select, SelectItem, SelectValue, SelectContent, SelectTrigger } from '~/components/commons/ui/select';

interface ClientVersionTabProps {
  config: ClientConfig;
  onChange: (config: ClientConfig) => void;
}

const VERSIONS = CLIENT_VERSIONS.filter((cv, i, arr) => arr.findIndex((o) => o.value === cv.value) === i);
const versionLabel = new Map(VERSIONS.map((cv) => [cv.value, cv.label]));
const labelOf = (version: number) => versionLabel.get(version) ?? String(version);
const ITEM_SOURCE_LABELS: Record<ItemSource, string> = { otb: 'With items.otb', dat: 'Dat only' };

const ClientVersionTab = ({ config, onChange }: ClientVersionTabProps) => {
  const [addKey, setAddKey] = React.useState(0);

  const set = (patch: Partial<ClientConfig>) => onChange({ ...config, ...patch });

  const setPath = (version: number, path: string) => onChange({ ...config, paths: { ...config.paths, [version]: path } });

  const clearPath = (version: number) => setPath(version, '');

  const removeVersion = (version: number) => {
    const paths = { ...config.paths };
    delete paths[version];
    const remaining = Object.keys(paths)
      .map(Number)
      .sort((a, b) => a - b);
    const defaultVersion = version === config.defaultVersion ? (remaining[0] ?? config.defaultVersion) : config.defaultVersion;
    onChange({ ...config, paths, defaultVersion });
  };

  const pickFolder = async (version: number) => {
    const dir = await open({
      multiple: false,
      directory: true,
      defaultPath: config.paths[version] || undefined,
      title: `Select client folder for ${labelOf(version)}`
    });
    return typeof dir === 'string' ? dir : null;
  };

  const browse = async (version: number) => {
    const dir = await pickFolder(version);
    if (dir) setPath(version, dir);
  };

  const addVersion = async (version: number) => {
    const dir = await pickFolder(version);
    setPath(version, dir ?? '');
    setAddKey((k) => k + 1);
  };

  const configured = React.useMemo(
    () =>
      Object.keys(config.paths)
        .map(Number)
        .sort((a, b) => a - b),
    [config.paths]
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-x-5 whitespace-nowrap">
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs font-medium">Default version</span>
          <Select value={String(config.defaultVersion)} onValueChange={(v) => set({ defaultVersion: Number(v) })}>
            <SelectTrigger className="h-7 w-20">
              <SelectValue>{labelOf(config.defaultVersion)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {VERSIONS.map((cv) => (
                <SelectItem key={cv.value} value={String(cv.value)} textValue={String(cv.value)}>
                  {cv.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Label htmlFor="pref-sig" className="shrink-0 cursor-pointer">
          <Checkbox
            id="pref-sig"
            checked={config.checkSignatures}
            onCheckedChange={(v) => set({ checkSignatures: v === true })}
          />
          Check signatures
        </Label>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs font-medium">Item IDs</span>
          <Select value={config.itemSource} onValueChange={(v) => set({ itemSource: v as ItemSource })}>
            <SelectTrigger className="h-7 w-36">
              <SelectValue>{ITEM_SOURCE_LABELS[config.itemSource]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="otb">{ITEM_SOURCE_LABELS.otb}</SelectItem>
              <SelectItem value="dat">{ITEM_SOURCE_LABELS.dat}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="h-px bg-border" />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Configured clients</span>
          <span className="text-[10px] text-muted-foreground">New maps use the default version</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {configured.map((version) => (
            <ClientRow
              key={version}
              label={labelOf(version)}
              path={config.paths[version]}
              onClear={() => clearPath(version)}
              onBrowse={() => void browse(version)}
              onRemove={() => removeVersion(version)}
              isDefault={version === config.defaultVersion}
            />
          ))}
          {configured.length === 0 && (
            <div className="rounded-md border border-dashed border-border px-2.5 py-3 text-center text-[11px] text-muted-foreground">
              No client versions configured. Add one below.
            </div>
          )}
        </div>
        <Select key={addKey} onValueChange={(v) => void addVersion(Number(v))}>
          <SelectTrigger className="h-7 w-48 text-muted-foreground">
            <SelectValue placeholder="+ Add another version" />
          </SelectTrigger>
          <SelectContent>
            {VERSIONS.map((cv) => (
              <SelectItem
                key={cv.value}
                value={String(cv.value)}
                textValue={String(cv.value)}
                disabled={configured.includes(cv.value)}
              >
                {cv.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

export default ClientVersionTab;
