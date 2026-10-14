import { Router } from 'express'
import { verificaTokenJWT } from '../auth/middlewares/authMiddlewares.js'
import { Role } from '../auth/roles.js'
import { criaObterInsights, type DependenciasInsights } from './insightsController.js'
import { criaProvedorPadrao } from './insightsLLM.js'
import { buscarRegistros } from './insightsRepositorio.js'

const CINCO_MINUTOS_MS = 5 * 60 * 1000

export function criaInsightsRouter (deps: Partial<DependenciasInsights> = {}): Router {
  const router = Router()

  // Só o gestor da clínica (perfil CLINICA) acessa os insights
  router.get(
    '/insights',
    verificaTokenJWT(Role.clinica),
    criaObterInsights({
      provedor: criaProvedorPadrao(),
      buscarRegistros,
      agora: () => new Date(),
      ttlCacheMs: CINCO_MINUTOS_MS,
      ...deps
    })
  )

  return router
}

export default (app): void => {
  app.use('/admin', criaInsightsRouter())
}
