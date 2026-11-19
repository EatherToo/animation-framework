import { describe, expect, it } from '@jest/globals'
import * as entry from '@/index'

describe('toolchain', () => {
  it('compiles TypeScript and loads the package entry', () => {
    expect(entry).toBeDefined()
  })
})
