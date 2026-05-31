<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'

// --- CONSTANTS ---
const API_URL = "http://localhost:8080";
const CHUNK_SIZE = 5 * 1024 * 1024 - 28; // 5,242,852 bytes (so encrypted chunk size is exactly 5,242,880 bytes / 5MB)

// --- AUTHENTICATION STATE ---
const isAuthenticated = ref(false);
const authView = ref("login"); // 'login' | 'register' | 'verify'
const authLoading = ref(false);
const username = ref("");
const token = ref("");
const masterKey = ref(null); // CryptoKey object kept in memory (never written to localstorage)

const authForm = reactive({
    username: "",
    email: "",
    password: "",
    token: ""
});

// --- SIDEBAR & QUOTA STATE ---
const currentTab = ref("files"); // 'files' | 'trash'
const quotaUsed = ref(0);
const quotaTotal = ref(10737418240); // 10 GB default

const isDarkMode = ref(true);

function toggleTheme() {
    isDarkMode.value = !isDarkMode.value;
    localStorage.setItem("savebox_theme", isDarkMode.value ? "dark" : "light");
    updateThemeClass();
}

function updateThemeClass() {
    if (isDarkMode.value) {
        document.body.classList.remove("light-theme");
    } else {
        document.body.classList.add("light-theme");
    }
}

const quotaPercent = computed(() => {
    if (quotaTotal.value === 0) return 0;
    return Math.min(100, Math.round((quotaUsed.value / quotaTotal.value) * 100));
});

// --- EXPLORER STATE ---
const currentFolderId = ref(null); // null = Root
const folders = ref([]);
const files = ref([]);
const trashFolders = ref([]);
const trashFiles = ref([]);
const breadcrumbs = ref([]);
const searchQuery = ref("");
const dragActive = ref(false);
const showNewDropdown = ref(false);
const showTransfersPanel = ref(true);
const isTransfersExpanded = ref(true);

// All folders in the system (for move directory select)
const allSystemFolders = ref([]);

// --- TOAST NOTIFICATIONS ---
const toasts = ref([]);
let toastIdCounter = 0;

function showToast(title, message, type = "info") {
    const id = toastIdCounter++;
    toasts.value.push({ id, title, message, type });
    setTimeout(() => removeToast(id), 5000);
}

function removeToast(id) {
    toasts.value = toasts.value.filter(t => t.id !== id);
}

function getToastIcon(type) {
    switch (type) {
        case "success": return "fa-solid fa-circle-check";
        case "error": return "fa-solid fa-circle-exclamation";
        case "warning": return "fa-solid fa-triangle-exclamation";
        default: return "fa-solid fa-circle-info";
    }
}

// --- ACTIVE TRANSFERS (UPLOADS / DOWNLOADS) ---
const uploads = ref([]); // { id, name, progress, status, statusText }
let uploadIdCounter = 0;

// --- MODALS STATE ---
const modal = reactive({
    showCreateFolder: false,
    folderName: "",
    showRename: false,
    renameItem: null,
    renameType: "file", // 'file' | 'folder'
    renameName: "",
    renameParentId: 0,
    showShare: false,
    shareLink: ""
});

const modalPreview = reactive({
    show: false,
    loading: false,
    file: null,
    url: "",
    type: "", // 'image' | 'pdf' | 'audio' | 'video' | 'text' | 'unsupported'
    textContent: ""
});

const isVaultLocked = ref(false);
const unlockPassword = ref("");

async function unlockVault() {
    if (!unlockPassword.value) return;
    authLoading.value = true;
    try {
        masterKey.value = await deriveMasterKey(unlockPassword.value, username.value);
        isVaultLocked.value = false;
        isAuthenticated.value = true;
        showToast("Cofre Desbloqueado", `Chave mestra carregada com sucesso para ${username.value}.`, "success");
        await refreshQuota();
        await loadExplorer();
        loadPendingUploadsFromStorage();
        unlockPassword.value = "";
    } catch (e) {
        showToast("Senha Incorreta", "Não foi possível desbloquear o cofre. Verifique sua senha mestra.", "error");
    } finally {
        authLoading.value = false;
    }
}

// --- HELPER METADATA FOR FOLDER SELECTS ---
const availableFoldersForMove = computed(() => {
    if (modal.renameType === 'folder' && modal.renameItem) {
        // Cannot move a folder into itself or its subfolders
        return allSystemFolders.value.filter(f => f.id !== modal.renameItem.id);
    }
    return allSystemFolders.value;
});

// =======================================================================
// ZERO-KNOWLEDGE E2EE CRYPTOGRAPHY ENGINE (WEB CRYPTO)
// =======================================================================

// 1. Deriva Chave Mestra a partir de senha + salt (username) usando PBKDF2
async function deriveMasterKey(password, saltText) {
    const encoder = new TextEncoder();
    const baseKey = await globalThis.crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        "PBKDF2",
        false,
        ["deriveKey"]
    );
    const salt = encoder.encode(saltText.toLowerCase().trim());
    return window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256"
        },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false, // não extraível para segurança na RAM
        ["encrypt", "decrypt"]
    );
}

// 2. Criptografa Texto (nomes de pastas/arquivos) usando AES-GCM 256
async function encryptText(text, key) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        data
    );
    
    // Combina IV + Ciphertext
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    
    // Converte para Base64 seguro para URL
    return btoa(String.fromCharCode.apply(null, combined))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

// 3. Decriptografa Texto (nomes de pastas/arquivos) usando AES-GCM 256
async function decryptText(base64Text, key) {
    try {
        // Normaliza base64 seguro para URL
        let str = base64Text.replace(/-/g, '+').replace(/_/g, '/');
        while (str.length % 4) str += '=';
        
        const rawBin = atob(str);
        const combined = new Uint8Array(rawBin.length);
        for (let i = 0; i < rawBin.length; i++) {
            combined[i] = rawBin.charCodeAt(i);
        }

        const iv = combined.slice(0, 12);
        const data = combined.slice(12);

        const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            key,
            data
        );
        return new TextDecoder().decode(decrypted);
    } catch (err) {
        console.error("Erro na decodificação de metadados:", err);
        return "[Metadados Corrompidos / Chave Incorreta]";
    }
}

// 4. Calcula Hash SHA-256 para prevenção de nomes duplicados (Zero-Knowledge)
async function computeSHA256(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text.trim().toLowerCase());
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 5. Gera uma Chave de Arquivo Aleatória (FDK - File Decryption Key)
async function generateFDK() {
    return window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true, // extraível para podermos criptografá-la com a Chave Mestra
        ["encrypt", "decrypt"]
    );
}

// 6. Criptografa a FDK com a Chave Mestra para armazenar no servidor
async function encryptFDK(fdk, mKey) {
    const rawFDK = await window.crypto.subtle.exportKey("raw", fdk);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        mKey,
        rawFDK
    );

    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);

    return btoa(String.fromCharCode.apply(null, combined))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

// 7. Decriptografa a FDK usando a Chave Mestra
async function decryptFDK(encFDKBase64, mKey) {
    let str = encFDKBase64.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';

    const rawBin = atob(str);
    const combined = new Uint8Array(rawBin.length);
    for (let i = 0; i < rawBin.length; i++) {
        combined[i] = rawBin.charCodeAt(i);
    }

    const iv = combined.slice(0, 12);
    const data = combined.slice(12);

    const rawFDK = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        mKey,
        data
    );

    return window.crypto.subtle.importKey(
        "raw",
        rawFDK,
        "AES-GCM",
        true,
        ["encrypt", "decrypt"]
    );
}

// 8. Criptografa Chunk binário (ArrayBuffer) usando a FDK
async function encryptChunk(arrayBuffer, fdk) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        fdk,
        arrayBuffer
    );

    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    return combined;
}

// 9. Decriptografa Chunk binário usando a FDK
async function decryptChunk(encryptedBytes, fdk) {
    const iv = encryptedBytes.slice(0, 12);
    const data = encryptedBytes.slice(12);

    return window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        fdk,
        data
    );
}

// =======================================================================
// API CLIENT REQUEST HANDLERS
// =======================================================================

async function fetchAPI(endpoint, options = {}) {
    const headers = options.headers || {};
    if (token.value) {
        headers["Authorization"] = `Bearer ${token.value}`;
    }

    const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers
    });

    if (response.status === 401) {
        showToast("Sessão Expirada", "Por favor, faça login novamente.", "error");
        logout();
        throw new Error("UNAUTHORIZED");
    }

    return response;
}

// --- AUTH FLOW ---
async function handleLogin() {
    authLoading.value = true;
    try {
        const response = await fetch(`${API_URL}/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: authForm.username,
                password: authForm.password
            })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "Erro de login");
        }

        // Autenticado com sucesso!
        token.value = data.token;
        username.value = authForm.username;

        // Salva o token no localStorage
        localStorage.setItem("savebox_token", token.value);
        localStorage.setItem("savebox_username", username.value);

        // Deriva e armazena a Chave Mestra na RAM
        masterKey.value = await deriveMasterKey(authForm.password, authForm.username);

        isAuthenticated.value = true;
        showToast("Acesso Autorizado", `Cofre de ${username.value} aberto com sucesso.`, "success");
        
        // Limpa form
        authForm.password = "";

        // Carrega dados iniciais
        await refreshQuota();
        await loadExplorer();
        loadPendingUploadsFromStorage();
    } catch (err) {
        showToast("Falha na Autenticação", err.message, "error");
    } finally {
        authLoading.value = false;
    }
}

async function handleRegister() {
    authLoading.value = true;
    try {
        const response = await fetch(`${API_URL}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: authForm.username,
                email: authForm.email,
                password: authForm.password
            })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "Erro no cadastro");
        }

        showToast("Conta Criada", "Verifique seu e-mail para ativar sua conta.", "success");
        authView.value = "verify";
    } catch (err) {
        showToast("Erro no Registro", err.message, "error");
    } finally {
        authLoading.value = false;
    }
}

async function handleVerifyEmail() {
    authLoading.value = true;
    try {
        const response = await fetch(`${API_URL}/verify?token=${encodeURIComponent(authForm.token)}`, {
            method: "GET"
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "Falha na ativação");
        }

        showToast("Conta Ativada", "Seu e-mail foi verificado. Você já pode acessar seu cofre.", "success");
        authView.value = "login";
        authForm.token = "";
    } catch (err) {
        showToast("Erro na Verificação", err.message, "error");
    } finally {
        authLoading.value = false;
    }
}

function logout() {
    token.value = "";
    username.value = "";
    masterKey.value = null;
    isAuthenticated.value = false;
    isVaultLocked.value = false;
    localStorage.removeItem("savebox_token");
    localStorage.removeItem("savebox_username");
    showToast("Cofre Fechado", "Você saiu da sua conta e a chave foi apagada da RAM.", "info");
}

// --- DASHBOARD DATA FLOW ---
async function refreshQuota() {
    try {
        const res = await fetchAPI("/users/me/quota");
        if (res.ok) {
            const data = await res.json();
            quotaUsed.value = parseInt(data.used_bytes) || 0;
            quotaTotal.value = parseInt(data.max_bytes) || 10737418240;
        }
    } catch (err) {
        console.error("Erro ao obter quota:", err);
    }
}

async function loadExplorer() {
    if (!isAuthenticated.value) return;

    try {
        // Busca a árvore inteira para decriptografar localmente e estruturar a navegação
        const res = await fetchAPI("/tree");
        if (!res.ok) throw new Error("Falha ao obter estrutura");

        const data = await res.json();

        // Decriptografa pastas
        const decryptedFolders = await Promise.all(
            (data.folders || []).map(async f => {
                const plainName = await decryptText(f.encrypted_name, masterKey.value);
                return {
                    id: f.id,
                    parentId: f.parent_id || null,
                    name: plainName,
                    createdAt: f.created_at,
                    updatedAt: f.updated_at,
                    isDeleted: f.is_deleted
                };
            })
        );

        // Decriptografa arquivos
        const decryptedFiles = await Promise.all(
            (data.files || []).map(async fil => {
                const plainName = await decryptText(fil.encrypted_name, masterKey.value);
                return {
                    id: fil.id,
                    folderId: fil.folder_id || null,
                    name: plainName,
                    sizeBytes: fil.size_bytes,
                    encryptedFDK: fil.encrypted_fdk,
                    createdAt: fil.created_at,
                    updatedAt: fil.updated_at,
                    isDeleted: fil.is_deleted
                };
            })
        );

        // Armazena todas as pastas do sistema para os modais
        allSystemFolders.value = decryptedFolders.filter(f => !f.isDeleted);

        // Separa os itens que estão ativos daqueles que estão na lixeira
        folders.value = decryptedFolders.filter(f => !f.isDeleted);
        files.value = decryptedFiles.filter(fil => !fil.isDeleted);

        // Busca os itens deletados na lixeira
        const trashRes = await fetchAPI("/trash");
        if (trashRes.ok) {
            const trashData = await trashRes.json();
            
            trashFolders.value = await Promise.all(
                (trashData.folders || []).map(async f => {
                    const plainName = await decryptText(f.encrypted_name, masterKey.value);
                    return {
                        id: f.id,
                        name: plainName,
                        updatedAt: f.deleted_at || null,
                        isDeleted: true
                    };
                })
            );

            trashFiles.value = await Promise.all(
                (trashData.files || []).map(async fil => {
                    const plainName = await decryptText(fil.encrypted_name, masterKey.value);
                    return {
                        id: fil.id,
                        name: plainName,
                        sizeBytes: fil.size_bytes,
                        updatedAt: fil.deleted_at || null,
                        isDeleted: true
                    };
                })
            );
        } else {
            trashFolders.value = [];
            trashFiles.value = [];
        }

        // Reconstrói Breadcrumbs
        rebuildBreadcrumbs();
    } catch (err) {
        showToast("Erro ao carregar arquivos", err.message, "error");
    }
}

// --- NAVIGATION & FILTERS ---
const filteredFolders = computed(() => {
    let list = folders.value.filter(f => f.parentId === currentFolderId.value);
    if (searchQuery.value) {
        const query = searchQuery.value.toLowerCase();
        list = list.filter(f => f.name.toLowerCase().includes(query));
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
});

const filteredFiles = computed(() => {
    let list = files.value.filter(fil => fil.folderId === currentFolderId.value);
    if (searchQuery.value) {
        const query = searchQuery.value.toLowerCase();
        list = list.filter(fil => fil.name.toLowerCase().includes(query));
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
});

const folderTree = computed(() => {
    const rootFolders = allSystemFolders.value.filter(f => f.parentId === null);
    const result = [];
    
    function traverse(folder, depth) {
        result.push({
            ...folder,
            depth
        });
        const children = allSystemFolders.value.filter(f => f.parentId === folder.id)
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const child of children) {
            traverse(child, depth + 1);
        }
    }
    
    rootFolders.sort((a, b) => a.name.localeCompare(b.name)).forEach(rf => traverse(rf, 0));
    return result;
});

function navigateToFolder(folderId) {
    currentFolderId.value = folderId;
    searchQuery.value = "";
    rebuildBreadcrumbs();
}

function rebuildBreadcrumbs() {
    if (!currentFolderId.value) {
        breadcrumbs.value = [];
        return;
    }

    const trail = [];
    let currentId = currentFolderId.value;

    while (currentId) {
        const folder = folders.value.find(f => f.id === currentId);
        if (folder) {
            trail.unshift({ id: folder.id, name: folder.name });
            currentId = folder.parentId;
        } else {
            break;
        }
    }
    breadcrumbs.value = trail;
}

function getFolderPathRepresentation(folderId) {
    const trail = [];
    let currentId = folderId;
    while (currentId) {
        const folder = folders.value.find(f => f.id === currentId);
        if (folder) {
            trail.unshift(folder.name);
            currentId = folder.parentId;
        } else {
            break;
        }
    }
    return "/" + trail.join("/");
}

function setTab(tab) {
    currentTab.value = tab;
    searchQuery.value = "";
    loadExplorer();
}

// --- DIRECTORY / FOLDER ACTIONS ---
function openCreateFolderModal() {
    modal.folderName = "";
    modal.showCreateFolder = true;
}

async function createFolder() {
    if (!modal.folderName.trim()) return;

    try {
        const plainName = modal.folderName.trim();
        const encryptedName = await encryptText(plainName, masterKey.value);
        const nameHash = await computeSHA256(plainName);

        const res = await fetchAPI("/folders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                parent_id: currentFolderId.value,
                encrypted_name: encryptedName,
                name_hash: nameHash
            })
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "Falha ao criar pasta");
        }

        showToast("Pasta Criada", `A pasta "${plainName}" foi criada com sucesso.`, "success");
        modal.showCreateFolder = false;
        await loadExplorer();
    } catch (err) {
        showToast("Erro ao criar pasta", err.message, "error");
    }
}

async function deleteFolder(folderId) {
    try {
        const res = await fetchAPI(`/folders/${folderId}`, {
            method: "DELETE"
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Erro ao mover para a lixeira");
        }

        showToast("Pasta Excluída", "Pasta movida para a lixeira.", "success");
        await loadExplorer();
        await refreshQuota();
    } catch (err) {
        showToast("Erro", err.message, "error");
    }
}

// --- FILE ACTIONS: RENAME / MOVE ---
function openRenameModal(item, type) {
    modal.renameItem = item;
    modal.renameType = type;
    modal.renameName = item.name;
    modal.renameParentId = type === "file" ? (item.folderId || 0) : (item.parentId || 0);
    modal.showRename = true;
}

async function saveRename() {
    if (!modal.renameName.trim()) return;
    const newPlainName = modal.renameName.trim();

    try {
        const encName = await encryptText(newPlainName, masterKey.value);
        const nameHash = await computeSHA256(newPlainName);
        const parentIdVal = modal.renameParentId === 0 ? null : modal.renameParentId;

        let endpoint = "";
        let body = {};

        if (modal.renameType === "file") {
            endpoint = `/files/${modal.renameItem.id}`;
            body = {
                encrypted_name: encName,
                name_hash: nameHash,
                folder_id: parentIdVal
            };
        } else {
            endpoint = `/folders/${modal.renameItem.id}`;
            body = {
                encrypted_name: encName,
                name_hash: nameHash,
                parent_id: parentIdVal
            };
        }

        const res = await fetchAPI(endpoint, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Falha na atualização");
        }

        showToast("Item Atualizado", "Nome e localização atualizados.", "success");
        modal.showRename = false;
        await loadExplorer();
    } catch (err) {
        showToast("Erro ao editar item", err.message, "error");
    }
}

async function deleteFile(fileId) {
    try {
        const res = await fetchAPI(`/files/${fileId}`, {
            method: "DELETE"
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Erro ao excluir arquivo");
        }

        showToast("Arquivo Excluído", "Arquivo movido para a lixeira.", "success");
        await loadExplorer();
        await refreshQuota();
    } catch (err) {
        showToast("Erro", err.message, "error");
    }
}

// --- TRASH BIN ACTIONS ---
async function restoreFolder(folderId) {
    try {
        const res = await fetchAPI(`/folders/${folderId}/restore`, {
            method: "POST"
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Erro ao restaurar pasta");
        }

        showToast("Pasta Restaurada", "Pasta retornada ao local original.", "success");
        await loadExplorer();
    } catch (err) {
        showToast("Erro ao restaurar", err.message, "error");
    }
}

async function restoreFile(fileId) {
    try {
        const res = await fetchAPI(`/files/${fileId}/restore`, {
            method: "POST"
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Erro ao restaurar arquivo");
        }

        showToast("Arquivo Restaurado", "Arquivo retornado ao local original.", "success");
        await loadExplorer();
        await refreshQuota();
    } catch (err) {
        showToast("Erro ao restaurar", err.message, "error");
    }
}

async function emptyTrash() {
    try {
        const res = await fetchAPI("/trash/empty", {
            method: "DELETE"
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Erro ao esvaziar lixeira");
        }

        showToast("Lixeira Esvaziada", "Todos os itens foram deletados definitivamente.", "success");
        await loadExplorer();
        await refreshQuota();
    } catch (err) {
        showToast("Erro", err.message, "error");
    }
}

// =======================================================================
// E2EE CHUNKED FILE UPLOADER
// =======================================================================

const fileInputRef = ref(null);

function triggerFileInput() {
    if (fileInputRef.value) {
        fileInputRef.value.click();
    }
}

function handleFileSelection(event) {
    const filesSelected = event.target.files;
    if (filesSelected && filesSelected.length > 0) {
        for (let i = 0; i < filesSelected.length; i++) {
            uploadFilePipeline(filesSelected[i]);
        }
    }
}

function handleFileDrop(event) {
    dragActive.value = false;
    const filesDropped = event.dataTransfer.files;
    if (filesDropped && filesDropped.length > 0) {
        for (let i = 0; i < filesDropped.length; i++) {
            uploadFilePipeline(filesDropped[i]);
        }
    }
}

async function uploadFilePipeline(fileObject) {
    const uploadTracker = reactive({
        id: uploadIdCounter++,
        name: fileObject.name,
        progress: 0,
        status: "uploading",
        statusText: "Processando..."
    });
    uploads.value.unshift(uploadTracker);
    showTransfersPanel.value = true;
    isTransfersExpanded.value = true;

    try {
        let fileId;
        let fdk;
        let encFDK;
        let totalChunks;
        const sizeBytes = fileObject.size;
        const plainName = fileObject.name;
        let uploadedChunksSet = new Set();
        
        // 1. Verifica se já existe um upload pendente/incompleto para este mesmo arquivo nesta mesma pasta
        const pendingUploads = JSON.parse(localStorage.getItem("savebox_pending_uploads") || "[]");
        const pendingEntry = pendingUploads.find(p => p.name === plainName && p.sizeBytes === sizeBytes && p.folderId === currentFolderId.value);
        
        if (pendingEntry) {
            uploadTracker.statusText = "Retomando upload parcial...";
            fileId = pendingEntry.fileId;
            encFDK = pendingEntry.encryptedFDK;
            totalChunks = pendingEntry.totalChunks;
            uploadTracker.fileId = fileId; // Vincula para futuras manipulações
            
            // Decriptografa a FDK localmente usando a Chave Mestra na RAM
            fdk = await decryptFDK(encFDK, masterKey.value);
            
            // Busca chunks já gravados com sucesso no servidor C++
            const chunksRes = await fetchAPI(`/files/${fileId}/uploaded-chunks`, { method: "GET" });
            if (chunksRes.ok) {
                const chunksData = await chunksRes.json();
                const uploadedArray = chunksData.uploaded_chunks || [];
                uploadedChunksSet = new Set(uploadedArray);
                uploadTracker.progress = Math.round((uploadedArray.length / totalChunks) * 100);
                showToast("Upload Retomado", `Retomando envio de "${plainName}" do bloco ${uploadedArray.length + 1}.`, "info");
            } else {
                console.warn("Falha ao buscar chunks parciais, iniciando do zero.");
                uploadedChunksSet = new Set();
            }
        } else {
            // 2. Gera Chave do Arquivo (FDK) se for um novo upload
            fdk = await generateFDK();
            
            // Criptografa o nome do arquivo e gera o hash dele
            const encName = await encryptText(plainName, masterKey.value);
            const nameHash = await computeSHA256(plainName);

            // Criptografa a FDK com a Chave Mestra
            encFDK = await encryptFDK(fdk, masterKey.value);

            // Calcula quantidade total de chunks
            totalChunks = Math.ceil(sizeBytes / CHUNK_SIZE) || 1;

            uploadTracker.statusText = "Inicializando cofre...";

            // Inicializa Upload no C++ Crow Server
            const initRes = await fetchAPI("/files", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    folder_id: currentFolderId.value,
                    encrypted_name: encName,
                    name_hash: nameHash,
                    encrypted_fdk: encFDK,
                    size_bytes: sizeBytes,
                    total_chunks: totalChunks
                })
            });

            const initData = await initRes.json();
            if (!initRes.ok) {
                throw new Error(initData.error || "Erro ao inicializar upload");
            }

            fileId = initData.file_id;
            uploadTracker.fileId = fileId;

            // Registra nos pendentes locais para HMR/Recarregamento
            const currentPending = JSON.parse(localStorage.getItem("savebox_pending_uploads") || "[]");
            currentPending.push({
                fileId: fileId,
                name: plainName,
                sizeBytes: sizeBytes,
                folderId: currentFolderId.value,
                encryptedFDK: encFDK,
                totalChunks: totalChunks
            });
            localStorage.setItem("savebox_pending_uploads", JSON.stringify(currentPending));
        }

        // 3. Envia os Chunks Criptografados Sequencialmente (pulando os já enviados)
        for (let index = 0; index < totalChunks; index++) {
            // Se o chunk já foi gravado, pula para poupar rede e CPU
            if (uploadedChunksSet.has(index)) {
                uploadTracker.progress = Math.round(((index + 1) / totalChunks) * 100);
                continue;
            }
            // Verifica estado de pausa ou cancelamento
            while (uploadTracker.paused && !uploadTracker.cancel) {
                uploadTracker.statusText = `Pausado no bloco ${index}/${totalChunks}...`;
                uploadTracker.status = "paused";
                await new Promise(resolve => setTimeout(resolve, 300));
            }
            if (uploadTracker.cancel) {
                throw new Error("Envio cancelado pelo usuário.");
            }
            uploadTracker.status = "uploading";

            const startByte = index * CHUNK_SIZE;
            const endByte = Math.min(startByte + CHUNK_SIZE, sizeBytes);
            
            uploadTracker.statusText = `Criptografando bloco ${index + 1}/${totalChunks}...`;

            // Lê a fatia do arquivo local
            const fileSlice = fileObject.slice(startByte, endByte);
            const sliceArrayBuffer = await fileSlice.arrayBuffer();

            // Criptografa os bytes usando Web Crypto AES-GCM
            const encryptedSliceBytes = await encryptChunk(sliceArrayBuffer, fdk);

            uploadTracker.statusText = `Transmitindo bloco ${index + 1}/${totalChunks}...`;

            // Envia os bytes criptografados diretamente para a API C++ Crow
            const chunkRes = await fetchAPI(`/files/${fileId}/chunks`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/octet-stream",
                    "X-Chunk-Index": index.toString()
                },
                body: encryptedSliceBytes
            });

            if (!chunkRes.ok) {
                const errData = await chunkRes.json();
                throw new Error(errData.error || `Erro no bloco ${index}`);
            }

            // Atualiza progresso do upload
            uploadTracker.progress = Math.round(((index + 1) / totalChunks) * 100);
        }

        // Upload Concluído!
        uploadTracker.status = "completed";
        uploadTracker.statusText = "Concluído & Protegido";
        showToast("Envio Concluído", `O arquivo "${plainName}" foi criptografado e salvo com sucesso.`, "success");
        
        // Remove do cofre local de uploads pendentes
        const pendingUploadsAfter = JSON.parse(localStorage.getItem("savebox_pending_uploads") || "[]");
        const filteredPending = pendingUploadsAfter.filter(p => p.fileId !== fileId);
        localStorage.setItem("savebox_pending_uploads", JSON.stringify(filteredPending));

        await loadExplorer();
        await refreshQuota();
    } catch (err) {
        uploadTracker.status = "failed";
        uploadTracker.statusText = "Erro: " + err.message;
        showToast("Erro no Envio", `Falha no envio de "${fileObject.name}": ${err.message}`, "error");
    }
}

function clearFinishedUploads() {
    uploads.value = uploads.value.filter(up => up.status === "uploading" || up.status === "paused");
}

function cancelTransfer(up) {
    up.cancel = true;
    up.paused = false; // Acorda o loop de espera caso esteja pausado
    up.status = "failed";
    up.statusText = "Cancelado";
    
    if (up.fileId) {
        const pendingUploads = JSON.parse(localStorage.getItem("savebox_pending_uploads") || "[]");
        const filtered = pendingUploads.filter(p => p.fileId !== up.fileId);
        localStorage.setItem("savebox_pending_uploads", JSON.stringify(filtered));
    }
    
    showToast("Transferência Cancelada", `A operação para "${up.name}" foi interrompida pelo usuário.`, "info");
}

function loadPendingUploadsFromStorage() {
    try {
        const pendingUploads = JSON.parse(localStorage.getItem("savebox_pending_uploads") || "[]");
        for (const item of pendingUploads) {
            // Evita duplicar se já foi restabelecido
            if (uploads.value.some(up => up.fileId === item.fileId)) continue;
            
            uploads.value.push({
                id: uploadIdCounter++,
                fileId: item.fileId,
                name: item.name,
                progress: 0,
                status: "paused",
                statusText: "Pendente: Selecione o arquivo local",
                paused: true,
                cancel: false,
                isResumePending: true,
                sizeBytes: item.sizeBytes,
                folderId: item.folderId,
                encryptedFDK: item.encryptedFDK,
                totalChunks: item.totalChunks
            });
        }
    } catch (e) {
        console.error("Erro ao carregar uploads pendentes:", e);
    }
}

function resumePendingFileSelection(up) {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        if (file.name !== up.name || file.size !== up.sizeBytes) {
            showToast("Arquivo Incorreto", `Por favor, selecione exatamente o arquivo "${up.name}" com o tamanho de ${formatBytes(up.sizeBytes)}.`, "error");
            return;
        }
        
        // Remove da lista para o novo pipeline recriar o tracker ativo
        uploads.value = uploads.value.filter(u => u.fileId !== up.fileId);
        
        // Dispara o upload pipeline normal que identificará a pendência no localStorage e fará o resume!
        await uploadFilePipeline(file);
    };
    input.click();
}

// =======================================================================
// E2EE FILE DOWNLOADER (RANGE-BASED CHUNKED DOWNLOADS)
// =======================================================================

async function downloadFile(file) {
    showToast("Preparando Download", `Buscando chaves de decodificação para "${file.name}"...`, "info");
    
    try {
        // 1. Decriptografa a FDK localmente
        const fdk = await decryptFDK(file.encryptedFDK, masterKey.value);
        const sizeBytes = file.sizeBytes;

        // Cria um rastreador fictício nos uploads para mostrar o progresso
        const downloadTracker = reactive({
            id: uploadIdCounter++,
            name: `Download: ${file.name}`,
            progress: 0,
            status: "uploading",
            statusText: "Baixando blocos...",
            paused: false,
            cancel: false
        });
        uploads.value.unshift(downloadTracker);
        showTransfersPanel.value = true;
        isTransfersExpanded.value = true;

        const totalChunks = Math.ceil(sizeBytes / CHUNK_SIZE) || 1;
        const chunkArrayBuffers = [];

        // 2. Baixa o arquivo em pedaços usando Range requests
        for (let index = 0; index < totalChunks; index++) {
            // Pequeno delay de 30ms para suavizar requisições sequenciais de rede
            await new Promise(resolve => setTimeout(resolve, 30));

            // Verifica estado de pausa ou cancelamento
            while (downloadTracker.paused && !downloadTracker.cancel) {
                downloadTracker.statusText = `Pausado no bloco ${index}/${totalChunks}...`;
                downloadTracker.status = "paused";
                await new Promise(resolve => setTimeout(resolve, 300));
            }
            if (downloadTracker.cancel) {
                throw new Error("Download cancelado pelo usuário.");
            }
            downloadTracker.status = "uploading";

            const startByte = index * (CHUNK_SIZE + 28);
            const endByte = Math.min((index + 1) * (CHUNK_SIZE + 28) - 1, sizeBytes + totalChunks * 28);

            downloadTracker.statusText = `Baixando bloco ${index + 1}/${totalChunks}...`;

            const res = await fetchAPI(`/files/${file.id}/download`, {
                method: "GET",
                headers: {
                    "Range": `bytes=${startByte}-${endByte}`
                }
            });

            if (!res.ok) {
                throw new Error("Erro de download no servidor");
            }

            // Recebe o chunk criptografado binário
            const encryptedChunkBytes = new Uint8Array(await res.arrayBuffer());

            downloadTracker.statusText = `Decriptografando bloco ${index + 1}/${totalChunks}...`;

            // Decriptografa usando a FDK e salva os bytes planos
            const plainChunkBuffer = await decryptChunk(encryptedChunkBytes, fdk);
            chunkArrayBuffers.push(plainChunkBuffer);

            downloadTracker.progress = Math.round(((index + 1) / totalChunks) * 100);
        }

        // 3. Junta todos os ArrayBuffers descriptografados em um único Blob
        const finalBlob = new Blob(chunkArrayBuffers, { type: "application/octet-stream" });
        
        // 4. Aciona o download nativo do navegador
        const link = document.createElement("a");
        link.href = URL.createObjectURL(finalBlob);
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        downloadTracker.status = "completed";
        downloadTracker.statusText = "Salvo com sucesso";
        showToast("Download Concluído", `Arquivo "${file.name}" decodificado e salvo localmente.`, "success");
    } catch (err) {
        if (typeof downloadTracker !== 'undefined') {
            downloadTracker.status = "failed";
            downloadTracker.statusText = "Erro: " + err.message;
        }
        showToast("Erro no Download", `Não foi possível baixar o arquivo: ${err.message}`, "error");
    }
}

async function previewFile(file) {
    modalPreview.show = true;
    modalPreview.loading = true;
    modalPreview.file = file;
    modalPreview.url = "";
    modalPreview.textContent = "";
    modalPreview.type = "unsupported";

    try {
        const fdk = await decryptFDK(file.encryptedFDK, masterKey.value);
        const sizeBytes = file.sizeBytes;
        const totalChunks = Math.ceil(sizeBytes / CHUNK_SIZE) || 1;
        const chunkArrayBuffers = [];

        const ext = file.name.split('.').pop().toLowerCase();
        const isMedia = ["mp4", "webm", "ogg", "mov", "mkv", "avi", "flv", "mp3", "wav", "m4a"].includes(ext);

        const previewChunks = isMedia ? Math.min(totalChunks, 5) : totalChunks;

        // 2. Baixa o arquivo em pedaços usando Range requests
        for (let index = 0; index < previewChunks; index++) {
            // Pequeno delay de 30ms para suavizar requisições sequenciais de rede
            await new Promise(resolve => setTimeout(resolve, 30));

            const startByte = index * (CHUNK_SIZE + 28);
            const endByte = Math.min((index + 1) * (CHUNK_SIZE + 28) - 1, sizeBytes + totalChunks * 28);

            const res = await fetchAPI(`/files/${file.id}/download`, {
                method: "GET",
                headers: {
                    "Range": `bytes=${startByte}-${endByte}`
                }
            });

            if (!res.ok) {
                throw new Error("Erro de download no servidor");
            }

            const encryptedChunkBytes = new Uint8Array(await res.arrayBuffer());
            const plainChunkBuffer = await decryptChunk(encryptedChunkBytes, fdk);
            chunkArrayBuffers.push(plainChunkBuffer);
        }

        // 3. Junta todos os ArrayBuffers descriptografados em um único Blob
        const finalBlob = new Blob(chunkArrayBuffers, { type: "application/octet-stream" });

        // 4. Mapeia a extensão do arquivo para determinar o tipo de visualização
        
        if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
            modalPreview.type = "image";
            const imageBlob = new Blob(chunkArrayBuffers, { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` });
            modalPreview.url = URL.createObjectURL(imageBlob);
        } else if (ext === "pdf") {
            modalPreview.type = "pdf";
            const pdfBlob = new Blob(chunkArrayBuffers, { type: "application/pdf" });
            modalPreview.url = URL.createObjectURL(pdfBlob);
        } else if (["mp4", "webm", "ogg", "mov", "mkv", "avi", "flv"].includes(ext)) {
            modalPreview.type = "video";
            const mimeType = ext === 'mov' ? 'video/quicktime' : (ext === 'mkv' ? 'video/x-matroska' : `video/${ext}`);
            const videoBlob = new Blob(chunkArrayBuffers, { type: mimeType });
            modalPreview.url = URL.createObjectURL(videoBlob);
        } else if (["mp3", "wav", "m4a"].includes(ext)) {
            modalPreview.type = "audio";
            const audioBlob = new Blob(chunkArrayBuffers, { type: `audio/${ext === 'mp3' ? 'mpeg' : ext}` });
            modalPreview.url = URL.createObjectURL(audioBlob);
        } else if (["txt", "md", "json", "js", "css", "html", "xml", "csv", "cpp", "h", "java", "py"].includes(ext)) {
            modalPreview.type = "text";
            modalPreview.textContent = await finalBlob.text();
        } else {
            modalPreview.type = "unsupported";
        }
    } catch (err) {
        showToast("Erro na Visualização", `Não foi possível descriptografar para visualização: ${err.message}`, "error");
        modalPreview.show = false;
    } finally {
        modalPreview.loading = false;
    }
}

function closePreviewModal() {
    if (modalPreview.url) {
        URL.revokeObjectURL(modalPreview.url);
    }
    modalPreview.show = false;
    modalPreview.file = null;
    modalPreview.url = "";
    modalPreview.textContent = "";
    modalPreview.type = "";
}

// =======================================================================
// ZERO-KNOWLEDGE PUBLIC SHARING ENGINE
// =======================================================================

async function shareFile(file) {
    try {
        // 1. Obtém o UUID do servidor
        const res = await fetchAPI(`/files/${file.id}/share`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Erro ao compartilhar arquivo");
        
        const shareUUID = data.share_uuid;

        // 2. Descriptografa a FDK localmente para ter a chave limpa em memória
        const fdkKey = await decryptFDK(file.encryptedFDK, masterKey.value);
        const rawKeyBytes = await window.crypto.subtle.exportKey("raw", fdkKey);
        
        // Codifica a chave limpa pura em Base64 seguro para URL
        const rawKeyBase64 = btoa(String.fromCharCode.apply(null, new Uint8Array(rawKeyBytes)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        const origin = window.location.origin + window.location.pathname;
        
        // Link final contendo a FDK simétrica pura na Hash
        modal.shareLink = `${origin}?share=${shareUUID}#${rawKeyBase64}:${encodeURIComponent(file.name)}`;
        modal.showShare = true;
    } catch (err) {
        showToast("Erro de Compartilhamento", err.message, "error");
    }
}

function copyShareLink() {
    const input = document.getElementById("share-link-input");
    if (input) {
        input.select();
        navigator.clipboard.writeText(input.value);
        showToast("Copiado!", "Link de compartilhamento copiado para a área de transferência.", "success");
    }
}

// Intercepta carregamento para ver se é um link compartilhado sendo acessado
async function checkSharedLinkAccess() {
    const params = new URLSearchParams(window.location.search);
    const shareUUID = params.get("share");
    if (!shareUUID) return;

    // Encontrou um link público!
    const hash = window.location.hash;
    if (!hash || hash.length < 2) {
        alert("Erro no link de compartilhamento: Chave criptográfica ausente.");
        window.location.href = window.location.origin + window.location.pathname;
        return;
    }

    const hashParts = hash.substring(1).split(":");
    const encFDK = hashParts[0];
    const plainName = decodeURIComponent(hashParts[1] || "arquivo_compartilhado");

    if (!confirm(`Você deseja baixar o arquivo compartilhado "${plainName}"?\nEle será baixado diretamente do servidor e descriptografado no seu navegador.`)) {
        window.location.href = window.location.origin + window.location.pathname;
        return;
    }

    try {
        // 1. Buscamos informações básicas de tamanho do arquivo do link público
        const headRes = await fetch(`${API_URL}/share/${shareUUID}`, {
            method: "GET",
            headers: { "Range": "bytes=0-0" }
        });

        if (!headRes.ok && headRes.status !== 206) {
            throw new Error("Link público inválido ou expirado");
        }

        const contentRange = headRes.headers.get("Content-Range");
        let sizeBytes = 0;
        if (contentRange) {
            const parts = contentRange.split("/");
            sizeBytes = parseInt(parts[1]) || 0;
        }

        if (sizeBytes === 0) {
            const fullRes = await fetch(`${API_URL}/share/${shareUUID}`);
            if (!fullRes.ok) throw new Error("Erro ao baixar arquivo compartilhado");
            const fullBuffer = await fullRes.arrayBuffer();
            sizeBytes = fullBuffer.byteLength;
        }

        // 2. Importamos a FDK simétrica pura do link público
        let rawFDK;
        try {
            let str = encFDK.replace(/-/g, '+').replace(/_/g, '/');
            while (str.length % 4) str += '=';
            const rawBin = atob(str);
            const fdkBytes = new Uint8Array(rawBin.length);
            for (let i = 0; i < rawBin.length; i++) {
                fdkBytes[i] = rawBin.charCodeAt(i);
            }
            
            rawFDK = await window.crypto.subtle.importKey(
                "raw",
                fdkBytes,
                "AES-GCM",
                true,
                ["encrypt", "decrypt"]
            );
        } catch (e) {
            throw new Error("Chave do link compartilhada inválida ou corrompida.");
        }

        // 3. Começa a baixar em pedaços do link público (/share/<uuid>)
        const totalChunks = Math.ceil(sizeBytes / (CHUNK_SIZE + 28)) || 1;
        const chunkArrayBuffers = [];

        for (let index = 0; index < totalChunks; index++) {
            const startByte = index * (CHUNK_SIZE + 28);
            const endByte = Math.min((index + 1) * (CHUNK_SIZE + 28) - 1, sizeBytes - 1);

            const chunkRes = await fetch(`${API_URL}/share/${shareUUID}`, {
                method: "GET",
                headers: { "Range": `bytes=${startByte}-${endByte}` }
            });

            if (!chunkRes.ok && chunkRes.status !== 206) {
                throw new Error(`Erro ao baixar bloco ${index + 1}`);
            }

            const encryptedChunkBytes = new Uint8Array(await chunkRes.arrayBuffer());
            const plainChunkBuffer = await decryptChunk(encryptedChunkBytes, rawFDK);
            chunkArrayBuffers.push(plainChunkBuffer);
        }

        // 4. Junta e salva
        const finalBlob = new Blob(chunkArrayBuffers, { type: "application/octet-stream" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(finalBlob);
        link.download = plainName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        alert(`Download concluído: "${plainName}" decodificado localmente com sucesso!`);
        window.location.href = window.location.origin + window.location.pathname;
    } catch (err) {
        alert(`Erro ao baixar arquivo compartilhado: ${err.message}`);
        window.location.href = window.location.origin + window.location.pathname;
    }
}

// =======================================================================
// INITIALIZATION & LIFECYCLE
// =======================================================================

onMounted(async () => {
    // Registra o Service Worker para streaming de mídias criptografadas
    if ('serviceWorker' in navigator) {
        try {
            const reg = await navigator.serviceWorker.register('/sw.js');
            console.log('Service Worker registrado:', reg.scope);

            // Recarrega apenas uma única vez (usando sessionStorage como flag) para garantir
            // que o SW assuma o controle imediato sem entrar em loop infinito
            if (!navigator.serviceWorker.controller && !sessionStorage.getItem('sw_reloaded')) {
                sessionStorage.setItem('sw_reloaded', '1');
                console.log('[SW] Primeira ativação — recarregando para assumir controle...');
                window.location.reload();
            }
        } catch (err) {
            console.error('Erro ao registrar Service Worker:', err);
        }
    }

    // Restaura tema salvo
    const savedTheme = localStorage.getItem("savebox_theme");
    if (savedTheme === "light") {
        isDarkMode.value = false;
    } else {
        isDarkMode.value = true;
    }
    updateThemeClass();
    window.addEventListener('click', closeNewDropdown);

    // Verifica acesso via link compartilhado primeiro
    await checkSharedLinkAccess();

    // Verifica se o usuário já possui um token salvo
    const savedToken = localStorage.getItem("savebox_token");
    const savedUsername = localStorage.getItem("savebox_username");

    if (savedToken && savedUsername) {
        token.value = savedToken;
        username.value = savedUsername;
        isVaultLocked.value = true;
    }
});

onBeforeUnmount(() => {
    window.removeEventListener('click', closeNewDropdown);
});

// --- UTILS ---
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
    if (!dateStr) return "—";
    try {
        const date = new Date(dateStr);
        return date.toLocaleString('pt-BR');
    } catch (e) {
        return dateStr;
    }
}

function getFileIconClass(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    switch (ext) {
        case 'pdf': return 'fa-solid fa-file-pdf';
        case 'doc':
        case 'docx': return 'fa-solid fa-file-word';
        case 'xls':
        case 'xlsx': return 'fa-solid fa-file-excel';
        case 'ppt':
        case 'pptx': return 'fa-solid fa-file-powerpoint';
        case 'js':
        case 'ts':
        case 'html':
        case 'css':
        case 'cpp':
        case 'java':
        case 'py': return 'fa-solid fa-file-code';
        case 'mp3':
        case 'wav':
        case 'flac': return 'fa-solid fa-file-audio';
        case 'mp4':
        case 'mkv':
        case 'avi': return 'fa-solid fa-file-video';
        case 'jpg':
        case 'jpeg':
        case 'png':
        case 'gif':
        case 'svg': return 'fa-solid fa-file-image';
        default: return 'fa-solid fa-file-lines';
    }
}

function closeNewDropdown(e) {
    if (!e.target.closest('.new-button-container')) {
        showNewDropdown.value = false;
    }
}
</script>

<template>
    <div>
        <!-- Global Toast Notifications -->
        <div class="toast-container">
            <div v-for="toast in toasts" :key="toast.id" :class="['toast', `toast-${toast.type}`]">
                <i :class="getToastIcon(toast.type)"></i>
                <div class="toast-content">
                    <div class="toast-title">{{ toast.title }}</div>
                    <div class="toast-message">{{ toast.message }}</div>
                </div>
                <button class="toast-close" @click="removeToast(toast.id)">&times;</button>
            </div>
        </div>

        <!-- Header -->
        <header class="main-header glass-panel">
            <div class="header-brand">
                <div class="brand-logo">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="width: 28px; height: 28px;">
                        <rect x="15" y="15" width="30" height="70" rx="8" :fill="isDarkMode ? '#ffffff' : '#0f172a'" />
                        <rect x="55" y="15" width="30" height="30" rx="8" :fill="isDarkMode ? '#ffffff' : '#0f172a'" />
                        <circle cx="70" cy="70" r="15" fill="#0ea5e9" />
                    </svg>
                </div>
                <div class="brand-text">
                    <h1>SaveBox <span>2.0</span></h1>
                    <p>Zero-Knowledge Cloud Cryptography</p>
                </div>
            </div>
            
            <div class="header-actions">
                <button class="btn btn-outline btn-theme-toggle" @click="toggleTheme" :title="isDarkMode ? 'Modo Claro' : 'Modo Escuro'" style="padding: 0; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 16px;">
                    <i :class="['fa-solid', isDarkMode ? 'fa-sun' : 'fa-moon']"></i>
                </button>
                <div class="user-badge glass-panel" v-if="isAuthenticated">
                    <i class="fa-solid fa-user-shield"></i>
                    <span>{{ username }}</span>
                </div>
                <button class="btn btn-outline btn-logout" @click="logout" v-if="isAuthenticated">
                    <i class="fa-solid fa-right-from-bracket"></i> Sair
                </button>
            </div>
        </header>

        <main class="main-container">
            <!-- 0. SESSION LOCK SCREEN (Zero-Knowledge vault lock) -->
            <section class="auth-section" v-if="isVaultLocked">
                <div class="auth-card glass-panel animate-fade-in">
                    <div class="auth-header">
                        <div class="lock-icon-container" style="font-size: 48px; color: var(--secondary); margin-bottom: 20px; text-shadow: 0 0 20px var(--secondary-glow); display: flex; justify-content: center;">
                            <i class="fa-solid fa-lock"></i>
                        </div>
                        <h2>Cofre Bloqueado</h2>
                        <p>Sua sessão está ativa, mas a chave mestra foi apagada da RAM para sua proteção. Insira sua Senha Mestra para descriptografar os dados localmente.</p>
                    </div>
                    <form @submit.prevent="unlockVault" class="auth-form">
                        <div class="form-group">
                            <label><i class="fa-solid fa-user"></i> Usuário</label>
                            <input type="text" :value="username" disabled style="background: rgba(255, 255, 255, 0.03); color: var(--text-muted); cursor: not-allowed; border: 1px solid var(--glass-border); opacity: 0.7;">
                        </div>
                        <div class="form-group">
                            <label for="unlock-password"><i class="fa-solid fa-key"></i> Senha Mestra</label>
                            <input type="password" id="unlock-password" v-model="unlockPassword" placeholder="Digite sua senha mestra..." required autocomplete="current-password" autofocus>
                        </div>
                        <button type="submit" class="btn btn-primary btn-block" :disabled="authLoading">
                            <span v-if="authLoading"><i class="fa-solid fa-circle-notch fa-spin"></i> Desbloqueando...</span>
                            <span v-else>Desbloquear Cofre <i class="fa-solid fa-unlock"></i></span>
                        </button>
                        <button type="button" class="btn btn-outline btn-block" @click="logout" style="margin-top: 12px;">
                            <i class="fa-solid fa-right-from-bracket"></i> Sair da Conta
                        </button>
                    </form>
                </div>
            </section>

            <!-- 1. AUTHENTICATION SCREENS (LOGIN / REGISTER / VERIFY) -->
            <section class="auth-section" v-else-if="!isAuthenticated && !isVaultLocked">
                <div class="auth-card glass-panel" v-if="authView === 'login'">
                    <div class="auth-header">
                        <h2>Bem-vindo de volta</h2>
                        <p>Entre no seu cofre digital criptografado.</p>
                    </div>
                    <form @submit.prevent="handleLogin" class="auth-form">
                        <div class="form-group">
                            <label for="login-username"><i class="fa-solid fa-user"></i> Usuário</label>
                            <input type="text" id="login-username" v-model="authForm.username" placeholder="Digite seu usuário..." required autocomplete="username">
                        </div>
                        <div class="form-group">
                            <label for="login-password"><i class="fa-solid fa-key"></i> Senha Mestra</label>
                            <input type="password" id="login-password" v-model="authForm.password" placeholder="Digite sua senha..." required autocomplete="current-password">
                        </div>
                        <button type="submit" class="btn btn-primary btn-block" :disabled="authLoading">
                            <span v-if="authLoading"><i class="fa-solid fa-circle-notch fa-spin"></i> Autenticando...</span>
                            <span v-else>Abrir Cofre <i class="fa-solid fa-unlock"></i></span>
                        </button>
                    </form>
                    <div class="auth-footer">
                        <p>Não tem uma conta? <a href="#" @click.prevent="authView = 'register'">Criar Conta</a></p>
                        <p><a href="#" @click.prevent="authView = 'verify'">Verificar E-mail</a></p>
                    </div>
                </div>

                <div class="auth-card glass-panel" v-if="authView === 'register'">
                    <div class="auth-header">
                        <h2>Criar Nova Conta</h2>
                        <p>Proteja seus arquivos com segurança matemática de ponta.</p>
                    </div>
                    <form @submit.prevent="handleRegister" class="auth-form">
                        <div class="form-group">
                            <label for="reg-username"><i class="fa-solid fa-user"></i> Nome de Usuário</label>
                            <input type="text" id="reg-username" v-model="authForm.username" placeholder="Escolha um usuário único..." required>
                        </div>
                        <div class="form-group">
                            <label for="reg-email"><i class="fa-solid fa-envelope"></i> E-mail</label>
                            <input type="email" id="reg-email" v-model="authForm.email" placeholder="Seu melhor e-mail (evite descartáveis)..." required>
                        </div>
                        <div class="form-group">
                            <label for="reg-password"><i class="fa-solid fa-key"></i> Senha Mestra</label>
                            <input type="password" id="reg-password" v-model="authForm.password" placeholder="Sua senha deriva a chave localmente..." required>
                            <small class="password-note"><i class="fa-solid fa-circle-info"></i> Seus dados são criptografados localmente. Nós NUNCA sabemos sua senha!</small>
                        </div>
                        <button type="submit" class="btn btn-primary btn-block" :disabled="authLoading">
                            <span v-if="authLoading"><i class="fa-solid fa-circle-notch fa-spin"></i> Registrando...</span>
                            <span v-else>Criar Cofre Criptografado <i class="fa-solid fa-shield-halved"></i></span>
                        </button>
                    </form>
                    <div class="auth-footer">
                        <p>Já possui uma conta? <a href="#" @click.prevent="authView = 'login'">Entrar</a></p>
                        <p><a href="#" @click.prevent="authView = 'verify'">Verificar E-mail</a></p>
                    </div>
                </div>

                <div class="auth-card glass-panel" v-if="authView === 'verify'">
                    <div class="auth-header">
                        <h2>Ativar Conta</h2>
                        <p>Insira o token de verificação enviado para o seu e-mail.</p>
                    </div>
                    <form @submit.prevent="handleVerifyEmail" class="auth-form">
                        <div class="form-group">
                            <label for="verify-token"><i class="fa-solid fa-circle-check"></i> Token de Verificação</label>
                            <input type="text" id="verify-token" v-model="authForm.token" placeholder="Insira o token recebido..." required>
                        </div>
                        <button type="submit" class="btn btn-primary btn-block" :disabled="authLoading">
                            <span v-if="authLoading"><i class="fa-solid fa-circle-notch fa-spin"></i> Verificando...</span>
                            <span v-else>Verificar e Ativar <i class="fa-solid fa-user-check"></i></span>
                        </button>
                    </form>
                    <div class="auth-footer">
                        <p>Voltar para o <a href="#" @click.prevent="authView = 'login'">Login</a></p>
                    </div>
                </div>
            </section>

            <!-- 2. DASHBOARD & FILE EXPLORER SCREENS (AUTHENTICATED) -->
            <section class="dashboard-section" v-else>
                <!-- Quota & Sidebar Panel -->
                <aside class="sidebar-panel glass-panel">
                    <!-- Google Drive style "+ Novo" button -->
                    <div class="new-button-container">
                        <button class="btn-new-drive" @click.stop="showNewDropdown = !showNewDropdown">
                            <i class="fa-solid fa-plus"></i>
                            <span>Novo</span>
                        </button>
                        
                        <!-- Dropdown to Upload / Create Folder -->
                        <div class="new-dropdown glass-panel" v-if="showNewDropdown">
                            <button @click="openCreateFolderModal(); showNewDropdown = false;">
                                <i class="fa-solid fa-folder-plus text-primary"></i> Nova pasta
                            </button>
                            <button @click="triggerFileInput(); showNewDropdown = false;">
                                <i class="fa-solid fa-cloud-arrow-up text-success"></i> Fazer upload de arquivo
                            </button>
                        </div>
                    </div>

                    <div class="menu-navigation">
                        <button :class="['menu-btn', { active: currentTab === 'files' }]" @click="setTab('files')">
                            <i class="fa-solid fa-hard-drive"></i> Meu Drive
                        </button>
                        
                        <!-- Folder Tree Navigation under Meus Arquivos if active -->
                        <div class="sidebar-tree-container" v-if="currentTab === 'files'">
                            <div class="sidebar-tree-title">Navegar Pastas</div>
                            <div class="sidebar-tree-empty" v-if="folderTree.length === 0">
                                Nenhuma pasta criada
                            </div>
                            <div v-else>
                                <div 
                                    v-for="folder in folderTree" 
                                    :key="'tree-' + folder.id" 
                                    :class="['sidebar-tree-item', { active: currentFolderId === folder.id }]"
                                    :style="{ paddingLeft: (folder.depth * 8 + 16) + 'px' }"
                                    @click="navigateToFolder(folder.id)"
                                >
                                    <i :class="['fa-solid', currentFolderId === folder.id ? 'fa-folder-open' : 'fa-folder']"></i>
                                    <span>{{ folder.name }}</span>
                                </div>
                            </div>
                        </div>

                        <button :class="['menu-btn', { active: currentTab === 'trash' }]" @click="setTab('trash')">
                            <i class="fa-solid fa-trash-can"></i> Lixeira
                        </button>

                        <button :class="['menu-btn', { active: currentTab === 'transfers' }]" @click="setTab('transfers')" style="position: relative;">
                            <i class="fa-solid fa-arrow-up-down"></i> Transferências
                            <span v-if="uploads.some(up => up.status === 'uploading')" style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); display: flex; align-items: center; justify-content: center; font-size: 10px; color: var(--secondary);">
                                <i class="fa-solid fa-spinner fa-spin"></i>
                            </span>
                        </button>
                    </div>

                    <div class="quota-container">
                        <div class="quota-header">
                            <span><i class="fa-solid fa-hard-drive"></i> Uso de Armazenamento</span>
                            <span class="quota-perc">{{ quotaPercent }}%</span>
                        </div>
                        <div class="quota-progress-bar">
                            <div class="quota-progress" :style="{ width: quotaPercent + '%' }" :class="{ 'quota-warning': quotaPercent > 80, 'quota-danger': quotaPercent > 95 }"></div>
                        </div>
                        <div class="quota-details">
                            <span>{{ formatBytes(quotaUsed) }} usados</span>
                            <span>de {{ formatBytes(quotaTotal) }}</span>
                        </div>
                    </div>
                </aside>

                <!-- Main Content Area -->
                <div class="content-panel">
                    <!-- Tab: Files explorer -->
                    <div class="tab-content" v-if="currentTab === 'files'">
                        <!-- Toolbar -->
                        <div class="explorer-toolbar glass-panel">
                            <!-- Breadcrumbs / Path -->
                            <div class="breadcrumbs">
                                <span class="breadcrumb-item" @click="navigateToFolder(null)">
                                    <i class="fa-solid fa-house"></i> Raiz
                                </span>
                                <span v-for="folder in breadcrumbs" :key="folder.id" class="breadcrumb-item" @click="navigateToFolder(folder.id)">
                                    <i class="fa-solid fa-chevron-right breadcrumb-separator"></i>
                                    {{ folder.name }}
                                </span>
                            </div>

                            <!-- Search bar -->
                            <div class="search-box">
                                <i class="fa-solid fa-magnifying-glass"></i>
                                <input type="text" v-model="searchQuery" placeholder="Pesquisar no Drive...">
                            </div>

                            <input type="file" ref="fileInputRef" @change="handleFileSelection" style="display: none;" multiple>
                        </div>

                        <!-- Drag and Drop / Files Grid -->
                        <div class="explorer-body glass-panel"
                             @dragenter.prevent="dragActive = true"
                             @dragover.prevent="dragActive = true"
                             @dragleave.prevent="dragActive = false"
                             @drop.prevent="handleFileDrop"
                             :class="{ 'drag-active': dragActive }">
                             
                            <!-- Drop Overlay -->
                            <div class="drop-overlay" v-if="dragActive">
                                <div class="drop-message">
                                    <i class="fa-solid fa-cloud-arrow-up fa-bounce"></i>
                                    <h3>Solte seus arquivos aqui</h3>
                                    <p>Eles serão criptografados em chunks no seu navegador antes de serem enviados.</p>
                                </div>
                            </div>



                            <!-- Empty Directory View -->
                            <div class="empty-explorer" v-if="filteredFolders.length === 0 && filteredFiles.length === 0">
                                <i class="fa-solid fa-box-open"></i>
                                <h3>Nenhum item encontrado</h3>
                                <p>Esta pasta está vazia. Crie uma pasta ou arraste arquivos para começar.</p>
                            </div>

                            <!-- List View of Items (Google Drive layout) -->
                            <div class="explorer-sections" v-else>
                                <!-- Folders Section (Grid style) -->
                                <div class="folders-section" v-if="filteredFolders.length > 0">
                                    <h3 class="section-title">Pastas</h3>
                                    <div class="folders-grid">
                                        <div class="folder-card" v-for="folder in filteredFolders" :key="'f-' + folder.id" @dblclick="navigateToFolder(folder.id)">
                                            <div class="folder-card-left" @click="navigateToFolder(folder.id)">
                                                <i class="fa-solid fa-folder"></i>
                                                <span :title="folder.name">{{ folder.name }}</span>
                                            </div>
                                            <div class="folder-card-actions">
                                                <button class="action-btn" title="Renomear" @click.stop="openRenameModal(folder, 'folder')">
                                                    <i class="fa-solid fa-pen"></i>
                                                </button>
                                                <button class="action-btn action-btn-danger" title="Mover para Lixeira" @click.stop="deleteFolder(folder.id)">
                                                    <i class="fa-solid fa-trash-can"></i>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Files Section (Clean List view) -->
                                <div class="files-section" v-if="filteredFiles.length > 0">
                                    <h3 class="section-title" v-if="filteredFolders.length > 0">Arquivos</h3>
                                    <div class="items-list">
                                        <div class="list-header">
                                            <div class="col-name">Nome</div>
                                            <div class="col-size">Tamanho</div>
                                            <div class="col-date">Última Modificação</div>
                                            <div class="col-actions">Ações</div>
                                        </div>

                                        <!-- Files List -->
                                        <div class="list-row item-file" v-for="file in filteredFiles" :key="'fil-' + file.id" @dblclick="previewFile(file)">
                                            <div class="col-name" @click="previewFile(file)" style="cursor: pointer;">
                                                <i :class="getFileIconClass(file.name)"></i>
                                                <span :title="file.name" class="file-name-preview-link">{{ file.name }}</span>
                                            </div>
                                            <div class="col-size">{{ formatBytes(file.sizeBytes) }}</div>
                                            <div class="col-date">{{ formatDate(file.createdAt) }}</div>
                                            <div class="col-actions">
                                                <button class="action-btn" title="Visualizar" @click="previewFile(file)">
                                                    <i class="fa-solid fa-eye"></i>
                                                </button>
                                                <button class="action-btn action-btn-success" title="Download Criptografado" @click="downloadFile(file)">
                                                    <i class="fa-solid fa-cloud-arrow-down"></i>
                                                </button>
                                                <button class="action-btn" title="Compartilhar Link" @click="shareFile(file)">
                                                    <i class="fa-solid fa-share-nodes"></i>
                                                </button>
                                                <button class="action-btn" title="Renomear / Mover" @click="openRenameModal(file, 'file')">
                                                    <i class="fa-solid fa-pen"></i>
                                                </button>
                                                <button class="action-btn action-btn-danger" title="Mover para Lixeira" @click="deleteFile(file.id)">
                                                    <i class="fa-solid fa-trash-can"></i>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Tab: Trash Bin -->
                    <div class="tab-content" v-if="currentTab === 'trash'">
                        <div class="explorer-toolbar glass-panel">
                            <div class="breadcrumbs">
                                <span class="breadcrumb-item active">
                                    <i class="fa-solid fa-trash-can"></i> Itens Excluídos
                                </span>
                            </div>
                            <div class="toolbar-actions">
                                <button class="btn btn-primary btn-danger" @click="emptyTrash" :disabled="trashFolders.length === 0 && trashFiles.length === 0">
                                    <i class="fa-solid fa-dumpster-fire"></i> Esvaziar Lixeira
                                </button>
                            </div>
                        </div>

                        <div class="explorer-body glass-panel">
                            <!-- Empty Trash View -->
                            <div class="empty-explorer" v-if="trashFolders.length === 0 && trashFiles.length === 0">
                                <i class="fa-solid fa-trash-arrow-up"></i>
                                <h3>Lixeira Vazia</h3>
                                <p>Itens excluídos aparecerão aqui. Você poderá restaurá-los se necessário.</p>
                            </div>

                            <!-- Trash List -->
                            <div class="items-list" v-else>
                                <div class="list-header">
                                    <div class="col-name">Nome</div>
                                    <div class="col-size">Tamanho</div>
                                    <div class="col-date">Excluído em</div>
                                    <div class="col-actions">Ações</div>
                                </div>

                                <!-- Trash Folders -->
                                <div class="list-row item-folder" v-for="folder in trashFolders" :key="'tf-' + folder.id">
                                    <div class="col-name">
                                        <i class="fa-solid fa-folder-minus"></i>
                                        <span>{{ folder.name }}</span>
                                    </div>
                                    <div class="col-size">—</div>
                                    <div class="col-date">{{ formatDate(folder.updatedAt) }}</div>
                                    <div class="col-actions">
                                        <button class="action-btn action-btn-success" title="Restaurar" @click="restoreFolder(folder.id)">
                                            <i class="fa-solid fa-arrow-rotate-left"></i>
                                        </button>
                                    </div>
                                </div>

                                <!-- Trash Files -->
                                <div class="list-row item-file" v-for="file in trashFiles" :key="'tfil-' + file.id">
                                    <div class="col-name">
                                        <i :class="getFileIconClass(file.name)"></i>
                                        <span>{{ file.name }}</span>
                                    </div>
                                    <div class="col-size">{{ formatBytes(file.sizeBytes) }}</div>
                                    <div class="col-date">{{ formatDate(file.updatedAt) }}</div>
                                    <div class="col-actions">
                                        <button class="action-btn action-btn-success" title="Restaurar" @click="restoreFile(file.id)">
                                            <i class="fa-solid fa-arrow-rotate-left"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Tab: Transfers manager -->
                    <div class="tab-content" v-else-if="currentTab === 'transfers'">
                        <div class="explorer-toolbar glass-panel" style="justify-content: space-between; align-items: center; display: flex; gap: 20px;">
                            <div class="section-title" style="display: flex; align-items: center; gap: 10px;">
                                <i class="fa-solid fa-arrow-up-down text-primary" style="font-size: 20px;"></i>
                                <h2 style="font-size: 18px; margin: 0; font-weight: 600;">Monitor de Transferências</h2>
                            </div>
                            <div class="toolbar-actions" style="display: flex; gap: 12px;">
                                <button class="btn btn-outline" @click="clearFinishedUploads" :disabled="uploads.length === 0">
                                    <i class="fa-solid fa-broom"></i> Limpar Concluídos
                                </button>
                            </div>
                        </div>

                        <!-- Panel layout -->
                        <div class="transfers-view-layout glass-panel" style="padding: 24px; border-radius: var(--border-radius-lg); border: 1px solid var(--glass-border); min-height: 400px; display: flex; flex-direction: column; gap: 20px; background: var(--glass-bg); backdrop-filter: blur(10px);">
                            <div class="transfers-summary" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; padding-bottom: 20px; border-bottom: 1px solid var(--glass-border);">
                                <div class="summary-card" style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--glass-border); border-radius: var(--border-radius-md); padding: 16px; display: flex; flex-direction: column; gap: 6px;">
                                    <span style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Total de Operações</span>
                                    <span style="font-size: 24px; font-weight: 700; color: var(--text-main);">{{ uploads.length }}</span>
                                </div>
                                <div class="summary-card" style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--glass-border); border-radius: var(--border-radius-md); padding: 16px; display: flex; flex-direction: column; gap: 6px;">
                                    <span style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Ativas / Processando</span>
                                    <span style="font-size: 24px; font-weight: 700; color: var(--secondary);">{{ uploads.filter(u => u.status === 'uploading').length }}</span>
                                </div>
                                <div class="summary-card" style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--glass-border); border-radius: var(--border-radius-md); padding: 16px; display: flex; flex-direction: column; gap: 6px;">
                                    <span style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Concluídas</span>
                                    <span style="font-size: 24px; font-weight: 700; color: var(--success);">{{ uploads.filter(u => u.status === 'completed').length }}</span>
                                </div>
                                <div class="summary-card" style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--glass-border); border-radius: var(--border-radius-md); padding: 16px; display: flex; flex-direction: column; gap: 6px;">
                                    <span style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Pausadas / Pendentes</span>
                                    <span style="font-size: 24px; font-weight: 700; color: #eab308;">{{ uploads.filter(u => u.status === 'paused').length }}</span>
                                </div>
                            </div>

                            <!-- List of Transfers -->
                            <div class="transfers-detailed-list" style="display: flex; flex-direction: column; gap: 12px; overflow-y: auto; max-height: 500px; padding-right: 6px;">
                                <div class="transfer-empty-state" v-if="uploads.length === 0" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 60px 0; color: var(--text-muted);">
                                    <i class="fa-solid fa-arrow-up-down" style="font-size: 48px; opacity: 0.3;"></i>
                                    <div style="text-align: center;">
                                        <h3 style="font-size: 16px; font-weight: 600; color: var(--text-main); margin-bottom: 4px;">Nenhuma transferência registrada</h3>
                                        <p style="font-size: 13px; max-width: 320px; margin: 0; opacity: 0.7;">Qualquer arquivo enviado ou baixado aparecerá detalhado nesta aba.</p>
                                    </div>
                                </div>

                                <div class="transfer-row glass-panel animate-fade-in" v-for="up in uploads" :key="'tab-t-' + up.id" style="display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: var(--border-radius-md); background: rgba(255, 255, 255, 0.01); border: 1px solid var(--glass-border); transition: all 0.2s ease;">
                                    <div class="transfer-row-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                                        <div style="display: flex; align-items: center; gap: 12px; font-weight: 600;">
                                            <i class="fa-solid fa-cloud-arrow-down text-primary" style="font-size: 16px;" v-if="up.name.toLowerCase().includes('download')"></i>
                                            <i class="fa-solid fa-cloud-arrow-up text-success" style="font-size: 16px;" v-else></i>
                                            <span class="transfer-name" style="color: var(--text-main); font-size: 14px;">{{ up.name }}</span>
                                        </div>
                                        <div style="display: flex; align-items: center; gap: 16px;">
                                            <span class="upload-status" :class="up.status" style="font-size: 12px; font-weight: 600;">{{ up.statusText }}</span>
                                            
                                            <!-- Action controls inside the detailed table -->
                                            <div class="transfer-action-buttons" style="display: flex; gap: 8px;">
                                                <!-- Se for um upload pendente de arquivo local após recarregamento -->
                                                <template v-if="up.isResumePending">
                                                    <button class="btn btn-primary animate-pulse" @click="resumePendingFileSelection(up)" title="Vincular Arquivo" style="padding: 6px 12px; font-size: 12px; display: flex; align-items: center; gap: 6px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, var(--secondary) 0%, var(--secondary-glow) 100%);">
                                                        <i class="fa-solid fa-file-import"></i> Vincular Arquivo
                                                    </button>
                                                    <button class="btn btn-outline" @click="cancelTransfer(up)" title="Remover" style="padding: 6px 12px; font-size: 12px; display: flex; align-items: center; gap: 6px; color: var(--danger); border-color: rgba(239, 68, 68, 0.3); height: 32px; border-radius: 8px;">
                                                        <i class="fa-solid fa-trash"></i> Remover
                                                    </button>
                                                </template>
                                                
                                                <!-- Controles normais de transferência ativa -->
                                                <template v-else-if="up.status === 'uploading' || up.status === 'paused'">
                                                    <button class="btn btn-outline" v-if="up.status === 'uploading'" @click="up.paused = true" title="Pausar" style="padding: 6px 12px; font-size: 12px; display: flex; align-items: center; gap: 6px; height: 32px; border-radius: 8px;">
                                                        <i class="fa-solid fa-pause"></i> Pausar
                                                    </button>
                                                    <button class="btn btn-primary" v-else-if="up.status === 'paused'" @click="up.paused = false" title="Retomar" style="padding: 6px 12px; font-size: 12px; display: flex; align-items: center; gap: 6px; height: 32px; border-radius: 8px;">
                                                        <i class="fa-solid fa-play"></i> Retomar
                                                    </button>
                                                    <button class="btn btn-outline" @click="cancelTransfer(up)" title="Cancelar" style="padding: 6px 12px; font-size: 12px; display: flex; align-items: center; gap: 6px; color: var(--danger); border-color: rgba(239, 68, 68, 0.3); height: 32px; border-radius: 8px;">
                                                        <i class="fa-solid fa-xmark"></i> Cancelar
                                                    </button>
                                                </template>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="transfer-progress-container" style="display: flex; align-items: center; gap: 16px;">
                                        <div class="upload-progress-bar" style="flex: 1; height: 6px; background: rgba(255, 255, 255, 0.05); border-radius: 3px; overflow: hidden; margin: 0;">
                                            <div class="upload-progress" :style="{ width: up.progress + '%' }" :class="up.status" style="height: 100%; transition: width 0.3s ease;"></div>
                                        </div>
                                        <span style="font-size: 12px; font-weight: 600; color: var(--text-muted); min-width: 32px; text-align: right;">{{ up.progress }}%</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </main>

        <!-- 3. MODALS -->
        
        <!-- Create Folder Modal -->
        <div class="modal-backdrop" v-if="modal.showCreateFolder" @click.self="modal.showCreateFolder = false">
            <div class="modal-card glass-panel">
                <div class="modal-header">
                    <h3><i class="fa-solid fa-folder-plus"></i> Criar Nova Pasta</h3>
                    <button class="modal-close" @click="modal.showCreateFolder = false">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="new-folder-name">Nome da Pasta</label>
                        <input type="text" id="new-folder-name" v-model="modal.folderName" placeholder="Digite o nome..." required @keyup.enter="createFolder">
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline" @click="modal.showCreateFolder = false">Cancelar</button>
                    <button class="btn btn-primary" @click="createFolder" :disabled="!modal.folderName">Criar Pasta</button>
                </div>
            </div>
        </div>

        <!-- Rename / Move Modal -->
        <div class="modal-backdrop" v-if="modal.showRename" @click.self="modal.showRename = false">
            <div class="modal-card glass-panel">
                <div class="modal-header">
                    <h3><i class="fa-solid fa-pen"></i> Renomear / Mover Item</h3>
                    <button class="modal-close" @click="modal.showRename = false">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="rename-item-name">Novo Nome</label>
                        <input type="text" id="rename-item-name" v-model="modal.renameName" placeholder="Digite o novo nome..." required>
                    </div>
                    <div class="form-group">
                        <label for="move-item-parent">Mover para Pasta</label>
                        <select id="move-item-parent" v-model="modal.renameParentId">
                            <option :value="0">Raiz (Sem pasta pai)</option>
                            <option v-for="f in availableFoldersForMove" :key="f.id" :value="f.id">
                                {{ getFolderPathRepresentation(f.id) }}
                            </option>
                        </select>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline" @click="modal.showRename = false">Cancelar</button>
                    <button class="btn btn-primary" @click="saveRename" :disabled="!modal.renameName">Salvar</button>
                </div>
            </div>
        </div>

        <!-- Share Modal -->
        <div class="modal-backdrop" v-if="modal.showShare" @click.self="modal.showShare = false">
            <div class="modal-card glass-panel">
                <div class="modal-header">
                    <h3><i class="fa-solid fa-share-nodes"></i> Compartilhar Link Público</h3>
                    <button class="modal-close" @click="modal.showShare = false">&times;</button>
                </div>
                <div class="modal-body">
                    <p class="share-description">
                        Este arquivo agora pode ser acessado por qualquer pessoa através do link abaixo.
                        A chave de decodificação será incluída automaticamente no link como uma hash 
                        (após a tag #), o que significa que ela **nunca** será transmitida para o servidor. A decodificação ocorrerá totalmente no navegador de quem acessar!
                    </p>
                    <div class="form-group share-link-group">
                        <input type="text" id="share-link-input" :value="modal.shareLink" readOnly ref="shareLinkInput">
                        <button class="btn btn-primary btn-copy" @click="copyShareLink">
                            <i class="fa-solid fa-copy"></i> Copiar
                        </button>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline btn-block" @click="modal.showShare = false">Fechar</button>
                </div>
            </div>
        </div>

        <!-- File Preview Modal (Zero-Knowledge Decrypted in Browser) -->
        <div class="modal-backdrop" v-if="modalPreview.show" @click.self="closePreviewModal">
            <div class="modal-card modal-preview-card glass-panel">
                <div class="modal-header">
                    <h3>
                        <i :class="getFileIconClass(modalPreview.file?.name)"></i>
                        {{ modalPreview.file?.name }}
                    </h3>
                    <button class="modal-close" @click="closePreviewModal">&times;</button>
                </div>
                <div class="modal-body preview-body-content">
                    <!-- Loading Decryption Spinner -->
                    <div class="preview-loading" v-if="modalPreview.loading">
                        <i class="fa-solid fa-circle-notch fa-spin"></i>
                        <p>Descriptografando arquivos no navegador (Zero-Knowledge)...</p>
                    </div>
                    
                    <!-- Decrypted Content Viewers -->
                    <div class="preview-container" v-else>
                        <!-- Image Viewer -->
                        <div class="preview-wrapper image-preview" v-if="modalPreview.type === 'image'">
                            <img :src="modalPreview.url" alt="Visualização de Imagem">
                        </div>
                        
                        <!-- PDF Viewer -->
                        <div class="preview-wrapper pdf-preview" v-else-if="modalPreview.type === 'pdf'">
                            <iframe :src="modalPreview.url" width="100%" height="450px" frameborder="0"></iframe>
                        </div>
                        
                        <!-- Video Player -->
                        <div class="preview-wrapper video-preview" v-else-if="modalPreview.type === 'video'">
                            <video :src="modalPreview.url" controls autoplay></video>
                        </div>
                        
                        <!-- Audio Player -->
                        <div class="preview-wrapper audio-preview" v-else-if="modalPreview.type === 'audio'">
                            <div class="audio-card">
                                <i class="fa-solid fa-music"></i>
                                <audio :src="modalPreview.url" controls autoplay></audio>
                            </div>
                        </div>
                        
                        <!-- Text / Code Viewer -->
                        <div class="preview-wrapper text-preview" v-else-if="modalPreview.type === 'text'">
                            <pre><code>{{ modalPreview.textContent }}</code></pre>
                        </div>
                        
                        <!-- Unsupported Fallback -->
                        <div class="preview-wrapper unsupported-preview" v-else>
                            <i class="fa-solid fa-file-circle-question"></i>
                            <h3>Visualização indisponível</h3>
                            <p>Este formato não pode ser exibido diretamente no navegador.</p>
                            <button class="btn btn-primary" @click="downloadFile(modalPreview.file); closePreviewModal();">
                                <i class="fa-solid fa-cloud-arrow-down"></i> Baixar Arquivo Plano
                            </button>
                        </div>
                    </div>
                </div>
                <div class="modal-footer" v-if="!modalPreview.loading">
                    <span class="preview-file-size">{{ formatBytes(modalPreview.file?.sizeBytes) }}</span>
                    <div class="modal-footer-actions">
                        <button class="btn btn-outline" @click="closePreviewModal">Fechar</button>
                        <button class="btn btn-primary" @click="downloadFile(modalPreview.file)">
                            <i class="fa-solid fa-cloud-arrow-down"></i> Download
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Floating Uploads/Downloads Manager Panel -->
        <div class="uploads-panel glass-panel" v-if="uploads.length > 0 && showTransfersPanel">
            <div class="uploads-header">
                <div class="uploads-header-title" @click="isTransfersExpanded = !isTransfersExpanded">
                    <h4>
                        <i class="fa-solid fa-spinner fa-spin text-primary" v-if="uploads.some(up => up.status === 'uploading')"></i>
                        <i class="fa-solid fa-circle-check text-success" v-else></i>
                        Transferências ({{ uploads.filter(u => u.status === 'completed').length }}/{{ uploads.length }})
                    </h4>
                </div>
                <div class="uploads-header-controls">
                    <button class="btn-text btn-clear-finished" @click="clearFinishedUploads" title="Limpar concluídos">Limpar</button>
                    <button class="panel-control-btn" @click="isTransfersExpanded = !isTransfersExpanded" :title="isTransfersExpanded ? 'Minimizar' : 'Maximizar'">
                        <i class="fa-solid" :class="isTransfersExpanded ? 'fa-chevron-down' : 'fa-chevron-up'"></i>
                    </button>
                    <button class="panel-control-btn" @click="showTransfersPanel = false" title="Fechar">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>
            <div class="uploads-list" v-show="isTransfersExpanded">
                <div class="upload-item" v-for="up in uploads" :key="up.id">
                    <div class="upload-info">
                        <span class="upload-name" :title="up.name">
                            <i class="fa-solid fa-cloud-arrow-down text-primary" v-if="up.name.toLowerCase().includes('download')"></i>
                            <i class="fa-solid fa-cloud-arrow-up text-success" v-else></i>
                            {{ up.name }}
                        </span>
                        <div class="upload-meta-controls" style="display: flex; align-items: center; gap: 8px;">
                            <span class="upload-status" :class="up.status">{{ up.statusText }}</span>
                            <div class="transfer-action-buttons" v-if="up.status === 'uploading' || up.status === 'paused'" style="display: flex; gap: 4px;">
                                <button class="btn-transfer-action" v-if="up.status === 'uploading'" @click="up.paused = true" title="Pausar" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 2px 4px; font-size: 11px;">
                                    <i class="fa-solid fa-pause"></i>
                                </button>
                                <button class="btn-transfer-action" v-else-if="up.status === 'paused'" @click="up.paused = false" title="Retomar" style="background: none; border: none; color: var(--secondary); cursor: pointer; padding: 2px 4px; font-size: 11px;">
                                    <i class="fa-solid fa-play"></i>
                                </button>
                                <button class="btn-transfer-action btn-transfer-cancel" @click="cancelTransfer(up)" title="Cancelar" style="background: none; border: none; color: var(--danger); cursor: pointer; padding: 2px 4px; font-size: 11px;">
                                    <i class="fa-solid fa-xmark"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="upload-progress-bar">
                        <div class="upload-progress" :style="{ width: up.progress + '%' }" :class="up.status"></div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Floating Restore/Show Transfers Button (visible only when panel is hidden by user) -->
        <button class="btn-show-transfers glass-panel" v-if="uploads.length > 0 && !showTransfersPanel" @click="showTransfersPanel = true; isTransfersExpanded = true;">
            <i class="fa-solid fa-spinner fa-spin text-primary" v-if="uploads.some(up => up.status === 'uploading')"></i>
            <i class="fa-solid fa-cloud-arrow-up text-success" v-else></i>
            <span>Mostrar Transferências ({{ uploads.length }})</span>
        </button>
    </div>
</template>
