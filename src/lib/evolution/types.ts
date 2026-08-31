/** Tipos do que a Evolution API v2 devolve e do que ela manda no webhook. */

export type ConnectionState = "open" | "close" | "connecting" | "refused";

export interface InstanceConnectResponse {
  pairingCode?: string | null;
  code?: string | null;
  /** data:image/png;base64,... */
  base64?: string | null;
  count?: number;
}

export interface ConnectionStateResponse {
  instance: { instanceName: string; state: ConnectionState };
}

export interface EvolutionParticipant {
  id: string;
  admin?: "admin" | "superadmin" | null;
}

export interface EvolutionGroup {
  id: string;
  subject: string;
  subjectOwner?: string;
  subjectTime?: number;
  size?: number;
  creation?: number;
  owner?: string;
  desc?: string;
  descId?: string;
  restrict?: boolean;
  announce?: boolean;
  participants?: EvolutionParticipant[];
}

export interface SendMessageResponse {
  key?: { remoteJid: string; fromMe: boolean; id: string };
  status?: string;
  message?: unknown;
}

/* ----------------------------- Webhook ----------------------------- */

export type EvolutionWebhookEventName =
  | "messages.upsert"
  | "messages.update"
  | "send.message"
  | "group-participants.update"
  | "groups.upsert"
  | "groups.update"
  | "connection.update"
  | "qrcode.updated"
  | "contacts.upsert"
  | "contacts.update";

export interface WebhookEnvelope<T = unknown> {
  event: string;
  instance: string;
  data: T;
  destination?: string;
  date_time?: string;
  sender?: string;
  server_url?: string;
  apikey?: string;
}

export interface MessageKey {
  remoteJid: string;
  fromMe: boolean;
  id: string;
  participant?: string;
}

/** Só o que a gente realmente lê do payload gigante do Baileys. */
export interface IncomingMessage {
  key: MessageKey;
  pushName?: string;
  messageType?: string;
  messageTimestamp?: number | string;
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { caption?: string; mimetype?: string };
    videoMessage?: { caption?: string; mimetype?: string };
    documentMessage?: { caption?: string; fileName?: string; mimetype?: string };
    audioMessage?: { mimetype?: string };
    stickerMessage?: unknown;
    buttonsResponseMessage?: { selectedDisplayText?: string };
    listResponseMessage?: { title?: string };
    templateButtonReplyMessage?: { selectedDisplayText?: string };
    ephemeralMessage?: { message?: IncomingMessage["message"] };
    viewOnceMessageV2?: { message?: IncomingMessage["message"] };
  };
}

export interface GroupParticipantsUpdate {
  id: string;
  author?: string;
  participants: string[];
  action: "add" | "remove" | "promote" | "demote";
}

export interface ConnectionUpdate {
  instance?: string;
  state?: ConnectionState;
  statusReason?: number;
}
