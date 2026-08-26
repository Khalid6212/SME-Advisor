/**
 * Object storage behind an S3-compatible interface.
 *
 * Kept behind an interface so the bucket can move — Supabase or R2 while
 * developing, in-Kingdom later — without touching anything that uploads or
 * deletes. That portability is the whole reason this is not called directly.
 *
 * Two drivers: S3-compatible, and a local filesystem driver for development,
 * mirroring how the mailer logs to console without SMTP. Nothing should require
 * a bucket to run the test suite.
 */

import crypto from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { config, isProd } from "./config.ts";

export interface StoredObject {
  key: string;
  size: number;
}

export interface StorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  /**
   * Returns the keys **confirmed absent** after the call, which includes keys
   * that were already gone. That is the useful semantic rather than "keys this
   * call deleted": purge retries after partial failures, and treating an
   * already-absent object as a failure would leave its row forever unclearable.
   */
  remove(keys: string[]): Promise<string[]>;
  /** Short-lived URL, or null when the driver streams through the API instead. */
  signedUrl(key: string, seconds: number): Promise<string | null>;
}

/**
 * Keys are namespaced by client so a whole engagement can be located, and
 * carry a random component so two uploads of "statement.pdf" cannot collide or
 * be guessed.
 */
export function storageKey(clientId: string, nodeId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, "_").slice(-120);
  return `clients/${clientId}/${nodeId}/${crypto.randomUUID()}-${safe}`;
}

// ─── local driver ───────────────────────────────────────────────────────────

class LocalDriver implements StorageDriver {
  // Explicit field, not a parameter property — Node strips types rather than
  // compiling them, and parameter properties emit code. See erasableSyntaxOnly
  // in tsconfig, which makes tsc reject them so this fails at typecheck rather
  // than at runtime.
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  /** Keys come from our own code, but a traversal here would write anywhere on
   *  disk, so resolve and verify containment rather than trusting that. */
  private path(key: string): string {
    const full = resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`Refusing to access a path outside storage root: ${key}`);
    }
    return full;
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<StoredObject> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return { key, size: body.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async remove(keys: string[]): Promise<string[]> {
    const removed: string[] = [];
    for (const key of keys) {
      try {
        await rm(this.path(key), { force: true });
        removed.push(key);
      } catch {
        // Idempotent by design — a missing object is a purge that already ran.
      }
    }
    return removed;
  }

  async signedUrl(): Promise<string | null> {
    return null; // streamed through the API instead
  }
}

// ─── S3 driver ──────────────────────────────────────────────────────────────

class S3Driver implements StorageDriver {
  private client: any;
  private sdk: any;
  private bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
  }

  private async load() {
    if (this.client) return;
    // Imported lazily so development without a bucket does not require the SDK.
    this.sdk = await import("@aws-sdk/client-s3");
    this.client = new this.sdk.S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      // The SDK's newer default (WHEN_SUPPORTED) attaches an automatic
      // checksum header to every request. Several S3-compatible providers —
      // Oracle's Object Storage included — fail signature verification on
      // that header even with correct credentials, surfacing as an opaque
      // SignatureDoesNotMatch. WHEN_REQUIRED matches the pre-2024 behavior.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID!,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
      },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    await this.load();
    await this.client.send(
      new this.sdk.PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Belt and braces alongside bucket-level encryption.
        ServerSideEncryption: "AES256",
      }),
    );
    return { key, size: body.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    await this.load();
    const res = await this.client.send(
      new this.sdk.GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return Buffer.from(await res.Body.transformToByteArray());
  }

  /**
   * One DELETE per key, not the batch DeleteObjectsCommand.
   *
   * DeleteObjects has a request body (the XML list of keys), and that body
   * has always required an integrity header — naming ChecksumAlgorithm on
   * the command did not make the SDK attach one against this endpoint
   * either, and the whole batch was rejected outright with nothing removed.
   * A single-object DELETE has no body at all, so there is nothing to
   * checksum and nothing for this provider to reject it over. One request
   * per key costs more round trips, but document counts per client are
   * small, and a per-key try/catch is more resilient than an all-or-nothing
   * batch besides — mirrors LocalDriver.remove() below.
   */
  async remove(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    await this.load();
    const removed: string[] = [];
    for (const key of keys) {
      try {
        await this.client.send(new this.sdk.DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
        removed.push(key);
      } catch {
        // Left out of `removed` — the caller treats it as still present.
      }
    }
    return removed;
  }

  async signedUrl(key: string, seconds: number): Promise<string | null> {
    await this.load();
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    return getSignedUrl(
      this.client,
      new this.sdk.GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: seconds },
    );
  }
}

// ─── selection ──────────────────────────────────────────────────────────────

function build(): StorageDriver {
  if (config.S3_BUCKET && config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY) {
    return new S3Driver(config.S3_BUCKET);
  }
  if (isProd) {
    console.error(
      "Refusing to start: no object storage configured. Client documents cannot be\n" +
        "written to a container filesystem in production — they would not survive a\n" +
        "restart, and nothing would back them up.",
    );
    process.exit(1);
  }
  console.warn("  ⚠  No S3 config — documents go to api/.storage (development only).\n");
  return new LocalDriver(resolve(process.cwd(), ".storage"));
}

export const storage: StorageDriver = build();

/**
 * Deletes blobs whose rows were tombstoned by retention or erasure.
 *
 * Until this runs, a "completed" erasure has not deleted anything a person
 * would recognise as their data. Callers report what is still pending rather
 * than assuming success.
 */
export async function purge(keys: string[]): Promise<{ purged: number; failed: string[] }> {
  if (keys.length === 0) return { purged: 0, failed: [] };
  const removed = await storage.remove(keys);
  const removedSet = new Set(removed);
  return { purged: removed.length, failed: keys.filter((k) => !removedSet.has(k)) };
}
