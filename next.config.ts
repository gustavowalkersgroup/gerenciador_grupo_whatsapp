import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Empacota o servidor junto com apenas as dependências que ele realmente
  // usa. Sem isto a imagem Docker carregaria o node_modules inteiro (centenas
  // de MB de ferramenta de build que não servem para nada em produção).
  // A Vercel ignora esta opção, então continua valendo para os dois destinos.
  output: "standalone",
};

export default nextConfig;
