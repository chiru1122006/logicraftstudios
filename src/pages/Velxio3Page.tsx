/**
 * /v3 — Velxio 3.0 Release Landing Page
 * Highlights programmable retro CPUs (Z80/8080/4004/4040/8086), MicroSD and
 * ePaper emulation, true multi-board interconnect, full undo/redo, the ngspice
 * WASM migration, an 88% smaller bundle, and 100+ new gallery examples.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '../components/layout/AppHeader';
import { useLocalizedHref } from '../i18n/useLocalizedNavigate';
import { useSEO } from '../utils/useSEO';
import { getSeoMeta } from '../seoRoutes';
import { trackClickCTA } from '../utils/analytics';
import './SEOPage.css';
import './Velxio2Page.css';

const GITHUB_URL = 'https://github.com/chiru1122006';
const DISCORD_URL = 'https://discord.gg/3mARjJrh4E';

/* ── SVG Icons (no emojis) ─────────────────────────────── */
const IcoRocket = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
    <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
  </svg>
);

const IcoChip = () => (
  <img src="/logicraft.png" alt="Logo" style={{ width: 20, height: 20, objectFit: 'contain' }} />
);

const IcoCard = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 3h10l4 4v14a0 0 0 0 1 0 0H5a0 0 0 0 1 0 0V3z" />
    <path d="M9 3v5M13 3v5M9 13h6M9 17h6" />
  </svg>
);

const IcoLink = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const IcoBook = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
);

const IcoWave = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12h3l3-9 4 18 3-12 3 6h4" />
  </svg>
);

const IcoUndo = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7v6h6" />
    <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
  </svg>
);

const IcoGauge = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 14a2 2 0 1 0 0-.001" />
    <path d="M12 14l4-4" />
    <path d="M4 19a8 8 0 1 1 16 0" />
  </svg>
);

const IcoLightning = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const IcoTestTube = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 2v17.5c0 1.4-1.1 2.5-2.5 2.5s-2.5-1.1-2.5-2.5V2" />
    <path d="M8.5 2h7" />
    <path d="M14.5 16h-5" />
  </svg>
);

const IcoGitHub = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

const IcoDiscord = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

const IcoStar = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const JSON_LD: object[] = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Logicraft Studio 3.0 — Retro CPU, Multi-Board & Circuit Simulator',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any (browser-based)',
    softwareVersion: '3.0.0',
    description:
      'Logicraft Studio 3.0 adds programmable retro CPUs (Z80, 8080, 4004, 4040, 8086), MicroSD card emulation, ePaper displays, true multi-board UART/I2C/SPI interconnect, full undo/redo, a full ngspice WASM migration, an 88% smaller bundle, and 100+ new gallery examples. Free and open-source.',
    url: 'https://logicraftstudios.tech/v3',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    author: { '@type': 'Person', name: 'David Montero Crespo' },
    license: 'https://www.gnu.org/licenses/agpl-3.0.html',
  },
  {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Logicraft Studio', item: 'https://logicraftstudios.tech/' },
      { '@type': 'ListItem', position: 2, name: 'Logicraft Studio 3.0', item: 'https://logicraftstudios.tech/v3' },
    ],
  },
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'What is new in Logicraft Studio 3.0?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Logicraft Studio 3.0 adds programmable retro CPUs (Z80, Intel 8080, 4004, 4040 and 8086) with custom ROM and in-editor assembly, MicroSD card emulation over SPI, ePaper display emulation (SSD168x, UC8159c 7-colour, UC8179), true multi-board UART/I2C/SPI/GPIO interconnect, ESP32-CAM with a real webcam bridge, full undo/redo, a complete ngspice WASM migration, an 88% smaller bundle, much faster ESP-IDF compiles, and 100+ new gallery examples.',
        },
      },
      {
        '@type': 'Question',
        name: 'Can I run retro CPUs like the Z80 or Intel 4004 in the browser?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes. Logicraft Studio 3.0 emulates Z80, Intel 8080, 4004, 4040 and 8086 as canvas chips. Load your own ROM, write assembly in the built-in editor, and run them board-less or wired to modern peripherals — all in the browser, no install.',
        },
      },
      {
        '@type': 'Question',
        name: 'Can multiple boards talk to each other in Logicraft Studio?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes. Logicraft Studio 3.0 has wire-aware multi-board interconnect: UART, I2C, SPI and plain GPIO links work across every supported board, so an ESP32, a Raspberry Pi Pico and an Arduino can communicate on the same canvas, solved together.',
        },
      },
    ],
  },
];

const CHANGE_SECTIONS = [
  {
    icon: <IcoChip />,
    title: 'Retro CPU Chips',
    color: '#8957e5',
    items: [
      'Z80, Intel 8080, 4004, 4040 and 8086 processors',
      'Programmable ROM — load your own machine code',
      'Board-less operation: run a bare CPU with no host board',
      'In-editor assembly support for retro targets',
      'Step a classic instruction set right on the canvas',
      'Pair retro CPUs with modern peripherals',
    ],
  },
  {
    icon: <IcoCard />,
    title: 'Storage & ePaper Displays',
    color: '#007acc',
    items: [
      'MicroSD card emulation over SPI (AVR, RP2040, ESP32)',
      'FAT16 image with an upload panel — read and write real files',
      'ePaper SSD168x panels: black/white and tri-colour',
      'UC8159c ACeP 7-colour ePaper',
      'UC8179 mono ePaper with correct rotation and BUSY timing',
      'Byte-aware panel orientation across every board',
    ],
  },
  {
    icon: <IcoLink />,
    title: 'Multi-Board Interconnect',
    color: '#b08800',
    items: [
      'Wire-aware UART, I2C, SPI and digital links across boards',
      'An ESP32, a Pico and an Arduino on one canvas, talking',
      'SignalRouter for ESP32 GPIO Matrix routing',
      'ESP32-CAM emulation with a real webcam frame bridge via QEMU',
      'Board removal reconciles the running simulation cleanly',
      'Every supported board can interconnect',
    ],
  },
  {
    icon: <IcoBook />,
    title: 'Library Manager',
    color: '#1a7f37',
    items: [
      'Per-board library manifests scoped to each compile',
      'Content-addressed cache — deduped, fast and shared',
      'Version management, uninstall, and autocomplete',
      'src/-layout libraries (ArduinoJson, etc.) compile correctly',
      'Single unified tab with state-aware row actions',
      'Add to project / In project / Remove in one place',
    ],
  },
  {
    icon: <IcoWave />,
    title: 'Simulation Accuracy',
    color: '#4a9e6b',
    items: [
      'Full ngspice WASM migration — one solver path, browser and Node',
      'PinResolver: SPICE-resolved digital inputs for mixed-mode',
      'Oscilloscope trigger modes — Auto, Normal, Single',
      'Edge selection and trigger-position control',
      'RP2040 real-time: IdleSpinDetector elides busy-wait loops',
      'AVR and ESP32 UART waveforms synthesized at the bit level',
    ],
  },
  {
    icon: <IcoUndo />,
    title: 'Editor & Canvas',
    color: '#c8701a',
    items: [
      'Full undo/redo: components, wires, moves, rotations, properties',
      'Draggable minimap with a moveable viewport',
      'Drag-to-move parts while the simulation runs',
      'Wires follow component rotation automatically',
      'Component deletion cascades to connected wires',
      'Board options modal and per-target compile console',
    ],
  },
  {
    icon: <IcoGauge />,
    title: 'Performance',
    color: '#a8304d',
    items: [
      'Main bundle cut 88% — from ~23 MB to ~2.68 MB',
      'manualChunks split wokwi-elements, terminal and MCU emulators',
      'ESP-IDF warm compiles drop from 5-7 min to 5-30 s',
      'ccache with an 8 GB cap and persistent build directories',
      'Compilation dedup stops duplicate ninja jobs racing',
      'Faster SPI/I2C waveform rendering via worker batching',
    ],
  },
  {
    icon: <IcoStar />,
    title: 'Pro & Desktop',
    color: '#6e7681',
    items: [
      'GitHub Sync, Share/Embed modal, BOM CSV and schematic PNG export',
      'Desktop app: welcome page, license gating, native menubar',
      'In-app update toast and a splash screen during boot',
      'i18n across 9 locales (en, es, pt-br, it, fr, zh-cn, de, ja, ru)',
      'Extension hooks for private overlays (auth, session, agent chat)',
      '.vlx project export/import for stateless self-hosters',
    ],
  },
  {
    icon: <IcoTestTube />,
    title: 'Examples & Testing',
    color: '#a8304d',
    items: [
      '100+ new gallery examples added',
      'Pico Doom, ESP32-CAM preview, ePaper dashboards, retro-CPU demos',
      'A 100 Days of IoT series and dozens of analog circuits',
      'Netlist snapshot tests for every gallery example',
      'Visual LED test harness driven over Chrome DevTools Protocol',
      'Backend end-to-end tests re-enabled in CI',
    ],
  },
];

export const Velxio3Page: React.FC = () => {
  const { t } = useTranslation();
  const localize = useLocalizedHref();
  useSEO({ ...getSeoMeta('/v3')!, jsonLd: JSON_LD });

  return (
    <div className="seo-page">
      <AppHeader />
      <main>
        {/* ── Hero ── */}
        <section className="v2-hero">
          <div className="v2-version-badge">
            <IcoRocket /> {t('v3.versionBadge')}
          </div>
          <h1>
            Logicraft Studio 3.0
            <br />
            <span className="accent">{t('v3.heroAccent')}</span>
          </h1>
          <p className="subtitle">{t('v3.heroSubtitle')}</p>
          <div className="seo-cta-group">
            <Link
              to={localize('/editor')}
              className="seo-btn-primary"
              onClick={() => trackClickCTA('velxio-v3', '/editor')}
            >
              <IcoLightning />
              {t('v3.tryV3')}
            </Link>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="seo-btn-secondary">
              <IcoGitHub /> {t('landing.hero.ctaGithub')}
            </a>
          </div>

          <div className="v2-community-row">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="v2-community-btn v2-star-btn">
              <IcoStar />
              <span>{t('starBanner.cta')}</span>
            </a>
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="v2-community-btn v2-discord-btn">
              <IcoDiscord />
              <span>{t('v2.joinDiscord')}</span>
            </a>
          </div>
        </section>

        {/* ── What's new ── */}
        <section className="seo-section">
          <h2>{t('v3.whatsNewHeading')}</h2>
          <p className="lead">{t('v3.whatsNewLead')}</p>

          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('v3.retroTitle')}</h3>
              <p>{t('v3.retroBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('v3.multiBoardTitle')}</h3>
              <p>{t('v3.multiBoardBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('v3.polishTitle')}</h3>
              <p>{t('v3.polishBody')}</p>
            </div>
          </div>
        </section>

        {/* ── Full changelog ── */}
        <section className="seo-section">
          <h2>{t('v3.catalogHeading')}</h2>
          <p className="lead">{t('v3.catalogLead')}</p>

          <div className="v2-changelog">
            {CHANGE_SECTIONS.map((section) => (
              <div key={section.title} className="v2-change-block">
                <div className="v2-change-header" style={{ color: section.color }}>
                  {section.icon}
                  <h3>{section.title}</h3>
                </div>
                <ul className="v2-change-list">
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* ── Examples ── */}
        <section className="seo-section">
          <h2>{t('v3.examplesHeading')}</h2>
          <p className="lead">{t('v3.examplesLead')}</p>
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <Link to={localize('/examples')} className="seo-btn-secondary">
              {t('examples.browseAll')}
            </Link>
          </div>
        </section>

        {/* ── Outcome ── */}
        <section className="seo-section">
          <h2>{t('v3.outcomeHeading')}</h2>
          <p className="lead">{t('v3.outcomeLead')}</p>
          <div className="seo-grid">
            <div className="seo-card">
              <h3>{t('v3.outcome.build')}</h3>
              <p>{t('v3.outcome.buildBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('v3.outcome.learn')}</h3>
              <p>{t('v3.outcome.learnBody')}</p>
            </div>
            <div className="seo-card">
              <h3>{t('v3.outcome.openSource')}</h3>
              <p>{t('v3.outcome.openSourceBody')}</p>
            </div>
          </div>
        </section>

        {/* ── Built on ── */}
        <section className="seo-section">
          <h2>{t('v2.builtOnOss')}</h2>
          <p className="lead">{t('v3.builtOnOssLead')}</p>
          <div className="v2-repos">
            <a href="https://ngspice.sourceforge.io/" target="_blank" rel="noopener noreferrer" className="v2-repo-card">
              <IcoGitHub />
              <div>
                <h3>ngspice</h3>
                <p>The open-source SPICE circuit simulator — now the single analog solver across browser and tests</p>
              </div>
            </a>
            <a href="https://www.qemu.org/" target="_blank" rel="noopener noreferrer" className="v2-repo-card">
              <IcoGitHub />
              <div>
                <h3>QEMU</h3>
                <p>Powers ESP32 (Xtensa), RISC-V, ARM and the new ESP32-CAM webcam bridge</p>
              </div>
            </a>
            <a href="https://github.com/wokwi/avr8js" target="_blank" rel="noopener noreferrer" className="v2-repo-card">
              <IcoGitHub />
              <div>
                <h3>avr8js</h3>
                <p>AVR8 CPU emulator in JavaScript — Arduino Uno, Nano, Mega, ATtiny85</p>
              </div>
            </a>
            <a href="https://github.com/wokwi/rp2040js" target="_blank" rel="noopener noreferrer" className="v2-repo-card">
              <IcoGitHub />
              <div>
                <h3>rp2040js</h3>
                <p>RP2040 emulator — Raspberry Pi Pico and Pico W, now running in real time</p>
              </div>
            </a>
            <a href="https://github.com/wokwi/wokwi-elements" target="_blank" rel="noopener noreferrer" className="v2-repo-card">
              <IcoGitHub />
              <div>
                <h3>wokwi-elements</h3>
                <p>Web Components for electronic parts — LEDs, buttons, sensors, displays</p>
              </div>
            </a>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="v2-repo-card v2-repo-card--primary">
              <IcoGitHub />
              <div>
                <h3>Logicraft Studio</h3>
                <p>This project — free, open-source embedded systems &amp; circuit simulator</p>
              </div>
            </a>
          </div>
        </section>

        {/* ── Bottom CTA ── */}
        <div className="seo-bottom">
          <h2>{t('v3.bottom.title')}</h2>
          <p>{t('v3.bottom.body')}</p>
          <Link
            to={localize('/editor')}
            className="seo-btn-primary"
            onClick={() => trackClickCTA('velxio-v3', '/editor')}
          >
            {t('v2.bottom.cta')}
          </Link>

          <div className="v2-bottom-community">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="v2-community-btn v2-star-btn">
              <IcoStar />
              <span>{t('starBanner.cta')}</span>
            </a>
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="v2-community-btn v2-discord-btn">
              <IcoDiscord />
              <span>{t('v2.joinDiscord')}</span>
            </a>
          </div>

          <div className="seo-internal-links">
            <Link to={localize('/')}>{t('header.nav.home')}</Link>
            <Link to={localize('/v2-5')}>Logicraft Studio 2.5</Link>
            <Link to={localize('/v2')}>Logicraft Studio 2.0</Link>
            <Link to={localize('/examples')}>{t('header.nav.examples')}</Link>
            <Link to={localize('/docs/intro')}>{t('header.nav.documentation')}</Link>
            <Link to={localize('/arduino-simulator')}>Arduino Simulator</Link>
            <Link to={localize('/esp32-simulator')}>ESP32 Simulator</Link>
            <Link to={localize('/about')}>{t('header.nav.about')}</Link>
          </div>
        </div>
      </main>
    </div>
  );
};
