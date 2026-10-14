import { type DataSource } from 'typeorm'
import { encryptPassword } from '../../utils/senhaUtils.js'

export const SENHA_PADRAO = 'Senh@forte123'

export const emDias = (dias: number): Date => new Date(Date.now() + dias * 24 * 60 * 60 * 1000)

let contador = 0

/** Cria registros reais no banco de teste, já com senha cifrada como a aplicação faz. */
export async function criaFabrica (bd: DataSource) {
  // sequencial: ver nota em bancoEmMemoria.ts
  const { Paciente } = await import('../../pacientes/pacienteEntity.js')
  const { Especialista } = await import('../../especialistas/EspecialistaEntity.js')
  const { Clinica } = await import('../../clinicas/clinicaEntity.js')
  const { Consulta } = await import('../../consultas/consultaEntity.js')
  const { Avaliacoes } = await import('../../avaliacoes/avaliacoesEntity.js')
  const { Endereco } = await import('../../enderecos/enderecoEntity.js')

  return {
    async paciente (sobrescrever: Record<string, unknown> = {}): Promise<any> {
      const n = ++contador
      const paciente = new Paciente(
        String(10000000000 + n), `Paciente ${n}`, `paciente${n}@teste.com`,
        encryptPassword(SENHA_PADRAO), '34999335522', [], true, undefined, undefined, ['asma,moderada']
      )
      paciente.possuiPlanoSaude = false
      return await bd.manager.save(Paciente, Object.assign(paciente, sobrescrever))
    },

    async especialista (sobrescrever: Record<string, unknown> = {}): Promise<any> {
      const n = ++contador
      const especialista = new Especialista(
        `Dr ${n}`, `CRM${n}`, 'https://exemplo.com/foto.png', true, 'Cardiologia',
        `especialista${n}@teste.com`, '34911112222', false, [], encryptPassword(SENHA_PADRAO)
      )
      return await bd.manager.save(Especialista, Object.assign(especialista, sobrescrever))
    },

    async clinica (sobrescrever: Record<string, unknown> = {}): Promise<any> {
      const n = ++contador
      const endereco = await bd.manager.save(Endereco, Object.assign(new Endereco(), {
        cep: 1001000, rua: 'Praca da Se', estado: 'SP', numero: 10, complemento: 'Sala'
      }))
      const clinica = new Clinica()
      clinica.nome = `Clinica ${n}`
      clinica.email = `clinica${n}@teste.com`
      clinica.senha = encryptPassword(SENHA_PADRAO)
      clinica.planoDeSaudeAceitos = ['Unimed']
      clinica.endereco = endereco
      return await bd.manager.save(Clinica, Object.assign(clinica, sobrescrever))
    },

    async consulta (dados: { paciente: any, especialista: any, data?: Date, canceladaEm?: Date, motivo?: string }): Promise<any> {
      const consulta = new Consulta()
      consulta.paciente = dados.paciente
      consulta.especialista = dados.especialista
      consulta.data = dados.data ?? emDias(5)
      consulta.desejaLembrete = false
      consulta.canceladaEm = dados.canceladaEm ?? null
      if (dados.motivo !== undefined) consulta.motivoCancelamento = dados.motivo
      return await bd.manager.save(Consulta, consulta)
    },

    async avaliacao (dados: { paciente: any, especialista: any, nota?: number, descricao?: string }): Promise<any> {
      const avaliacao = new Avaliacoes()
      avaliacao.paciente = dados.paciente
      avaliacao.especialista = dados.especialista
      avaliacao.nota = dados.nota ?? 5
      avaliacao.descricao = dados.descricao ?? 'ótimo atendimento'
      return await bd.manager.save(Avaliacoes, avaliacao)
    }
  }
}
