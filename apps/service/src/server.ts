import cors from '@fastify/cors'
import { type FastifyTRPCPluginOptions, fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import fastify from 'fastify'
import { type AppRouter, appRouter } from './appRouter'
import { createContext } from './context'

const server = fastify({
  routerOptions: {
    maxParamLength: 5000,
  },
  bodyLimit: 50 * 1024 * 1024, // 50MB
})

server.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'username'],
})

server.register(fastifyTRPCPlugin, {
  prefix: '/trpc',
  trpcOptions: {
    router: appRouter,
    createContext,
    onError({ path, error }) {
      console.error(`[tRPC] Error on path '${path}':`, error)
      if (error.cause) console.error(`[tRPC] Cause:`, error.cause)
    },
  } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
})

;(async () => {
  try {
    await server.listen({ port: 3003 })
    console.log('tRPC server is running on http://localhost:3003')
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
})()
