# ==========================================
# ESTÁGIO 1: BUILDER
# Objetivo: Instalar dependências e compilar TypeScript
# ==========================================
FROM node:20-alpine AS builder

# Define o diretório de trabalho no container
WORKDIR /app

# Copia os manifestos do Node.js
COPY package*.json ./

# Instala TODAS as dependências (incluindo TypeScript e @types)
RUN npm install

# Copia todo o código-fonte, configurações e assets públicos
COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/

# Executa o transpilador (gera a pasta /dist com o código JS)
RUN npm run build

# ==========================================
# ESTÁGIO 2: PRODUCTION
# Objetivo: Imagem ultraleve apenas com o necessário para rodar
# ==========================================
FROM node:20-alpine AS production

WORKDIR /app

# Copia novamente o package.json
COPY package*.json ./

# Instala ESTRITAMENTE as dependências de produção (ignora TypeScript)
# Isso reduz drasticamente o tamanho final da imagem e a superfície de ataque
RUN npm install --production

# Copia apenas os artefatos compilados do estágio Builder
COPY --from=builder /app/dist ./dist

# Copia o front-end (Painel Web) do estágio Builder
COPY --from=builder /app/public ./public

# Define que a aplicação roda em modo produção nativamente no Express
ENV NODE_ENV=production

# Documenta a porta que o container vai escutar
EXPOSE 3000

# Executa o entrypoint do servidor já compilado
CMD ["node", "dist/server.js"]
