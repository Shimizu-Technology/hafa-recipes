import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import { PostHogPageView } from './components/PostHogProvider';
import Home from './pages/Home';
import Privacy from './pages/Privacy';
import Support from './pages/Support';
import Terms from './pages/Terms';
import DeleteAccount from './pages/DeleteAccount';
import './index.css';

function App() {
  return (
    <BrowserRouter>
      <PostHogPageView />
      <Navbar />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/support" element={<Support />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/delete-account" element={<DeleteAccount />} />
        </Routes>
      </main>
      <Footer />
    </BrowserRouter>
  );
}

export default App;
