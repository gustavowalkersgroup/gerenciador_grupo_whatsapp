"use client";

/**
 * Tudo que precisa de estado no browser na rota /disparos: o formulário de
 * nova campanha (com a estimativa em tempo real) e os botões da lista.
 */

import { useActionState, useMemo, useState, useTransition } from "react";
import { Alert, Badge, Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import {
  cancelarDisparo,
  criarDisparo,
  pausarDisparo,
  reenfileirarFalhados,
  retomarDisparo,
  type ActionState,
} from "./actions";

export interface InstanciaOpcao {
  id: string;
  label: string;
  conectada: boolean;
}

export interface GrupoOpcao {
  id: string;
  instanceId: string;
  nome: string;
  participantes: number;
  tagIds: string[];
}

export interface EtiquetaOpcao {
  id: string;
  nome: string;
  cor: string;
}

const TIPOS = [
  { value: "text", label: "Texto" },
  { value: "image", label: "Imagem" },
  { value: "video", label: "Vídeo" },
  { value: "document", label: "Documento" },
] as const;

type Tipo = (typeof TIPOS)[number]["value"];

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

function duracao(segundos: number): string {
  if (segundos <= 0) return "instantâneo";
  if (segundos < 60) return `${segundos}s`;
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto ? `${horas}h${String(resto).padStart(2, "0")}` : `${horas}h`;
}

function alternar(conjunto: Set<string>, id: string): Set<string> {
  const proximo = new Set(conjunto);
  if (proximo.has(id)) proximo.delete(id);
  else proximo.add(id);
  return proximo;
}

/* ------------------------------------------------------------------ *
 * Formulário de nova campanha
 * ------------------------------------------------------------------ */

export function FormNovoDisparo({
  instancias,
  grupos,
  etiquetas,
}: {
  instancias: InstanciaOpcao[];
  grupos: GrupoOpcao[];
  etiquetas: EtiquetaOpcao[];
}) {
  const [estado, formAction, pendente] = useActionState<ActionState, FormData>(criarDisparo, {});

  const [instanceId, setInstanceId] = useState(instancias[0]?.id ?? "");
  const [tipo, setTipo] = useState<Tipo>("text");
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [etiquetasMarcadas, setEtiquetasMarcadas] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [minSegundos, setMinSegundos] = useState(6);
  const [maxSegundos, setMaxSegundos] = useState(18);

  const daInstancia = useMemo(
    () => grupos.filter((g) => g.instanceId === instanceId),
    [grupos, instanceId],
  );

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return termo ? daInstancia.filter((g) => g.nome.toLowerCase().includes(termo)) : daInstancia;
  }, [daInstancia, busca]);

  // A etiqueta soma grupos que talvez não estejam marcados na lista: a conta
  // precisa ser da união, senão a estimativa mente pra quem opera.
  const selecionados = useMemo(
    () =>
      daInstancia.filter(
        (g) => marcados.has(g.id) || g.tagIds.some((t) => etiquetasMarcadas.has(t)),
      ),
    [daInstancia, marcados, etiquetasMarcadas],
  );

  const total = selecionados.length;
  const alcance = selecionados.reduce((soma, g) => soma + g.participantes, 0);
  const intervaloMedio = (minSegundos + maxSegundos) / 2;
  const estimativaSegundos = Math.round(total * intervaloMedio);
  const intervaloCurto = intervaloMedio < 5;
  const invertido = maxSegundos < minSegundos;

  const marcadosDaInstancia = daInstancia.filter((g) => marcados.has(g.id)).map((g) => g.id);

  return (
    <form action={formAction} className="space-y-5">
      {/* Os checkboxes são só controle visual: a seleção viaja em hidden inputs
          pra não perder grupo escondido pelo filtro de busca. */}
      {marcadosDaInstancia.map((id) => (
        <input key={id} type="hidden" name="groupIds" value={id} />
      ))}
      {[...etiquetasMarcadas].map((id) => (
        <input key={id} type="hidden" name="tagIds" value={id} />
      ))}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Número que envia" hint="Os grupos abaixo são os gerenciados deste número.">
          <Select
            name="instanceId"
            value={instanceId}
            onChange={(e) => {
              setInstanceId(e.target.value);
              setMarcados(new Set());
            }}
          >
            {instancias.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
                {i.conectada ? "" : " — desconectado"}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Nome da campanha" hint="Só pra você achar depois na lista.">
          <Input name="name" placeholder="Promoção de sexta" maxLength={120} required />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo de conteúdo">
          <Select name="type" value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)}>
            {TIPOS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>

        {tipo !== "text" && (
          <Field label="URL da mídia" hint="Link público que a Evolution API consegue baixar.">
            <Input name="mediaUrl" type="url" placeholder="https://…/arquivo.jpg" />
          </Field>
        )}
      </div>

      {tipo === "document" && (
        <Field
          label="Nome do arquivo"
          hint="Como o documento aparece no WhatsApp. Ex.: catalogo-agosto.pdf"
        >
          <Input name="fileName" placeholder="catalogo-agosto.pdf" maxLength={200} />
        </Field>
      )}

      <Field
        label={tipo === "text" ? "Mensagem" : "Legenda (opcional)"}
        hint="Use {{grupo}} para inserir o nome do grupo que está recebendo."
      >
        <Textarea
          name="text"
          maxLength={4000}
          placeholder={"Bom dia, {{grupo}}! Chegou coleção nova…"}
        />
      </Field>

      {/* -------------------- seleção de destino -------------------- */}
      <div className="space-y-3 rounded-lg border border-border bg-surface-2 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-xs font-medium text-muted">Grupos de destino</p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-48">
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Filtrar por nome"
                aria-label="Filtrar grupos"
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              className="px-2 py-1 text-xs"
              onClick={() => setMarcados(new Set(visiveis.map((g) => g.id)))}
            >
              Marcar visíveis
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="px-2 py-1 text-xs"
              onClick={() => setMarcados(new Set())}
            >
              Limpar
            </Button>
          </div>
        </div>

        {daInstancia.length === 0 ? (
          <p className="text-sm text-muted">
            Este número não tem grupo gerenciado. Sincronize e marque os grupos em Grupos.
          </p>
        ) : (
          <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {visiveis.map((g) => (
              <div key={g.id} className="flex items-center justify-between gap-3">
                <Checkbox
                  label={g.nome || "(sem nome)"}
                  checked={marcados.has(g.id)}
                  onChange={() => setMarcados((atual) => alternar(atual, g.id))}
                />
                <span className="shrink-0 text-xs text-muted">{g.participantes} membros</span>
              </div>
            ))}
            {visiveis.length === 0 && (
              <p className="text-sm text-muted">Nenhum grupo com esse nome.</p>
            )}
          </div>
        )}

        {etiquetas.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs font-medium text-muted">
              Etiquetas — somam todos os grupos gerenciados que as tenham
            </p>
            <div className="flex flex-wrap gap-3">
              {etiquetas.map((t) => (
                <Checkbox
                  key={t.id}
                  label={t.nome}
                  checked={etiquetasMarcadas.has(t.id)}
                  onChange={() => setEtiquetasMarcadas((atual) => alternar(atual, t.id))}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* -------------------- agendamento e ritmo -------------------- */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Agendar para" hint="Horário de Brasília. Em branco começa agora.">
          <Input name="scheduledAt" type="datetime-local" />
        </Field>
        <Field label="Intervalo mínimo (s)">
          <Input
            name="minDelaySeconds"
            type="number"
            min={1}
            max={600}
            value={minSegundos}
            onChange={(e) => setMinSegundos(Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="Intervalo máximo (s)">
          <Input
            name="maxDelaySeconds"
            type="number"
            min={1}
            max={600}
            value={maxSegundos}
            onChange={(e) => setMaxSegundos(Number(e.target.value) || 0)}
          />
        </Field>
      </div>

      <div className="rounded-lg border border-border bg-surface-2 px-4 py-3">
        <p className="text-sm">
          <strong className="tabular-nums">{total}</strong> grupo(s) selecionado(s)
          {total > 0 && (
            <>
              {" "}
              · alcance aproximado de{" "}
              <strong className="tabular-nums">{alcance.toLocaleString("pt-BR")}</strong> membros ·
              o disparo deve levar <strong>{duracao(estimativaSegundos)}</strong>
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-muted">
          Estimativa com intervalo médio de {intervaloMedio.toFixed(1)}s por grupo. O cron processa
          em lotes, então a duração real pode ser maior.
        </p>
      </div>

      {invertido && (
        <Alert tone="danger">O intervalo máximo precisa ser maior ou igual ao mínimo.</Alert>
      )}

      <Alert tone={intervaloCurto ? "danger" : "warn"} title="Cuidado com o ritmo">
        {intervaloCurto
          ? "Intervalo abaixo de 5 segundos é padrão de robô: o risco de bloqueio do número é alto. Prefira algo entre 6 e 18 segundos."
          : "Intervalo curto demais entre envios aumenta o risco de bloqueio do número. Quanto maior a variação entre mínimo e máximo, mais natural o disparo parece."}
      </Alert>

      {estado.error && <Alert tone="danger">{estado.error}</Alert>}
      {estado.ok && <Alert tone="accent">{estado.ok}</Alert>}

      <Button type="submit" disabled={pendente || total === 0 || invertido}>
        {pendente ? "Criando…" : "Criar disparo"}
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Ações da lista e do detalhe
 * ------------------------------------------------------------------ */

export function AcoesCampanha({
  broadcastId,
  status,
  nome,
}: {
  broadcastId: string;
  status: string;
  nome: string;
}) {
  const { pendente, estado, executar } = useAcao();

  const podePausar = status === "running" || status === "scheduled";
  const podeRetomar = status === "paused";
  const podeCancelar = status !== "done" && status !== "canceled";

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-1">
        {podePausar && (
          <Button
            type="button"
            variant="ghost"
            className="px-2 py-1 text-xs"
            disabled={pendente}
            onClick={() => executar(() => pausarDisparo(broadcastId))}
          >
            Pausar
          </Button>
        )}
        {podeRetomar && (
          <Button
            type="button"
            variant="secondary"
            className="px-2 py-1 text-xs"
            disabled={pendente}
            onClick={() => executar(() => retomarDisparo(broadcastId))}
          >
            Retomar
          </Button>
        )}
        {podeCancelar && (
          <Button
            type="button"
            variant="danger"
            className="px-2 py-1 text-xs"
            disabled={pendente}
            onClick={() => {
              if (!confirm(`Cancelar "${nome}"? Os grupos que ainda não receberam ficam de fora.`))
                return;
              executar(() => cancelarDisparo(broadcastId));
            }}
          >
            Cancelar
          </Button>
        )}
        {!podePausar && !podeRetomar && !podeCancelar && (
          <span className="px-2 py-1 text-xs text-muted">—</span>
        )}
      </div>
      <Retorno estado={estado} />
    </div>
  );
}

export function BotaoReenfileirar({
  broadcastId,
  falhados,
}: {
  broadcastId: string;
  falhados: number;
}) {
  const { pendente, estado, executar } = useAcao();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        disabled={pendente || falhados === 0}
        onClick={() => executar(() => reenfileirarFalhados(broadcastId))}
      >
        {pendente ? "Reenfileirando…" : "Reenfileirar falhados"}
      </Button>
      <Badge tone={falhados > 0 ? "danger" : "neutral"}>{falhados} falhado(s)</Badge>
      <Retorno estado={estado} />
    </div>
  );
}
