"use client";

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
  alternarGatilho,
  duplicarGatilho,
  excluirGatilho,
  salvarGatilho,
  type EstadoGatilho,
} from "./actions";

export interface OpcaoSimples {
  id: string;
  nome: string;
}

export interface GatilhoInicial {
  id: string;
  name: string;
  groupId: string;
  keywords: string;
  requiredAll: string;
  negativeKeywords: string;
  mode: string;
  priority: number;
  dmTemplate: string;
  dmMediaUrl: string;
  dmMediaType: string;
  replyInGroup: boolean;
  groupReplyTemplate: string;
  cooldownMinutes: number;
  dailyLimit: number;
  applyTagId: string;
  enabled: boolean;
}

/**
 * Placeholder que espelha a regra que realmente funciona: a parte que varia
 * ("44") fica nas palavras-chave e o produto ("sapato") em "precisa conter
 * todas". Assim "quero sapato x 44" bate, e "vendo sapato 44" não.
 */
const EXEMPLO = {
  name: "Interesse em sapato 44",
  keywords: "44\nquarenta e quatro\ntam 44",
  requiredAll: "sapato",
  negativeKeywords: "vendo\nrevenda\nbrincadeira",
  dmTemplate:
    'Oi {{nome}}! Vi sua mensagem no grupo {{grupo}}: "{{mensagem}}".\nTemos sapato 44 pronta-entrega. Quer que eu te mande as fotos?',
  groupReplyTemplate: "{{nome}}, te chamei no seu privado com as opções 👟",
};

const VAZIO: GatilhoInicial = {
  id: "",
  name: "",
  groupId: "",
  keywords: "",
  requiredAll: "",
  negativeKeywords: "",
  mode: "contains",
  priority: 0,
  dmTemplate: "",
  dmMediaUrl: "",
  dmMediaType: "image",
  replyInGroup: false,
  groupReplyTemplate: "",
  cooldownMinutes: 1440,
  dailyLimit: 100,
  applyTagId: "",
  enabled: true,
};

const AJUDA_MODO: Record<string, string> = {
  contains: "Dispara se a frase contiver a palavra inteira (44 não bate em 444).",
  exact: "Dispara só se a mensagem for exatamente igual ao termo.",
  starts_with: "Dispara se a mensagem começar com o termo.",
  regex: "Cada linha vira uma expressão regular. Poder total, risco total.",
};

export function FormGatilho({
  instanceId,
  grupos,
  etiquetas,
  inicial,
}: {
  instanceId: string;
  grupos: OpcaoSimples[];
  etiquetas: OpcaoSimples[];
  inicial?: GatilhoInicial;
}) {
  const dados = inicial ?? VAZIO;
  const editando = Boolean(inicial);

  const [estado, formAction, pendente] = useActionState<EstadoGatilho, FormData>(
    salvarGatilho,
    {},
  );

  // Criou: a chave muda, o bloco de campos remonta zerado e o operador já
  // emenda o próximo gatilho. Em caso de erro a chave não muda e o que ele
  // digitou continua na tela.
  const chaveCampos = !editando && estado.ok ? `criado-${estado.at}` : "campos";

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="id" value={dados.id} />
      <input type="hidden" name="instanceId" value={instanceId} />

      <CamposGatilho key={chaveCampos} dados={dados} grupos={grupos} etiquetas={etiquetas} />

      {estado.error && <Alert tone="danger">{estado.error}</Alert>}
      {estado.ok && <Alert tone="accent">{estado.ok}</Alert>}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pendente}>
          {pendente ? "Salvando…" : editando ? "Salvar alterações" : "Criar gatilho"}
        </Button>
        {editando && (
          <Link
            href="/palavras-chave"
            className="rounded-lg px-3 py-2 text-sm text-muted transition hover:text-text"
          >
            Cancelar edição
          </Link>
        )}
      </div>
    </form>
  );
}

function CamposGatilho({
  dados,
  grupos,
  etiquetas,
}: {
  dados: GatilhoInicial;
  grupos: OpcaoSimples[];
  etiquetas: OpcaoSimples[];
}) {
  const [modo, setModo] = useState(dados.mode);
  const [respondeNoGrupo, setRespondeNoGrupo] = useState(dados.replyInGroup);
  const [etiqueta, setEtiqueta] = useState(dados.applyTagId);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome do gatilho" hint="Só aparece aqui no painel.">
          <Input name="name" defaultValue={dados.name} placeholder={EXEMPLO.name} maxLength={120} />
        </Field>

        <Field label="Onde vale" hint="Um gatilho de grupo específico não roda nos outros.">
          <Select name="groupId" defaultValue={dados.groupId}>
            <option value="">Todos os grupos deste número</option>
            {grupos.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nome}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Field
          label="Palavras-chave (uma por linha)"
          hint="Basta uma bater. Deixe aqui a parte que varia (44, 42) e o produto no campo ao lado."
        >
          <Textarea name="keywords" defaultValue={dados.keywords} placeholder={EXEMPLO.keywords} />
        </Field>

        <Field
          label="Precisa conter todas (uma por linha)"
          hint="Filtro extra: todas precisam aparecer. Sempre por palavra inteira."
        >
          <Textarea
            name="requiredAll"
            defaultValue={dados.requiredAll}
            placeholder={EXEMPLO.requiredAll}
          />
        </Field>

        <Field
          label="Nunca disparar se contiver (uma por linha)"
          hint="Corta falso positivo — quem está vendendo, não comprando."
        >
          <Textarea
            name="negativeKeywords"
            defaultValue={dados.negativeKeywords}
            placeholder={EXEMPLO.negativeKeywords}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Modo de comparação" hint={AJUDA_MODO[modo] ?? ""}>
          <Select name="mode" value={modo} onChange={(e) => setModo(e.target.value)}>
            <option value="contains">Contém a palavra</option>
            <option value="exact">Mensagem exata</option>
            <option value="starts_with">Começa com</option>
            <option value="regex">Expressão regular</option>
          </Select>
        </Field>

        <Field
          label="Prioridade"
          hint="Quando dois gatilhos batem, só o de maior prioridade envia."
        >
          <Input
            name="priority"
            type="number"
            min={-100}
            max={100}
            defaultValue={dados.priority}
          />
        </Field>
      </div>

      <Field
        label="Mensagem enviada no privado"
        hint="Variáveis: {{nome}}, {{grupo}}, {{mensagem}}, {{match}}"
      >
        <Textarea
          name="dmTemplate"
          defaultValue={dados.dmTemplate}
          placeholder={EXEMPLO.dmTemplate}
          className="min-h-32"
          maxLength={4000}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="URL da mídia (opcional)" hint="A mensagem vira legenda da mídia.">
          <Input
            name="dmMediaUrl"
            type="url"
            defaultValue={dados.dmMediaUrl}
            placeholder="https://…/catalogo-sapato-44.jpg"
          />
        </Field>

        <Field label="Tipo da mídia">
          <Select name="dmMediaType" defaultValue={dados.dmMediaType || "image"}>
            <option value="image">Imagem</option>
            <option value="video">Vídeo</option>
            <option value="document">Documento</option>
          </Select>
        </Field>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-surface-2 px-4 py-3">
        <Checkbox
          label="Responder também no grupo, mencionando a pessoa"
          name="replyInGroup"
          checked={respondeNoGrupo}
          onChange={(e) => setRespondeNoGrupo(e.target.checked)}
        />
        {respondeNoGrupo && (
          <Field label="Texto da resposta no grupo" hint="Aceita as mesmas variáveis.">
            <Textarea
              name="groupReplyTemplate"
              defaultValue={dados.groupReplyTemplate}
              placeholder={EXEMPLO.groupReplyTemplate}
              className="min-h-16"
            />
          </Field>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="Cooldown (minutos)"
          hint="Mesma pessoa não recebe de novo antes disso. 0 desliga."
        >
          <Input
            name="cooldownMinutes"
            type="number"
            min={0}
            max={43200}
            defaultValue={dados.cooldownMinutes}
          />
        </Field>

        <Field label="Teto diário deste gatilho" hint="0 = sem teto próprio (o do número continua).">
          <Input name="dailyLimit" type="number" min={0} max={10000} defaultValue={dados.dailyLimit} />
        </Field>

        <Field label="Etiqueta aplicada ao contato" hint="É o que transforma a captura em lista de lead.">
          <Select name="applyTagId" value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)}>
            <option value="">Nenhuma</option>
            {etiquetas.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
            <option value="__nova__">+ Criar nova etiqueta…</option>
          </Select>
        </Field>
      </div>

      {etiqueta === "__nova__" && (
        <Field label="Nome da nova etiqueta">
          <Input name="novaEtiqueta" placeholder="Lead sapato 44" maxLength={60} />
        </Field>
      )}

      <Checkbox label="Gatilho ativo" name="enabled" defaultChecked={dados.enabled} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Ações da lista
 * ------------------------------------------------------------------ */

export function AcoesGatilho({
  id,
  nome,
  ativo,
}: {
  id: string;
  nome: string;
  ativo: boolean;
}) {
  const [pendente, iniciar] = useTransition();
  const [estado, setEstado] = useState<EstadoGatilho>({});

  // Server Action nunca deve derrubar a tela — a falha vira texto na linha.
  const executar = (fn: () => Promise<EstadoGatilho>) => {
    setEstado({});
    iniciar(async () => {
      try {
        setEstado(await fn());
      } catch {
        setEstado({ error: "Falha inesperada. Tente de novo." });
      }
    });
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-1">
        <Button
          type="button"
          variant="ghost"
          className="px-2 py-1 text-xs"
          disabled={pendente}
          onClick={() => executar(() => alternarGatilho(id, !ativo))}
        >
          {ativo ? "Desativar" : "Ativar"}
        </Button>
        <Link
          href={`/palavras-chave?editar=${id}#formulario`}
          className="rounded-lg px-2 py-1 text-xs font-medium text-muted transition hover:text-text"
        >
          Editar
        </Link>
        <Button
          type="button"
          variant="ghost"
          className="px-2 py-1 text-xs"
          disabled={pendente}
          onClick={() => executar(() => duplicarGatilho(id))}
        >
          Duplicar
        </Button>
        <Button
          type="button"
          variant="danger"
          className="px-2 py-1 text-xs"
          disabled={pendente}
          onClick={() => {
            if (!confirm(`Excluir "${nome}"? O histórico de disparos dele some junto.`)) return;
            executar(() => excluirGatilho(id));
          }}
        >
          Excluir
        </Button>
      </div>
      {estado.error && <p className="text-xs text-danger">{estado.error}</p>}
      {estado.ok && <p className="text-xs text-accent">{estado.ok}</p>}
    </div>
  );
}
