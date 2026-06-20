import React from 'react';
import { createRoot } from 'react-dom/client';

// A small confirm modal rendered into the app's modal chrome. The modals
// API exposes prompt() but no confirm(), and native confirm() is disallowed
// — so destructive actions (revert a file's changes) use this. It reuses
// the app's modal look (.modal-overlay / .modal-content / ...), whose styles
// cascade into the extension bundle.
export function confirmModal(opts: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const done = (result: boolean) => {
      root.unmount();
      container.remove();
      resolve(result);
    };
    root.render(
      <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) done(false); }}>
        <div className="modal-content" style={{ maxWidth: 400 }}>
          <div className="modal-header">
            <h2>{opts.title}</h2>
            <button className="modal-close" onClick={() => done(false)}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
          <div className="modal-body">
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }}>{opts.message}</p>
          </div>
          <div className="modal-footer">
            <button className="btn-ghost" onClick={() => done(false)}>Cancel</button>
            <button className={opts.danger ? 'btn-danger' : 'btn-primary'} onClick={() => done(true)}>
              {opts.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    );
  });
}
