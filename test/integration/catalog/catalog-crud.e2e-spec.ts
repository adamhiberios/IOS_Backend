import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { http, loginAsAdmin } from '../helpers/http';
import { createAdmin, resetCounters } from '../helpers/fixtures';
import { AdminRole } from '../../../src/database/entities';

describe('[integration] catalog/crud', () => {
  let app: INestApplication;
  let ds: DataSource;

  beforeAll(async () => {
    app = await buildTestApp();
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(ds);
    resetCounters();
  });

  async function adminToken(role: AdminRole = AdminRole.LEARNING_ADMIN) {
    const a = await createAdmin(app, { role });
    const { accessToken } = await loginAsAdmin(app, a.email, a.password);
    return accessToken;
  }

  it('public GET /catalog returns 200 with empty data when there are no certs', async () => {
    const res = await http(app).get('/api/v1/catalog').expect(200);
    expect(res.body).toMatchObject({
      data: [],
      meta: { locale: 'en', pagination: { limit: 20, hasMore: false } },
    });
  });

  it('admin can create a certificate (POST /admin/catalog)', async () => {
    const token = await adminToken();
    const res = await http(app)
      .post('/api/v1/admin/catalog')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Professional Scrum Master',
        programCode: 'PSM',
        price: 49,
        description: 'Foundational Scrum certification.',
        translations: {
          tr: { title: 'Profesyonel Scrum Yöneticisi' },
          ar: { title: 'سكرم ماستر' },
        },
      })
      .expect(201);

    const body = res.body as {
      data: {
        id: string;
        programCode: string;
        title: string;
        translations: Record<string, Record<string, string>>;
      };
    };
    expect(body.data.programCode).toBe('PSM');
    expect(body.data.translations.en.title).toBe('Professional Scrum Master');
    expect(body.data.translations.tr.title).toBe(
      'Profesyonel Scrum Yöneticisi',
    );
    expect(body.data.translations.ar.title).toBe('سكرم ماستر');
  });

  it('non-admin students get 403 on POST /admin/catalog', async () => {
    // Create a student account via /auth/register, verify it, log in
    await http(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'student@example.com',
        password: 'StrongP@ss1',
        firstName: 'Stu',
        lastName: 'Dent',
      })
      .expect(201);
    await ds.query(
      `UPDATE users SET email_verified = TRUE, email_verified_at = NOW() WHERE email = 'student@example.com'`,
    );
    const login = await http(app)
      .post('/api/v1/auth/login')
      .send({ email: 'student@example.com', password: 'StrongP@ss1' })
      .expect(200);
    const studentToken = (login.body as { accessToken: string }).accessToken;

    await http(app)
      .post('/api/v1/admin/catalog')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ title: 'x', programCode: 'XX', price: 1 })
      .expect(403);
  });

  it('public list returns localised title with X-Lang header + fallbackUsed flag', async () => {
    const token = await adminToken();
    await http(app)
      .post('/api/v1/admin/catalog')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Professional Scrum Master',
        programCode: 'PSM',
        price: 49,
        translations: {
          tr: { title: 'Profesyonel Scrum Yöneticisi' },
        },
      })
      .expect(201);
    // Second cert with no Turkish translation — tests fallback path.
    await http(app)
      .post('/api/v1/admin/catalog')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Project Management Professional',
        programCode: 'PMP',
        price: 99,
      })
      .expect(201);

    const trRes = await http(app)
      .get('/api/v1/catalog')
      .set('X-Lang', 'tr')
      .expect(200);

    const items = (trRes.body as {
      data: Array<{ programCode: string; title: string; fallbackUsed: boolean }>;
      meta: { locale: string };
    }).data;
    const psm = items.find((i) => i.programCode === 'PSM');
    const pmp = items.find((i) => i.programCode === 'PMP');
    expect(psm?.title).toBe('Profesyonel Scrum Yöneticisi');
    expect(psm?.fallbackUsed).toBe(false);
    expect(pmp?.title).toBe('Project Management Professional'); // English fallback
    expect(pmp?.fallbackUsed).toBe(true);
    expect((trRes.body as { meta: { locale: string } }).meta.locale).toBe('tr');
  });

  it('public list filters out inactive certs; admin sees them', async () => {
    const token = await adminToken();
    const created = await http(app)
      .post('/api/v1/admin/catalog')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'PSM', programCode: 'PSM', price: 49 })
      .expect(201);
    const id = (created.body as { data: { id: string } }).data.id;

    await http(app)
      .delete(`/api/v1/admin/catalog/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const publicRes = await http(app).get('/api/v1/catalog').expect(200);
    expect((publicRes.body as { data: unknown[] }).data).toHaveLength(0);

    const adminRes = await http(app)
      .get('/api/v1/admin/catalog')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((adminRes.body as { data: unknown[] }).data).toHaveLength(1);
  });

  it('public GET /catalog/:id returns 404 for an inactive cert', async () => {
    const token = await adminToken();
    const created = await http(app)
      .post('/api/v1/admin/catalog')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'PSM', programCode: 'PSM', price: 49 })
      .expect(201);
    const id = (created.body as { data: { id: string } }).data.id;
    await http(app)
      .delete(`/api/v1/admin/catalog/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await http(app).get(`/api/v1/catalog/${id}`).expect(404);
  });

  it('admin PATCH updates fields and keeps translations.en in sync with canonical title', async () => {
    const token = await adminToken();
    const created = await http(app)
      .post('/api/v1/admin/catalog')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Old Title', programCode: 'PSM', price: 49 })
      .expect(201);
    const id = (created.body as { data: { id: string } }).data.id;

    const patched = await http(app)
      .patch(`/api/v1/admin/catalog/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'New Title', price: 59 })
      .expect(200);

    const body = patched.body as {
      data: {
        title: string;
        price: string;
        translations: Record<string, Record<string, string>>;
      };
    };
    expect(body.data.title).toBe('New Title');
    expect(body.data.price).toBe('59.00');
    expect(body.data.translations.en.title).toBe('New Title');
  });

  it('PATCH /admin/catalog/:id/translations does a per-locale merge (preserves untouched locales)', async () => {
    const token = await adminToken();
    const created = await http(app)
      .post('/api/v1/admin/catalog')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'PSM',
        programCode: 'PSM',
        price: 49,
        translations: { tr: { title: 'Eski TR' }, ar: { title: 'القديم' } },
      })
      .expect(201);
    const id = (created.body as { data: { id: string } }).data.id;

    const patched = await http(app)
      .patch(`/api/v1/admin/catalog/${id}/translations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ translations: { tr: { title: 'Yeni TR' } } })
      .expect(200);

    const t = (patched.body as {
      data: { translations: Record<string, Record<string, string>> };
    }).data.translations;
    expect(t.tr.title).toBe('Yeni TR');
    expect(t.ar.title).toBe('القديم'); // preserved
    expect(t.en.title).toBe('PSM');
  });

  it('rejects an unsupported locale key in translations with 400', async () => {
    const token = await adminToken();
    const created = await http(app)
      .post('/api/v1/admin/catalog')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'PSM', programCode: 'PSM', price: 49 })
      .expect(201);
    const id = (created.body as { data: { id: string } }).data.id;

    await http(app)
      .patch(`/api/v1/admin/catalog/${id}/translations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ translations: { ja: { title: 'にほんご' } } })
      .expect(400);
  });

  it('rejects duplicate program code with 409', async () => {
    const token = await adminToken();
    await http(app)
      .post('/api/v1/admin/catalog')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'PSM A', programCode: 'PSM', price: 49 })
      .expect(201);
    await http(app)
      .post('/api/v1/admin/catalog')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'PSM B', programCode: 'PSM', price: 59 })
      .expect(409);
  });

  it('search filters by trigram against the English title', async () => {
    const token = await adminToken();
    await http(app)
      .post('/api/v1/admin/catalog')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Professional Scrum Master', programCode: 'PSM', price: 49 })
      .expect(201);
    await http(app)
      .post('/api/v1/admin/catalog')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Project Management Professional',
        programCode: 'PMP',
        price: 99,
      })
      .expect(201);

    const res = await http(app).get('/api/v1/catalog?search=Scrum').expect(200);
    const items = (res.body as { data: Array<{ programCode: string }> }).data;
    expect(items.map((i) => i.programCode)).toEqual(['PSM']);
  });

  it('paginates via cursor and returns hasMore + nextCursor', async () => {
    const token = await adminToken();
    for (let i = 0; i < 3; i += 1) {
      await http(app)
        .post('/api/v1/admin/catalog')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: `Cert ${i}`, programCode: `C${i}`, price: 10 + i })
        .expect(201);
    }

    const page1 = await http(app).get('/api/v1/catalog?limit=2').expect(200);
    const m1 = page1.body as {
      data: unknown[];
      meta: {
        pagination: { hasMore: boolean; nextCursor: string | null };
      };
    };
    expect(m1.data).toHaveLength(2);
    expect(m1.meta.pagination.hasMore).toBe(true);
    expect(m1.meta.pagination.nextCursor).not.toBeNull();

    const page2 = await http(app)
      .get(`/api/v1/catalog?limit=2&cursor=${encodeURIComponent(m1.meta.pagination.nextCursor!)}`)
      .expect(200);
    const m2 = page2.body as {
      data: unknown[];
      meta: { pagination: { hasMore: boolean } };
    };
    expect(m2.data).toHaveLength(1);
    expect(m2.meta.pagination.hasMore).toBe(false);
  });
});
