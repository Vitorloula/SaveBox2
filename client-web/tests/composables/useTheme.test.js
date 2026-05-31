// =======================================================================
// TESTES: useTheme.js — Gerenciamento de tema dark/light
// Cobertura: inicialização, toggle, persistência, classe CSS no body
// =======================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { useTheme } from '../../src/composables/useTheme.js';

describe('useTheme', () => {
    let theme;

    beforeEach(() => {
        theme = useTheme();
        document.body.classList.remove('light-theme');
        localStorage.clear();
    });

    describe('initTheme', () => {
        it('deve inicializar como dark por padrão (sem valor salvo)', () => {
            theme.initTheme();
            expect(theme.isDarkMode.value).toBe(true);
            expect(document.body.classList.contains('light-theme')).toBe(false);
        });

        it('deve restaurar tema light do localStorage', () => {
            localStorage.setItem('savebox_theme', 'light');
            theme.initTheme();
            expect(theme.isDarkMode.value).toBe(false);
            expect(document.body.classList.contains('light-theme')).toBe(true);
        });

        it('deve restaurar tema dark do localStorage', () => {
            localStorage.setItem('savebox_theme', 'dark');
            theme.initTheme();
            expect(theme.isDarkMode.value).toBe(true);
            expect(document.body.classList.contains('light-theme')).toBe(false);
        });
    });

    describe('toggleTheme', () => {
        it('deve alternar de dark para light', () => {
            theme.isDarkMode.value = true;
            theme.toggleTheme();
            expect(theme.isDarkMode.value).toBe(false);
            expect(localStorage.getItem('savebox_theme')).toBe('light');
            expect(document.body.classList.contains('light-theme')).toBe(true);
        });

        it('deve alternar de light para dark', () => {
            theme.isDarkMode.value = false;
            theme.toggleTheme();
            expect(theme.isDarkMode.value).toBe(true);
            expect(localStorage.getItem('savebox_theme')).toBe('dark');
            expect(document.body.classList.contains('light-theme')).toBe(false);
        });

        it('deve ser idempotente em dois toggles', () => {
            const original = theme.isDarkMode.value;
            theme.toggleTheme();
            theme.toggleTheme();
            expect(theme.isDarkMode.value).toBe(original);
        });
    });
});
