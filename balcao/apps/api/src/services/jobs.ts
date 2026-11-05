import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { Database, DbExecutor } from '../db/client';
import { jobs } from '../db/schema';

/**
 * Fila de tarefas em segundo plano sobre o próprio PostgreSQL.
 * - `FOR UPDATE SKIP LOCKED` permite várias instâncias da API consumindo sem pegar a mesma tarefa.
 * - Enfileirar dentro de uma transação garante que a tarefa só existe se a transação for confirmada.
 * - Novas tentativas com espera crescente; tarefas travadas por queda do processo voltam para a fila.
 * - `dedupeKey` evita tarefas duplicadas (ex.: duas notificações do mesmo status do mesmo pedido).
 */

export type JobRow = typeof jobs.$inferSelect;
export type JobHandler = (payload: Record<string, unknown>, ctx: { app: FastifyInstance; job: JobRow }) => Promise<void>;

/** Erro que não adianta tentar de novo (ex.: credencial inválida, pedido inexistente). */
export class PermanentJobError extends Error {}

export class JobQueue {
  private handlers = new Map<string, JobHandler>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private app: FastifyInstance | null = null;

  constructor(
    private readonly db: Database,
    private readonly log: FastifyBaseLogger,
  ) {}

  register(type: string, handler: JobHandler) {
    this.handlers.set(type, handler);
  }

  async enqueue(
    db: DbExecutor,
    type: string,
    payload: Record<string, unknown>,
    opts: { runAt?: Date; dedupeKey?: string; maxAttempts?: number } = {},
  ): Promise<void> {
    await db
      .insert(jobs)
      .values({
        type,
        payload,
        runAt: opts.runAt ?? new Date(),
        dedupeKey: opts.dedupeKey ?? null,
        maxAttempts: opts.maxAttempts ?? 5,
      })
      .onConflictDoNothing();
    this.kick();
  }

  /** Processa assim que possível (no mesmo processo); outras instâncias pegam no próximo ciclo. */
  kick() {
    if (this.timer && !this.running) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.loop(), 25);
    }
  }

  start(app: FastifyInstance) {
    this.app = app;
    this.timer = setTimeout(() => void this.loop(), 500);
  }

  attach(app: FastifyInstance) {
    this.app = app;
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async loop() {
    if (this.running) return;
    this.running = true;
    try {
      // Devolve à fila tarefas presas há mais de 5 minutos (processo caiu no meio).
      await this.db.execute(
        sql`update jobs set status = 'queued', locked_at = null where status = 'running' and locked_at < now() - interval '5 minutes'`,
      );
      let processed = 0;
      while (processed < 20 && (await this.runOnce())) processed++;
    } catch (err) {
      this.log.error({ err }, 'erro no ciclo da fila de tarefas');
    } finally {
      this.running = false;
      if (this.timer !== null) this.timer = setTimeout(() => void this.loop(), 1000);
    }
  }

  /** Executa uma tarefa pendente. Retorna false se não houver nenhuma. */
  async runOnce(): Promise<boolean> {
    const { rows } = await this.db.execute<{ id: string }>(sql`
      update jobs set status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
      where id = (
        select id from jobs where status = 'queued' and run_at <= now()
        order by run_at limit 1 for update skip locked
      )
      returning id`);
    const claimed = rows[0];
    if (!claimed) return false;
    const [job] = await this.db.select().from(jobs).where(sql`${jobs.id} = ${claimed.id}`);
    if (!job) return true;

    const handler = this.handlers.get(job.type);
    try {
      if (!handler) throw new PermanentJobError(`Tarefa sem tratador: ${job.type}`);
      if (!this.app) throw new Error('Fila sem aplicação associada');
      await handler(job.payload, { app: this.app, job });
      await this.db.execute(sql`update jobs set status = 'done', locked_at = null, last_error = null, updated_at = now() where id = ${job.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const permanent = err instanceof PermanentJobError || job.attempts >= job.maxAttempts;
      // Espera crescente: 10 s, 40 s, 90 s, 160 s…
      const delaySeconds = 10 * job.attempts * job.attempts;
      await this.db.execute(sql`
        update jobs set
          status = ${permanent ? 'failed' : 'queued'}::job_status,
          locked_at = null,
          last_error = ${message.slice(0, 1000)},
          run_at = now() + make_interval(secs => ${delaySeconds}),
          updated_at = now()
        where id = ${job.id}`);
      this.log[permanent ? 'error' : 'warn']({ err, jobId: job.id, type: job.type, attempts: job.attempts }, 'tarefa falhou');
    }
    return true;
  }

  /** Para testes: executa tudo que estiver pronto. */
  async drain(limit = 100) {
    let n = 0;
    while (n < limit && (await this.runOnce())) n++;
    return n;
  }
}
