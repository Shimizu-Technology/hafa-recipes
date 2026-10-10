import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createShareFence } from "./share-fence";
import {
  repsLabel,
  fetchSnapshot,
  publicApiBase,
  shareToken,
  ShareError,
  type PublicSnapshot,
  type PublicWorkout,
  type PublicProgram,
} from "./public-share";
export const supportEmail = "shimizutechnology@gmail.com";
export function Email({ subject = "Håfa Workouts support", children }: { subject?: string; children?: ReactNode }) {
  return <a href={`mailto:${supportEmail}?subject=${encodeURIComponent(subject)}`}>{children ?? supportEmail}</a>;
}
function Mark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="20" fill="currentColor" />
      <path
        d="m15 20 7 26 10-18 10 18 7-26"
        fill="none"
        stroke="#C1DA80"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function Shell({ children, route }: { children: ReactNode; route: string }) {
  return (
    <>
      <a
        className="skip"
        href="#main"
        onClick={route.startsWith("/shared") ? (event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        } : undefined}
      >
        Skip to content
      </a>
      <header className="header">
        <a className="brand" href="/" aria-label="Håfa Workouts home">
          <Mark />
          <span>
            håfa<span className="brand-product">workouts</span>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a href="/#how">How it works</a>
          <a href="/support" aria-current={route === "/support" ? "page" : undefined}>
            Support
          </a>
          <a className="button small" href="/#beta">
            Beta updates <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <footer>
        <a className="brand" href="/">
          <Mark />
          <span>
            håfa<span className="brand-product">workouts</span>
          </span>
        </a>
        <p>
          Built by{" "}
          <a href="https://shimizu-technology.com" rel="noreferrer">
            Shimizu Technology
          </a>{" "}
          in Guam.
          <br />
          One Håfa account. Your choices, in each app.
        </p>
        <nav aria-label="Footer navigation">
          <a href="/privacy">Privacy</a>
          <a href="/delete-account">Account & data deletion</a>
          <a href="/terms">Terms</a>
          <a href="/support">Support</a>
        </nav>
        <small>© {new Date().getFullYear()} Shimizu Technology</small>
      </footer>
    </>
  );
}
function Home() {
  return (
    <>
      <section className="hero section">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="dot" /> A NEW WAY TO KEEP MOVING
          </span>
          <h1>
            Save the workout.
            <br />
            Make it <em>your routine.</em>
          </h1>
          <p className="lead">
            From a workout you found online to a plan that fits your life. Keep the details, train with intention, and
            see the work you put in.
          </p>
          <div className="actions">
            <a className="button" href="#how">
              See how it works <span aria-hidden="true">↓</span>
            </a>
            <a className="text-link" href="#beta">
              iPhone + Android beta
            </a>
          </div>
          <p className="fine">Beta is being prepared. Free in beta; paid options are planned later.</p>
        </div>
        <div
          className="product-scene"
          role="img"
          aria-label="Illustrative workflow: keep the original source, review your session, and record what you actually did."
        >
          <div className="scene-label">FROM INSPIRATION TO ACTION</div>
          <div className="source-slip">
            <span className="eyebrow">01 / KEEP THE SOURCE</span>
            <p>
              “That workout I saved
              <br />
              three weeks ago…”
            </p>
            <div className="source-line" />
            <div className="source-line short" />
          </div>
          <div className="training-card">
            <div className="card-top">
              <span>TODAY</span>
              <span className="pill">YOUR ROUTINE</span>
            </div>
            <h2>
              A little stronger.
              <br />A little more you.
            </h2>
            <div className="illustration-stats">
              <div>
                <strong>Warm up</strong>
                <span>Make room to begin</span>
              </div>
              <div>
                <strong>Your session</strong>
                <span>Reviewed, ready to follow</span>
              </div>
              <div>
                <strong>Your actuals</strong>
                <span>Record what you did</span>
              </div>
            </div>
            <div className="scene-action">
              Show up. Keep going. <span>↗</span>
            </div>
          </div>
          <p className="scene-caption">Illustrative layout · no personal training recommendation</p>
        </div>
      </section>
      <div className="principles">
        <span>Review the source</span>
        <span>Keep your library private</span>
        <span>Track what you actually do</span>
      </div>
      <section className="section split" id="how">
        <div>
          <span className="eyebrow">LESS LOST IN YOUR SAVED POSTS</span>
          <h2>
            A useful routine
            <br />
            starts with <em>the details.</em>
          </h2>
          <p>
            Sets, reps, equipment, intervals, sides, and rest belong together. Missing information stays visible, so you
            can review it before you train.
          </p>
        </div>
        <ol className="steps">
          <li>
            <span>01</span>
            <div>
              <h3>Capture something worth keeping</h3>
              <p>
                Bring a link, text, screenshots, or a document. Review what the source actually says, correct the draft,
                and save it in your library. Sources vary; extraction can be incomplete.
              </p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>Build around your life</h3>
              <p>
                Choose goals, equipment, available days, and your current baseline. Review a concrete plan or coach
                suggestion before accepting it. Running, strength, general fitness, and activity conditioning can share
                the same home.
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>Follow it. Record it. Learn from it.</h3>
              <p>
                Keep actual reps, load, time, effort, and how it felt. Pause when life interrupts, return deliberately,
                and preserve what you already completed. Manual training remains useful when AI is off.
              </p>
            </div>
          </li>
        </ol>
      </section>
      <section className="section family">
        <span className="eyebrow">THE HÅFA FAMILY</span>
        <h2>
          Cook well.
          <br />
          Train your way.
        </h2>
        <div>
          <p>
            Håfa Recipes keeps your cooking inspiration. Håfa Workouts keeps your training inspiration. Use the same
            sign-in method in both.
          </p>
          <p>
            Sharing a Håfa account does not automatically share your recipe library, training profile, or Health data.
            Each connection needs its own permission.
          </p>
          <a className="text-link" href="https://hafa-recipes.com" rel="noreferrer">
            Meet Håfa Recipes <span aria-hidden="true">↗</span>
          </a>
        </div>
      </section>
      <section className="section choices">
        <div>
          <span className="eyebrow">YOU SET THE BOUNDARIES</span>
          <h2>
            Private by default.
            <br />
            Connected by choice.
          </h2>
        </div>
        <div>
          <p>
            Your library is your space. Publish a reviewed snapshot only when you want to share a workout or plan. There
            is no public Discover feed for your private training.
          </p>
          <p>
            Optional Apple Health and Health Connect connections use exercise summaries. Reading on your device, storing
            summaries, using eligible context for AI, and writing completed actuals each have their own controls.
          </p>
          <a className="text-link" href="/privacy">
            Read how your data works <span aria-hidden="true">↗</span>
          </a>
        </div>
      </section>
      <section className="section beta" id="beta">
        <span className="eyebrow">NEXT UP: YOUR NEXT SESSION</span>
        <h2>
          iPhone + Android.
          <br />A beta worth trying.
        </h2>
        <p>
          The beta is being prepared. Store downloads and a public TestFlight link are not available here yet. We’ll
          publish verified links when they are ready.
        </p>
        <div className="actions">
          <Email subject="Håfa Workouts beta interest">Ask about beta availability ↗</Email>
          <a href="/support">Get help</a>
        </div>
        <p className="fine">
          Email opens your own mail app. We do not create a mailing-list subscription on this site.
        </p>
        <p className="fine">
          For adults 18 and older pursuing general fitness. Plans and AI suggestions need your review; they are not
          medical advice or a fitness clearance.
        </p>
      </section>
    </>
  );
}
function Reading({ title, kicker, children }: { title: string; kicker: string; children: ReactNode }) {
  return (
    <article className="reading section">
      <span className="eyebrow">{kicker}</span>
      <h1>{title}</h1>
      {children}
    </article>
  );
}
function Support() {
  return (
    <Reading kicker="A LITTLE HELP GOES A LONG WAY" title="Let’s get you moving.">
      <p className="lead">
        For questions, bugs, beta availability, or account help, email <Email />.
      </p>
      <p>
        Tell us which app, device, app version, and step you were on. Never send a password, sign-in code, Health
        export, or sensitive medical details. A screenshot with personal information removed can help.
      </p>
      <h2>Common questions</h2>
      <details>
        <summary>Where can I download the app?</summary>
        <p>
          The iPhone and Android beta is being prepared. This website has no verified store download or public
          TestFlight link yet. <Email subject="Håfa Workouts beta availability">Ask about availability</Email> for your
          device.
        </p>
      </details>
      <details>
        <summary>Will every online workout import?</summary>
        <p>
          No. Some sources are unavailable, incomplete, or omit essential targets. Review the original and the extracted
          draft, keep missing values unspecified, and add your own corrections deliberately. You can also create a
          workout manually.
        </p>
      </details>
      <details>
        <summary>Can I train without AI or without internet?</summary>
        <p>
          Manual training does not require AI consent. Installed apps keep account-scoped training drafts and unsynced
          actuals on the device. Source extraction, coaching, and cloud synchronization require internet. Review pending
          saves when you reconnect.
        </p>
      </details>
      <details>
        <summary>Do Recipes and Workouts share all my information?</summary>
        <p>
          They share a Håfa login. Product data stays separate unless you choose a specific connection. Recipe library
          and meal-plan summaries need their own opt-in. Health choices are separate again.
        </p>
      </details>
      <details>
        <summary>What happens to a revoked sharing link?</summary>
        <p>
          New reads and imports stop when a link expires or is revoked. Someone who deliberately saved their own copy
          keeps that independent copy. See the public preview before opening it in Workouts.
        </p>
      </details>
      <details>
        <summary>How do I export or remove data?</summary>
        <p>
          In Workouts, open Account → Account data and deletion. Choose a private export, Workouts-only removal, or
          whole-Håfa-account deletion. <a href="/delete-account">Read the scope and request help without the app</a>.
        </p>
      </details>
      <h2>General fitness, with your own judgment</h2>
      <p>
        Declare limitations and follow any professional instructions that apply to you. Stop an activity if something
        feels wrong. This app does not diagnose, treat, or clear you to exercise.
      </p>
    </Reading>
  );
}
function DeleteAccount() {
  return (
    <Reading kicker="YOUR ACCOUNT. YOUR DATA." title="Choose what you want to remove.">
      <p className="lead">
        Recipes and Workouts share one Håfa account. Removing Workouts data and deleting that account have different
        effects.
      </p>
      <h2>Remove only Workouts data</h2>
      <p>
        In Workouts, open Account → Account data and deletion → Review Workouts-only removal. Review the scope and
        confirm. Local private drafts, pending commands, temporary capture/export files, and reminders are erased before
        saved server data is requested for deletion. If the network request fails, local drafts remain erased; retry
        saved-data deletion.
      </p>
      <p>
        Your login and Recipes data remain. Workouts links stop working. Content-free import allowance records may
        remain for up to 48 hours to protect the shared beta. These records contain no source text, images, or workout
        content.
      </p>
      <h2>Delete the whole Håfa account</h2>
      <p>
        Choose Review whole-account deletion in that same screen and confirm both products. This removes Recipes and
        Workouts data, including remaining content-free import allowance records, and signs you out. External login and
        uploaded-file cleanup may finish after server data is erased.
      </p>
      <p>
        <strong>
          Deleting your account in an older Recipes app also deletes the shared Håfa account and both products’ data.
        </strong>{" "}
        The existing account-deletion behavior is preserved.
      </p>
      <h2>Without an installed app</h2>
      <p>
        Email <Email subject="Håfa account or Workouts data deletion request" /> from the address connected to your
        account. Say whether you want <strong>Workouts-only data removal</strong> or{" "}
        <strong>whole Håfa account deletion, including Recipes</strong>. If you cannot access that email address,
        identify the account address so we can arrange ownership verification. Do not send passwords or sign-in codes.
      </p>
      <p>
        We verify ownership and the requested scope before acting. Opening the email link does not delete anything or
        send a message automatically.
      </p>
      <h2>What removal cannot take back</h2>
      <p>
        Workout records already written to Apple Health or Health Connect need their own controls in your device’s
        Health app. Copies that recipients deliberately saved remain independent. Export files you saved outside the app
        remain wherever you saved them. <a href="/privacy">Read the privacy policy</a>.
      </p>
    </Reading>
  );
}
function Privacy() {
  return (
    <Reading kicker="PRIVACY POLICY · OCTOBER 10, 2026" title="Useful connections. Clear boundaries.">
      <p className="lead">
        Håfa Workouts is developed by Shimizu Technology in Guam, USA. This policy describes the Workouts app, its
        optional connections, and this public website. Contact <Email subject="Håfa Workouts privacy question" /> with
        privacy requests.
      </p>
      <h2>One account, separate product data</h2>
      <p>
        Clerk manages sign-in information such as your email and authentication identifiers. Workouts and Recipes use
        the same Håfa account. Your training profile, library, plans, actuals, and Health projections stay separate from
        Recipes unless you grant a specific connection.
      </p>
      <h2>What Workouts saves</h2>
      <p>
        We save the profile information you provide, workout prescriptions and source provenance, saved versions, plans,
        activity declarations, completed/partial actuals, sharing choices, and permissions. Optional personal context
        includes age, weight, height, goals, equipment, current baseline, and user-declared limitations. You can leave
        optional details unspecified.
      </p>
      <p>
        Drafts, unsynced training, and local preferences are scoped to your account on the device. Source
        photos/documents used for extraction and review are temporary: they clear after acceptance/cancellation or
        expire within 24 hours. Saved prescriptions, evidence, and version history remain until removed. Corrections and
        measurement removal can clear saved AI context and pending proposals while preserving completed actuals.
      </p>
      <h2>AI is a separate choice</h2>
      <p>
        With the AI disclosure accepted, extraction sends the relevant source content and coaching sends permitted
        training context to OpenAI. Eligible Health context also needs its own AI permission; a Health connection alone
        does not authorize AI use. Manual training remains available with AI off. Recipes context is not automatically
        supplied to the current Workouts coach.
      </p>
      <p>
        Requests use the API’s <code>store:false</code> setting. That setting does not mean zero provider retention.
        OpenAI’s standard abuse-monitoring logs may retain customer content for up to 30 days, and other
        feature-specific controls or exceptions may apply. We do not claim this account has Zero Data Retention. See{" "}
        <a href="https://developers.openai.com/api/docs/guides/your-data" rel="noreferrer">
          OpenAI’s current data controls
        </a>
        .
      </p>
      <h2>Apple Health and Health Connect</h2>
      <p>
        Optional native connections request exercise summaries, not body measurements, sleep, or heart-rate permissions.
        Reading is foreground only. On-device reading, server upload, eligible AI use, and actual-workout write-back
        have separate app choices and device permissions. Imported summaries keep their source attribution and are not
        silently turned into completed Håfa sessions. Write-back uses recorded actual training, including supported
        pause intervals; unavailable or incomplete timing stays blocked.
      </p>
      <p>
        Disconnecting blocks new access and removes imported server projections. You can revoke device permissions in
        your operating system. Removing app data does not erase workout records already in the system Health store.
      </p>
      <h2>Recipes connections</h2>
      <p>
        Separate choices allow bounded recipe-library or meal-plan summaries to be viewed in Workouts. These do not send
        your training or Health information back into Recipes. Ingredient and nutrition summaries retain their original
        basis and uncertainty; stale or unverified values are not presented as current estimates.
      </p>
      <h2>Intentional public snapshots</h2>
      <p>
        Your library is private by default. Publishing requires a reviewed public preview and confirmation. Anyone with
        the resulting link can read its workout or relative program snapshot until it expires or is revoked. That
        projection excludes private profile/Health/history information and creator notes; source links are included only
        if the owner deliberately chooses them.
      </p>
      <p>
        Revocation stops future reads and copies. Previously saved recipient copies, screenshots, downloaded exports,
        and already viewed previews cannot be recalled. Copied programs require the recipient’s own review and are not
        automatically personalized.
      </p>
      <h2>Storage, retention, and export</h2>
      <p>
        Our shared API/database uses Render and Neon. Network transport uses HTTPS when deployed. Workouts export
        snapshots are private, encrypted server records that expire within 10 minutes; privacy removal or revocation
        invalidates them. The native app removes temporary export files after its share sheet closes or private-device
        cleanup runs. Files saved elsewhere are under your control.
      </p>
      <p>
        We retain saved product records until you remove them or your account. Content-free import allowance records can
        remain for up to 48 hours after Workouts-only removal; whole-account deletion clears them. They do not retain
        source text, images, workout content, or an AI prompt. Operational providers may retain separate security or
        legally required records under their own policies.
      </p>
      <h2>This website</h2>
      <p>
        This website sets no advertising or analytics cookies and includes no tracking SDK. Shared-view content and
        tokens are not written to browser local storage or our client telemetry. Preferred share links keep the token in
        a URL fragment; legacy path links can still pass through hosting infrastructure. Hosting and API providers
        process request metadata to deliver and protect the service. Do not repost a private sharing link unless you
        intend to distribute access.
      </p>
      <h2>Your choices and requests</h2>
      <p>
        Inspect and edit your profile, revoke connections, clear conversations, export saved records, remove
        Workouts-only data, or delete the whole account. <a href="/delete-account">Read deletion instructions</a>,
        including requests without the app and the impact on Recipes. Whole-account deletion from legacy Recipes
        versions continues to remove both products.
      </p>
      <h2>Adults and policy changes</h2>
      <p>
        Workouts is for adults 18 and older pursuing general fitness. It is not a medical service. If you believe
        someone under 18 has provided information, contact us. Policy changes will appear here with an updated date;
        feature-specific permission screens explain their current scope.
      </p>
      <p>
        Provider policies:{" "}
        <a href="https://clerk.com/legal/privacy" rel="noreferrer">
          Clerk
        </a>
        ,{" "}
        <a href="https://openai.com/policies/privacy-policy/" rel="noreferrer">
          OpenAI
        </a>
        ,{" "}
        <a href="https://render.com/privacy" rel="noreferrer">
          Render
        </a>
        ,{" "}
        <a href="https://neon.com/privacy-policy" rel="noreferrer">
          Neon
        </a>
        , and{" "}
        <a href="https://www.netlify.com/privacy/" rel="noreferrer">
          Netlify
        </a>
        .
      </p>
    </Reading>
  );
}
function Terms() {
  return (
    <Reading kicker="TERMS OF USE · OCTOBER 10, 2026" title="Train with intention.">
      <p>
        Håfa Workouts supports adult general fitness. By using it, you agree to provide information you are entitled to
        share and to review source drafts and suggested changes before relying on them.
      </p>
      <h2>Your training and your sources</h2>
      <p>
        AI can miss or misread source details. Workout extraction does not transfer copyright or grant permission to
        redistribute a creator’s content. Share only material you have the right to share. You remain responsible for
        choosing activities suitable for your situation and following professional guidance where needed.
      </p>
      <h2>Beta availability and billing</h2>
      <p>
        The beta is being prepared for iPhone and Android. It is planned to be free in beta, with paid options later.
        Features, limits, and availability may change during testing. No price or future entitlement is promised here,
        and this website takes no payment.
      </p>
      <h2>Appropriate use</h2>
      <p>
        Do not impersonate others, publish private information without permission, misuse Health data, circumvent
        service limits, or submit unlawful content. Suggestions are not medical advice, diagnosis, or a guarantee of
        results. Source availability and third-party services can change.
      </p>
      <h2>Help and account controls</h2>
      <p>
        For content concerns, account issues, or these terms, contact <Email />. <a href="/privacy">Privacy choices</a>{" "}
        and <a href="/delete-account">data removal instructions</a> remain available without signing in.
      </p>
    </Reading>
  );
}
export function WorkoutView({ workout: w }: { workout: PublicWorkout }) {
  const [visible, setVisible] = useState(5);
  return (
    <section className="shared-workout">
      <div className="workout-heading">
        <span className="eyebrow">
          {w.kind} · {w.provenance}
        </span>
        <h2>{w.title}</h2>
        <p>
          {w.estimated_minutes == null
            ? "Source duration not specified"
            : `Source estimate: ${w.estimated_minutes} minutes`}
        </p>
        <p>
          <strong>Required equipment:</strong>{" "}
          {w.equipment_required.length ? w.equipment_required.join(", ") : "Not specified in this public snapshot"}
        </p>
        {!!w.equipment_optional.length && (
          <p>
            <strong>Optional:</strong> {w.equipment_optional.join(", ")}
          </p>
        )}
        {w.source_url && (
          <a className="text-link" href={w.source_url} rel="noreferrer noopener" target="_blank">
            Open original source ↗
          </a>
        )}
        {w.source_creator && <p>Source creator: {w.source_creator}</p>}
        {w.source_title && <p>Source title: {w.source_title}</p>}
      </div>
      {w.blocks.slice(0, visible).map((block, index) => (
        <div className="workout-block" key={index}>
          <span className="eyebrow">
            PART {index + 1} · {block.grouping}
          </span>
          <h3>{block.label || `Part ${index + 1}`}</h3>
          <p>
            {block.rounds == null ? "Group rounds not specified" : `${block.rounds} group rounds`}
            {block.rest_between_rounds_seconds != null ? ` · ${block.rest_between_rounds_seconds}s between rounds` : ""}
          </p>
          {!block.exercises.length && <p>No exercise prescriptions in this part.</p>}
          {block.exercises.map((e, i) => (
            <div className="exercise" key={i}>
              <h4>{e.name}</h4>
              <dl>
                <div>
                  <dt>Sets</dt>
                  <dd>{e.sets ?? "Not specified"}</dd>
                </div>
                <div>
                  <dt>Reps{e.per_side ? " per side" : ""}</dt>
                  <dd>{repsLabel(e.reps_min, e.reps_max)}</dd>
                </div>
                {e.duration_seconds != null && (
                  <div>
                    <dt>Time</dt>
                    <dd>{e.duration_seconds}s</dd>
                  </div>
                )}
                {e.distance_meters != null && (
                  <div>
                    <dt>Distance</dt>
                    <dd>{e.distance_meters}m</dd>
                  </div>
                )}
                {e.load != null && (
                  <div>
                    <dt>Source load</dt>
                    <dd>
                      {e.load} {e.load_unit ?? "unit unspecified"} ·{" "}
                      {e.load_convention?.replaceAll("_", " ") ?? "convention unspecified"}
                    </dd>
                  </div>
                )}
                {e.rest_seconds != null && (
                  <div>
                    <dt>Rest</dt>
                    <dd>{e.rest_seconds}s</dd>
                  </div>
                )}
                {e.tempo && (
                  <div>
                    <dt>Tempo</dt>
                    <dd>{e.tempo}</dd>
                  </div>
                )}
              </dl>
              {e.provenance && <small>Prescription provenance: {e.provenance}</small>}
            </div>
          ))}
        </div>
      ))}
      {visible < w.blocks.length && (
        <button onClick={() => setVisible((count) => count + 5)}>
          Show next parts ({w.blocks.length - visible} remaining)
        </button>
      )}
    </section>
  );
}
function Share() {
  const [snapshot, setSnapshot] = useState<PublicSnapshot | null>(null);
  const [error, setError] = useState<ShareError["code"] | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(0);
  const [copy, setCopy] = useState("");
  const [locationVersion, setLocationVersion] = useState(0);
  const fence = useRef<ReturnType<typeof createShareFence> | null>(null);
  if (!fence.current) fence.current = createShareFence(() => shareToken(location.pathname, location.hash, location.search));
  useEffect(() => {
    function changedLink() {
      fence.current!.invalidate();
      setSnapshot(null);
      setToken(null);
      setCopy("");
      setPage(0);
      setLocationVersion((version) => version + 1);
    }
    window.addEventListener("hashchange", changedLink);
    window.addEventListener("popstate", changedLink);
    return () => {
      fence.current!.invalidate();
      window.removeEventListener("hashchange", changedLink);
      window.removeEventListener("popstate", changedLink);
    };
  }, []);
  useEffect(() => {
    fence.current!.invalidate();
    setSnapshot(null);
    setToken(null);
    setPage(0);
    setCopy("");
    const value = shareToken(location.pathname, location.hash, location.search);
    if (!value) {
      setError("invalid");
      return;
    }
    setToken(value);
    history.replaceState(null, "", "/shared#" + value);
    const request = fence.current!.begin(value);
    const { controller } = request;
    const timer = setTimeout(() => {
      if (request.current()) {
        controller.abort();
        setError("network");
      }
    }, 20000);
    setError(null);
    setSnapshot(null);
    void (async () => {
      try {
        const base = publicApiBase(import.meta.env.VITE_WORKOUTS_PUBLIC_API_BASE ?? "");
        const result = await fetchSnapshot(base, value, controller.signal);
        if (request.current()) {
          if (Date.parse(result.expires_at) <= Date.now()) throw new ShareError("unavailable");
          setSnapshot(result);
        }
      } catch (e) {
        if (request.current()) setError(e instanceof ShareError ? e.code : "network");
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      clearTimeout(timer);
      request.dispose();
    };
  }, [attempt, locationVersion]);
  useEffect(() => {
    if (!snapshot || !token) return;
    const current = fence.current!.capture(token);
    let timer: ReturnType<typeof setTimeout>;
    function checkExpiry() {
      if (!current()) return;
      const remaining = Date.parse(snapshot!.expires_at) - Date.now();
      if (remaining <= 0) {
        setSnapshot(null);
        setError("unavailable");
      } else timer = setTimeout(checkExpiry, Math.min(remaining, 2147483647));
    }
    checkExpiry();
    return () => clearTimeout(timer);
  }, [snapshot, token]);
  async function copyLink() {
    if (!token) return;
    const current = fence.current!.capture(token);
    try {
      await navigator.clipboard.writeText(`${location.origin}/shared#${token}`);
      if (current()) setCopy("Link copied. Anyone who receives it can access the public snapshot while it is available.");
    } catch {
      if (current()) setCopy("Copy is unavailable here. Use your browser’s address bar to copy this link.");
    }
  }
  return (
    <Reading kicker="INTENTIONALLY SHARED" title="A workout worth keeping.">
      {error ? (
        <div className="notice" role="alert">
          <h2>
            {error === "unavailable"
              ? "This link is no longer available."
              : error === "invalid"
                ? "This sharing link is invalid."
                : error === "too_large"
                  ? "This snapshot is too large to display here."
                  : "The snapshot could not be loaded."}
          </h2>
          <p>
            {error === "unavailable"
              ? "It may have expired or been revoked. Ask the sender for a new reviewed link."
              : error === "configuration"
                ? "Public sharing is not connected on this website yet. The sender can help you find the available app."
                : error === "invalid"
                  ? "Check the complete link with the person who shared it."
                  : "Try again when your connection is available. Your library has not changed."}
          </p>
          {["network", "too_large"].includes(error) && (
            <button onClick={() => setAttempt((n) => n + 1)}>Try loading again</button>
          )}
          <a href="/support">Get help without sharing your token</a>
        </div>
      ) : !snapshot ? (
        <div className="loading" role="status">
          <span className="dot" /> Loading the reviewed public snapshot…
        </div>
      ) : (
        <>
          <div className="share-meta">
            <p>
              Shared by {snapshot.attribution.shared_by_display_name || "a Håfa member"} · source revision{" "}
              {snapshot.attribution.source_revision}
            </p>
            <p>Expires {new Date(snapshot.expires_at).toLocaleString()}</p>
            <p>This is a public snapshot. No personal profile, Health history, or completed training is included.</p>
          </div>
          {snapshot.review_required && (
            <div className="notice">
              Source details need review. Missing targets stay missing. This snapshot is not a personalized training
              recommendation.
            </div>
          )}
          {snapshot.kind === "program" ? (
            <>
              <h2>{(snapshot.content as PublicProgram).title}</h2>
              <p>{(snapshot.content as PublicProgram).notice}</p>
              <p>
                These are relative program days, not your calendar or a plan fitted to your profile. A saved recipient
                copy requires its own review.
              </p>
              {!(snapshot.content as PublicProgram).sessions.length && <p>No sessions are included.</p>}
              {(snapshot.content as PublicProgram).sessions.slice(page * 5, page * 5 + 5).map((session, index) => (
                <section className="program-session" key={index}>
                  <span className="eyebrow">
                    SESSION {session.sequence} · RELATIVE DAY {session.day_offset + 1}
                  </span>
                  <WorkoutView workout={session.workout} />
                </section>
              ))}
              <div className="actions">
                {page > 0 && <button onClick={() => setPage((p) => p - 1)}>Previous sessions</button>}
                {(page + 1) * 5 < (snapshot.content as PublicProgram).sessions.length && (
                  <button onClick={() => setPage((p) => p + 1)}>Next sessions</button>
                )}
              </div>
            </>
          ) : (
            <WorkoutView workout={snapshot.content as PublicWorkout} />
          )}
          <div className="share-actions">
            <h2>Keep it intentionally.</h2>
            <p>
              Opening the app does not automatically import this snapshot. Review it there and choose whether to save
              your own copy.
            </p>
            <a className="button" href={`hafaworkouts://shared/${token}`}>
              Open in Håfa Workouts ↗
            </a>
            <button
              className="secondary"
              onClick={() => {
                void copyLink();
              }}
            >
              Copy sharing link
            </button>
            {!!copy && <p role="status">{copy}</p>}
            <details>
              <summary>App not installed or the button did not open it?</summary>
              <p>
                You can keep reading here or copy the link for later. The iPhone and Android beta is being prepared;{" "}
                <a href="/#beta">verified install links will appear here</a> when available. We do not redirect you
                automatically.
              </p>
            </details>
            <p className="fine">
              Revocation stops new reads/copies. Copies already deliberately saved by recipients remain independent.
            </p>
          </div>
        </>
      )}
    </Reading>
  );
}
export function App({ path }: { path: string }) {
  const route =
    path === "/privacy" ? (
      <Privacy />
    ) : path === "/support" ? (
      <Support />
    ) : path === "/delete-account" ? (
      <DeleteAccount />
    ) : path === "/terms" ? (
      <Terms />
    ) : path === "/shared" || path.startsWith("/shared/") ? (
      <Share />
    ) : path === "/" ? (
      <Home />
    ) : (
      <Reading kicker="LET’S FIND YOUR WAY BACK" title="That page is not here.">
        <p>
          The address may be incomplete. <a href="/">Return to Håfa Workouts</a> or <a href="/support">get help</a>.
        </p>
      </Reading>
    );
  return <Shell route={path}>{route}</Shell>;
}
