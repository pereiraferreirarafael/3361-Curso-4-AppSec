/**
 * Integração (SQLite em memória, entidades e controllers reais): rotas de especialista.
 * PUT só pelo dono e só campos permitidos; DELETE só pelo dono ou pela clínica dele, e
 * DESATIVA; listagens públicas sem dado de contato nem ids de pacientes.
 */
import { jest } from '@jest/globals'
import express from 'express'
import 'express-async-errors'
import request from 'supertest'

process.env.SECRET_KEY_CRYPTO = 'segredo-somente-para-teste'
process.env.SECRET_JWT = 'jwt-somente-para-teste'

const { criaBancoEmMemoria, limpaBanco } = await import('../helpers/bancoEmMemoria.js')
const { criaFabrica, emDias } = await import('../helpers/fabrica.js')
const bd = await criaBancoEmMemoria()

jest.unstable_mockModule('../../data-source.js', () => ({ AppDataSource: bd }))
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
const { Especialista } = await import('../../especialistas/EspecialistaEntity.js')
const { Consulta } = await import('../../consultas/consultaEntity.js')
const { default: errorMiddleware } = await import('../../error/errorMiddleware.js')

const app = express()
app.use(express.json())
app.use('/especialista', especialistaRouter)
app.use(errorMiddleware)

let fabrica: Awaited<ReturnType<typeof criaFabrica>>
const auth = (id: string, role: string) => ({ Authorization: `Bearer ${access.cria(id, role)}` })
const noBanco = async (id: string): Promise<any> => await bd.manager.findOne(Especialista, { where: { id }, relations: { clinica: true } })
const consultaNoBanco = async (id: string): Promise<any> => await bd.manager.findOne(Consulta, { where: { id } })

beforeEach(async () => {
  await limpaBanco(bd)
  fabrica = await criaFabrica(bd)
})
afterAll(async () => { await bd.destroy() })

const corpoPutValido = {
  nome: 'Dra Lia Souza',
  especialidade: 'Dermatologia',
  email: 'lia.nova@teste.com',
  telefone: '34999335522',
  possuiPlanoSaude: false
}

describe('PUT /especialista/:id', () => {
  const put = async (id: string, cabecalho: object | undefined, corpo: object) => {
    const req = request(app).put(`/especialista/${id}`)
    return await (cabecalho !== undefined ? req.set(cabecalho) : req).send(corpo)
  }

  it('sem token -> 403 e nada muda', async () => {
    const lia = await fabrica.especialista()

    const res = await put(lia.id, undefined, corpoPutValido)

    expect(res.status).toBe(403)
    expect((await noBanco(lia.id)).nome).toBe(lia.nome)
  })

  it('OUTRO especialista (troca de id na URL) -> 403 e o cadastro da Lia fica intacto (BOLA)', async () => {
    const lia = await fabrica.especialista()
    const max = await fabrica.especialista()

    const res = await put(lia.id, auth(max.id, 'ESPECIALISTA'), corpoPutValido)

    expect(res.status).toBe(403)
    expect((await noBanco(lia.id)).nome).toBe(lia.nome)
  })

  it.each([['PACIENTE'], ['CLINICA']])('perfil %s com o mesmo id -> 403 (PUT é do próprio especialista)', async (role) => {
    const lia = await fabrica.especialista()

    const res = await put(lia.id, auth(lia.id, role), corpoPutValido)

    expect(res.status).toBe(403)
    expect((await noBanco(lia.id)).nome).toBe(lia.nome)
  })

  it('o próprio especialista atualiza os campos permitidos', async () => {
    const lia = await fabrica.especialista()

    const res = await put(lia.id, auth(lia.id, 'ESPECIALISTA'), { ...corpoPutValido, possuiPlanoSaude: true, planosSaude: [1, 3], imagem: 'https://exemplo.com/nova.png' })

    expect(res.status).toBe(200)
    const salvo = await noBanco(lia.id)
    expect(salvo).toMatchObject({
      nome: 'Dra Lia Souza', especialidade: 'Dermatologia', email: 'lia.nova@teste.com',
      telefone: '34999335522', possuiPlanoSaude: true, imagem: 'https://exemplo.com/nova.png'
    })
    expect(salvo.planosSaude).toEqual(['Unimed', 'Amil'])
  })

  it('NÃO altera crm, estaAtivo, role, senha, clinica nem id enviados pelo cliente (mass assignment)', async () => {
    const clinica = await fabrica.clinica()
    const lia = await fabrica.especialista({ clinica })
    const antes = await bd.query('select crm, estaAtivo, role, senha, clinicaId from especialista where id = ?', [lia.id])

    const res = await put(lia.id, auth(lia.id, 'ESPECIALISTA'), {
      ...corpoPutValido, crm: 'CRM-DE-OUTRO', estaAtivo: false, role: 'CLINICA', senha: 'NovaSenh@123', clinica: null, id: 'outro-id'
    })

    expect(res.status).toBe(200)
    const depois = await bd.query('select crm, estaAtivo, role, senha, clinicaId from especialista where id = ?', [lia.id])
    expect(depois).toEqual(antes)
  })

  it('a resposta não traz senha, role nem avaliações com id de paciente', async () => {
    const lia = await fabrica.especialista()
    const ana = await fabrica.paciente()
    await fabrica.avaliacao({ paciente: ana, especialista: lia })

    const res = await put(lia.id, auth(lia.id, 'ESPECIALISTA'), corpoPutValido)

    expect(res.body.senha).toBeUndefined()
    expect(res.body.role).toBeUndefined()
    expect(JSON.stringify(res.body)).not.toContain(ana.id)
    expect(res.body.avaliacoes).toEqual({ quantidade: 1, media: 5 })
  })

  it('e-mail já usado por OUTRA conta (inclusive de paciente) -> 409 e nada muda', async () => {
    const lia = await fabrica.especialista()
    const ana = await fabrica.paciente()

    const res = await put(lia.id, auth(lia.id, 'ESPECIALISTA'), { ...corpoPutValido, email: ana.email })

    expect(res.status).toBe(409)
    expect((await noBanco(lia.id)).email).toBe(lia.email)
  })

  it('manter o próprio e-mail não conta como conflito', async () => {
    const lia = await fabrica.especialista()

    const res = await put(lia.id, auth(lia.id, 'ESPECIALISTA'), { ...corpoPutValido, email: lia.email })

    expect(res.status).toBe(200)
  })

  it.each([
    ['e-mail inválido', { email: 'nao-e-email' }],
    ['telefone inválido', { telefone: '123' }],
    ['nome com tipo errado', { nome: { $ne: null } }],
    ['especialidade com HTML', { especialidade: '<script>alert(1)</script>' }],
    ['especialidade vazia', { especialidade: '' }],
    ['imagem com javascript:', { imagem: 'javascript:alert(1)' }],
    ['plano inexistente', { possuiPlanoSaude: true, planosSaude: [99] }]
  ])('rejeita sem gravar: %s', async (_caso, invalido) => {
    const lia = await fabrica.especialista()

    const res = await put(lia.id, auth(lia.id, 'ESPECIALISTA'), { ...corpoPutValido, ...invalido })

    expect(res.status).toBe(400)
    expect((await noBanco(lia.id)).nome).toBe(lia.nome)
  })

  it('campo obrigatório ausente -> 400', async () => {
    const lia = await fabrica.especialista()
    const { nome: _nome, ...semNome } = corpoPutValido

    expect((await put(lia.id, auth(lia.id, 'ESPECIALISTA'), semNome)).status).toBe(400)
  })
})

describe('DELETE /especialista/:id - desativa, não apaga', () => {
  const del = async (id: string, cabecalho?: object) => {
    const req = request(app).delete(`/especialista/${id}`)
    return await (cabecalho !== undefined ? req.set(cabecalho) : req)
  }

  it('sem token -> 403', async () => {
    const lia = await fabrica.especialista()

    expect((await del(lia.id)).status).toBe(403)
    expect((await noBanco(lia.id)).estaAtivo).toBe(true)
  })

  it('PACIENTE -> 403', async () => {
    const lia = await fabrica.especialista()
    const ana = await fabrica.paciente()

    expect((await del(lia.id, auth(ana.id, 'PACIENTE'))).status).toBe(403)
    expect((await noBanco(lia.id)).estaAtivo).toBe(true)
  })

  it('OUTRO especialista NÃO desativa a Lia: mesma resposta de "não existe" (BOLA)', async () => {
    const lia = await fabrica.especialista()
    const max = await fabrica.especialista()

    const res = await del(lia.id, auth(max.id, 'ESPECIALISTA'))
    const inexistente = await del('id-que-nao-existe', auth(max.id, 'ESPECIALISTA'))

    expect(res.status).toBe(404)
    expect(res.body).toEqual(inexistente.body)
    expect((await noBanco(lia.id)).estaAtivo).toBe(true)
  })

  it('clínica DE OUTRO especialista NÃO desativa (BOLA entre clínicas)', async () => {
    const clinicaA = await fabrica.clinica()
    const clinicaB = await fabrica.clinica()
    const lia = await fabrica.especialista({ clinica: clinicaA })

    const res = await del(lia.id, auth(clinicaB.id, 'CLINICA'))

    expect(res.status).toBe(404)
    expect((await noBanco(lia.id)).estaAtivo).toBe(true)
  })

  it('especialista sem clínica: nenhuma clínica o desativa (só ele mesmo)', async () => {
    const clinica = await fabrica.clinica()
    const lia = await fabrica.especialista()

    expect((await del(lia.id, auth(clinica.id, 'CLINICA'))).status).toBe(404)
    expect((await del(lia.id, auth(lia.id, 'ESPECIALISTA'))).status).toBe(200)
  })

  it('a clínica DONA desativa, e o cadastro continua no banco', async () => {
    const clinica = await fabrica.clinica()
    const lia = await fabrica.especialista({ clinica })

    const res = await del(lia.id, auth(clinica.id, 'CLINICA'))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ message: 'Especialista desativado!' })
    const salvo = await noBanco(lia.id)
    expect(salvo).not.toBeNull()
    expect(salvo.estaAtivo).toBe(false)
    expect(salvo.nome).toBe(lia.nome)
  })

  it('NÃO apaga mesmo com consultas e avaliações ligadas a ele', async () => {
    const lia = await fabrica.especialista()
    const ana = await fabrica.paciente()
    await fabrica.consulta({ paciente: ana, especialista: lia, data: emDias(-5) })
    await fabrica.avaliacao({ paciente: ana, especialista: lia })

    const res = await del(lia.id, auth(lia.id, 'ESPECIALISTA'))

    expect(res.status).toBe(200)
    expect(await bd.manager.count(Consulta)).toBe(1)
  })

  it('cancela as consultas FUTURAS do médico (motivo médico_cancelou) e preserva o resto', async () => {
    const lia = await fabrica.especialista()
    const max = await fabrica.especialista()
    const ana = await fabrica.paciente()
    const futura = await fabrica.consulta({ paciente: ana, especialista: lia, data: emDias(3) })
    const passada = await fabrica.consulta({ paciente: ana, especialista: lia, data: emDias(-3) })
    const doMax = await fabrica.consulta({ paciente: ana, especialista: max, data: emDias(3) })

    await del(lia.id, auth(lia.id, 'ESPECIALISTA'))

    const f = await consultaNoBanco(futura.id)
    expect(f.canceladaEm).not.toBeNull()
    expect(f.motivoCancelamento).toBe('médico_cancelou')
    expect((await consultaNoBanco(passada.id)).canceladaEm).toBeNull()
    expect((await consultaNoBanco(doMax.id)).canceladaEm).toBeNull()
  })

  it('é idempotente', async () => {
    const lia = await fabrica.especialista()
    await del(lia.id, auth(lia.id, 'ESPECIALISTA'))

    expect((await del(lia.id, auth(lia.id, 'ESPECIALISTA'))).status).toBe(200)
  })

  it('depois de desativado, some das listagens e da busca públicas', async () => {
    const ativo = await fabrica.especialista()
    const lia = await fabrica.especialista()
    await del(lia.id, auth(lia.id, 'ESPECIALISTA'))

    const lista = await request(app).get('/especialista')
    const porId = await request(app).get(`/especialista/${lia.id}`)

    expect(lista.body.map((e: any) => e.id)).toEqual([ativo.id])
    expect(porId.status).toBe(400) // mesma resposta de "id não encontrado" de antes
  })
})

describe('GET /especialista (público): sem contato nem ids de pacientes', () => {
  it('a listagem traz só a visão pública, com resumo das avaliações', async () => {
    const lia = await fabrica.especialista()
    const ana = await fabrica.paciente()
    const bia = await fabrica.paciente()
    await fabrica.avaliacao({ paciente: ana, especialista: lia, nota: 5 })
    await fabrica.avaliacao({ paciente: bia, especialista: lia, nota: 4 })

    const res = await request(app).get('/especialista')

    expect(res.status).toBe(200)
    const [dto] = res.body
    expect(Object.keys(dto).sort()).toEqual(['avaliacoes', 'crm', 'especialidade', 'estaAtivo', 'id', 'imagem', 'nome', 'planosSaude', 'possuiPlanoSaude'])
    expect(dto.avaliacoes).toEqual({ quantidade: 2, media: 4.5 })
    const texto = JSON.stringify(res.body)
    for (const vazamento of [ana.id, bia.id, lia.email, lia.telefone, 'ESPECIALISTA', 'senha']) {
      expect(texto).not.toContain(vazamento)
    }
  })

  it('GET /:id e /busca também usam a visão pública', async () => {
    const endereco = { cep: 1001000, rua: 'R', estado: 'SP', numero: 1, complemento: 'c' }
    const e = await bd.manager.save((await import('../../enderecos/enderecoEntity.js')).Endereco, Object.assign(new (await import('../../enderecos/enderecoEntity.js')).Endereco(), endereco))
    const lia = await fabrica.especialista({ endereco: e })

    const porId = await request(app).get(`/especialista/${lia.id}`)
    const busca = await request(app).get('/especialista/busca').query({ especialidade: 'Cardiologia', estado: 'SP' })

    expect(porId.body.email).toBeUndefined()
    expect(porId.body.endereco).toEqual({ estado: 'SP' })
    expect(busca.body).toHaveLength(1)
    expect(busca.body[0].telefone).toBeUndefined()
  })

  it('a busca não quebra (500) com especialista sem endereço', async () => {
    await fabrica.especialista()

    const res = await request(app).get('/especialista/busca').query({ especialidade: 'Cardiologia', estado: 'SP' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

describe('POST /especialista (clínica cadastra)', () => {
  const corpo = {
    nome: 'Dr Novo', crm: '123456', imagem: 'https://exemplo.com/f.png', especialidade: 'Pediatria',
    email: 'dr.novo@teste.com', telefone: '34999335522', estaAtivo: true, possuiPlanoSaude: false, senha: 'Senh@forte123'
  }

  it('vincula o especialista à clínica que o cadastrou e NÃO devolve a senha', async () => {
    const clinica = await fabrica.clinica()

    const res = await request(app).post('/especialista').set(auth(clinica.id, 'CLINICA')).send(corpo)

    expect(res.status).toBe(200)
    expect(res.body.senha).toBeUndefined()
    expect(JSON.stringify(res.body)).not.toContain('Senh@forte123')
    expect((await noBanco(res.body.id)).clinica.id).toBe(clinica.id)
  })

  it('e-mail já cadastrado em qualquer tipo de conta -> 409', async () => {
    const clinica = await fabrica.clinica()
    const ana = await fabrica.paciente()

    const res = await request(app).post('/especialista').set(auth(clinica.id, 'CLINICA')).send({ ...corpo, email: ana.email })

    expect(res.status).toBe(409)
    expect(await bd.manager.count(Especialista)).toBe(0)
  })

  it('sem token ou com token de paciente -> 403', async () => {
    const ana = await fabrica.paciente()

    expect((await request(app).post('/especialista').send(corpo)).status).toBe(403)
    expect((await request(app).post('/especialista').set(auth(ana.id, 'PACIENTE')).send(corpo)).status).toBe(403)
  })
})
