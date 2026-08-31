"use client";

/**
 * Todos os pedaços interativos da rota /grupos moram aqui: o painel é
 * server-side por padrão e só estes trechos precisam de estado no browser.
 */

import { useActionState, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import {
  acaoMembro,
  alterarConfiguracao,
  alternarGerenciado,
  buscarConvite,
  revogarConvite,
  salvarBoasVindas,
  sincronizarGrupos,
  type ActionState,
} from "./actions";

/** Server Action nunca deve derrubar a tela — o erro vira texto abaixo do botão. */
function useAcao() {
  const [pendente, iniciar] = useTransition();
  const [estado, setEstado] = useState<ActionState>({});

  const executar = (fn: () => Promise<ActionState>) => {
    setEstado({});
    iniciar(async () => {
      try {
        setEstado(await fn());
      } catch {
        setEstado({ error: "Falha inesperada. Tente de novo." });
      }
    });
  };

  return { pendente, estado, executar };
}

function Retorno({ estado }: { estado: ActionState }) {
  if (estado.error) return <p className="text-xs text-danger">{estado.error}</p>;
  if (estado.ok) return <p className="text-xs text-accent">{estado.ok}</p>;
  return null;
}

/* ------------------------------------------------------------------ *
 * Lista
 * ------------------------------------------------------------------ */

export function FiltrosGrupos({
  instancias,
  instanciaId,
  busca,
  somenteGerenciados,
}: {
  instancias: { id: string; label: string }[];
  instanciaId: string;
  busca: string;
  somenteGerenciados: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [texto, setTexto] = useState(busca);

  const aplicar = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [chave, valor] of Object.entries(patch)) {
      if (valor) params.set(chave, valor);
      else params.delete(chave);
    }
    const query = params.toString();
    router.replace(query ? `/grupos?${query}` : "/grupos");
  };

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        aplicar({ q: texto.trim() || null });
      }}
    >
      {instancias.length > 1 && (
        <Field label="Número" className="w-56">
          <Select
            value={instanciaId}
            onChange={(e) => aplicar({ instancia: e.target.value })}
            aria-label="Número da instância"
          >
            {instancias.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field label="Buscar" className="w-64">
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Nome do grupo"
        />
      </Field>

      <div className="flex items-center gap-3 pb-2">
        <Checkbox
          label="Somente gerenciados"
          checked={somenteGerenciados}
          onChange={(e) => aplicar({ gerenciados: e.target.checked ? "1" : null })}
        />
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
      </div>
    </form>
  );
}

export function BotaoSincronizar({ instanceId }: { instanceId: string }) {
  const { pendente, estado, executar } = useAcao();

  return (
    <div className="text-right">
      <Button
        type="button"
        disabled={pendente}
        onClick={() => executar(() => sincronizarGrupos(instanceId))}
      >
        {pendente ? "Sincronizando…" : "Sincronizar grupos"}
      </Button>
      <div className="mt-1 max-w-xs">
        <Retorno estado={estado} />
      </div>
    </div>
  );
}

export function ToggleGerenciado({
  groupId,
  gerenciado,
  nome,
}: {
  groupId: string;
  gerenciado: boolean;
  nome: string;
}) {
  const { pendente, estado, executar } = useAcao();

  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={gerenciado}
        aria-label={`Gerenciar ${nome}`}
        disabled={pendente}
        onClick={() => executar(() => alternarGerenciado(groupId, !gerenciado))}
        className={`inline-flex h-5 w-9 items-center rounded-full border p-0.5 transition disabled:opacity-50 ${
          gerenciado ? "border-accent/60 bg-accent/20" : "border-border bg-surface-2"
        }`}
      >
        <span
          className={`size-3.5 rounded-full transition ${
            gerenciado ? "translate-x-4 bg-accent" : "bg-muted"
          }`}
        />
      </button>
      {estado.error && <p className="mt-1 text-xs text-danger">{estado.error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Detalhe
 * ------------------------------------------------------------------ */

export function PainelConvite({
  groupId,
  inviteCode,
}: {
  groupId: string;
  inviteCode: string | null;
}) {
  const { pendente, estado, executar } = useAcao();
  const url = inviteCode ? `https://chat.whatsapp.com/${inviteCode}` : null;

  return (
    <div className="space-y-3">
      {url ? (
        <p className="break-all rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs">
          {url}
        </p>
      ) : (
        <p className="text-sm text-muted">
          Nenhum link salvo ainda. Busque o convite para gerar a URL.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={pendente}
          onClick={() => executar(() => buscarConvite(groupId))}
        >
          {inviteCode ? "Atualizar link" : "Buscar link"}
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={pendente}
          onClick={() => {
            if (!confirm("Revogar o link atual? Quem já tem o link perde o acesso.")) return;
            executar(() => revogarConvite(groupId));
          }}
        >
          Revogar link
        </Button>
      </div>

      <Retorno estado={estado} />
    </div>
  );
}

export function ConfiguracoesGrupo({ groupId }: { groupId: string }) {
  const { pendente, estado, executar } = useAcao();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={pendente}
          onClick={() => executar(() => alterarConfiguracao(groupId, "announcement"))}
        >
          Fechar grupo (só admin fala)
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pendente}
          onClick={() => executar(() => alterarConfiguracao(groupId, "not_announcement"))}
        >
          Abrir grupo
        </Button>
      </div>
      <Retorno estado={estado} />
    </div>
  );
}

export interface BoasVindasIniciais {
  enabled: boolean;
  template: string;
  sendAsDm: boolean;
  mentionMember: boolean;
  delaySeconds: number;
  farewellTemplate: string;
  mediaUrl: string;
}

export function FormBoasVindas({
  groupId,
  inicial,
}: {
  groupId: string;
  inicial: BoasVindasIniciais;
}) {
  const [estado, formAction, pendente] = useActionState<ActionState, FormData>(salvarBoasVindas, {});

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="groupId" value={groupId} />

      <Checkbox label="Boas-vindas ativas" name="enabled" defaultChecked={inicial.enabled} />

      <Field
        label="Mensagem de boas-vindas"
        hint="Variáveis: {{nome}}, {{grupo}}, {{numero}}"
      >
        <Textarea
          name="template"
          defaultValue={inicial.template}
          placeholder="Oi {{nome}}, bem-vindo(a) ao {{grupo}}! Qualquer dúvida é só chamar."
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Checkbox
          label="Enviar no privado"
          name="sendAsDm"
          defaultChecked={inicial.sendAsDm}
        />
        <Checkbox
          label="Mencionar o membro no grupo"
          name="mentionMember"
          defaultChecked={inicial.mentionMember}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Atraso (segundos)" hint="Esperar um pouco parece mais humano.">
          <Input
            name="delaySeconds"
            type="number"
            min={0}
            max={60}
            defaultValue={inicial.delaySeconds}
          />
        </Field>
        <Field label="URL de mídia" hint="Opcional: imagem enviada junto da mensagem.">
          <Input
            name="mediaUrl"
            type="url"
            defaultValue={inicial.mediaUrl}
            placeholder="https://…"
          />
        </Field>
      </div>

      <Field
        label="Mensagem de despedida"
        hint="Opcional, enviada no grupo quando alguém sai. Aceita as mesmas variáveis."
      >
        <Textarea
          name="farewellTemplate"
          defaultValue={inicial.farewellTemplate}
          placeholder="{{nome}} saiu do grupo."
        />
      </Field>

      {estado.error && <Alert tone="danger">{estado.error}</Alert>}
      {estado.ok && <Alert tone="accent">{estado.ok}</Alert>}

      <Button type="submit" disabled={pendente}>
        {pendente ? "Salvando…" : "Salvar boas-vindas"}
      </Button>
    </form>
  );
}

export function AcoesMembro({
  groupId,
  memberId,
  nome,
  isAdmin,
}: {
  groupId: string;
  memberId: string;
  nome: string;
  isAdmin: boolean;
}) {
  const { pendente, estado, executar } = useAcao();

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-1">
        {isAdmin ? (
          <Button
            type="button"
            variant="ghost"
            className="px-2 py-1 text-xs"
            disabled={pendente}
            onClick={() => executar(() => acaoMembro(groupId, memberId, "demote"))}
          >
            Rebaixar
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            className="px-2 py-1 text-xs"
            disabled={pendente}
            onClick={() => executar(() => acaoMembro(groupId, memberId, "promote"))}
          >
            Promover
          </Button>
        )}
        <Button
          type="button"
          variant="danger"
          className="px-2 py-1 text-xs"
          disabled={pendente}
          onClick={() => {
            if (!confirm(`Remover ${nome} do grupo? Essa ação avisa o grupo no WhatsApp.`)) return;
            executar(() => acaoMembro(groupId, memberId, "remove"));
          }}
        >
          Remover
        </Button>
      </div>
      <Retorno estado={estado} />
    </div>
  );
}
