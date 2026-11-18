<script setup lang="ts">
import { ref } from 'vue'
import UiButton from '../../src/components/ui/UiButton.vue'
import UiDialog from '../../src/components/ui/UiDialog.vue'
import UiFeedback from '../../src/components/ui/UiFeedback.vue'
import UiField from '../../src/components/ui/UiField.vue'
import UiMenu from '../../src/components/ui/UiMenu.vue'
import UiTooltip from '../../src/components/ui/UiTooltip.vue'

const name = ref('')
const open = ref(false)
const toast = ref('')
const error = ref('保存失败。请检查写入权限后重试。')
const items = [
  { id: 'new', label: '新建' },
  { id: 'save', label: '保存', disabled: true },
  { id: 'rename', label: '重命名' },
]

function selectTheme(event: Event) {
  const { value } = event.target as HTMLSelectElement
  if (value === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = value
}
</script>

<template>
  <main class="controls-showcase">
    <h1>Markdown Studio 控件样例</h1>
    <label
      >主题
      <select @change="selectTheme">
        <option value="system">跟随系统</option>
        <option value="light">浅色</option>
        <option value="dark">深色</option>
      </select></label
    >
    <UiField v-model="name" label="文档名称" :error="name ? undefined : '请输入文档名称。'" />
    <div class="actions">
      <UiMenu
        label="文件"
        :items="items"
        @select="toast = $event === 'new' ? '已选择新建' : '已选择重命名'"
      />
      <UiButton variant="primary" @click="open = true">打开对话框</UiButton>
      <UiTooltip v-slot="{ describedBy }" text="复制当前文档的 Markdown 源码">
        <UiButton :aria-describedby="describedBy" @click="toast = '已复制示例内容'">复制</UiButton>
      </UiTooltip>
    </div>
    <UiFeedback :toast="toast" :error="error">
      <template #recovery><UiButton @click="error = ''">关闭提示</UiButton></template>
    </UiFeedback>
    <UiDialog v-model="open" title="移至回收站">
      <p>将示例文档移至回收站？</p>
      <template #actions>
        <UiButton autofocus @click="open = false">取消</UiButton>
        <UiButton variant="danger" @click="open = false">移至回收站</UiButton>
      </template>
    </UiDialog>
  </main>
</template>

<style scoped>
.controls-showcase {
  display: grid;
  gap: 16px;
  max-width: 560px;
  margin: 64px auto;
  padding: 24px;
}
h1 {
  margin: 0;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
