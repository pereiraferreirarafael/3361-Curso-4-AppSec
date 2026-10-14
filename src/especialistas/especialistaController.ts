import { type Request, type Response } from 'express'
import { AppDataSource } from '../data-source.js'
import { Especialista } from './EspecialistaEntity.js'
import { mapeiaPlano } from '../utils/planoSaudeUtils.js'
import { Endereco } from '../enderecos/enderecoEntity.js'
import { AppError, Status } from '../error/ErrorHandler.js'
import { type AtualizarContatoDTO } from './especialistaContratos.js'
import { encryptPassword } from '../utils/senhaUtils.js'
import { emailEmUso } from '../auth/contaUtils.js'
import { Role } from '../auth/roles.js'
import { type Clinica } from '../clinicas/clinicaEntity.js'
import { cancelarConsultasFuturas } from '../consultas/consultaCancelamento.js'
import {
  type AtualizarEspecialistaDTO,
  paraEspecialistaAdmin,
  paraEspecialistaPublico
} from './especialistaDto.js'

// Get All
export const especialistas = async (
  req: Request,
  res: Response
): Promise<void> => {
  const ativos = await AppDataSource.manager.find(Especialista, { where: { estaAtivo: true }, relations: { endereco: true } })
  res.status(200).json(ativos.map(paraEspecialistaPublico))
}
// Post
// Se o especialista for criado apenas com os atributos opcionais, enviar mensagem avisando quais campos faltam
export const criarEspecialista = async (
  req: Request,
  res: Response
): Promise<void> => {
  let { nome, crm, imagem, especialidade, endereco, email, telefone, estaAtivo, possuiPlanoSaude, planosSaude, senha } = req.body

  if (possuiPlanoSaude === true && planosSaude !== undefined) {
    // transforma array de numbers em array de strings com os nomes dos planos definidos no enum correspondente
    planosSaude = mapeiaPlano(planosSaude)
  }
  if (await emailEmUso(email)) {
    throw new AppError('E-mail já cadastrado', Status.CONFLICT)
  }
  const senhaCriptografada = encryptPassword(senha)
  const especialista = new Especialista(
    nome,
    crm,
    imagem,
    estaAtivo,
    especialidade,
    email,
    telefone, possuiPlanoSaude, planosSaude, senhaCriptografada
  )

  // o especialista pertence à clínica que o cadastrou: é isso que autoriza a clínica a geri-lo depois
  especialista.clinica = { id: req.userId } as Clinica

  const enderecoPaciente = new Endereco()

  if (endereco !== undefined) {
    enderecoPaciente.cep = endereco.cep
    enderecoPaciente.rua = endereco.rua
    enderecoPaciente.estado = endereco.estado
    enderecoPaciente.numero = endereco.numero
    enderecoPaciente.complemento = endereco.complemento

    especialista.endereco = enderecoPaciente

    await AppDataSource.manager.save(Endereco, enderecoPaciente).catch((err) => {
      console.log(err)
    })
  }

  try {
    await AppDataSource.manager.save(Especialista, especialista)
    // antes devolvia a entidade inteira, inclusive o hash da senha recém-gerado
    res.status(200).json(paraEspecialistaAdmin(especialista))
  } catch (error) {
    if ((await AppDataSource.manager.findOne(Especialista, { where: { crm } })) != null) {
      res.status(422).json({ message: 'Crm já cadastrado' })
    } else {
      throw new AppError('Especialista não foi criado')
    }
  }
}
// Get By Id
export const especialistaById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  const especialista = await AppDataSource.manager.findOne(Especialista, {
    where: { id, estaAtivo: true },
    relations: { endereco: true }
  })

  if (especialista !== null) {
    res.status(200).json(paraEspecialistaPublico(especialista))
  } else {
    throw new AppError('Id não encontrado ')
  }
}

// Put especialista/:id (req.body já passou por validaCorpo(contratoAtualizarEspecialista))
export const atualizarEspecialista = async (req: Request, res: Response): Promise<void> => {
  const { nome, especialidade, email, telefone, possuiPlanoSaude, planosSaude, imagem } = req.body as AtualizarEspecialistaDTO
  const { id } = req.params

  const especialista = await AppDataSource.manager.findOne(Especialista, {
    where: { id },
    relations: { endereco: true }
  })
  if (especialista === null) {
    throw new AppError('Especialista não encontrado', Status.NOT_FOUND)
  }

  if (email !== especialista.email && await emailEmUso(email, id)) {
    throw new AppError('E-mail já cadastrado', Status.CONFLICT)
  }

  // transforma array de numbers em array de strings com os nomes dos planos definidos no enum correspondente
  const nomesPlanos = possuiPlanoSaude && planosSaude !== undefined ? mapeiaPlano(planosSaude) : undefined

  especialista.nome = nome
  especialista.especialidade = especialidade
  especialista.email = email
  especialista.telefone = telefone
  especialista.possuiPlanoSaude = possuiPlanoSaude
  if (nomesPlanos !== undefined) especialista.planosSaude = nomesPlanos as unknown as string
  else if (!possuiPlanoSaude) especialista.planosSaude = [] as unknown as string
  if (imagem !== undefined) especialista.imagem = imagem

  await AppDataSource.manager.save(Especialista, especialista)
  res.json(paraEspecialistaAdmin(especialista))
}

/**
 * Delete especialista/:id: DESATIVA, não apaga (o especialista tem histórico de consultas
 * e avaliações). Quem pode: o próprio especialista, ou a clínica à qual ele pertence.
 * Para qualquer outro, a resposta é a mesma de "não existe".
 */
export const apagarEspecialista = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params
  const especialista = await AppDataSource.manager.findOne(Especialista, {
    where: { id },
    relations: { clinica: true }
  })

  const donoDoCadastro = req.userRole === Role.especialista && req.userId === id
  const clinicaDoEspecialista = req.userRole === Role.clinica && especialista?.clinica?.id === req.userId
  if (especialista === null || !(donoDoCadastro || clinicaDoEspecialista)) {
    throw new AppError('Id não encontrado', Status.NOT_FOUND)
  }

  if (especialista.estaAtivo) {
    await AppDataSource.manager.transaction(async (manager) => {
      // quem desativa o médico cancela a agenda futura dele, liberando os pacientes
      await cancelarConsultasFuturas(manager, { especialista: id }, 'médico_cancelou')
      especialista.estaAtivo = false
      await manager.save(Especialista, especialista)
    })
  }
  res.json({ message: 'Especialista desativado!' })
}

// patch
export const atualizaContato = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params
  // req.body já passou por validaCorpo(contratoAtualizarContato): só `telefone`, validado
  const { telefone } = req.body as AtualizarContatoDTO

  const especialista = await AppDataSource.manager.findOneBy(Especialista, { id })

  if (especialista === null) {
    throw new AppError('Especialista não encontrado', Status.NOT_FOUND)
  }

  // save() usa parâmetros do driver. O código anterior montava o WHERE com o
  // próprio telefone enviado pelo cliente (`.where(telefone)`), o que era SQL injection.
  especialista.telefone = telefone
  await AppDataSource.manager.save(Especialista, especialista)

  res.status(200).json({ id: especialista.id, nome: especialista.nome, telefone: especialista.telefone })
}

export const buscarEspecialistas = async (req: Request, res: Response): Promise<Response> => {
  const { especialidade, estado } = req.query

  if (especialidade === null || estado === null) { throw new AppError('Especialidade ou estados inválidos') }

  const especialistas = await AppDataSource.manager.find(Especialista, {
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    where: { estaAtivo: true, ...(especialidade ? { especialidade: especialidade as string } : {}) },
    relations: ['endereco']
  })

  // endereco pode ser nulo (cadastro sem endereço): antes isso derrubava a busca com 500
  const resultado = especialistas.filter(especialista => especialista.endereco?.estado === estado)

  return res.json(resultado.map(paraEspecialistaPublico))
}
