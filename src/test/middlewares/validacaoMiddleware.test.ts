/**
 * validaCorpo: allowlist -> sanitização -> schema, nessa ordem.
 * Teste unitário puro (sem banco, sem rede).
 */
import { jest } from '@jest/globals'
import express from 'express'
import request from 'supertest'
import * as Yup from 'yup'
import { validaCorpo, type ContratoDeEntrada } from '../../middlewares/validacaoMiddleware.js'

interface Dto { nome: string, idade: number }

const schema = Yup.object().shape({
  nome: Yup.string().required('nome é obrigatório').max(20),
  idade: Yup.number().required().integer().min(0)
})

const contrato: ContratoDeEntrada<Dto> = {
  filtrar: (corpo: any) => ({ nome: corpo?.nome, idade: corpo?.idade }),
  sanitizar: (dto: any) => ({ ...dto, nome: dto.nome.trim() }),
  schema: schema as unknown as ContratoDeEntrada<Dto>['schema']
}

const criaApp = (c: ContratoDeEntrada<Dto>, handler: express.RequestHandler) => {
  const app = express()
  app.use(express.json())
  app.post('/x', validaCorpo(c), handler)
  return app
}

describe('validaCorpo', () => {
  it('entrega ao handler só o DTO limpo, sanitizado e convertido', async () => {
    const handler = jest.fn((req: any, res: any) => res.json(req.body))

    const res = await request(criaApp(contrato, handler as any))
      .post('/x')
      .send({ nome: '  Ana  ', idade: '30', role: 'ADMIN', isAdmin: true })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ nome: 'Ana', idade: 30 }) // trim + cast + sem role/isAdmin
  })

  it('responde 400 e NÃO chama o handler quando a validação falha', async () => {
    const handler = jest.fn()

    const res = await request(criaApp(contrato, handler as any))
      .post('/x')
      .send({ nome: 'Ana', idade: -1 })

    expect(res.status).toBe(400)
    expect(typeof res.body.message).toBe('string')
    expect(handler).not.toHaveBeenCalled()
  })

  it('responde 400 genérico (não 500) quando o sanitizador recebe tipo inesperado', async () => {
    const handler = jest.fn()

    const res = await request(criaApp(contrato, handler as any))
      .post('/x')
      .send({ nome: { $ne: null }, idade: 1 }) // objeto onde se esperava texto

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ message: 'Formato de dados inválido' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('não ecoa o payload nem stack trace na resposta de erro', async () => {
    const res = await request(criaApp(contrato, jest.fn() as any))
      .post('/x')
      .send({ nome: 'Ana', idade: 'abc', segredo: 'valor-sensivel' })

    expect(res.status).toBe(400)
    expect(JSON.stringify(res.body)).not.toContain('valor-sensivel')
    expect(JSON.stringify(res.body)).not.toContain('at ')
  })

  it('aceita corpo ausente sem quebrar (vira 400 de validação)', async () => {
    const res = await request(criaApp(contrato, jest.fn() as any)).post('/x')

    expect(res.status).toBe(400)
  })

  it('repassa erros que não são de validação ao errorMiddleware (next)', async () => {
    const contratoQuebrado: ContratoDeEntrada<Dto> = {
      ...contrato,
      schema: { validate: async () => { throw new Error('falha interna') } }
    }
    const app = criaApp(contratoQuebrado, jest.fn() as any)
    app.use((err: Error, _req: any, res: any, _next: any) => res.status(500).json({ visto: err.message }))

    const res = await request(app).post('/x').send({ nome: 'Ana', idade: 1 })

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ visto: 'falha interna' })
  })
})
