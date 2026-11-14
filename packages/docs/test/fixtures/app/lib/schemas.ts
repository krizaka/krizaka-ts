import { z } from "zod";

/** What a user sends to upload a document. */
export const UploadBody = z.object({
  kind: z.enum(["lease", "invoice"]),
  note: z.string().max(200).optional(),
});

/** What a user does to a document: one action, each with its own fields (a discriminated union). */
export const DocumentAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("archive") }),
  z.object({ action: z.literal("delete"), reason: z.enum(["duplicate", "mistake"]).optional() }),
]);
