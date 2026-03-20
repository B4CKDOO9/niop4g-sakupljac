// Simple i18n system for Sakupljač
class I18n {
    constructor() {
        this.currentLang = localStorage.getItem('sakupljac_language') || 'hr';
        this.translations = {};
        this.listeners = [];
    }

    async loadLanguage(lang) {
        try {
            const response = await fetch(`translations/${lang}.json`);
            if (!response.ok) throw new Error(`Failed to load ${lang}.json`);
            this.translations = await response.json();
            this.currentLang = lang;
            localStorage.setItem('sakupljac_language', lang);
            this.notifyListeners();
            return true;
        } catch (error) {
            console.error('Error loading language:', error);
            return false;
        }
    }

    t(key) {
        const keys = key.split('.');
        let value = this.translations;
        
        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                console.warn(`Translation key not found: ${key}`);
                return key;
            }
        }
        
        return value;
    }

    getCurrentLanguage() {
        return this.currentLang;
    }

    onChange(callback) {
        this.listeners.push(callback);
    }

    notifyListeners() {
        this.listeners.forEach(callback => callback(this.currentLang));
    }

    updatePageTexts() {
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            element.textContent = this.t(key);
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            element.placeholder = this.t(key);
        });
    }
}

const i18n = new I18n();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = i18n;
}
