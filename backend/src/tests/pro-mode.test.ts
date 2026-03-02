import { strict as assert } from 'node:assert'
import { __test__ } from '../routes/chat'

const { resolveModeFlags, getThinkingRequestExtras } = __test__

const baseModel = {
  id: 'test',
  name: 'Test',
  protocol: 'openai' as const,
  model: 'gpt-test'
}

const supportsThinkingModel = {
  ...baseModel,
  supportsThinking: true,
  whenThinkingEnabled: {
    extra_body: {
      thinking: {
        type: 'enabled'
      }
    }
  }
}

const noThinkingModel = {
  ...baseModel,
  supportsThinking: false
}

const flash = resolveModeFlags('flash')
assert.equal(flash.isPro, false)
assert.equal(flash.thinkingEnabled, false)

const thinking = resolveModeFlags('thinking')
assert.equal(thinking.isPro, false)
assert.equal(thinking.thinkingEnabled, true)

const pro = resolveModeFlags('pro')
assert.equal(pro.isPro, true)
assert.equal(pro.thinkingEnabled, true)

const ultra = resolveModeFlags('ultra')
assert.equal(ultra.isPro, true)
assert.equal(ultra.thinkingEnabled, true)

assert.equal(getThinkingRequestExtras(noThinkingModel), undefined)
assert.deepEqual(getThinkingRequestExtras(supportsThinkingModel), supportsThinkingModel.whenThinkingEnabled)

console.log('pro-mode tests passed')
