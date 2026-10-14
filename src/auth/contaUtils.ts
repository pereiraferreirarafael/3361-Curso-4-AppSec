import { type Request } from 'express'
import { AppDataSource } from '../data-source.js'
import { Especialista } from '../especialistas/EspecialistaEntity.js'
import { Paciente } from '../pacientes/pacienteEntity.js'
import { Autenticaveis } from './authEntity.js'
import { Role } from './roles.js'
import { access } from './tokens.js'

/**
 * O login identifica a conta só pelo e-mail, em TRÊS tabelas (paciente, especialista,
 * clínica). Sem unicidade entre elas, dois cadastros com o mesmo e-mail se confundem
 * no login. Use ao criar ou alterar e-mail; `idDaPropriaConta` ignora a própria conta.
 */
export async function emailEmUso (email: unknown, idDaPropriaConta?: string): Promise<boolean> {
  // where com valor undefined é IGNORADO pelo TypeORM e casaria com qualquer linha
  if (typeof email !== 'string' || email === '') return false

  const conta = await AppDataSource.manager.findOne(Autenticaveis, { select: ['id'], where: { email } })
  return conta !== null && conta.id !== idDaPropriaConta
}

/** Conta desativada não faz login nem renova token. Clínica não tem o conceito de desativação. */
export async function contaEstaAtiva (id: string, role: string): Promise<boolean> {
  switch (role) {
    case Role.paciente: {
      const paciente = await AppDataSource.manager.findOne(Paciente, { select: { id: true, estaAtivo: true }, where: { id } })
      return paciente?.estaAtivo === true
    }
    case Role.especialista: {
      const especialista = await AppDataSource.manager.findOne(Especialista, { select: { id: true, estaAtivo: true }, where: { id } })
      return especialista?.estaAtivo === true
    }
    default:
      return true
  }
}

/** Coloca na blocklist o access token usado na requisição (ex.: ao desativar a própria conta). */
export async function invalidaTokenDaRequisicao (req: Request): Promise<void> {
  const token = req.headers.authorization?.split(' ')[1]
  if (token !== undefined && token !== '') await access.invalida(token)
}
