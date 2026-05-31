<!-- AppSidebar — Navegação lateral: novo, árvore de pastas, lixeira, transferências, quota -->
<script setup>
import { useExplorer } from '../composables/useExplorer.js';
import { useTransfers } from '../composables/useTransfers.js';

const props = defineProps({
    currentTab: { type: String, required: true },
    showNewDropdown: { type: Boolean, default: false }
});

const emit = defineEmits([
    'set-tab',
    'open-create-folder',
    'trigger-upload',
    'update:showNewDropdown'
]);

const {
    currentFolderId, folderTree, quotaUsed, quotaTotal, quotaPercent,
    navigateToFolder
} = useExplorer();

const { uploads } = useTransfers();

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024, dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
</script>

<template>
    <aside class="sidebar-panel glass-panel">
        <!-- Botão "+ Novo" estilo Google Drive -->
        <div class="new-button-container">
            <button class="btn-new-drive" @click.stop="emit('update:showNewDropdown', !showNewDropdown)">
                <i class="fa-solid fa-plus"></i>
                <span>Novo</span>
            </button>
            <div class="new-dropdown glass-panel" v-if="showNewDropdown">
                <button @click="emit('open-create-folder'); emit('update:showNewDropdown', false)">
                    <i class="fa-solid fa-folder-plus text-primary"></i> Nova pasta
                </button>
                <button @click="emit('trigger-upload'); emit('update:showNewDropdown', false)">
                    <i class="fa-solid fa-cloud-arrow-up text-success"></i> Fazer upload de arquivo
                </button>
            </div>
        </div>

        <div class="menu-navigation">
            <!-- Meu Drive -->
            <button :class="['menu-btn', { active: currentTab === 'files' }]" @click="emit('set-tab', 'files')">
                <i class="fa-solid fa-hard-drive"></i> Meu Drive
            </button>

            <!-- Árvore de Pastas -->
            <div class="sidebar-tree-container" v-if="currentTab === 'files'">
                <div class="sidebar-tree-title">Navegar Pastas</div>
                <div class="sidebar-tree-empty" v-if="folderTree.length === 0">Nenhuma pasta criada</div>
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

            <!-- Lixeira -->
            <button :class="['menu-btn', { active: currentTab === 'trash' }]" @click="emit('set-tab', 'trash')">
                <i class="fa-solid fa-trash-can"></i> Lixeira
            </button>

            <!-- Transferências -->
            <button :class="['menu-btn', { active: currentTab === 'transfers' }]" @click="emit('set-tab', 'transfers')" style="position:relative">
                <i class="fa-solid fa-arrow-up-down"></i> Transferências
                <span v-if="uploads.some(u => u.status === 'uploading')"
                    style="position:absolute;right:12px;top:50%;transform:translateY(-50%);font-size:10px;color:var(--secondary)">
                    <i class="fa-solid fa-spinner fa-spin"></i>
                </span>
            </button>
        </div>

        <!-- Quota de Armazenamento -->
        <div class="quota-container">
            <div class="quota-header">
                <span><i class="fa-solid fa-hard-drive"></i> Uso de Armazenamento</span>
                <span class="quota-perc">{{ quotaPercent }}%</span>
            </div>
            <div class="quota-progress-bar">
                <div class="quota-progress"
                    :style="{ width: quotaPercent + '%' }"
                    :class="{ 'quota-warning': quotaPercent > 80, 'quota-danger': quotaPercent > 95 }">
                </div>
            </div>
            <div class="quota-details">
                <span>{{ formatBytes(quotaUsed) }} usados</span>
                <span>de {{ formatBytes(quotaTotal) }}</span>
            </div>
        </div>
    </aside>
</template>
