"use server";

import { count, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";

export interface FormState {
  error?: string;
}

const credentials = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(8, "A senha precisa de pelo menos 8 caracteres"),
});

export async function hasAnyUser(): Promise<boolean> {
  const [row] = await db.select({ n: count() }).from(users);
  return (row?.n ?? 0) > 0;
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${parsed.data.email})`)
    .limit(1);

  // Mesma mensagem para e-mail inexistente e senha errada — não entregamos
  // quais e-mails estão cadastrados.
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return { error: "E-mail ou senha incorretos." };
  }

  await createSession(user.id);
  redirect("/");
}

/** Primeiro acesso: só funciona enquanto não existir nenhum usuário. */
export async function createFirstUser(_prev: FormState, formData: FormData): Promise<FormState> {
  if (await hasAnyUser()) {
    return { error: "Já existe um usuário cadastrado. Faça login." };
  }

  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const name = String(formData.get("name") ?? "").trim() || null;

  const [user] = await db
    .insert(users)
    .values({
      email: parsed.data.email.toLowerCase(),
      name,
      passwordHash: await hashPassword(parsed.data.password),
      role: "owner",
    })
    .onConflictDoNothing()
    .returning();

  if (!user) return { error: "Não foi possível criar o usuário." };

  await createSession(user.id);
  redirect("/");
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect("/entrar");
}

export async function deleteUser(id: string): Promise<void> {
  await db.delete(users).where(eq(users.id, id));
}
