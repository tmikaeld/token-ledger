import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { dataFilePath } from './store.ts';

let identity: Promise<{ id: string; label: string }> | null = null;
/** Persistent ledger identity prevents double counting duplicate daemon connections. */
export function serverIdentity() {
  identity ??= (async () => {
    const dir = dirname(dataFilePath());
    const file = join(dir, 'server-identity.json');
    let id: string;
    try { id = z.object({ id: z.uuid() }).parse(JSON.parse(await readFile(file, 'utf8'))).id; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      id = crypto.randomUUID();
      await mkdir(dir, { recursive: true });
      await writeFile(file, JSON.stringify({ id }) + '\n', { flag: 'wx' });
    }
    return { id, label: hostname() };
  })().catch((error) => { identity = null; throw error; });
  return identity;
}
