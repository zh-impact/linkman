import cors from '@fastify/cors'
import { type FastifyTRPCPluginOptions, fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import fastify from 'fastify'
import { type AppRouter, appRouter } from './appRouter'
import { createContext } from './context'

const server = fastify({
  routerOptions: {
    maxParamLength: 5000,
  },
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
      // report to errror monitoring
      console.error(`Error in tRPC handler on path '${path}':`, error)
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
