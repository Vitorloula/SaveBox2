<!-- TrashBin — Lista de itens na lixeira com restauração e esvaziamento -->
<script setup>
import { useExplorer } from '../composables/useExplorer.js';
import { useAuth } from '../composables/useAuth.js';

const { masterKey } = useAuth();
const { trashFolders, trashFiles, restoreFolder, restoreFile, emptyTrash } = useExplorer();

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024, sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    try { return new Date(dateStr).toLocaleString('pt-BR'); } catch { return dateStr; }
}
</script>

<template>
    <div class="tab-content">
        <div class="explorer-toolbar glass-panel">
            <div class="breadcrumbs">
                <span class="breadcrumb-item active">
                    <i class="fa-solid fa-trash-can"></i> Itens Excluídos
                </span>
            </div>
            <div class="toolbar-actions">
                <button class="btn btn-primary btn-danger" @click="emptyTrash(masterKey)"
                    :disabled="trashFolders.length === 0 && trashFiles.length === 0">
                    <i class="fa-solid fa-dumpster-fire"></i> Esvaziar Lixeira
                </button>
            </div>
        </div>

        <div class="explorer-body glass-panel">
            <!-- Lixeira vazia -->
            <div class="empty-explorer" v-if="trashFolders.length === 0 && trashFiles.length === 0">
                <i class="fa-solid fa-trash-arrow-up"></i>
                <h3>Lixeira Vazia</h3>
                <p>Itens excluídos aparecerão aqui. Você poderá restaurá-los se necessário.</p>
            </div>

            <div class="items-list" v-else>
                <div class="list-header">
                    <div class="col-name">Nome</div>
                    <div class="col-size">Tamanho</div>
                    <div class="col-date">Excluído em</div>
                    <div class="col-actions">Ações</div>
                </div>

                <!-- Pastas na lixeira -->
                <div class="list-row item-folder" v-for="folder in trashFolders" :key="'tf-' + folder.id">
                    <div class="col-name">
                        <i class="fa-solid fa-folder-minus"></i>
                        <span>{{ folder.name }}</span>
                    </div>
                    <div class="col-size">—</div>
                    <div class="col-date">{{ formatDate(folder.updatedAt) }}</div>
                    <div class="col-actions">
                        <button class="action-btn action-btn-success" title="Restaurar" @click="restoreFolder(folder.id, masterKey)">
                            <i class="fa-solid fa-arrow-rotate-left"></i>
                        </button>
                    </div>
                </div>

                <!-- Arquivos na lixeira -->
                <div class="list-row item-file" v-for="file in trashFiles" :key="'tfil-' + file.id">
                    <div class="col-name">
                        <i class="fa-solid fa-file-lines"></i>
                        <span>{{ file.name }}</span>
                    </div>
                    <div class="col-size">{{ formatBytes(file.sizeBytes) }}</div>
                    <div class="col-date">{{ formatDate(file.updatedAt) }}</div>
                    <div class="col-actions">
                        <button class="action-btn action-btn-success" title="Restaurar" @click="restoreFile(file.id, masterKey)">
                            <i class="fa-solid fa-arrow-rotate-left"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
