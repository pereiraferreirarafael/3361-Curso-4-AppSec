/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/no-misused-promises */
import { Router } from 'express'
import { verificaTokenJWT } from '../auth/middlewares/authMiddlewares.js'
import { somenteDono } from '../auth/middlewares/propriedadeMiddleware.js'
import { Role } from '../auth/roles.js'
import { validaCorpo } from '../middlewares/validacaoMiddleware.js'
import {
  contratoAtualizarClinica,
  contratoCriarClinica,
  contratoVincularEspecialista
} from './clinicaContratos.js'
import {
  listarClinicas,
  criarClinica,
  buscarClinica,
  atualizarClinica,
  deletarClinica,
  listaEspecialistasPorClinica,
  atualizaEspecialistaPeloIdDaClinica
} from './clinicaController.js'

export const clinicaRouter = Router()

// Rotas de uma clínica específica: token CLINICA e o id do token tem de ser o da URL (BOLA)
const autenticaDono = [verificaTokenJWT(Role.clinica), somenteDono()]

// Vitrine pública (só nome, planos e endereço)
clinicaRouter.get('/', listarClinicas)
clinicaRouter.get('/:id', buscarClinica)

// Antes qualquer pessoa criava uma conta CLINICA (o perfil mais poderoso do sistema) sem
// login. Agora só um gestor autenticado cadastra outra clínica.
clinicaRouter.post('/', verificaTokenJWT(Role.clinica), validaCorpo(contratoCriarClinica), criarClinica)
clinicaRouter.put('/:id', ...autenticaDono, validaCorpo(contratoAtualizarClinica), atualizarClinica)
clinicaRouter.delete('/:id', ...autenticaDono, deletarClinica)

// vincula um especialista (sem clínica) à clínica do token
clinicaRouter.post(
  '/:id/especialista',
  ...autenticaDono,
  validaCorpo(contratoVincularEspecialista),
  atualizaEspecialistaPeloIdDaClinica
)

// especialistas da clínica, com dados de contato: visão do gestor
clinicaRouter.get('/:id/especialista', ...autenticaDono, listaEspecialistasPorClinica)

export default (app) => {
  app.use('/clinica', clinicaRouter)
}
