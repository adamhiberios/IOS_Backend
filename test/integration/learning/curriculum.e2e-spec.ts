import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildTestApp } from '../helpers/app';
import { truncateAll, findOne } from '../helpers/db';
import { http, loginAsAdmin, loginAsStudent } from '../helpers/http';
import { createAdmin, createUser, resetCounters } from '../helpers/fixtures';
import { AdminRole, PaymentType } from '../../../src/database/entities';

/**
 * End-to-end coverage of the learning module:
 *   - Admin can author certs, modules, lessons (CRUD)
 *   - Student WITHOUT a purchase row gets 403 on curriculum / lesson / complete
 *   - Student WITH a purchase row sees curriculum, can fetch a lesson, mark complete
 *   - Progress endpoint summarises lessons completed per enrolled cert
 *   - i18n resolution kicks in for titles in lesson responses
 */
describe('[integration] learning/curriculum', () => {
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

  async function seedCatalogWithModuleAndLesson(adminToken: string) {
    const cert = await http(app)
      .post('/api/v1/admin/catalog')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Professional Scrum Master',
        programCode: 'PSM',
        price: 49,
        translations: { tr: { title: 'Profesyonel Scrum Yöneticisi' } },
      })
      .expect(201);
    const certId = (cert.body as { data: { id: string } }).data.id;

    const mod = await http(app)
      .post('/api/v1/admin/modules')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        certId,
        title: 'Module 1 — Foundations',
        position: 0,
        translations: { tr: { title: 'Modül 1 — Temeller' } },
      })
      .expect(201);
    const moduleId = (mod.body as { data: { id: string } }).data.id;

    const lesson = await http(app)
      .post('/api/v1/admin/lessons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        moduleId,
        title: 'Lesson 1 — Sprint Planning',
        contentText: '<p>How to run a sprint.</p>',
        position: 0,
        translations: {
          tr: {
            title: 'Ders 1 — Sprint Planlama',
            content_html: '<p>Sprint nasıl yürütülür.</p>',
          },
        },
      })
      .expect(201);
    const lessonId = (lesson.body as { data: { id: string } }).data.id;

    return { certId, moduleId, lessonId };
  }

  async function enrollStudent(userId: string, certId: string) {
    // Direct DB insert because Stripe + checkout flow is Week 5. The purchase
    // table is what gates lesson serving.
    //
    // RLS note: student_purchases has FORCE RLS. The test role is NOSUPERUSER
    // NOBYPASSRLS, so we have to set the session-local app.current_user_id
    // to match the row's user_id before the INSERT will satisfy the policy.
    await ds.transaction(async (manager) => {
      await manager.query(
        `SELECT set_config('app.current_user_id', $1, true)`,
        [userId],
      );
      await manager.query(
        `INSERT INTO student_purchases (user_id, cert_id, payment_type)
         VALUES ($1, $2, $3)`,
        [userId, certId, PaymentType.ENROLLMENT],
      );
    });
  }

  it('admin can create + update + soft-delete a module and a lesson', async () => {
    const admin = await createAdmin(app, { role: AdminRole.LEARNING_ADMIN });
    const { accessToken: adminToken } = await loginAsAdmin(
      app,
      admin.email,
      admin.password,
    );

    const { moduleId, lessonId } = await seedCatalogWithModuleAndLesson(adminToken);

    // Update module
    const patched = await http(app)
      .patch(`/api/v1/admin/modules/${moduleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Module 1 — Updated' })
      .expect(200);
    expect(
      (patched.body as { data: { title: string } }).data.title,
    ).toBe('Module 1 — Updated');

    // Update lesson
    const patchedLesson = await http(app)
      .patch(`/api/v1/admin/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ durationSeconds: 600 })
      .expect(200);
    expect(
      (patchedLesson.body as { data: { durationSeconds: number } }).data
        .durationSeconds,
    ).toBe(600);

    // Soft-delete module
    await http(app)
      .delete(`/api/v1/admin/modules/${moduleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const modRow = await findOne<{ active: boolean }>(
      ds,
      'learning_modules',
      { id: moduleId },
    );
    expect(modRow!.active).toBe(false);

    // Soft-delete lesson
    await http(app)
      .delete(`/api/v1/admin/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const lessonRow = await findOne<{ active: boolean }>(
      ds,
      'lessons',
      { id: lessonId },
    );
    expect(lessonRow!.active).toBe(false);
  });

  it('content_creator can create modules + lessons; only learning_admin can delete', async () => {
    const lA = await createAdmin(app, { role: AdminRole.LEARNING_ADMIN });
    const { accessToken: lAdminToken } = await loginAsAdmin(
      app,
      lA.email,
      lA.password,
    );

    const cc = await createAdmin(app, { role: AdminRole.CONTENT_CREATOR });
    const { accessToken: ccToken } = await loginAsAdmin(
      app,
      cc.email,
      cc.password,
    );

    // Seed a cert via learning_admin
    const cert = await http(app)
      .post('/api/v1/admin/catalog')
      .set('Authorization', `Bearer ${lAdminToken}`)
      .send({ title: 'X', programCode: 'XX', price: 10 })
      .expect(201);
    const certId = (cert.body as { data: { id: string } }).data.id;

    // content_creator can create modules
    const mod = await http(app)
      .post('/api/v1/admin/modules')
      .set('Authorization', `Bearer ${ccToken}`)
      .send({ certId, title: 'M' })
      .expect(201);
    const moduleId = (mod.body as { data: { id: string } }).data.id;

    // ...and lessons
    await http(app)
      .post('/api/v1/admin/lessons')
      .set('Authorization', `Bearer ${ccToken}`)
      .send({ moduleId, title: 'L' })
      .expect(201);

    // ...but cannot delete modules
    await http(app)
      .delete(`/api/v1/admin/modules/${moduleId}`)
      .set('Authorization', `Bearer ${ccToken}`)
      .expect(403);
  });

  it('student without a purchase row gets 403 on curriculum + lesson + complete', async () => {
    const admin = await createAdmin(app);
    const { accessToken: adminToken } = await loginAsAdmin(
      app,
      admin.email,
      admin.password,
    );
    const { certId, lessonId } = await seedCatalogWithModuleAndLesson(adminToken);

    const u = await createUser(app);
    const { accessToken: studentToken } = await loginAsStudent(
      app,
      u.email,
      u.password,
    );

    await http(app)
      .get(`/api/v1/learning/certs/${certId}/curriculum`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(403);

    await http(app)
      .get(`/api/v1/learning/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(403);

    await http(app)
      .post(`/api/v1/learning/lessons/${lessonId}/complete`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(403);
  });

  it('enrolled student sees the curriculum tree and can fetch a lesson', async () => {
    const admin = await createAdmin(app);
    const { accessToken: adminToken } = await loginAsAdmin(
      app,
      admin.email,
      admin.password,
    );
    const { certId, moduleId, lessonId } =
      await seedCatalogWithModuleAndLesson(adminToken);

    const u = await createUser(app);
    await enrollStudent(u.id, certId);
    const { accessToken: studentToken } = await loginAsStudent(
      app,
      u.email,
      u.password,
    );

    // Curriculum returns module + lesson tree with completion flags
    const curr = await http(app)
      .get(`/api/v1/learning/certs/${certId}/curriculum`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    const body = curr.body as {
      data: {
        certificate: { id: string; title: string };
        modules: Array<{
          id: string;
          title: string;
          lessons: Array<{ id: string; title: string; completed: boolean }>;
        }>;
      };
    };
    expect(body.data.certificate.id).toBe(certId);
    expect(body.data.modules).toHaveLength(1);
    expect(body.data.modules[0].id).toBe(moduleId);
    expect(body.data.modules[0].lessons[0].id).toBe(lessonId);
    expect(body.data.modules[0].lessons[0].completed).toBe(false);

    // Lesson detail
    const lessonRes = await http(app)
      .get(`/api/v1/learning/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);
    const lb = lessonRes.body as {
      data: { id: string; title: string; contentHtml: string };
    };
    expect(lb.data.id).toBe(lessonId);
    expect(lb.data.title).toBe('Lesson 1 — Sprint Planning');
    expect(lb.data.contentHtml).toContain('How to run a sprint');
  });

  it('lesson detail resolves into the requested locale (X-Lang) and falls back when missing', async () => {
    const admin = await createAdmin(app);
    const { accessToken: adminToken } = await loginAsAdmin(
      app,
      admin.email,
      admin.password,
    );
    const { certId, lessonId } = await seedCatalogWithModuleAndLesson(adminToken);

    const u = await createUser(app, { locale: 'tr' });
    await enrollStudent(u.id, certId);
    const { accessToken: studentToken } = await loginAsStudent(
      app,
      u.email,
      u.password,
    );

    // Without X-Lang, user.locale = 'tr' wins → Turkish content
    const trRes = await http(app)
      .get(`/api/v1/learning/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);
    const tb = trRes.body as {
      data: { title: string; contentHtml: string };
      meta: { locale: string; direction: string; fallbackUsed: boolean };
    };
    expect(tb.meta.locale).toBe('tr');
    expect(tb.data.title).toBe('Ders 1 — Sprint Planlama');
    expect(tb.data.contentHtml).toContain('Sprint nasıl yürütülür');
    expect(tb.meta.fallbackUsed).toBe(false);

    // X-Lang explicitly overrides user pref → fr (no translation) → English fallback
    const frRes = await http(app)
      .get(`/api/v1/learning/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .set('X-Lang', 'fr')
      .expect(200);
    const fb = frRes.body as {
      data: { title: string };
      meta: { locale: string; fallbackUsed: boolean };
    };
    expect(fb.meta.locale).toBe('fr');
    expect(fb.data.title).toBe('Lesson 1 — Sprint Planning');
    expect(fb.meta.fallbackUsed).toBe(true);
  });

  it('marking a lesson complete is idempotent and shows up in progress + curriculum', async () => {
    const admin = await createAdmin(app);
    const { accessToken: adminToken } = await loginAsAdmin(
      app,
      admin.email,
      admin.password,
    );
    const { certId, lessonId } = await seedCatalogWithModuleAndLesson(adminToken);

    const u = await createUser(app);
    await enrollStudent(u.id, certId);
    const { accessToken: studentToken } = await loginAsStudent(
      app,
      u.email,
      u.password,
    );

    const first = await http(app)
      .post(`/api/v1/learning/lessons/${lessonId}/complete`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);
    expect(
      (first.body as { data: { alreadyCompleted: boolean } }).data
        .alreadyCompleted,
    ).toBe(false);

    const second = await http(app)
      .post(`/api/v1/learning/lessons/${lessonId}/complete`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);
    expect(
      (second.body as { data: { alreadyCompleted: boolean } }).data
        .alreadyCompleted,
    ).toBe(true);

    // Curriculum reflects completion
    const curr = await http(app)
      .get(`/api/v1/learning/certs/${certId}/curriculum`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);
    const lessons = (curr.body as {
      data: { modules: Array<{ lessons: Array<{ completed: boolean }> }> };
    }).data.modules[0].lessons;
    expect(lessons[0].completed).toBe(true);

    // Progress summary
    const prog = await http(app)
      .get('/api/v1/learning/progress')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);
    const summary = (prog.body as {
      data: Array<{
        certId: string;
        totalLessons: number;
        completedLessons: number;
        percentComplete: number;
      }>;
    }).data;
    expect(summary).toHaveLength(1);
    expect(summary[0].certId).toBe(certId);
    expect(summary[0].totalLessons).toBe(1);
    expect(summary[0].completedLessons).toBe(1);
    expect(summary[0].percentComplete).toBe(100);
  });

  it('returns 401 for anonymous calls on every learning endpoint', async () => {
    const fakeUuid = '00000000-0000-0000-0000-000000000000';
    await http(app)
      .get(`/api/v1/learning/certs/${fakeUuid}/curriculum`)
      .expect(401);
    await http(app).get(`/api/v1/learning/lessons/${fakeUuid}`).expect(401);
    await http(app)
      .post(`/api/v1/learning/lessons/${fakeUuid}/complete`)
      .expect(401);
    await http(app).get('/api/v1/learning/progress').expect(401);
  });
});
