import { strict as assert } from 'node:assert'
import { BUILTIN_TOOL_DEFINITIONS } from '../tools/builtin/definitions'
import { __test__ } from '../routes/chat'

const names = BUILTIN_TOOL_DEFINITIONS.map((tool) => tool.function.name)

assert.ok(names.includes('web_search'), 'BUILTIN_TOOL_DEFINITIONS should include web_search')
assert.ok(names.includes('websearch'), 'BUILTIN_TOOL_DEFINITIONS should include websearch')

const flashToolset = __test__.buildFlashToolset('test-flash-tools')
const flashToolNames = flashToolset.tools.map((tool: any) => tool.function.name)
assert.ok(flashToolNames.includes('web_search'), 'flash toolset should include web_search')
assert.ok(flashToolNames.includes('websearch'), 'flash toolset should include websearch')
assert.ok(!flashToolNames.includes('task'), 'flash toolset should not include task')
assert.ok(flashToolset.localToolMap.has('web_search'), 'flash localToolMap should include web_search handler')
assert.ok(flashToolset.localToolMap.has('websearch'), 'flash localToolMap should include websearch handler')
assert.ok(!flashToolset.localToolMap.has('task'), 'flash localToolMap should not include task handler')

console.log('builtin-tools tests passed')
