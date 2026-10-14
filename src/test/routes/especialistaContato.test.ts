/**
 * Teste de segurança: PATCH /especialista/:id (atualização de telefone).
 * Cobre BOLA, mass assignment e SQL injection. Middleware e JWT reais.
 */
import { jest } from '@jest/globals'
import express from 'express'
import 'express-async-errors'
import request from 'supertest'

process.env.SECRET_KEY_CRYPTO = 'segredo-somente-para-teste'
process.env.SECRET_JWT = 'jwt-somente-para-teste'

const ID_LIA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const ID_MAX = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

const bancoDeDados = new Map<string, any>()
const save = jest.fn(async (_entidade: unknown, obj: any) => obj)
const findOneBy = jest.fn(async (_entidade: unknown, where: any) => bancoDeDados.get(where?.id) ?? null)
// O código antigo montava o WHERE com o telefone: se alguém voltar a usar o
// QueryBuilder neste fluxo, o teste falha.
const createQueryBuilder = jest.fn(() => { throw new Error('QueryBuilder não deve ser usado em PATCH /especialista/:id') })

jest.unstable_mockModule('../../data-source.js', () => ({
  AppDataSource: { manager: { save, findOneBy }, createQueryBuilder }
}))
jest.unstable_mockModule('../../services/redis/redisClient.js', () => ({
  default: class {
    async contemChave (): Promise<boolean> { return false }
    async adiciona (): Promise<void> {}
    async buscaValor (): Promise<null> { return null }
    async deleta (): Promise<void> {}
  }
}))
jest.unstable_mockModule('cep-promise', () => ({ default: async (cep: string) => ({ cep }) }))

const { especialistaRouter } = await import('../../especialistas/especialistaRoutes.js')
const { access } = await import('../../auth/tokens.js')
const { default: errorMiddleware } = await import('../../error/errorMiddleware.js')

const app = express()
app.use(express.json())
app.use('/especialista', especialistaRouter)
app.use(errorMiddleware)

const auth = (id: string, role: string) => ({ Authorization: `Bearer ${access.cria(id, role)}` })
const patch = async (id: string, corpo: object, cabecalho?: object) => {
  const req = request(app).patch(`/especialista/${id}`)
  return await (cabecalho !== undefined ? req.set(cabecalho) : req).send(corpo)
}

beforeEach(() => {
  bancoDeDados.clear()
  const base = { crm: '123456', email: 'x@x.com', estaAtivo: true, role: 'ESPECIALISTA', senha: 'hash' }
  bancoDeDados.set(ID_LIA, { ...base, id: ID_LIA, nome: 'Dra Lia', telefone: '34911112222' })
  bancoDeDados.set(ID_MAX, { ...base, id: ID_MAX, nome: 'Dr Max', telefone: '34933334444' })
  for (const mock of [save, findOneBy, createQueryBuilder]) mock.mockClear()
})

describe('PATCH /especialista/:id - autenticação e BOLA', () => {
  it('sem token -> 403, sem tocar no banco', async () => {
    const res = await patch(ID_LIA, { telefone: '34999335522' })

    expect(res.status).toBe(403)
    expect(findOneBy).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('outro especialista (troca de id na URL) -> 403 e telefone intacto', async () => {
    const res = await patch(ID_LIA, { telefone: '34999335522' }, auth(ID_MAX, 'ESPECIALISTA'))

    expect(res.status).toBe(403)
    expect(save).not.toHaveBeenCalled()
    expect(bancoDeDados.get(ID_LIA).telefone).toBe('34911112222')
  })

  it.each([['PACIENTE'], ['CLINICA']])('perfil %s com o mesmo id -> 403', async (role) => {
    const res = await patch(ID_LIA, { telefone: '34999335522' }, auth(ID_LIA, role))

    expect(res.status).toBe(403)
    expect(save).not.toHaveBeenCalled()
  })

  it('o próprio especialista atualiza o telefone', async () => {
    const res = await patch(ID_LIA, { telefone: '34999335522' }, auth(ID_LIA, 'ESPECIALISTA'))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: ID_LIA, nome: 'Dra Lia', telefone: '34999335522' })
    expect(bancoDeDados.get(ID_LIA).telefone).toBe('34999335522')
    expect(bancoDeDados.get(ID_MAX).telefone).toBe('34933334444')
  })
})

describe('PATCH /especialista/:id - SQL injection e validação', () => {
  const dono = auth(ID_LIA, 'ESPECIALISTA')

  it.each([
    ["1=1"],
    ["' OR '1'='1"],
    ['34999335522; DROP TABLE especialista; --'],
    ["0 OR id IS NOT NULL"],
    ['34999335522 UNION SELECT senha FROM autenticaveis']
  ])('payload de injeção "%s" não vira SQL: é sanitizado/rejeitado', async (payload) => {
    const res = await patch(ID_LIA, { telefone: payload }, dono)

    // ou foi rejeitado, ou foi reduzido a dígitos válidos; nunca executa SQL cru
    expect(createQueryBuilder).not.toHaveBeenCalled()
    if (res.status === 200) {
      expect(bancoDeDados.get(ID_LIA).telefone).toMatch(/^\d{11}$/)
    } else {
      expect(res.status).toBe(400)
      expect(save).not.toHaveBeenCalled()
    }
    expect(bancoDeDados.get(ID_MAX).telefone).toBe('34933334444')
  })

  it.each([
    ['telefone curto', { telefone: '123' }],
    ['telefone com tipo errado', { telefone: { $ne: null } }],
    ['sem telefone', {}]
  ])('rejeita com 400 e não grava: %s', async (_caso, corpo) => {
    const res = await patch(ID_LIA, corpo, dono)

    expect(res.status).toBe(400)
    expect(save).not.toHaveBeenCalled()
  })

  it('NUNCA usa o QueryBuilder (regressão do .where(telefone))', async () => {
    await patch(ID_LIA, { telefone: '34999335522' }, dono)

    expect(createQueryBuilder).not.toHaveBeenCalled()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('mass assignment: só o telefone muda (crm, role, estaAtivo, email, id ignorados)', async () => {
    const res = await patch(ID_LIA, {
      telefone: '34999335522', crm: '999', role: 'CLINICA', estaAtivo: false, email: 'a@b.com', id: ID_MAX, senha: 'x'
    }, dono)

    expect(res.status).toBe(200)
    const salvo = bancoDeDados.get(ID_LIA)
    expect(salvo).toMatchObject({ id: ID_LIA, crm: '123456', role: 'ESPECIALISTA', estaAtivo: true, email: 'x@x.com', senha: 'hash' })
  })

  it('especialista inexistente no token válido -> 404', async () => {
    const fantasma = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    const res = await patch(fantasma, { telefone: '34999335522' }, auth(fantasma, 'ESPECIALISTA'))

    expect(res.status).toBe(404)
  })
})
