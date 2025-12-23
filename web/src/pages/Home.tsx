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
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
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
            <div className="feature-card">
              <div className="feature-icon">🎥</div>
              <h3>Video Extraction</h3>
              <p>
                Paste a TikTok, YouTube, or Instagram URL and let AI extract the complete recipe with ingredients, steps, and nutrition info.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">🌐</div>
              <h3>Website Import</h3>
              <p>
                Import recipes from any recipe website. Works with AllRecipes, Budget Bytes, Half Baked Harvest, and hundreds more.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">👨‍🍳</div>
              <h3>Cook Mode</h3>
              <p>
                Step-by-step cooking with large text, screen stays on, built-in timers, and quick ingredient reference.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">📅</div>
              <h3>Meal Planner</h3>
              <p>
                Plan your week with breakfast, lunch, dinner, and snack slots. Add entire week's ingredients to grocery list at once.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">🔍</div>
              <h3>What Can I Make?</h3>
              <p>
                Enter ingredients you have on hand and find matching recipes. See match percentage and missing ingredients.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">🌍</div>
              <h3>Discover Community</h3>
              <p>
                Browse recipes shared by the community. Save favorites, filter by top contributors, and find inspiration.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">📸</div>
              <h3>Photo Scanning</h3>
              <p>
                Scan handwritten or printed recipe cards with your camera. Support for multi-page recipes up to 10 images.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">💬</div>
              <h3>AI Recipe Chat</h3>
              <p>
                Ask questions about any recipe with text or voice. Get substitutions, cooking tips, and troubleshooting help.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">🛒</div>
              <h3>Smart Grocery List</h3>
              <p>
                Add ingredients from recipes to your grocery list. Clear by recipe, works offline, and syncs automatically.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">📁</div>
              <h3>Collections</h3>
              <p>
                Organize recipes into custom folders like "Weeknight Dinners" or "Holiday Favorites".
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">⚖️</div>
              <h3>Recipe Scaling</h3>
              <p>
                Adjust servings up or down. Ingredients and costs automatically scale to match.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">💰</div>
              <h3>Cost Estimates</h3>
              <p>
                See estimated costs per recipe with support for regional pricing (Guam, Hawaii, US, and more).
              </p>
            </div>
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
              <h3>Plan, Shop & Cook!</h3>
              <p>Add to meal planner, build your grocery list, and use Cook Mode for hands-free cooking.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta">
        <div className="container">
          <h2>Ready to Start Cooking?</h2>
          <p>Download Håfa Recipes today - free during beta! Extract unlimited recipes from videos and websites.</p>
          <a
            href="https://apps.apple.com/us/app/recipe-extractor-gu/id6755892896"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            Download Free on App Store
          </a>
          <p className="cta-note">✨ All features free during beta • Paid plans coming soon</p>
        </div>
      </section>
    </>
  );
}

