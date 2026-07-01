import { Link } from 'react-router-dom';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-content">
          <div>
            <div className="footer-brand">
              <img src="/icon.png" alt="Håfa Recipes" />
              <span>Håfa Recipes</span>
            </div>
            <p className="footer-description">
              Transform cooking videos, recipe websites, and family recipe cards into organized recipes using AI. Proudly made in Guam.
            </p>
          </div>

          <div>
            <h4>Links</h4>
            <div className="footer-links">
              <Link to="/">Home</Link>
              <Link to="/privacy">Privacy Policy</Link>
              <Link to="/support">Support</Link>
            </div>
          </div>

          <div>
            <h4>Download</h4>
            <div className="footer-links">
              <a href="https://apps.apple.com/us/app/recipe-extractor-gu/id6755892896" target="_blank" rel="noopener noreferrer">
                App Store
              </a>
              <a href="#" target="_blank" rel="noopener noreferrer">
                Google Play (Coming Soon)
              </a>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <span>© {currentYear} <a href="https://shimizu-technology.com" target="_blank" rel="noopener noreferrer">Shimizu Technology</a>. All rights reserved.</span>
          <span>Made in Guam</span>
        </div>
      </div>
    </footer>
  );
}

