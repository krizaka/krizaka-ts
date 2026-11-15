# @krizaka/coupons

## 0.1.6

### Patch Changes

- 79a6d53: SonarCloud smells cleared (second batch), behaviour unchanged: readonly sets, linear regular expressions, `replaceAll`, optional chains. The coverage reports now include the package's own `.js` / `.mjs` sources, and `@krizaka/org` keeps its default pictures and demo cast as JSON files. A contact e-mail address with an empty domain label (`a@b..c`) is no longer accepted by `@krizaka/coupons` and `@krizaka/mail`.
- Updated dependencies [79a6d53]
  - @krizaka/settings@0.7.1

## 0.1.5

### Patch Changes

- Updated dependencies [a8e1138]
  - @krizaka/settings@0.7.0

## 0.1.4

### Patch Changes

- Updated dependencies [bc85231]
  - @krizaka/settings@0.6.0

## 0.1.3

### Patch Changes

- Updated dependencies [2a7898c]
- Updated dependencies [2272b57]
  - @krizaka/time@0.2.0
  - @krizaka/settings@0.5.2

## 0.1.2

### Patch Changes

- Updated dependencies [0d19b64]
  - @krizaka/db@0.3.0
  - @krizaka/settings@0.5.1

## 0.1.1

### Patch Changes

- Updated dependencies [8210a9a]
  - @krizaka/settings@0.5.0

## 0.1.0

### Minor Changes

- 2d3941c: New package (#46, ADR-002): `@krizaka/coupons`, discount and credit coupons the admin manages. `createCoupons` (`validate`, `apply` reserving a use under the coupon's row lock, `attachCheckout`, `redeem` in the payment event's transaction, `release`, `releaseExpired`, `refund`, `redeemCredit` granting capped credits in `@krizaka/credits`, `revoke`, and `admin`: coupons, partners and their view, `checkPrices`, `generateCode`), `couponsSchema` (`coupons.partner`, `coupons.coupon`, `coupons.redemption`), `dbCouponStore`, `memoryCouponStore`, `@krizaka/coupons/settings` (`coupons.enabled`, `reservationMinutes`, `attemptsPerAccountPerHour`, `attemptsPerIpPerHour`, `minCodeLength`, `generatedCodeLength`, `maxPercentOff`, `refundRestoresUse`), `evt.coupon.redeemed.v1`, `released`, `refunded`, `exhausted` through the outbox, and `couponsContract`. Going live, the retention of the records and the tax status of free credits are the owner's and the accountant's calls (#61, #62).
