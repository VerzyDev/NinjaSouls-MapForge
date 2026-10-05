import { createRoot } from 'react-dom/client';

import ReplaceItem from '~/components/ReplaceItem';
import { AssetsProvider } from '~/usecase/context/AssetsContext';
import { TooltipProvider } from '~/components/commons/ui/tooltip';
import { EditorSettingsProvider } from '~/usecase/context/EditorSettingsContext';

import './styles/index.css';

const Root = () => (
  <AssetsProvider>
    <EditorSettingsProvider>
      <TooltipProvider delayDuration={300} skipDelayDuration={150}>
        <ReplaceItem />
      </TooltipProvider>
    </EditorSettingsProvider>
  </AssetsProvider>
);

if (typeof window !== 'undefined') {
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.documentElement.classList.add('dark');
}

createRoot(document.getElementById('root')!).render(<Root />);
