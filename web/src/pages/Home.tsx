import type { ReactElement } from 'react';

type FeatureIconName =
  | 'video'
  | 'website'
  | 'cook'
  | 'calendar'
  | 'search'
  | 'discover'
  | 'photo'
  | 'chat'
  | 'grocery'
  | 'collections'
  | 'scaling'
  | 'cost';

const features: Array<{
  icon: FeatureIconName;
  title: string;
  description: string;
}> = [
  {
    icon: 'video',
    title: 'Video Extraction',
    description:
      'Paste a TikTok, YouTube, or Instagram URL and let AI extract the complete recipe with ingredients, steps, and nutrition info.',
  },
  {
    icon: 'website',
    title: 'Website Import',
    description:
      'Import recipes from any recipe website. Works with AllRecipes, Budget Bytes, Half Baked Harvest, and hundreds more.',
  },
  {
    icon: 'cook',
    title: 'Cook Mode',
    description:
      'Step-by-step cooking with large text, screen stays on, built-in timers, and quick ingredient reference.',
  },
  {
    icon: 'calendar',
    title: 'Meal Planner',
    description:
      "Plan your week with breakfast, lunch, dinner, and snack slots. Add an entire week's ingredients to your grocery list at once.",
  },
  {
    icon: 'search',
    title: 'What Can I Make?',
    description:
      'Enter ingredients you have on hand and find matching recipes. See match percentage and missing ingredients.',
  },
  {
    icon: 'discover',
    title: 'Discover Community',
    description:
      'Browse recipes shared by the community. Save favorites, filter by top contributors, and find inspiration.',
  },
  {
    icon: 'photo',
    title: 'Photo Scanning',
    description:
      'Scan handwritten or printed recipe cards with your camera. Support for multi-page recipes up to 10 images.',
  },
  {
    icon: 'chat',
    title: 'AI Recipe Chat',
    description:
      'Ask questions about any recipe with text or voice. Get substitutions, cooking tips, and troubleshooting help.',
  },
  {
    icon: 'grocery',
    title: 'Smart Grocery List',
    description:
      'Add ingredients from recipes to your grocery list. Clear by recipe, works offline, and syncs automatically.',
  },
  {
    icon: 'collections',
    title: 'Collections',
    description:
      'Organize recipes into custom folders like "Weeknight Dinners" or "Holiday Favorites".',
  },
  {
    icon: 'scaling',
    title: 'Recipe Scaling',
    description:
      'Adjust servings up or down. Ingredients and costs automatically scale to match.',
  },
  {
    icon: 'cost',
    title: 'Cost Estimates',
    description:
      'See estimated costs per recipe with support for regional pricing (Guam, Hawaii, US, and more).',
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
    search: (
      <svg {...commonProps}>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </svg>
    ),
    discover: (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="9" />
        <path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2Z" />
      </svg>
    ),
    photo: (
      <svg {...commonProps}>
        <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.5-2h5L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z" />
        <circle cx="12" cy="12.5" r="3" />
      </svg>
    ),
    chat: (
      <svg {...commonProps}>
        <path d="M5 6.5A4.5 4.5 0 0 1 9.5 2h5A4.5 4.5 0 0 1 19 6.5v3A4.5 4.5 0 0 1 14.5 14H11l-4.5 4v-4A4.5 4.5 0 0 1 2 9.5v-3Z" />
        <path d="M8 8h8M8 11h5" />
      </svg>
    ),
    grocery: (
      <svg {...commonProps}>
        <path d="M4 5h2l2 10h9l2-7H7" />
        <circle cx="10" cy="19" r="1.5" />
        <circle cx="17" cy="19" r="1.5" />
      </svg>
    ),
    collections: (
      <svg {...commonProps}>
        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />
      </svg>
    ),
    scaling: (
      <svg {...commonProps}>
        <path d="M12 4v16M6 7h12" />
        <path d="M7 7 4 14h6L7 7ZM17 7l-3 7h6l-3-7Z" />
      </svg>
    ),
    cost: (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="9" />
        <path d="M14.5 8.5A3 3 0 0 0 12 7.5c-1.7 0-3 .8-3 2s1.1 1.9 3 2.3c1.9.4 3 1.1 3 2.4s-1.3 2.3-3 2.3a4 4 0 0 1-3.3-1.4M12 6v12" />
      </svg>
    ),
  };

  return <div className="feature-icon">{paths[name]}</div>;
}

export default function Home() {
  return (
    <>
      {/* Hero Section */}
      <section className="hero">
        <div className="container">
          <img src="/icon.png" alt="Håfa Recipes" className="hero-icon" />
          <h1>Håfa Recipes</h1>
          <p className="hero-tagline">
            Transform cooking videos and recipe websites into detailed, structured recipes using AI. Extract from TikTok, YouTube, Instagram, or any recipe blog.
          </p>
          <div className="hero-buttons">
            <a
              href="https://apps.apple.com/us/app/recipe-extractor-gu/id6755892896"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
              </svg>
              Download on App Store
            </a>
            <a href="#features" className="btn btn-secondary">
              Learn More
            </a>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features" id="features">
        <div className="container">
          <h2 className="section-title">Everything You Need</h2>
          <p className="section-subtitle">
            Håfa Recipes is the all-in-one solution for extracting, organizing, and cooking recipes from your favorite videos.
          </p>

          <div className="features-grid">
            {features.map((feature) => (
              <div className="feature-card" key={feature.title}>
                <FeatureIcon name={feature.icon} />
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="how-it-works">
        <div className="container">
          <h2 className="section-title">How It Works</h2>
          <p className="section-subtitle">
            Extract recipes in seconds with just a few taps.
          </p>

          <div className="steps">
            <div className="step">
              <div className="step-number">1</div>
              <h3>Paste a URL</h3>
              <p>Copy a video link from TikTok, YouTube, Instagram, or any recipe website.</p>
            </div>

            <div className="step">
              <div className="step-number">2</div>
              <h3>AI Extracts Recipe</h3>
              <p>Our AI analyzes the content and extracts all the recipe details automatically.</p>
            </div>

            <div className="step">
              <div className="step-number">3</div>
              <h3>Plan, Shop & Cook</h3>
              <p>Add to meal planner, build your grocery list, and use Cook Mode for hands-free cooking.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta">
        <div className="container">
          <h2>Ready to Start Cooking?</h2>
          <p>Download Håfa Recipes today — free during beta. Extract unlimited recipes from videos and websites.</p>
          <a
            href="https://apps.apple.com/us/app/recipe-extractor-gu/id6755892896"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            Download Free on App Store
          </a>
          <p className="cta-note">All features free during beta. Paid plans coming soon.</p>
        </div>
      </section>
    </>
  );
}
