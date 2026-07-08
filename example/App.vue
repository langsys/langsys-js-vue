<script setup lang="ts">
import { onMounted, ref } from 'vue';
// In your own app this import is `from 'langsys-js-vue'`. The playground
// imports the source directly so library edits hot-reload.
import { LangsysApp, Translate, useCurrentLocale, useLocaleStore, useT } from '../src/index';

const LOCALES = [
    { code: 'en-US', label: 'English (US)' },
    { code: 'es-ES', label: 'Español' },
    { code: 'fr-FR', label: 'Français' },
    { code: 'de-DE', label: 'Deutsch' },
];

const { locale, setLocale, store } = useLocaleStore('en-US');
const ready = ref(false);
const error = ref<string | null>(null);

// `useT()` updates this component whenever translations or the loaded locale
// change. The phrase is the lookup key and the base-language default;
// signature is `t(phrase, category?, params?)`.
const t = useT();
const loadedLocale = useCurrentLocale();

onMounted(() => {
    const projectid = import.meta.env.VITE_LANGSYS_PROJECT_ID;
    const key = import.meta.env.VITE_LANGSYS_API_KEY;
    if (!projectid || !key) {
        error.value = 'Missing VITE_LANGSYS_PROJECT_ID or VITE_LANGSYS_API_KEY in .env';
        return;
    }
    LangsysApp.init({
        projectid,
        key,
        UserLocaleStore: store,
        baseLocale: 'en-US',
        debug: true,
    }).then((res) => {
        if (res?.status === false) error.value = res.errors?.join(', ') ?? 'Init failed';
        else ready.value = true;
    });
});

function onLocaleChange(event: Event) {
    setLocale((event.target as HTMLSelectElement).value);
}
</script>

<template>
    <main v-if="error" class="main">
        <h1 style="color: #c00">Langsys init failed</h1>
        <p style="font-family: monospace">{{ error }}</p>
        <p>
            Copy <code>.env.example</code> to <code>.env</code>, fill in your project ID + API key, and restart
            <code>npm run dev</code>.
        </p>
    </main>

    <main v-else-if="!ready" class="main"><p>Loading Langsys…</p></main>

    <main v-else class="main">
        <h1>{{ t('Welcome to the Langsys + Vue demo', 'Demo') }}</h1>
        <p>{{ t('Pick a locale below — translations update everywhere.', 'Demo') }}</p>

        <div class="row">
            <label for="locale">{{ t('Locale', 'UI') }}:</label>
            <select id="locale" :value="locale" @change="onLocaleChange">
                <option v-for="l in LOCALES" :key="l.code" :value="l.code">{{ l.label }}</option>
            </select>
        </div>

        <section class="card">
            <h2>{{ t('Direct phrase translation', 'Demo') }}</h2>
            <p>
                {{
                    t(
                        'Each phrase in your code is its own token. The first render registers the phrase with the Translation Manager; subsequent locale changes fetch and re-render automatically.',
                        'Demo'
                    )
                }}
            </p>
        </section>

        <section class="card">
            <h2>{{ t('Interpolation', 'Demo') }}</h2>
            <p>{{ t('Hello, {name}! You have {count} new messages.', 'Greetings', { name: 'Sarah', count: 3 }) }}</p>
            <p class="muted">
                {{
                    t(
                        'Placeholders in the phrase above are required and type-checked at compile time — try removing a key from the params object to see the error.',
                        'Demo'
                    )
                }}
            </p>
        </section>

        <section class="card">
            <h2>{{ t('Categorization disambiguates context', 'Demo') }}</h2>
            <ul>
                <li>
                    <strong>{{ t('Home', 'Main Menu') }}</strong> <em>{{ t('(menu item)', 'Demo') }}</em>
                </li>
                <li>
                    <strong>{{ t('Home', 'Home repairs') }}</strong> <em>{{ t('(the building)', 'Demo') }}</em>
                </li>
            </ul>
        </section>

        <Translate category="Demo" label="Block demo" tag="section" class="card">
            <h2>HTML content blocks</h2>
            <p>
                Wrap richer content in <code>&lt;Translate&gt;</code> and the SDK registers the whole thing as a
                <strong>content block</strong> — translators see your styling and structure as the user sees it.
                Attribute values like <em>placeholder</em>, <em>alt</em>, <em>aria-label</em> are also harvested.
            </p>
            <p>
                <input type="text" placeholder="Type something here…" />
            </p>
        </Translate>

        <p class="footer">
            {{ t('Current locale', 'UI') }}: <code>{{ loadedLocale }}</code>
        </p>
    </main>
</template>

<style>
.main {
    font-family: system-ui, sans-serif;
    max-width: 720px;
    margin: 2rem auto;
    padding: 0 1rem;
    color: #222;
}
.row {
    display: flex;
    gap: 1rem;
    align-items: center;
    margin: 1rem 0;
}
.card {
    border: 1px solid #ddd;
    border-radius: 6px;
    padding: 1rem 1.2rem;
    margin: 1rem 0;
}
.muted {
    color: #666;
    font-size: 0.9rem;
}
.footer {
    color: #666;
    margin-top: 2rem;
}
</style>
