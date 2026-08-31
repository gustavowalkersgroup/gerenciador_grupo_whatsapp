"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Field, Input, Table, Td } from "@/components/ui";
import {
  createInstance,
  disconnectInstance,
  removeInstance,
  resendWebhook,
  updateLimits,
  type FormState,
} from "./actions";

export type InstanceStatus = "disconnected" | "connecting" | "connected" | "banned";

/** O que a página server-side manda pro cliente — datas já formatadas em pt-BR. */
export interface InstanceView {
  id: string;
  label: string;
  evolutionName: string;
  phone: string;
  status: InstanceStatus;
  dailyDmLimit: number;
  minSendDelayMs: number;
  maxSendDelayMs: number;
  lastSeen: string;
}

const STATUS: Record<InstanceStatus, { label: string; tone: "accent" | "warn" | "danger" }> = {
  connected: { label: "Conectado", tone: "accent" },
  connecting: { label: "Conectando", tone: "warn" },
  disconnected: { label: "Desconectado", tone: "danger" },
  banned: { label: "Banido", tone: "danger" },
};

const POLL_MS = 5000;

/* ------------------------------------------------------------------ *
 * Cadastro de número
 * ------------------------------------------------------------------ */

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // tira acento antes de virar slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function NovoNumeroForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createInstance, {});
  const [evolutionName, setEvolutionName] = useState("");
  // Enquanto o operador não mexe no slug, ele acompanha o rótulo.
  const [nameEdited, setNameEdited] = useState(false);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Rótulo" hint="Como esse número aparece no painel.">
          <Input
            name="label"
            required
            maxLength={60}
            placeholder="Comercial 1"
            onChange={(e) => {
              if (!nameEdited) setEvolutionName(slugify(e.target.value));
            }}
          />
        </Field>

        <Field
          label="Nome da instância"
          hint="Identificador na Evolution API: minúsculas, números e hífen (3 a 32)."
        >
          <Input
            name="evolutionName"
            required
            value={evolutionName}
            pattern="[a-z0-9-]{3,32}"
            placeholder="comercial-1"
            className="font-mono"
            onChange={(e) => {
              setNameEdited(true);
              setEvolutionName(e.target.value);
            }}
          />
        </Field>
      </div>

      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.ok && <Alert tone="accent">{state.ok}</Alert>}

      <Button type="submit" disabled={pending}>
        {pending ? "Criando na Evolution…" : "Cadastrar número"}
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Lista
 * ------------------------------------------------------------------ */

export function ListaNumeros({ items }: { items: InstanceView[] }) {
  return (
    <Table
      head={[
        "Rótulo",
        "Instância",
        "Telefone",
        "Status",
        "DM/dia",
        "Visto por último",
        "Ações",
      ]}
    >
      {items.map((item) => (
        <LinhaNumero key={item.id} item={item} />
      ))}
    </Table>
  );
}

function LinhaNumero({ item }: { item: InstanceView }) {
  const [showQr, setShowQr] = useState(false);
  const [result, setResult] = useState<FormState>({});
  const [pending, startTransition] = useTransition();
  const status = STATUS[item.status];

  function run(action: (id: string) => Promise<FormState>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setResult({});
    startTransition(async () => {
      setResult(await action(item.id));
    });
  }

  return (
    <>
      <tr>
        <Td className="font-medium">{item.label}</Td>
        <Td className="font-mono text-xs text-muted">{item.evolutionName}</Td>
        <Td className="whitespace-nowrap text-muted">{item.phone}</Td>
        <Td>
          <Badge tone={status.tone}>{status.label}</Badge>
        </Td>
        <Td className="tabular-nums text-muted">{item.dailyDmLimit}</Td>
        <Td className="whitespace-nowrap text-muted">{item.lastSeen}</Td>
        <Td>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={showQr ? "secondary" : "primary"}
              onClick={() => setShowQr((v) => !v)}
            >
              {showQr ? "Fechar" : item.status === "connected" ? "Ver conexão" : "Conectar"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => run(resendWebhook)}
            >
              Reenviar webhook
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                run(
                  disconnectInstance,
                  `Desconectar "${item.label}"? O celular vai precisar ler o QR Code de novo.`,
                )
              }
            >
              Desconectar
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={pending}
              onClick={() =>
                run(
                  removeInstance,
                  `Remover "${item.label}"? Isso apaga a instância na Evolution e todos os ` +
                    "grupos, regras e gatilhos ligados a ela. Não dá pra desfazer.",
                )
              }
            >
              Remover
            </Button>
          </div>
        </Td>
      </tr>

      {(showQr || result.error || result.ok) && (
        <tr>
          <td colSpan={7} className="pb-4">
            <div className="space-y-3">
              {result.error && <Alert tone="danger">{result.error}</Alert>}
              {result.ok && <Alert tone="accent">{result.ok}</Alert>}
              {showQr && <QrPanel instanceId={item.id} initialStatus={item.status} />}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Painel de QR Code
 * ------------------------------------------------------------------ */

interface QrPayload {
  status: InstanceStatus;
  base64: string | null;
  code: string | null;
  pairingCode: string | null;
  warning?: string;
  error?: string;
}

export function QrPanel({
  instanceId,
  initialStatus,
}: {
  instanceId: string;
  initialStatus: InstanceStatus;
}) {
  const router = useRouter();
  const [data, setData] = useState<QrPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(initialStatus === "connected");

  useEffect(() => {
    if (connected) return;

    const controller = new AbortController();
    let alive = true;
    // A Evolution pode demorar mais que o intervalo; sem isso as chamadas empilham.
    let inFlight = false;

    async function poll() {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/instancias/${instanceId}/qr`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const body = (await res.json()) as QrPayload;
        if (!alive) return;

        if (!res.ok) {
          setError(body.error ?? "Não foi possível buscar o QR Code.");
          return;
        }

        setError(null);
        setData(body);
        if (body.status === "connected") setConnected(true);
      } catch {
        // Abort no cleanup não é falha — só o componente saindo de cena.
        if (!controller.signal.aborted && alive) {
          setError("Sem resposta do servidor. Tentando de novo…");
        }
      } finally {
        inFlight = false;
      }
    }

    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);

    return () => {
      alive = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [instanceId, connected]);

  // Conectou: o status na tabela veio do servidor, então recarrega os dados.
  useEffect(() => {
    if (connected) router.refresh();
  }, [connected, router]);

  if (connected) {
    return (
      <Alert tone="accent" title="Número conectado">
        O WhatsApp já está pareado. Os eventos dos grupos começam a chegar pelo webhook.
      </Alert>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {/* Fundo branco não é escolha de tema: câmera não lê QR sobre fundo escuro. */}
        <div className="flex size-64 shrink-0 items-center justify-center rounded-lg bg-white p-3">
          {data?.base64 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.base64}
              alt="QR Code para parear o WhatsApp"
              className="size-full object-contain"
            />
          ) : data?.code ? (
            <p className="break-all p-2 text-center font-mono text-xs text-black">{data.code}</p>
          ) : (
            <p className="text-center text-xs text-black/60">Gerando QR Code…</p>
          )}
        </div>

        <div className="min-w-0 space-y-2 text-sm">
          <p className="font-medium">Abra o WhatsApp no celular</p>
          <p className="text-muted">
            Toque em <strong>Aparelhos conectados</strong> → <strong>Conectar aparelho</strong> e
            aponte a câmera para o código. A tela atualiza sozinha a cada 5 segundos.
          </p>
          {data?.pairingCode && (
            <p className="text-muted">
              Código de pareamento:{" "}
              <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-text">
                {data.pairingCode}
              </code>
            </p>
          )}
          {data && (
            <p className="text-xs text-muted">
              Estado atual: {STATUS[data.status].label.toLowerCase()}
            </p>
          )}
          {data?.warning && <Alert tone="warn">{data.warning}</Alert>}
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Limites de segurança
 * ------------------------------------------------------------------ */

export function LimitesForm({ item }: { item: InstanceView }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(updateLimits, {});

  return (
    <form action={formAction} className="space-y-3 border-t border-border pt-4 first:border-0 first:pt-0">
      <input type="hidden" name="id" value={item.id} />

      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-sm font-medium">{item.label}</p>
        <span className="font-mono text-xs text-muted">{item.evolutionName}</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Limite diário de DM" hint="Mensagens no privado por dia.">
          <Input
            name="dailyDmLimit"
            type="number"
            min={1}
            max={1000}
            required
            defaultValue={item.dailyDmLimit}
          />
        </Field>
        <Field label="Intervalo mínimo (ms)" hint="Espera mínima entre dois envios.">
          <Input
            name="minSendDelayMs"
            type="number"
            min={1000}
            max={600000}
            step={500}
            required
            defaultValue={item.minSendDelayMs}
          />
        </Field>
        <Field label="Intervalo máximo (ms)" hint="Teto do sorteio do intervalo.">
          <Input
            name="maxSendDelayMs"
            type="number"
            min={1000}
            max={600000}
            step={500}
            required
            defaultValue={item.maxSendDelayMs}
          />
        </Field>
      </div>

      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.ok && <Alert tone="accent">{state.ok}</Alert>}

      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Salvando…" : "Salvar limites"}
      </Button>
    </form>
  );
}
