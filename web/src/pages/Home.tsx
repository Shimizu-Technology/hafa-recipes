import { useState } from 'react';
import { photos, screens, imagePath, imageSet } from '../homeMedia';
import { usePageMotion } from '../usePageMotion';
import '../home.css';

const appStore = 'https://apps.apple.com/us/app/recipe-extractor-gu/id6755892896';
function Download() {
  return <a href={appStore} target="_blank" rel="noopener noreferrer" className="btn btn-primary">Get the iPhone app</a>;
}
function Photo({ photo, priority = false }: { photo: typeof photos.cilantro; priority?: boolean }) {
  return <img src={imagePath(photo.file, 1280)} srcSet={imageSet(photo.file, [640, 1280, 1920])} sizes="(max-width: 800px) 100vw, 60vw" alt={photo.alt} width="1920" height="1280" loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : 'auto'} decoding="async" />;
}

export default function Home() {
  const root = usePageMotion();
  const [view, setView] = useState(0);
  const screen = screens[view];
  return (
    <div ref={root} className="home photo-home">
      <section className="hero">
        <div className="container hero-layout">
          <div className="hero-copy">
            <h1 data-motion="rise">Recipes worth keeping</h1>
            <p className="hero-tagline" data-motion="ink">Save recipes from TikTok, Instagram, YouTube, websites and family cards. Håfa Recipes helps you plan, shop and cook.</p>
            <div data-motion="rise"><Download /></div>
            <a href="#features" className="hero-more">Take a look inside</a>
          </div>
          <div className="hero-media">
            <figure className="kitchen-photo" data-motion="settle"><Photo photo={photos.cilantro} priority /><figcaption>Chopping cilantro</figcaption></figure>
            <figure className="import-capture" data-motion="rise"><img src={imagePath('app-import', 878)} srcSet={imageSet('app-import', [480, 878])} sizes="(max-width: 800px) 90vw, 350px" width="878" height="1530" alt="Håfa Recipes import screen with link, text, photo and manual options" decoding="async" /><figcaption>Bring a recipe into Håfa</figcaption></figure>
          </div>
        </div>
      </section>
      <section className="app-tour" id="features">
        <div className="container tour-layout">
          <div className="tour-copy">
            <h2 data-motion="rise">A recipe you can use</h2>
            <p data-motion="ink">One library for the recipes you find and the ones your family shares.</p>
            <fieldset className="view-picker" data-motion="ink">
              <legend>Choose an app view</legend>
              {screens.map((item, index) => <label key={item.name}><input type="radio" name="app-view" value={item.name} checked={view === index} onChange={() => setView(index)} aria-controls="app-preview" /><span>{item.name}</span></label>)}
            </fieldset>
            <p className="view-description" aria-live="polite">{screen.description}</p>
          </div>
          <figure className="app-preview" id="app-preview" data-motion="settle">
            <img key={screen.file} src={imagePath(screen.file, 878)} srcSet={imageSet(screen.file, [480, 878])} sizes="(max-width: 800px) 90vw, 420px" width="878" height={screen.height} alt={screen.alt} loading="lazy" decoding="async" />
            <figcaption>{screen.name} in Håfa Recipes</figcaption>
          </figure>
        </div>
      </section>
      <section className="family-kitchen">
        <div className="container">
          <div className="kitchen-heading">
            <h2 data-motion="rise">Keep a family favourite</h2>
            <p data-motion="ink">A card in someone’s handwriting. A recipe sent in a group chat. Scan it, check the details and keep it close.</p>
          </div>
          <figure data-motion="settle"><Photo photo={photos.dough} /></figure>
        </div>
      </section>
      <section className="week-at-home">
        <div className="container week-layout">
          <h2 data-motion="rise">Dinner, with a plan</h2>
          <div data-motion="ink"><p>Put your saved recipes on a weekly meal plan. Bring the ingredients into your grocery list, then open Cook Mode when it’s time to eat.</p><p>Your grocery list works offline and syncs when you reconnect.</p></div>
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
          <div data-motion="ink"><Download /></div>
        </div>
      </section>
      <section className="photo-credits container">
        <h2>Photo credits</h2>
        <p>{Object.values(photos).map((photo, index) => <span key={photo.file}>{index > 0 && ' · '}<a href={photo.source}>{photo.title}</a> by {photo.creator}. </span>)}<a href="https://unsplash.com/license">Unsplash License</a>.</p>
      </section>
    </div>
  );
}
