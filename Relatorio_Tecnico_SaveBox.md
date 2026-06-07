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

### 7. Evolução da Arquitetura: Comunicação Indireta via Fila de Mensagens (Transactional Outbox)

Em conformidade com os requisitos de evolução da arquitetura do SaveBox para integrar comunicação indireta, a equipe implementou a **Opção C: Filas de Mensagens (Message Queues)** utilizando a estratégia de **Fila Transacional no PostgreSQL** integrada ao backend C++ (*Transactional Outbox Pattern*).

#### 7.1. Justificativa da Escolha da Abordagem
A escolha por Filas de Mensagens (Message Queues) é a mais adequada para o cenário do SaveBox pelos seguintes motivos estruturais:
* **Gargalo Síncrono Real**: Anteriormente, a rota de cadastro (`POST /register`) realizava um acoplamento temporal crítico com o serviço externo **Resend API** para envio do e-mail de verificação. A requisição HTTP síncrona bloqueava a thread de execução do servidor por até 10 segundos, tornando o sistema vulnerável a lentidões ou falhas na rede externa.
* **Preservação do Modelo Cliente-Servidor Criptográfico**: Outras abordagens, como Espaços de Tuplas ou Comunicação em Grupo, exigiriam uma reengenharia completa das chamadas RESTful e do protocolo criptográfico *Zero-Knowledge* ponta a ponta. A fila de mensagens atua como um facilitador assíncrono perfeitamente acoplável sem alterar a lógica de metadados do cliente.
* **Desacoplamento Espacial e Temporal**: O emissor da mensagem (a rota de cadastro de usuários no C++) não conhece a identidade, IP ou porta do receptor (a thread worker que dispara o e-mail via API externa), configurando o **desacoplamento espacial**. O **desacoplamento temporal** é garantido pois o cadastro de usuários é concluído mesmo se o worker de e-mails estiver completamente inativo ou se a API de destino estiver fora do ar.

#### 7.2. Detalhes da Implementação (C++)
A fila foi modelada diretamente na tabela `email_queue` do banco de dados PostgreSQL:
```sql
CREATE TABLE email_queue (
    id BIGSERIAL PRIMARY KEY,
    to_email VARCHAR(255) NOT NULL,
    verification_token VARCHAR(128) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, PROCESSING, SENT, FAILED
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_email_queue_status ON email_queue(status);
```

##### Fluxo de Funcionamento:
1. **Gravação Atômica (Outbox)**: Durante a execução de `AuthService::register_user`, o registro do usuário e a criação da tarefa de e-mail ocorrem na **mesma transação SQL**. Isso assegura consistência absoluta: o e-mail só é enfileirado se o usuário for criado com sucesso no banco.
2. **Processamento Assíncrono (Worker)**: A classe `EmailQueueProcessor` gerencia uma thread em segundo plano que executa consultas periódicas (a cada 5 segundos) no banco de dados.
3. **Mecanismo de Concorrência Seguro (SKIP LOCKED)**: O worker busca as mensagens utilizando a query:
   ```sql
   UPDATE email_queue
   SET status = 'PROCESSING', updated_at = NOW()
   WHERE id IN (
       SELECT id FROM email_queue
       WHERE status = 'PENDING' OR (status = 'FAILED' AND attempts < 3)
       ORDER BY id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 5
   )
   RETURNING id, to_email, verification_token, attempts;
   ```
   O comando `FOR UPDATE SKIP LOCKED` garante que, se múltiplos workers estiverem executando concorrentemente, eles nunca pegarão os mesmos e-mails e não haverá bloqueio de threads, escalando horizontalmente de forma segura.

#### 7.3. Análise de Desempenho e Overhead
* **Sobrecarga (Overhead) Introduzida**:
  * **E/S e Espaço em Banco**: Cada cadastro de usuário exige agora duas inserções na mesma transação, aumentando marginalmente o tráfego de gravação de logs (WAL) do banco de dados.
  * **Latência Fim-a-Fim**: A entrega do e-mail não é imediata no instante do clique; ela depende da frequência de varredura do processador (intervalo de 5 segundos).
  * **Complexidade de Gerenciamento**: Introdução de um estado intermediário (`PROCESSING`, `FAILED`) e necessidade de controle de ciclo de vida da thread de background.
* **Mitigações**:
  * Criação de índice na coluna `status` da tabela `email_queue`, garantindo que a varredura por itens pendentes (`PENDING`) ocorra em tempo sub-milissegundo, sem varrer a tabela inteira.
  * Utilização do padrão `SKIP LOCKED` do PostgreSQL, evitando bloqueios na tabela que poderiam afetar a inserção de novos cadastros.

#### 7.4. Robustez, Tolerância a Falhas e Recuperação de Estado
Se o banco de dados cair, o sistema é interrompido de forma limpa sem perdas de integridade graças às propriedades ACID do PostgreSQL. Se a API externa do Resend falhar ou se o worker de processamento de e-mails cair no meio de um envio:
1. O status do job é atualizado para `FAILED`.
2. O worker incrementa o contador `attempts`.
3. Em ciclos subsequentes de execução, o worker tenta reprocessar jobs falhos (`attempts < 3`).
4. Se o limite de 3 tentativas for atingido, o job é permanentemente marcado como `FAILED` e o log de erro é armazenado no campo `last_error`, permitindo auditoria sem travar a fila.

#### 7.5. Guia para Demonstração de Desacoplamento em Tempo Real
Para provar o desacoplamento e resiliência do sistema em tempo real na apresentação:
1. **Derrubando o Consumidor (Desacoplamento Temporal)**: 
   * Modifique o arquivo de configuração `.env` temporariamente para utilizar uma chave de API de e-mail inválida ou pare o backend e comente a linha `queue_processor.start();` no arquivo `main.cpp`.
   * Realize o cadastro de um novo usuário através do Cliente Web (`http://localhost:3000`) ou CLI Java.
   * Observe que o cadastro é efetuado **com sucesso e de forma instantânea**, confirmando que a rota de API não depende do receptor de e-mail estar funcional no momento.
2. **Visualização do Estado de Espera**:
   * Execute a seguinte consulta no banco de dados PostgreSQL para verificar a retenção de dados:
     ```sql
     SELECT to_email, status, attempts, last_error FROM email_queue;
     ```
   * O registro estará na tabela com status `PENDING` ou `FAILED` com as tentativas registradas, provando a retenção física da mensagem.
3. **Recuperação e Processamento Posterior**:
   * Reinicie o servidor com as configurações corretas de envio.
   * O processador consumirá a mensagem pendente e enviará o e-mail, confirmando a recuperação sem qualquer intervenção manual ou perda de dados do usuário.

---

### 8. Conclusão
O ecossistema **SaveBox 2.0** atende integralmente todos os requisitos solicitados para a entrega acadêmica, consolidando a migração definitiva para uma comunicação moderna baseada em REST APIs, promovendo a cooperação real entre clientes escritos em múltiplas linguagens e demonstrando um robusto arcabouço de segurança criptográfica com arquiteturas robustas em Vue.js e Java Desktop, agora evoluído com uma arquitetura de comunicação indireta resiliente e desacoplada.
