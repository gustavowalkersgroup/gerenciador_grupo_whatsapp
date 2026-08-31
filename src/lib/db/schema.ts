import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ *
 * Enums
 * ------------------------------------------------------------------ */

export const instanceStatus = pgEnum("instance_status", [
  "disconnected",
  "connecting",
  "connected",
  "banned",
]);

export const moderationKind = pgEnum("moderation_kind", [
  "anti_link",
  "anti_flood",
  "banned_words",
  "anti_media",
  "only_admins",
]);

export const moderationAction = pgEnum("moderation_action", [
  "warn",
  "delete",
  "delete_and_warn",
  "remove",
]);

export const matchMode = pgEnum("match_mode", ["contains", "exact", "regex", "starts_with"]);

export const broadcastStatus = pgEnum("broadcast_status", [
  "draft",
  "scheduled",
  "running",
  "paused",
  "done",
  "failed",
  "canceled",
]);

export const targetStatus = pgEnum("target_status", [
  "pending",
  "sent",
  "failed",
  "skipped",
]);

export const dmStatus = pgEnum("dm_status", ["sent", "failed", "suppressed"]);

/* ------------------------------------------------------------------ *
 * Autenticação do painel
 * ------------------------------------------------------------------ */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name"),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("owner"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_token_uq").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
  ],
);

/* ------------------------------------------------------------------ *
 * Instâncias (números de WhatsApp conectados na Evolution API)
 * ------------------------------------------------------------------ */

export const instances = pgTable(
  "instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Nome da instância dentro da Evolution API — é a chave que a API usa na URL. */
    evolutionName: text("evolution_name").notNull(),
    label: text("label").notNull(),
    phone: text("phone"),
    status: instanceStatus("status").notNull().default("disconnected"),
    /** Limites de segurança pra não queimar o número. */
    dailyDmLimit: integer("daily_dm_limit").notNull().default(150),
    minSendDelayMs: integer("min_send_delay_ms").notNull().default(4000),
    maxSendDelayMs: integer("max_send_delay_ms").notNull().default(12000),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("instances_evolution_name_uq").on(t.evolutionName)],
);

/* ------------------------------------------------------------------ *
 * Grupos e etiquetas
 * ------------------------------------------------------------------ */

export const groups = pgTable(
  "groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    /** JID do grupo, ex: 120363000000000000@g.us */
    jid: text("jid").notNull(),
    name: text("name").notNull().default(""),
    description: text("description"),
    ownerJid: text("owner_jid"),
    participantsCount: integer("participants_count").notNull().default(0),
    /** O nosso número é admin nesse grupo? Sem isso não dá pra moderar. */
    botIsAdmin: boolean("bot_is_admin").notNull().default(false),
    managed: boolean("managed").notNull().default(true),
    inviteCode: text("invite_code"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("groups_instance_jid_uq").on(t.instanceId, t.jid),
    index("groups_instance_idx").on(t.instanceId),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    color: text("color").notNull().default("#25D366"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tags_name_uq").on(sql`lower(${t.name})`)],
);

export const groupTags = pgTable(
  "group_tags",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.tagId] })],
);

/* ------------------------------------------------------------------ *
 * Contatos e participantes
 * ------------------------------------------------------------------ */

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** JID do contato, ex: 5511999999999@s.whatsapp.net */
    jid: text("jid").notNull(),
    phone: text("phone"),
    pushName: text("push_name"),
    /** LGPD: quem pediu pra sair não recebe mais DM, nunca. */
    optOut: boolean("opt_out").notNull().default(false),
    optOutAt: timestamp("opt_out_at", { withTimezone: true }),
    lastDmAt: timestamp("last_dm_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("contacts_jid_uq").on(t.jid)],
);

export const groupMembers = pgTable(
  "group_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    isAdmin: boolean("is_admin").notNull().default(false),
    strikes: integer("strikes").notNull().default(0),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
    messageCount: integer("message_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("group_members_uq").on(t.groupId, t.contactId),
    index("group_members_group_idx").on(t.groupId),
    index("group_members_contact_idx").on(t.contactId),
  ],
);

/* ------------------------------------------------------------------ *
 * Moderação
 * ------------------------------------------------------------------ */

export const moderationRules = pgTable(
  "moderation_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    /** NULL = regra global, vale para todos os grupos gerenciados da instância. */
    groupId: uuid("group_id").references(() => groups.id, { onDelete: "cascade" }),
    kind: moderationKind("kind").notNull(),
    action: moderationAction("action").notNull().default("delete_and_warn"),
    /** Remover automaticamente ao chegar nesse número de strikes. 0 = nunca. */
    removeAtStrikes: integer("remove_at_strikes").notNull().default(3),
    /** Config específica do tipo: { words: [], allowDomains: [], maxMsgs, windowSec } */
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    warnTemplate: text("warn_template"),
    /** Admins do grupo nunca são moderados. */
    exemptAdmins: boolean("exempt_admins").notNull().default(true),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("moderation_rules_instance_idx").on(t.instanceId),
    index("moderation_rules_group_idx").on(t.groupId),
  ],
);

export const moderationEvents = pgTable(
  "moderation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    ruleId: uuid("rule_id").references(() => moderationRules.id, { onDelete: "set null" }),
    kind: moderationKind("kind").notNull(),
    action: moderationAction("action").notNull(),
    messageId: text("message_id"),
    excerpt: text("excerpt"),
    strikesAfter: integer("strikes_after").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("moderation_events_group_idx").on(t.groupId, t.createdAt),
    index("moderation_events_contact_idx").on(t.contactId),
  ],
);

/* ------------------------------------------------------------------ *
 * Boas-vindas
 * ------------------------------------------------------------------ */

export const welcomeConfigs = pgTable(
  "welcome_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    /** Suporta {{nome}}, {{grupo}}, {{numero}} */
    template: text("template").notNull(),
    mediaUrl: text("media_url"),
    mediaType: text("media_type"),
    /** Manda no privado em vez de marcar a pessoa no grupo. */
    sendAsDm: boolean("send_as_dm").notNull().default(false),
    mentionMember: boolean("mention_member").notNull().default(true),
    delaySeconds: integer("delay_seconds").notNull().default(3),
    farewellTemplate: text("farewell_template"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("welcome_configs_group_uq").on(t.groupId)],
);

/* ------------------------------------------------------------------ *
 * Gatilhos de palavra-chave -> puxa a pessoa pro privado
 * ------------------------------------------------------------------ */

export const keywordTriggers = pgTable(
  "keyword_triggers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** NULL = vale em todos os grupos gerenciados da instância. */
    groupId: uuid("group_id").references(() => groups.id, { onDelete: "cascade" }),
    /** Qualquer uma dessas palavras dispara. Normalizadas (sem acento, minúsculas). */
    keywords: jsonb("keywords").notNull().default(sql`'[]'::jsonb`),
    /** Todas essas precisam aparecer junto — ex: ["sapato"] + keywords ["44","quarenta e quatro"]. */
    requiredAll: jsonb("required_all").notNull().default(sql`'[]'::jsonb`),
    /** Se alguma dessas aparecer, o gatilho é ignorado. Evita falso positivo. */
    negativeKeywords: jsonb("negative_keywords").notNull().default(sql`'[]'::jsonb`),
    mode: matchMode("mode").notNull().default("contains"),
    /** Mensagem enviada no privado. Suporta {{nome}}, {{grupo}}, {{mensagem}}, {{match}}. */
    dmTemplate: text("dm_template").notNull(),
    dmMediaUrl: text("dm_media_url"),
    dmMediaType: text("dm_media_type"),
    /** Opcionalmente responde no grupo também ("te chamei no PV!"). */
    replyInGroup: boolean("reply_in_group").notNull().default(false),
    groupReplyTemplate: text("group_reply_template"),
    /** Não incomoda a mesma pessoa de novo antes disso. */
    cooldownMinutes: integer("cooldown_minutes").notNull().default(1440),
    /** Teto diário por gatilho, além do teto da instância. */
    dailyLimit: integer("daily_limit").notNull().default(100),
    /** Etiqueta aplicada ao contato quando bate — vira lista de lead. */
    applyTagId: uuid("apply_tag_id").references(() => tags.id, { onDelete: "set null" }),
    priority: integer("priority").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("keyword_triggers_instance_idx").on(t.instanceId),
    index("keyword_triggers_group_idx").on(t.groupId),
  ],
);

export const keywordHits = pgTable(
  "keyword_hits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    triggerId: uuid("trigger_id")
      .notNull()
      .references(() => keywordTriggers.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => groups.id, { onDelete: "set null" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    messageId: text("message_id"),
    matchedTerm: text("matched_term"),
    excerpt: text("excerpt"),
    status: dmStatus("status").notNull(),
    /** Por que não mandou: opt_out, cooldown, daily_limit, send_error. */
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("keyword_hits_trigger_contact_idx").on(t.triggerId, t.contactId, t.createdAt),
    index("keyword_hits_created_idx").on(t.createdAt),
  ],
);

/* ------------------------------------------------------------------ *
 * Disparos
 * ------------------------------------------------------------------ */

export const broadcasts = pgTable(
  "broadcasts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** { type: "text"|"image"|"video"|"document", text, mediaUrl, fileName } */
    payload: jsonb("payload").notNull(),
    status: broadcastStatus("status").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Intervalo aleatório entre envios — parecer humano é o que salva o número. */
    minDelayMs: integer("min_delay_ms").notNull().default(6000),
    maxDelayMs: integer("max_delay_ms").notNull().default(18000),
    /** Quantos alvos processar por rodada de cron. */
    batchSize: integer("batch_size").notNull().default(15),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("broadcasts_status_scheduled_idx").on(t.status, t.scheduledAt)],
);

export const broadcastTargets = pgTable(
  "broadcast_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    broadcastId: uuid("broadcast_id")
      .notNull()
      .references(() => broadcasts.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    status: targetStatus("status").notNull().default("pending"),
    messageId: text("message_id"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("broadcast_targets_uq").on(t.broadcastId, t.groupId),
    index("broadcast_targets_pending_idx").on(t.broadcastId, t.status),
  ],
);

/**
 * Um registro por mensagem de grupo. Serve pra duas coisas: detectar flood
 * (contar mensagens numa janela) e montar os relatórios de atividade.
 * Não guardamos o texto — só o metadado. Purgado pelo cron de retenção.
 */
export const messageEvents = pgTable(
  "message_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    messageId: text("message_id"),
    messageType: text("message_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("message_events_flood_idx").on(t.groupId, t.contactId, t.createdAt),
    index("message_events_created_idx").on(t.createdAt),
    uniqueIndex("message_events_msg_uq").on(t.groupId, t.messageId),
  ],
);

/* ------------------------------------------------------------------ *
 * Métricas e observabilidade
 * ------------------------------------------------------------------ */

export const dailyGroupStats = pgTable(
  "daily_group_stats",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    messages: integer("messages").notNull().default(0),
    activeMembers: integer("active_members").notNull().default(0),
    joins: integer("joins").notNull().default(0),
    leaves: integer("leaves").notNull().default(0),
    moderations: integer("moderations").notNull().default(0),
    keywordHits: integer("keyword_hits").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.day] })],
);

/**
 * Idempotência de webhook. A Evolution reenvia evento quando dá timeout;
 * sem isso o mesmo "quero sapato 44" vira três DMs pro mesmo coitado.
 */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dedupeKey: text("dedupe_key").notNull(),
    event: text("event").notNull(),
    instanceName: text("instance_name"),
    payload: jsonb("payload"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("webhook_events_dedupe_uq").on(t.dedupeKey),
    index("webhook_events_created_idx").on(t.createdAt),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity"),
    entityId: text("entity_id"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_created_idx").on(t.createdAt)],
);

/* ------------------------------------------------------------------ *
 * Relations
 * ------------------------------------------------------------------ */

export const instancesRelations = relations(instances, ({ many }) => ({
  groups: many(groups),
  moderationRules: many(moderationRules),
  keywordTriggers: many(keywordTriggers),
  broadcasts: many(broadcasts),
}));

export const groupsRelations = relations(groups, ({ one, many }) => ({
  instance: one(instances, { fields: [groups.instanceId], references: [instances.id] }),
  members: many(groupMembers),
  welcome: one(welcomeConfigs),
  tags: many(groupTags),
}));

export const contactsRelations = relations(contacts, ({ many }) => ({
  memberships: many(groupMembers),
  keywordHits: many(keywordHits),
}));

export const groupMembersRelations = relations(groupMembers, ({ one }) => ({
  group: one(groups, { fields: [groupMembers.groupId], references: [groups.id] }),
  contact: one(contacts, { fields: [groupMembers.contactId], references: [contacts.id] }),
}));

export const groupTagsRelations = relations(groupTags, ({ one }) => ({
  group: one(groups, { fields: [groupTags.groupId], references: [groups.id] }),
  tag: one(tags, { fields: [groupTags.tagId], references: [tags.id] }),
}));

export const broadcastsRelations = relations(broadcasts, ({ one, many }) => ({
  instance: one(instances, { fields: [broadcasts.instanceId], references: [instances.id] }),
  targets: many(broadcastTargets),
}));

export const broadcastTargetsRelations = relations(broadcastTargets, ({ one }) => ({
  broadcast: one(broadcasts, {
    fields: [broadcastTargets.broadcastId],
    references: [broadcasts.id],
  }),
  group: one(groups, { fields: [broadcastTargets.groupId], references: [groups.id] }),
}));

export const keywordTriggersRelations = relations(keywordTriggers, ({ one, many }) => ({
  instance: one(instances, {
    fields: [keywordTriggers.instanceId],
    references: [instances.id],
  }),
  group: one(groups, { fields: [keywordTriggers.groupId], references: [groups.id] }),
  hits: many(keywordHits),
}));

export const keywordHitsRelations = relations(keywordHits, ({ one }) => ({
  trigger: one(keywordTriggers, {
    fields: [keywordHits.triggerId],
    references: [keywordTriggers.id],
  }),
  contact: one(contacts, { fields: [keywordHits.contactId], references: [contacts.id] }),
  group: one(groups, { fields: [keywordHits.groupId], references: [groups.id] }),
}));
