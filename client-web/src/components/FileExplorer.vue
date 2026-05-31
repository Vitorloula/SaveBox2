<!-- FileExplorer — Grid/lista de pastas e arquivos com drag-and-drop -->
<script setup>
import { ref } from 'vue';
import { useExplorer } from '../composables/useExplorer.js';
import { useAuth } from '../composables/useAuth.js';

const props = defineProps({
    fileInputRef: { default: null }
});

const emit = defineEmits(['preview', 'download', 'share', 'open-rename', 'trigger-upload']);

const { masterKey } = useAuth();
const {
    currentFolderId, filteredFolders, filteredFiles,
    breadcrumbs, searchQuery,
    navigateToFolder, deleteFolder, deleteFile
} = useExplorer();

const dragActive = ref(false);

function getFileIconClass(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
        pdf: 'fa-file-pdf', doc: 'fa-file-word', docx: 'fa-file-word',
        xls: 'fa-file-excel', xlsx: 'fa-file-excel', ppt: 'fa-file-powerpoint', pptx: 'fa-file-powerpoint',
        js: 'fa-file-code', ts: 'fa-file-code', html: 'fa-file-code', css: 'fa-file-code',
        cpp: 'fa-file-code', java: 'fa-file-code', py: 'fa-file-code',
        mp3: 'fa-file-audio', wav: 'fa-file-audio', flac: 'fa-file-audio',
        mp4: 'fa-file-video', mkv: 'fa-file-video', avi: 'fa-file-video',
        jpg: 'fa-file-image', jpeg: 'fa-file-image', png: 'fa-file-image', gif: 'fa-file-image', svg: 'fa-file-image'
    };
    return 'fa-solid ' + (map[ext] || 'fa-file-lines');
}

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

function handleFileDrop(event) {
    dragActive.value = false;
    const dropped = event.dataTransfer.files;
    if (dropped?.length > 0) emit('trigger-upload', Array.from(dropped));
}
</script>

<template>
    <div class="tab-content">
        <!-- Toolbar -->
        <div class="explorer-toolbar glass-panel">
            <!-- Breadcrumbs -->
            <div class="breadcrumbs">
                <span class="breadcrumb-item" @click="navigateToFolder(null)">
                    <i class="fa-solid fa-house"></i> Raiz
                </span>
                <span v-for="folder in breadcrumbs" :key="folder.id" class="breadcrumb-item" @click="navigateToFolder(folder.id)">
                    <i class="fa-solid fa-chevron-right breadcrumb-separator"></i>
                    {{ folder.name }}
                </span>
            </div>
            <!-- Busca -->
            <div class="search-box">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" v-model="searchQuery" placeholder="Pesquisar no Drive...">
            </div>
        </div>

        <!-- Área de Drop -->
        <div class="explorer-body glass-panel"
            @dragenter.prevent="dragActive = true"
            @dragover.prevent="dragActive = true"
            @dragleave.prevent="dragActive = false"
            @drop.prevent="handleFileDrop"
            :class="{ 'drag-active': dragActive }">

            <div class="drop-overlay" v-if="dragActive">
                <div class="drop-message">
                    <i class="fa-solid fa-cloud-arrow-up fa-bounce"></i>
                    <h3>Solte seus arquivos aqui</h3>
                    <p>Eles serão criptografados em chunks no seu navegador antes de serem enviados.</p>
                </div>
            </div>

            <!-- Pasta/Arquivo vazio -->
            <div class="empty-explorer" v-if="filteredFolders.length === 0 && filteredFiles.length === 0">
                <i class="fa-solid fa-box-open"></i>
                <h3>Nenhum item encontrado</h3>
                <p>Esta pasta está vazia. Crie uma pasta ou arraste arquivos para começar.</p>
            </div>

            <div class="explorer-sections" v-else>
                <!-- Grid de Pastas -->
                <div class="folders-section" v-if="filteredFolders.length > 0">
                    <h3 class="section-title">Pastas</h3>
                    <div class="folders-grid">
                        <div class="folder-card" v-for="folder in filteredFolders" :key="'f-' + folder.id"
                            @dblclick="navigateToFolder(folder.id)">
                            <div class="folder-card-left" @click="navigateToFolder(folder.id)">
                                <i class="fa-solid fa-folder"></i>
                                <span :title="folder.name">{{ folder.name }}</span>
                            </div>
                            <div class="folder-card-actions">
                                <button class="action-btn" title="Renomear" @click.stop="emit('open-rename', folder, 'folder')">
                                    <i class="fa-solid fa-pen"></i>
                                </button>
                                <button class="action-btn action-btn-danger" title="Mover para Lixeira" @click.stop="deleteFolder(folder.id, masterKey)">
                                    <i class="fa-solid fa-trash-can"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Lista de Arquivos -->
                <div class="files-section" v-if="filteredFiles.length > 0">
                    <h3 class="section-title" v-if="filteredFolders.length > 0">Arquivos</h3>
                    <div class="items-list">
                        <div class="list-header">
                            <div class="col-name">Nome</div>
                            <div class="col-size">Tamanho</div>
                            <div class="col-date">Última Modificação</div>
                            <div class="col-actions">Ações</div>
                        </div>
                        <div class="list-row item-file" v-for="file in filteredFiles" :key="'fil-' + file.id"
                            @dblclick="emit('preview', file)">
                            <div class="col-name" @click="emit('preview', file)" style="cursor:pointer">
                                <i :class="getFileIconClass(file.name)"></i>
                                <span :title="file.name" class="file-name-preview-link">{{ file.name }}</span>
                            </div>
                            <div class="col-size">{{ formatBytes(file.sizeBytes) }}</div>
                            <div class="col-date">{{ formatDate(file.createdAt) }}</div>
                            <div class="col-actions">
                                <button class="action-btn" title="Visualizar" @click="emit('preview', file)">
                                    <i class="fa-solid fa-eye"></i>
                                </button>
                                <button class="action-btn action-btn-success" title="Download" @click="emit('download', file)">
                                    <i class="fa-solid fa-cloud-arrow-down"></i>
                                </button>
                                <button class="action-btn" title="Compartilhar" @click="emit('share', file)">
                                    <i class="fa-solid fa-share-nodes"></i>
                                </button>
                                <button class="action-btn" title="Renomear / Mover" @click="emit('open-rename', file, 'file')">
                                    <i class="fa-solid fa-pen"></i>
                                </button>
                                <button class="action-btn action-btn-danger" title="Mover para Lixeira" @click="deleteFile(file.id, masterKey)">
                                    <i class="fa-solid fa-trash-can"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
