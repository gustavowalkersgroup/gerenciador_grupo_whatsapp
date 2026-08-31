"use client";

/**
 * Tudo que precisa de estado no browser da rota /moderação: o formulário que
 * troca de campos conforme o tipo da regra e os botões de ação da lista.
 */

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import {
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import {
  defaultWarnTemplate,
  type ModerationAction,
  type ModerationKind,
} from "@/lib/domain/moderation";
import {
  alternarRegra,
  excluirRegra,
  salvarRegra,
  verificarAdmin,
  type ActionState,
} from "./actions";

const TIPOS: { value: ModerationKind; label: string }[] = [
  { value: "anti_link", label: "Anti-link" },
  { value: "banned_words", label: "Palavras proibidas" },
  { value: "anti_flood", label: "Anti-flood" },
  { value: "anti_media", label: "Anti-mídia" },
  { value: "only_admins", label: "Somente admins" },
];

const ACOES: { value: ModerationAction; label: string }[] = [
  { value: "warn", label: "Só avisar no grupo" },
  { value: "delete", label: "Apagar a mensagem" },
  { value: "delete_and_warn", label: "Apagar e avisar" },
  { value: "remove", label: "Remover do grupo" },
];

const TIPOS_MIDIA: { value: string; label: string }[] = [
  { value: "imageMessage", label: "Imagem" },
  { value: "videoMessage", label: "Vídeo" },
  { value: "audioMessage", label: "Áudio" },
  { value: "documentMessage", label: "Documento" },
  { value: "stickerMessage", label: "Figurinha" },
];

export interface RegraInicial {
  id: string;
  kind: ModerationKind;
  action: ModerationAction;
  removeAtStrikes: number;
  exemptAdmins: boolean;
  enabled: boolean;
  warnTemplate: string;
  groupId: string;
  allowDomains: string;
  onlyWhatsAppInvites: boolean;
  words: string;
  maxMessages: number;
  windowSeconds: number;
  blockedTypes: string[];
  quietFrom: string;
  quietTo: string;
}

export interface GrupoOpcao {
  id: string;
  nome: string;
  gerenciado: boolean;
}

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
 * Formulário
 * ------------------------------------------------------------------ */

export function FormRegra({
  instanceId,
  grupos,
  inicial,
}: {
  instanceId: string;
  grupos: GrupoOpcao[];
  inicial: RegraInicial | null;
}) {
  const [estado, formAction, pendente] = useActionState<ActionState, FormData>(salvarRegra, {});
  const [kind, setKind] = useState<ModerationKind>(inicial?.kind ?? "anti_link");
  const [acao, setAcao] = useState<ModerationAction>(inicial?.action ?? "delete_and_warn");
  const [groupId, setGroupId] = useState(inicial?.groupId ?? "");

  const editando = Boolean(inicial);
  const avisaAlguem = acao === "warn" || acao === "delete_and_warn";

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="instanceId" value={instanceId} />
      {inicial && <input type="hidden" name="id" value={inicial.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo de regra" hint="Os campos abaixo mudam conforme o tipo.">
          <Select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as ModerationKind)}
          >
            {TIPOS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Escopo"
          hint={
            groupId
              ? "Regra de grupo: sobrescreve a global do mesmo tipo neste grupo."
              : "Vale em todos os grupos gerenciados deste número."
          }
        >
          <Select name="groupId" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">Instância inteira (global)</option>
            {grupos.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nome || "(sem nome)"}
                {g.gerenciado ? "" : " — não gerenciado"}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {kind === "anti_link" && <CamposAntiLink inicial={inicial} />}
      {kind === "banned_words" && <CamposPalavras inicial={inicial} />}
      {kind === "anti_flood" && <CamposFlood inicial={inicial} />}
      {kind === "anti_media" && <CamposMidia inicial={inicial} />}
      {kind === "only_admins" && <CamposSomenteAdmins inicial={inicial} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ação" hint="O motor aplica só a ação mais severa por mensagem.">
          <Select
            name="action"
            value={acao}
            onChange={(e) => setAcao(e.target.value as ModerationAction)}
          >
            {ACOES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Remover ao chegar em X strikes"
          hint="0 = nunca remove automaticamente. Só conta strike quando a ação avisa ou remove."
        >
          <Input
            name="removeAtStrikes"
            type="number"
            min={0}
            max={20}
            defaultValue={inicial?.removeAtStrikes ?? 3}
          />
        </Field>
      </div>

      <Field
        label="Template do aviso"
        hint="Variáveis: {{nome}}, {{grupo}}, {{strikes}}, {{limite}}, {{motivo}}. Em branco usa o texto padrão do tipo."
      >
        <Textarea
          name="warnTemplate"
          defaultValue={inicial?.warnTemplate ?? ""}
          placeholder={defaultWarnTemplate(kind)}
        />
      </Field>

      {!avisaAlguem && (
        <p className="text-xs text-muted">
          Com a ação escolhida o aviso não é enviado — o template fica guardado para quando você
          voltar a avisar.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Checkbox
          label="Isentar administradores do grupo"
          name="exemptAdmins"
          defaultChecked={inicial?.exemptAdmins ?? true}
        />
        <Checkbox label="Regra ativa" name="enabled" defaultChecked={inicial?.enabled ?? true} />
      </div>

      {estado.error && <Alert tone="danger">{estado.error}</Alert>}
      {estado.ok && <Alert tone="accent">{estado.ok}</Alert>}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pendente}>
          {pendente ? "Salvando…" : editando ? "Salvar alterações" : "Criar regra"}
        </Button>
        {editando && (
          <Link
            href={`/moderacao?instancia=${instanceId}#regra`}
            className="text-xs text-muted underline hover:text-text"
          >
            Cancelar edição
          </Link>
        )}
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Campos por tipo
 * ------------------------------------------------------------------ */

function CamposAntiLink({ inicial }: { inicial: RegraInicial | null }) {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface-2 p-4">
      <Field
        label="Domínios liberados"
        hint="Um por linha, sem http. Ex.: minhaloja.com.br. Subdomínios entram junto."
      >
        <Textarea
          name="allowDomains"
          defaultValue={inicial?.allowDomains ?? ""}
          placeholder={"minhaloja.com.br\ninstagram.com"}
        />
      </Field>
      <Checkbox
        label="Bloquear apenas convite de outro grupo (chat.whatsapp.com)"
        name="onlyWhatsAppInvites"
        defaultChecked={inicial?.onlyWhatsAppInvites ?? false}
      />
      <p className="text-xs text-muted">
        Com essa opção marcada os demais links passam e a lista de domínios é ignorada.
      </p>
    </div>
  );
}

function CamposPalavras({ inicial }: { inicial: RegraInicial | null }) {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface-2 p-4">
      <Field
        label="Palavras proibidas"
        hint="Uma por linha. A comparação ignora acento, maiúscula e pontuação, e respeita limite de palavra."
      >
        <Textarea
          name="words"
          defaultValue={inicial?.words ?? ""}
          placeholder={"golpe\npix garantido"}
        />
      </Field>
    </div>
  );
}

function CamposFlood({ inicial }: { inicial: RegraInicial | null }) {
  return (
    <div className="grid gap-4 rounded-lg border border-border bg-surface-2 p-4 sm:grid-cols-2">
      <Field label="Máximo de mensagens" hint="Acima disso dentro da janela vira violação.">
        <Input
          name="maxMessages"
          type="number"
          min={1}
          max={100}
          defaultValue={inicial?.maxMessages ?? 5}
        />
      </Field>
      <Field label="Janela (segundos)" hint="Período contado para trás a cada mensagem nova.">
        <Input
          name="windowSeconds"
          type="number"
          min={1}
          max={3600}
          defaultValue={inicial?.windowSeconds ?? 10}
        />
      </Field>
    </div>
  );
}

function CamposMidia({ inicial }: { inicial: RegraInicial | null }) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-2 p-4">
      <Field
        label="Tipos bloqueados"
        hint="Segure Ctrl (ou Cmd) para escolher mais de um. Nenhum selecionado bloqueia toda mídia."
      >
        <Select
          name="blockedTypes"
          multiple
          size={5}
          defaultValue={inicial?.blockedTypes ?? []}
          className="h-auto py-1"
        >
          {TIPOS_MIDIA.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

function CamposSomenteAdmins({ inicial }: { inicial: RegraInicial | null }) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-2 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Horário inicial (HH:MM)" hint="Começo da janela em que só admin fala.">
          <Input name="quietFrom" type="time" defaultValue={inicial?.quietFrom ?? ""} />
        </Field>
        <Field label="Horário final (HH:MM)" hint="Fim da janela, no horário do servidor.">
          <Input name="quietTo" type="time" defaultValue={inicial?.quietTo ?? ""} />
        </Field>
      </div>
      <p className="text-xs text-muted">
        Janela em branco fecha o grupo o tempo todo. A janela pode cruzar a meia-noite: 22:00 às
        07:00 vale da noite até a manhã seguinte.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Ações da lista
 * ------------------------------------------------------------------ */

export function AcoesRegra({
  ruleId,
  ativa,
  descricao,
  editarHref,
}: {
  ruleId: string;
  ativa: boolean;
  descricao: string;
  editarHref: string;
}) {
  const { pendente, estado, executar } = useAcao();

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-1">
        <Link
          href={editarHref}
          className="inline-flex items-center rounded-lg px-2 py-1 text-xs font-medium text-muted transition hover:text-text"
        >
          Editar
        </Link>
        <Button
          type="button"
          variant="ghost"
          className="px-2 py-1 text-xs"
          disabled={pendente}
          onClick={() => executar(() => alternarRegra(ruleId, !ativa))}
        >
          {ativa ? "Desativar" : "Ativar"}
        </Button>
        <Button
          type="button"
          variant="danger"
          className="px-2 py-1 text-xs"
          disabled={pendente}
          onClick={() => {
            if (!confirm(`Excluir a regra ${descricao}? Não dá pra desfazer.`)) return;
            executar(() => excluirRegra(ruleId));
          }}
        >
          Excluir
        </Button>
      </div>
      <Retorno estado={estado} />
    </div>
  );
}

export function BotaoVerificarAdmin({ groupId, nome }: { groupId: string; nome: string }) {
  const { pendente, estado, executar } = useAcao();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-text">{nome || "(sem nome)"}</span>
      <Button
        type="button"
        variant="secondary"
        className="px-2 py-1 text-xs"
        disabled={pendente}
        onClick={() => executar(() => verificarAdmin(groupId))}
      >
        {pendente ? "Verificando…" : "Verificar admin"}
      </Button>
      <Retorno estado={estado} />
    </div>
  );
}
