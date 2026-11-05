import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ALWAYS_OPEN, Client, createTestApp, seedMenu, signupOwner } from './helpers';

let app: FastifyInstance;

beforeAll(async () => {
  ({ app } = await createTestApp());
});
afterAll(async () => {
  await app.close();
});

describe('cardápio', () => {
  it('cria, edita, ordena e exclui categorias e produtos', async () => {
    const { client } = await signupOwner(app);
    const a = (await client.post('/api/catalog/categories', { name: 'Lanches' })).json();
    const b = (await client.post('/api/catalog/categories', { name: 'Bebidas' })).json();
    expect(b.position).toBe(a.position + 1);
    await client.post('/api/catalog/categories/reorder', { ids: [b.id, a.id] });
    let catalog = (await client.get('/api/catalog')).json();
    expect(catalog.categories.map((c: { name: string }) => c.name)).toEqual(['Bebidas', 'Lanches']);

    const p = await client.post('/api/catalog/products', { categoryId: a.id, name: 'X-Salada', priceCents: 2590, sku: 'XS-1' });
    expect(p.statusCode).toBe(201);
    const dupSku = await client.post('/api/catalog/products', { categoryId: a.id, name: 'Outro', priceCents: 100, sku: 'XS-1' });
    expect(dupSku.statusCode).toBe(422);

    const blocked = await client.del(`/api/catalog/categories/${a.id}`);
    expect(blocked.statusCode).toBe(409);

    const copy = await client.post(`/api/catalog/products/${p.json().id}/duplicate`);
    expect(copy.json().isActive).toBe(false);
    expect(copy.json().sku).toBeNull();

    await client.del(`/api/catalog/products/${p.json().id}`);
    await client.del(`/api/catalog/products/${copy.json().id}`);
    expect((await client.del(`/api/catalog/categories/${a.id}`)).statusCode).toBe(200);
    catalog = (await client.get('/api/catalog')).json();
    expect(catalog.categories.map((c: { name: string }) => c.name)).toEqual(['Bebidas']);
  });

  it('valida grupos de adicionais', async () => {
    const { client } = await signupOwner(app);
    const invalid = await client.post('/api/catalog/modifier-groups', {
      name: 'Molhos',
      minSelect: 3,
      maxSelect: 2,
      options: [{ name: 'Barbecue', priceCents: 0 }],
    });
    expect(invalid.statusCode).toBe(422);
    const notEnough = await client.post('/api/catalog/modifier-groups', {
      name: 'Molhos',
      minSelect: 2,
      maxSelect: 2,
      options: [{ name: 'Barbecue', priceCents: 0 }],
    });
    expect(notEnough.statusCode).toBe(422);

    const ok = await client.post('/api/catalog/modifier-groups', {
      name: 'Molhos',
      minSelect: 0,
      maxSelect: 2,
      options: [{ name: 'Barbecue', priceCents: 0 }, { name: 'Cheddar', priceCents: 300 }],
    });
    const group = ok.json();
    // Edição mantém ids das opções existentes, adiciona novas e remove as que saíram.
    const updated = await client.put(`/api/catalog/modifier-groups/${group.id}`, {
      name: 'Molhos',
      minSelect: 0,
      maxSelect: 3,
      options: [
        { id: group.options[1].id, name: 'Cheddar cremoso', priceCents: 350 },
        { name: 'Maionese verde', priceCents: 0 },
      ],
    });
    expect(updated.statusCode).toBe(200);
    const after = updated.json();
    expect(after.options).toHaveLength(2);
    expect(after.options[0].id).toBe(group.options[1].id);
    expect(after.options[0].priceCents).toBe(350);
  });

  it('cardápio público mostra apenas o que está ativo e marca esgotados', async () => {
    const { client, slug } = await signupOwner(app);
    await client.put('/api/settings/hours', ALWAYS_OPEN);
    const menu = await seedMenu(client);
    const hidden = await client.post('/api/catalog/products', { categoryId: menu.categoryId, name: 'Secreto', priceCents: 100, isActive: false });
    const soldOut = await client.post('/api/catalog/products', {
      categoryId: menu.categoryId,
      name: 'Esgotado',
      priceCents: 100,
      trackStock: true,
      stockQuantity: 0,
    });
    await client.patch(`/api/catalog/products/${menu.productId}/availability`, { isAvailable: false });

    const pub = (await new Client(app).get(`/api/public/stores/${slug}`)).json();
    expect(pub.store.availability.isOpen).toBe(true);
    const products = pub.categories.flatMap((c: { products: unknown[] }) => c.products) as { id: string; isAvailable: boolean }[];
    expect(products.find((p) => p.id === hidden.json().id)).toBeUndefined();
    expect(products.find((p) => p.id === soldOut.json().id)?.isAvailable).toBe(false);
    expect(products.find((p) => p.id === menu.productId)?.isAvailable).toBe(false);
    expect(JSON.stringify(pub)).not.toContain('orderCounter');
  });

  it('aceita upload só de imagens reais', async () => {
    const { client } = await signupOwner(app);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const boundary = '----balcao';
    const make = (content: Buffer, filename: string, type: string) =>
      Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
        content,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
    const ok = await client.req('POST', '/api/uploads/images', make(png, 'a.png', 'image/png'), {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().url).toMatch(/^\/uploads\/.+\.png$/);
    const served = await app.inject({ method: 'GET', url: ok.json().url });
    expect(served.statusCode).toBe(200);

    const fake = await client.req('POST', '/api/uploads/images', make(Buffer.from('<script>alert(1)</script>'), 'x.png', 'image/png'), {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    });
    expect(fake.statusCode).toBe(422);
  });
});
