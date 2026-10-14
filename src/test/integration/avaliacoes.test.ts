/**
 * Integração (SQLite em memória, entidades e controllers reais): /avaliacoes.
 * Antes: POST público em nome de qualquer paciente (avaliações falsas) e GET público
 * devolvendo o id do paciente de cada avaliação.
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

const { avaliacoesRouter } = await import('../../avaliacoes/avaliacoesRoutes.js')
const { access } = await import('../../auth/tokens.js')
const { Avaliacoes } = await import('../../avaliacoes/avaliacoesEntity.js')
const { default: errorMiddleware } = await import('../../error/errorMiddleware.js')

const app = express()
app.use(express.json())
app.use('/avaliacoes', avaliacoesRouter)
app.use(errorMiddleware)

let fabrica: Awaited<ReturnType<typeof criaFabrica>>
const auth = (id: string, role: string) => ({ Authorization: `Bearer ${access.cria(id, role)}` })
const totalAvaliacoes = async (): Promise<number> => await bd.manager.count(Avaliacoes)
const post = async (cabecalho: object | undefined, corpo: object) => {
  const req = request(app).post('/avaliacoes')
  return await (cabecalho !== undefined ? req.set(cabecalho) : req).send(corpo)
}

beforeEach(async () => {
  await limpaBanco(bd)
  fabrica = await criaFabrica(bd)
})
afterAll(async () => { await bd.destroy() })

/** Paciente que de fato foi atendido pelo especialista (consulta passada, não cancelada). */
const atendido = async (): Promise<{ ana: any, lia: any }> => {
  const ana = await fabrica.paciente()
  const lia = await fabrica.especialista()
  await fabrica.consulta({ paciente: ana, especialista: lia, data: emDias(-7) })
  return { ana, lia }
}

describe('GET /avaliacoes (público)', () => {
  it('NÃO expõe o id do paciente: só id, nota, descrição, data e o especialista', async () => {
    const { ana, lia } = await atendido()
    await fabrica.avaliacao({ paciente: ana, especialista: lia, nota: 4, descricao: 'bom' })

    const res = await request(app).get('/avaliacoes')

    expect(res.status).toBe(200)
    expect(Object.keys(res.body[0]).sort()).toEqual(['createdAt', 'descricao', 'especialistaId', 'id', 'nota'])
    expect(JSON.stringify(res.body)).not.toContain(ana.id)
    expect(res.body[0].especialistaId).toBe(lia.id)
  })

  describe('paginação (antes devolvia tudo)', () => {
    beforeEach(async () => {
      const lia = await fabrica.especialista()
      for (let i = 0; i < 120; i++) {
        const p = await fabrica.paciente()
        await fabrica.avaliacao({ paciente: p, especialista: lia, nota: (i % 5) + 1, descricao: `a${i}` })
      }
    }, 60000)

    it('padrão: 50 por página', async () => {
      expect((await request(app).get('/avaliacoes')).body).toHaveLength(50)
    })

    it('limite pedido acima do teto é cortado em 100', async () => {
      expect((await request(app).get('/avaliacoes').query({ limite: 100000 })).body).toHaveLength(100)
    })

    it.each([['abc'], ['-5'], ['0'], ['1.5'], ['1e9']])('limite inválido (%s) volta ao padrão', async (limite) => {
      expect((await request(app).get('/avaliacoes').query({ limite })).body).toHaveLength(50)
    })

    it('limite repetido (array) também volta ao padrão', async () => {
      expect((await request(app).get('/avaliacoes?limite=5&limite=6')).body).toHaveLength(50)
    })

    it('navega por páginas sem repetir itens', async () => {
      const p1 = (await request(app).get('/avaliacoes').query({ limite: 50, pagina: 1 })).body
      const p2 = (await request(app).get('/avaliacoes').query({ limite: 50, pagina: 2 })).body
      const p3 = (await request(app).get('/avaliacoes').query({ limite: 50, pagina: 3 })).body

      expect([p1.length, p2.length, p3.length]).toEqual([50, 50, 20])
      expect(new Set([...p1, ...p2, ...p3].map((a: any) => a.id)).size).toBe(120)
    })
  })
})

describe('POST /avaliacoes - só quem foi atendido avalia, em nome próprio', () => {
  const corpo = (lia: any, extra: object = {}) => ({ idEspecialista: lia.id, nota: 5, descricao: 'Excelente', ...extra })

  it('sem token -> 403 e nada é gravado', async () => {
    const { lia } = await atendido()

    expect((await post(undefined, corpo(lia))).status).toBe(403)
    expect(await totalAvaliacoes()).toBe(0)
  })

  it.each([['ESPECIALISTA'], ['CLINICA']])('perfil %s -> 403', async (role) => {
    const { ana, lia } = await atendido()

    expect((await post(auth(ana.id, role), corpo(lia))).status).toBe(403)
    expect(await totalAvaliacoes()).toBe(0)
  })

  it('o paciente atendido avalia, e a avaliação fica com o paciente do TOKEN', async () => {
    const { ana, lia } = await atendido()

    const res = await post(auth(ana.id, 'PACIENTE'), corpo(lia))

    expect(res.status).toBe(200)
    const [linha] = await bd.query('select pacienteId, especialistaId, nota, descricao from avaliacoes')
    expect(linha).toEqual({ pacienteId: ana.id, especialistaId: lia.id, nota: 5, descricao: 'Excelente' })
  })

  it('NÃO dá para avaliar em nome de outro paciente (idPaciente no corpo é ignorado)', async () => {
    const { ana, lia } = await atendido()
    const bruno = await fabrica.paciente()

    const res = await post(auth(bruno.id, 'PACIENTE'), corpo(lia, { idPaciente: ana.id }))

    expect(res.status).toBe(403) // Bruno nunca consultou com a Lia
    expect(await totalAvaliacoes()).toBe(0)
  })

  it('paciente que NUNCA consultou com o especialista -> 403', async () => {
    const ana = await fabrica.paciente()
    const lia = await fabrica.especialista()

    expect((await post(auth(ana.id, 'PACIENTE'), corpo(lia))).status).toBe(403)
    expect(await totalAvaliacoes()).toBe(0)
  })

  it('consulta apenas CANCELADA ou apenas FUTURA não dá direito a avaliar', async () => {
    const ana = await fabrica.paciente()
    const lia = await fabrica.especialista()
    await fabrica.consulta({ paciente: ana, especialista: lia, data: emDias(-3), canceladaEm: new Date(), motivo: 'outros' })
    await fabrica.consulta({ paciente: ana, especialista: lia, data: emDias(3) })

    expect((await post(auth(ana.id, 'PACIENTE'), corpo(lia))).status).toBe(403)
  })

  it('consulta com OUTRO especialista não vale', async () => {
    const { ana } = await atendido()
    const max = await fabrica.especialista()

    expect((await post(auth(ana.id, 'PACIENTE'), corpo(max))).status).toBe(403)
  })

  it('só uma avaliação por paciente e especialista (anti-manipulação da nota) -> 409', async () => {
    const { ana, lia } = await atendido()
    await post(auth(ana.id, 'PACIENTE'), corpo(lia, { nota: 5 }))

    const res = await post(auth(ana.id, 'PACIENTE'), corpo(lia, { nota: 1 }))

    expect(res.status).toBe(409)
    expect(await totalAvaliacoes()).toBe(1)
  })

  it('paciente desativado -> 403', async () => {
    const { ana, lia } = await atendido()
    await bd.query('update paciente set estaAtivo = 0 where id = ?', [ana.id])

    expect((await post(auth(ana.id, 'PACIENTE'), corpo(lia))).status).toBe(403)
  })

  it('especialista inexistente -> 404', async () => {
    const ana = await fabrica.paciente()

    expect((await post(auth(ana.id, 'PACIENTE'), { idEspecialista: 'nao-existe', nota: 5 })).status).toBe(404)
  })

  it.each([
    ['nota 0', { nota: 0 }],
    ['nota 6', { nota: 6 }],
    ['nota negativa', { nota: -1 }],
    ['nota decimal', { nota: 3.5 }],
    ['nota texto', { nota: 'cinco' }],
    ['nota objeto', { nota: { $gt: 0 } }],
    ['sem nota', { nota: undefined }],
    ['descrição com HTML', { descricao: '<script>alert(1)</script>' }],
    ['descrição com tipo errado', { descricao: { x: 1 } }],
    ['descrição gigante', { descricao: 'a'.repeat(501) }],
    ['idEspecialista com tipo errado', { idEspecialista: { $ne: null } }]
  ])('rejeita com 400 sem gravar: %s', async (_caso, invalido) => {
    const { ana, lia } = await atendido()

    const res = await post(auth(ana.id, 'PACIENTE'), corpo(lia, invalido))

    expect(res.status).toBe(400)
    expect(await totalAvaliacoes()).toBe(0)
  })

  it('aceita notas de 1 a 5 e descrição ausente', async () => {
    for (const nota of [1, 2, 3, 4, 5]) {
      const { ana, lia } = await atendido()
      expect((await post(auth(ana.id, 'PACIENTE'), { idEspecialista: lia.id, nota })).status).toBe(200)
    }
    expect(await totalAvaliacoes()).toBe(5)
  })

  it('ignora campos fora do contrato (id, createdAt, pacienteId)', async () => {
    const { ana, lia } = await atendido()
    const bruno = await fabrica.paciente()

    await post(auth(ana.id, 'PACIENTE'), corpo(lia, { id: 'meu-id', createdAt: '2000-01-01', pacienteId: bruno.id }))

    const [linha] = await bd.query('select id, pacienteId, createdAt from avaliacoes')
    expect(linha.id).not.toBe('meu-id')
    expect(linha.pacienteId).toBe(ana.id)
    expect(linha.createdAt.startsWith('2000')).toBe(false)
  })
})
