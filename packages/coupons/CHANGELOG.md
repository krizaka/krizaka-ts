# @krizaka/coupons

## 0.1.0

### Minor Changes

- 2d3941c: New package (#46, ADR-002): `@krizaka/coupons`, discount and credit coupons the admin manages. `createCoupons` (`validate`, `apply` reserving a use under the coupon's row lock, `attachCheckout`, `redeem` in the payment event's transaction, `release`, `releaseExpired`, `refund`, `redeemCredit` granting capped credits in `@krizaka/credits`, `revoke`, and `admin`: coupons, partners and their view, `checkPrices`, `generateCode`), `couponsSchema` (`coupons.partner`, `coupons.coupon`, `coupons.redemption`), `dbCouponStore`, `memoryCouponStore`, `@krizaka/coupons/settings` (`coupons.enabled`, `reservationMinutes`, `attemptsPerAccountPerHour`, `attemptsPerIpPerHour`, `minCodeLength`, `generatedCodeLength`, `maxPercentOff`, `refundRestoresUse`), `evt.coupon.redeemed.v1`, `released`, `refunded`, `exhausted` through the outbox, and `couponsContract`. Going live, the retention of the records and the tax status of free credits are the owner's and the accountant's calls (#61, #62).
