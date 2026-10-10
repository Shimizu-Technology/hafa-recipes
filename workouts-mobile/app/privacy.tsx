import { Copy, Notice, Screen } from "@/components/ui";
export default function Privacy() {
  return (
    <Screen back title="Privacy in Håfa Workouts." subtitle="What these features use, and the controls you have.">
      <Copy>
        Håfa Workouts uses one Håfa account with Recipes. Product data stays separate unless you explicitly connect it.
        The app supports adult general fitness and user-declared limitations.
      </Copy>
      <Copy>
        Your profile, private library, plans and completed training are saved in your account when you choose to save
        them. Local drafts and unsynced sessions stay scoped to your signed-in account on this device.
      </Copy>
      <Copy>
        AI features send the relevant source or permitted training context to OpenAI only with the AI disclosure
        accepted. Health context needs its separate connection choices and eligible source permissions. Manual training
        stays available when you decline AI.
      </Copy>
      <Copy>
        Uploaded source photos and documents are temporary for extraction/review and expire or clear after
        acceptance/cancellation. Saved workout prescriptions, evidence and version history remain private unless you
        deliberately publish a reviewed snapshot.
      </Copy>
      <Copy>
        Health connections request exercise summaries only. Device reading, server storage, AI use and actual-workout
        writing have separate choices. Health and personal training values must not appear in advertising or ordinary
        analytics payloads.
      </Copy>
      <Copy>
        Whole-Håfa-account deletion, including that operation in older Recipes versions, removes both products and the
        shared login. Removing one product’s data preserves the other app and the login. System Health records require
        their own on-device controls.
      </Copy>
      <Notice>
        Use the published privacy policy and support website for the full policy and requests. This screen explains the
        implemented feature controls; it is not a medical or fitness clearance.
      </Notice>
    </Screen>
  );
}
