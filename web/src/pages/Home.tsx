import type { ReactElement } from 'react';

type FeatureIconName =
  | 'video'
  | 'website'
  | 'photo'
  | 'cook'
  | 'calendar'
  | 'grocery'
  | 'chat'
  | 'search'
  | 'collections'
  | 'spark';

const features: Array<{
  icon: FeatureIconName;
  title: string;
  description: string;
  featured?: boolean;
}> = [
  {
    icon: 'video',
    title: 'Extract from social video',
    description:
      'Paste TikTok, YouTube, or Instagram links and Håfa Recipes turns the video into ingredients, steps, timing, and notes.',
    featured: true,
  },
  {
    icon: 'photo',
    title: 'Scan recipe cards',
    description:
      'Capture handwritten or printed recipes with multi-page photo scanning for family favorites and cookbook clippings.',
  },
  {
    icon: 'cook',
    title: 'Cook mode',
    description:
      'Large step-by-step instructions, timers, and quick ingredient reference while you cook.',
  },
  {
    icon: 'calendar',
    title: 'Plan the week',
    description:
      'Build breakfast, lunch, dinner, and snack plans, then send ingredients to your grocery list.',
  },
  {
    icon: 'grocery',
    title: 'Smart grocery lists',
    description:
      'Group ingredients by recipe, use lists offline, and sync automatically when your connection returns.',
  },
  {
    icon: 'chat',
    title: 'Ask while cooking',
    description:
      'Use AI chat for substitutions, troubleshooting, scaling, and quick cooking guidance.',
  },
];

function FeatureIcon({ name }: { name: FeatureIconName }) {
  const commonProps = {
    width: 28,
    height: 28,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  const paths: Record<FeatureIconName, ReactElement> = {
    video: (
      <svg {...commonProps}>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="M10 9.5v5l4.5-2.5L10 9.5Z" fill="currentColor" stroke="none" />
      </svg>
    ),
    website: (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="9" />
        <path d="M3.6 9h16.8M3.6 15h16.8M12 3c2.2 2.4 3.3 5.4 3.3 9s-1.1 6.6-3.3 9M12 3C9.8 5.4 8.7 8.4 8.7 12s1.1 6.6 3.3 9" />
      </svg>
    ),
    photo: (
      <svg {...commonProps}>
        <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.5-2h5L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z" />
        <circle cx="12" cy="12.5" r="3" />
      </svg>
    ),
    cook: (
      <svg {...commonProps}>
        <path d="M6 10.5h12l-1 9H7l-1-9Z" />
        <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
        <path d="M9 14h6" />
      </svg>
    ),
    calendar: (
      <svg {...commonProps}>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3v4M16 3v4M4 10h16" />
        <path d="M8 14h2M12 14h2M16 14h2M8 17h2M12 17h2" />
      </svg>
    ),
    grocery: (
      <svg {...commonProps}>
        <path d="M4 5h2l2 10h9l2-7H7" />
        <circle cx="10" cy="19" r="1.5" />
        <circle cx="17" cy="19" r="1.5" />
      </svg>
    ),
    chat: (
      <svg {...commonProps}>
        <path d="M5 6.5A4.5 4.5 0 0 1 9.5 2h5A4.5 4.5 0 0 1 19 6.5v3A4.5 4.5 0 0 1 14.5 14H11l-4.5 4v-4A4.5 4.5 0 0 1 2 9.5v-3Z" />
        <path d="M8 8h8M8 11h5" />
      </svg>
    ),
    search: (
      <svg {...commonProps}>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </svg>
    ),
    collections: (
      <svg {...commonProps}>
        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />
      </svg>
    ),
    spark: (
      <svg {...commonProps}>
        <path d="M12 2v5M12 17v5M4.2 4.2l3.5 3.5M16.3 16.3l3.5 3.5M2 12h5M17 12h5M4.2 19.8l3.5-3.5M16.3 7.7l3.5-3.5" />
      </svg>
    ),
  };

  return <div className="feature-icon">{paths[name]}</div>;
}

function AppStoreIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="container hero-layout">
          <div className="hero-copy">
            <div className="eyebrow">Built in Guam for modern home cooks</div>
            <h1>Recipes from videos, websites, and family cards — organized beautifully.</h1>
            <p className="hero-tagline">
              Håfa Recipes uses AI to turn scattered cooking inspiration into clean recipes you can save, plan, shop from, and cook step by step.
            </p>
            <div className="hero-buttons">
              <a
                href="https://apps.apple.com/us/app/recipe-extractor-gu/id6755892896"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
              >
                <AppStoreIcon />
                Download on App Store
              </a>
              <a href="#features" className="btn btn-secondary">
                See what it does
              </a>
            </div>
            <dl className="hero-stats" aria-label="Håfa Recipes highlights">
              <div>
                <dt>10</dt>
                <dd>photo pages per scan</dd>
              </div>
              <div>
                <dt>4</dt>
                <dd>ways to add recipes</dd>
              </div>
              <div>
                <dt>Beta</dt>
                <dd>free while we tune AI costs</dd>
              </div>
            </dl>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="phone-shell">
              <div className="phone-topbar" />
              <div className="phone-card primary-card">
                <img src="/brand-mark.svg" alt="" />
                <span>AI recipe extraction</span>
                <strong>Paste a cooking link</strong>
                <p>TikTok, YouTube, Instagram, and recipe websites.</p>
              </div>
              <div className="phone-card recipe-card-preview">
                <span className="mini-label">Cook mode</span>
                <strong>Caramel Apple Dump Cake</strong>
                <p>12 servings · 75 min · step-by-step timers</p>
              </div>
              <div className="phone-card grocery-card-preview">
                <span className="mini-label">Grocery list</span>
                <strong>Grouped by recipe</strong>
                <p>Works offline and syncs automatically.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="features" id="features">
        <div className="container">
          <div className="section-heading split-heading">
            <div>
              <div className="eyebrow">One library for every recipe source</div>
              <h2>From inspiration to dinner plan.</h2>
            </div>
            <p>
              Save the recipe before it disappears in a feed. Then organize it into meals, groceries, collections, and cooking mode.
            </p>
          </div>

          <div className="bento-grid">
            {features.map((feature) => (
              <article className={feature.featured ? 'feature-card feature-card-large' : 'feature-card'} key={feature.title}>
                <FeatureIcon name={feature.icon} />
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="flow-section">
        <div className="container">
          <div className="section-heading centered">
            <div className="eyebrow">How it works</div>
            <h2>Three taps from link to usable recipe.</h2>
          </div>

          <div className="steps">
            <div className="step">
              <span className="step-number">01</span>
              <h3>Capture</h3>
              <p>Paste a link, scan a recipe card, import a website, or type a recipe manually.</p>
            </div>
            <div className="step">
              <span className="step-number">02</span>
              <h3>Clean up</h3>
              <p>AI extracts ingredients, steps, timing, nutrition estimates, costs, and notes into one consistent format.</p>
            </div>
            <div className="step">
              <span className="step-number">03</span>
              <h3>Cook</h3>
              <p>Save it, plan the week, build your grocery list, and cook with guided steps and timers.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="island-section">
        <div className="container island-card">
          <div>
            <div className="eyebrow">A Guam-rooted recipe app</div>
            <h2>Made for social recipes and family traditions.</h2>
          </div>
          <p>
            Håfa comes from Håfa Adai — a welcome. The brand mark is inspired by the Chamorro latte stone, pairing local identity with a warm, practical cooking tool for everyday kitchens.
          </p>
        </div>
      </section>

      <section className="cta">
        <div className="container cta-card">
          <FeatureIcon name="spark" />
          <h2>Ready to build your recipe library?</h2>
          <p>Download Håfa Recipes today. All features are free during beta while we improve extraction quality and prepare paid plans to cover AI costs.</p>
          <a
            href="https://apps.apple.com/us/app/recipe-extractor-gu/id6755892896"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            <AppStoreIcon />
            Download Free on App Store
          </a>
        </div>
      </section>
    </>
  );
}
