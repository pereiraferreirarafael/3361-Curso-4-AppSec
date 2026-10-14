import { type NextFunction, type Request, type Response } from 'express'
import { StatusCodes } from 'http-status-codes'

/**
 * Proteção contra BOLA (Broken Object Level Authorization).
 *
 * Deve rodar DEPOIS de `verificaTokenJWT`, que preenche `req.userId` a partir do
 * token. Só deixa passar quem é o dono do recurso: o id do token precisa ser
 * igual ao id da URL. Em qualquer outro caso responde 403 genérico, sem revelar
 * se o recurso existe.
 *
 * Uso: `router.put('/:id', verificaTokenJWT(Role.paciente), somenteDono(), handler)`
 */
export function somenteDono (parametro = 'id') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const idDoToken = req.userId
    const idDoRecurso = req.params[parametro]

    if (typeof idDoToken !== 'string' || idDoToken === '' || idDoToken !== idDoRecurso) {
      res.status(StatusCodes.FORBIDDEN).json({ auth: false, message: 'Não autorizado' })
      return
    }

    next()
  }
}
