import { redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "./session";

/** Toda página do painel passa por aqui antes de tocar em dado. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/entrar");
  return user;
}
