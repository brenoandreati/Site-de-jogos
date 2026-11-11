/* =====================================================================
   Planejamento Semanal · Worker
   Serve as páginas de public/ e repassa, ao vivo, os dados da Central
   Scale & JP (Calendário de Posts, Central Scale e Central do JP).
   Nenhum roteiro fica copiado aqui: quando a Central muda, o
   planejamento muda junto, sem publicar de novo.
   ===================================================================== */
const CENTRAL = 'https://sistema-central-scale.scale-educacao.workers.dev';

/* Só estes caminhos vão para a Central. O resto é arquivo de public/. */
const FONTES = {
  '/calendario-posts.html': '/modulos/calendario-posts',
  '/central-scale.html': '/modulos/central-scale',
  '/central-jp.html': '/modulos/central-jp',
  '/dados/calendario.js': '/dados/calendario.js',
  '/dados/central-scale.js': '/dados/central-scale.js',
  '/dados/central-jp.js': '/dados/central-jp.js',
};

/* Roteiros editados no painel: um registro por peça ("jp:R001x", "scale:RJ06"), guardados num
   Durable Object (gravou, todo mundo vê na hora). GET devolve todos; PUT grava um
   (texto vazio volta ao original da Central). */
const CHAVE = /^(jp|scale):[A-Za-z0-9_-]{1,24}$/;
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export class Roteiros {
  constructor(state) { this.storage = state.storage; }
  async fetch(request) {
    if (request.method === 'GET') {
      const out = {};
      (await this.storage.list()).forEach((v, k) => { out[k] = v; });
      return json(out);
    }
    if (request.method === 'PUT') {
      let b;
      try { b = await request.json(); } catch (e) { return json({ erro: 'Corpo inválido.' }, 400); }
      const chave = String(b && b.chave || ''), texto = String(b && b.texto || '');
      if (!CHAVE.test(chave)) return json({ erro: 'Chave inválida.' }, 400);
      if (texto.length > 20000) return json({ erro: 'Roteiro grande demais.' }, 413);
      if (!texto.trim()) { await this.storage.delete(chave); return json({ ok: true, original: true }); }
      const reg = { texto, em: Date.now() };
      await this.storage.put(chave, reg);
      return json({ ok: true, em: reg.em });
    }
    return json({ erro: 'Método não permitido.' }, 405);
  }
}
const roteiros = (request, env) => env.ROTEIROS.get(env.ROTEIROS.idFromName('todos')).fetch(request);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/roteiros') return roteiros(request, env);
    const caminho = FONTES[url.pathname];
    if (!caminho) return env.ASSETS.fetch(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Método não permitido', { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    let r;
    try {
      r = await fetch(CENTRAL + caminho, { cf: { cacheTtl: 60, cacheEverything: true } });
    } catch (e) {
      return new Response('A Central não respondeu.', { status: 502 });
    }
    /* 404 da Central passa como 404: é assim que a página sabe que a pasta dados/ não existe lá */
    if (!r.ok) return new Response(null, { status: r.status === 404 ? 404 : 502 });
    const js = caminho.endsWith('.js');
    return new Response(r.body, {
      status: 200,
      headers: {
        /* os módulos da Central chegam como texto: a página só lê os dados, não abre o HTML deles aqui */
        'content-type': js ? 'application/javascript; charset=utf-8' : 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=60',
        'x-content-type-options': 'nosniff',
      },
    });
  },
};
