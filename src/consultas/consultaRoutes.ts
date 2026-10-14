import { Router } from 'express'
import { verificaTokenJWT } from '../auth/middlewares/authMiddlewares.js'
import { Role } from '../auth/roles.js'
import { validaCorpo } from '../middlewares/validacaoMiddleware.js'
import { buscaConsultaPorId, criaConsulta, deletaConsulta, listaConsultas } from './consultaController.js'
import { contratoCriarConsulta } from './consultaContratos.js'

export const consultaRouter = Router()

// Toda rota de consulta exige login. A autorização por objeto (a consulta é do
// usuário?) acontece no controller, via consultaAcesso.ts.
const autenticado = verificaTokenJWT(Role.paciente, Role.especialista, Role.clinica)

consultaRouter.post('/', verificaTokenJWT(Role.paciente), validaCorpo(contratoCriarConsulta), criaConsulta)
consultaRouter.get('/', autenticado, listaConsultas)
consultaRouter.get('/:id', autenticado, buscaConsultaPorId)
consultaRouter.delete('/:id', autenticado, deletaConsulta)

export default (app) => {
  app.use('/consulta', consultaRouter)
}
