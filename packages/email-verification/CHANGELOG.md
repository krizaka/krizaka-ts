# @krizaka/email-verification

## 0.1.0

### Minor Changes

- 54fe743: New package: proof of an e-mail address for public forms (`createEmailVerification`): a 6-digit code valid 15 minutes, single use, 5 tries, kept as a salted hash; the action is held and released only after the code is confirmed. `memoryCodeStore`, `codeStoreContract` (`/testkit`), EN/FR `verificationMail`. Org rule `email-verification` (krizaka/.github#464).
