import * as Yup from 'yup'
import { type ContratoDeEntrada } from '../middlewares/validacaoMiddleware.js'
import {
  filtrarCamposCancelamento,
  filtrarCamposConsulta,
  MOTIVOS_CANCELAMENTO,
  type CancelarConsultaDTO,
  type CriarConsultaDTO
} from './consultaDto.js'

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

const cancelamentoSchema = Yup.object().shape({
  motivoCancelamento: Yup.string().oneOf(MOTIVOS_CANCELAMENTO, 'Motivo de cancelamento inválido')
})

/** DELETE /consulta/:id: só o motivo (opcional), restrito aos valores do enum. */
export const contratoCancelarConsulta: ContratoDeEntrada<CancelarConsultaDTO> = {
  filtrar: filtrarCamposCancelamento,
  schema: cancelamentoSchema as unknown as ContratoDeEntrada<CancelarConsultaDTO>['schema']
}
