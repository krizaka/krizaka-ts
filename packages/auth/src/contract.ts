import { z } from "zod";

/**
 * « Who is here »: the one contract of `GET /api/me` for every product (krizaka-ui#551). Browser-safe: zod and the web-standard
 * `Response` only, so the product's route and the bar island of `@krizaka/ui` import the same file.
 *
 * A public page asking who is there is not an error: signed out is 200 with `signedIn: false`, never a 401. The answer is a hint for the
 * bar; it authorises nothing, and every page and route checks the session itself.
 */

/** The path every product serves. */
export const ME_PATH = "/api/me";

/** What the bar shows of the signed-in person. */
export const meAccountSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  email: z.string().min(1),
  avatarSeed: z.string().nullable(),
});

export const meSchema = z
  .object({
    signedIn: z.boolean(),
    signupOpen: z.boolean(),
    account: meAccountSchema.optional(),
  })
  .refine((me) => me.signedIn === (me.account !== undefined), { message: "account is present exactly when signedIn" });

export type MeAccount = z.infer<typeof meAccountSchema>;
export type Me = z.infer<typeof meSchema>;

/** Never cached, never shared: the answer depends on the cookie. */
export const ME_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;

/**
 * The answer of `GET /api/me`: 200, the body checked against the contract, `Cache-Control: private, no-store` and `Vary: Cookie`.
 * @param input whether sign-up is open, and the signed-in account when there is one
 * @throws ZodError when the body breaks the contract (a signed-in answer without an account)
 */
export function meResponse(input: { signupOpen: boolean; account?: MeAccount | null | undefined }): Response {
  const body: Me = meSchema.parse({
    signedIn: !!input.account,
    signupOpen: input.signupOpen,
    ...(input.account ? { account: input.account } : {}),
  });
  return Response.json(body, { headers: ME_HEADERS });
}
