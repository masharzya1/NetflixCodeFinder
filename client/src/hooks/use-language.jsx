import { createContext, useContext, useState, useEffect } from "react";
import { getTranslations, detectLanguageFromCountry, detectCountry, detectLanguageFromBrowser, LANGUAGES } from "@/lib/translations";

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('preferred-language') || 'en';
    }
    return 'en';
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function init() {
      const LANG_VERSION = 'v2';
      const savedVersion = localStorage.getItem('lang-version');
      const savedLang = localStorage.getItem('preferred-language');
      
      if (savedLang && savedVersion === LANG_VERSION) {
        setLanguage(savedLang);
        setIsLoading(false);
        return;
      }

      const country = await detectCountry();
      let detectedLang = 'en';
      
      if (country) {
        detectedLang = detectLanguageFromCountry(country);
      } else {
        detectedLang = detectLanguageFromBrowser();
      }
      
      setLanguage(detectedLang);
      localStorage.setItem('preferred-language', detectedLang);
      localStorage.setItem('lang-version', LANG_VERSION);
      setIsLoading(false);
    }

    init();
  }, []);

  const changeLanguage = (langCode) => {
    setLanguage(langCode);
    localStorage.setItem('preferred-language', langCode);
  };

  const t = getTranslations(language);
  const currentLang = LANGUAGES.find(l => l.code === language) || LANGUAGES[0];

  useEffect(() => {
    // If the language is one of the ones that only has partial hardcoded translations, 
    // it will be handled by the auto-translator in the components, but we still need the base structure
  }, [language]);

  return (
    <LanguageContext.Provider value={{ 
      language, 
      changeLanguage, 
      t, 
      currentLang, 
      languages: LANGUAGES,
      isLoading 
    }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
