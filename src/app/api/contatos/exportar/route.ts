import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { contactTags, contacts } from "@/lib/db/schema";
import { formatPhone } from "@/lib/domain/jid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Teto de segurança: o export roda em uma função serverless com memória curta. */
const LIMITE = 20_000;

const CABECALHO = [
  "nome",
  "telefone",
  "etiquetas",
  "grupos",
  "capturas",
  "opt_out",
  "ultimo_dm",
] as const;

/**
 * Excel interpreta célula iniciada por `=`, `+`, `-` ou `@` como fórmula — e o
 * nome vem do WhatsApp, ou seja, de terceiro. O apóstrofo neutraliza isso e de
 * quebra faz o telefone "+55 …" abrir como texto.
 */
function campo(valor: string | number | null | undefined): string {
  const bruto = valor == null ? "" : String(valor);
  const seguro = /^[=+\-@\t\r]/.test(bruto) ? `'${bruto}` : bruto;
  return /["\r\n,]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

export async function GET(req: Request) {
  // Painel autenticado por cookie: aqui o certo é 401 em vez do redirect do
  // requireUser — senão o navegador salvaria a tela de login como .csv.
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Não autenticado.", { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const busca = (params.get("q") ?? "").trim();
  const etiqueta = z.uuid().safeParse((params.get("etiqueta") ?? "").trim());
  const somenteOptOut = params.get("optout") === "1";

  const filtros: SQL[] = [];
  if (busca) {
    const digitos = busca.replace(/\D/g, "");
    const alternativas: SQL[] = [ilike(contacts.pushName, `%${busca}%`)];
    if (digitos) {
      alternativas.push(ilike(contacts.phone, `%${digitos}%`), ilike(contacts.jid, `%${digitos}%`));
    }
    const combinado = or(...alternativas);
    if (combinado) filtros.push(combinado);
  }
  if (etiqueta.success) {
    filtros.push(
      inArray(
        contacts.id,
        db
          .select({ id: contactTags.contactId })
          .from(contactTags)
          .where(eq(contactTags.tagId, etiqueta.data)),
      ),
    );
  }
  if (somenteOptOut) filtros.push(eq(contacts.optOut, true));

  const linhas = await db
    .select({
      nome: contacts.pushName,
      phone: contacts.phone,
      jid: contacts.jid,
      optOut: contacts.optOut,
      lastDmAt: contacts.lastDmAt,
      // Subconsultas escritas à mão: dentro da lista de seleção o drizzle imprime
      // a coluna sem o nome da tabela, e aí "id" cairia na tabela de dentro.
      etiquetas: sql<string>`(
        select coalesce(string_agg(t.name, ' | ' order by t.name), '')
          from contact_tags ct
          join tags t on t.id = ct.tag_id
         where ct.contact_id = contacts.id
      )`,
      grupos:
        sql<number>`(select count(*) from group_members gm where gm.contact_id = contacts.id and gm.left_at is null)`.mapWith(
          Number,
        ),
      capturas:
        sql<number>`(select count(*) from keyword_hits kh where kh.contact_id = contacts.id and kh.status = 'sent')`.mapWith(
          Number,
        ),
    })
    .from(contacts)
    .where(filtros.length ? and(...filtros) : undefined)
    .orderBy(sql`${contacts.lastDmAt} desc nulls last`, desc(contacts.createdAt))
    .limit(LIMITE);

  const corpo = linhas.map((c) =>
    [
      campo(c.nome),
      campo(formatPhone(c.phone ?? c.jid.split("@")[0])),
      campo(c.etiquetas),
      campo(c.grupos),
      campo(c.capturas),
      campo(c.optOut ? "sim" : "nao"),
      campo(c.lastDmAt ? c.lastDmAt.toLocaleString("pt-BR") : ""),
    ].join(","),
  );

  // BOM na frente pro Excel abrir em UTF-8 e não estragar a acentuação.
  const csv = `\uFEFF${[CABECALHO.join(","), ...corpo].join("\r\n")}\r\n`;

  const dia = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contatos-${dia}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
