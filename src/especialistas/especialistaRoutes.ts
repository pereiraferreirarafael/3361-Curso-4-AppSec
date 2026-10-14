import { Router, Response } from 'express'
import {
  especialistas,
  criarEspecialista,
  especialistaById,
  atualizarEspecialista,
  apagarEspecialista,
  atualizaContato,
  buscarEspecialistas
} from './especialistaController.js'
import { Role } from '../auth/roles.js'
import { verificaTokenJWT } from '../auth/middlewares/authMiddlewares.js'
import { somenteDono } from '../auth/middlewares/propriedadeMiddleware.js'
import { validaCorpo } from '../middlewares/validacaoMiddleware.js'
import { contratoAtualizarContato } from './especialistaContratos.js'

export const especialistaRouter = Router()

especialistaRouter.get('/', especialistas)
especialistaRouter.post('/', verificaTokenJWT(Role.clinica), criarEspecialista)
especialistaRouter.get('/busca', buscarEspecialistas)
especialistaRouter.get('/:id', especialistaById)
especialistaRouter.put(
  '/:id',
  verificaTokenJWT(Role.especialista),
  atualizarEspecialista
)
especialistaRouter.delete(
  '/:id',
  verificaTokenJWT(Role.clinica, Role.especialista),
  apagarEspecialista
)
especialistaRouter.patch(
  '/:id',
  verificaTokenJWT(Role.especialista),
  somenteDono(),
  validaCorpo(contratoAtualizarContato),
  atualizaContato
)

export default (app) => {
  app.use('/especialista', especialistaRouter)
}
