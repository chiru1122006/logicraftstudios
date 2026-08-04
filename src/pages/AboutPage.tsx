import { Link } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { AppHeader } from '../components/layout/AppHeader';
import { useLocalizedHref } from '../i18n/useLocalizedNavigate';
import { useSEO } from '../utils/useSEO';
import { getSeoMeta } from '../seoRoutes';
import './AboutPage.css';

const GITHUB_URL = 'https://github.com/chiru1122006';
const LINKEDIN_URL = 'https://www.linkedin.com/in/chiru-deep-reddy';
const GITHUB_PROFILE = 'https://github.com/chiru1122006';

/* ── Icons ──────────────────────────────────────────── */
const IcoChip = () => (
  <img src="/logicraft.png" alt="Logo" style={{ width: 20, height: 20, objectFit: 'contain' }} />
);

const IcoGitHub = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

const IcoLinkedIn = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
  </svg>
);



/* ── Component ──────────────────────────────────────── */
export const AboutPage: React.FC = () => {
  const { t } = useTranslation();
  const localize = useLocalizedHref();
  useSEO({
    ...getSeoMeta('/about')!,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'AboutPage',
      name: 'About Logicraft Studio',
      description: 'Learn about Logicraft Studio and its creator David Montero Crespo.',
      url: 'https://logicraftstudios.tech/about',
    },
  });

  return (
    <div className="about-page">
      <AppHeader />

      {/* Hero */}
      <section className="about-hero">
        <div className="about-hero-inner">
          <h1 className="about-hero-title">{t('about.hero.title')}</h1>
          <p className="about-hero-sub">{t('about.hero.subtitle')}</p>
        </div>
      </section>

      {/* The Story */}
      <section className="about-section">
        <div className="about-container">
          <div className="about-story">
            <h2 className="about-heading">{t('about.story.heading')}</h2>
            <p>{t('about.story.p1')}</p>
            <p>
              <Trans i18nKey="about.story.p2" components={{ strong: <strong /> }} />
            </p>
            <p>{t('about.story.p3')}</p>
            <p>
              <Trans i18nKey="about.story.p4" components={{ strong: <strong /> }} />
            </p>
            <p>
              <Trans i18nKey="about.story.p5" components={{ strong: <strong /> }} />
            </p>
          </div>
        </div>
      </section>

      {/* Architecture overview */}
      <section className="about-section about-section-alt">
        <div className="about-container">
          <h2 className="about-heading">{t('about.howItWorks.heading')}</h2>
          <div className="about-arch-grid">
            <div className="about-arch-card">
              <div className="about-arch-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                  <rect x="8" y="8" width="8" height="8" />
                  <path d="M10 2v2M14 2v2M10 20v2M14 20v2M2 10h2M2 14h2M20 10h2M20 14h2" />
                </svg>
              </div>
              <h3>AVR8 &amp; RP2040</h3>
              <p>{t('about.howItWorks.avrRp2040Body')}</p>
            </div>
            <div className="about-arch-card">
              <div className="about-arch-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </div>
              <h3>ESP32 via QEMU</h3>
              <p>{t('about.howItWorks.esp32Body')}</p>
            </div>
            <div className="about-arch-card">
              <div className="about-arch-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
              </div>
              <h3>RISC-V via QEMU</h3>
              <p>{t('about.howItWorks.riscvBody')}</p>
            </div>
            <div className="about-arch-card">
              <div className="about-arch-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </div>
              <h3>Raspberry Pi 3</h3>
              <p>{t('about.howItWorks.raspiBody')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Open Source Philosophy */}
      <section className="about-section">
        <div className="about-container">
          <h2 className="about-heading">{t('about.openSource.heading')}</h2>
          <p>
            <Trans i18nKey="about.openSource.lead" components={{ strong: <strong /> }} />
          </p>
          <p>{t('about.openSource.creditsIntro')}</p>
          <ul className="about-credits-list">
            <li>
              <a href="https://github.com/wokwi/avr8js" target="_blank" rel="noopener noreferrer">
                avr8js
              </a>{' '}
              — {t('about.openSource.credits.avr8js')}
            </li>
            <li>
              <a href="https://github.com/wokwi/rp2040js" target="_blank" rel="noopener noreferrer">
                rp2040js
              </a>{' '}
              — {t('about.openSource.credits.rp2040js')}
            </li>
            <li>
              <a
                href="https://github.com/wokwi/wokwi-elements"
                target="_blank"
                rel="noopener noreferrer"
              >
                wokwi-elements
              </a>{' '}
              — {t('about.openSource.credits.wokwiElements')}
            </li>
            <li>
              <a href="https://github.com/lcgamboa/qemu" target="_blank" rel="noopener noreferrer">
                QEMU lcgamboa fork
              </a>{' '}
              — {t('about.openSource.credits.qemuLcgamboa')}
            </li>
            <li>
              <a
                href="https://arduino.github.io/arduino-cli/"
                target="_blank"
                rel="noopener noreferrer"
              >
                arduino-cli
              </a>{' '}
              — {t('about.openSource.credits.arduinoCli')}
            </li>
          </ul>
          <p>
            <Trans
              i18nKey="about.openSource.inspiredBy"
              components={{
                a: <a href="https://wokwi.com" target="_blank" rel="noopener noreferrer" />,
              }}
            />
          </p>
        </div>
      </section>

      {/* Creator */}
      <section className="about-section about-section-alt">
        <div className="about-container">
          <h2 className="about-heading">{t('about.creator.heading')}</h2>
          <div className="about-creator">
            <div className="about-creator-photo">
              <img
                className="about-creator-avatar"
                src="https://api.dicebear.com/7.x/bottts/svg?seed=ChirudeepReddy"
                alt="Chirudeep Reddy"
                width={120}
                height={120}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="about-creator-info">
              <h3 className="about-creator-name">Chirudeep Reddy</h3>
              <p className="about-creator-role">{t('about.creator.role')}</p>
              <p className="about-creator-bio">{t('about.creator.bio1')}</p>
              <p className="about-creator-bio">{t('about.creator.bio2')}</p>
              <p className="about-creator-bio">
                <Trans
                  i18nKey="about.creator.bio3"
                  components={{
                    a: (
                      <a
                        href="https://github.com/chiru1122006"
                        target="_blank"
                        rel="noopener noreferrer"
                      />
                    ),
                  }}
                />
              </p>

              <div className="about-creator-stack">
                <h4>{t('about.creator.techStack')}</h4>
                <div className="about-tags">
                  <span className="about-tag">ECE</span>
                  <span className="about-tag">BL.EN.U4ECE24164</span>
                  <span className="about-tag">Amrita University</span>
                  <span className="about-tag">Embedded Systems</span>
                  <span className="about-tag">Arduino</span>
                  <span className="about-tag">ESP32</span>
                  <span className="about-tag">Raspberry Pi</span>
                  <span className="about-tag">SPICE Analog</span>
                  <span className="about-tag">C / C++</span>
                  <span className="about-tag">TypeScript</span>
                  <span className="about-tag">React</span>
                  <span className="about-tag">Python</span>
                  <span className="about-tag">Docker</span>
                </div>
              </div>

              <div className="about-creator-links">
                <a
                  href={LINKEDIN_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="about-social-link"
                >
                  <IcoLinkedIn /> LinkedIn
                </a>
                <a
                  href={GITHUB_PROFILE}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="about-social-link"
                >
                  <IcoGitHub /> GitHub
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>



      {/* CTA */}
      <section className="about-cta">
        <div className="about-container">
          <h2>{t('about.cta.title')}</h2>
          <p>{t('about.cta.subtitle')}</p>
          <div className="about-cta-btns">
            <Link to={localize('/editor')} className="about-btn-primary">
              {t('about.cta.openEditor')}
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="about-btn-secondary"
            >
              <IcoGitHub /> {t('landing.hero.ctaGithub')}
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="footer-brand">
          <IcoChip />
          <span>Logicraft Studio</span>
        </div>
        <div className="footer-links">
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            {t('header.nav.github')}
          </a>
          <Link to={localize('/docs')}>{t('header.nav.documentation')}</Link>
          <Link to={localize('/examples')}>{t('header.nav.examples')}</Link>
          <Link to={localize('/editor')}>{t('header.nav.editor')}</Link>
          <Link to={localize('/about')}>{t('header.nav.about')}</Link>
        </div>
        <p className="footer-copy">{t('footer.about')}</p>
      </footer>
    </div>
  );
};
