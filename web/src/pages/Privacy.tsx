export default function Privacy() {
  return (
    <div className="page">
      <div className="container">
        <h1>Privacy Policy</h1>
        <p><em>Last updated: December 2025</em></p>

        <h2>Overview</h2>
        <p>
          Håfa Recipes is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your information when you use our mobile application.
        </p>

        <h2>Information We Collect</h2>
        <p>
          When you create an account and use Håfa Recipes, we collect:
        </p>
        <ul>
          <li><strong>Account Information:</strong> Email address and authentication data (managed securely by Clerk)</li>
          <li><strong>Recipe Data:</strong> Recipes you extract, create, or save, including ingredients, steps, and images</li>
          <li><strong>Grocery Lists:</strong> Items you add to your grocery list</li>
          <li><strong>Usage Data:</strong> How you interact with the app to improve our service</li>
        </ul>

        <h2>How We Use Your Information</h2>
        <p>We use your information to:</p>
        <ul>
          <li>Provide and maintain the Håfa Recipes service</li>
          <li>Extract recipes from cooking videos using AI</li>
          <li>Sync your recipes and grocery lists across devices</li>
          <li>Improve our AI extraction accuracy and app features</li>
          <li>Send important service updates (you can opt out)</li>
        </ul>

        <h2>Third-Party Services</h2>
        <p>We use the following third-party services:</p>
        <ul>
          <li><strong>Clerk:</strong> For secure authentication (email, Google, Apple sign-in)</li>
          <li><strong>OpenAI:</strong> For AI-powered recipe extraction and chat features</li>
          <li><strong>Google (Gemini):</strong> For AI-powered recipe extraction</li>
          <li><strong>Amazon S3:</strong> For secure storage of recipe images</li>
          <li><strong>Render:</strong> For hosting our backend API</li>
        </ul>
        <p>
          These services have their own privacy policies. We recommend reviewing them for more information.
        </p>

        <h2>Data Storage & Security</h2>
        <p>
          Your data is stored securely on our servers hosted by Render. We use industry-standard encryption for data transmission (HTTPS/TLS). Recipe images are stored securely in Amazon S3.
        </p>
        <p>
          We retain your data for as long as your account is active. You can delete your account at any time through the app's Settings, which will remove all your personal data from our servers.
        </p>

        <h2>Your Rights</h2>
        <p>You have the right to:</p>
        <ul>
          <li>Access your personal data</li>
          <li>Export your recipes</li>
          <li>Delete your account and all associated data</li>
          <li>Opt out of non-essential communications</li>
        </ul>

        <h2>Children's Privacy</h2>
        <p>
          Håfa Recipes is not intended for children under 13. We do not knowingly collect personal information from children under 13.
        </p>

        <h2>Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last updated" date.
        </p>

        <h2>Contact Us</h2>
        <p>
          If you have questions about this Privacy Policy or your data, please contact us at:
        </p>
        <p>
          <strong>Email:</strong> <a href="mailto:shimizutechnology@gmail.com">shimizutechnology@gmail.com</a>
        </p>
        <p>
          <strong>Company:</strong> <a href="https://shimizu-technology.com" target="_blank" rel="noopener noreferrer">Shimizu Technology</a><br />
          Based in Guam, USA
        </p>
      </div>
    </div>
  );
}

