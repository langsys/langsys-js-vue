/// <reference types="vite/client" />

declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    const component: DefineComponent<object, object, unknown>;
    export default component;
}

interface ImportMetaEnv {
    readonly VITE_LANGSYS_PROJECT_ID?: string;
    readonly VITE_LANGSYS_API_KEY?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
