export { DEFAULT_MAX_CHALLENGES,memoryCodeStore } from "./memory";
export type { VerificationLocale, VerificationMail } from "./messages";
export { verificationMail } from "./messages";
export type { Challenge, CodeStore, VerificationSettings, VerifyFailure, VerifyResult } from "./port";
export { DEFAULT_SETTINGS, VERIFICATION_CODE, VerificationError,VERIFY_FAILURE } from "./port";
export type { EmailVerification, EmailVerificationOptions, Issued } from "./verification";
export { createEmailVerification, MIN_SECRET_LENGTH } from "./verification";
