// =======================================================================
// TESTES: AppHeader.vue
// Cobertura: renderização da brand, botão de tema, renderização condicional
// do usuário e botão de logout.
// =======================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import AppHeader from '../../src/components/AppHeader.vue';
import * as useThemeMod from '../../src/composables/useTheme.js';
import * as useAuthMod from '../../src/composables/useAuth.js';
import { ref } from 'vue';

describe('AppHeader.vue', () => {
    let mockTheme;
    let mockAuth;

    beforeEach(() => {
        mockTheme = {
            isDarkMode: ref(true),
            toggleTheme: vi.fn()
        };
        vi.spyOn(useThemeMod, 'useTheme').mockReturnValue(mockTheme);

        mockAuth = {
            isAuthenticated: ref(false),
            username: ref(''),
            logout: vi.fn()
        };
        vi.spyOn(useAuthMod, 'useAuth').mockReturnValue(mockAuth);
    });

    it('deve renderizar a logo e título', () => {
        const wrapper = mount(AppHeader);
        expect(wrapper.find('.brand-text h1').text()).toContain('SaveBox');
        expect(wrapper.find('p').text()).toContain('Zero-Knowledge Cloud Cryptography');
    });

    it('deve chamar toggleTheme ao clicar no botão de tema', async () => {
        const wrapper = mount(AppHeader);
        const btn = wrapper.find('.btn-theme-toggle');
        await btn.trigger('click');
        expect(mockTheme.toggleTheme).toHaveBeenCalled();
    });

    it('não deve mostrar badge de usuário e logout se não autenticado', () => {
        mockAuth.isAuthenticated.value = false;
        const wrapper = mount(AppHeader);
        expect(wrapper.find('.user-badge').exists()).toBe(false);
        expect(wrapper.find('.btn-logout').exists()).toBe(false);
    });

    it('deve mostrar badge de usuário e logout se autenticado', async () => {
        mockAuth.isAuthenticated.value = true;
        mockAuth.username.value = 'teste_user';
        const wrapper = mount(AppHeader);
        
        const badge = wrapper.find('.user-badge');
        expect(badge.exists()).toBe(true);
        expect(badge.text()).toContain('teste_user');

        const logoutBtn = wrapper.find('.btn-logout');
        expect(logoutBtn.exists()).toBe(true);

        await logoutBtn.trigger('click');
        expect(mockAuth.logout).toHaveBeenCalled();
    });

    it('deve alterar o ícone do botão de tema de acordo com isDarkMode', async () => {
        mockTheme.isDarkMode.value = true;
        let wrapper = mount(AppHeader);
        expect(wrapper.find('.fa-sun').exists()).toBe(true);

        mockTheme.isDarkMode.value = false;
        wrapper = mount(AppHeader);
        expect(wrapper.find('.fa-moon').exists()).toBe(true);
    });
});
