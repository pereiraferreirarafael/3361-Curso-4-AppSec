import { type ContratoDeEntrada } from '../middlewares/validacaoMiddleware.js'
import { filtrarCamposPermitidos, type CriarPacienteDTO } from './pacienteDto.js'
import { sanitizacaoPaciente } from './pacienteSanitizations.js'
import { pacienteSchema } from './pacienteYupSchema.js'

/** POST /paciente: allowlist -> sanitização -> validação yup. */
export const contratoCriarPaciente: ContratoDeEntrada<CriarPacienteDTO> = {
  filtrar: filtrarCamposPermitidos,
  sanitizar: sanitizacaoPaciente,
  schema: pacienteSchema as unknown as ContratoDeEntrada<CriarPacienteDTO>['schema']
}
