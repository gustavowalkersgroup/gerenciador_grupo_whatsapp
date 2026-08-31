import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, groupMembers, groups, instances } from "@/lib/db/schema";
import { jidToPhone, normalizeJid } from "@/lib/domain/jid";

export type InstanceRow = typeof instances.$inferSelect;
export type GroupRow = typeof groups.$inferSelect;
export type ContactRow = typeof contacts.$inferSelect;
export type MemberRow = typeof groupMembers.$inferSelect;

export async function findInstanceByName(evolutionName: string): Promise<InstanceRow | null> {
  const [row] = await db
    .select()
    .from(instances)
    .where(eq(instances.evolutionName, evolutionName))
    .limit(1);
  return row ?? null;
}

export async function findGroup(instanceId: string, jid: string): Promise<GroupRow | null> {
  const [row] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.instanceId, instanceId), eq(groups.jid, jid)))
    .limit(1);
  return row ?? null;
}

/**
 * Cria o grupo na primeira vez que ele aparece. Sem isso, um grupo novo em
 * que o número entrou fica invisível até o próximo sync manual.
 */
export async function upsertGroup(
  instanceId: string,
  jid: string,
  patch: Partial<typeof groups.$inferInsert> = {},
): Promise<GroupRow> {
  const [row] = await db
    .insert(groups)
    .values({ instanceId, jid, name: patch.name ?? "", ...patch })
    .onConflictDoUpdate({
      target: [groups.instanceId, groups.jid],
      set: {
        // COALESCE evita apagar o nome quando o evento vem sem ele.
        name: sql`coalesce(nullif(excluded.name, ''), ${groups.name})`,
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.participantsCount !== undefined
          ? { participantsCount: patch.participantsCount }
          : {}),
        ...(patch.botIsAdmin !== undefined ? { botIsAdmin: patch.botIsAdmin } : {}),
        ...(patch.ownerJid !== undefined ? { ownerJid: patch.ownerJid } : {}),
        lastSyncedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function upsertContact(jid: string, pushName?: string | null): Promise<ContactRow> {
  const normalized = normalizeJid(jid);
  const [row] = await db
    .insert(contacts)
    .values({ jid: normalized, phone: jidToPhone(normalized), pushName: pushName ?? null })
    .onConflictDoUpdate({
      target: contacts.jid,
      set: {
        pushName: sql`coalesce(nullif(excluded.push_name, ''), ${contacts.pushName})`,
      },
    })
    .returning();
  return row;
}

export async function upsertMember(
  groupId: string,
  contactId: string,
  patch: Partial<typeof groupMembers.$inferInsert> = {},
): Promise<MemberRow> {
  const [row] = await db
    .insert(groupMembers)
    .values({ groupId, contactId, ...patch })
    .onConflictDoUpdate({
      target: [groupMembers.groupId, groupMembers.contactId],
      set: {
        ...(patch.isAdmin !== undefined ? { isAdmin: patch.isAdmin } : {}),
        leftAt: patch.leftAt !== undefined ? patch.leftAt : null,
      },
    })
    .returning();
  return row;
}

/** Marca saída sem apagar o histórico — o relatório precisa do registro. */
export async function markMemberLeft(groupId: string, contactId: string): Promise<void> {
  await db
    .update(groupMembers)
    .set({ leftAt: new Date() })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.contactId, contactId)));
}

export async function bumpMemberActivity(
  groupId: string,
  contactId: string,
  at: Date,
): Promise<void> {
  await db
    .update(groupMembers)
    .set({
      messageCount: sql`${groupMembers.messageCount} + 1`,
      lastMessageAt: at,
    })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.contactId, contactId)));
}
