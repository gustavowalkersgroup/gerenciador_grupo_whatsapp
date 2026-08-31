import { env } from "@/lib/env";
import type {
  ConnectionStateResponse,
  EvolutionGroup,
  EvolutionParticipant,
  InstanceConnectResponse,
  SendMessageResponse,
} from "./types";

export class EvolutionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    readonly path: string,
  ) {
    super(message);
    this.name = "EvolutionError";
  }

  /** 5xx e timeout valem retry; 4xx é erro nosso e retry só piora. */
  get retryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
  retries?: number;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, timeoutMs = 20_000, retries = 2 } = opts;
  const base = env().EVOLUTION_API_URL.replace(/\/+$/, "");
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  let lastError: EvolutionError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          apikey: env().EVOLUTION_API_KEY,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });

      const raw = await res.text();
      const parsed = raw ? safeJson(raw) : null;

      if (!res.ok) {
        const err = new EvolutionError(
          `Evolution ${method} ${path} respondeu ${res.status}: ${truncate(raw, 300)}`,
          res.status,
          parsed ?? raw,
          path,
        );
        if (!err.retryable || attempt === retries) throw err;
        lastError = err;
        await sleep(backoffMs(attempt));
        continue;
      }

      return parsed as T;
    } catch (e) {
      if (e instanceof EvolutionError) throw e;
      const err = new EvolutionError(
        `Evolution ${method} ${path} falhou: ${(e as Error).message}`,
        0,
        null,
        path,
      );
      if (attempt === retries) throw err;
      lastError = err;
      await sleep(backoffMs(attempt));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new EvolutionError(`Evolution ${path}: falha desconhecida`, 0, null, path);
}

const backoffMs = (attempt: number) => 500 * 2 ** attempt;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/* ------------------------------------------------------------------ *
 * Instância
 * ------------------------------------------------------------------ */

export const instance = {
  create(instanceName: string, webhookUrl?: string, webhookSecret?: string) {
    return request<unknown>("/instance/create", {
      method: "POST",
      body: {
        instanceName,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
        ...(webhookUrl
          ? {
              webhook: {
                enabled: true,
                url: webhookUrl,
                byEvents: false,
                base64: false,
                headers: webhookSecret ? { "x-webhook-secret": webhookSecret } : undefined,
                events: DEFAULT_WEBHOOK_EVENTS,
              },
            }
          : {}),
      },
    });
  },

  /** Devolve o QR em base64 pra renderizar no painel. */
  connect(instanceName: string) {
    return request<InstanceConnectResponse>(`/instance/connect/${enc(instanceName)}`);
  },

  state(instanceName: string) {
    return request<ConnectionStateResponse>(`/instance/connectionState/${enc(instanceName)}`);
  },

  logout(instanceName: string) {
    return request<unknown>(`/instance/logout/${enc(instanceName)}`, { method: "DELETE" });
  },

  remove(instanceName: string) {
    return request<unknown>(`/instance/delete/${enc(instanceName)}`, { method: "DELETE" });
  },

  list() {
    return request<unknown[]>("/instance/fetchInstances");
  },

  setWebhook(instanceName: string, url: string, secret: string) {
    return request<unknown>(`/webhook/set/${enc(instanceName)}`, {
      method: "POST",
      body: {
        webhook: {
          enabled: true,
          url,
          byEvents: false,
          base64: false,
          headers: { "x-webhook-secret": secret },
          events: DEFAULT_WEBHOOK_EVENTS,
        },
      },
    });
  },
};

export const DEFAULT_WEBHOOK_EVENTS = [
  "MESSAGES_UPSERT",
  "GROUP_PARTICIPANTS_UPDATE",
  "GROUPS_UPSERT",
  "GROUPS_UPDATE",
  "CONNECTION_UPDATE",
  "QRCODE_UPDATED",
];

/* ------------------------------------------------------------------ *
 * Mensagens
 * ------------------------------------------------------------------ */

export interface SendTextInput {
  to: string;
  text: string;
  /** Delay que a própria Evolution aplica antes de enviar (mostra "digitando"). */
  delayMs?: number;
  mentions?: string[];
  quoted?: { key: { id: string; remoteJid: string; fromMe: boolean }; message: unknown };
  linkPreview?: boolean;
}

export const message = {
  sendText(instanceName: string, input: SendTextInput) {
    return request<SendMessageResponse>(`/message/sendText/${enc(instanceName)}`, {
      method: "POST",
      body: {
        number: input.to,
        text: input.text,
        delay: input.delayMs ?? 1200,
        linkPreview: input.linkPreview ?? true,
        ...(input.mentions?.length ? { mentioned: input.mentions } : {}),
        ...(input.quoted ? { quoted: input.quoted } : {}),
      },
    });
  },

  sendMedia(
    instanceName: string,
    input: {
      to: string;
      mediatype: "image" | "video" | "document" | "audio";
      media: string;
      caption?: string;
      fileName?: string;
      mimetype?: string;
      delayMs?: number;
      mentions?: string[];
    },
  ) {
    return request<SendMessageResponse>(`/message/sendMedia/${enc(instanceName)}`, {
      method: "POST",
      body: {
        number: input.to,
        mediatype: input.mediatype,
        media: input.media,
        delay: input.delayMs ?? 1200,
        ...(input.caption ? { caption: input.caption } : {}),
        ...(input.fileName ? { fileName: input.fileName } : {}),
        ...(input.mimetype ? { mimetype: input.mimetype } : {}),
        ...(input.mentions?.length ? { mentioned: input.mentions } : {}),
      },
    });
  },

  /** Apaga pra todo mundo — precisa ser admin do grupo. */
  deleteForEveryone(
    instanceName: string,
    key: { id: string; remoteJid: string; fromMe: boolean; participant?: string },
  ) {
    return request<unknown>(`/chat/deleteMessageForEveryone/${enc(instanceName)}`, {
      method: "DELETE",
      body: key,
    });
  },
};

/* ------------------------------------------------------------------ *
 * Grupos
 * ------------------------------------------------------------------ */

export const group = {
  fetchAll(instanceName: string, withParticipants = true) {
    return request<EvolutionGroup[]>(`/group/fetchAllGroups/${enc(instanceName)}`, {
      query: { getParticipants: withParticipants },
      timeoutMs: 60_000,
    });
  },

  info(instanceName: string, groupJid: string) {
    return request<EvolutionGroup>(`/group/findGroupInfos/${enc(instanceName)}`, {
      query: { groupJid },
    });
  },

  participants(instanceName: string, groupJid: string) {
    return request<{ participants: EvolutionParticipant[] }>(
      `/group/participants/${enc(instanceName)}`,
      { query: { groupJid } },
    );
  },

  create(instanceName: string, subject: string, participants: string[], description?: string) {
    return request<EvolutionGroup>(`/group/create/${enc(instanceName)}`, {
      method: "POST",
      body: { subject, participants, ...(description ? { description } : {}) },
    });
  },

  updateParticipants(
    instanceName: string,
    groupJid: string,
    action: "add" | "remove" | "promote" | "demote",
    participants: string[],
  ) {
    return request<unknown>(`/group/updateParticipant/${enc(instanceName)}`, {
      method: "POST",
      query: { groupJid },
      body: { action, participants },
    });
  },

  updateSubject(instanceName: string, groupJid: string, subject: string) {
    return request<unknown>(`/group/updateGroupSubject/${enc(instanceName)}`, {
      method: "POST",
      query: { groupJid },
      body: { subject },
    });
  },

  updateDescription(instanceName: string, groupJid: string, description: string) {
    return request<unknown>(`/group/updateGroupDescription/${enc(instanceName)}`, {
      method: "POST",
      query: { groupJid },
      body: { description },
    });
  },

  /**
   * announcement = só admin fala (fecha o grupo)
   * locked = só admin edita dados do grupo
   */
  updateSetting(
    instanceName: string,
    groupJid: string,
    action: "announcement" | "not_announcement" | "locked" | "unlocked",
  ) {
    return request<unknown>(`/group/updateSetting/${enc(instanceName)}`, {
      method: "POST",
      query: { groupJid },
      body: { action },
    });
  },

  inviteCode(instanceName: string, groupJid: string) {
    return request<{ inviteUrl?: string; inviteCode?: string }>(
      `/group/inviteCode/${enc(instanceName)}`,
      { query: { groupJid } },
    );
  },

  revokeInviteCode(instanceName: string, groupJid: string) {
    return request<{ inviteUrl?: string; inviteCode?: string }>(
      `/group/revokeInviteCode/${enc(instanceName)}`,
      { method: "POST", query: { groupJid } },
    );
  },

  leave(instanceName: string, groupJid: string) {
    return request<unknown>(`/group/leaveGroup/${enc(instanceName)}`, {
      method: "DELETE",
      query: { groupJid },
    });
  },
};

const enc = (s: string) => encodeURIComponent(s);

export const evolution = { instance, message, group };
