import { z } from "zod";

/** What a user sends to upload a document. */
export const UploadBody = z.object({
  kind: z.enum(["lease", "invoice"]),
  note: z.string().max(200).optional(),
});
