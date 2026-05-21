import { Readable } from 'stream';

/**
 * The three storage buckets the LMS uses. Each has different access semantics:
 *
 *   CERTIFICATES — public-read. Cert PDFs need stable links that survive in
 *                  emails, on LinkedIn, and on third-party verifiers. The
 *                  cert ID is unguessable (per-program sequence inside a
 *                  random-feeling URL), so public-read is acceptable.
 *
 *   MEDIA        — private. Avatars, thumbnails, instructor headshots. Served
 *                  via short-lived signed URLs to authenticated users.
 *
 *   VIDEOS       — private. Lesson video streaming. Always signed URLs with
 *                  short TTLs; gated by the student_purchases enrolment check
 *                  in LessonService.
 */
export enum BucketKind {
  CERTIFICATES = 'certificates',
  MEDIA = 'media',
  VIDEOS = 'videos',
}

/** Acceptable body shapes for an upload — match S3 SDK v3's input union. */
export type StorageBody = Buffer | Readable | Uint8Array | string;

export interface UploadOptions {
  /** Sets the `Content-Type` header on the stored object. Strongly recommended. */
  contentType?: string;
  /** Cache-Control header — useful for cert PDFs (immutable, year-long cache). */
  cacheControl?: string;
  /** Arbitrary user metadata stored alongside the object. */
  metadata?: Record<string, string>;
  /**
   * Content-Disposition. Use `attachment; filename="..."` for downloads,
   * `inline` for in-browser viewing.
   */
  contentDisposition?: string;
}

export interface SignedUrlOptions {
  /** Lifetime of the signed URL in seconds. */
  expiresInSeconds: number;
  /** Force a download with a specific filename via Content-Disposition. */
  contentDisposition?: string;
}

export interface SignedUploadUrlOptions {
  /** Lifetime of the upload URL in seconds. Keep short — 60–300s typically. */
  expiresInSeconds: number;
  /** Enforced Content-Type the client must use, or the upload is rejected. */
  contentType?: string;
}

export interface UploadResult {
  /** Bucket the object landed in. */
  bucket: string;
  /** Object key inside that bucket. */
  key: string;
  /**
   * URL clients can use to access the object.
   *
   * - For CERTIFICATES (public-read bucket): a permanent public URL.
   * - For MEDIA / VIDEOS: a signed URL with the service-default TTL (1h).
   *   Callers needing a different TTL should call `getSignedUrl()` directly.
   */
  url: string;
  /** S3 ETag — useful for cache invalidation / dedupe in admin flows. */
  etag?: string;
}
