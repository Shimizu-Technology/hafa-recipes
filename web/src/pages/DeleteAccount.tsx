export default function DeleteAccount() {
  return (
    <div className="page">
      <div className="container">
        <h1>Delete your Håfa Recipes account</h1>
        <p>
          You can request deletion of your Håfa Recipes account and its associated
          data even if you no longer have the app installed.
        </p>

        <h2>In the app</h2>
        <p>
          Open Settings, choose Delete Account, and follow the confirmations.
          This deletes your account and its associated recipes and collections,
          your grocery-list items and membership, and your meal-plan entries.
          The app also attempts to clear chat history saved on this device. If
          that fails, uninstall Håfa Recipes to remove the local data.
        </p>

        <h2>Without the app</h2>
        <p>
          Email <a href="mailto:shimizutechnology@gmail.com?subject=H%C3%A5fa%20Recipes%20account%20deletion%20request">shimizutechnology@gmail.com</a> from
          the address connected to your account and ask us to delete it. If you
          cannot use that address, tell us which address was on the account so we
          can verify ownership before deleting it. Do not send a password or
          sign-in code.
        </p>
        <p>
          We will confirm your request by email. Read our{' '}
          <a href="/privacy">Privacy Policy</a> for more about how we handle your data.
        </p>
      </div>
    </div>
  );
}
