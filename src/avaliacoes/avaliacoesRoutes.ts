/* eslint-disable @typescript-eslint/explicit-function-return-type */

/* eslint-disable @typescript-eslint/no-misused-promises */
import { Router } from 'express'
import { verificaTokenJWT } from '../auth/middlewares/authMiddlewares.js'
import { Role } from '../auth/roles.js'
import { validaCorpo } from '../middlewares/validacaoMiddleware.js'
import { listaAvaliacoes, criaAvaliacao } from './avaliacoesController.js'
import { contratoCriarAvaliacao } from './avaliacoesContratos.js'

export const avaliacoesRouter = Router()

// leitura pública, sem identificar o paciente e paginada
avaliacoesRouter.get('/', listaAvaliacoes)
// só paciente logado avalia, e sempre em nome próprio
avaliacoesRouter.post('/', verificaTokenJWT(Role.paciente), validaCorpo(contratoCriarAvaliacao), criaAvaliacao)

export default (app) => {
  app.use('/avaliacoes', avaliacoesRouter)
}
