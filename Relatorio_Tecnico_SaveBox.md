# Relatório Técnico: SaveBox 2.0
## Sistema de Armazenamento em Nuvem Distribuído com Criptografia E2EE Zero-Knowledge
---

### 1. Introdução e Objetivo do Projeto
O **SaveBox 2.0** é um sistema distribuído de armazenamento de arquivos em nuvem que implementa uma arquitetura robusta de **criptografia ponta a ponta (E2EE) com garantia de Conhecimento Zero (Zero-Knowledge)**. O objetivo primordial deste projeto é garantir que o servidor de armazenamento não possua acesso a nenhuma informação legível do usuário — incluindo nomes de arquivos, estruturas de diretórios e conteúdo de dados —, servindo puramente como um custodiante criptográfico de dados estruturados.

Este projeto substitui a comunicação baseada em sockets RMI legados por um protocolo moderno de requisição/resposta baseado em **REST APIs**, orquestrado por um serviço backend de alto desempenho desenvolvido em **C++** com o framework **Crow**. 

Para validar e demonstrar a interoperabilidade entre sistemas distintos e em conformidade com as diretrizes acadêmicas, foram implementados dois clientes completamente independentes em linguagens de programação distintas do backend:
1. **Cliente Web SPA (Single Page Application)**: Desenvolvido em **Vue.js (Vue 3)** com design moderno *dark-glassmorphic*, utilizando a API nativa de criptografia do navegador (**Web Crypto API**).
2. **Cliente Desktop CLI (Command Line Interface)**: Desenvolvido em **Java (Java 11+)** sem dependências externas, utilizando a arquitetura de criptografia padrão do Java (**JCE**).

Ambos os clientes são 100% interoperáveis, permitindo que arquivos protegidos enviados pelo cliente Web sejam baixados e descriptografados pelo cliente Java, e vice-versa.

---

### 2. Arquitetura do Sistema Distribuído

A topologia do sistema segue uma arquitetura cliente-servidor tradicional sobre o protocolo HTTP/1.1, persistida por um banco de dados relacional.

```
+----------------------------------------------------------------+
|                    CLIENTES (ZERO-KNOWLEDGE)                   |
|                                                                |
|   +--------------------------+    +------------------------+   |
|   |        CLIENTE WEB       |    |       CLIENTE CLI      |   |
|   |  (Vue 3 & Web Crypto)    |    |   (Java 11 & JCE API)  |   |
|   +-------------+------------+    +-----------+------------+   |
+-----------------|-----------------------------|----------------+
                  |                             |
                  +--------------+--------------+
                                 | (REST API / JWT over HTTP)
                                 v
+----------------------------------------------------------------+
|                   BACKEND SERVIDOR (C++ CROW)                  |
|                                                                |
|   O servidor recebe apenas dados encriptados dos metadados e   |
|   blocos binários de arquivos protegidos por chaves do cliente.|
|                                                                |
|                  +----------------------------+                |
|                  |       PostgreSQL DB        |                |
|                  +----------------------------+                |
+----------------------------------------------------------------+
```

#### Componentes Principais:
1. **Serviço Backend (C++)**:
   - Desenvolvido utilizando o framework **Crow** para gerenciamento de rotas RESTful.
   - Banco de dados relacional **PostgreSQL** para indexação rápida e controle transacional de pastas, arquivos e usuários.
   - Rotas de upload assíncrono para recepção de pedaços (*chunks*) binários brutos.
   - Garbage Collector integrado para eliminação de arquivos órfãos e expirações.

2. **Segurança de Acesso (JWT)**:
   - A autenticação é realizada através de tokens JSON Web Tokens (**JWT**) gerados pelo servidor Crow após o login com senha armazenada de forma segura com salt individual.
   - O JWT é enviado em cada cabeçalho de requisição subsequente como `Authorization: Bearer <TOKEN>`.

---

### 3. Protocolo Criptográfico Zero-Knowledge (E2EE)

A premissa fundamental do *Zero-Knowledge* é que o servidor nunca conhece a senha mestra do usuário e nunca tem posse da chave simétrica de criptografia de conteúdo.

```
       [ Senha Mestra ] + [ Nome do Usuário ]
                       │
                       ▼ (PBKDF2 - 100.000 iterações)
              [ Chave Mestra (MK) ] ─────────────────────────┐
                       │                                     │
        ┌──────────────┴──────────────┐                      │
        ▼                             ▼                      ▼
[ Nomes de Pastas ]          [ Nomes de Arquivos ]     [ Chave do Arquivo (FDK) ]
  • Criptografia AES-GCM       • Criptografia AES-GCM    • Gerada de forma randômica
  • Hash de Nome SHA-256       • Hash de Nome SHA-256    • Criptografada com MK (Envelope)
        │                             │                      │
        ▼                             ▼                      ▼
  [ Servidor ]                  [ Servidor ]           [ Armazenada no Servidor ]
```

#### Fluxo de Criação de Pastas e Upload de Arquivos:
1. **Derivação de Chave**:
   - A senha mestra do usuário e o seu nome de usuário (utilizado como salt) alimentam um algoritmo **PBKDF2** para gerar a **Chave Mestra (Master Key - MK)** de 256 bits localmente na memória RAM do cliente.
2. **Criptografia de Metadados**:
   - O nome legível do arquivo ou pasta (ex: `Documentos`) é criptografado com a MK usando **AES-GCM (256-bit)** para produzir o `encrypted_name` (codificado em Base64 URL-safe).
   - Um Hash unidirecional `SHA-256` do nome plano em caixa baixa é calculado para gerar o `name_hash`. O servidor utiliza este hash para garantir que não haja dois arquivos com nomes idênticos no mesmo diretório do banco de dados, sem nunca descobrir o nome real!
3. **Criptografia de Conteúdo em Chunks**:
   - Para cada novo arquivo, o cliente gera uma **Chave de Descriptografia de Arquivo (FDK)** simétrica aleatória de 256 bits usando um gerador de números pseudo-aleatórios seguro.
   - A FDK é criptografada com a Chave Mestra (MK) do usuário para gerar a chave empacotada `encrypted_fdk` (Criptografia de Envelope). Apenas o proprietário da conta (que tem a MK) pode reverter a FDK.
   - O arquivo é subdividido em pedaços (*chunks*) fixos de **5MB**.
   - Cada bloco é criptografado com a FDK usando AES-GCM (gerando um vetor de inicialização IV de 12 bytes único para cada chunk).
   - O chunk criptografado binário de tamanho original + 28 bytes (12 bytes de IV + 16 bytes de tag de autenticação GCM) é enviado ao servidor.

---

### 4. Alinhamento de Interoperabilidade Criptográfica (JS vs Java)

Um dos maiores desafios técnicos resolvidos no SaveBox 2.0 foi o alinhamento exato entre as bibliotecas de criptografia de baixo nível do navegador (JavaScript Web Crypto API) e do ambiente desktop (Java Cryptography Architecture - JCE). 

A tabela a seguir documenta como as duas plataformas foram calibradas para garantir **perfeita interoperabilidade**:

| Parâmetro Criptográfico | JavaScript (Web Crypto API) | Java (Java Cryptography Extension) | Observações |
| :--- | :--- | :--- | :--- |
| **Derivação PBKDF2** | `PBKDF2` (SHA-256) | `PBKDF2WithHmacSHA256` | Garante derivação binária idêntica |
| **Iterações PBKDF2** | `100000` | `100000` | Segurança contra ataques de dicionário |
| **Salt do PBKDF2** | `TextEncoder().encode(username)` | `username.getBytes(StandardCharsets.UTF_8)` | Utiliza o nome de usuário unificado |
| **Criptografia** | `AES-GCM` (256 bits) | `AES/GCM/NoPadding` (256 bits) | Cipher simétrico de alta velocidade |
| **Vetor de Inicialização (IV)** | `window.crypto.getRandomValues(12)` | `SecureRandom().nextBytes(12)` | 12 bytes seguros para cada bloco |
| **GCM Auth Tag** | `128 bits` (padrão) | `GCMParameterSpec(128, ...)` | 16 bytes de tag inclusos no ciphertext |
| **Envelope do Ciphertext** | `[12B IV] + [Ciphertext + 16B Tag]` | `[12B IV] + [Ciphertext + 16B Tag]` | Estrutura binária compartilhada |
| **Base64 de Metadados** | URL-Safe Base64 (sem padding `=`) | `Base64.getUrlEncoder().withoutPadding()` | Evita erros de escape em queries HTTP |

---

### 5. Especificação das Rotas da API REST do Servidor C++

Todas as interações são mapeadas sob endpoints RESTful padronizados no servidor Crow (`http://localhost:8080`):

1. **Autenticação e Registro**:
   - `POST /register`: Cria nova conta de usuário. Espera `{username, email, password}`.
   - `POST /login`: Valida identidade e retorna o token JWT. Espera `{username, password}`.
   - `GET /verify?token=...`: Ativa a conta a partir de link de e-mail.

2. **Gerenciamento de Pastas (Diretórios)**:
   - `GET /tree`: Retorna a árvore completa criptografada do usuário proprietário do token.
   - `POST /folders`: Cria uma pasta sob um pai específico. Espera `{parent_id, encrypted_name, name_hash}`.
   - `PUT /folders/<id>`: Renomeia ou move uma pasta. Espera `{parent_id, encrypted_name, name_hash}`.
   - `DELETE /folders/<id>`: Move a pasta e suas subpastas recursivamente para a lixeira.

3. **Gerenciamento de Arquivos**:
   - `POST /files`: Inicializa um upload. Espera `{folder_id, encrypted_name, name_hash, encrypted_fdk, size_bytes, total_chunks}`. Retorna `file_id`.
   - `POST /files/<id>/chunks`: Upload binário (`Content-Type: application/octet-stream`) contendo o cabeçalho `X-Chunk-Index` para indexar a posição do bloco.
   - `GET /files/<id>/download`: Retorna o arquivo criptografado. O cliente deve enviar o cabeçalho `Range: bytes=<START>-<END>` para baixar chunks específicos e decifrá-los sob demanda.
   - `PUT /files/<id>`: Edita metadados, move de pasta ou renomeia o arquivo.
   - `DELETE /files/<id>`: Envia o arquivo para a lixeira.

4. **Lixeira e Recuperação**:
   - `GET /trash`: Lista todos os itens marcados como excluídos.
   - `POST /folders/<id>/restore`: Restaura a pasta e sua estrutura interna.
   - `POST /files/<id>/restore`: Recupera um arquivo excluído.
   - `DELETE /trash/empty`: Purga permanentemente todos os arquivos e remove fisicamente os blocos do disco do servidor.

5. **Compartilhamento Zero-Knowledge**:
   - `POST /files/<id>/share`: Ativa permissão pública e gera um `share_uuid`.
   - `GET /share/<uuid>`: Permite o download de blocos criptografados sem token de autenticação HTTP. A chave FDK deve ser fornecida pelo receptor através de um fragmento hash URL no navegador (`#`), mantendo o princípio de Conhecimento Zero intacto!

---

### 6. Manual de Configuração e Execução do Ecossistema

#### Passo 1: Executando o Servidor Crow Backend (C++)
O servidor Crow depende do **PostgreSQL**. Certifique-se de configurar as tabelas usando os esquemas SQL contidos no backend.
1. Inicialize seu servidor local de PostgreSQL.
2. Crie as variáveis de ambiente baseando-se no arquivo `.env.example` da raiz.
3. Dentro do diretório `backend`, compile e execute a aplicação usando CMake ou seu compilador C++17 preferido:
   ```bash
   cd backend
   mkdir build && cd build
   cmake ..
   make
   ./SaveBoxServer
   ```
   *O backend subirá em `http://localhost:8080`.*

#### Passo 2: Executando o Cliente Web (Vue 3 & Vite)
O cliente Web foi estruturado como uma aplicação moderna **Vue 3** baseada em Single File Components (`App.vue`) compilada em tempo de execução via **Vite** para máxima modularidade e eficiência.
1. Navegue até a pasta `client-web`:
   ```bash
   cd client-web
   ```
2. Instale as dependências locais declaradas no `package.json`:
   ```bash
   npm install
   ```
3. Execute o servidor de desenvolvimento do Vite:
   ```bash
   npm run dev
   ```
   *O front-end iniciará e estará acessível em `http://localhost:3000`.*
4. O painel visual se conectará de forma transparente à API. Você pode criar novas contas, efetuar uploads interativos arrastando arquivos, gerenciar a árvore lógica de pastas de forma recursiva e gerar links públicos seguros.

#### Passo 3: Compilando e Executando o Cliente CLI (Java)
O cliente desktop foi programado em Java 11 puramente sem dependências externas adicionais no classpath, facilitando a portabilidade rápida.
1. Abra um terminal de comandos do Windows ou Linux e navegue até a pasta `client-cli-java`:
   ```bash
   cd client-cli-java
   ```
2. Para compilar e executar de forma automatizada no Windows, clique duas vezes no arquivo `run.bat` ou execute no PowerShell:
   ```powershell
   .\run.bat
   ```
3. Se estiver no Linux/macOS, execute os comandos nativos correspondentes:
   ```bash
   mkdir -p bin
   javac -d bin src/SaveBoxClient.java
   java -cp bin client.SaveBoxClient
   ```
4. A tela de menu colorido em ANSI iniciará, permitindo realizar as operações integradas à base central distribuída.

---

### 7. Conclusão
O ecossistema **SaveBox 2.0** atende integralmente todos os requisitos solicitados para a entrega acadêmica, consolidando a migração definitiva para uma comunicação moderna baseada em REST APIs, promovendo a cooperação real entre clientes escritos em múltiplas linguagens e demonstrando um robusto arcabouço de segurança criptográfica com arquiteturas robustas em Vue.js e Java Desktop.
