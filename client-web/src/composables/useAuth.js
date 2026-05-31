// =======================================================================
// AUTH COMPOSABLE
// Single Responsibility: login, register, verify, logout, vault lock/unlock
// =======================================================================
import { ref, reactive } from "vue";
import { deriveMasterKey } from "./useCrypto.js";
import { useApi } from "./useApi.js";
import { useToast } from "./useToast.js";

const { fetchAPI, setToken, clearToken, token } = useApi();
const { showToast } = useToast();

const isAuthenticated = ref(false);
const isVaultLocked = ref(false);
const authView = ref("login"); // 'login' | 'register' | 'verify'
const authLoading = ref(false);
const username = ref("");
const masterKey = ref(null);
const unlockPassword = ref("");

const authForm = reactive({ username: "", email: "", password: "", token: "" });

export function useAuth() {
    async function handleLogin() {
        authLoading.value = true;
        try {
            const res = await fetch(`${(await import("./useApi.js")).API_URL}/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: authForm.username, password: authForm.password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Erro de login");

            setToken(data.token);
            username.value = authForm.username;
            localStorage.setItem("savebox_token", data.token);
            localStorage.setItem("savebox_username", authForm.username);

            masterKey.value = await deriveMasterKey(authForm.password, authForm.username);
            authForm.password = "";
            isAuthenticated.value = true;
            showToast("Acesso Autorizado", `Cofre de ${username.value} aberto com sucesso.`, "success");
        } catch (err) {
            showToast("Falha na Autenticação", err.message, "error");
        } finally {
            authLoading.value = false;
        }
    }

    async function handleRegister() {
        authLoading.value = true;
        try {
            const { API_URL } = await import("./useApi.js");
            const res = await fetch(`${API_URL}/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    username: authForm.username,
                    email: authForm.email,
                    password: authForm.password
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Erro no cadastro");
            showToast("Conta Criada", "Verifique seu e-mail para ativar sua conta.", "success");
            authView.value = "verify";
        } catch (err) {
            showToast("Erro no Registro", err.message, "error");
        } finally {
            authLoading.value = false;
        }
    }

    async function handleVerifyEmail() {
        authLoading.value = true;
        try {
            const { API_URL } = await import("./useApi.js");
            const res = await fetch(`${API_URL}/verify?token=${encodeURIComponent(authForm.token)}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Falha na ativação");
            showToast("Conta Ativada", "Seu e-mail foi verificado. Você já pode acessar seu cofre.", "success");
            authView.value = "login";
            authForm.token = "";
        } catch (err) {
            showToast("Erro na Verificação", err.message, "error");
        } finally {
            authLoading.value = false;
        }
    }

    function logout() {
        clearToken();
        username.value = "";
        masterKey.value = null;
        isAuthenticated.value = false;
        isVaultLocked.value = false;
        localStorage.removeItem("savebox_token");
        localStorage.removeItem("savebox_username");
        showToast("Cofre Fechado", "Você saiu da sua conta e a chave foi apagada da RAM.", "info");
    }

    async function unlockVault() {
        if (!unlockPassword.value) return;
        authLoading.value = true;
        try {
            masterKey.value = await deriveMasterKey(unlockPassword.value, username.value);
            isVaultLocked.value = false;
            isAuthenticated.value = true;
            showToast("Cofre Desbloqueado", `Chave mestra carregada para ${username.value}.`, "success");
            unlockPassword.value = "";
        } catch {
            showToast("Senha Incorreta", "Não foi possível desbloquear o cofre.", "error");
        } finally {
            authLoading.value = false;
        }
    }

    function restoreSessionFromStorage() {
        const savedToken = localStorage.getItem("savebox_token");
        const savedUsername = localStorage.getItem("savebox_username");
        if (savedToken && savedUsername) {
            setToken(savedToken);
            username.value = savedUsername;
            isVaultLocked.value = true;
        }
    }

    return {
        isAuthenticated,
        isVaultLocked,
        authView,
        authLoading,
        username,
        masterKey,
        unlockPassword,
        authForm,
        handleLogin,
        handleRegister,
        handleVerifyEmail,
        logout,
        unlockVault,
        restoreSessionFromStorage
    };
}
