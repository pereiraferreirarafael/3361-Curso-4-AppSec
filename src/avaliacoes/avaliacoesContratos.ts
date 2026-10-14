import * as Yup from 'yup'
import { type ContratoDeEntrada } from '../middlewares/validacaoMiddleware.js'
import { filtrarCamposAvaliacao, type CriarAvaliacaoDTO } from './avaliacoesDto.js'

export const NOTA_MINIMA = 1
export const NOTA_MAXIMA = 5

const avaliacaoSchema = Yup.object().shape({
  idEspecialista: Yup.string().required('idEspecialista é obrigatório').max(36),
  nota: Yup.number()
    .required('nota é obrigatória')
    .integer('A nota deve ser um número inteiro')
    .min(NOTA_MINIMA)
    .max(NOTA_MAXIMA),
  // texto livre exibido a outros usuários: sem HTML nem caracteres de controle
  descricao: Yup.string()
    .max(500)
    // eslint-disable-next-line no-control-regex
    .matches(/^[^<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/, 'A descrição contém caracteres inválidos')
})

/** POST /avaliacoes */
export const contratoCriarAvaliacao: ContratoDeEntrada<CriarAvaliacaoDTO> = {
  filtrar: filtrarCamposAvaliacao,
  sanitizar: (dto: any) => ({
    ...dto,
    ...(typeof dto.descricao === 'string' ? { descricao: dto.descricao.trim() } : {})
  }),
  schema: avaliacaoSchema as unknown as ContratoDeEntrada<CriarAvaliacaoDTO>['schema']
}
