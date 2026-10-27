import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { assertKey, typeOfName } from "./keys";
import type { ObjectInfo, ObjectStore } from "./port";

export interface FolderOptions {
  /** The folder every file lives under. */
  root: string;
  /** Where the folder is served from, when it is (a dev server): the public link. */
  publicBaseUrl?: string;
}

/** A folder on disk, for development, tests and the Mac apps. A key can never leave the root. */
export function folderStore(options: FolderOptions): ObjectStore {
  const root = resolve(options.root);
  const pathOf = (key: string) => {
    const path = resolve(join(root, assertKey(key)));
    if (!path.startsWith(root + sep)) throw new Error("a key cannot leave the root");
    return path;
  };
  const walk = async (dir: string, base: string): Promise<ObjectInfo[]> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: ObjectInfo[] = [];
    for (const entry of entries) {
      const key = base === "" ? entry.name : `${base}/${entry.name}`;
      if (entry.isDirectory()) out.push(...(await walk(join(dir, entry.name), key)));
      else out.push({ key, size: (await stat(join(dir, entry.name))).size });
    }
    return out;
  };
  return {
    async put(key, bytes) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },
    async get(key) {
      try {
        return { bytes: new Uint8Array(await readFile(pathOf(key))), contentType: typeOfName(key) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "EISDIR") return null;
        throw error;
      }
    },
    async head(key) {
      try {
        const s = await stat(pathOf(key));
        return s.isFile() ? { key, size: s.size } : null;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async delete(key) {
      await rm(pathOf(key), { force: true });
    },
    async list(prefix) {
      const slash = prefix.lastIndexOf("/");
      const dir = slash < 0 ? "" : prefix.slice(0, slash);
      const found = await walk(dir === "" ? root : join(root, dir), dir);
      return found.filter((f) => f.key.startsWith(prefix)).sort((a, b) => a.key.localeCompare(b.key));
    },
    async signedUrl() {
      return null;
    },
    publicUrl: (key) => (options.publicBaseUrl ? `${options.publicBaseUrl.replace(/\/+$/, "")}/${assertKey(key)}` : null),
  };
}
