import { usePageMotion } from '../usePageMotion';

const appStore = 'https://apps.apple.com/us/app/recipe-extractor-gu/id6755892896';
const features = [
  ['Save a cooking link', 'Bring recipes from TikTok, Instagram, YouTube and websites into one library.'],
  ['Keep a family recipe', 'Scan recipe cards or cookbook pages, or type a recipe in yourself. Review the ingredients and steps before saving.'],
  ['Cook at your pace', 'Follow one step at a time in Cook Mode, with timers close at hand. Ask for substitutions or help with a cooking question.'],
  ['Plan meals and groceries', 'Put saved recipes on your weekly plan. Build a grocery list, check items off offline and sync when you reconnect.'],
];

export default function Home() {
  const root = usePageMotion();
  return (
    <div ref={root} className="home">
      <section className="hero">
        <div className="container hero-layout">
          <div className="hero-copy">
            <h1 data-motion="rise">Recipes worth keeping</h1>
            <p className="hero-tagline" data-motion="ink">Håfa Recipes turns cooking videos, websites and family recipe cards into recipes you can plan, shop for and cook.</p>
            <a href={appStore} target="_blank" rel="noopener noreferrer" className="btn btn-primary" data-motion="rise">Get the iPhone app</a>
            <a href="#features" className="hero-more">Explore the features</a>
          </div>
          <img className="hero-mark" src="/brand-mark.svg" alt="Håfa’s latte-stone mark" data-motion="settle" width="420" height="420" />
        </div>
      </section>
      <section className="features" id="features">
        <div className="container">
          <div className="section-heading" data-motion="rise">
            <h2>From saved to served</h2>
            <p>Keep the recipe you found in a feed close to the ones you grew up with.</p>
          </div>
          <dl className="feature-list">
            {features.map(([title, description]) => <div key={title} data-motion="ink"><dt>{title}</dt><dd>{description}</dd></div>)}
          </dl>
        </div>
      </section>
      <section className="island-section">
        <div className="container island-content">
          <h2 data-motion="rise">Made in Guam</h2>
          <div data-motion="ink"><p>For the recipes passed around a table, and the ones passed around a group chat.</p><p>Håfa comes from Håfa Adai, a welcome. Our mark is inspired by the Chamorro latte stone. Håfa Recipes brings that welcome to everyday cooking.</p></div>
        </div>
      </section>
      <section className="cta">
        <div className="container cta-content">
          <div data-motion="rise"><h2>Keep your next recipe</h2><p>All features are free during beta while we improve extraction and prepare paid plans to cover AI costs.</p></div>
          <a href={appStore} target="_blank" rel="noopener noreferrer" className="btn btn-primary" data-motion="ink">Get the iPhone app</a>
        </div>
      </section>
    </div>
  );
}
