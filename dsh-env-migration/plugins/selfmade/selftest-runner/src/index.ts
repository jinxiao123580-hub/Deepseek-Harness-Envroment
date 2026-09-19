import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
export const name = "@dsh-external/selftest-runner"
export const inject = ['tools']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'self_test_hello',
    description: 'self test',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: String(v) }] },
    async execute() { return 'hello' },
  })), 'self-test')
}
