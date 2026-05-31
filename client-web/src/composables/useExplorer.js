// =======================================================================
// EXPLORER COMPOSABLE
// Single Responsibility: listagem, navegação, breadcrumbs, filtros,
// operações CRUD em pastas e arquivos (sem I/O criptográfico de dados)
// =======================================================================
import { ref, computed } from "vue";
import { encryptText, decryptText, computeSHA256 } from "./useCrypto.js";
import { useApi } from "./useApi.js";
import { useToast } from "./useToast.js";

const { fetchAPI } = useApi();
const { showToast } = useToast();

// ── State ─────────────────────────────────────────────────────────────────
const currentFolderId = ref(null);
const folders = ref([]);
const files = ref([]);
const trashFolders = ref([]);
const trashFiles = ref([]);
const breadcrumbs = ref([]);
const allSystemFolders = ref([]);
const searchQuery = ref("");
const quotaUsed = ref(0);
const quotaTotal = ref(10737418240);

export function useExplorer() {
    // ── Computed ────────────────────────────────────────────────────────
    const quotaPercent = computed(() => {
        if (quotaTotal.value === 0) return 0;
        return Math.min(100, Math.round((quotaUsed.value / quotaTotal.value) * 100));
    });

    const filteredFolders = computed(() => {
        let list = folders.value.filter(f => f.parentId === currentFolderId.value);
        if (searchQuery.value) {
            const q = searchQuery.value.toLowerCase();
            list = list.filter(f => f.name.toLowerCase().includes(q));
        }
        return list.sort((a, b) => a.name.localeCompare(b.name));
    });

    const filteredFiles = computed(() => {
        let list = files.value.filter(f => f.folderId === currentFolderId.value);
        if (searchQuery.value) {
            const q = searchQuery.value.toLowerCase();
            list = list.filter(f => f.name.toLowerCase().includes(q));
        }
        return list.sort((a, b) => a.name.localeCompare(b.name));
    });

    const folderTree = computed(() => {
        const result = [];
        function traverse(folder, depth) {
            result.push({ ...folder, depth });
            allSystemFolders.value
                .filter(f => f.parentId === folder.id)
                .sort((a, b) => a.name.localeCompare(b.name))
                .forEach(child => traverse(child, depth + 1));
        }
        allSystemFolders.value
            .filter(f => f.parentId === null)
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach(rf => traverse(rf, 0));
        return result;
    });

    // ── Load ─────────────────────────────────────────────────────────────
    async function loadExplorer(masterKey) {
        try {
            const res = await fetchAPI("/tree");
            if (!res.ok) throw new Error("Falha ao obter estrutura");
            const data = await res.json();

            const decryptedFolders = await Promise.all(
                (data.folders || []).map(async f => ({
                    id: f.id,
                    parentId: f.parent_id || null,
                    name: await decryptText(f.encrypted_name, masterKey),
                    createdAt: f.created_at,
                    updatedAt: f.updated_at,
                    isDeleted: f.is_deleted
                }))
            );

            const decryptedFiles = await Promise.all(
                (data.files || []).map(async fil => ({
                    id: fil.id,
                    folderId: fil.folder_id || null,
                    name: await decryptText(fil.encrypted_name, masterKey),
                    sizeBytes: fil.size_bytes,
                    encryptedFDK: fil.encrypted_fdk,
                    createdAt: fil.created_at,
                    updatedAt: fil.updated_at,
                    isDeleted: fil.is_deleted
                }))
            );

            allSystemFolders.value = decryptedFolders.filter(f => !f.isDeleted);
            folders.value = decryptedFolders.filter(f => !f.isDeleted);
            files.value = decryptedFiles.filter(f => !f.isDeleted);

            // Lixeira
            const trashRes = await fetchAPI("/trash");
            if (trashRes.ok) {
                const trashData = await trashRes.json();
                trashFolders.value = await Promise.all(
                    (trashData.folders || []).map(async f => ({
                        id: f.id,
                        name: await decryptText(f.encrypted_name, masterKey),
                        updatedAt: f.deleted_at || null,
                        isDeleted: true
                    }))
                );
                trashFiles.value = await Promise.all(
                    (trashData.files || []).map(async fil => ({
                        id: fil.id,
                        name: await decryptText(fil.encrypted_name, masterKey),
                        sizeBytes: fil.size_bytes,
                        updatedAt: fil.deleted_at || null,
                        isDeleted: true
                    }))
                );
            } else {
                trashFolders.value = [];
                trashFiles.value = [];
            }

            rebuildBreadcrumbs();
        } catch (err) {
            showToast("Erro ao carregar arquivos", err.message, "error");
        }
    }

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

    // ── Navigation ────────────────────────────────────────────────────────
    function navigateToFolder(folderId) {
        currentFolderId.value = folderId;
        searchQuery.value = "";
        rebuildBreadcrumbs();
    }

    function rebuildBreadcrumbs() {
        if (!currentFolderId.value) { breadcrumbs.value = []; return; }
        const trail = [];
        let id = currentFolderId.value;
        while (id) {
            const folder = folders.value.find(f => f.id === id);
            if (folder) { trail.unshift({ id: folder.id, name: folder.name }); id = folder.parentId; }
            else break;
        }
        breadcrumbs.value = trail;
    }

    function getFolderPathRepresentation(folderId) {
        const trail = [];
        let id = folderId;
        while (id) {
            const folder = folders.value.find(f => f.id === id);
            if (folder) { trail.unshift(folder.name); id = folder.parentId; }
            else break;
        }
        return "/" + trail.join("/");
    }

    // ── Folder CRUD ──────────────────────────────────────────────────────
    async function createFolder(plainName, masterKey) {
        if (!plainName.trim()) return;
        try {
            const encryptedName = await encryptText(plainName.trim(), masterKey);
            const nameHash = await computeSHA256(plainName.trim());
            const res = await fetchAPI("/folders", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ parent_id: currentFolderId.value, encrypted_name: encryptedName, name_hash: nameHash })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Falha ao criar pasta");
            showToast("Pasta Criada", `A pasta "${plainName}" foi criada com sucesso.`, "success");
            await loadExplorer(masterKey);
        } catch (err) {
            showToast("Erro ao criar pasta", err.message, "error");
        }
    }

    async function deleteFolder(folderId, masterKey) {
        try {
            const res = await fetchAPI(`/folders/${folderId}`, { method: "DELETE" });
            if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Erro ao mover para a lixeira"); }
            showToast("Pasta Excluída", "Pasta movida para a lixeira.", "success");
            await loadExplorer(masterKey);
            await refreshQuota();
        } catch (err) {
            showToast("Erro", err.message, "error");
        }
    }

    async function deleteFile(fileId, masterKey) {
        try {
            const res = await fetchAPI(`/files/${fileId}`, { method: "DELETE" });
            if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Erro ao excluir arquivo"); }
            showToast("Arquivo Excluído", "Arquivo movido para a lixeira.", "success");
            await loadExplorer(masterKey);
            await refreshQuota();
        } catch (err) {
            showToast("Erro", err.message, "error");
        }
    }

    async function saveRename(item, type, newPlainName, newParentId, masterKey) {
        if (!newPlainName.trim()) return;
        try {
            const encName = await encryptText(newPlainName.trim(), masterKey);
            const nameHash = await computeSHA256(newPlainName.trim());
            const parentIdVal = newParentId === 0 ? null : newParentId;

            const endpoint = type === "file" ? `/files/${item.id}` : `/folders/${item.id}`;
            const body = type === "file"
                ? { encrypted_name: encName, name_hash: nameHash, folder_id: parentIdVal }
                : { encrypted_name: encName, name_hash: nameHash, parent_id: parentIdVal };

            const res = await fetchAPI(endpoint, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Falha na atualização"); }
            showToast("Item Atualizado", "Nome e localização atualizados.", "success");
            await loadExplorer(masterKey);
        } catch (err) {
            showToast("Erro ao editar item", err.message, "error");
        }
    }

    // ── Trash Actions ────────────────────────────────────────────────────
    async function restoreFolder(folderId, masterKey) {
        try {
            const res = await fetchAPI(`/folders/${folderId}/restore`, { method: "POST" });
            if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Erro ao restaurar pasta"); }
            showToast("Pasta Restaurada", "Pasta retornada ao local original.", "success");
            await loadExplorer(masterKey);
        } catch (err) {
            showToast("Erro ao restaurar", err.message, "error");
        }
    }

    async function restoreFile(fileId, masterKey) {
        try {
            const res = await fetchAPI(`/files/${fileId}/restore`, { method: "POST" });
            if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Erro ao restaurar arquivo"); }
            showToast("Arquivo Restaurado", "Arquivo retornado ao local original.", "success");
            await loadExplorer(masterKey);
            await refreshQuota();
        } catch (err) {
            showToast("Erro ao restaurar", err.message, "error");
        }
    }

    async function emptyTrash(masterKey) {
        try {
            const res = await fetchAPI("/trash/empty", { method: "DELETE" });
            if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Erro ao esvaziar lixeira"); }
            showToast("Lixeira Esvaziada", "Todos os itens foram deletados definitivamente.", "success");
            await loadExplorer(masterKey);
            await refreshQuota();
        } catch (err) {
            showToast("Erro", err.message, "error");
        }
    }

    return {
        // state
        currentFolderId, folders, files, trashFolders, trashFiles,
        breadcrumbs, allSystemFolders, searchQuery, quotaUsed, quotaTotal,
        // computed
        quotaPercent, filteredFolders, filteredFiles, folderTree,
        // methods
        loadExplorer, refreshQuota, navigateToFolder, rebuildBreadcrumbs,
        getFolderPathRepresentation, createFolder, deleteFolder, deleteFile,
        saveRename, restoreFolder, restoreFile, emptyTrash
    };
}
