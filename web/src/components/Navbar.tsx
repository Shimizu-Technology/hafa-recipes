import { Link } from 'react-router-dom';

export default function Navbar() {
  return (
    <nav className="navbar">
      <div className="container">
        <Link to="/" className="navbar-brand">
          <img src="/icon.png" alt="Håfa Recipes" />
          <span>Håfa Recipes</span>
        </Link>
        <div className="navbar-links">
          <Link to="/">Home</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/support">Support</Link>
        </div>
      </div>
    </nav>
  );
}

