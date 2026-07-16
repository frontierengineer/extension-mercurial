import { createRoot } from 'react-dom/client';
import type { SurfaceProvider, SurfaceViewContext } from '../../types';
import { VcsPanel } from './components/VcsPanel';
import './styles.css';

// The Mercurial app (shell-v2): one app that owns its whole content rect — a
// slot selector rail on the left (its ExtensionSidebar) and the selected slot's
// repository on the right (changed files + diff + commit + log). Selecting a
// slot resolves a (machine, area); the repo view reads/writes via the machines
// service. Same source-control shape as the git app, for Mercurial (no staging
// area — hg commits tracked changes directly).

// Launcher glyph: a branching mercury/quicksilver mark, drawn in the 0 0 16 16
// viewBox apps use — deliberately distinct from git's commit-graph icon.
const HG_ICON =
  'M8 2.5v8M8 13a1.4 1.4 0 1 0 0.01 0M4.6 6a1.4 1.4 0 1 0 0.01 0M11.4 6a1.4 1.4 0 1 0 0.01 0M4.7 6.6C5.1 9 6.1 10 8 10.5M11.3 6.6C10.9 9 9.9 10 8 10.5';

export function register(uiProvider: SurfaceProvider): void {
  const ui = uiProvider.version(1);

  ui.application.register({
    id: 'mercurial',
    title: 'Mercurial',
    icon: HG_ICON,
    color: '#999999',
    requires: null,
    // The app owns context.container entirely. mount() runs ONCE (the host warms
    // this app's webview once, then only toggles visibility); the returned
    // handle's dispose() runs if the user quits the app from the launcher.
    mount(context: SurfaceViewContext) {
      const root = createRoot(context.container);
      root.render(<VcsPanel context={context} />);
      return { dispose: () => root.unmount() };
    },
  });
}
