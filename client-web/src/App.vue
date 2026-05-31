<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

// ── Composables ─────────────────────────────────────────────────────────
import { useTheme }     from './composables/useTheme.js'
import { useToast }     from './composables/useToast.js'
import { useAuth }      from './composables/useAuth.js'
import { useExplorer }  from './composables/useExplorer.js'
import { useTransfers } from './composables/useTransfers.js'
import { useSharing }   from './composables/useSharing.js'

// ── Components ───────────────────────────────────────────────────────────
import AppHeader        from './components/AppHeader.vue'
import AppSidebar       from './components/AppSidebar.vue'
import FileExplorer     from './components/FileExplorer.vue'
import TrashBin         from './components/TrashBin.vue'
import TransferManager  from './components/TransferManager.vue'

import ModalCreateFolder from './components/modals/ModalCreateFolder.vue'
import ModalRename       from './components/modals/ModalRename.vue'
import ModalShare        from './components/modals/ModalShare.vue'
import ModalPreview      from './components/modals/ModalPreview.vue'

// ── State ────────────────────────────────────────────────────────────────
const { initTheme }                                   = useTheme()
const { toasts, removeToast, getToastIcon }           = useToast()
const { isAuthenticated, isVaultLocked, authView,
        authLoading, username, masterKey,
        unlockPassword, authForm,
        handleLogin, handleRegister,
        handleVerifyEmail, logout, unlockVault,
        restoreSessionFromStorage }                   = useAuth()
const { loadExplorer, refreshQuota,
        currentFolderId }                             = useExplorer()
const { uploads, showTransfersPanel, isTransfersExpanded,
        uploadFilePipeline, downloadFile,
        clearFinishedUploads, cancelTransfer,
        loadPendingUploadsFromStorage,
        resumePendingFileSelection }                  = useTransfers()
const { showShareModal, shareFile,
        checkSharedLinkAccess }                       = useSharing()

// ── Local UI State ───────────────────────────────────────────────────────
const currentTab      = ref('files')
const showNewDropdown = ref(false)
const fileInputRef    = ref(null)

// Modals
const showCreateFolder = ref(false)
const renameTarget     = ref(null)
const previewTarget    = ref(null) // file object

// ── Handlers ─────────────────────────────────────────────────────────────
async function afterLogin() {
    await refreshQuota()
    await loadExplorer(masterKey.value)
    loadPendingUploadsFromStorage()
}

async function onLogin() {
    await handleLogin()
    if (isAuthenticated.value) await afterLogin()
}

function setTab(tab) {
    currentTab.value = tab
    if (tab === 'files' || tab === 'trash') loadExplorer(masterKey.value)
}

function triggerFileInput() { fileInputRef.value?.click() }

function handleFileSelection(event) {
    const selected = event.target.files
    if (selected?.length) Array.from(selected).forEach(f => startUpload(f))
}

function handleDropFiles(files) {
    files.forEach(f => startUpload(f))
}

function startUpload(file) {
    uploadFilePipeline(file, currentFolderId.value, masterKey.value, async () => {
        await loadExplorer(masterKey.value)
        await refreshQuota()
    })
}

function onPreviewFile(file) { previewTarget.value = file }
function onDownloadFile(file) {
    downloadFile(file, masterKey.value, async () => {
        await loadExplorer(masterKey.value)
    })
}
function onShareFile(file) { shareFile(file, masterKey.value) }
function onOpenRename(item, type) { renameTarget.value = { item, type } }

function closeNewDropdown(e) {
    if (!e.target.closest('.new-button-container')) showNewDropdown.value = false
}

// ── Lifecycle ─────────────────────────────────────────────────────────────
onMounted(async () => {
    // Service Worker
    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('/sw.js')
            if (!navigator.serviceWorker.controller && !sessionStorage.getItem('sw_reloaded')) {
                sessionStorage.setItem('sw_reloaded', '1')
                globalThis.location.reload()
            }
        } catch (err) { console.error('SW register error:', err) }
    }

    initTheme()
    globalThis.addEventListener('click', closeNewDropdown)
    await checkSharedLinkAccess()
    restoreSessionFromStorage()
})

onBeforeUnmount(() => { globalThis.removeEventListener('click', closeNewDropdown) })
</script>

<template>
    <div>
        <!-- Toast Notifications -->
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
        <AppHeader />

        <main class="main-container">
            <!-- 0. Vault Lock Screen -->
            <section class="auth-section" v-if="isVaultLocked">
                <div class="auth-card glass-panel animate-fade-in">
                    <div class="auth-header">
                        <div style="font-size:48px;color:var(--secondary);margin-bottom:20px;text-shadow:0 0 20px var(--secondary-glow);display:flex;justify-content:center">
                            <i class="fa-solid fa-lock"></i>
                        </div>
                        <h2>Cofre Bloqueado</h2>
                        <p>Sua sessão está ativa, mas a chave mestra foi apagada da RAM. Insira sua Senha Mestra para descriptografar os dados localmente.</p>
                    </div>
                    <form @submit.prevent="unlockVault().then(afterLogin)" class="auth-form">
                        <div class="form-group">
                            <label for="unlock-username"><i class="fa-solid fa-user"></i> Usuário</label>
                            <input id="unlock-username" type="text" :value="username" disabled style="background:rgba(255,255,255,0.03);color:var(--text-muted);cursor:not-allowed;border:1px solid var(--glass-border);opacity:0.7">
                        </div>
                        <div class="form-group">
                            <label for="unlock-password"><i class="fa-solid fa-key"></i> Senha Mestra</label>
                            <input type="password" id="unlock-password" v-model="unlockPassword"
                                placeholder="Digite sua senha mestra..." required autocomplete="current-password" autofocus>
                        </div>
                        <button type="submit" class="btn btn-primary btn-block" :disabled="authLoading">
                            <span v-if="authLoading"><i class="fa-solid fa-circle-notch fa-spin"></i> Desbloqueando...</span>
                            <span v-else>Desbloquear Cofre <i class="fa-solid fa-unlock"></i></span>
                        </button>
                        <button type="button" class="btn btn-outline btn-block" @click="logout" style="margin-top:12px">
                            <i class="fa-solid fa-right-from-bracket"></i> Sair da Conta
                        </button>
                    </form>
                </div>
            </section>

            <!-- 1. Auth Screens -->
            <section class="auth-section" v-else-if="!isAuthenticated">
                <!-- Login -->
                <div class="auth-card glass-panel" v-if="authView === 'login'">
                    <div class="auth-header">
                        <h2>Bem-vindo de volta</h2>
                        <p>Entre no seu cofre digital criptografado.</p>
                    </div>
                    <form @submit.prevent="onLogin" class="auth-form">
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

                <!-- Register -->
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
                            <input type="email" id="reg-email" v-model="authForm.email" placeholder="Seu melhor e-mail..." required>
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
                    </div>
                </div>

                <!-- Verify Email -->
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

            <!-- 2. Dashboard Autenticado -->
            <section class="dashboard-section" v-else>
                <AppSidebar
                    :current-tab="currentTab"
                    v-model:show-new-dropdown="showNewDropdown"
                    @set-tab="setTab"
                    @open-create-folder="showCreateFolder = true"
                    @trigger-upload="triggerFileInput"
                />

                <div class="content-panel">
                    <!-- Input de arquivo escondido -->
                    <input type="file" ref="fileInputRef" @change="handleFileSelection" style="display:none" multiple>

                    <FileExplorer v-if="currentTab === 'files'"
                        @preview="onPreviewFile"
                        @download="onDownloadFile"
                        @share="onShareFile"
                        @open-rename="onOpenRename"
                        @trigger-upload="handleDropFiles"
                    />
                    <TrashBin v-else-if="currentTab === 'trash'" />
                    <TransferManager v-else-if="currentTab === 'transfers'" />
                </div>
            </section>
        </main>

        <!-- Modals -->
        <ModalCreateFolder v-if="showCreateFolder" @close="showCreateFolder = false" />
        <ModalRename v-if="renameTarget" :item="renameTarget.item" :type="renameTarget.type" @close="renameTarget = null" />
        <ModalShare v-if="showShareModal" @close="showShareModal.value = false" />
        <ModalPreview v-if="previewTarget" :file="previewTarget"
            @close="previewTarget = null"
            @download="onDownloadFile"
        />

        <!-- Floating Transfer Panel -->
        <div class="uploads-panel glass-panel" v-if="uploads.length > 0 && showTransfersPanel">
            <div class="uploads-header">
                <div class="uploads-header-title" @click="isTransfersExpanded = !isTransfersExpanded">
                    <h4>
                        <i class="fa-solid fa-spinner fa-spin text-primary" v-if="uploads.some(u => u.status === 'uploading')"></i>
                        <i class="fa-solid fa-circle-check text-success" v-else></i>
                        Transferências ({{ uploads.filter(u => u.status === 'completed').length }}/{{ uploads.length }})
                    </h4>
                </div>
                <div class="uploads-header-controls">
                    <button class="btn-text btn-clear-finished" @click="clearFinishedUploads" title="Limpar concluídos">Limpar</button>
                    <button class="panel-control-btn" @click="isTransfersExpanded = !isTransfersExpanded">
                        <i class="fa-solid" :class="isTransfersExpanded ? 'fa-chevron-down' : 'fa-chevron-up'"></i>
                    </button>
                    <button class="panel-control-btn" @click="showTransfersPanel = false">
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
                        <div class="upload-meta-controls" style="display:flex;align-items:center;gap:8px">
                            <span class="upload-status" :class="up.status">{{ up.statusText }}</span>
                            <div v-if="up.status === 'uploading' || up.status === 'paused'" style="display:flex;gap:4px">
                                <button v-if="up.status === 'uploading'" @click="up.paused = true" style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:2px 4px;font-size:11px"><i class="fa-solid fa-pause"></i></button>
                                <button v-else @click="up.paused = false" style="background:none;border:none;color:var(--secondary);cursor:pointer;padding:2px 4px;font-size:11px"><i class="fa-solid fa-play"></i></button>
                                <button @click="cancelTransfer(up)" style="background:none;border:none;color:var(--danger);cursor:pointer;padding:2px 4px;font-size:11px"><i class="fa-solid fa-xmark"></i></button>
                            </div>
                        </div>
                    </div>
                    <div class="upload-progress-bar">
                        <div class="upload-progress" :style="{ width: up.progress + '%' }" :class="up.status"></div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Botão flutuante de mostrar painel -->
        <button class="btn-show-transfers glass-panel"
            v-if="uploads.length > 0 && !showTransfersPanel"
            @click="showTransfersPanel = true; isTransfersExpanded = true">
            <i class="fa-solid fa-spinner fa-spin text-primary" v-if="uploads.some(u => u.status === 'uploading')"></i>
            <i class="fa-solid fa-cloud-arrow-up text-success" v-else></i>
            <span>Mostrar Transferências ({{ uploads.length }})</span>
        </button>
    </div>
</template>
