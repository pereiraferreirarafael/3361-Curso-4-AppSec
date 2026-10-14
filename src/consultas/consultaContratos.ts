import * as Yup from 'yup'
import { type ContratoDeEntrada } from '../middlewares/validacaoMiddleware.js'
import { filtrarCamposConsulta, type CriarConsultaDTO } from './consultaDto.js'

const consultaSchema = Yup.object().shape({
  especialista: Yup.string().required('especialista é obrigatório').max(36),
  data: Yup.date().required('data é obrigatória'),
  desejaLembrete: Yup.boolean(),
  lembretes: Yup.array().of(Yup.number().integer().min(0)).max(10)
})

/** POST /consulta: allowlist -> validação yup (o paciente vem do token, não do corpo). */
export const contratoCriarConsulta: ContratoDeEntrada<CriarConsultaDTO> = {
  filtrar: filtrarCamposConsulta,
  schema: consultaSchema as unknown as ContratoDeEntrada<CriarConsultaDTO>['schema']
}
