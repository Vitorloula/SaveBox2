package client;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import java.io.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.spec.KeySpec;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class SaveBoxClient {
    // --- CONFIGURATION ---
    private static final String API_URL = "http://localhost:8080";
    private static final int CHUNK_SIZE = 5 * 1024 * 1024; // 5MB matching the C++ Crow API
    private static final int IV_LENGTH = 12;
    private static final int TAG_LENGTH = 128; // AES-GCM authentication tag bits

    // --- ANSI COLORS ---
    private static final String RESET = "\u001B[0m";
    private static final String RED = "\u001B[31m";
    private static final String GREEN = "\u001B[32m";
    private static final String YELLOW = "\u001B[33m";
    private static final String BLUE = "\u001B[34m";
    private static final String PURPLE = "\u001B[35m";
    private static final String CYAN = "\u001B[36m";
    private static final String BOLD = "\u001B[1m";

    // --- CLIENT SESSION STATE ---
    private static String jwtToken = "";
    private static String loggedUsername = "";
    private static SecretKey masterKey = null; // Stored only in RAM
    private static final HttpClient httpClient = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();
    private static final Scanner scanner = new Scanner(System.in);

    // Explorer State
    private static Long currentFolderId = null; // null = Root
    private static final List<FolderInfo> currentFolders = new ArrayList<>();
    private static final List<FileInfo> currentFiles = new ArrayList<>();
    private static final List<FolderInfo> trashFolders = new ArrayList<>();
    private static final List<FileInfo> trashFiles = new ArrayList<>();
    private static final List<FolderInfo> allSystemFolders = new ArrayList<>();

    public static void main(String[] args) {
        printBanner();
        while (true) {
            if (jwtToken.isEmpty()) {
                showAuthMenu();
            } else {
                showMainMenu();
            }
        }
    }

    private static void printBanner() {
        System.out.println(CYAN + BOLD);
        System.out.println("=====================================================================");
        System.out.println("       SAVEBOX 2.0 — CLIENTE CONSOLE JAVA E2EE ZERO-KNOWLEDGE       ");
        System.out.println("=====================================================================");
        System.out.println("  Segurança Criptográfica de Ponta — AES-GCM 256 + PBKDF2 Derivation ");
        System.out.println("=====================================================================" + RESET);
    }

    // =======================================================================
    // ZERO-KNOWLEDGE E2EE CRYPTOGRAPHIC ENGINE
    // =======================================================================

    // 1. Deriva Chave Mestra com PBKDF2 (Senha + Salt/Username)
    private static SecretKey deriveMasterKey(String password, String salt) throws Exception {
        SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
        // Deriva uma chave de 256 bits usando 100.000 iterações (alinhado com JS/Vue)
        KeySpec spec = new PBEKeySpec(
                password.toCharArray(),
                salt.toLowerCase().trim().getBytes(StandardCharsets.UTF_8),
                100000,
                256
        );
        SecretKey tmp = factory.generateSecret(spec);
        return new SecretKeySpec(tmp.getEncoded(), "AES");
    }

    // 2. Criptografa Texto (nomes de metadados) usando AES-GCM 256 (Retorna Base64 URL-safe)
    private static String encryptText(String text, SecretKey key) throws Exception {
        byte[] plainBytes = text.getBytes(StandardCharsets.UTF_8);
        byte[] iv = new byte[IV_LENGTH];
        new SecureRandom().nextBytes(iv);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        GCMParameterSpec spec = new GCMParameterSpec(TAG_LENGTH, iv);
        cipher.init(Cipher.ENCRYPT_MODE, key, spec);
        byte[] encryptedBytes = cipher.doFinal(plainBytes);

        // Combina IV + Ciphertext
        byte[] combined = new byte[iv.length + encryptedBytes.length];
        System.arraycopy(iv, 0, combined, 0, iv.length);
        System.arraycopy(encryptedBytes, 0, combined, iv.length, encryptedBytes.length);

        // Retorna Base64 URL-safe (sem padding) para bater com o JavaScript
        return Base64.getUrlEncoder().withoutPadding().encodeToString(combined);
    }

    // 3. Decriptografa Texto usando AES-GCM 256 (Recebe Base64 URL-safe)
    private static String decryptText(String encryptedBase64, SecretKey key) {
        if (encryptedBase64 == null || encryptedBase64.isEmpty()) return "";
        try {
            byte[] combined = Base64.getUrlDecoder().decode(encryptedBase64);
            byte[] iv = new byte[IV_LENGTH];
            System.arraycopy(combined, 0, iv, 0, IV_LENGTH);

            byte[] encryptedBytes = new byte[combined.length - IV_LENGTH];
            System.arraycopy(combined, IV_LENGTH, encryptedBytes, 0, encryptedBytes.length);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            GCMParameterSpec spec = new GCMParameterSpec(TAG_LENGTH, iv);
            cipher.init(Cipher.DECRYPT_MODE, key, spec);
            byte[] decryptedBytes = cipher.doFinal(encryptedBytes);

            return new String(decryptedBytes, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "[Erro na decriptografia / Chave Mestra Incorreta]";
        }
    }

    // 4. Calcula Hash SHA-256 (prevenção de nomes duplicados Zero-Knowledge)
    private static String computeSHA256(String text) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(text.trim().toLowerCase().getBytes(StandardCharsets.UTF_8));
        StringBuilder hexString = new StringBuilder();
        for (byte b : hash) {
            String hex = Integer.toHexString(0xff & b);
            if (hex.length() == 1) hexString.append('0');
            hexString.append(hex);
        }
        return hexString.toString();
    }

    // 5. Gera uma Chave Simétrica AES de 256 bits para o Arquivo (FDK)
    private static SecretKey generateFDK() throws Exception {
        KeyGenerator keyGen = KeyGenerator.getInstance("AES");
        keyGen.init(256);
        return keyGen.generateKey();
    }

    // 6. Criptografa a FDK usando a Chave Mestra (Retorna Base64 URL-safe)
    private static String encryptFDK(SecretKey fdk, SecretKey mKey) throws Exception {
        byte[] rawFDK = fdk.getEncoded();
        byte[] iv = new byte[IV_LENGTH];
        new SecureRandom().nextBytes(iv);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        GCMParameterSpec spec = new GCMParameterSpec(TAG_LENGTH, iv);
        cipher.init(Cipher.ENCRYPT_MODE, mKey, spec);
        byte[] encryptedBytes = cipher.doFinal(rawFDK);

        byte[] combined = new byte[iv.length + encryptedBytes.length];
        System.arraycopy(iv, 0, combined, 0, iv.length);
        System.arraycopy(encryptedBytes, 0, combined, iv.length, encryptedBytes.length);

        return Base64.getUrlEncoder().withoutPadding().encodeToString(combined);
    }

    // 7. Decriptografa a FDK usando a Chave Mestra
    private static SecretKey decryptFDK(String encFDKBase64, SecretKey mKey) throws Exception {
        byte[] combined = Base64.getUrlDecoder().decode(encFDKBase64);
        byte[] iv = new byte[IV_LENGTH];
        System.arraycopy(combined, 0, iv, 0, IV_LENGTH);

        byte[] encryptedBytes = new byte[combined.length - IV_LENGTH];
        System.arraycopy(combined, IV_LENGTH, encryptedBytes, 0, encryptedBytes.length);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        GCMParameterSpec spec = new GCMParameterSpec(TAG_LENGTH, iv);
        cipher.init(Cipher.DECRYPT_MODE, mKey, spec);
        byte[] rawFDK = cipher.doFinal(encryptedBytes);

        return new SecretKeySpec(rawFDK, "AES");
    }

    // 8. Criptografa Bloco (Chunk) usando a FDK
    private static byte[] encryptChunk(byte[] chunkData, SecretKey fdk) throws Exception {
        byte[] iv = new byte[IV_LENGTH];
        new SecureRandom().nextBytes(iv);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        GCMParameterSpec spec = new GCMParameterSpec(TAG_LENGTH, iv);
        cipher.init(Cipher.ENCRYPT_MODE, fdk, spec);
        byte[] encryptedBytes = cipher.doFinal(chunkData);

        byte[] combined = new byte[iv.length + encryptedBytes.length];
        System.arraycopy(iv, 0, combined, 0, iv.length);
        System.arraycopy(encryptedBytes, 0, combined, iv.length, encryptedBytes.length);
        return combined;
    }

    // 9. Decriptografa Bloco (Chunk) usando a FDK
    private static byte[] decryptChunk(byte[] encryptedChunk, SecretKey fdk) throws Exception {
        byte[] iv = new byte[IV_LENGTH];
        System.arraycopy(encryptedChunk, 0, iv, 0, IV_LENGTH);

        byte[] encryptedBytes = new byte[encryptedChunk.length - IV_LENGTH];
        System.arraycopy(encryptedChunk, IV_LENGTH, encryptedBytes, 0, encryptedBytes.length);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        GCMParameterSpec spec = new GCMParameterSpec(TAG_LENGTH, iv);
        cipher.init(Cipher.DECRYPT_MODE, fdk, spec);
        return cipher.doFinal(encryptedBytes);
    }

    // =======================================================================
    // AUTHENTICATION FLOW
    // =======================================================================

    private static void showAuthMenu() {
        System.out.println("\n" + BOLD + "Escolha uma opção:" + RESET);
        System.out.println("1. Entrar no Cofre (Login)");
        System.out.println("2. Criar Nova Conta (Register)");
        System.out.println("3. Ativar Conta (Verify E-mail)");
        System.out.println("4. Sair do Programa");
        System.out.print(YELLOW + "\nEscolha > " + RESET);

        String option = scanner.nextLine().trim();
        switch (option) {
            case "1":
                handleLogin();
                break;
            case "2":
                handleRegister();
                break;
            case "3":
                handleVerifyEmail();
                break;
            case "4":
                System.out.println(GREEN + "\nFechando SaveBox. Até logo!" + RESET);
                System.exit(0);
                break;
            default:
                System.out.println(RED + "Opção inválida!" + RESET);
        }
    }

    private static void handleLogin() {
        System.out.println(CYAN + "\n--- ENTRAR NO COFRE ---" + RESET);
        System.out.print("Usuário: ");
        String username = scanner.nextLine().trim();
        System.out.print("Senha Mestra: ");
        String password = scanner.nextLine().trim();

        if (username.isEmpty() || password.isEmpty()) {
            System.out.println(RED + "Campos obrigatórios ausentes!" + RESET);
            return;
        }

        try {
            System.out.println(YELLOW + "Autenticando..." + RESET);
            String jsonPayload = String.format("{\"username\":\"%s\",\"password\":\"%s\"}", username, password);

            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(API_URL + "/login"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(jsonPayload))
                    .build();

            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());

            if (resp.statusCode() == 200) {
                String token = getJsonValue(resp.body(), "token");
                jwtToken = token;
                loggedUsername = username;

                // Deriva chave mestra e armazena na RAM do processo
                masterKey = deriveMasterKey(password, username);

                System.out.println(GREEN + "Login efetuado com sucesso! Chave criptográfica derivada." + RESET);
                loadExplorer();
            } else {
                String error = getJsonValue(resp.body(), "error");
                System.out.println(RED + "Erro no login: " + (error.isEmpty() ? resp.body() : error) + RESET);
            }
        } catch (Exception e) {
            System.out.println(RED + "Falha ao se conectar com o servidor: " + e.getMessage() + RESET);
        }
    }

    private static void handleRegister() {
        System.out.println(CYAN + "\n--- CRIAR NOVA CONTA ---" + RESET);
        System.out.print("Nome de Usuário: ");
        String username = scanner.nextLine().trim();
        System.out.print("E-mail: ");
        String email = scanner.nextLine().trim();
        System.out.print("Senha Mestra: ");
        String password = scanner.nextLine().trim();

        if (username.isEmpty() || email.isEmpty() || password.isEmpty()) {
            System.out.println(RED + "Campos obrigatórios ausentes!" + RESET);
            return;
        }

        try {
            System.out.println(YELLOW + "Criando conta..." + RESET);
            String jsonPayload = String.format("{\"username\":\"%s\",\"email\":\"%s\",\"password\":\"%s\"}", username, email, password);

            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(API_URL + "/register"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(jsonPayload))
                    .build();

            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());

            if (resp.statusCode() == 201) {
                System.out.println(GREEN + "Conta criada com sucesso! Verifique seu e-mail para ativar." + RESET);
            } else {
                String error = getJsonValue(resp.body(), "error");
                System.out.println(RED + "Erro no cadastro: " + (error.isEmpty() ? resp.body() : error) + RESET);
            }
        } catch (Exception e) {
            System.out.println(RED + "Falha de rede: " + e.getMessage() + RESET);
        }
    }

    private static void handleVerifyEmail() {
        System.out.println(CYAN + "\n--- ATIVAR CONTA ---" + RESET);
        System.out.print("Token enviado por e-mail: ");
        String token = scanner.nextLine().trim();

        if (token.isEmpty()) {
            System.out.println(RED + "Token é obrigatório!" + RESET);
            return;
        }

        try {
            System.out.println(YELLOW + "Ativando..." + RESET);
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(API_URL + "/verify?token=" + token))
                    .GET()
                    .build();

            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());

            if (resp.statusCode() == 200) {
                System.out.println(GREEN + "Conta ativada com sucesso! Você já pode realizar o login." + RESET);
            } else {
                String error = getJsonValue(resp.body(), "error");
                System.out.println(RED + "Erro de ativação: " + (error.isEmpty() ? resp.body() : error) + RESET);
            }
        } catch (Exception e) {
            System.out.println(RED + "Falha de conexão: " + e.getMessage() + RESET);
        }
    }

    // =======================================================================
    // MAIN APP NAVIGATION FLOW
    // =======================================================================

    private static void showMainMenu() {
        System.out.println("\n" + PURPLE + BOLD + "=========================================================" + RESET);
        System.out.println("  Navegação Atual: " + getFolderPathRepresentation());
        System.out.println(PURPLE + BOLD + "=========================================================" + RESET);

        // List Folders
        boolean hasItems = false;
        System.out.println(BLUE + "\n[PASTAS]" + RESET);
        for (FolderInfo f : currentFolders) {
            if (Objects.equals(f.parentId, currentFolderId)) {
                System.out.println("  └─ Folder ID: " + f.id + " | " + YELLOW + f.name + RESET);
                hasItems = true;
            }
        }
        if (!hasItems) System.out.println("  (Sem subpastas)");

        // List Files
        hasItems = false;
        System.out.println(BLUE + "\n[ARQUIVOS]" + RESET);
        for (FileInfo f : currentFiles) {
            if (Objects.equals(f.folderId, currentFolderId)) {
                System.out.println("  └─ File ID: " + f.id + " | " + GREEN + f.name + RESET + " (" + formatBytes(f.sizeBytes) + ")");
                hasItems = true;
            }
        }
        if (!hasItems) System.out.println("  (Sem arquivos)");

        // Option Choices
        System.out.println("\n" + BOLD + "Comandos do Cofre:" + RESET);
        System.out.println("1. Navegar para subpasta             6. Compartilhar link público");
        System.out.println("2. Voltar para pasta pai             7. Excluir pasta ou arquivo");
        System.out.println("3. Criar nova pasta                  8. Gerenciar Lixeira");
        System.out.println("4. Enviar arquivo local (E2EE)       9. Mostrar quota de uso");
        System.out.println("5. Baixar arquivo criptografado      10. Fechar cofre (Logout)");
        System.out.print(YELLOW + "\nEscolha um comando > " + RESET);

        String option = scanner.nextLine().trim();
        switch (option) {
            case "1":
                navigateToSubfolder();
                break;
            case "2":
                navigateUp();
                break;
            case "3":
                createFolder();
                break;
            case "4":
                uploadFile();
                break;
            case "5":
                downloadFile();
                break;
            case "6":
                shareFile();
                break;
            case "7":
                deleteItem();
                break;
            case "8":
                manageTrash();
                break;
            case "9":
                showQuota();
                break;
            case "10":
                logout();
                break;
            default:
                System.out.println(RED + "Comando inválido!" + RESET);
        }
    }

    private static String getFolderPathRepresentation() {
        if (currentFolderId == null) return "/ Raiz";
        List<String> path = new ArrayList<>();
        Long searchId = currentFolderId;
        while (searchId != null) {
            final Long targetId = searchId;
            FolderInfo match = allSystemFolders.stream().filter(f -> f.id.equals(targetId)).findFirst().orElse(null);
            if (match != null) {
                path.add(0, match.name);
                searchId = match.parentId;
            } else {
                break;
            }
        }
        return "/ Raiz / " + String.join(" / ", path);
    }

    private static void navigateToSubfolder() {
        System.out.print("Digite o ID da pasta que deseja entrar: ");
        String idStr = scanner.nextLine().trim();
        try {
            long targetId = Long.parseLong(idStr);
            FolderInfo match = allSystemFolders.stream().filter(f -> f.id == targetId).findFirst().orElse(null);
            if (match != null) {
                currentFolderId = targetId;
                System.out.println(GREEN + "Entrou na pasta: " + match.name + RESET);
            } else {
                System.out.println(RED + "Pasta não encontrada no nível atual!" + RESET);
            }
        } catch (Exception e) {
            System.out.println(RED + "ID inválido!" + RESET);
        }
    }

    private static void navigateUp() {
        if (currentFolderId == null) {
            System.out.println(YELLOW + "Você já está no diretório raiz." + RESET);
            return;
        }
        Long searchId = currentFolderId;
        FolderInfo current = allSystemFolders.stream().filter(f -> f.id.equals(searchId)).findFirst().orElse(null);
        if (current != null) {
            currentFolderId = current.parentId;
            System.out.println(GREEN + "Subiu de nível." + RESET);
        } else {
            currentFolderId = null;
        }
    }

    private static void logout() {
        jwtToken = "";
        loggedUsername = "";
        masterKey = null;
        currentFolderId = null;
        System.out.println(GREEN + "Chave mestra apagada e sessão terminada!" + RESET);
    }

    // =======================================================================
    // SERVER TREE SYNCHRONIZATION
    // =======================================================================

    private static void loadExplorer() {
        try {
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(API_URL + "/tree"))
                    .header("Authorization", "Bearer " + jwtToken)
                    .GET()
                    .build();

            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() == 401) {
                logout();
                return;
            }

            if (resp.statusCode() == 200) {
                currentFolders.clear();
                currentFiles.clear();
                trashFolders.clear();
                trashFiles.clear();
                allSystemFolders.clear();

                String body = resp.body();

                // Simple JSON array parser for folders
                int foldersStart = body.indexOf("\"folders\":[");
                if (foldersStart != -1) {
                    int foldersEnd = body.indexOf("],\"", foldersStart);
                    if (foldersEnd == -1) foldersEnd = body.indexOf("]}", foldersStart);
                    String foldersArray = body.substring(foldersStart + 10, foldersEnd + 1);
                    parseFolders(foldersArray);
                }

                // Simple JSON array parser for files
                int filesStart = body.indexOf("\"files\":[");
                if (filesStart != -1) {
                    int filesEnd = body.indexOf("]", filesStart);
                    String filesArray = body.substring(filesStart + 8, filesEnd + 1);
                    parseFiles(filesArray);
                }
            }
        } catch (Exception e) {
            System.out.println(RED + "Erro de sincronização da árvore de arquivos: " + e.getMessage() + RESET);
        }
    }

    private static void parseFolders(String jsonArray) {
        Pattern pattern = Pattern.compile("\\{[^\\}]+\\}");
        Matcher matcher = pattern.matcher(jsonArray);
        while (matcher.find()) {
            String obj = matcher.group();
            try {
                long id = Long.parseLong(getJsonValue(obj, "id"));
                String parentIdStr = getJsonValue(obj, "parent_id");
                Long parentId = (parentIdStr.isEmpty() || "null".equals(parentIdStr)) ? null : Long.parseLong(parentIdStr);
                String encName = getJsonValue(obj, "encrypted_name");
                boolean isDeleted = Boolean.parseBoolean(getJsonValue(obj, "is_deleted"));

                // Decriptografa o nome localmente
                String plainName = decryptText(encName, masterKey);

                FolderInfo folder = new FolderInfo(id, parentId, plainName, isDeleted);
                if (isDeleted) {
                    trashFolders.add(folder);
                } else {
                    currentFolders.add(folder);
                    allSystemFolders.add(folder);
                }
            } catch (Exception ignored) {}
        }
    }

    private static void parseFiles(String jsonArray) {
        Pattern pattern = Pattern.compile("\\{[^\\}]+\\}");
        Matcher matcher = pattern.matcher(jsonArray);
        while (matcher.find()) {
            String obj = matcher.group();
            try {
                long id = Long.parseLong(getJsonValue(obj, "id"));
                String folderIdStr = getJsonValue(obj, "folder_id");
                Long folderId = (folderIdStr.isEmpty() || "null".equals(folderIdStr)) ? null : Long.parseLong(folderIdStr);
                String encName = getJsonValue(obj, "encrypted_name");
                long sizeBytes = Long.parseLong(getJsonValue(obj, "size_bytes"));
                String encFDK = getJsonValue(obj, "encrypted_fdk");
                boolean isDeleted = Boolean.parseBoolean(getJsonValue(obj, "is_deleted"));

                // Decriptografa o nome localmente
                String plainName = decryptText(encName, masterKey);

                FileInfo file = new FileInfo(id, folderId, plainName, sizeBytes, encFDK, isDeleted);
                if (isDeleted) {
                    trashFiles.add(file);
                } else {
                    currentFiles.add(file);
                }
            } catch (Exception ignored) {}
        }
    }

    // =======================================================================
    // COFRE DIRECTORY OPERATIONS
    // =======================================================================

    private static void createFolder() {
        System.out.println(CYAN + "\n--- NOVA PASTA ---" + RESET);
        System.out.print("Nome da nova pasta: ");
        String name = scanner.nextLine().trim();

        if (name.isEmpty()) {
            System.out.println(RED + "Nome não pode ser vazio!" + RESET);
            return;
        }

        try {
            // E2EE metadados
            String encryptedName = encryptText(name, masterKey);
            String nameHash = computeSHA256(name);
            String parentIdVal = currentFolderId == null ? "null" : currentFolderId.toString();

            String jsonPayload = String.format(
                    "{\"parent_id\":%s,\"encrypted_name\":\"%s\",\"name_hash\":\"%s\"}",
                    parentIdVal, encryptedName, nameHash
            );

            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(API_URL + "/folders"))
                    .header("Authorization", "Bearer " + jwtToken)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(jsonPayload))
                    .build();

            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());

            if (resp.statusCode() == 201) {
                System.out.println(GREEN + "Pasta \"" + name + "\" criada com sucesso!" + RESET);
                loadExplorer();
            } else {
                String error = getJsonValue(resp.body(), "error");
                System.out.println(RED + "Erro ao criar pasta: " + (error.isEmpty() ? resp.body() : error) + RESET);
            }
        } catch (Exception e) {
            System.out.println(RED + "Erro na requisição: " + e.getMessage() + RESET);
        }
    }

    private static void deleteItem() {
        System.out.println(CYAN + "\n--- EXCLUIR ITEM ---" + RESET);
        System.out.print("Deseja excluir [F] Pasta ou [A] Arquivo? (F/A): ");
        String choice = scanner.nextLine().trim().toUpperCase();
        System.out.print("Digite o ID do item: ");
        String idStr = scanner.nextLine().trim();

        try {
            long targetId = Long.parseLong(idStr);
            String endpoint = choice.equals("F") ? "/folders/" + targetId : "/files/" + targetId;

            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(API_URL + endpoint))
                    .header("Authorization", "Bearer " + jwtToken)
                    .DELETE()
                    .build();

            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());

            if (resp.statusCode() == 200) {
                System.out.println(GREEN + "Item movido para a lixeira!" + RESET);
                loadExplorer();
            } else {
                String error = getJsonValue(resp.body(), "error");
                System.out.println(RED + "Erro ao excluir item: " + (error.isEmpty() ? resp.body() : error) + RESET);
            }
        } catch (Exception e) {
            System.out.println(RED + "Erro de processamento: " + e.getMessage() + RESET);
        }
    }

    // =======================================================================
    // COFRE E2EE CHUNKED UPLOADS
    // =======================================================================

    private static void uploadFile() {
        System.out.println(CYAN + "\n--- ENVIAR ARQUIVO SEGURO (E2EE) ---" + RESET);
        System.out.print("Caminho absoluto ou relativo do arquivo local: ");
        String localPathStr = scanner.nextLine().trim();

        Path localPath = Paths.get(localPathStr);
        if (!Files.exists(localPath) || Files.isDirectory(localPath)) {
            System.out.println(RED + "Arquivo local não encontrado ou inválido!" + RESET);
            return;
        }

        try {
            String plainName = localPath.getFileName().toString();
            long sizeBytes = Files.size(localPath);
            int totalChunks = (int) Math.ceil((double) sizeBytes / CHUNK_SIZE);
            if (totalChunks == 0) totalChunks = 1;

            System.out.println(YELLOW + "Protegendo \"" + plainName + "\" (" + formatBytes(sizeBytes) + ") em " + totalChunks + " blocos..." + RESET);

            // 1. Gera FDK simétrica do arquivo
            SecretKey fdk = generateFDK();

            // 2. Criptografa o nome e gera o hash dele
            String encName = encryptText(plainName, masterKey);
            String nameHash = computeSHA256(plainName);

            // 3. Criptografa a FDK com a nossa Chave Mestra
            String encFDK = encryptFDK(fdk, masterKey);
            String folderIdVal = currentFolderId == null ? "null" : currentFolderId.toString();

            // 4. Inicializa o upload no Crow C++
            String jsonPayload = String.format(
                    "{\"folder_id\":%s,\"encrypted_name\":\"%s\",\"name_hash\":\"%s\",\"encrypted_fdk\":\"%s\",\"size_bytes\":%d,\"total_chunks\":%d}",
                    folderIdVal, encName, nameHash, encFDK, sizeBytes, totalChunks
            );

            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(API_URL + "/files"))
                    .header("Authorization", "Bearer " + jwtToken)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(jsonPayload))
                    .build();

            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());

            if (resp.statusCode() != 201) {
                String error = getJsonValue(resp.body(), "error");
                System.out.println(RED + "Falha ao inicializar upload: " + (error.isEmpty() ? resp.body() : error) + RESET);
                return;
            }

            long fileId = Long.parseLong(getJsonValue(resp.body(), "file_id"));

            // 5. Lê o arquivo local e envia os chunks criptografados em tempo de execução
            try (InputStream is = Files.newInputStream(localPath)) {
                byte[] buffer = new byte[CHUNK_SIZE];
                int bytesRead;
                int chunkIndex = 0;

                while ((bytesRead = is.read(buffer)) != -1) {
                    byte[] actualChunkData = bytesRead == CHUNK_SIZE ? buffer : Arrays.copyOf(buffer, bytesRead);

                    // Criptografa o bloco binário usando AES-GCM
                    byte[] encryptedChunk = encryptChunk(actualChunkData, fdk);

                    System.out.printf("Criptografando & Transmitindo bloco %d/%d...\n", chunkIndex + 1, totalChunks);

                    // Envia a requisição binária do chunk
                    HttpRequest chunkReq = HttpRequest.newBuilder()
                            .uri(URI.create(API_URL + "/files/" + fileId + "/chunks"))
                            .header("Authorization", "Bearer " + jwtToken)
                            .header("Content-Type", "application/octet-stream")
                            .header("X-Chunk-Index", String.valueOf(chunkIndex))
                            .POST(HttpRequest.BodyPublishers.ofByteArray(encryptedChunk))
                            .build();

                    HttpResponse<String> chunkResp = httpClient.send(chunkReq, HttpResponse.BodyHandlers.ofString());

                    if (chunkResp.statusCode() != 200) {
                        System.out.println(RED + "\nErro ao transmitir bloco " + chunkIndex + ": " + chunkResp.body() + RESET);
                        return;
                    }

                    chunkIndex++;
                }
            }

            System.out.println(GREEN + "\nArquivo \"" + plainName + "\" criptografado e enviado com sucesso!" + RESET);
            loadExplorer();
        } catch (Exception e) {
            System.out.println(RED + "Erro crítico no upload: " + e.getMessage() + RESET);
        }
    }

    // =======================================================================
    // COFRE E2EE CHUNKED DOWNLOADS
    // =======================================================================

    private static void downloadFile() {
        System.out.println(CYAN + "\n--- BAIXAR ARQUIVO (DECIFRAÇÃO DE HARDWARE) ---" + RESET);
        System.out.print("Digite o ID do arquivo no cofre: ");
        String idStr = scanner.nextLine().trim();
        System.out.print("Caminho absoluto para salvar localmente (ex: C:\\Users\\...\\Downloads\\teste.pdf): ");
        String localDestStr = scanner.nextLine().trim();

        try {
            long fileId = Long.parseLong(idStr);
            FileInfo file = currentFiles.stream().filter(f -> f.id == fileId).findFirst().orElse(null);

            if (file == null) {
                System.out.println(RED + "Arquivo não encontrado no cofre!" + RESET);
                return;
            }

            System.out.println(YELLOW + "Obtendo cofre para \"" + file.name + "\"..." + RESET);

            // 1. Decriptografa a FDK localmente usando nossa chave mestra na RAM
            SecretKey fdk = decryptFDK(file.encryptedFDK, masterKey);

            // 2. Calcula chunks e faz requisição de Range
            long sizeBytes = file.sizeBytes;
            int totalChunks = (int) Math.ceil((double) sizeBytes / CHUNK_SIZE);
            if (totalChunks == 0) totalChunks = 1;

            System.out.println(YELLOW + "Baixando e descriptografando " + totalChunks + " blocos simétricos..." + RESET);

            Path destPath = Paths.get(localDestStr);
            // Cria subdiretórios se necessário
            if (destPath.getParent() != null) {
                Files.createDirectories(destPath.getParent());
            }

            try (OutputStream os = Files.newOutputStream(destPath)) {
                for (int index = 0; index < totalChunks; index++) {
                    // O C++ API retorna o chunk criptografado contendo o envelope de 12 bytes IV + 16 bytes Tag
                    long startByte = (long) index * (CHUNK_SIZE + 28);
                    long endByte = Math.min((long) (index + 1) * (CHUNK_SIZE + 28) - 1, sizeBytes + (long) totalChunks * 28);

                    System.out.printf("Baixando bloco %d/%d (Range bytes=%d-%d)...\n", index + 1, totalChunks, startByte, endByte);

                    HttpRequest downloadReq = HttpRequest.newBuilder()
                            .uri(URI.create(API_URL + "/files/" + file.id + "/download"))
                            .header("Authorization", "Bearer " + jwtToken)
                            .header("Range", "bytes=" + startByte + "-" + endByte)
                            .GET()
                            .build();

                    HttpResponse<byte[]> downloadResp = httpClient.send(downloadReq, HttpResponse.BodyHandlers.ofByteArray());

                    if (downloadResp.statusCode() != 206 && downloadResp.statusCode() != 200) {
                        System.out.println(RED + "Falha no download do bloco " + index + "! Status: " + downloadResp.statusCode() + RESET);
                        return;
                    }

                    byte[] encryptedChunk = downloadResp.body();

                    // Decriptografa os bytes planos usando a FDK local
                    byte[] plainChunk = decryptChunk(encryptedChunk, fdk);
                    os.write(plainChunk);
                }
            }

            System.out.println(GREEN + "\nDownload concluído! Arquivo \"" + file.name + "\" descriptografado e salvo com sucesso." + RESET);
        } catch (Exception e) {
            System.out.println(RED + "Erro no download: " + e.getMessage() + RESET);
        }
    }

    // =======================================================================
    // COFRE ZERO-KNOWLEDGE PUBLIC SHARING
    // =======================================================================

    private static void shareFile() {
        System.out.println(CYAN + "\n--- COMPARTILHAR LINK SEGURO (E2EE) ---" + RESET);
        System.out.print("Digite o ID do arquivo para gerar o link público: ");
        String idStr = scanner.nextLine().trim();

        try {
            long fileId = Long.parseLong(idStr);
            FileInfo file = currentFiles.stream().filter(f -> f.id == fileId).findFirst().orElse(null);

            if (file == null) {
                System.out.println(RED + "Arquivo não encontrado!" + RESET);
                return;
            }

            System.out.println(YELLOW + "Gerando assinatura pública..." + RESET);

            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(API_URL + "/files/" + fileId + "/share"))
                    .header("Authorization", "Bearer " + jwtToken)
                    .POST(HttpRequest.BodyPublishers.noBody())
                    .build();

            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());

            if (resp.statusCode() == 200) {
                String shareUUID = getJsonValue(resp.body(), "share_uuid");
                
                // Para que o link seja Zero-Knowledge, deciframos a nossa FDK criptografada e passamos a FDK simétrica pura 
                // no hash fragment (#) do link! O hash fragment do link NUNCA vai para o servidor e é mantido estritamente no cliente!
                SecretKey fdkKey = decryptFDK(file.encryptedFDK, masterKey);
                byte[] rawKeyBytes = fdkKey.getEncoded();
                String rawKeyBase64 = Base64.getUrlEncoder().withoutPadding().encodeToString(rawKeyBytes);

                String publicLink = String.format("http://localhost:3000/index.html?share=%s#%s:%s",
                        shareUUID, rawKeyBase64, java.net.URLEncoder.encode(file.name, StandardCharsets.UTF_8.toString())
                );

                System.out.println(GREEN + "\nLink público gerado com sucesso!" + RESET);
                System.out.println("Qualquer pessoa com o link poderá baixar e decodificar totalmente offline.");
                System.out.println(YELLOW + BOLD + publicLink + RESET);
            } else {
                System.out.println(RED + "Falha ao gerar link: " + resp.body() + RESET);
            }
        } catch (Exception e) {
            System.out.println(RED + "Erro: " + e.getMessage() + RESET);
        }
    }

    // =======================================================================
    // TRASH BIN CONTROL
    // =======================================================================

    private static void manageTrash() {
        while (true) {
            System.out.println(CYAN + "\n--- LIXEIRA DO COFRE ---" + RESET);
            
            // List deleted folders
            System.out.println(BLUE + "[PASTAS EXCLUÍDAS]" + RESET);
            for (FolderInfo f : trashFolders) {
                System.out.println("  └─ ID: " + f.id + " | " + YELLOW + f.name + RESET);
            }
            if (trashFolders.isEmpty()) System.out.println("  (Sem pastas na lixeira)");

            // List deleted files
            System.out.println(BLUE + "\n[ARQUIVOS EXCLUÍDOS]" + RESET);
            for (FileInfo f : trashFiles) {
                System.out.println("  └─ ID: " + f.id + " | " + GREEN + f.name + RESET + " (" + formatBytes(f.sizeBytes) + ")");
            }
            if (trashFiles.isEmpty()) System.out.println("  (Sem arquivos na lixeira)");

            System.out.println("\nComandos da Lixeira:");
            System.out.println("1. Restaurar Pasta                   3. Esvaziar Lixeira");
            System.out.println("2. Restaurar Arquivo                 4. Voltar");
            System.out.print(YELLOW + "\nEscolha > " + RESET);

            String option = scanner.nextLine().trim();
            if (option.equals("4")) break;

            switch (option) {
                case "1":
                    System.out.print("ID da pasta a restaurar: ");
                    String fId = scanner.nextLine().trim();
                    postRestore("/folders/" + fId + "/restore");
                    break;
                case "2":
                    System.out.print("ID do arquivo a restaurar: ");
                    String filId = scanner.nextLine().trim();
                    postRestore("/files/" + filId + "/restore");
                    break;
                case "3":
                    emptyTrash();
                    break;
                default:
                    System.out.println(RED + "Opção inválida!" + RESET);
            }
        }
    }

    private static void postRestore(String endpoint) {
        try {
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(API_URL + endpoint))
                    .header("Authorization", "Bearer " + jwtToken)
                    .POST(HttpRequest.BodyPublishers.noBody())
                    .build();

            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());

            if (resp.statusCode() == 200) {
                System.out.println(GREEN + "Item restaurado com sucesso!" + RESET);
                loadExplorer();
            } else {
                System.out.println(RED + "Erro ao restaurar: " + resp.body() + RESET);
            }
        } catch (Exception e) {
            System.out.println(RED + "Erro na rede: " + e.getMessage() + RESET);
        }
    }

    private static void emptyTrash() {
        try {
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(API_URL + "/trash/empty"))
                    .header("Authorization", "Bearer " + jwtToken)
                    .DELETE()
                    .build();

            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());

            if (resp.statusCode() == 200) {
                System.out.println(GREEN + "Lixeira esvaziada de forma definitiva!" + RESET);
                loadExplorer();
            } else {
                System.out.println(RED + "Erro ao esvaziar lixeira: " + resp.body() + RESET);
            }
        } catch (Exception e) {
            System.out.println(RED + "Erro: " + e.getMessage() + RESET);
        }
    }

    // =======================================================================
    // UTILITIES & HELPER FUNCTIONS
    // =======================================================================

    private static void showQuota() {
        try {
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(API_URL + "/users/me/quota"))
                    .header("Authorization", "Bearer " + jwtToken)
                    .GET()
                    .build();

            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() == 200) {
                long used = Long.parseLong(getJsonValue(resp.body(), "quota_used"));
                long total = Long.parseLong(getJsonValue(resp.body(), "quota_limit"));
                double perc = ((double) used / total) * 100;

                System.out.println(CYAN + "\n--- QUOTA DE USO ---" + RESET);
                System.out.printf("Espaço Utilizado: %s\n", formatBytes(used));
                System.out.printf("Espaço Total:     %s\n", formatBytes(total));
                System.out.printf("Status Quota:     %.2f%% ocupado\n", perc);
            }
        } catch (Exception e) {
            System.out.println(RED + "Erro ao buscar quota: " + e.getMessage() + RESET);
        }
    }

    // Simple JSON value extractor (Regex based, Zero-dependency)
    private static String getJsonValue(String json, String key) {
        String pattern = "\"" + key + "\"\\s*:\\s*\"?([^\",\\}]+)\"?";
        Matcher matcher = Pattern.compile(pattern).matcher(json);
        if (matcher.find()) {
            String val = matcher.group(1).trim();
            if (val.endsWith("\"")) {
                val = val.substring(0, val.length() - 1);
            }
            if (val.startsWith("\"")) {
                val = val.substring(1);
            }
            return val;
        }
        return "";
    }

    private static String formatBytes(long bytes) {
        if (bytes == 0) return "0 Bytes";
        String[] units = {"Bytes", "KB", "MB", "GB", "TB"};
        int index = (int) (Math.log(bytes) / Math.log(1024));
        return String.format("%.2f %s", bytes / Math.pow(1024, index), units[index]);
    }

    // --- INNER CLASS REPRESENTATIONS ---
    private static class FolderInfo {
        long id;
        Long parentId;
        String name;
        boolean isDeleted;

        FolderInfo(long id, Long parentId, String name, boolean isDeleted) {
            this.id = id;
            this.parentId = parentId;
            this.name = name;
            this.isDeleted = isDeleted;
        }
    }

    private static class FileInfo {
        long id;
        Long folderId;
        String name;
        long sizeBytes;
        String encryptedFDK;
        boolean isDeleted;

        FileInfo(long id, Long folderId, String name, long sizeBytes, String encryptedFDK, boolean isDeleted) {
            this.id = id;
            this.folderId = folderId;
            this.name = name;
            this.sizeBytes = sizeBytes;
            this.encryptedFDK = encryptedFDK;
            this.isDeleted = isDeleted;
        }
    }
}
