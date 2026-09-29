<script setup lang="ts">
import { Translate, useT } from 'langsys-js-vue';

const route = useRoute();
const user = { firstName: String(route.query.user ?? 'Ana') };
const t = useT();
</script>

<template>
    <main>
        <Translate category="UI"
            ><p>Hello {{ user.firstName }}</p></Translate
        >
        <h2>{{ t(`Welcome back, ${user.firstName}`, 'UI') }}</h2>
        <Translate category="UI"
            ><p>Unknown block one</p>
            <p>Unknown block two</p></Translate
        >
    </main>
</template>
