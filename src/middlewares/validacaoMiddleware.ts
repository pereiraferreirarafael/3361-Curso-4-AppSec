import { type NextFunction, type Request, type Response } from 'express'
import { StatusCodes } from 'http-status-codes'

/**
 * Contrato de entrada de uma rota. Cada etapa roda nesta ordem e só o resultado
 * da última substitui `req.body`:
 *
 *  1. filtrar   -> allowlist: descarta toda chave fora do contrato (mass assignment)
 *  2. sanitizar -> normaliza valores (trim, remove caracteres inválidos)
 *  3. schema    -> valida tipos/regras e devolve o valor já convertido
 */
export interface ContratoDeEntrada<T> {
  filtrar: (corpo: unknown) => unknown
  sanitizar?: (dto: any) => unknown
  schema: {
    validate: (valor: unknown, opcoes?: { stripUnknown?: boolean }) => Promise<T>
  }
}

const ehErroDeValidacao = (erro: unknown): erro is Error =>
  erro instanceof Error && erro.name === 'ValidationError'

/**
 * Middleware de validação/sanitização de corpo de requisição.
 *
 * Uso: `router.post('/', validaCorpo(contratoCriarPaciente), criarPaciente)`.
 * No controller, `req.body` já é o DTO limpo e validado.
 *
 * Em qualquer falha responde 400 com mensagem genérica, sem eco do payload e
 * sem stack trace.
 */
export function validaCorpo<T> (contrato: ContratoDeEntrada<T>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let dto: unknown
    try {
      dto = contrato.filtrar(req.body)
      if (contrato.sanitizar !== undefined) dto = contrato.sanitizar(dto)
    } catch {
      // ex.: valor não-string onde se esperava texto
      res.status(StatusCodes.BAD_REQUEST).json({ message: 'Formato de dados inválido' })
      return
    }

    try {
      req.body = await contrato.schema.validate(dto, { stripUnknown: true })
    } catch (erro) {
      if (ehErroDeValidacao(erro)) {
        res.status(StatusCodes.BAD_REQUEST).json({ message: erro.message })
        return
      }
      next(erro)
      return
    }

    next()
  }
}
