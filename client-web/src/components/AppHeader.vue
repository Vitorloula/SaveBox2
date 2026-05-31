<!-- AppHeader — Cabeçalho global com logo, badge do usuário e logout -->
<script setup>
import { useTheme } from '../composables/useTheme.js';
import { useAuth } from '../composables/useAuth.js';

const { isDarkMode, toggleTheme } = useTheme();
const { username, isAuthenticated, logout } = useAuth();
</script>

<template>
    <header class="main-header glass-panel">
        <div class="header-brand">
            <div class="brand-logo">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="width:28px;height:28px">
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
            <button class="btn btn-outline btn-theme-toggle" @click="toggleTheme"
                :title="isDarkMode ? 'Modo Claro' : 'Modo Escuro'"
                style="padding:0;width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px">
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
</template>
