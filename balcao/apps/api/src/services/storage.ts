import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Armazenamento de arquivos. A Fase 1 traz o driver local (disco do servidor ou volume).
 * Para produção com várias instâncias, implemente um driver S3-compatível com esta mesma
 * interface (ver docs/ARCHITECTURE.md).
 */
export interface StorageDriver {
  put(key: string, data: Buffer, contentType: string): Promise<{ url: string }>;
  remove(key: string): Promise<void>;
}

export class LocalStorage implements StorageDriver {
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Caminho inválido');
    return full;
  }

  async put(key: string, data: Buffer): Promise<{ url: string }> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
    return { url: `/uploads/${key}` };
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}

/** Identifica o tipo real da imagem pelos primeiros bytes (não confia na extensão nem no cabeçalho). */
export function sniffImageType(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}
