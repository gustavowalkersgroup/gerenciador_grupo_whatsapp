import { Nav } from "@/components/nav";
import { requireUser } from "@/lib/auth/guard";
import { signOut } from "@/app/entrar/actions";

const NAV = [
  { href: "/", label: "Visão geral" },
  { href: "/instancias", label: "Números" },
  { href: "/grupos", label: "Grupos" },
  { href: "/moderacao", label: "Moderação" },
  { href: "/palavras-chave", label: "Palavras-chave" },
  { href: "/disparos", label: "Disparos" },
  { href: "/contatos", label: "Contatos" },
  { href: "/relatorios", label: "Relatórios" },
];

export default async function PainelLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="border-b border-border bg-surface lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2 px-5 py-4">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-ink">
            G
          </span>
          <span className="text-sm font-semibold">Gerenciador</span>
        </div>

        <Nav items={NAV} />

        <div className="hidden border-t border-border px-5 py-4 lg:block">
          <p className="truncate text-xs text-muted">{user.name ?? user.email}</p>
          <form action={signOut}>
            <button type="submit" className="mt-2 text-xs text-muted underline hover:text-danger">
              Sair
            </button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-5 py-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
