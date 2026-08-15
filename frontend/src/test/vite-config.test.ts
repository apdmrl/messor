import { describe, expect, it } from 'vitest'
import config from '../../vite.config'

describe('vite dev server proxy', () => {
  it('proxies /api to the backend without wildcard CORS or rewrite', () => {
    const server = config.server
    expect(server).toBeDefined()

    const proxy = server?.proxy
    expect(proxy).toBeDefined()

    const apiProxy = proxy?.['/api']
    expect(apiProxy).toBeDefined()

    expect(apiProxy).toMatchObject({
      target: 'http://localhost:8080',
      changeOrigin: true,
    })

    // No rewrite and no insecure/secure override should be present.
    expect(apiProxy).not.toHaveProperty('rewrite')
    expect(apiProxy).not.toHaveProperty('secure')

    // No wildcard CORS configuration should be present.
    expect(server?.cors).toBeUndefined()
  })
})
