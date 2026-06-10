import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCertCatalogFields1749100000000 implements MigrationInterface {
  name = 'AddCertCatalogFields1749100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."certificates_level_enum" AS ENUM('foundation', 'practitioner', 'authority')`,
    );

    await queryRunner.query(
      `ALTER TABLE "certificates"
        ADD COLUMN "badge_image_url"  varchar(500)                            ,
        ADD COLUMN "track"            varchar(100)                            ,
        ADD COLUMN "level"            "public"."certificates_level_enum"      ,
        ADD COLUMN "duration_hours"   integer                                 ,
        ADD COLUMN "syllabus_url"     varchar(500)                            `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "certificates"
        DROP COLUMN "syllabus_url"    ,
        DROP COLUMN "duration_hours"  ,
        DROP COLUMN "level"           ,
        DROP COLUMN "track"           ,
        DROP COLUMN "badge_image_url" `,
    );

    await queryRunner.query(
      `DROP TYPE "public"."certificates_level_enum"`,
    );
  }
}
