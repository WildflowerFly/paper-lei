<script setup lang="ts">
import { nextTick, useId, useTemplateRef, ref } from 'vue'
import UiButton from './UiButton.vue'

const props = defineProps<{
  label: string
  items: { id: string; label: string; disabled?: boolean }[]
}>()
const emit = defineEmits<{ select: [id: string] }>()
const menuId = useId()
const root = useTemplateRef('root')
const panel = useTemplateRef('panel')
const open = ref(false)
let index = 0

function focusItem(next: number) {
  const count = props.items.length
  if (!count) return
  index = (next + count) % count
  panel.value?.querySelectorAll<HTMLButtonElement>('button')[index]?.focus()
}
async function show(last = false) {
  if (!props.items.length) return
  open.value = true
  await nextTick()
  if (open.value) focusItem(last ? props.items.length - 1 : 0)
}
function close(restore = false) {
  open.value = false
  if (restore) root.value?.querySelector('button')?.focus()
}
function select(item: (typeof props.items)[number]) {
  if (item.disabled) return
  close(true)
  emit('select', item.id)
}
function handleKeys(event: KeyboardEvent) {
  if (event.isComposing) return
  switch (event.key) {
    case 'ArrowDown':
      focusItem(index + 1)
      break
    case 'ArrowUp':
      focusItem(index - 1)
      break
    case 'Home':
      focusItem(0)
      break
    case 'End':
      focusItem(props.items.length - 1)
      break
    case 'Escape':
      close(true)
      break
    case 'Tab':
      close(true)
      return
    default:
      return
  }
  event.preventDefault()
  event.stopPropagation()
}
</script>

<template>
  <div
    ref="root"
    class="ui-menu"
    @focusout="
      (event) => {
        if (!root?.contains(event.relatedTarget as Node)) close()
      }
    "
  >
    <UiButton
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="open ? menuId : undefined"
      :disabled="!items.length"
      @click="open ? close() : show()"
      @keydown.down.prevent="show()"
      @keydown.up.prevent="show(true)"
      >{{ label }}</UiButton
    >
    <div
      v-if="open"
      :id="menuId"
      ref="panel"
      class="ui-menu-panel"
      role="menu"
      :aria-label="label"
      @keydown="handleKeys"
    >
      <button
        v-for="(item, position) in items"
        :key="item.id"
        type="button"
        role="menuitem"
        tabindex="-1"
        :aria-disabled="item.disabled || undefined"
        @focus="index = position"
        @click="select(item)"
      >
        {{ item.label }}
      </button>
    </div>
  </div>
</template>
