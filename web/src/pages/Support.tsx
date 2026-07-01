export default function Support() {
  return (
    <div className="page">
      <div className="container">
        <h1>Support</h1>
        <p>
          Need help with Håfa Recipes? We're here for you!
        </p>

        <h2>Contact Us</h2>
        <p>
          The best way to reach us is by email. We typically respond within 24-48 hours.
        </p>
        <p>
          <strong>Email:</strong> <a href="mailto:shimizutechnology@gmail.com">shimizutechnology@gmail.com</a>
        </p>

        <h2>Frequently Asked Questions</h2>

        <h3>What video platforms are supported?</h3>
        <p>
          Håfa Recipes currently supports TikTok, YouTube, and Instagram cooking videos. Simply paste the video URL and our AI will extract the recipe.
        </p>

        <h3>How does the recipe extraction work?</h3>
        <p>
          Our AI analyzes the audio and visual content of cooking videos to identify ingredients, steps, cooking times, and more. The extracted recipe is then formatted into a clean, easy-to-follow format.
        </p>

        <h3>Can I extract recipes from photos?</h3>
        <p>
          Yes! You can scan handwritten or printed recipe cards using your camera. We support multi-page recipes with up to 10 images.
        </p>

        <h3>Is my data secure?</h3>
        <p>
          Absolutely. We use industry-standard encryption and secure authentication through Clerk. Your recipes and personal data are stored securely and are never shared with third parties for marketing purposes.
        </p>

        <h3>Can I use the app offline?</h3>
        <p>
          Recipe extraction and account sync require an internet connection. Grocery lists support offline use and sync automatically when your connection returns.
        </p>

        <h3>How do I delete my account?</h3>
        <p>
          You can delete your account at any time through the app's Settings page. This will permanently remove all your personal data, recipes, and grocery lists from our servers.
        </p>

        <h3>Is there an Android version?</h3>
        <p>
          Android is coming soon! We're working on bringing Håfa Recipes to the Google Play Store.
        </p>

        <h2>Bug Reports & Feature Requests</h2>
        <p>
          Found a bug or have an idea for a feature? We'd love to hear from you! Send us an email at{' '}
          <a href="mailto:shimizutechnology@gmail.com">shimizutechnology@gmail.com</a> with details.
        </p>

        <h2>About Håfa Recipes</h2>
        <p>
          Håfa Recipes is developed by{' '}
          <a href="https://shimizu-technology.com" target="_blank" rel="noopener noreferrer">Shimizu Technology</a>, 
          a small software company based in Guam, USA. 
          "Håfa" comes from "Håfa Adai," the Chamorro greeting meaning "Hello" or "Welcome."
        </p>
        <p>
          Our mission is to make cooking more accessible by preserving and organizing recipes from social media 
          and family traditions using the power of AI.
        </p>
      </div>
    </div>
  );
}

