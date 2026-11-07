import type { TextInputProps } from "react-native";
export type InputPurpose = "email" | "current-password" | "new-password" | "verification-code" | "url" | "code" | "phone";
export function inputTraits(
  purpose: InputPurpose | undefined,
  platform: string,
  numeric = false
): Pick<TextInputProps, "autoComplete" | "textContentType" | "keyboardType" | "autoCorrect" | "spellCheck" | "maxLength"> {
  // Someone else’s number, so never offer to fill in her own.
  if (purpose === "phone")
    return { autoComplete: "off", textContentType: "none", keyboardType: "phone-pad", autoCorrect: false };
  // A code someone pasted or typed exactly, so nothing may correct or capitalise it.
  if (purpose === "code")
    return { autoComplete: "off", textContentType: "none", keyboardType: "default", autoCorrect: false, spellCheck: false };
  if (purpose === "url")
    return { autoComplete: "off", textContentType: "URL", keyboardType: "url", autoCorrect: false };
  if (purpose === "email")
    return {
      autoComplete: "email",
      textContentType: "emailAddress",
      keyboardType: "email-address",
      autoCorrect: false,
    };
  if (purpose === "current-password")
    return {
      autoComplete: "current-password",
      textContentType: "password",
      keyboardType: "default",
      autoCorrect: false,
    };
  if (purpose === "new-password")
    return {
      autoComplete: "new-password",
      textContentType: "newPassword",
      keyboardType: "default",
      autoCorrect: false,
    };
  if (purpose === "verification-code")
    return {
      autoComplete: platform === "android" ? "2fa-app-otp" : "one-time-code",
      textContentType: "oneTimeCode",
      keyboardType: "number-pad",
      autoCorrect: false,
      maxLength: 6,
    };
  return {
    autoComplete: "off",
    textContentType: "none",
    keyboardType: numeric ? "decimal-pad" : "default",
    autoCorrect: numeric ? false : undefined,
  };
}
