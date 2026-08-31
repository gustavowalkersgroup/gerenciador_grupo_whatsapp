"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { createFirstUser, signIn, type FormState } from "./actions";

export function LoginForm({ firstRun }: { firstRun: boolean }) {
  const action = firstRun ? createFirstUser : signIn;
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-4">
      {firstRun && (
        <Alert tone="accent" title="Primeiro acesso">
          Nenhum usuário cadastrado ainda. Crie o dono do painel — depois disso este
          formulário vira login normal.
        </Alert>
      )}

      {firstRun && (
        <Field label="Nome">
          <Input name="name" placeholder="Seu nome" autoComplete="name" />
        </Field>
      )}

      <Field label="E-mail">
        <Input
          name="email"
          type="email"
          required
          placeholder="voce@empresa.com.br"
          autoComplete="email"
        />
      </Field>

      <Field label="Senha" hint={firstRun ? "Mínimo de 8 caracteres." : undefined}>
        <Input
          name="password"
          type="password"
          required
          minLength={8}
          placeholder="••••••••"
          autoComplete={firstRun ? "new-password" : "current-password"}
        />
      </Field>

      {state.error && <Alert tone="danger">{state.error}</Alert>}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Aguarde…" : firstRun ? "Criar acesso" : "Entrar"}
      </Button>
    </form>
  );
}
