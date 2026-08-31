CREATE TYPE "public"."broadcast_status" AS ENUM('draft', 'scheduled', 'running', 'paused', 'done', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."dm_status" AS ENUM('sent', 'failed', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."instance_status" AS ENUM('disconnected', 'connecting', 'connected', 'banned');--> statement-breakpoint
CREATE TYPE "public"."match_mode" AS ENUM('contains', 'exact', 'regex', 'starts_with');--> statement-breakpoint
CREATE TYPE "public"."moderation_action" AS ENUM('warn', 'delete', 'delete_and_warn', 'remove');--> statement-breakpoint
CREATE TYPE "public"."moderation_kind" AS ENUM('anti_link', 'anti_flood', 'banned_words', 'anti_media', 'only_admins');--> statement-breakpoint
CREATE TYPE "public"."target_status" AS ENUM('pending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broadcast_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"status" "target_status" DEFAULT 'pending' NOT NULL,
	"message_id" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "broadcast_status" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"min_delay_ms" integer DEFAULT 6000 NOT NULL,
	"max_delay_ms" integer DEFAULT 18000 NOT NULL,
	"batch_size" integer DEFAULT 15 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_tags" (
	"contact_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_tags_contact_id_tag_id_pk" PRIMARY KEY("contact_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jid" text NOT NULL,
	"phone" text,
	"push_name" text,
	"opt_out" boolean DEFAULT false NOT NULL,
	"opt_out_at" timestamp with time zone,
	"last_dm_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_group_stats" (
	"group_id" uuid NOT NULL,
	"day" date NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"active_members" integer DEFAULT 0 NOT NULL,
	"joins" integer DEFAULT 0 NOT NULL,
	"leaves" integer DEFAULT 0 NOT NULL,
	"moderations" integer DEFAULT 0 NOT NULL,
	"keyword_hits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "daily_group_stats_group_id_day_pk" PRIMARY KEY("group_id","day")
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"strikes" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"message_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "group_tags" (
	"group_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "group_tags_group_id_tag_id_pk" PRIMARY KEY("group_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"jid" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"description" text,
	"owner_jid" text,
	"participants_count" integer DEFAULT 0 NOT NULL,
	"bot_is_admin" boolean DEFAULT false NOT NULL,
	"managed" boolean DEFAULT true NOT NULL,
	"invite_code" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evolution_name" text NOT NULL,
	"label" text NOT NULL,
	"phone" text,
	"status" "instance_status" DEFAULT 'disconnected' NOT NULL,
	"daily_dm_limit" integer DEFAULT 150 NOT NULL,
	"min_send_delay_ms" integer DEFAULT 4000 NOT NULL,
	"max_send_delay_ms" integer DEFAULT 12000 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keyword_hits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger_id" uuid NOT NULL,
	"group_id" uuid,
	"contact_id" uuid NOT NULL,
	"message_id" text,
	"matched_term" text,
	"excerpt" text,
	"status" "dm_status" NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keyword_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"name" text NOT NULL,
	"group_id" uuid,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_all" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"negative_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mode" "match_mode" DEFAULT 'contains' NOT NULL,
	"dm_template" text NOT NULL,
	"dm_media_url" text,
	"dm_media_type" text,
	"reply_in_group" boolean DEFAULT false NOT NULL,
	"group_reply_template" text,
	"cooldown_minutes" integer DEFAULT 1440 NOT NULL,
	"daily_limit" integer DEFAULT 100 NOT NULL,
	"apply_tag_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"message_id" text,
	"message_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"contact_id" uuid,
	"rule_id" uuid,
	"kind" "moderation_kind" NOT NULL,
	"action" "moderation_action" NOT NULL,
	"message_id" text,
	"excerpt" text,
	"strikes_after" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"group_id" uuid,
	"kind" "moderation_kind" NOT NULL,
	"action" "moderation_action" DEFAULT 'delete_and_warn' NOT NULL,
	"remove_at_strikes" integer DEFAULT 3 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warn_template" text,
	"exempt_admins" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#25D366' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"event" text NOT NULL,
	"instance_name" text,
	"payload" jsonb,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "welcome_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"template" text NOT NULL,
	"media_url" text,
	"media_type" text,
	"send_as_dm" boolean DEFAULT false NOT NULL,
	"mention_member" boolean DEFAULT true NOT NULL,
	"delay_seconds" integer DEFAULT 3 NOT NULL,
	"farewell_template" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_targets" ADD CONSTRAINT "broadcast_targets_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_targets" ADD CONSTRAINT "broadcast_targets_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_group_stats" ADD CONSTRAINT "daily_group_stats_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_tags" ADD CONSTRAINT "group_tags_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_tags" ADD CONSTRAINT "group_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_hits" ADD CONSTRAINT "keyword_hits_trigger_id_keyword_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."keyword_triggers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_hits" ADD CONSTRAINT "keyword_hits_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_hits" ADD CONSTRAINT "keyword_hits_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_triggers" ADD CONSTRAINT "keyword_triggers_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_triggers" ADD CONSTRAINT "keyword_triggers_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_triggers" ADD CONSTRAINT "keyword_triggers_apply_tag_id_tags_id_fk" FOREIGN KEY ("apply_tag_id") REFERENCES "public"."tags"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_events" ADD CONSTRAINT "moderation_events_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_events" ADD CONSTRAINT "moderation_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_events" ADD CONSTRAINT "moderation_events_rule_id_moderation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."moderation_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_rules" ADD CONSTRAINT "moderation_rules_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_rules" ADD CONSTRAINT "moderation_rules_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "welcome_configs" ADD CONSTRAINT "welcome_configs_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_targets_uq" ON "broadcast_targets" USING btree ("broadcast_id","group_id");--> statement-breakpoint
CREATE INDEX "broadcast_targets_pending_idx" ON "broadcast_targets" USING btree ("broadcast_id","status");--> statement-breakpoint
CREATE INDEX "broadcasts_status_scheduled_idx" ON "broadcasts" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_jid_uq" ON "contacts" USING btree ("jid");--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_uq" ON "group_members" USING btree ("group_id","contact_id");--> statement-breakpoint
CREATE INDEX "group_members_group_idx" ON "group_members" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "group_members_contact_idx" ON "group_members" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_instance_jid_uq" ON "groups" USING btree ("instance_id","jid");--> statement-breakpoint
CREATE INDEX "groups_instance_idx" ON "groups" USING btree ("instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "instances_evolution_name_uq" ON "instances" USING btree ("evolution_name");--> statement-breakpoint
CREATE INDEX "keyword_hits_trigger_contact_idx" ON "keyword_hits" USING btree ("trigger_id","contact_id","created_at");--> statement-breakpoint
CREATE INDEX "keyword_hits_created_idx" ON "keyword_hits" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "keyword_triggers_instance_idx" ON "keyword_triggers" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "keyword_triggers_group_idx" ON "keyword_triggers" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "message_events_flood_idx" ON "message_events" USING btree ("group_id","contact_id","created_at");--> statement-breakpoint
CREATE INDEX "message_events_created_idx" ON "message_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_events_msg_uq" ON "message_events" USING btree ("group_id","message_id");--> statement-breakpoint
CREATE INDEX "moderation_events_group_idx" ON "moderation_events" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_events_contact_idx" ON "moderation_events" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "moderation_rules_instance_idx" ON "moderation_rules" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "moderation_rules_group_idx" ON "moderation_rules" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_uq" ON "tags" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_dedupe_uq" ON "webhook_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "webhook_events_created_idx" ON "webhook_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "welcome_configs_group_uq" ON "welcome_configs" USING btree ("group_id");