<!-- TransferManager — Tab de monitoramento detalhado de transferências -->
<script setup>
import { useTransfers } from '../composables/useTransfers.js';
import { useAuth } from '../composables/useAuth.js';
import { useExplorer } from '../composables/useExplorer.js';

const { masterKey } = useAuth();
const { currentFolderId, loadExplorer, refreshQuota } = useExplorer();
const { uploads, clearFinishedUploads, cancelTransfer, resumePendingFileSelection } = useTransfers();
</script>

<template>
    <div class="tab-content">
        <div class="explorer-toolbar glass-panel" style="justify-content:space-between;align-items:center;display:flex;gap:20px">
            <div style="display:flex;align-items:center;gap:10px">
                <i class="fa-solid fa-arrow-up-down text-primary" style="font-size:20px"></i>
                <h2 style="font-size:18px;margin:0;font-weight:600">Monitor de Transferências</h2>
            </div>
            <div style="display:flex;gap:12px">
                <button class="btn btn-outline" @click="clearFinishedUploads" :disabled="uploads.length === 0">
                    <i class="fa-solid fa-broom"></i> Limpar Concluídos
                </button>
            </div>
        </div>

        <div class="transfers-view-layout glass-panel"
            style="padding:24px;border-radius:var(--border-radius-lg);border:1px solid var(--glass-border);min-height:400px;display:flex;flex-direction:column;gap:20px;background:var(--glass-bg);backdrop-filter:blur(10px)">
            <!-- Summary cards -->
            <div class="transfers-summary"
                style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;padding-bottom:20px;border-bottom:1px solid var(--glass-border)">
                <div class="summary-card" style="background:rgba(255,255,255,0.02);border:1px solid var(--glass-border);border-radius:var(--border-radius-md);padding:16px;display:flex;flex-direction:column;gap:6px">
                    <span style="font-size:11px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Total de Operações</span>
                    <span style="font-size:24px;font-weight:700;color:var(--text-main)">{{ uploads.length }}</span>
                </div>
                <div class="summary-card" style="background:rgba(255,255,255,0.02);border:1px solid var(--glass-border);border-radius:var(--border-radius-md);padding:16px;display:flex;flex-direction:column;gap:6px">
                    <span style="font-size:11px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Ativas / Processando</span>
                    <span style="font-size:24px;font-weight:700;color:var(--secondary)">{{ uploads.filter(u => u.status === 'uploading').length }}</span>
                </div>
                <div class="summary-card" style="background:rgba(255,255,255,0.02);border:1px solid var(--glass-border);border-radius:var(--border-radius-md);padding:16px;display:flex;flex-direction:column;gap:6px">
                    <span style="font-size:11px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Concluídas</span>
                    <span style="font-size:24px;font-weight:700;color:var(--success)">{{ uploads.filter(u => u.status === 'completed').length }}</span>
                </div>
                <div class="summary-card" style="background:rgba(255,255,255,0.02);border:1px solid var(--glass-border);border-radius:var(--border-radius-md);padding:16px;display:flex;flex-direction:column;gap:6px">
                    <span style="font-size:11px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Pausadas / Pendentes</span>
                    <span style="font-size:24px;font-weight:700;color:#eab308">{{ uploads.filter(u => u.status === 'paused').length }}</span>
                </div>
            </div>

            <!-- Lista detalhada -->
            <div style="display:flex;flex-direction:column;gap:12px;overflow-y:auto;max-height:500px;padding-right:6px">
                <!-- Estado vazio -->
                <div v-if="uploads.length === 0" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:60px 0;color:var(--text-muted)">
                    <i class="fa-solid fa-arrow-up-down" style="font-size:48px;opacity:0.3"></i>
                    <div style="text-align:center">
                        <h3 style="font-size:16px;font-weight:600;color:var(--text-main);margin-bottom:4px">Nenhuma transferência registrada</h3>
                        <p style="font-size:13px;max-width:320px;margin:0;opacity:0.7">Qualquer arquivo enviado ou baixado aparecerá detalhado nesta aba.</p>
                    </div>
                </div>

                <!-- Linhas de transferência -->
                <div v-for="up in uploads" :key="'tab-t-' + up.id" class="transfer-row glass-panel animate-fade-in"
                    style="display:flex;flex-direction:column;gap:12px;padding:16px;border-radius:var(--border-radius-md);background:rgba(255,255,255,0.01);border:1px solid var(--glass-border)">
                    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
                        <div style="display:flex;align-items:center;gap:12px;font-weight:600">
                            <i class="fa-solid fa-cloud-arrow-down text-primary" style="font-size:16px" v-if="up.name.toLowerCase().includes('download')"></i>
                            <i class="fa-solid fa-cloud-arrow-up text-success" style="font-size:16px" v-else></i>
                            <span style="color:var(--text-main);font-size:14px">{{ up.name }}</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:16px">
                            <span class="upload-status" :class="up.status" style="font-size:12px;font-weight:600">{{ up.statusText }}</span>
                            <div style="display:flex;gap:8px">
                                <!-- Pendente de vinculação -->
                                <template v-if="up.isResumePending">
                                    <button class="btn btn-primary animate-pulse" @click="resumePendingFileSelection(up, masterKey, currentFolderId, () => loadExplorer(masterKey))"
                                        style="padding:6px 12px;font-size:12px;display:flex;align-items:center;gap:6px;height:32px;border-radius:8px">
                                        <i class="fa-solid fa-file-import"></i> Vincular Arquivo
                                    </button>
                                    <button class="btn btn-outline" @click="cancelTransfer(up)"
                                        style="padding:6px 12px;font-size:12px;display:flex;align-items:center;gap:6px;color:var(--danger);border-color:rgba(239,68,68,0.3);height:32px;border-radius:8px">
                                        <i class="fa-solid fa-trash"></i> Remover
                                    </button>
                                </template>
                                <!-- Controles ativos -->
                                <template v-else-if="up.status === 'uploading' || up.status === 'paused'">
                                    <button class="btn btn-outline" v-if="up.status === 'uploading'" @click="up.paused = true"
                                        style="padding:6px 12px;font-size:12px;display:flex;align-items:center;gap:6px;height:32px;border-radius:8px">
                                        <i class="fa-solid fa-pause"></i> Pausar
                                    </button>
                                    <button class="btn btn-primary" v-else-if="up.status === 'paused'" @click="up.paused = false"
                                        style="padding:6px 12px;font-size:12px;display:flex;align-items:center;gap:6px;height:32px;border-radius:8px">
                                        <i class="fa-solid fa-play"></i> Retomar
                                    </button>
                                    <button class="btn btn-outline" @click="cancelTransfer(up)"
                                        style="padding:6px 12px;font-size:12px;display:flex;align-items:center;gap:6px;color:var(--danger);border-color:rgba(239,68,68,0.3);height:32px;border-radius:8px">
                                        <i class="fa-solid fa-xmark"></i> Cancelar
                                    </button>
                                </template>
                            </div>
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:16px">
                        <div style="flex:1;height:6px;background:rgba(255,255,255,0.05);border-radius:3px;overflow:hidden;margin:0">
                            <div class="upload-progress" :style="{ width: up.progress + '%' }" :class="up.status" style="height:100%;transition:width 0.3s ease"></div>
                        </div>
                        <span style="font-size:12px;font-weight:600;color:var(--text-muted);min-width:32px;text-align:right">{{ up.progress }}%</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
