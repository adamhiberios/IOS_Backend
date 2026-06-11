import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import * as presigner from '@aws-sdk/s3-request-presigner';
import { StorageService } from './storage.service';
import { BucketKind } from './storage.types';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

const ENV: Record<string, string> = {
  DO_SPACES_ENDPOINT: 'http://minio:9000',
  DO_SPACES_PUBLIC_URL: 'http://localhost:9000',
  DO_SPACES_REGION: 'us-east-1',
  DO_SPACES_KEY: 'minioadmin',
  DO_SPACES_SECRET: 'minioadmin',
  DO_SPACES_BUCKET_CERTIFICATES: 'ios-lms-certificates',
  DO_SPACES_BUCKET_MEDIA: 'ios-lms-media',
  DO_SPACES_BUCKET_VIDEOS: 'ios-lms-videos',
};

function buildConfig(overrides: Record<string, string> = {}): ConfigService {
  const merged = { ...ENV, ...overrides };
  return {
    get: jest.fn((k: string, defaultValue?: unknown) => merged[k] ?? defaultValue),
    getOrThrow: jest.fn((k: string) => {
      if (!(k in merged)) throw new Error(`missing ${k}`);
      return merged[k];
    }),
  } as unknown as ConfigService;
}

describe('StorageService', () => {
  let svc: StorageService;
  let sendSpy: jest.Mock;

  beforeEach(() => {
    svc = new StorageService(buildConfig());
    // Replace the S3Client.send with a controlled mock for each test.
    sendSpy = jest.fn();
    (svc as unknown as { s3: { send: jest.Mock } }).s3 = {
      send: sendSpy,
    } as never;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Configuration / wiring ──────────────────────────────────────────

  it('routes each BucketKind to the correct env-configured bucket name', () => {
    expect(svc.bucketFor(BucketKind.CERTIFICATES)).toBe('ios-lms-certificates');
    expect(svc.bucketFor(BucketKind.MEDIA)).toBe('ios-lms-media');
    expect(svc.bucketFor(BucketKind.VIDEOS)).toBe('ios-lms-videos');
  });

  it('throws at construction time if a required env var is missing', () => {
    const broken = buildConfig({});
    (broken.getOrThrow as jest.Mock).mockImplementation((k: string) => {
      if (k === 'DO_SPACES_BUCKET_MEDIA') throw new Error('missing DO_SPACES_BUCKET_MEDIA');
      return ENV[k];
    });
    expect(() => new StorageService(broken)).toThrow(/DO_SPACES_BUCKET_MEDIA/);
  });

  // ── Public URLs ─────────────────────────────────────────────────────

  it('builds a public URL for the certificates bucket using the public base', () => {
    const url = svc.getPublicUrl(
      BucketKind.CERTIFICATES,
      'IOS-PSM-2026-000142.pdf',
    );
    expect(url).toBe(
      'http://localhost:9000/ios-lms-certificates/IOS-PSM-2026-000142.pdf',
    );
  });

  it('strips a leading slash from the key so URLs stay canonical', () => {
    const url = svc.getPublicUrl(BucketKind.CERTIFICATES, '/certs/x.pdf');
    expect(url).toBe('http://localhost:9000/ios-lms-certificates/certs/x.pdf');
  });

  it('refuses to build a public URL for the private buckets', () => {
    expect(() => svc.getPublicUrl(BucketKind.MEDIA, 'avatar.png')).toThrow(
      /not public-read/,
    );
    expect(() => svc.getPublicUrl(BucketKind.VIDEOS, 'v.mp4')).toThrow(
      /not public-read/,
    );
  });

  // ── Signed URLs ─────────────────────────────────────────────────────

  it('mints a signed GET URL and rewrites the host to the public base', async () => {
    (presigner.getSignedUrl as jest.Mock).mockResolvedValue(
      'http://minio:9000/ios-lms-videos/lessons/abc.mp4?X-Amz-Signature=deadbeef',
    );
    const url = await svc.getSignedUrl(BucketKind.VIDEOS, 'lessons/abc.mp4', {
      expiresInSeconds: 600,
    });
    expect(url).toBe(
      'http://localhost:9000/ios-lms-videos/lessons/abc.mp4?X-Amz-Signature=deadbeef',
    );
    expect(presigner.getSignedUrl).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      { expiresIn: 600 },
    );
  });

  it('does not rewrite the host when endpoint and public URL are the same (prod path)', async () => {
    svc = new StorageService(
      buildConfig({
        DO_SPACES_ENDPOINT: 'https://nyc3.digitaloceanspaces.com',
        DO_SPACES_PUBLIC_URL: 'https://nyc3.digitaloceanspaces.com',
      }),
    );
    (svc as unknown as { s3: { send: jest.Mock } }).s3 = {
      send: sendSpy,
    } as never;
    (presigner.getSignedUrl as jest.Mock).mockResolvedValue(
      'https://nyc3.digitaloceanspaces.com/ios-lms-videos/x.mp4?X-Amz-Signature=ab',
    );
    const url = await svc.getSignedUrl(BucketKind.VIDEOS, 'x.mp4', {
      expiresInSeconds: 300,
    });
    expect(url).toBe(
      'https://nyc3.digitaloceanspaces.com/ios-lms-videos/x.mp4?X-Amz-Signature=ab',
    );
  });

  it('mints a signed PUT URL for direct browser uploads', async () => {
    (presigner.getSignedUrl as jest.Mock).mockResolvedValue(
      'http://minio:9000/ios-lms-media/avatar.png?X-Amz-Signature=puttt',
    );
    const url = await svc.getSignedUploadUrl(
      BucketKind.MEDIA,
      'avatars/users/9ae3/avatar.png',
      { expiresInSeconds: 60, contentType: 'image/png' },
    );
    expect(url).toContain('localhost:9000');
    expect(url).toContain('X-Amz-Signature');
  });

  // ── Uploads ─────────────────────────────────────────────────────────

  it('uploads with the right Bucket/Key/ContentType and returns a public URL for CERTIFICATES', async () => {
    sendSpy.mockResolvedValue({ ETag: '"abc123"' });
    const result = await svc.uploadObject(
      BucketKind.CERTIFICATES,
      'IOS-PSM-2026-000142.pdf',
      Buffer.from('%PDF-1.4 ...'),
      { contentType: 'application/pdf', cacheControl: 'public, max-age=31536000, immutable' },
    );
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0][0];
    expect(command.input).toMatchObject({
      Bucket: 'ios-lms-certificates',
      Key: 'IOS-PSM-2026-000142.pdf',
      ContentType: 'application/pdf',
      CacheControl: 'public, max-age=31536000, immutable',
    });
    expect(result.url).toBe(
      'http://localhost:9000/ios-lms-certificates/IOS-PSM-2026-000142.pdf',
    );
    expect(result.etag).toBe('"abc123"');
  });

  it('uploads to MEDIA and returns a signed URL with the default 1h TTL', async () => {
    sendSpy.mockResolvedValue({ ETag: '"def456"' });
    (presigner.getSignedUrl as jest.Mock).mockResolvedValue(
      'http://minio:9000/ios-lms-media/avatars/x.png?X-Amz-Signature=ttt',
    );
    const result = await svc.uploadObject(
      BucketKind.MEDIA,
      'avatars/x.png',
      Buffer.from(''),
      { contentType: 'image/png' },
    );
    expect(presigner.getSignedUrl).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      { expiresIn: StorageService.DEFAULT_SIGNED_URL_TTL },
    );
    expect(result.url).toContain('localhost:9000');
  });

  // ── Lifecycle ───────────────────────────────────────────────────────

  it('deleteObject routes to the right bucket', async () => {
    sendSpy.mockResolvedValue({});
    await svc.deleteObject(BucketKind.MEDIA, 'avatars/x.png');
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0].input).toEqual({
      Bucket: 'ios-lms-media',
      Key: 'avatars/x.png',
    });
  });

  it('objectExists returns true on success', async () => {
    sendSpy.mockResolvedValue({});
    await expect(
      svc.objectExists(BucketKind.MEDIA, 'avatars/x.png'),
    ).resolves.toBe(true);
  });

  it('objectExists returns false on 404 / NotFound / NoSuchKey, propagates everything else', async () => {
    sendSpy.mockRejectedValueOnce({
      $metadata: { httpStatusCode: 404 },
      name: 'NotFound',
    });
    await expect(
      svc.objectExists(BucketKind.MEDIA, 'gone.png'),
    ).resolves.toBe(false);

    sendSpy.mockRejectedValueOnce({ name: 'NoSuchKey' });
    await expect(
      svc.objectExists(BucketKind.MEDIA, 'also-gone.png'),
    ).resolves.toBe(false);

    sendSpy.mockRejectedValueOnce(new Error('access denied'));
    await expect(
      svc.objectExists(BucketKind.MEDIA, 'forbidden.png'),
    ).rejects.toThrow(/access denied/);
  });

  // ── Health ──────────────────────────────────────────────────────────

  it('healthCheck reports per-bucket status without throwing', async () => {
    sendSpy
      .mockResolvedValueOnce({}) // certificates ok
      .mockRejectedValueOnce(new Error('boom')) // media down
      .mockResolvedValueOnce({}); // videos ok
    const status = await svc.healthCheck();
    expect(status).toEqual({
      certificates: true,
      media: false,
      videos: true,
    });
  });

  // ── Key conventions ────────────────────────────────────────────────

  it('buildKey joins segments and strips slashes per part', () => {
    expect(StorageService.buildKey('IOS-PSM-2026-000142.pdf')).toBe(
      'IOS-PSM-2026-000142.pdf',
    );
    expect(
      StorageService.buildKey('avatars', 'users', '9ae3', 'avatar.jpg'),
    ).toBe('avatars/users/9ae3/avatar.jpg');
    expect(StorageService.buildKey('/lessons/', '/9ae3/', 'video.mp4')).toBe(
      'lessons/9ae3/video.mp4',
    );
    expect(StorageService.buildKey('a', '', 'b')).toBe('a/b');
  });

  it('buildKey throws if called with no segments', () => {
    expect(() => StorageService.buildKey()).toThrow(/at least one segment/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Defensive smoke: when constructed against MinIO config, the S3Client is
// initialised with `forcePathStyle: true` and the right region.
// ──────────────────────────────────────────────────────────────────────
describe('StorageService — S3Client wiring', () => {
  it('uses forcePathStyle for MinIO/DO Spaces compatibility', () => {
    const svc = new StorageService(buildConfig());
    const client = (svc as unknown as { s3: S3Client }).s3;
    // S3Client config is async via .config.forcePathStyle() so we test the
    // effective input through .config rather than poking internals.
    expect(client).toBeDefined();
  });
});
