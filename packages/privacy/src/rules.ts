import { PRIVACY_CODE, PrivacyError, type Subject } from "./port";

const KIND = /^[a-z][a-z0-9_]{0,39}$/;
const PURPOSE = /^[a-z][a-z0-9_-]{0,39}$/;
const MAX_ID = 200;

/** @throws PrivacyError for a subject whose kind or id is not well formed */
export function checkSubject(subject: Subject): void {
  if (!KIND.test(subject.kind)) throw new PrivacyError(PRIVACY_CODE.badSubject, `subject kind « ${subject.kind} »: lower-case letters, digits and _, starting with a letter`);
  if (subject.id.length < 1 || subject.id.length > MAX_ID) throw new PrivacyError(PRIVACY_CODE.badSubject, `subject id: 1 to ${MAX_ID} characters`);
}

/** @throws PrivacyError for a purpose that is not lower-case letters, digits, `_` and `-`, starting with a letter */
export function checkPurpose(purpose: string): void {
  if (!PURPOSE.test(purpose)) throw new PrivacyError(PRIVACY_CODE.badPurpose, `purpose « ${purpose} »: lower-case letters, digits, _ and -, starting with a letter, at most 40 characters`);
}
