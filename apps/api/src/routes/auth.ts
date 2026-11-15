import { fromNodeHeaders } from 'better-auth/node'
import type { FastifyPluginAsync } from 'fastify'
import type { Auth } from '../auth/index.ts'

export const authRoutes =
  (auth: Auth, baseURL: string): FastifyPluginAsync =>
  async (app) => {
    app.route({
      method: ['GET', 'POST'],
      url: '/api/auth/*',
      handler: async (request, reply) => {
        const response = await auth.handler(
          new Request(new URL(request.url, baseURL), {
            method: request.method,
            headers: fromNodeHeaders(request.headers),
            ...(request.body !== undefined && { body: JSON.stringify(request.body) }),
          }),
        )
        reply.status(response.status)
        response.headers.forEach((value, name) => reply.header(name, value))
        return reply.send(await response.text())
      },
    })
  }
