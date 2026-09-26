import { computed } from 'vue';
import type { Ref } from 'vue';
import { renderServerMessage, type ServerMessage } from 'langsys-js-typescript';
import { useT } from './composables.js';

/**
 * MSG-5 — render server message entries in the current locale, reactively.
 *
 * Returns a render function, like `useT()`: call it in a template or render function and the
 * output follows locale and catalog changes.
 *
 * ```vue
 * <script setup>
 * const render = useServerMessage();
 * const entries = resolveServerMessages(page.props, { key: 'langsys_errors' });
 * </script>
 * <template><p v-for="e in entries" :key="e.code">{{ render(e) }}</p></template>
 * ```
 *
 * Rendering is the core's `renderServerMessage()`: the template through `t()` when the
 * catalog translates it, the entry's own `message` otherwise, and `message` never looked up.
 * This composable adds only the dependency on `useT()`, whose value the core replaces on every
 * locale and catalog change, so a component re-renders when the answer can have changed.
 *
 * `category` defaults to the `messagesCategory` passed to `init()` (`Errors` unless set), which
 * must match the category the server registers its templates under (MSG-6).
 */
export function useServerMessage(category?: string): Readonly<Ref<(entry: ServerMessage) => string>> {
    const t = useT();
    return computed(() => {
        void t.value;
        return (entry: ServerMessage) => renderServerMessage(entry, category);
    });
}
