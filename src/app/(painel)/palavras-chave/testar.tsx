"use client";

import { useActionState } from "react";
import { Alert, Badge, Button, Empty, Field, Select, Table, Td, Textarea } from "@/components/ui";
import { testarFrase, type EstadoTeste } from "./actions";
import type { OpcaoSimples } from "./gatilho-form";

const MODO: Record<string, string> = {
  contains: "contém",
  exact: "exata",
  starts_with: "começa com",
  regex: "regex",
};

export function TestarFrase({
  instanceId,
  grupos,
}: {
  instanceId: string;
  grupos: OpcaoSimples[];
}) {
  const [estado, formAction, pendente] = useActionState<EstadoTeste, FormData>(testarFrase, {});

  const resultados = estado.resultados ?? [];
  const vencedor = resultados.find((r) => r.dispararia);

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="instanceId" value={instanceId} />

        <Field
          label="Frase de teste"
          hint="Escreva como uma pessoa escreveria no grupo. Nada é enviado."
        >
          <Textarea
            name="frase"
            defaultValue={estado.frase ?? ""}
            placeholder="quero sapato x 44"
            className="min-h-16"
            maxLength={2000}
          />
        </Field>

        {grupos.length > 0 && (
          <Field
            label="Simular em qual grupo"
            hint="Muda o resultado: gatilho preso a um grupo não vale nos outros."
          >
            <Select name="grupoId" defaultValue={estado.grupoId ?? ""}>
              <option value="">Qualquer grupo</option>
              {grupos.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nome}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Button type="submit" variant="secondary" disabled={pendente}>
          {pendente ? "Testando…" : "Testar sem enviar"}
        </Button>
      </form>

      {estado.error && <Alert tone="danger">{estado.error}</Alert>}

      {estado.at !== undefined && !estado.error && (
        <>
          {vencedor ? (
            <Alert tone="accent" title="Dispararia">
              <strong>{vencedor.nome}</strong> — casou com{" "}
              <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{vencedor.termo}</code>.
              Só esse envia: quando vários gatilhos batem, o sistema manda apenas um privado.
            </Alert>
          ) : (
            <Alert tone="warn" title="Nenhum privado sairia">
              {resultados.length > 0
                ? "Há gatilhos que casam, mas nenhum está ativo e dentro do escopo escolhido."
                : "Nenhum gatilho casou com essa frase."}
            </Alert>
          )}

          {resultados.length === 0 ? (
            <Empty
              title="Sem correspondência"
              hint="Confira acentos, o modo de comparação e as palavras negativas."
            />
          ) : (
            <Table head={["Gatilho", "Termo que casou", "Modo", "Escopo", "Situação"]}>
              {resultados.map((r) => (
                <tr key={r.id} className={r.dispararia ? "bg-accent/5" : undefined}>
                  <Td className="font-medium">{r.nome}</Td>
                  <Td>
                    <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{r.termo}</code>
                  </Td>
                  <Td className="text-muted">{MODO[r.modo] ?? r.modo}</Td>
                  <Td className="text-muted">{r.escopo}</Td>
                  <Td>
                    {r.dispararia ? (
                      <Badge tone="accent">envia o privado</Badge>
                    ) : !r.ativo ? (
                      <Badge tone="neutral">desativado</Badge>
                    ) : !r.noEscopo ? (
                      <Badge tone="neutral">fora do grupo escolhido</Badge>
                    ) : (
                      <Badge tone="warn">perdeu na prioridade</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}
    </div>
  );
}
