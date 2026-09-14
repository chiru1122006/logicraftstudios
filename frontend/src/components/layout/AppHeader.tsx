import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../../store/useProjectStore';
import { ShareModal } from './ShareModal';
import { useLocalizedHref, useCurrentLocale } from '../../i18n/useLocalizedNavigate';
import { blogUrlFor } from '../../i18n/path';
import { trackVisitGitHub } from '../../utils/analytics';
import { applyStripLayout, STRIP_BELOW_CLASS } from './headerStripFit';

const GITHUB_URL = 'https://github.com/chiru1122006';

interface AppHeaderProps {
  /** Editor variant: a File/Edit menu bar rendered next to the logo. When
   *  set, the marketing nav links (Home / Docs / Pricing / …) are hidden —
   *  inside the editor they are noise that costs exactly the width the
   *  toolbar is starved of on small screens; the logo still links home.
   *  Same mechanism the Tauri desktop build uses (VITE_DESKTOP). */
  editorMenu?: React.ReactNode;
  /** Editor variant: the unified toolbar strip rendered in the header's
   *  middle — the space the marketing nav used to occupy. One row instead
   *  of header + toolbar stacked; the strip wraps internally when narrow
   *  and the header grows to fit (height: auto on the modifier class). */
  editorToolbar?: React.ReactNode;
}

export const AppHeader: React.FC<AppHeaderProps> = ({ editorMenu, editorToolbar }) => {
  const location = useLocation();
  const currentProject = useProjectStore((s) => s.currentProject);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const localize = useLocalizedHref();
  const currentLocale = useCurrentLocale();

  // Close mobile & account menus on route change
  useEffect(() => {
    setMenuOpen(false);
    setAccountOpen(false);
  }, [location.pathname]);

  // Click outside to close account menu
  useEffect(() => {
    if (!accountOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [accountOpen]);

  // Editor variant: where does the toolbar strip go — on the brand row or
  // on its own bar below, labelled or icon-only? Measured, not guessed —
  // see headerStripFit.ts, which sets `app-header--strip-below` on the
  // header and `unified-toolbar--compact` on the strip. Re-measured
  // whenever the strip host, the brand block or a strip zone resizes
  // (window, docked chat, board controls mounting). The first measure runs
  // before paint; later ones are deferred a frame so toggling the classes
  // never re-enters ResizeObserver delivery.
  const headerRef = useRef<HTMLElement>(null);
  const hasStrip = !!editorToolbar;
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header || !hasStrip) return;
    const apply = () => {
      applyStripLayout(header);
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        apply();
      });
    };
    const ro = new ResizeObserver(schedule);
    const content = header.querySelector<HTMLElement>(':scope > .header-content');
    const left = content?.querySelector<HTMLElement>(':scope > .header-left');
    const host = content?.querySelector<HTMLElement>(':scope > .header-editor-toolbar');
    const strip = host?.firstElementChild;
    for (const el of [left, host, ...(strip ? Array.from(strip.children) : [])]) {
      if (el) ro.observe(el);
    }
    // Zones mount their controls later (the canvas side is a portal) —
    // pick up children that appear after mount.
    const mo = strip
      ? new MutationObserver(() => {
          for (const z of Array.from(strip.children)) ro.observe(z);
          schedule();
        })
      : null;
    if (strip && mo) mo.observe(strip, { childList: true });
    return () => {
      ro.disconnect();
      mo?.disconnect();
      if (raf) cancelAnimationFrame(raf);
      header.classList.remove(STRIP_BELOW_CLASS);
    };
  }, [hasStrip]);

  // Tauri desktop: no brand row. Brand/auto-save/share/auth-slot all live
  // elsewhere in desktop: the title bar shows "Velxio Desktop", the native
  // menubar has File/Edit/View/Help, auto-save is a Pro cloud feature
  // (desktop saves to .vlx), share generates a logicraftstudios.tech URL that doesn't
  // apply to a desktop session, and the license flow owns its own
  // DesktopWelcomePage.
  //
  // This used to `return null` outright, back when the strip below the
  // header was empty in desktop and painted a black bar. Since the editor
  // toolbar strip (Compile / Run / Libraries, board + canvas controls)
  // moved INSIDE this header (`editorToolbar`, 2026-08), that early return
  // dropped the whole strip from the desktop app: 0.4.7 shipped with no
  // Compile, Run or Libraries button. Render the strip alone, in the same
  // .header-content > .header-editor-toolbar structure headerStripFit.ts
  // measures, with an empty .header-left so the whole row is toolbar.
  if (import.meta.env.VITE_DESKTOP) {
    if (!editorToolbar) return null;
    return (
      <header ref={headerRef} className="app-header app-header--with-toolbar app-header--desktop">
        <div className="header-content">
          <div className="header-left" />
          <div className="header-editor-toolbar">{editorToolbar}</div>
        </div>
      </header>
    );
  }

  // Compare with the trailing slash ignored: /editor is served (and
  // canonicalized) as /editor/ since it is prerendered, while client-side
  // navigation still lands on /editor.
  const samePath = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
  const isActive = (path: string) =>
    samePath(location.pathname, localize(path)) ? ' header-nav-link-active' : '';

  return (
    <header ref={headerRef} className={"app-header" + (editorToolbar ? ' app-header--with-toolbar' : '')}>
      <div className="header-content">
        <div className="header-left">
          {/* Brand */}
          <div className="header-brand">
            <Link
              to={localize('/')}
              className="header-brand-link"
            >
              <img
                src="/logicraft_logo.png"
                alt="Logicraft Studios Logo"
                className="header-brand-logo-img"
                width="26"
                height="26"
              />
              <span className="header-title">
                <span className="header-title-text">Logicraft Studios</span>
                <span className="brand-badge-pill">STUDIO</span>
              </span>
            </Link>
          </div>

          {/* Main nav links (web only). The Tauri desktop build hides
              this nav and surfaces the equivalent actions via the
              native menubar (see pro/desktop/src-tauri/src/menu.rs in
              velxio-prod). VITE_DESKTOP is the env flag the Tauri
              build sets — main.tsx already uses it to gate the @pro
              overlay, same pattern here. */}
          {editorMenu}
          {!import.meta.env.VITE_DESKTOP && !editorMenu && (
          <nav className={'header-nav-links' + (menuOpen ? ' header-nav-open' : '')}>
            {/* Marketing routes live in the pro overlay; the OSS build has
                no /docs, /about, /pricing… to link to. Editor + Examples
                (the app's own pages) and GitHub/Discord stay everywhere. */}
            {import.meta.env.VITE_PRO_BUILD && (
              <>
                <Link to={localize('/')} className={'header-nav-link' + isActive('/')}>
                  {t('header.nav.home')}
                </Link>
                {/* Full-page link: the docs portal is a static Starlight
                    site served by nginx at /docs/, not a SPA route. */}
                <a href="/docs/" className="header-nav-link">
                  {t('header.nav.documentation')}
                </a>
              </>
            )}
            <Link to={localize('/examples')} className={'header-nav-link' + isActive('/examples')}>
              {t('header.nav.examples')}
            </Link>
            <Link to={localize('/editor/')} className={'header-nav-link' + isActive('/editor')}>
              {t('header.nav.editor')}
            </Link>
            <Link to={localize('/about')} className={'header-nav-link' + isActive('/about')}>
              {t('header.nav.about', 'About')}
            </Link>
            {import.meta.env.VITE_PRO_BUILD && (
              <>
                <Link to={localize('/pricing')} className={'header-nav-link' + isActive('/pricing')}>
                  {t('header.nav.pricing')}
                </Link>
                <Link to={localize('/classroom')} className={'header-nav-link' + isActive('/classroom')}>
                  {t('header.nav.classroom', 'For schools')}
                </Link>
                <Link
                  to={localize('/account/desktop-install')}
                  className={'header-nav-link' + isActive('/account/desktop-install')}
                >
                  {t('header.nav.download')}
                </Link>
                <a
                  href={blogUrlFor(currentLocale)}
                  className="header-nav-link"
                  rel="noopener"
                >
                  {t('header.nav.blog')}
                </a>
              </>
            )}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="header-nav-link"
              onClick={trackVisitGitHub}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                style={{ flexShrink: 0 }}
              >
                <path d="M12 2C6.477 2 2 6.484 2 12.021c0 4.428 2.865 8.185 6.839 9.504.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.605-3.369-1.342-3.369-1.342-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.026 2.747-1.026.546 1.378.202 2.397.1 2.65.64.7 1.028 1.595 1.028 2.688 0 3.848-2.338 4.695-4.566 4.944.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.203 22 16.447 22 12.021 22 6.484 17.523 2 12 2z" />
              </svg>
              {t('header.nav.github')}
            </a>
          </nav>
          )}
        </div>

        {/* Editor toolbar strip — fills the middle the nav vacated. */}
        {editorToolbar && <div className="header-editor-toolbar">{editorToolbar}</div>}

        {/* Right: language + share + auth + mobile hamburger. In the
            desktop-editor variant this block does not render at all: the
            language switcher and the account button move to the corner box
            below (bottom-left), Share lives in File > Share/Embed, and the
            autosave dot rides next to the menus — every pixel of the row
            goes to the toolbar, which is what lets 1440px-with-chat keep
            the single-row layout. */}
        {!editorToolbar && (
        <div className="header-right">

          {/* Share button — visible when a project is loaded */}
          {currentProject && samePath(location.pathname, localize('/editor')) && (
            <button
              onClick={() => setShowShareModal(true)}
              style={{
                background: 'transparent',
                border: '1px solid #555',
                borderRadius: 4,
                padding: '4px 10px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                color: '#ccc',
                fontSize: 13,
              }}
              title={t('header.shareProject', 'Share project')}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              Share
            </button>
          )}

          {/* Account & GitHub Profile Dropdown */}
          <div className="header-account-root" ref={accountMenuRef}>
            <button
              type="button"
              className={`header-account-btn${accountOpen ? ' header-account-btn--open' : ''}`}
              onClick={() => setAccountOpen((v) => !v)}
              aria-label="Account & GitHub Profile"
              title="Account · Chirudeep Reddy"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
              <span>Account</span>
            </button>

            {accountOpen && (
              <div className="header-account-dropdown">
                <div className="header-account-user">
                  <div className="header-account-avatar">CR</div>
                  <div className="header-account-meta">
                    <strong>Chirudeep Reddy</strong>
                    <span>BL.EN.U4ECE24164</span>
                    <small>ECE · Amrita University</small>
                  </div>
                </div>

                <div className="header-account-divider" />

                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="header-account-gh-link"
                  onClick={() => {
                    trackVisitGitHub();
                    setAccountOpen(false);
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                  </svg>
                  <span>GitHub (@chiru1122006)</span>
                  <span style={{ marginLeft: 'auto', opacity: 0.7 }}>↗</span>
                </a>

                <a
                  href="https://www.linkedin.com/in/chiru-deep-reddy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="header-account-item-link"
                  onClick={() => setAccountOpen(false)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#0a66c2' }}>
                    <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                  </svg>
                  <span>LinkedIn Profile</span>
                  <span style={{ marginLeft: 'auto', opacity: 0.5 }}>↗</span>
                </a>

                <Link
                  to={localize('/about')}
                  className="header-account-item-link"
                  onClick={() => setAccountOpen(false)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <span>About Logicraft Studio</span>
                  <span style={{ marginLeft: 'auto', opacity: 0.5 }}>→</span>
                </Link>
              </div>
            )}
          </div>

          <div data-velxio-slot="header-auth" style={{ display: 'contents' }} />

          {/* Mobile hamburger — useless in desktop where the nav it
              would expand is itself hidden, and in the editor variant,
              where there is no nav to expand at all. */}
          {!import.meta.env.VITE_DESKTOP && !editorMenu && (
            <button
              className="header-hamburger"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Toggle menu"
            >
              <span />
              <span />
              <span />
            </button>
          )}
        </div>
        )}
      </div>

      {/* The account + language block lives in the file-explorer footer now
          (EditorPage renders it) — fused so a long file tree never scrolls
          underneath a floating box. */}

      {showShareModal && <ShareModal onClose={() => setShowShareModal(false)} />}
    </header>
  );
};
