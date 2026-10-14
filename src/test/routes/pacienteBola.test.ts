/**
 * Teste de segurança: BOLA (Broken Object Level Authorization) nas rotas
 * /paciente/:id, mais mass assignment e validação em PUT/PATCH.
 *
 * Usa o middleware de autenticação e a emissão de token REAIS (jsonwebtoken):
 * só Redis, banco, CEP e o controller de imagens são mockados.
 */
import { jest } from '@jest/globals'
import express from 'express'
import 'express-async-errors'
import jwt from 'jsonwebtoken'
import request from 'supertest'

process.env.SECRET_KEY_CRYPTO = 'segredo-somente-para-teste'
process.env.SECRET_JWT = 'jwt-somente-para-teste'

const ID_ANA = '11111111-1111-1111-1111-111111111111'
const ID_BRUNO = '22222222-2222-2222-2222-222222222222'

const bancoDeDados = new Map<string, any>()
const save = jest.fn(async (_entidade: unknown, obj: any) => obj)
const remove = jest.fn(async () => ({}))
const findOne = jest.fn(async (_entidade: unknown, opcoes: any) => bancoDeDados.get(opcoes?.where?.id) ?? null)
const find = jest.fn(async (..._args: any[]): Promise<any[]> => [])

const manager = { save, findOne, find, delete: remove, transaction: async (fn: any) => await fn({ save, find }) }
jest.unstable_mockModule('../../data-source.js', () => ({
  AppDataSource: {
    manager,
    getRepository: () => ({ findOne, find })
  }
}))
jest.unstable_mockModule('../../services/redis/redisClient.js', () => ({
  default: class {
    async contemChave (): Promise<boolean> { return false }
    async adiciona (): Promise<void> {}
    async buscaValor (): Promise<null> { return null }
    async deleta (): Promise<void> {}
  }
}))
jest.unstable_mockModule('cep-promise', () => ({
  default: async (cep: string) => ({ cep })
}))

const controladorDeImagem = jest.fn((_req: any, res: any) => res.status(200).json({ ok: true }))
jest.unstable_mockModule('../../pacientes/PacienteImagemController.js', () => ({
  criaImagem: controladorDeImagem,
  destroiImagem: controladorDeImagem,
  listaImagemPaciente: controladorDeImagem
}))

const { pacienteRouter } = await import('../../pacientes/pacienteRoutes.js')
const { access } = await import('../../auth/tokens.js')
const { default: errorMiddleware } = await import('../../error/errorMiddleware.js')

const app = express()
app.use(express.json())
app.use('/paciente', pacienteRouter)
app.use(errorMiddleware)

const tokenDe = (id: string, role: string): string => access.cria(id, role)
const tokenAna = tokenDe(ID_ANA, 'PACIENTE')
const tokenBruno = tokenDe(ID_BRUNO, 'PACIENTE')
const comToken = (token: string) => ({ Authorization: `Bearer ${token}` })

const novoPaciente = (id: string, nome: string): any => ({
  id,
  nome,
  cpf: '78160552009',
  email: `${nome.toLowerCase()}@email.com`,
  senha: 'hash-secreto',
  role: 'PACIENTE',
  telefone: '34999335522',
  estaAtivo: true,
  possuiPlanoSaude: false,
  planosSaude: [],
  historico: ['asma,moderada'],
  endereco: null,
  imagem: null
})

const corpoPutValido = {
  nome: 'Ana Souza',
  email: 'ana.souza@email.com',
  telefone: '34999335522',
  possuiPlanoSaude: false
}

const enderecoValido = {
  cep: '01001000',
  rua: 'Praca da Se',
  estado: 'SP',
  numero: 10,
  complemento: 'Sala dois'
}

type Rota = [metodo: 'get' | 'put' | 'patch' | 'delete' | 'post', caminho: (id: string) => string, corpo?: object]

const ROTAS_DO_PACIENTE: Array<[string, ...Rota]> = [
  ['GET /:id', 'get', (id) => `/paciente/${id}`],
  ['GET /:id/consultas', 'get', (id) => `/paciente/${id}/consultas`],
  ['PUT /:id', 'put', (id) => `/paciente/${id}`, corpoPutValido],
  ['PATCH /:id', 'patch', (id) => `/paciente/${id}`, enderecoValido],
  ['DELETE /:id', 'delete', (id) => `/paciente/${id}`],
  ['POST /:id/images', 'post', (id) => `/paciente/${id}/images`],
  ['GET /:id/images', 'get', (id) => `/paciente/${id}/images`],
  ['DELETE /:id/images', 'delete', (id) => `/paciente/${id}/images`]
]

const enviar = async (metodo: Rota[0], caminho: string, token?: string, corpo?: object) => {
  let req = request(app)[metodo](caminho)
  if (token !== undefined) req = req.set(comToken(token))
  return await (corpo !== undefined ? req.send(corpo) : req)
}

beforeEach(() => {
  bancoDeDados.clear()
  bancoDeDados.set(ID_ANA, novoPaciente(ID_ANA, 'Ana'))
  bancoDeDados.set(ID_BRUNO, novoPaciente(ID_BRUNO, 'Bruno'))
  for (const mock of [save, remove, findOne, find, controladorDeImagem]) mock.mockClear()
})

describe('BOLA - /paciente/:id exige autenticação e ser o dono', () => {
  it('sanity: o token emitido por access.cria é aceito pelo middleware (mesmo segredo)', async () => {
    const res = await enviar('get', `/paciente/${ID_ANA}`, tokenAna)

    expect(res.status).toBe(200)
  })

  describe.each(ROTAS_DO_PACIENTE)('%s', (_nome, metodo, caminho, corpo) => {
    it('sem token -> 403, sem tocar no banco nem no controller', async () => {
      const res = await enviar(metodo, caminho(ID_ANA), undefined, corpo)

      expect(res.status).toBe(403)
      expect(findOne).not.toHaveBeenCalled()
      expect(save).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
      expect(controladorDeImagem).not.toHaveBeenCalled()
    })

    it('token de OUTRO paciente (troca de id na URL) -> 403, sem leitura nem escrita', async () => {
      const res = await enviar(metodo, caminho(ID_ANA), tokenBruno, corpo)

      expect(res.status).toBe(403)
      expect(findOne).not.toHaveBeenCalled()
      expect(save).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
      expect(controladorDeImagem).not.toHaveBeenCalled()
    })

    it('token de outro perfil (ESPECIALISTA/CLINICA) com o mesmo id -> 403', async () => {
      for (const role of ['ESPECIALISTA', 'CLINICA']) {
        const res = await enviar(metodo, caminho(ID_ANA), tokenDe(ID_ANA, role), corpo)

        expect(res.status).toBe(403)
      }
      expect(save).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
    })

    it('token assinado com segredo errado -> 403', async () => {
      const falso = jwt.sign({ id: ID_ANA, role: 'PACIENTE' }, 'segredo-do-atacante')
      const res = await enviar(metodo, caminho(ID_ANA), falso, corpo)

      expect(res.status).toBe(403)
      expect(save).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
    })

    it('token expirado -> 403', async () => {
      const expirado = jwt.sign({ id: ID_ANA, role: 'PACIENTE' }, process.env.SECRET_JWT as string, { expiresIn: -10 })
      const res = await enviar(metodo, caminho(ID_ANA), expirado, corpo)

      expect(res.status).toBe(403)
    })
  })

  it('o dono continua conseguindo ler os próprios dados (sem cpf/senha/historico)', async () => {
    const res = await enviar('get', `/paciente/${ID_ANA}`, tokenAna)

    expect(res.status).toBe(200)
    expect(res.body.nome).toBe('Ana')
    for (const campo of ['cpf', 'senha', 'role', 'historico']) {
      expect(res.body[campo]).toBeUndefined()
    }
  })

  it('o dono desativa o próprio cadastro (não apaga), e só o dele', async () => {
    const res = await enviar('delete', `/paciente/${ID_ANA}`, tokenAna)

    expect(res.status).toBe(200)
    expect(remove).not.toHaveBeenCalled()
    expect(bancoDeDados.get(ID_ANA).estaAtivo).toBe(false)
    expect(bancoDeDados.get(ID_BRUNO).estaAtivo).toBe(true)
  })

  it('GET /:id/consultas não lista consultas canceladas (cancelamento lógico)', async () => {
    const res = await enviar('get', `/paciente/${ID_ANA}/consultas`, tokenAna)

    expect(res.status).toBe(200)
    const { where } = find.mock.calls[0][1] as any
    expect(where.canceladaEm?.type).toBe('isNull')
    expect(where.paciente).toEqual({ id: ID_ANA })
  })

  it('o dono passa pela checagem nas rotas de imagem', async () => {
    const res = await enviar('get', `/paciente/${ID_ANA}/images`, tokenAna)

    expect(res.status).toBe(200)
    expect(controladorDeImagem).toHaveBeenCalledTimes(1)
  })
})

describe('PUT /paciente/:id - mass assignment e validação (dono autenticado)', () => {
  const put = async (corpo: object) =>
    await request(app).put(`/paciente/${ID_ANA}`).set(comToken(tokenAna)).send(corpo)

  it('atualiza os campos permitidos', async () => {
    const res = await put(corpoPutValido)

    expect(res.status).toBe(200)
    expect(bancoDeDados.get(ID_ANA).nome).toBe('Ana Souza')
    expect(bancoDeDados.get(ID_ANA).email).toBe('ana.souza@email.com')
  })

  it('NÃO altera cpf, senha, role, estaAtivo, id nem imagem enviados pelo cliente', async () => {
    const antes = { ...bancoDeDados.get(ID_ANA) }
    const res = await put({
      ...corpoPutValido,
      cpf: '12345678909',
      senha: 'NovaSenh@123',
      role: 'CLINICA',
      estaAtivo: false,
      id: ID_BRUNO,
      imagem: { id: 1, url: 'http://atacante.exemplo/p.png' },
      isAdmin: true
    })

    expect(res.status).toBe(200)
    const depois = bancoDeDados.get(ID_ANA)
    expect(depois.cpf).toBe(antes.cpf)
    expect(depois.senha).toBe(antes.senha)
    expect(depois.role).toBe('PACIENTE')
    expect(depois.estaAtivo).toBe(true)
    expect(depois.id).toBe(ID_ANA)
    expect(depois.imagem).toBeNull()
    expect(depois.isAdmin).toBeUndefined()
    expect(bancoDeDados.get(ID_BRUNO).nome).toBe('Bruno') // outro cadastro intacto
  })

  it('ignora o id do corpo: só o id da URL (já validado como dono) é usado', async () => {
    await put({ ...corpoPutValido, id: ID_BRUNO })

    expect(findOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ where: { id: ID_ANA } }))
  })

  it.each([
    ['e-mail inválido', { email: 'nao-e-email' }],
    ['telefone inválido', { telefone: '123' }],
    ['nome com tipo errado', { nome: { $ne: null } }],
    ['imagemUrl com javascript:', { imagemUrl: 'javascript:alert(1)' }],
    ['historico com HTML', { historico: ['<img src=x onerror=alert(1)>'] }]
  ])('rejeita com 400 e não grava: %s', async (_caso, invalido) => {
    const res = await put({ ...corpoPutValido, ...invalido })

    expect(res.status).toBe(400)
    expect(save).not.toHaveBeenCalled()
  })

  it('converte planosSaude para os nomes do enum', async () => {
    const res = await put({ ...corpoPutValido, possuiPlanoSaude: true, planosSaude: [1, 3] })

    expect(res.status).toBe(200)
    expect(bancoDeDados.get(ID_ANA).planosSaude).toEqual(['Unimed', 'Amil'])
  })
})

describe('PATCH /paciente/:id (endereço) - mass assignment e validação (dono autenticado)', () => {
  const patch = async (corpo: object) =>
    await request(app).patch(`/paciente/${ID_ANA}`).set(comToken(tokenAna)).send(corpo)

  it('cria/atualiza o endereço do dono', async () => {
    const res = await patch(enderecoValido)

    expect(res.status).toBe(200)
    expect(res.body.endereco).toEqual({
      cep: 1001000, rua: 'Praca da Se', numero: 10, estado: 'SP', complemento: 'Sala dois'
    })
  })

  it('ignora campos fora do contrato (id do endereço, role, cpf)', async () => {
    const res = await patch({ ...enderecoValido, id: 999, role: 'CLINICA', cpf: '00000000000' })

    expect(res.status).toBe(200)
    const salvo = bancoDeDados.get(ID_ANA)
    expect(salvo.endereco.id).toBeUndefined()
    expect(salvo.role).toBe('PACIENTE')
    expect(salvo.cpf).toBe('78160552009')
  })

  it.each([
    ['estado inexistente', { estado: 'XX' }],
    ['número negativo', { numero: -5 }],
    ['rua com tipo errado', { rua: ['a'] }]
  ])('rejeita com 400 e não grava: %s', async (_caso, invalido) => {
    const res = await patch({ ...enderecoValido, ...invalido })

    expect(res.status).toBe(400)
    expect(save).not.toHaveBeenCalled()
  })
})
