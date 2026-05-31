// =======================================================================
// TESTES: useToast.js — Sistema de notificações
// Cobertura: criação, auto-remoção, remoção manual, ícones por tipo
// =======================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useToast } from '../../src/composables/useToast.js';

describe('useToast', () => {
    let toast;

    beforeEach(() => {
        toast = useToast();
        // Limpa toasts anteriores de outros testes
        toast.toasts.value = [];
    });

    it('deve criar toast com título, mensagem e tipo', () => {
        toast.showToast('Título', 'Mensagem', 'success');
        expect(toast.toasts.value).toHaveLength(1);
        expect(toast.toasts.value[0].title).toBe('Título');
        expect(toast.toasts.value[0].message).toBe('Mensagem');
        expect(toast.toasts.value[0].type).toBe('success');
    });

    it('deve usar tipo "info" como padrão', () => {
        toast.showToast('Aviso', 'Sem tipo definido');
        expect(toast.toasts.value[0].type).toBe('info');
    });

    it('deve atribuir IDs incrementais únicos', () => {
        toast.showToast('A', 'msg1');
        toast.showToast('B', 'msg2');
        toast.showToast('C', 'msg3');
        const ids = toast.toasts.value.map(t => t.id);
        expect(new Set(ids).size).toBe(3);
    });

    it('deve remover toast por ID', () => {
        toast.showToast('A', '1');
        toast.showToast('B', '2');
        const idToRemove = toast.toasts.value[0].id;
        toast.removeToast(idToRemove);
        expect(toast.toasts.value).toHaveLength(1);
        expect(toast.toasts.value[0].title).toBe('B');
    });

    it('deve auto-remover toast após 5 segundos', () => {
        vi.useFakeTimers();
        toast.showToast('Temporário', 'Vai sumir');
        expect(toast.toasts.value).toHaveLength(1);
        vi.advanceTimersByTime(5000);
        expect(toast.toasts.value).toHaveLength(0);
        vi.useRealTimers();
    });

    it('não deve afetar outros toasts na auto-remoção', () => {
        vi.useFakeTimers();
        toast.showToast('Primeiro', '1');
        vi.advanceTimersByTime(2000);
        toast.showToast('Segundo', '2');
        vi.advanceTimersByTime(3000); // 5s desde o primeiro
        expect(toast.toasts.value).toHaveLength(1);
        expect(toast.toasts.value[0].title).toBe('Segundo');
        vi.advanceTimersByTime(2000); // 5s desde o segundo
        expect(toast.toasts.value).toHaveLength(0);
        vi.useRealTimers();
    });

    // ── getToastIcon ──────────────────────────────────────────────────────
    describe('getToastIcon', () => {
        it('deve retornar ícone correto para success', () => {
            expect(toast.getToastIcon('success')).toBe('fa-solid fa-circle-check');
        });

        it('deve retornar ícone correto para error', () => {
            expect(toast.getToastIcon('error')).toBe('fa-solid fa-circle-exclamation');
        });

        it('deve retornar ícone correto para warning', () => {
            expect(toast.getToastIcon('warning')).toBe('fa-solid fa-triangle-exclamation');
        });

        it('deve retornar ícone info como fallback', () => {
            expect(toast.getToastIcon('info')).toBe('fa-solid fa-circle-info');
            expect(toast.getToastIcon('qualquer')).toBe('fa-solid fa-circle-info');
            expect(toast.getToastIcon(undefined)).toBe('fa-solid fa-circle-info');
        });
    });

    // ── Singleton ────────────────────────────────────────────────────────
    it('deve compartilhar estado entre múltiplas instâncias (singleton)', () => {
        const a = useToast();
        const b = useToast();
        a.showToast('Compartilhado', 'Msg');
        expect(b.toasts.value.length).toBeGreaterThanOrEqual(1);
        expect(b.toasts.value.some(t => t.title === 'Compartilhado')).toBe(true);
    });
});
