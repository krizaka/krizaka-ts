import { currencyDigits } from "@krizaka/intl/money";

import { type Money, PAYMENTS_CODE, PaymentsError, type Price } from "./port";

const CURRENCY = /^[a-z]{3}$/;

/**
 * Makes an amount, refusing what is not money: a float, a negative, an unsafe integer, a currency that is not three letters.
 * @param amountMinor integer minor units (cents)
 * @param currency ISO 4217, any case
 * @returns the amount with a lowercase currency
 * @throws PaymentsError `PAYMENTS_BAD_MONEY`
 */
export function money(amountMinor: number, currency: string): Money {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0)
    throw new PaymentsError(
      400,
      `An amount is a non-negative integer of minor units, got ${amountMinor}`,
      PAYMENTS_CODE.badMoney,
    );
  const lower = currency.toLowerCase();
  if (!CURRENCY.test(lower)) throw new PaymentsError(400, `Not a currency: ${currency}`, PAYMENTS_CODE.badMoney);
  return { amountMinor, currency: lower };
}

/** The sum of amounts of one currency. @throws PaymentsError `PAYMENTS_BAD_MONEY` when currencies differ */
export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency)
    throw new PaymentsError(400, `Cannot add ${a.currency} and ${b.currency}`, PAYMENTS_CODE.badMoney);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

/** An amount in the visitor's language: « $39 » in English, « 39 $ » in French (Canadian conventions); decimals only when there are some. */
export function formatMoney(value: Money, locale: "en" | "fr"): string {
  const exponent = currencyDigits(value.currency);
  const unit = 10 ** exponent;
  const whole = value.amountMinor % unit === 0;
  const digits = whole ? 0 : exponent;
  return new Intl.NumberFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    style: "currency",
    currency: value.currency.toUpperCase(),
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value.amountMinor / unit);
}

/** Same as {@link formatMoney}, for a processor's {@link Price}. */
export const formatPrice = (price: Price, locale: "en" | "fr"): string =>
  formatMoney({ amountMinor: price.amount, currency: price.currency }, locale);
