import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BucketKind,
  SignedUploadUrlOptions,
  SignedUrlOptions,
  StorageBody,
  UploadOptions,
  UploadResult,
} from './storage.types';

/**
 * Single point of contact for object storage. Wraps the AWS SDK v3 S3Client
 * pointed at whatever S3-compatible endpoint env supplies:
 *
 *   • Dev (docker compose) → MinIO at http://minio:9000
 *   • Prod (DO Spaces NYC3) → https://nyc3.digitaloceanspaces.com
 *
 * Forces path-style addressing (`<endpoint>/<bucket>/<key>`) so both backends
 * work identically — MinIO requires it, DO Spaces accepts it.
 *
 * Why two URL forms in env (ENDPOINT vs PUBLIC_URL): in dev the API talks to
 * MinIO over the docker network at `minio:9000`, but the URL we hand back to
 * clients has to be browser-reachable (`localhost:9000`). In prod they're the
 * same string. The split keeps the URLs we return to clients usable end-to-end
 * without any client-side rewriting.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly endpoint: string;
  private readonly publicBaseUrl: string;
  private readonly buckets: Record<BucketKind, string>;

  /** Default signed-URL lifetime when callers don't supply their own. */
  static readonly DEFAULT_SIGNED_URL_TTL = 3600; // 1 hour

  constructor(private readonly config: ConfigService) {
    this.endpoint = this.config.getOrThrow<string>('DO_SPACES_ENDPOINT');
    this.publicBaseUrl = this.config
      .getOrThrow<string>('DO_SPACES_PUBLIC_URL')
      .replace(/\/+$/, ''); // strip trailing slashes

    this.buckets = {
      [BucketKind.CERTIFICATES]: this.config.getOrThrow<string>(
        'DO_SPACES_BUCKET_CERTIFICATES',
      ),
      [BucketKind.MEDIA]: this.config.getOrThrow<string>(
        'DO_SPACES_BUCKET_MEDIA',
      ),
      [BucketKind.VIDEOS]: this.config.getOrThrow<string>(
        'DO_SPACES_BUCKET_VIDEOS',
      ),
    };

    this.s3 = new S3Client({
      endpoint: this.endpoint,
      region: this.config.get<string>('DO_SPACES_REGION', 'us-east-1'),
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('DO_SPACES_KEY'),
        secretAccessKey: this.config.getOrThrow<string>('DO_SPACES_SECRET'),
      },
    });
  }

  /**
   * Bucket-reachability smoke check at boot. Warns (does not throw) if a
   * bucket is unreachable — letting the app boot in degraded mode is better
   * than crash-looping when MinIO is still warming up in dev.
   */
  async onModuleInit(): Promise<void> {
    for (const kind of Object.values(BucketKind)) {
      const bucket = this.buckets[kind];
      try {
        await this.s3.send(new HeadBucketCommand({ Bucket: bucket }));
        this.logger.log(`Bucket ready: ${bucket} (${kind})`);
      } catch (err) {
        this.logger.warn(
          `Bucket unreachable at boot: ${bucket} (${kind}) — ${(err as Error).message}`,
        );
      }
    }
  }

  // ── Uploads ───────────────────────────────────────────────────────────

  /**
   * Upload an object. Returns the storage coordinates plus a ready-to-hand-back
   * URL (public for CERTIFICATES, signed for MEDIA/VIDEOS).
   */
  async uploadObject(
    kind: BucketKind,
    key: string,
    body: StorageBody,
    opts: UploadOptions = {},
  ): Promise<UploadResult> {
    const bucket = this.buckets[kind];
    const result = await this.s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: opts.contentType,
        CacheControl: opts.cacheControl,
        ContentDisposition: opts.contentDisposition,
        Metadata: opts.metadata,
      }),
    );

    const url =
      kind === BucketKind.CERTIFICATES
        ? this.getPublicUrl(kind, key)
        : await this.getSignedUrl(kind, key, {
            expiresInSeconds: StorageService.DEFAULT_SIGNED_URL_TTL,
          });

    return { bucket, key, url, etag: result.ETag };
  }

  // ── URL generation ────────────────────────────────────────────────────

  /**
   * Public URL for an object in the public-read bucket. Throws for the private
   * buckets — those callers must use `getSignedUrl()` instead, surfacing the
   * mistake at the call site rather than silently leaking a private URL.
   */
  getPublicUrl(kind: BucketKind, key: string): string {
    if (kind !== BucketKind.CERTIFICATES) {
      throw new Error(
        `Bucket '${kind}' is not public-read; use getSignedUrl() to mint a signed URL.`,
      );
    }
    return `${this.publicBaseUrl}/${this.buckets[kind]}/${this.normalizeKey(key)}`;
  }

  /**
   * Signed GET URL — short-lived, time-bounded. Works for any bucket.
   * For CERTIFICATES you typically want `getPublicUrl()` instead; signing a
   * public-read URL works but adds unneeded query params.
   */
  async getSignedUrl(
    kind: BucketKind,
    key: string,
    opts: SignedUrlOptions,
  ): Promise<string> {
    const cmd = new GetObjectCommand({
      Bucket: this.buckets[kind],
      Key: key,
      ResponseContentDisposition: opts.contentDisposition,
    });
    const signed = await getSignedUrl(this.s3, cmd, {
      expiresIn: opts.expiresInSeconds,
    });
    return this.rewriteToPublicBase(signed);
  }

  /**
   * Signed PUT URL — for direct browser-to-S3 uploads (avatar uploads in
   * Week 8 ProfileModule, instructor portrait uploads in admin). Returns the
   * URL the client should PUT to. Keep TTLs short (60–300s).
   */
  async getSignedUploadUrl(
    kind: BucketKind,
    key: string,
    opts: SignedUploadUrlOptions,
  ): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: this.buckets[kind],
      Key: key,
      ContentType: opts.contentType,
    });
    const signed = await getSignedUrl(this.s3, cmd, {
      expiresIn: opts.expiresInSeconds,
    });
    return this.rewriteToPublicBase(signed);
  }

  // ── Object lifecycle ──────────────────────────────────────────────────

  async deleteObject(kind: BucketKind, key: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.buckets[kind],
        Key: key,
      }),
    );
  }

  async objectExists(kind: BucketKind, key: string): Promise<boolean> {
    try {
      await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.buckets[kind],
          Key: key,
        }),
      );
      return true;
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      const name = (err as { name?: string }).name;
      if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') {
        return false;
      }
      throw err;
    }
  }

  // ── Health / introspection ────────────────────────────────────────────

  /**
   * For `/health/full` — returns true if every bucket is reachable. Does not
   * throw; the health endpoint reports per-bucket status separately.
   */
  async healthCheck(): Promise<Record<BucketKind, boolean>> {
    const result = {} as Record<BucketKind, boolean>;
    await Promise.all(
      Object.values(BucketKind).map(async (kind) => {
        try {
          await this.s3.send(
            new HeadBucketCommand({ Bucket: this.buckets[kind] }),
          );
          result[kind] = true;
        } catch {
          result[kind] = false;
        }
      }),
    );
    return result;
  }

  /** Bucket name for a given kind — useful for tests and admin endpoints. */
  bucketFor(kind: BucketKind): string {
    return this.buckets[kind];
  }

  // ── Key conventions ───────────────────────────────────────────────────

  /**
   * Build a structured key. Strips leading/trailing slashes from each segment
   * to keep keys canonical. Examples:
   *
   *   buildKey('IOS-PSM-2026-000142.pdf')
   *     → 'IOS-PSM-2026-000142.pdf'
   *   buildKey('avatars', 'users', '9ae3...', 'avatar.jpg')
   *     → 'avatars/users/9ae3.../avatar.jpg'
   *   buildKey('lessons', lessonUuid, 'video.mp4')
   *     → 'lessons/9ae3.../video.mp4'
   */
  static buildKey(...parts: string[]): string {
    if (parts.length === 0) {
      throw new Error('buildKey requires at least one segment');
    }
    return parts
      .map((p) => p.replace(/^\/+|\/+$/g, ''))
      .filter((p) => p.length > 0)
      .join('/');
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private normalizeKey(key: string): string {
    return key.replace(/^\/+/, '');
  }

  /**
   * Rewrite the host of a signed URL from the SDK-internal endpoint to the
   * client-facing public URL. SDK signs against `endpoint`, so the resulting
   * URL contains e.g. `http://minio:9000/...` — clients can't resolve that.
   * The rewrite swaps the host portion while keeping the signed query intact.
   * In prod, endpoint === publicBaseUrl and this is a no-op.
   */
  private rewriteToPublicBase(signedUrl: string): string {
    if (this.endpoint === this.publicBaseUrl) return signedUrl;
    try {
      const u = new URL(signedUrl);
      const pub = new URL(this.publicBaseUrl);
      u.protocol = pub.protocol;
      u.host = pub.host; // host == hostname + port
      return u.toString();
    } catch {
      // If the SDK gave us something we can't parse, return it raw — better
      // than throwing and breaking the caller.
      return signedUrl;
    }
  }
}
