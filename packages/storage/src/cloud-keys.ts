import { contextText, type KeyContext, type KeyService } from "./key-service";
import { type Clock, type FetchLike, STORAGE_CODE, StorageError } from "./port";
import { hashPayload, signRequest } from "./request-signing";

/**
 * The KMS adapters of the managed storage, over an injected `fetch` (no vendor SDK, no environment variable): the administrator
 * picks the KMS and enters its key id and credentials in the admin screen; they are sealed in the database and passed in here.
 *
 * - `aws-kms`: the AWS KMS JSON API (`TrentService.Encrypt` / `Decrypt` / `RotateKeyOnDemand`), signed with Signature V4.
 *   The encryption context binds every wrapped key to its tenant.
 * - `okms`: OVHcloud KMS (OKMS) service keys, `POST /api/<okmsId>/v1/servicekey/<keyId>/encrypt|decrypt`. OKMS authenticates
 *   the caller with its access certificate (mutual TLS): the product passes a `fetch` built on an agent that carries it. It has no
 *   on-demand rotation: the admin creates a new service key, names it in the settings, and the rewrap job moves the tenant keys.
 *
 * The OKMS adapter is checked against recorded requests; its proof on the real service waits for the provider account
 * (krizaka-internal#1929).
 */
export type CloudKeyConfig =
  | {
      kind: "aws-kms";
      region: string;
      /** A key id, ARN or alias (`alias/krizaka-docs`). */
      keyId: string;
      accessKeyId: string;
      secretAccessKey: string;
      /** The KMS endpoint, when not `https://kms.<region>.amazonaws.com` (a VPC endpoint, a local emulator). */
      endpoint?: string;
    }
  | {
      kind: "okms";
      /** `https://ca-east-bhs.okms.ovh.net` */
      endpoint: string;
      okmsId: string;
      keyId: string;
    };

export const CLOUD_KEY_KINDS = ["aws-kms", "okms"] as const;

const failed = (what: string, status: number) =>
  new StorageError(
    status === 400 || status === 403 || status === 422 ? STORAGE_CODE.unreadable : STORAGE_CODE.provider,
    `The KMS refused ${what} (HTTP ${status})`,
  );

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

type Deps = { fetch: FetchLike; clock: Clock };
type Adapters = { [K in CloudKeyConfig["kind"]]: (c: Extract<CloudKeyConfig, { kind: K }>, deps: Deps) => KeyService };

/** The KMS the admin chose, as data: one adapter per kind, never a branch. */
export function cloudKeyService(config: CloudKeyConfig, deps: Deps): KeyService {
  const adapters: Adapters = { "aws-kms": awsKms, okms };
  return (adapters[config.kind] as (c: CloudKeyConfig, d: Deps) => KeyService)(config, deps);
}

function awsKms(c: Extract<CloudKeyConfig, { kind: "aws-kms" }>, deps: { fetch: FetchLike; clock: Clock }): KeyService {
  const url = c.endpoint ?? `https://kms.${c.region}.amazonaws.com/`;
  const call = async <T>(target: string, payload: Record<string, unknown>): Promise<T> => {
    const body = new TextEncoder().encode(JSON.stringify(payload));
    const headers = signRequest(
      { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, region: c.region, service: "kms" },
      {
        method: "POST",
        url,
        headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": `TrentService.${target}` },
        payloadHash: hashPayload(body),
        now: deps.clock.now(),
      },
    );
    const res = await deps.fetch(url, { method: "POST", headers, body });
    if (!res.ok) throw failed(target, res.status);
    return JSON.parse(await res.text()) as T;
  };
  return {
    name: "aws-kms",
    currentKeyId: async () => c.keyId,
    async wrap(plain, context: KeyContext) {
      const out = await call<{ CiphertextBlob: string; KeyId: string }>("Encrypt", {
        KeyId: c.keyId,
        Plaintext: b64(plain),
        EncryptionContext: context,
      });
      return { keyId: out.KeyId, ciphertext: out.CiphertextBlob };
    },
    async unwrap(wrapped, context) {
      const out = await call<{ Plaintext: string }>("Decrypt", {
        KeyId: wrapped.keyId,
        CiphertextBlob: wrapped.ciphertext,
        EncryptionContext: context,
      });
      return new Uint8Array(Buffer.from(out.Plaintext, "base64"));
    },
    async rotate() {
      await call("RotateKeyOnDemand", { KeyId: c.keyId });
      return c.keyId;
    },
  };
}

function okms(c: Extract<CloudKeyConfig, { kind: "okms" }>, deps: { fetch: FetchLike }): KeyService {
  const base = `${c.endpoint.replace(/\/+$/, "")}/api/${encodeURIComponent(c.okmsId)}/v1/servicekey`;
  const call = async <T>(keyId: string, op: "encrypt" | "decrypt", payload: Record<string, string>): Promise<T> => {
    const url = `${base}/${encodeURIComponent(keyId)}/${op}`;
    const res = await deps.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: new TextEncoder().encode(JSON.stringify(payload)),
    });
    if (!res.ok) throw failed(op, res.status);
    return JSON.parse(await res.text()) as T;
  };
  return {
    name: "okms",
    currentKeyId: async () => c.keyId,
    async wrap(plain, context) {
      const out = await call<{ ciphertext: string }>(c.keyId, "encrypt", {
        plaintext: b64(plain),
        context: contextText(context),
      });
      return { keyId: c.keyId, ciphertext: out.ciphertext };
    },
    async unwrap(wrapped, context) {
      const out = await call<{ plaintext: string }>(wrapped.keyId, "decrypt", {
        ciphertext: wrapped.ciphertext,
        context: contextText(context),
      });
      return new Uint8Array(Buffer.from(out.plaintext, "base64"));
    },
  };
}
