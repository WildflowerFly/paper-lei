import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import App from './App.vue'

it('announces the application and the local workspace', () => {
  const wrapper = mount(App)
  expect(wrapper.get('h1').text()).toBe('Markdown Studio')
  expect(wrapper.get('main').attributes('aria-labelledby')).toBe(wrapper.get('h1').attributes('id'))
  expect(wrapper.text()).toContain('本地 Markdown 工作台')
  wrapper.unmount()
})
