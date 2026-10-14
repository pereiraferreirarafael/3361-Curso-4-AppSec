import { Router } from 'express'
import { verificaTokenJWT } from '../auth/middlewares/authMiddlewares.js'

import multer from 'multer'
import { Role } from '../auth/roles.js'
import { validaCorpo } from '../middlewares/validacaoMiddleware.js'
import { somenteDono } from '../auth/middlewares/propriedadeMiddleware.js'
import {
  contratoAtualizarEndereco,
  contratoAtualizarPaciente,
  contratoCriarPaciente
} from './pacienteContratos.js'
import multerConfig from '../config/multer.js'
import { criaImagem, destroiImagem, listaImagemPaciente } from './PacienteImagemController.js'
import {
  atualizarEnderecoPaciente,
  consultaPorPaciente,
  atualizarPaciente,
  criarPaciente,
  desativaPaciente,
  exibeTodosPacientes,
  lerPaciente,
  listaConsultasPaciente,
} from './pacienteController.js'

const upload = multer(multerConfig)

export const pacienteRouter = Router()

// Rotas de um paciente específico: exigem token de PACIENTE e que o id do token
// seja o mesmo da URL (proteção contra BOLA).
const autenticaDono = [verificaTokenJWT(Role.paciente), somenteDono()]

pacienteRouter.get('/', exibeTodosPacientes)
pacienteRouter.get('/consulta-por-paciente', consultaPorPaciente)
pacienteRouter.post('/', validaCorpo(contratoCriarPaciente), criarPaciente)
pacienteRouter.get('/:id', ...autenticaDono, lerPaciente)
pacienteRouter.get('/:id/consultas', ...autenticaDono, listaConsultasPaciente)
pacienteRouter.put(
  '/:id',
  ...autenticaDono,
  validaCorpo(contratoAtualizarPaciente),
  atualizarPaciente
)
pacienteRouter.delete('/:id', ...autenticaDono, desativaPaciente)
pacienteRouter.patch(
  '/:id',
  ...autenticaDono,
  validaCorpo(contratoAtualizarEndereco),
  atualizarEnderecoPaciente
)

// autenticação e dono ANTES do upload: quem não é o dono não grava arquivo em disco
pacienteRouter.post(
  '/:id/images',
  ...autenticaDono,
  upload.single('file'),
  criaImagem
)

pacienteRouter.get(
  '/:id/images',
  ...autenticaDono,
  listaImagemPaciente
)

pacienteRouter.delete('/:id/images', ...autenticaDono, destroiImagem)

export default (app) => {
  app.use('/paciente', pacienteRouter)
}
