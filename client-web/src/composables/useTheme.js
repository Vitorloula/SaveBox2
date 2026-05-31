// =======================================================================
// THEME MANAGER
// Single Responsibility: dark/light mode persistido no localStorage
// =======================================================================
import { ref } from "vue";

const isDarkMode = ref(true);

export function useTheme() {
    function initTheme() {
        const saved = localStorage.getItem("savebox_theme");
        isDarkMode.value = saved !== "light";
        _applyClass();
    }

    function toggleTheme() {
        isDarkMode.value = !isDarkMode.value;
        localStorage.setItem("savebox_theme", isDarkMode.value ? "dark" : "light");
        _applyClass();
    }

    function _applyClass() {
        document.body.classList.toggle("light-theme", !isDarkMode.value);
    }

    return { isDarkMode, toggleTheme, initTheme };
}
