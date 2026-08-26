import fs from 'fs';
import path from 'path';

const prismaRoot = path.resolve(__dirname, '../../prisma');
const migrationsDir = path.join(prismaRoot, 'migrations');
const rollbacksDir = path.join(prismaRoot, 'rollbacks');

function listMigrationFolders(): string[] {
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe('Prisma migration workflow', () => {
  it('keeps a schema and migration lock under version control', () => {
    expect(fs.existsSync(path.join(prismaRoot, 'schema.prisma'))).toBe(true);
    expect(fs.existsSync(path.join(migrationsDir, 'migration_lock.toml'))).toBe(true);
  });

  it('has a baseline migration for the existing schema', () => {
    const initSql = path.join(migrationsDir, '0_init', 'migration.sql');
    expect(fs.existsSync(initSql)).toBe(true);
    const sql = fs.readFileSync(initSql, 'utf8');
    expect(sql).toMatch(/CREATE TABLE "User"/);
    expect(sql).toMatch(/CREATE TABLE "Transaction"/);
  });

  it('requires every migration folder to contain migration.sql', () => {
    const folders = listMigrationFolders();
    expect(folders.length).toBeGreaterThan(0);
    for (const folder of folders) {
      const sqlPath = path.join(migrationsDir, folder, 'migration.sql');
      expect(fs.existsSync(sqlPath)).toBe(true);
      expect(fs.readFileSync(sqlPath, 'utf8').trim().length).toBeGreaterThan(0);
    }
  });

  it('stores rollback procedures next to Prisma migrations', () => {
    expect(fs.existsSync(rollbacksDir)).toBe(true);
    const sample = path.join(rollbacksDir, '20260530020000_add_webhook_verification.sql');
    expect(fs.existsSync(sample)).toBe(true);
    expect(fs.readFileSync(sample, 'utf8')).toMatch(/rollback/i);
  });
});
