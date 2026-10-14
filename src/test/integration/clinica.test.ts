/**
 * Integração (SQLite em memória, entidades e controllers reais): rotas de clínica.
 * Cobre a criação de conta CLINICA (antes pública), BOLA entre clínicas, vazamento de
 * senha/e-mail e o endereço que nunca era persistido.
 */
import { jest } from '@jest/globals'
import express from 'express'
import 'express-async-errors'
import request from 'supertest'

process.env.SECRET_KEY_CRYPTO = 'segredo-somente-para-teste'
process.env.SECRET_JWT = 'jwt-somente-para-teste'

const { criaBancoEmMemoria, limpaBanco } = await import('../helpers/bancoEmMemoria.js')
const { criaFabrica, SENHA_PADRAO } = await import('../helpers/fabrica.js')
const bd = await criaBancoEmMemoria()

const adicionaNaBlocklist = jest.fn(async (..._args: any[]) => {})
jest.unstable_mockModule('../../data-source.js', () => ({ AppDataSource: bd }))
jest.unstable_mockModule('../../services/redis/redisClient.js', () => ({
  default: class {
    async contemChave (): Promise<boolean> { return false }
    adiciona = adicionaNaBlocklist
    async buscaValor (): Promise<null> { return null }
    async deleta (): Promise<void> {}
  }
}))
jest.unstable_mockModule('cep-promise', () => ({ default: async (cep: string) => ({ cep }) }))

const { clinicaRouter } = await import('../../clinicas/clinicaRoutes.js')
const { authRouter } = await import('../../auth/authRoutes.js')
const { access } = await import('../../auth/tokens.js')
const { Clinica } = await import('../../clinicas/clinicaEntity.js')
const { Especialista } = await import('../../especialistas/EspecialistaEntity.js')
const { Endereco } = await import('../../enderecos/enderecoEntity.js')
const { default: errorMiddleware } = await import('../../error/errorMiddleware.js')

const app = express()
app.use(express.json())
app.use('/clinica', clinicaRouter)
app.use('/auth', authRouter)
app.use(errorMiddleware)

let fabrica: Awaited<ReturnType<typeof criaFabrica>>
const auth = (id: string, role: string) => ({ Authorization: `Bearer ${access.cria(id, role)}` })
const clinicaNoBanco = async (id: string): Promise<any> => await bd.manager.findOne(Clinica, { where: { id }, relations: { endereco: true } })
const totalClinicas = async (): Promise<number> => await bd.manager.count(Clinica)

beforeEach(async () => {
  await limpaBanco(bd)
  fabrica = await criaFabrica(bd)
  adicionaNaBlocklist.mockClear()
})
afterAll(async () => { await bd.destroy() })

const corpoCriar = {
  nome: 'Clínica Voll 24h',
  email: 'nova@clinica.com',
  senha: 'Senh@forte123',
  endereco: { cep: '01001000', rua: 'Praca da Se', estado: 'SP', numero: 100, complemento: 'Sala dois' },
  planoDeSaudeAceitos: [1, 2]
}

describe('POST /clinica - antes qualquer pessoa criava uma conta CLINICA', () => {
  it('sem token -> 403 e NENHUMA clínica é criada', async () => {
    const res = await request(app).post('/clinica').send(corpoCriar)

    expect(res.status).toBe(403)
    expect(await totalClinicas()).toBe(0)
  })

  it.each([['PACIENTE'], ['ESPECIALISTA'], ['GUEST']])('token de %s -> 403', async (role) => {
    const res = await request(app).post('/clinica').set(auth('qualquer-id', role)).send(corpoCriar)

    expect(res.status).toBe(403)
    expect(await totalClinicas()).toBe(0)
  })

  it('um gestor autenticado cria outra clínica: o ENDEREÇO é persistido (antes se perdia)', async () => {
    const gestor = await fabrica.clinica()

    const res = await request(app).post('/clinica').set(auth(gestor.id, 'CLINICA')).send(corpoCriar)

    expect(res.status).toBe(200)
    const salva = await clinicaNoBanco(res.body.id)
    expect(salva.nome).toBe('Clínica Voll 24h')
    expect(salva.endereco).toMatchObject({ rua: 'Praca da Se', estado: 'SP', numero: 100 })
    expect(salva.planoDeSaudeAceitos).toEqual(['Unimed', 'Bradesco'])
  })

  it('NÃO devolve senha nem role, e a senha é guardada cifrada', async () => {
    const gestor = await fabrica.clinica()

    const res = await request(app).post('/clinica').set(auth(gestor.id, 'CLINICA')).send(corpoCriar)

    expect(res.body.senha).toBeUndefined()
    expect(res.body.role).toBeUndefined()
    expect(JSON.stringify(res.body)).not.toContain('Senh@forte123')
    const [linha] = await bd.query('select senha from clinica where id = ?', [res.body.id])
    expect(linha.senha).not.toBe('Senh@forte123')
  })

  it('a clínica criada consegue fazer login (e o perfil é CLINICA)', async () => {
    const gestor = await fabrica.clinica()
    await request(app).post('/clinica').set(auth(gestor.id, 'CLINICA')).send(corpoCriar)

    const res = await request(app).post('/auth/login').send({ email: corpoCriar.email, senha: corpoCriar.senha })

    expect(res.status).toBe(200)
    expect(res.body.rota).toBe('/clinica')
  })

  it('ignora campos fora do contrato (role, id, especialistas)', async () => {
    const gestor = await fabrica.clinica()

    const res = await request(app).post('/clinica').set(auth(gestor.id, 'CLINICA'))
      .send({ ...corpoCriar, role: 'ESPECIALISTA', id: 'id-escolhido', especialistas: [{ id: 'x' }] })

    expect(res.status).toBe(200)
    const [linha] = await bd.query('select id, role from clinica where email = ?', [corpoCriar.email])
    expect(linha.role).toBe('CLINICA')
    expect(linha.id).not.toBe('id-escolhido')
  })

  it('e-mail já usado por QUALQUER conta (paciente, especialista ou clínica) -> 409', async () => {
    const gestor = await fabrica.clinica()
    const ana = await fabrica.paciente()
    const lia = await fabrica.especialista()

    for (const email of [ana.email, lia.email, gestor.email]) {
      const res = await request(app).post('/clinica').set(auth(gestor.id, 'CLINICA')).send({ ...corpoCriar, email })
      expect(res.status).toBe(409)
    }
    expect(await totalClinicas()).toBe(1)
  })

  it.each([
    ['senha fraca', { senha: '12345' }],
    ['e-mail inválido', { email: 'nao-e-email' }],
    ['nome com HTML', { nome: '<script>alert(1)</script>' }],
    ['nome com tipo errado', { nome: { $ne: null } }],
    ['sem endereço', { endereco: undefined }],
    ['estado inexistente', { endereco: { cep: '01001000', rua: 'R', estado: 'XX', numero: 1, complemento: 'c' } }],
    ['plano inexistente', { planoDeSaudeAceitos: [99] }]
  ])('rejeita sem criar nada: %s', async (_caso, invalido) => {
    const gestor = await fabrica.clinica()

    const res = await request(app).post('/clinica').set(auth(gestor.id, 'CLINICA')).send({ ...corpoCriar, ...invalido })

    expect(res.status).toBe(400)
    expect(await totalClinicas()).toBe(1)
  })

  it('não deixa endereço órfão quando a clínica falha (transação)', async () => {
    const gestor = await fabrica.clinica()
    const antes = await bd.manager.count(Endereco)

    await request(app).post('/clinica').set(auth(gestor.id, 'CLINICA')).send({ ...corpoCriar, planoDeSaudeAceitos: [99] })

    expect(await bd.manager.count(Endereco)).toBe(antes)
  })
})

describe('GET /clinica e /clinica/:id (vitrine pública)', () => {
  it('lista só nome, planos e endereço: sem e-mail (login do gestor), senha nem role', async () => {
    const c = await fabrica.clinica()

    const res = await request(app).get('/clinica')

    expect(res.status).toBe(200)
    expect(Object.keys(res.body[0]).sort()).toEqual(['endereco', 'id', 'nome', 'planoDeSaudeAceitos'])
    expect(JSON.stringify(res.body)).not.toContain(c.email)
  })

  it('GET /:id devolve a clínica com endereço (antes dava erro 500)', async () => {
    const c = await fabrica.clinica()

    const res = await request(app).get(`/clinica/${c.id}`)

    expect(res.status).toBe(200)
    expect(res.body.endereco.estado).toBe('SP')
    expect(res.body.email).toBeUndefined()
  })

  it('id inexistente -> 404 (antes respondia 200 com null)', async () => {
    expect((await request(app).get('/clinica/nao-existe')).status).toBe(404)
  })
})

describe('PUT /clinica/:id', () => {
  const put = async (id: string, cabecalho: object | undefined, corpo: object) => {
    const req = request(app).put(`/clinica/${id}`)
    return await (cabecalho !== undefined ? req.set(cabecalho) : req).send(corpo)
  }

  it('sem token -> 403 e nada muda', async () => {
    const c = await fabrica.clinica()

    expect((await put(c.id, undefined, { nome: 'Invasor' })).status).toBe(403)
    expect((await clinicaNoBanco(c.id)).nome).toBe(c.nome)
  })

  it('OUTRA clínica não altera esta (BOLA)', async () => {
    const a = await fabrica.clinica()
    const b = await fabrica.clinica()

    const res = await put(a.id, auth(b.id, 'CLINICA'), { nome: 'Invasor' })

    expect(res.status).toBe(403)
    expect((await clinicaNoBanco(a.id)).nome).toBe(a.nome)
  })

  it.each([['PACIENTE'], ['ESPECIALISTA']])('perfil %s com o mesmo id -> 403', async (role) => {
    const c = await fabrica.clinica()

    expect((await put(c.id, auth(c.id, role), { nome: 'Invasor' })).status).toBe(403)
  })

  it('a própria clínica atualiza de forma parcial: só o nome', async () => {
    const c = await fabrica.clinica()

    const res = await put(c.id, auth(c.id, 'CLINICA'), { nome: 'Novo Nome' })

    expect(res.status).toBe(200)
    const salva = await clinicaNoBanco(c.id)
    expect(salva.nome).toBe('Novo Nome')
    expect(salva.email).toBe(c.email) // o que não veio não muda
    expect(salva.endereco.rua).toBe('Praca da Se')
  })

  it('atualiza e PERSISTE o endereço (antes quebrava)', async () => {
    const c = await fabrica.clinica()

    const res = await put(c.id, auth(c.id, 'CLINICA'), {
      endereco: { cep: '20040020', rua: 'Rua Nova', estado: 'RJ', numero: 7, complemento: 'Andar 3' }
    })

    expect(res.status).toBe(200)
    expect((await clinicaNoBanco(c.id)).endereco).toMatchObject({ rua: 'Rua Nova', estado: 'RJ', numero: 7 })
  })

  it('ignora senha, role e id no corpo: a senha continua a mesma (login antigo funciona)', async () => {
    const c = await fabrica.clinica()

    await put(c.id, auth(c.id, 'CLINICA'), { nome: 'X', senha: 'Outra@Senha1', role: 'ESPECIALISTA', id: 'outro' })

    expect((await clinicaNoBanco(c.id)).role).toBe('CLINICA')
    expect((await request(app).post('/auth/login').send({ email: c.email, senha: SENHA_PADRAO })).status).toBe(200)
  })

  it('e-mail de outra conta -> 409; e-mail novo e livre -> 200', async () => {
    const c = await fabrica.clinica()
    const ana = await fabrica.paciente()

    expect((await put(c.id, auth(c.id, 'CLINICA'), { email: ana.email })).status).toBe(409)
    expect((await put(c.id, auth(c.id, 'CLINICA'), { email: 'livre@clinica.com' })).status).toBe(200)
  })

  it.each([
    ['e-mail inválido', { email: 'x' }],
    ['nome com HTML', { nome: '<b>x</b>' }],
    ['endereço incompleto', { endereco: { rua: 'só a rua' } }]
  ])('rejeita sem gravar: %s', async (_caso, invalido) => {
    const c = await fabrica.clinica()

    expect((await put(c.id, auth(c.id, 'CLINICA'), invalido)).status).toBe(400)
    expect((await clinicaNoBanco(c.id)).nome).toBe(c.nome)
  })
})

describe('DELETE /clinica/:id', () => {
  it('sem token -> 403; OUTRA clínica -> 403; nada é apagado', async () => {
    const a = await fabrica.clinica()
    const b = await fabrica.clinica()

    expect((await request(app).delete(`/clinica/${a.id}`)).status).toBe(403)
    expect((await request(app).delete(`/clinica/${a.id}`).set(auth(b.id, 'CLINICA'))).status).toBe(403)
    expect(await totalClinicas()).toBe(2)
  })

  it('clínica com especialistas vinculados -> 409 e nada é apagado', async () => {
    const c = await fabrica.clinica()
    await fabrica.especialista({ clinica: c })

    const res = await request(app).delete(`/clinica/${c.id}`).set(auth(c.id, 'CLINICA'))

    expect(res.status).toBe(409)
    expect(await totalClinicas()).toBe(1)
  })

  it('clínica sem especialistas: apaga a clínica e o endereço, e invalida o token', async () => {
    const c = await fabrica.clinica()
    const cabecalho = auth(c.id, 'CLINICA')
    const enderecosAntes = await bd.manager.count(Endereco)

    const res = await request(app).delete(`/clinica/${c.id}`).set(cabecalho)

    expect(res.status).toBe(200)
    expect(await totalClinicas()).toBe(0)
    expect(await bd.manager.count(Endereco)).toBe(enderecosAntes - 1)
    expect(adicionaNaBlocklist).toHaveBeenCalledTimes(1)
  })
})

describe('/clinica/:id/especialista', () => {
  const vincular = async (idClinica: string, cabecalho: object | undefined, especialistaId: unknown) => {
    const req = request(app).post(`/clinica/${idClinica}/especialista`)
    return await (cabecalho !== undefined ? req.set(cabecalho) : req).send({ especialistaId })
  }
  const clinicaDoEspecialista = async (id: string): Promise<string | undefined> =>
    (await bd.manager.findOne(Especialista, { where: { id }, relations: { clinica: true } }))?.clinica?.id

  it('sem token ou de OUTRA clínica -> 403, e o especialista não é movido', async () => {
    const a = await fabrica.clinica()
    const b = await fabrica.clinica()
    const lia = await fabrica.especialista()

    expect((await vincular(a.id, undefined, lia.id)).status).toBe(403)
    expect((await vincular(a.id, auth(b.id, 'CLINICA'), lia.id)).status).toBe(403)
    expect(await clinicaDoEspecialista(lia.id)).toBeUndefined()
  })

  it('a clínica vincula um especialista SEM clínica', async () => {
    const a = await fabrica.clinica()
    const lia = await fabrica.especialista()

    const res = await vincular(a.id, auth(a.id, 'CLINICA'), lia.id)

    expect(res.status).toBe(200)
    expect(await clinicaDoEspecialista(lia.id)).toBe(a.id)
    expect(res.body.senha).toBeUndefined()
  })

  it('NÃO rouba o especialista de outra clínica (409) e ele continua onde estava', async () => {
    const a = await fabrica.clinica()
    const b = await fabrica.clinica()
    const lia = await fabrica.especialista({ clinica: b })

    const res = await vincular(a.id, auth(a.id, 'CLINICA'), lia.id)

    expect(res.status).toBe(409)
    expect(await clinicaDoEspecialista(lia.id)).toBe(b.id)
  })

  it('vincular quem já é da própria clínica é aceito; inexistente -> 404; tipo errado -> 400', async () => {
    const a = await fabrica.clinica()
    const lia = await fabrica.especialista({ clinica: a })

    expect((await vincular(a.id, auth(a.id, 'CLINICA'), lia.id)).status).toBe(200)
    expect((await vincular(a.id, auth(a.id, 'CLINICA'), 'nao-existe')).status).toBe(404)
    expect((await vincular(a.id, auth(a.id, 'CLINICA'), { $ne: null })).status).toBe(400)
  })

  it('GET lista os especialistas da PRÓPRIA clínica (inclusive inativos), com contato e sem senha', async () => {
    const a = await fabrica.clinica()
    const ativo = await fabrica.especialista({ clinica: a })
    const inativo = await fabrica.especialista({ clinica: a, estaAtivo: false })
    await fabrica.especialista({ clinica: await fabrica.clinica() })

    const res = await request(app).get(`/clinica/${a.id}/especialista`).set(auth(a.id, 'CLINICA'))

    expect(res.status).toBe(200)
    expect(res.body.map((e: any) => e.id).sort()).toEqual([ativo.id, inativo.id].sort())
    expect(res.body[0].email).toBeDefined()
    expect(JSON.stringify(res.body)).not.toContain('senha')
  })

  it('GET sem token ou de OUTRA clínica -> 403', async () => {
    const a = await fabrica.clinica()
    const b = await fabrica.clinica()

    expect((await request(app).get(`/clinica/${a.id}/especialista`)).status).toBe(403)
    expect((await request(app).get(`/clinica/${a.id}/especialista`).set(auth(b.id, 'CLINICA'))).status).toBe(403)
  })
})
