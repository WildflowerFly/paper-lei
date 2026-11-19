<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import type { EditorRegistry } from '../../services/editor-registry'

const props = withDefaults(
  defineProps<{
    registry: EditorRegistry
    documentId: string
    lineWrapping?: boolean
    fontSize?: number
  }>(),
  { lineWrapping: true, fontSize: 14 },
)

const host = useTemplateRef('host')

function activate() {
  if (host.value) props.registry.activate(props.documentId, host.value, props)
}

onMounted(activate)
watch(() => props.documentId, activate)
watch(
  () => [props.lineWrapping, props.fontSize],
  () => props.registry.updateOptions(props),
)
onBeforeUnmount(() => props.registry.destroy())
</script>

<template>
  <div ref="host" class="markdown-editor" aria-label="源码编辑器" />
</template>
