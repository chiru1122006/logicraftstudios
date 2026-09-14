/**
 * EditorMenuBar — File / Edit menus for the editor header.
 *
 * The editor grew a single toolbar row where every action, frequent or
 * rare, competed for the same pixels; on small screens the buttons
 * measurably overlapped. The classic fix is the classic desktop split:
 * things you do every minute stay as buttons (Run, Stop, board, Add),
 * things you do a few times per session move into menus. This is those
 * menus.
 *
 * Actions are invoked through the editorCommands registry — their real
 * owners (EditorPage, FileExplorer, EditorToolbar, SimulatorCanvas)
 * register handlers on mount, so nothing here duplicates logic and an
 * item whose owner is not mounted renders disabled. Undo/redo read the
 * canvas history from the store directly, mirroring the canvas buttons.
 *
 * Menubar behaviour follows the desktop convention: click opens, click
 * again closes, hovering a sibling while open switches menus, Escape and
 * outside clicks close.
 */
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSimulatorStore } from '../../store/useSimulatorStore';
import { useOscilloscopeStore } from '../../store/useOscilloscopeStore';
import { useEditorStore, type EditorViewMode } from '../../store/useEditorStore';
import { useLocalizedHref } from '../../i18n/useLocalizedNavigate';
import {
  hasEditorCommand,
  runEditorCommand,
  subscribeEditorCommands,
  getEditorCommandsVersion,
  type EditorCommandId,
} from '../../lib/editorCommands';
import './EditorMenuBar.css';

type Item =
  | {
      kind: 'command';
      id: EditorCommandId;
      label: string;
      shortcut?: string;
      pro?: boolean;
      /** Hide the row entirely when no handler is registered, instead of
       *  the default "render disabled". For account-scoped items the
       *  absence of a handler is not "temporarily unavailable" but "does
       *  not apply here": OSS has no accounts at all, and in pro exactly
       *  one of Sign in / My projects is meaningful at a time. A greyed-out
       *  "My projects" would read as a broken feature in both. */
      optional?: boolean;
    }
  | { kind: 'link'; href: string; label: string }
  | { kind: 'separator' };

export const EditorMenuBar: React.FC = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState<'file' | 'edit' | 'view' | 'account' | 'help' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Re-render when owners (un)register their commands.
  useSyncExternalStore(subscribeEditorCommands, getEditorCommandsVersion);

  const location = useLocation();
  const navigate = useNavigate();
  const localize = useLocalizedHref();
  const serialOpen = useSimulatorStore((s) => s.serialMonitorOpen);
  const toggleSerialMonitor = useSimulatorStore((s) => s.toggleSerialMonitor);
  const scopeOpen = useOscilloscopeStore((s) => s.open);
  const toggleOscilloscope = useOscilloscopeStore((s) => s.toggleOscilloscope);
  // Layout rows: the same switches as the toolbar's explorer / Code / Both /
  // Circuit toggle, which hides on a narrow bar (App.css) — the menu is then
  // the only way to reach them, so they carry live checkmarks.
  const explorerOpen = useEditorStore((s) => s.explorerOpen);
  const toggleExplorer = useEditorStore((s) => s.toggleExplorer);
  const viewMode = useEditorStore((s) => s.viewMode);
  const setViewMode = useEditorStore((s) => s.setViewMode);
  const undo = useSimulatorStore((s) => s.undo);
  const redo = useSimulatorStore((s) => s.redo);
  const history = useSimulatorStore((s) => s.history);
  const historyIndex = useSimulatorStore((s) => s.historyIndex);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const fileItems: Item[] = [
    { kind: 'command', id: 'project.new', label: t('editor.menu.newProject', 'New workspace') },
    { kind: 'command', id: 'file.new', label: t('editor.menu.newFile', 'New file') },
    { kind: 'separator' },
    // Third item, and deliberately at the head of the project group rather
    // than tacked onto the "new …" pair above: it opens the user's saved
    // work, which is what Open/Save below are about.
    {
      kind: 'command',
      id: 'account.myProjects',
      label: t('header.auth.myProjects', 'My projects'),
      optional: true,
    },
    { kind: 'command', id: 'project.open', label: t('editor.menu.open', 'Open project…') },
    {
      kind: 'command',
      id: 'project.save',
      label: t('editor.menu.save', 'Save project'),
      shortcut: 'Ctrl+S',
    },
    { kind: 'separator' },
    { kind: 'command', id: 'project.import', label: t('editor.toolbar.importLabel', 'Import project') },
    { kind: 'command', id: 'project.exportVlx', label: t('editor.toolbar.exportVlxLabel', 'Export project (.vlx)') },
    { kind: 'command', id: 'project.export', label: t('editor.toolbar.exportLabel', 'Export project (.zip)') },
    { kind: 'command', id: 'project.exportBom', label: t('editor.toolbar.exportBomLabel', 'Bill of Materials (CSV)'), pro: true },
    {
      kind: 'command',
      id: 'project.exportScreenshot',
      label: t('editor.toolbar.exportScreenshotLabel', 'Schematic image (PNG)'),
      pro: true,
    },
    { kind: 'separator' },
    // The toolbar's "..." menu folded in here — same actions, same PRO
    // pills, one button fewer in the strip.
    { kind: 'command', id: 'project.share', label: t('editor.toolbar.shareLabel', 'Share / Embed') },
    { kind: 'command', id: 'project.githubSync', label: t('editor.toolbar.githubSyncLabel', 'Sync to GitHub'), pro: true },
    {
      kind: 'command',
      id: 'project.connectAgent',
      label: t('editor.toolbar.connectAgentLabel', 'Connect AI agent (Claude/Codex)'),
      pro: true,
      // Only the pro overlay registers a handler; hide (not grey out) the
      // row in builds where connecting an external agent cannot exist.
      optional: true,
    },
    { kind: 'command', id: 'firmware.upload', label: t('editor.toolbar.uploadFirmwareLabel', 'Upload firmware') },
    { kind: 'command', id: 'sim.record', label: t('editor.toolbar.recordLabel', 'Record simulation'), pro: true },
  ];

  // Sign in / My projects for the Account menu. The bottom-left account
  // dropdown gets these from its own (pro) markup; this menubar only ever
  // hosted the shared `user-menu` slot, which is why the editor's Account
  // menu had no way in or out of a session.
  const accountItems: Item[] = [
    {
      kind: 'command',
      id: 'account.myProjects',
      label: t('header.auth.myProjects', 'My projects'),
      optional: true,
    },
    {
      kind: 'command',
      id: 'account.login',
      label: t('header.auth.signIn', 'Sign in'),
      optional: true,
    },
  ];

  const helpItems: Item[] = [
    // Only present once a post has been delivered — the announcement is a
    // toast now, and this is how it stays reachable after it retires.
    {
      kind: 'command',
      id: 'help.whatsNew',
      label: t('news.kicker', "What's new"),
      optional: true,
    },
    { kind: 'link', href: '/examples', label: t('header.nav.examples', 'Examples') },
    { kind: 'link', href: '/about', label: t('header.nav.about', 'About Logicraft Studio') },
  ];

  // Undo/redo render specially above (live canvas history state); the rest
  // of Edit is the code editor's own actions. Everything view-shaped lives
  // in the View menu, like the desktop app.
  const editItems: Item[] = [
    { kind: 'separator' },
    {
      kind: 'command',
      id: 'edit.formatDocument',
      label: t('editor.menu.formatDocument', 'Format document'),
      shortcut: 'Shift+Alt+F',
    },
  ];

  // File Explorer is rendered as a checkmarked row in the View block below
  // (it reads the store), not as a plain command here.
  const viewItems: Item[] = [
    { kind: 'command', id: 'sim.compile', label: t('editor.menu.compile', 'Compile'), shortcut: 'Ctrl+B' },
    { kind: 'command', id: 'sim.run', label: t('editor.menu.run', 'Run') },
    { kind: 'command', id: 'sim.stop', label: t('editor.toolbar.stop', 'Stop') },
    { kind: 'command', id: 'sim.resetBoard', label: t('editor.toolbar.reset', 'Reset') },
    { kind: 'separator' },
    { kind: 'command', id: 'view.toggleConsole', label: t('editor.menu.toggleConsole', 'Output Console') },
    { kind: 'separator' },
    { kind: 'command', id: 'view.reset', label: t('editor.menu.centerView', 'Center canvas view') },
    { kind: 'command', id: 'view.zoomIn', label: t('editor.canvas.zoomIn', 'Zoom in') },
    { kind: 'command', id: 'view.zoomOut', label: t('editor.canvas.zoomOut', 'Zoom out') },
  ];

  const layoutModes: { key: EditorViewMode; label: string }[] = [
    { key: 'code', label: t('editor.shell.code', 'Code') },
    { key: 'both', label: t('editor.shell.both', 'Both') },
    { key: 'circuit', label: t('editor.shell.circuit', 'Circuit') },
  ];

  const renderLink = (item: Extract<Item, { kind: 'link' }>): React.ReactNode => (
    <a
      key={item.href}
      role="menuitem"
      className="emb-item"
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => setOpen(null)}
    >
      <span>{item.label}</span>
    </a>
  );

  const renderCommand = (item: Extract<Item, { kind: 'command' }>): React.ReactNode => (
    <button
      key={item.id}
      role="menuitem"
      className="emb-item"
      disabled={!hasEditorCommand(item.id)}
      onClick={() => {
        setOpen(null);
        runEditorCommand(item.id);
      }}
    >
      <span>
        {item.label}
        {item.pro && <span className="emb-pro">PRO</span>}
      </span>
      {item.shortcut && <span className="emb-shortcut">{item.shortcut}</span>}
    </button>
  );

  const menu = (which: 'file' | 'edit' | 'view' | 'account' | 'help', label: string, items: Item[]): React.ReactNode => (
    <div className="emb-root" key={which}>
      <button
        className={`emb-trigger${open === which ? ' emb-trigger-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open === which}
        onClick={() => setOpen((cur) => (cur === which ? null : which))}
        onMouseEnter={() => setOpen((cur) => (cur && cur !== which ? which : cur))}
      >
        {label}
      </button>
      {open === which && (
        <div className="emb-menu" role="menu">
          {which === 'view' && (
            <>
              <button
                role="menuitemcheckbox"
                aria-checked={serialOpen}
                className="emb-item"
                onClick={() => {
                  setOpen(null);
                  toggleSerialMonitor();
                }}
              >
                <span>{t('editor.canvas.toggleSerialMonitor', 'Serial Monitor')}</span>
                <span className="emb-shortcut">{serialOpen ? '✓' : ''}</span>
              </button>
              <button
                role="menuitemcheckbox"
                aria-checked={scopeOpen}
                className="emb-item"
                onClick={() => {
                  setOpen(null);
                  toggleOscilloscope();
                }}
              >
                <span>{t('editor.menu.toggleScope', 'Oscilloscope / Logic Analyzer')}</span>
                <span className="emb-shortcut">{scopeOpen ? '✓' : ''}</span>
              </button>
              <div className="emb-separator" />
              {/* Layout: explorer pane + Code / Both / Circuit. Mirrors the
                  toolbar's segmented toggle, which App.css hides once the
                  shared bar gets narrow (small window + docked AI chat). */}
              <div className="emb-section-label">{t('editor.shell.viewMode', 'View mode')}</div>
              <button
                role="menuitemcheckbox"
                aria-checked={explorerOpen}
                className="emb-item"
                onClick={() => {
                  setOpen(null);
                  toggleExplorer();
                }}
              >
                <span>{t('editor.menu.toggleExplorer', 'File Explorer')}</span>
                <span className="emb-shortcut">{explorerOpen ? '✓' : ''}</span>
              </button>
              {layoutModes.map((m) => (
                <button
                  key={m.key}
                  role="menuitemradio"
                  aria-checked={viewMode === m.key}
                  className="emb-item"
                  onClick={() => {
                    setOpen(null);
                    setViewMode(m.key);
                  }}
                >
                  <span>{m.label}</span>
                  <span className="emb-shortcut">{viewMode === m.key ? '✓' : ''}</span>
                </button>
              ))}
            </>
          )}
          {which === 'account' && (
            <div className="emb-account-menu-content">
              <div className="emb-account-profile-header">
                <div className="emb-account-avatar">
                  <span>CR</span>
                </div>
                <div className="emb-account-details">
                  <div className="emb-account-name">Chirudeep Reddy</div>
                  <div className="emb-account-sub">ECE Student · Amrita Univ</div>
                  <div className="emb-account-roll">BL.EN.U4ECE24164</div>
                </div>
              </div>

              <div className="emb-separator" />

              <a
                href="https://github.com/chiru1122006"
                target="_blank"
                rel="noopener noreferrer"
                className="emb-account-github-btn"
                onClick={() => setOpen(null)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                </svg>
                <span>GitHub (@chiru1122006)</span>
                <span className="emb-shortcut">↗</span>
              </a>

              <a
                href="https://www.linkedin.com/in/chiru-deep-reddy"
                target="_blank"
                rel="noopener noreferrer"
                className="emb-item"
                onClick={() => setOpen(null)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#0a66c2' }}>
                    <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                  </svg>
                  <span>LinkedIn Profile</span>
                </div>
                <span className="emb-shortcut">↗</span>
              </a>

              <button
                type="button"
                className="emb-item"
                onClick={() => {
                  setOpen(null);
                  navigate(localize('/about'));
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#38bdf8' }}>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <span>About Logicraft Studio</span>
                </div>
                <span className="emb-shortcut">→</span>
              </button>

              {accountItems
                .filter((item) => item.kind !== 'command' || hasEditorCommand(item.id))
                .map((item) => (item.kind === 'command' ? renderCommand(item) : null))}
              {accountItems.some(
                (item) => item.kind === 'command' && hasEditorCommand(item.id),
              ) && <div className="emb-separator" />}
              <div
                data-velxio-slot="user-menu"
                style={{ display: 'contents' }}
                onClick={() => setOpen(null)}
              />
            </div>
          )}
          {which === 'edit' && (
            <>
              <button
                role="menuitem"
                className="emb-item"
                disabled={historyIndex < 0}
                onClick={() => {
                  setOpen(null);
                  undo();
                }}
              >
                <span>{t('editor.menu.undo', 'Undo')}</span>
                <span className="emb-shortcut">Ctrl+Z</span>
              </button>
              <button
                role="menuitem"
                className="emb-item"
                disabled={historyIndex >= history.length - 1}
                onClick={() => {
                  setOpen(null);
                  redo();
                }}
              >
                <span>{t('editor.menu.redo', 'Redo')}</span>
                <span className="emb-shortcut">Ctrl+Y</span>
              </button>
            </>
          )}
          {items
            .filter(
              (item) =>
                item.kind !== 'command' || !item.optional || hasEditorCommand(item.id),
            )
            .map((item, i) =>
              item.kind === 'separator' ? (
                <div key={`sep-${i}`} className="emb-separator" />
              ) : item.kind === 'link' ? (
                renderLink(item)
              ) : (
                renderCommand(item)
              ),
            )}
        </div>
      )}
    </div>
  );

  return (
    <div className="editor-menubar" ref={rootRef}>
      {menu('file', t('editor.menu.file', 'File'), fileItems)}
      {menu('edit', t('editor.menu.edit', 'Edit'), editItems)}
      {menu('view', t('editor.menu.view', 'View'), viewItems)}
      {menu('account', t('editor.menu.account', 'Account'), [])}
      <button
        type="button"
        className={`emb-trigger emb-trigger-about${location.pathname.includes('/about') ? ' emb-trigger-open' : ''}`}
        onClick={() => navigate(localize('/about'))}
        title="About Logicraft Studio & Creator"
      >
        {t('header.nav.about', 'About')}
      </button>
      {menu('help', t('editor.menu.help', 'Help'), helpItems)}
    </div>
  );
};
