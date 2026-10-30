import { STORAGE_CODE, StorageError } from "./port";

export interface ReadUploadOptions {
  /** The multipart field that holds the file (`"file"`, `"video"`). */
  field: string;
  /** The largest file, in bytes: refused from `Content-Length` before the body is read, then from the file's own size. */
  maxBytes: number;
  /** The room the other fields and the multipart framing may take on top of the file. Default 64 KiB. */
  overheadBytes?: number;
}

export interface ReadUploadResult {
  bytes: Uint8Array;
  /** The name the client gave the file (never trusted for the type: `Storage.upload` checks the bytes). */
  name: string;
  /** The type the client declared (pass it as `declaredType` only if you want a contradiction refused). */
  declaredType: string;
  /** The whole form, to read the other fields (`form.get("purpose")`). */
  form: FormData;
}

// @fixed: the room the multipart framing and the other text fields take beyond the file — a parser allowance, not a business rule.
const DEFAULT_OVERHEAD = 64 * 1024;

/**
 * Reads one uploaded file from a multipart request: refuses an oversize body from `Content-Length` before reading it, parses the form,
 * takes the file of `field` and refuses it when it is missing, empty or larger than `maxBytes`. The type is NOT decided here —
 * hand the bytes to `Storage.upload({ allow })`, which checks them by magic number. Throws `StorageError` (`tooBig`, `noFile`).
 */
export async function readUpload(request: Request, options: ReadUploadOptions): Promise<ReadUploadResult> {
  const { field, maxBytes, overheadBytes = DEFAULT_OVERHEAD } = options;
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes + overheadBytes) throw new StorageError(STORAGE_CODE.tooBig, `a file is 1 to ${maxBytes} bytes`);
  const form = await request.formData().catch(() => null);
  const file = form?.get(field);
  if (!form || !(file instanceof File)) throw new StorageError(STORAGE_CODE.noFile, `no file in the « ${field} » field`);
  if (file.size === 0 || file.size > maxBytes) throw new StorageError(STORAGE_CODE.tooBig, `a file is 1 to ${maxBytes} bytes`);
  return { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, declaredType: file.type, form };
}
