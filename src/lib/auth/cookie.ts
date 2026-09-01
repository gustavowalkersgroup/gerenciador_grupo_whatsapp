/**
 * Decide se o cookie de sessão sai com a flag `Secure`.
 *
 * Com `Secure`, o navegador só guarda o cookie em origem HTTPS. Isso é o certo
 * quando há domínio e certificado — mas quebra o login em servidor local
 * acessado por IP em HTTP puro, e quebra de um jeito traiçoeiro: a tela de
 * login some, a sessão nasce no banco, e o navegador simplesmente descarta o
 * cookie. Para o usuário parece que a senha está errada.
 *
 * O nome evita o prefixo `use` de propósito: o ESLint trataria a função
 * como React Hook e barraria a chamada aqui.
 *
 * Por isso a flag é configurável. O padrão continua sendo ligada em produção:
 * desligar é um ato explícito, nunca um acidente de configuração.
 */
export function deveMarcarSecure(
  configurado: string | undefined,
  nodeEnv: string | undefined,
): boolean {
  if (configurado !== undefined && configurado !== "") {
    return configurado === "true";
  }
  return nodeEnv === "production";
}
