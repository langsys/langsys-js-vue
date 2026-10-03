<script setup lang="ts">
import { computed, defineAsyncComponent, h, nextTick, onMounted, reactive, ref, watch } from 'vue';
// In your own app this import is `from 'langsys-js-vue'`. The playground
// imports the source directly so library edits hot-reload.
import { LangsysApp, Translate, localeHeaders, useCurrentLocale, useLocaleStore, useT } from '../src/index';

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

// Placeholders: with the compiler transform, `{{ user.firstName }}` inside <Translate> registers
// as `{first_name}`, one phrase for every name.
const user = reactive({ firstName: 'Sarah' });

// The header an app's own API calls send for the user's locale (FRM-6).
const headers = computed(() => (loadedLocale.value, localeHeaders()));

// Components that resolve after a delay, shown through <Suspense> inside a <Translate>. The core
// registers a block once its content has been quiet for its settle window (500 ms):
// the fast panel replaces its fallback inside the window, the slow one after it.
const panel = (ms: number, text: string) =>
    defineAsyncComponent(
        () =>
            new Promise<{ render: () => ReturnType<typeof h> }>((done) =>
                setTimeout(() => done({ render: () => h('p', text) }), ms)
            )
    );
const FastPanel = panel(150, 'Delivered within the settle window');
const SlowPanel = panel(2000, 'Delivered after two seconds');

// Every content-block id on the page, read off the hosts the SDK stamps.
const blockIds = ref<string[]>([]);
const readBlockIds = () =>
    nextTick(() => {
        blockIds.value = [...document.querySelectorAll('[data-ls-contentblock]')].map(
            (el) => el.getAttribute('data-ls-contentblock') ?? ''
        );
    });
watch([ready, loadedLocale], readBlockIds);

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
        // A relative URL (`/api`, served by the Vite proxy) resolves against this page.
        apiUrl: import.meta.env.VITE_LANGSYS_API_URL
            ? new URL(import.meta.env.VITE_LANGSYS_API_URL, window.location.href).href.replace(/\/$/, '')
            : undefined,
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

        <Translate category="Demo" label="Block demo" tag="section" class="card" :params="{ name: 'Sarah' }">
            <h2>HTML content blocks</h2>
            <p>
                Wrap richer content in <code>&lt;Translate&gt;</code> and the SDK registers the whole thing as a
                <strong>content block</strong> — translators see your styling and structure as the user sees it.
                Attribute values like <em>placeholder</em>, <em>alt</em>, <em>aria-label</em> are also harvested.
            </p>
            <p>Runtime values interpolate too: welcome back, %name%.</p>
            <p>
                <input type="text" placeholder="Type something here…" />
            </p>
        </Translate>

        <section class="card">
            <h2>Placeholders (compiler transform)</h2>
            <p>
                <label>Name: <input v-model="user.firstName" /></label>
            </p>
            <Translate category="Demo"
                ><p>Hello {{ user.firstName }}, welcome back</p></Translate
            >
            <Translate category="Demo"
                ><p>See you soon, {{ user.firstName }}</p></Translate
            >
        </section>

        <section class="card">
            <h2>Suspense slots</h2>
            <Translate category="Demo">
                <Suspense>
                    <FastPanel />
                    <template #fallback><p>Loading the fast panel…</p></template>
                </Suspense>
            </Translate>
            <Translate category="Demo">
                <Suspense>
                    <SlowPanel />
                    <template #fallback><p>Loading the slow panel…</p></template>
                </Suspense>
            </Translate>
        </section>

        <section class="card">
            <h2>Content-block ids on this page</h2>
            <ul>
                <li v-for="id in blockIds" :key="id">
                    <code>{{ id }}</code>
                </li>
            </ul>
            <button type="button" @click="readBlockIds">Re-read</button>
        </section>

        <section class="card">
            <h2>Accept-Language for your own API</h2>
            <p>
                <code>localeHeaders()</code> → <code>{{ headers }}</code>
            </p>
        </section>

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
