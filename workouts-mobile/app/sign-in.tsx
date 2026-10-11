import {
  restartSignIn,
  resendVerification,
  safeAuthFailure,
  validVerificationCode,
  createSendGate,
  remainingCooldown,
  type Verification,
} from "@/lib/auth-recovery";
import { useEffect, useRef, useState } from "react";
import { AppState, View, Platform } from "react-native";
import { useSignIn, useSignUp } from "@clerk/expo/legacy";
import { useSSO } from "@clerk/expo";
import * as AppleAuthentication from "expo-apple-authentication";
import * as WebBrowser from "expo-web-browser";
import { Button, Card, Choice, Copy, Field, Notice, Screen, useColors } from "@/components/ui";
import { callbackUrl, socialSignIn } from "@/lib/social";
WebBrowser.maybeCompleteAuthSession();
type Mode = "signin" | "signup" | "recover";
export default function SignIn() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const { signUp, isLoaded: signupLoaded } = useSignUp();
  const { startSSOFlow } = useSSO();
  const c = useColors();
  const guard = useRef(false);
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [verification, setVerification] = useState<Verification | null>(null);
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [sendUntil, setSendUntil] = useState(0);
  const [clock, setClock] = useState(Date.now);
  const sendGate = useRef(createSendGate());
  const cooldown = remainingCooldown(sendUntil, clock);
  function reserveSend() {
    const until = sendGate.current.reserve();
    if (until == null) {
      setError("Wait before requesting another email code.");
      return false;
    }
    setSendUntil(until);
    setClock(Date.now());
    return true;
  }
  useEffect(() => {
    if (!sendUntil) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= sendUntil) clearInterval(timer);
    }, 1000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") setClock(Date.now());
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [sendUntil]);
  async function run(action: () => Promise<void>) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (failure) {
      setError(safeAuthFailure(failure, verification));
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  async function finish(result: NonNullable<typeof signIn>, prepare = true) {
    if (result.status === "complete" && result.createdSessionId) {
      await setActive!({ session: result.createdSessionId });
      return;
    }
    if (result.status === "needs_second_factor" || result.status === "needs_client_trust") {
      if (!prepare) {
        setError(
          "Verification is not complete. Check the current code, retry, or request a new email code explicitly."
        );
        return;
      }
      const factor =
        result.supportedSecondFactors?.find((f) => f.strategy === "email_code") ??
        result.supportedSecondFactors?.find((f) => f.strategy === "totp");
      if (factor?.strategy === "email_code") {
        setVerification("email_code");
        setPassword("");
        setCode("");
        if (reserveSend())
          await result.prepareSecondFactor({ strategy: "email_code", emailAddressId: factor.emailAddressId });
        return;
      }
      if (factor?.strategy === "totp") {
        setPassword("");
        setCode("");
        setVerification("totp");
        return;
      }
    }
    setError("This sign-in needs a verification method this screen cannot complete. Try another available sign-in method or contact support.");
  }
  function switchMode(next: Mode) {
    if (busy || guard.current) return;
    const reset = restartSignIn(email);
    setEmail(reset.email);
    setMode(next);
    setError("");
    setMessage("");
    setVerification(reset.verification);
    setCode(reset.code);
    setPassword(reset.password);
  }
  async function submit() {
    if (!isLoaded || !signIn || (mode === "signup" && !signupLoaded)) return;
    if (!verification && (!email.trim() || (mode !== "recover" && !password))) {
      setError("Enter your email and password.");
      return;
    }
    if (mode === "signup" && !adult) {
      setError("Confirm you are 18 or older to create your account.");
      return;
    }
    if (verification && !validVerificationCode(code)) {
      setError("Enter exactly six digits from the newest verification code.");
      return;
    }
    await run(async () => {
      if (verification === "signup" && signUp) {
        const result = await signUp.attemptEmailAddressVerification({ code: code.trim() });
        if (result.status === "complete" && result.createdSessionId)
          await setActive!({ session: result.createdSessionId });
        else setError("Your account needs additional information. Try another sign-in method.");
      } else if (verification === "reset") {
        if (!password) {
          setError("Enter a new password.");
          return;
        }
        await finish(
          await signIn.attemptFirstFactor({ strategy: "reset_password_email_code", code: code.trim(), password })
        );
      } else if (verification === "email_code" || verification === "totp")
        await finish(await signIn.attemptSecondFactor({ strategy: verification, code: code.trim() }), false);
      else if (mode === "recover") {
        if (!reserveSend()) return;
        await signIn.create({ strategy: "reset_password_email_code", identifier: email.trim() });
        setVerification("reset");
        setCode("");
        setPassword("");
      } else if (mode === "signup" && signUp) {
        await signUp.create({ emailAddress: email.trim(), password });
        setVerification("signup");
        setPassword("");
        setCode("");
        if (reserveSend()) await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      } else await finish(await signIn.create({ identifier: email.trim(), password }));
    });
  }
  async function resend() {
    if (!verification || verification === "totp" || guard.current) return;
    if (!reserveSend()) return;
    setCode("");
    await run(async () => {
      await resendVerification(verification, { signIn: signIn ?? undefined, signUp: signUp ?? undefined });
      setMessage("A new verification email was requested. Check your inbox and use its newest six-digit code.");
    });
  }
  async function provider(strategy: "oauth_google" | "oauth_apple") {
    if (!signIn) {setError("Sign-in is still loading. Try again in a moment.");return;}
    if (mode === "signup" && !adult) {
      setError("Confirm you are 18 or older first.");
      return;
    }
    await run(async () => {
      if (mode === "signup") {
        const result = await startSSOFlow({ strategy, redirectUrl: callbackUrl });
        if (result.createdSessionId && result.setActive) await result.setActive({ session: result.createdSessionId });
        else setError("Account creation was not completed. You can use email instead.");
      } else if (strategy === "oauth_apple" && Platform.OS === "ios") {
        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          ],
        });
        if (credential.identityToken)
          await finish(await signIn.create({ strategy: "oauth_token_apple", token: credential.identityToken }));
      } else {
        const result = await socialSignIn(signIn, strategy);
        if (result) await finish(result);
      }
    });
  }
  return (
    <Screen
      title={
        mode === "signup"
          ? "Make space for training."
          : mode === "recover"
            ? "Back to your account."
            : "Your training starts here."
      }
      subtitle="Two apps. One Håfa account."
    >
      <Card tone="hero">
        <Copy kind="label" color="#DDEBCB">
          HÅFA WORKOUTS · FREE BETA
        </Copy>
        <Copy kind="heading" color="#FFFFFF">
          From saved inspiration to a routine that fits.
        </Copy>
        <Copy color="#E1EDD9">Already use Håfa Recipes? Use the same account and sign-in method.</Copy>
      </Card>
      <Notice>
        Recipes and training data stay separate unless you connect them. Deleting your whole Håfa account—including from
        an older Recipes app—deletes both apps’ data.
      </Notice>
      {mode === "signup" && (
        <Choice
          selected={adult}
          disabled={busy || !!verification}
          onPress={() => setAdult(!adult)}
          label="I am 18 or older"
          detail="Håfa Workouts supports adult general fitness."
        />
      )}
      {!verification && mode !== "recover" && (
        <View style={{ gap: 12 }}>
          <Button
            title={`${mode === "signup" ? "Join" : "Sign in"} with Apple`}
            secondary
            onPress={() => {
              void provider("oauth_apple");
            }}
            busy={busy}
          />
          <Button
            title={`${mode === "signup" ? "Join" : "Sign in"} with Google`}
            secondary
            onPress={() => {
              void provider("oauth_google");
            }}
            busy={busy}
          />
          <Copy kind="small" color={c.muted} style={{ textAlign: "center" }}>
            or use your email
          </Copy>
        </View>
      )}
      {!verification && (
        <Field
          key="auth-email"
          purpose="email"
          label="Email"
          value={email}
          onChange={setEmail}
          placeholder="you@example.com"
          disabled={busy}
        />
      )}
      {(!verification && mode !== "recover") || verification === "reset" ? (
        <Field
          key={
            verification === "reset"
              ? "auth-reset-password"
              : mode === "signup"
                ? "auth-signup-password"
                : "auth-signin-password"
          }
          purpose={verification === "reset" || mode === "signup" ? "new-password" : "current-password"}
          disabled={busy}
          label={verification === "reset" || mode === "signup" ? "New password" : "Password"}
          value={password}
          onChange={setPassword}
          secret
        />
      ) : null}
      {!!verification && (
        <>
          <Notice>
            {verification === "totp"
              ? "Enter the code from your authenticator app."
              : "Enter the code sent to your account email. Apple Hide My Email users may need their relay address."}
          </Notice>
          <Field
            key={`auth-code:${verification}`}
            purpose="verification-code"
            label="Verification code"
            value={code}
            onChange={setCode}
            disabled={busy}
          />
          {verification !== "totp" ? (
            <>
              <Button
                title={cooldown ? `Resend email code in ${cooldown}s` : "Resend email verification code"}
                secondary
                disabled={busy || cooldown > 0}
                onPress={() => {
                  void resend();
                }}
              />
              <Copy kind="small">
                Request only when needed. A resend clears this code; use the newest email. If no email arrives, return
                to sign-in to review your address.
              </Copy>
            </>
          ) : (
            <Copy kind="small">Authenticator codes are generated by your app; they cannot be resent by email.</Copy>
          )}
          <Button title="Back to sign-in" secondary disabled={busy} onPress={() => switchMode("signin")} />
        </>
      )}
      {!!message && <Notice>{message}</Notice>}
      {!!error && <Notice error>{error}</Notice>}
      <Button
        title={
          verification
            ? "Verify and continue"
            : mode === "signup"
              ? "Create my Håfa account"
              : mode === "recover"
                ? "Send recovery code"
                : "Sign in"
        }
        onPress={() => {
          void submit();
        }}
        busy={busy}
        disabled={
          !isLoaded || (mode === "signup" && !signupLoaded) || (!verification && mode === "recover" && cooldown > 0)
        }
      />
      {!verification && (
        <>
          <Button
            title={mode === "signin" ? "Create a new account" : "Use my existing account"}
            secondary
            onPress={() => switchMode(mode === "signin" ? "signup" : "signin")}
            disabled={busy}
          />
          {mode === "signin" && (
            <Button title="Recover my account" secondary onPress={() => switchMode("recover")} disabled={busy} />
          )}
        </>
      )}
    </Screen>
  );
}
