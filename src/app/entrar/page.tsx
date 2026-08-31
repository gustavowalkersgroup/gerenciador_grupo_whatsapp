import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { hasAnyUser } from "./actions";
import { LoginForm } from "./form";

export const dynamic = "force-dynamic";

export default async function EntrarPage() {
  if (await getSessionUser()) redirect("/");
  const firstRun = !(await hasAnyUser());

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-accent text-lg font-bold text-accent-ink">
            G
          </div>
          <h1 className="text-lg font-semibold">Gerenciador de Grupos</h1>
          <p className="mt-1 text-sm text-muted">Moderação, captura e disparo no WhatsApp</p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-6">
          <LoginForm firstRun={firstRun} />
        </div>
      </div>
    </main>
  );
}
