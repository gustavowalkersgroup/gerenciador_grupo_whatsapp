import { z } from "zod";

/**
 * Validação de env em um único lugar. Falhar no boot é melhor do que
 * descobrir que faltou uma variável no meio de um disparo pra 200 grupos.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),

  // Evolution API rodando no VPS
  EVOLUTION_API_URL: z.string().url("EVOLUTION_API_URL precisa ser uma URL completa"),
  EVOLUTION_API_KEY: z.string().min(1, "EVOLUTION_API_KEY é obrigatória"),

  // Segredo compartilhado que a Evolution manda no header do webhook
  WEBHOOK_SECRET: z.string().min(16, "WEBHOOK_SECRET precisa de pelo menos 16 caracteres"),

  // Protege o endpoint de cron da Vercel
  CRON_SECRET: z.string().min(16, "CRON_SECRET precisa de pelo menos 16 caracteres"),

  // Sessão do painel
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET precisa de pelo menos 16 caracteres"),

  APP_URL: z.string().url().optional(),
  TZ_DEFAULT: z.string().default("America/Sao_Paulo"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
