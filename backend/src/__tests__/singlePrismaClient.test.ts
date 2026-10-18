import fs from 'fs';
import path from 'path';
import { getPrismaClient, disconnectPrismaClient } from '../prismaClient';

const SRC_ROOT = path.resolve(__dirname, '..');

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === 'tests' ? [] : listSourceFiles(full);
    }
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('single Prisma client / connection pool', () => {
  afterAll(async () => {
    await disconnectPrismaClient();
  });

  it('constructs a PrismaClient in exactly one non-test source file', () => {
    const matches = listSourceFiles(SRC_ROOT).filter((file) =>
      /new\s+PrismaClient\w*\s*\(/.test(fs.readFileSync(file, 'utf8')),
    );
    expect(matches.map((file) => path.relative(SRC_ROOT, file).split(path.sep).join('/'))).toEqual([
      'prismaClient.ts',
    ]);
  });

  it('returns the same client instance on every call', () => {
    expect(getPrismaClient()).toBe(getPrismaClient());
  });

  it('builds the extended `prisma` export on the shared client rather than a second one', () => {
    const shared = getPrismaClient();
    const extendSpy = jest.spyOn(shared, '$extends');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../prisma');
    });
    expect(extendSpy).toHaveBeenCalledTimes(1);
    extendSpy.mockRestore();
  });
});
