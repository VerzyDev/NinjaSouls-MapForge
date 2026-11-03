export const hasSidecars = (path: string): boolean => /\.otbm$/i.test(path);

export const jsonSidecarFile = (file: string): string => `${file.replace(/\.(xml|json)$/i, '')}.json`;

export const isJsonText = (content: string): boolean => content.trimStart().startsWith('{');
